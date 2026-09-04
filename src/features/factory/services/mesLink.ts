/**
 * Nguồn dữ liệu SCADA khi backend MES đang chạy.
 *
 * Cùng hợp đồng external store (`subscribe` / `getSnapshot`) như
 * `sensorSimulator`, nên các component không biết — và không cần biết — dữ liệu
 * đang đến từ đâu. Đây chính là phần thưởng cho việc đợt 1 đã biến simulator
 * thành external store: đổi nguồn dữ liệu là thêm một file, không phải sửa lại
 * từng component.
 *
 * Quyết định: **khi đã cấu hình MES mà mất kết nối thì KHÔNG âm thầm quay về
 * dữ liệu mô phỏng.** Màn hình giữ nguyên số liệu cuối cùng đọc được và bật cờ
 * `status: 'offline'` để giao diện báo rõ. Thay dữ liệu thật đang chết bằng dữ
 * liệu sinh ra tại chỗ là kiểu lỗi tệ nhất một hệ SCADA có thể mắc: người vận
 * hành nhìn thấy dây chuyền vẫn chạy trong khi thực tế không ai biết nó ra sao.
 */
import type {
  AlarmEvent,
  FactoryState,
  FeedDensity,
  Machine,
  OeeMetrics,
  TelemetryPoint,
} from '../types'
import { alarmChime } from './alarmChime'
import { isMesEnabled, mesApi, mesWebSocketUrl } from './mesApi'

export type MesLinkStatus = 'disabled' | 'connecting' | 'online' | 'offline'

/** Số điểm giữ trong RAM cho biểu đồ. Lịch sử dài hơn nằm ở historian. */
const HISTORY_LENGTH = 240
/** Lấy lại bao nhiêu phút lịch sử khi mở trang. */
const BACKFILL_MINUTES = 30

const EMPTY_OEE: OeeMetrics = {
  availability: 0,
  performance: 0,
  quality: 0,
  overall: 0,
}

interface LinkMeta {
  status: MesLinkStatus
  /** Đồng hồ của server lúc gói tin được phát — không phải đồng hồ trình duyệt. */
  serverTime: number
  error: string | null
  /** Lịch sử đã được nạp lại từ historian hay chưa. */
  backfilled: boolean
}

interface WirePayload {
  type?: string
  machines?: Machine[]
  alarms?: AlarmEvent[]
  oee?: OeeMetrics
  lineSpeed?: number
  feedDensity?: FeedDensity
  serverTime?: number
}

type Listener = () => void

/**
 * Export cả lớp chứ không chỉ instance dùng chung: mỗi test dựng một instance
 * mới thì trạng thái của test trước (lịch sử biểu đồ, socket đang mở) không rò
 * sang test sau. Ứng dụng chỉ dùng `mesLink` bên dưới.
 */
export class MesLink {
  private state: FactoryState = {
    machines: [],
    telemetryHistory: {},
    alarms: [],
    oee: EMPTY_OEE,
    lineSpeed: 1.0,
    feedDensity: 'NORMAL',
  }
  private meta: LinkMeta = {
    status: isMesEnabled() ? 'connecting' : 'disabled',
    serverTime: 0,
    error: null,
    backfilled: false,
  }
  private readonly listeners = new Set<Listener>()
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectDelay = 1000
  private knownAlarmIds = new Set<string>()

  public readonly enabled = isMesEnabled()

  public subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.connect()

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.disconnect()
    }
  }

  public getSnapshot = (): FactoryState => this.state
  public getMeta = (): LinkMeta => this.meta

  private emit() {
    this.listeners.forEach((l) => l())
  }

  private setMeta(patch: Partial<LinkMeta>) {
    this.meta = { ...this.meta, ...patch }
    this.emit()
  }

  // ------------------------------------------------------------------ socket

  private connect() {
    if (!this.enabled || this.socket) return
    this.setMeta({ status: 'connecting' })

    let socket: WebSocket
    try {
      socket = new WebSocket(mesWebSocketUrl())
    } catch (error) {
      this.setMeta({ status: 'offline', error: String(error) })
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.reconnectDelay = 1000
      this.setMeta({ status: 'online', error: null })
      void this.backfill()
    }

    socket.onmessage = (event) => {
      try {
        this.apply(JSON.parse(event.data as string) as WirePayload)
      } catch {
        // Gói tin hỏng thì bỏ qua; gói kế tiếp là một ảnh chụp đầy đủ nên
        // trạng thái tự đồng bộ lại.
      }
    }

    socket.onerror = () => this.setMeta({ status: 'offline' })

    socket.onclose = () => {
      this.socket = null
      // Giữ nguyên số liệu cuối cùng, chỉ đổi cờ trạng thái: xoá trắng màn hình
      // hay thay bằng số mô phỏng đều tệ hơn là nói thẳng "đang mất kết nối".
      this.setMeta({ status: 'offline' })
      if (this.listeners.size > 0) this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000)
  }

  private disconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      this.socket.onclose = null
      this.socket.close()
      this.socket = null
    }
    alarmChime.close()
    this.setMeta({ status: this.enabled ? 'connecting' : 'disabled' })
  }

  // ------------------------------------------------------------------ dữ liệu

  /**
   * Nạp lại lịch sử từ historian khi vừa kết nối.
   *
   * Đây là điểm khác biệt cụ thể nhất so với bản chỉ chạy trong trình duyệt:
   * F5 không còn xoá sạch biểu đồ, vì 30 phút vừa qua nằm trong TimescaleDB
   * chứ không nằm trong RAM của tab vừa bị đóng.
   */
  private async backfill() {
    try {
      const history = await mesApi.history(BACKFILL_MINUTES)
      const seeded: Record<string, TelemetryPoint[]> = {}
      for (const [assetCode, points] of Object.entries(history.series)) {
        seeded[assetCode] = points.slice(-HISTORY_LENGTH)
      }
      // Ghép vào phía trước những điểm đã nhận qua socket trong lúc chờ.
      const merged: Record<string, TelemetryPoint[]> = { ...seeded }
      for (const [assetCode, live] of Object.entries(
        this.state.telemetryHistory
      )) {
        const backfilled = seeded[assetCode] ?? []
        const cutoff = backfilled[backfilled.length - 1]?.t ?? 0
        merged[assetCode] = [
          ...backfilled,
          ...live.filter((p) => p.t > cutoff),
        ].slice(-HISTORY_LENGTH)
      }
      this.state = { ...this.state, telemetryHistory: merged }
      this.setMeta({ backfilled: true })
    } catch {
      // Không lấy được lịch sử thì biểu đồ bắt đầu từ điểm hiện tại — vẫn dùng
      // được, chỉ là ngắn hơn.
      this.setMeta({ backfilled: false })
    }
  }

  private apply(payload: WirePayload) {
    if (!Array.isArray(payload.machines)) return

    const machines = payload.machines
    const alarms = payload.alarms ?? []
    const now = payload.serverTime ?? Date.now()

    // Cảnh báo mới thì bíp một tiếng — nhưng chỉ khi đã có ảnh chụp đầu tiên,
    // nếu không mỗi lần mở tab sẽ bíp cho cả 15 cảnh báo cũ.
    const seenBefore = this.meta.serverTime > 0
    for (const alarm of alarms) {
      if (!this.knownAlarmIds.has(alarm.id)) {
        this.knownAlarmIds.add(alarm.id)
        if (seenBefore && !alarm.acknowledged) alarmChime.beep()
      }
    }
    // Không để tập id phình mãi: giữ đúng những cảnh báo còn trên bảng.
    if (this.knownAlarmIds.size > alarms.length * 4 + 32) {
      this.knownAlarmIds = new Set(alarms.map((a) => a.id))
    }

    const history: Record<string, TelemetryPoint[]> = {}
    for (const m of machines) {
      const previous = this.state.telemetryHistory[m.id] ?? []
      const last = previous[previous.length - 1]
      // Bỏ qua gói tin phát lại cùng một mốc thời gian (ví dụ khi bấm nút, MES
      // phát ngay chứ không đợi tick) — nếu không biểu đồ sẽ có hai điểm chồng
      // nhau tại một thời điểm.
      history[m.id] =
        last && last.t === now
          ? previous
          : [
              ...previous.slice(-(HISTORY_LENGTH - 1)),
              { t: now, temp: m.temperature, vibration: m.vibration },
            ]
    }

    this.state = {
      machines,
      telemetryHistory: history,
      alarms,
      oee: payload.oee ?? this.state.oee,
      lineSpeed: payload.lineSpeed ?? this.state.lineSpeed,
      feedDensity: payload.feedDensity ?? this.state.feedDensity,
    }
    this.setMeta({ status: 'online', serverTime: now, error: null })
  }

  // ------------------------------------------------------------------- lệnh

  /**
   * Lệnh gửi qua chính WebSocket chứ không dùng fetch: WebSocket không bị CORS
   * chặn, và lệnh đi cùng đường với dữ liệu nên không có chuyện lệnh tới nơi
   * mà kết nối dữ liệu đã chết.
   */
  private send(message: Record<string, unknown>): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  public setLineSpeed = (value: number) =>
    this.send({ cmd: 'setLineSpeed', value })
  public setFeedDensity = (value: FeedDensity) =>
    this.send({ cmd: 'setFeedDensity', value })
  public triggerFault = (machineId: string, fault: string) =>
    this.send({ cmd: 'triggerFault', machineId, fault })
  public repairMachine = (machineId: string) =>
    this.send({ cmd: 'repair', machineId })
  public acknowledgeAlarm = (alarmId: string) =>
    this.send({ cmd: 'acknowledge', alarmId })
  public resetAll = () => this.send({ cmd: 'reset' })
}

export const mesLink = new MesLink()
