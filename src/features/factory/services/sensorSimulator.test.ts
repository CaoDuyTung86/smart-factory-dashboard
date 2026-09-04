import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SensorSimulator } from './sensorSimulator'

/** The simulator ticks on this period; the tests advance time in whole ticks. */
const TICK_MS = 1500

/**
 * Every test drives its OWN simulator instance: the alarm state machine keeps
 * timers (on-delay, off-delay, shelve expiry) that would otherwise leak across
 * test boundaries. `subscribe` returning an unsubscribe that stops the clock is
 * itself part of the contract, so each test subscribes and detaches.
 */
let sim: SensorSimulator

function attach() {
  return sim.subscribe(() => {})
}

function ticks(n: number) {
  vi.advanceTimersByTime(n * TICK_MS)
}

function machine(id: string) {
  const m = sim.getSnapshot().machines.find((x) => x.id === id)
  if (!m) throw new Error('unknown machine ' + id)
  return m
}

beforeEach(() => {
  vi.useFakeTimers()
  sim = new SensorSimulator()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('external-store contract', () => {
  it('only runs the clock while something is subscribed', () => {
    const before = machine('SMT-LINE-01').output

    // Nothing subscribed: the timer must not exist at all.
    ticks(10)
    expect(machine('SMT-LINE-01').output).toBe(before)

    const detach = attach()
    ticks(10)
    const whileSubscribed = machine('SMT-LINE-01').output
    expect(whileSubscribed).toBeGreaterThan(before)

    detach()
    ticks(10)
    expect(machine('SMT-LINE-01').output).toBe(whileSubscribed)
  })

  it('notifies subscribers once per tick', () => {
    const listener = vi.fn()
    const detach = sim.subscribe(listener)

    ticks(3)
    detach()

    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('hands out a new snapshot object per tick so React sees the change', () => {
    const detach = attach()
    const first = sim.getSnapshot()

    ticks(1)
    const second = sim.getSnapshot()
    detach()

    expect(second).not.toBe(first)
    expect(second.machines).not.toBe(first.machines)
  })

  it('replaces telemetry history instead of mutating it in place', () => {
    // Mutating the array would let a memoised chart keep rendering stale data
    // while its props compare equal — the bug this guards against.
    const detach = attach()
    const before = sim.getSnapshot().telemetryHistory['SMT-LINE-01']

    ticks(1)
    const after = sim.getSnapshot().telemetryHistory['SMT-LINE-01']
    detach()

    expect(after).not.toBe(before)
    expect(after[after.length - 1].t).toBeGreaterThan(
      before[before.length - 1].t
    )
  })

  it('caps the rolling window instead of growing forever', () => {
    const detach = attach()

    ticks(80)
    const history = sim.getSnapshot().telemetryHistory['SMT-LINE-01']
    detach()

    expect(history).toHaveLength(40)
  })
})

describe('OEE time accounting', () => {
  it('charges a stopped machine to down time, never to run time', () => {
    const detach = attach()
    sim.triggerFault('SMT-LINE-01', 'emergency_stop')

    const stopped = machine('SMT-LINE-01')
    ticks(20)
    const after = machine('SMT-LINE-01')
    detach()

    expect(after.status).toBe('error')
    expect(after.downTimeMs).toBe(stopped.downTimeMs + 20 * TICK_MS)
    expect(after.runTimeMs).toBe(stopped.runTimeMs)
  })

  it('keeps a stopped machine inside planned production time', () => {
    // Planned time keeps ticking for a broken machine — that is the whole
    // reason a stoppage shows up as an availability loss rather than vanishing.
    const detach = attach()
    sim.triggerFault('SMT-LINE-01', 'emergency_stop')

    const before = machine('SMT-LINE-01')
    ticks(20)
    const after = machine('SMT-LINE-01')
    detach()

    expect(after.runTimeMs + after.downTimeMs).toBe(
      before.runTimeMs + before.downTimeMs + 20 * TICK_MS
    )
  })

  it('pulls line availability down while a machine is stopped', () => {
    const detach = attach()
    const before = sim.getSnapshot().oee.availability

    sim.triggerFault('SMT-LINE-01', 'emergency_stop')
    ticks(400) // ~10 minutes of shift time
    const during = sim.getSnapshot().oee.availability
    detach()

    expect(during).toBeLessThan(before)
  })

  it('charges a producing machine to run time', () => {
    const detach = attach()
    const before = machine('CNC-MILL-03')

    ticks(10)
    const after = machine('CNC-MILL-03')
    detach()

    expect(after.runTimeMs).toBe(before.runTimeMs + 10 * TICK_MS)
    expect(after.downTimeMs).toBe(before.downTimeMs)
  })

  it('still counts a warning state as producing', () => {
    // A machine running hot is degraded, not stopped: it keeps making units,
    // so it belongs in run time and shows up as a performance/quality loss.
    //
    // Đẩy lên 3.0x không lập tức thành 'warning': tốc độ cao làm máy NÓNG DẦN,
    // và chỉ khi nhiệt độ thật sự vượt ngưỡng của máy đó thì trạng thái mới
    // đổi. Đây là khác biệt so với bản cũ, vốn gán thẳng 'warning' khi tốc độ
    // qua 2.5x — tức là báo lại cho người vận hành điều họ vừa tự tay làm.
    const detach = attach()
    sim.setLineSpeed(3.0)
    ticks(15)

    const before = machine('SMT-LINE-01')
    ticks(5)
    const after = machine('SMT-LINE-01')
    detach()

    expect(after.status).toBe('warning')
    expect(after.runTimeMs).toBe(before.runTimeMs + 5 * TICK_MS)
    expect(after.output).toBeGreaterThan(before.output)
  })

  it('keeps the reported OEE the product of its three factors', () => {
    const detach = attach()
    ticks(50)
    const { availability, performance, quality, overall } =
      sim.getSnapshot().oee
    detach()

    expect(overall).toBeCloseTo(
      (availability * performance * quality) / 10000,
      1
    )
  })
})

describe('line speed', () => {
  it('clamps to the 0.5x-3.0x range the HMI slider offers', () => {
    sim.setLineSpeed(9)
    expect(sim.getSnapshot().lineSpeed).toBe(3.0)

    sim.setLineSpeed(0.1)
    expect(sim.getSnapshot().lineSpeed).toBe(0.5)
  })

  it('produces more units per tick when the line runs faster', () => {
    const detach = attach()

    sim.setLineSpeed(0.5)
    const slowStart = machine('CNC-MILL-03').output
    ticks(20)
    const slow = machine('CNC-MILL-03').output - slowStart

    sim.setLineSpeed(2.0)
    const fastStart = machine('CNC-MILL-03').output
    ticks(20)
    const fast = machine('CNC-MILL-03').output - fastStart
    detach()

    expect(fast).toBeGreaterThan(slow)
  })

  it('costs quality once the line is pushed past 2.0x', () => {
    const detach = attach()
    sim.setLineSpeed(3.0)

    const before = machine('CNC-MILL-03').defects
    ticks(60)
    const after = machine('CNC-MILL-03').defects
    detach()

    expect(after).toBeGreaterThan(before)
  })
})

describe('faults and alarms', () => {
  /**
   * Sự cố bây giờ đi qua máy trạng thái ISA-18.2 thật, nên độ trễ on-delay là
   * một phần của hợp đồng chứ không phải một chi tiết cài đặt: E-Stop kêu ngay,
   * nhiệt độ tới hạn chờ 2 giây, độ rung chờ 10 giây.
   */
  it('dừng máy ngay và kêu cảnh báo E-Stop không có độ trễ', () => {
    sim.triggerFault('CNC-MILL-03', 'emergency_stop')
    const { alarms } = sim.getSnapshot()

    expect(machine('CNC-MILL-03').status).toBe('error')
    expect(machine('CNC-MILL-03').estop).toBe(true)
    expect(alarms[0].tag).toBe('CNC-MILL-03.ESTOP')
    expect(alarms[0].priority).toBe('URGENT')
    expect(alarms[0].alarmClass).toBe('SAFETY')
    expect(alarms[0].state).toBe('UNACK_ALM')
  })

  it.each([
    ['overheat', 'CNC-MILL-03.TEMP.HIHI', 2],
    ['vibration', 'CNC-MILL-03.VIB.HI', 8],
  ] as const)(
    'chờ hết on-delay rồi mới kêu với sự cố %s',
    (fault, tag, ticksNeeded) => {
      const detach = attach()
      sim.triggerFault('CNC-MILL-03', fault)

      // Máy dừng ngay — trạng thái máy do điều kiện quá trình quyết định, độc
      // lập với việc cảnh báo đã kêu hay chưa.
      expect(machine('CNC-MILL-03').status).toBe('error')
      expect(sim.getSnapshot().alarms).toHaveLength(0)

      ticks(ticksNeeded)
      detach()

      const alarm = sim.getSnapshot().alarms.find((a) => a.tag === tag)
      expect(alarm?.state).toBe('UNACK_ALM')
    }
  )

  it('một sự cố đang kêu không sinh thêm dòng mới ở mỗi tick', () => {
    // Đây là cách một danh sách cảnh báo thật trở nên không đọc được, và là lý
    // do người vận hành thôi nhìn nó.
    const detach = attach()
    sim.triggerFault('CNC-MILL-03', 'emergency_stop')
    ticks(30)
    detach()

    const estop = sim
      .getSnapshot()
      .alarms.filter((a) => a.tag === 'CNC-MILL-03.ESTOP')
    expect(estop).toHaveLength(1)
  })

  it('xác nhận thì đổi trạng thái chứ không xoá khỏi màn hình', () => {
    sim.triggerFault('CNC-MILL-03', 'emergency_stop')
    sim.acknowledgeAlarm('CNC-MILL-03.ESTOP')

    const alarms = sim.getSnapshot().alarms
    expect(alarms).toHaveLength(1)
    expect(alarms[0].state).toBe('ACKED_ALM')
  })

  it('sửa máy không tự ý xác nhận hộ cảnh báo', () => {
    // Sửa máy là hành động vật lý; xác nhận là hành động của người vận hành.
    // Gộp hai việc làm một thì RTN_UNACK không còn lý do tồn tại.
    const baseline = machine('CNC-MILL-03')

    sim.triggerFault('CNC-MILL-03', 'emergency_stop')
    sim.repairMachine('CNC-MILL-03')
    const repaired = machine('CNC-MILL-03')

    expect(repaired.status).toBe('running')
    expect(repaired.temperature).toBe(baseline.temperature)
    expect(repaired.estop).toBe(false)

    const alarms = sim.getSnapshot().alarms
    expect(alarms).toHaveLength(1)
    expect(alarms[0].state).toBe('RTN_UNACK')

    // Xác nhận rồi thì mới rời khỏi màn hình.
    sim.acknowledgeAlarm('CNC-MILL-03.ESTOP')
    expect(sim.getSnapshot().alarms).toHaveLength(0)
  })

  it('shelve gỡ khỏi màn hình chính nhưng vẫn nằm ở danh sách bị tắt', () => {
    sim.triggerFault('CNC-MILL-03', 'emergency_stop')
    sim.shelveAlarm('CNC-MILL-03.ESTOP', 120, 'đang thay nút E-Stop')

    const state = sim.getSnapshot()
    expect(state.alarms).toHaveLength(0)
    expect(state.inhibitedAlarms).toHaveLength(1)
    expect(state.inhibitedAlarms[0].shelveReason).toBe('đang thay nút E-Stop')
    expect(state.alarmCounts.SHELVED).toBe(1)
  })

  it('hạn shelve bị kẹp bởi cấu hình: cảnh báo an toàn tối đa 5 phút', () => {
    const detach = attach()
    sim.triggerFault('CNC-MILL-03', 'emergency_stop')
    sim.shelveAlarm('CNC-MILL-03.ESTOP', 8 * 3600, 'xin tắt cả ca')

    const shelved = sim.getSnapshot().inhibitedAlarms[0]
    expect(shelved.shelvedUntil! - Date.now()).toBe(300_000)

    // Hết hạn thì tự kêu lại, vì điều kiện vẫn còn xấu.
    ticks(300_000 / TICK_MS + 1)
    detach()
    expect(sim.getSnapshot().alarms[0].state).toBe('UNACK_ALM')
  })

  it('bật lại thủ công thì cảnh báo kêu lại và lại là chưa xác nhận', () => {
    sim.triggerFault('CNC-MILL-03', 'emergency_stop')
    sim.acknowledgeAlarm('CNC-MILL-03.ESTOP')
    sim.shelveAlarm('CNC-MILL-03.ESTOP', 600, 'tạm')
    sim.unshelveAlarm('CNC-MILL-03.ESTOP')

    expect(sim.getSnapshot().alarms[0].state).toBe('UNACK_ALM')
  })

  it('không mất down time đã tích luỹ khi sửa máy', () => {
    // Sửa máy chữa cái máy, không chữa được ca: lần dừng đã xảy ra rồi và phải
    // tiếp tục tính vào availability.
    const detach = attach()
    sim.triggerFault('CNC-MILL-03', 'overheat')
    ticks(20)
    const stoppedFor = machine('CNC-MILL-03').downTimeMs

    sim.repairMachine('CNC-MILL-03')
    detach()

    expect(machine('CNC-MILL-03').downTimeMs).toBe(stoppedFor)
  })

  it('bỏ qua sự cố hoặc lệnh sửa nhắm vào một máy không tồn tại', () => {
    const before = sim.getSnapshot().machines
    sim.triggerFault('nope', 'overheat')
    sim.repairMachine('nope')

    expect(sim.getSnapshot().alarms).toHaveLength(0)
    expect(sim.getSnapshot().machines).toHaveLength(before.length)
  })
})

describe('resetAll', () => {
  it('đưa dây chuyền về trạng thái sạch mà không xoá trắng cảnh báo', () => {
    // Trước đây nút này gán `alarms = []` — một nút làm biến mất mọi bằng chứng
    // về những gì vừa xảy ra. Bây giờ nó đưa điều kiện về bình thường rồi XÁC
    // NHẬN, tức là mọi bước đều đi qua máy trạng thái.
    const detach = attach()
    sim.setLineSpeed(2.5)
    sim.triggerFault('SMT-LINE-01', 'emergency_stop')
    ticks(5)

    sim.resetAll()
    detach()

    const state = sim.getSnapshot()
    expect(state.lineSpeed).toBe(1.0)
    expect(state.feedDensity).toBe('NORMAL')
    expect(state.machines.every((m) => m.status === 'running')).toBe(true)
    expect(state.machines.every((m) => m.estop === false)).toBe(true)
    // Không còn gì chưa xác nhận, và cũng không còn gì đang kêu.
    expect(state.alarms.filter((a) => a.state === 'UNACK_ALM')).toHaveLength(0)
  })
})
