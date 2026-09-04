import {
  AlarmEngine,
  definitionsForAsset,
  type ActiveAlarm,
  type AlarmCounts,
} from '../lib/isa18'
import { computeOee, sameOee } from '../lib/oee'
import type {
  FactoryState,
  FeedDensity,
  Machine,
  OeeMetrics,
  TelemetryPoint,
} from '../types'
import { alarmChime } from './alarmChime'

/**
 * Thông số danh định và ngưỡng của từng máy, chép từ bảng `asset` của backend
 * (`infra/db/init/04-assets.sql`). Lò reflow chạy 245°C là bình thường, máy gắn
 * linh kiện 245°C là cháy — một ngưỡng dùng chung cho cả dây chuyền thì hoặc
 * báo động giả suốt ngày, hoặc không bao giờ báo.
 *
 * Khi chạy với backend MES thì ngưỡng lấy thẳng từ DB; bản trong trình duyệt
 * này chỉ dùng cho chế độ mô phỏng ngoại tuyến.
 */
interface AssetLimits {
  warnTemp: number
  critTemp: number
  warnVibration: number
}

const ASSET_LIMITS: Record<string, AssetLimits> = {
  'SMT-LINE-01': { warnTemp: 75, critTemp: 88, warnVibration: 4.0 },
  'REFLOW-OVEN-02': { warnTemp: 262, critTemp: 295, warnVibration: 3.0 },
  'CNC-MILL-03': { warnTemp: 85, critTemp: 95, warnVibration: 6.0 },
  'AOI-INSPECT-04': { warnTemp: 55, critTemp: 70, warnVibration: 2.5 },
}

const TICK_MS = 1500
/** Points kept per machine — 40 x 1.5s = a 60 second rolling window. */
const HISTORY_LENGTH = 40
/** Độ trễ khi trả trạng thái máy về bình thường, tách khỏi deadband cảnh báo. */
const STATUS_RECOVER_MARGIN_C = 3

/**
 * Độ nóng lên khi đẩy quá 2.0x, tính theo tỉ lệ dư địa nhiệt của máy mỗi tick.
 * Cùng hằng số với `SPEED_HEAT_GAIN` trong `infra/mes/line.py`.
 */
const SPEED_HEAT_GAIN = 0.2

/**
 * Seeds runTime/downTime consistently with the units already produced, so the
 * OEE figures on first paint are the ones this machine would really have:
 * runTime = count x idealCycle / assumedPerformance.
 */
function seedMachine(
  m: Omit<Machine, 'runTimeMs' | 'downTimeMs' | 'lastUpdated'>
): Machine {
  const runTimeMs = (m.output * m.idealCycleSec * 1000) / 0.92
  return {
    ...m,
    runTimeMs,
    downTimeMs: runTimeMs * 0.065, // ~93.9% availability at start
    estop: false,
    lastUpdated: Date.now(),
  }
}

const INITIAL_MACHINES: Machine[] = [
  seedMachine({
    id: 'SMT-LINE-01',
    name: 'SMT Pick & Place',
    code: 'SMT-LINE-01',
    category: 'Assembly',
    status: 'running',
    temperature: 52.4,
    vibration: 1.2,
    output: 14250,
    defects: 28,
    powerUsage: 18.5,
    targetOutput: 15000,
    idealCycleSec: 0.4,
  }),
  seedMachine({
    // SMT line -> reflow oven. Wave soldering is a through-hole process and
    // does not belong on a surface-mount line.
    id: 'REFLOW-OVEN-02',
    name: 'Reflow Soldering Oven',
    code: 'REFLOW-OVEN-02',
    category: 'Soldering',
    status: 'running',
    temperature: 245.0, // peak zone of a lead-free profile
    vibration: 0.8,
    output: 13800,
    defects: 42,
    powerUsage: 35.2,
    targetOutput: 15000,
    idealCycleSec: 0.45,
  }),
  seedMachine({
    id: 'CNC-MILL-03',
    name: 'CNC Enclosure Milling',
    code: 'CNC-MILL-03',
    category: 'Machining',
    status: 'running',
    temperature: 68.1,
    vibration: 2.4,
    output: 4800,
    defects: 15,
    powerUsage: 24.0,
    targetOutput: 5000,
    idealCycleSec: 1.2,
  }),
  seedMachine({
    id: 'AOI-INSPECT-04',
    name: 'AOI Optical Inspection',
    code: 'AOI-INSPECT-04',
    category: 'Quality Control',
    status: 'running',
    temperature: 38.5,
    vibration: 0.4,
    output: 14100,
    defects: 0,
    powerUsage: 8.2,
    targetOutput: 15000,
    idealCycleSec: 0.42,
  }),
]

function limitsOf(id: string): AssetLimits {
  return (
    ASSET_LIMITS[id] ?? {
      warnTemp: Infinity,
      critTemp: Infinity,
      warnVibration: Infinity,
    }
  )
}

/**
 * Master Alarm Database phía trình duyệt, sinh từ chính hồ sơ máy ở trên —
 * cùng công thức với `05-alarms.sql`. Không gõ lại tay từng con số ở hai nơi.
 */
export function buildAlarmEngine(machines: Machine[]): AlarmEngine {
  const engine = new AlarmEngine()
  machines.forEach((m) => {
    const limits = limitsOf(m.id)
    definitionsForAsset({
      assetCode: m.id,
      name: m.name,
      warnTemp: limits.warnTemp,
      critTemp: limits.critTemp,
      warnVibration: limits.warnVibration,
      nominalPower: m.powerUsage,
    }).forEach((d) => engine.add(d))
  })
  return engine
}

type Listener = () => void

function densityFactor(density: FeedDensity) {
  return density === 'HIGH' ? 1.4 : density === 'LOW' ? 0.7 : 1.0
}

const EMPTY_COUNTS: AlarmCounts = new AlarmEngine().stateCounts()

/**
 * Export cả lớp chứ không chỉ instance dùng chung: mỗi test dựng một instance
 * mới thì trạng thái của test trước không rò sang test sau. Đây là điều bắt
 * buộc từ khi cảnh báo có máy trạng thái — một cảnh báo ACKED_ALM đang trong
 * off-delay sẽ sống qua ranh giới giữa hai test. Ứng dụng chỉ dùng
 * `sensorSimulator` bên dưới. Cùng khuôn mẫu với `MesLink`.
 */
export class SensorSimulator {
  private machines: Machine[] = INITIAL_MACHINES.map((m) => ({ ...m }))
  private telemetryHistory: Record<string, TelemetryPoint[]> = {}
  /**
   * Cảnh báo do một máy trạng thái ISA-18.2 sinh ra, không phải một mảng cờ
   * boolean. Cùng máy trạng thái với `infra/mes/alarms.py`, nên màn hình lúc
   * chạy ngoại tuyến là đúng màn hình mà hệ thống thật tạo ra.
   */
  private engine = buildAlarmEngine(INITIAL_MACHINES)
  private alarms: ActiveAlarm[] = []
  private inhibitedAlarms: ActiveAlarm[] = []
  private alarmCounts: AlarmCounts = EMPTY_COUNTS
  private oee: OeeMetrics = {
    availability: 0,
    performance: 0,
    quality: 0,
    overall: 0,
  }
  private lineSpeed = 1.0
  private feedDensity: FeedDensity = 'NORMAL'
  private readonly listeners = new Set<Listener>()
  private intervalId: number | null = null
  private snapshot!: FactoryState

  constructor() {
    const now = Date.now()
    this.machines.forEach((m) => {
      this.telemetryHistory[m.id] = Array.from({ length: 12 }, (_, i) => ({
        t: now - (11 - i) * TICK_MS,
        temp: m.temperature,
        vibration: m.vibration,
      }))
    })
    this.oee = computeOee(this.machines)
    this.refreshAlarms(now)
    this.rebuildSnapshot()
  }

  // ---------------------------------------------------------------- store API

  /**
   * External-store contract for useSyncExternalStore. The simulator only runs
   * while something is subscribed, so leaving the dashboard stops the timer
   * instead of burning CPU in a background tab.
   */
  public subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  public getSnapshot = (): FactoryState => this.snapshot

  /** Master Alarm Database, để màn hình `/alarms` đọc khi chạy ngoại tuyến. */
  public getAlarmDefinitions = () => this.engine.definitionRows()

  private rebuildSnapshot() {
    this.snapshot = {
      machines: this.machines,
      telemetryHistory: this.telemetryHistory,
      alarms: this.alarms,
      inhibitedAlarms: this.inhibitedAlarms,
      alarmCounts: this.alarmCounts,
      oee: this.oee,
      lineSpeed: this.lineSpeed,
      feedDensity: this.feedDensity,
    }
  }

  private notify() {
    // OEE keeps its object identity while the numbers are unchanged, so panels
    // that only read OEE re-render on real movement instead of every tick.
    const next = computeOee(this.machines)
    if (!sameOee(next, this.oee)) this.oee = next

    this.rebuildSnapshot()
    this.listeners.forEach((l) => l())
  }

  private start() {
    if (this.intervalId !== null) return
    this.intervalId = window.setInterval(() => this.tick(), TICK_MS)
  }

  private stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    alarmChime.close()
  }

  // ----------------------------------------------------------------- cảnh báo

  private machineNames(): Map<string, string> {
    return new Map(this.machines.map((m) => [m.id, m.name]))
  }

  /**
   * Đưa số đo hiện tại vào máy trạng thái rồi đọc lại danh sách hiển thị.
   *
   * Tên số đo (`temperature`, `vibration`, `power_kw`, `estop`) trùng với tên
   * metric của historian và của cột `alarm_definition.metric` — một tên duy
   * nhất đi suốt, không có bảng ánh xạ nào ở giữa.
   */
  private refreshAlarms(now: number, chime = false) {
    const readings = new Map<string, number>()
    this.machines.forEach((m) => {
      readings.set(`${m.id}|temperature`, m.temperature)
      readings.set(`${m.id}|vibration`, m.vibration)
      readings.set(`${m.id}|power_kw`, m.powerUsage)
      readings.set(`${m.id}|estop`, m.estop ? 1 : 0)
    })

    const transitions = this.engine.evaluate(now, readings)
    // Chỉ bíp khi có cảnh báo thực sự kêu lên, không bíp cho mọi chuyển trạng
    // thái: xác nhận hay trở về bình thường thì không cần báo động.
    if (chime && transitions.some((t) => t.toState === 'UNACK_ALM')) {
      alarmChime.beep()
    }

    const names = this.machineNames()
    this.alarms = this.engine.summary(now, names)
    this.inhibitedAlarms = this.engine.inhibited(now, names)
    this.alarmCounts = this.engine.stateCounts()
  }

  // -------------------------------------------------------------- simulation

  public setLineSpeed(speed: number) {
    const next = Math.max(0.5, Math.min(3.0, Number(speed.toFixed(1))))
    if (next === this.lineSpeed) return
    this.lineSpeed = next
    this.notify()
  }

  public setFeedDensity(density: FeedDensity) {
    if (density === this.feedDensity) return
    this.feedDensity = density
    this.notify()
  }

  private tick() {
    const now = Date.now()
    const dtSec = TICK_MS / 1000
    const density = densityFactor(this.feedDensity)

    this.machines = this.machines.map((m) => {
      const isProducing = m.status === 'running' || m.status === 'warning'

      if (!isProducing) {
        // A stopped machine still consumes planned production time — that is
        // exactly what pulls OEE Availability down.
        return { ...m, downTimeMs: m.downTimeMs + TICK_MS, lastUpdated: now }
      }

      const initial = INITIAL_MACHINES.find((init) => init.id === m.id) ?? m
      const limits = limitsOf(m.id)

      // Mean reversion keeps temperature/vibration bounded around the baseline.
      const tempDist = initial.temperature - m.temperature
      const vibDist = initial.vibration - m.vibration
      const over = Math.max(0, this.lineSpeed - 2.0)

      // Đẩy dây quá 2.0x thì máy nóng lên — đó là HẬU QUẢ ĐO ĐƯỢC của việc đẩy
      // nhanh, không phải một cảnh báo báo lại cho người vận hành điều họ vừa
      // tự tay làm. Hệ số tính theo dư địa của chính máy (warn − danh định):
      // lò reflow còn 17 độ dư địa, máy gắn linh kiện còn 22 độ.
      const headroom = Math.max(1, limits.warnTemp - initial.temperature)
      const newTemp = Number(
        (
          m.temperature +
          tempDist * 0.15 +
          (Math.random() - 0.5) * 0.6 +
          over * headroom * SPEED_HEAT_GAIN
        ).toFixed(1)
      )
      const newVib = Number(
        Math.max(
          0.1,
          m.vibration +
            vibDist * 0.15 +
            (Math.random() - 0.5) * 0.1 +
            over * 0.15
        ).toFixed(2)
      )

      // Công suất bám theo tải. Trước đây đây là hằng số không bao giờ đổi —
      // nghĩa là một số đo chết, và một cảnh báo đặt trên nó thì không bao giờ
      // kêu. Đẩy tốc độ dây lên cao thì động cơ ăn thêm điện, và đó là thứ đo
      // được — thay cho cảnh báo "Line Speed Overclocked" cũ, vốn chỉ báo lại
      // cho người vận hành điều họ vừa tự tay làm.
      const load = 0.72 + 0.28 * this.lineSpeed * density
      const newPower = Number(
        (
          m.powerUsage +
          (initial.powerUsage * load - m.powerUsage) * 0.2 +
          (Math.random() - 0.5) * initial.powerUsage * 0.01
        ).toFixed(2)
      )

      // Units produced follow the machine's own ideal cycle time, degraded by a
      // small efficiency loss — so OEE Performance measures something real.
      const efficiency = 0.86 + Math.random() * 0.12
      const produced = Math.floor(
        (dtSec / m.idealCycleSec) * this.lineSpeed * density * efficiency
      )

      // Defect rate per unit climbs sharply once the line is pushed past 2.0x.
      const defectRate = 0.004 + over * 0.09
      let newDefects = m.defects
      for (let i = 0; i < produced; i++) {
        if (Math.random() < defectRate) newDefects++
      }

      // Trạng thái máy do ĐIỀU KIỆN QUÁ TRÌNH quyết định, không do trạng thái
      // cảnh báo: cảnh báo không phải interlock. Xem ghi chú đầu `infra/mes/
      // line.py`.
      let status = m.status
      if (m.estop || newTemp > limits.critTemp) {
        status = 'error'
      } else if (newTemp > limits.warnTemp || newVib > limits.warnVibration) {
        status = 'warning'
      } else if (
        status === 'warning' &&
        newTemp < limits.warnTemp - STATUS_RECOVER_MARGIN_C &&
        newVib < limits.warnVibration
      ) {
        status = 'running'
      }

      return {
        ...m,
        temperature: newTemp,
        vibration: newVib,
        powerUsage: newPower,
        output: m.output + produced,
        defects: newDefects,
        runTimeMs: m.runTimeMs + TICK_MS,
        status,
        lastUpdated: now,
      }
    })

    // A fresh object each tick: mutating in place would let a memoised chart
    // silently keep rendering stale data.
    const history: Record<string, TelemetryPoint[]> = {}
    this.machines.forEach((m) => {
      const prev = this.telemetryHistory[m.id] ?? []
      history[m.id] = [
        ...prev.slice(-(HISTORY_LENGTH - 1)),
        { t: now, temp: m.temperature, vibration: m.vibration },
      ]
    })
    this.telemetryHistory = history

    this.refreshAlarms(now, true)
    this.notify()
  }

  /**
   * Đặt máy vào một điều kiện hỏng. KHÔNG tự tạo cảnh báo.
   *
   * Cảnh báo do máy trạng thái sinh ra khi nó đọc được số đo mới — nhờ vậy
   * on-delay, deadband và toàn bộ vòng đời đều được đi qua thật sự, chứ không
   * bị một đường tắt bỏ qua.
   */
  public triggerFault(
    machineId: string,
    faultType: 'overheat' | 'vibration' | 'emergency_stop'
  ) {
    const now = Date.now()
    this.machines = this.machines.map((m) => {
      if (m.id !== machineId) return m
      const limits = limitsOf(m.id)

      if (faultType === 'overheat') {
        // Phải VƯỢT ngưỡng tới hạn chứ không bằng nó: `value > setpoint`.
        return {
          ...m,
          temperature: limits.critTemp + 2,
          status: 'error',
          lastUpdated: now,
        }
      }
      if (faultType === 'vibration') {
        return {
          ...m,
          vibration: Number((limits.warnVibration * 1.3).toFixed(2)),
          status: 'error',
          lastUpdated: now,
        }
      }
      return { ...m, estop: true, status: 'error', lastUpdated: now }
    })
    this.refreshAlarms(now, true)
    this.notify()
  }

  /**
   * Sửa máy: đưa điều kiện quá trình về bình thường.
   *
   * CỐ Ý không xác nhận cảnh báo hộ. Sửa xong máy không làm biến mất việc đã có
   * một sự cố xảy ra; cảnh báo chuyển sang RTN_UNACK và vẫn nằm trên màn hình
   * chờ người bấm xác nhận. Đó là toàn bộ lý do trạng thái RTN_UNACK tồn tại.
   */
  public repairMachine(machineId: string) {
    const initial = INITIAL_MACHINES.find((m) => m.id === machineId)
    if (!initial) return

    const now = Date.now()
    this.machines = this.machines.map((m) =>
      m.id === machineId
        ? {
            ...m,
            temperature: initial.temperature,
            vibration: initial.vibration,
            powerUsage: initial.powerUsage,
            estop: false,
            status: 'running',
            lastUpdated: now,
          }
        : m
    )
    this.refreshAlarms(now)
    this.notify()
  }

  public acknowledgeAlarm(tag: string) {
    this.engine.acknowledge(tag, Date.now(), 'hmi')
    this.refreshAlarms(Date.now())
    this.notify()
  }

  public acknowledgeAsset(machineId: string) {
    this.engine.acknowledgeAsset(machineId, Date.now(), 'hmi')
    this.refreshAlarms(Date.now())
    this.notify()
  }

  public acknowledgeAll() {
    this.engine.acknowledgeAll(Date.now(), 'hmi')
    this.refreshAlarms(Date.now())
    this.notify()
  }

  public shelveAlarm(tag: string, seconds: number, reason: string) {
    this.engine.shelve(tag, Date.now(), seconds, reason, 'hmi')
    this.refreshAlarms(Date.now())
    this.notify()
  }

  public unshelveAlarm(tag: string) {
    this.engine.unshelve(tag, Date.now(), 'hmi')
    this.refreshAlarms(Date.now())
    this.notify()
  }

  public setAlarmOutOfService(tag: string, out: boolean) {
    this.engine.setOutOfService(tag, out, Date.now(), 'hmi')
    this.refreshAlarms(Date.now())
    this.notify()
  }

  /**
   * Đưa dây chuyền về trạng thái sạch.
   *
   * KHÔNG xoá trắng cảnh báo. Trước đây `resetAll` gán `alarms = []`, tức là
   * một nút làm biến mất mọi bằng chứng về những gì vừa xảy ra. Ở đây nó đưa
   * điều kiện quá trình về bình thường rồi XÁC NHẬN toàn bộ — cũng dẫn tới một
   * màn hình sạch, nhưng mọi bước đều đi qua máy trạng thái.
   */
  public resetAll() {
    const now = Date.now()
    this.machines = INITIAL_MACHINES.map((m) => ({ ...m, lastUpdated: now }))
    this.lineSpeed = 1.0
    this.feedDensity = 'NORMAL'
    this.refreshAlarms(now)
    this.engine.acknowledgeAll(now, 'hmi')
    this.refreshAlarms(now)
    this.notify()
  }
}

export const sensorSimulator = new SensorSimulator()
