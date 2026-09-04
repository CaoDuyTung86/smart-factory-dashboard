import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Kiểm thử store WebSocket bằng một WebSocket giả.
 *
 * Không dựng server thật: thứ đáng kiểm ở đây là *chính sách* — mất kết nối thì
 * làm gì, gói tin trùng mốc thời gian thì làm gì — chứ không phải giao thức
 * WebSocket của trình duyệt.
 */

const BASE = 'http://mes.test:8002'

class FakeSocket {
  static last: FakeSocket | null = null
  static readonly OPEN = 1

  public readyState = 0
  public sent: string[] = []
  public onopen: (() => void) | null = null
  public onmessage: ((e: { data: string }) => void) | null = null
  public onerror: (() => void) | null = null
  public onclose: (() => void) | null = null

  constructor(public url: string) {
    FakeSocket.last = this
  }

  open() {
    this.readyState = 1
    this.onopen?.()
  }

  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  drop() {
    this.readyState = 3
    this.onclose?.()
  }

  send(text: string) {
    this.sent.push(text)
  }

  close() {
    this.readyState = 3
  }
}

function machinePayload(temperature: number, serverTime: number) {
  return {
    type: 'update',
    serverTime,
    lineSpeed: 1,
    feedDensity: 'NORMAL',
    oee: { availability: 90, performance: 80, quality: 99, overall: 71.3 },
    alarms: [],
    machines: [
      {
        id: 'SMT-LINE-01',
        name: 'SMT Pick & Place',
        code: 'SMT-LINE-01',
        category: 'Assembly',
        status: 'running',
        temperature,
        vibration: 1.2,
        output: 100,
        defects: 1,
        powerUsage: 18.5,
        targetOutput: 15000,
        idealCycleSec: 0.4,
        runTimeMs: 1000,
        downTimeMs: 0,
        lastUpdated: serverTime,
        countSource: 'model',
      },
    ],
  }
}

/**
 * Mỗi test một instance mới: `mesLink` dùng trong ứng dụng là singleton, nên
 * dùng chung nó trong test sẽ để lịch sử biểu đồ và socket của test trước rò
 * sang test sau.
 */
async function newLink() {
  const { MesLink } = await import('./mesLink')
  return new MesLink()
}

let detach: (() => void) | null = null

/** Đăng ký rồi mở socket — bước mở đầu của mọi test bên dưới. */
async function connected() {
  const link = await newLink()
  detach = link.subscribe(() => {})
  FakeSocket.last?.open()
  return link
}

beforeEach(() => {
  FakeSocket.last = null
  vi.stubEnv('VITE_MES_API_URL', BASE)
  vi.stubGlobal('WebSocket', FakeSocket)
  // Lịch sử nạp lại từ historian không phải thứ đang kiểm ở đây; cho nó hỏng
  // để chắc chắn store vẫn chạy được khi historian không trả lời.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('historian offline'))
  )
})

afterEach(() => {
  // Gỡ đăng ký kể cả khi assertion ném lỗi giữa chừng, nếu không socket của
  // test hỏng sẽ còn nguyên khi test sau chạy.
  detach?.()
  detach = null
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('mesLink', () => {
  it('mở socket khi có người đăng ký và đóng khi không còn ai', async () => {
    const link = await newLink()
    detach = link.subscribe(() => {})

    expect(FakeSocket.last?.url).toBe('ws://mes.test:8002/ws')
    expect(link.getMeta().status).toBe('connecting')

    FakeSocket.last?.open()
    expect(link.getMeta().status).toBe('online')

    detach()
    detach = null
    expect(link.getMeta().status).toBe('connecting')
  })

  it('nhận gói tin thì cập nhật máy, OEE và lịch sử biểu đồ', async () => {
    const link = await connected()

    FakeSocket.last?.receive(machinePayload(52.4, 1_000_000))

    const state = link.getSnapshot()
    expect(state.machines[0].temperature).toBe(52.4)
    expect(state.oee.overall).toBe(71.3)
    expect(state.telemetryHistory['SMT-LINE-01']).toEqual([
      { t: 1_000_000, temp: 52.4, vibration: 1.2 },
    ])
  })

  it('mất kết nối thì GIỮ số cuối cùng và báo offline, không đổi sang số mô phỏng', async () => {
    const link = await connected()
    FakeSocket.last?.receive(machinePayload(61.5, 1_000_000))

    FakeSocket.last?.drop()

    // Đây là quyết định quan trọng nhất của file này: thay số liệu thật đang
    // chết bằng số sinh tại chỗ là kiểu lỗi tệ nhất một hệ SCADA mắc phải —
    // người vận hành thấy dây chuyền vẫn chạy trong khi không ai biết nó ra sao.
    expect(link.getMeta().status).toBe('offline')
    expect(link.getSnapshot().machines[0].temperature).toBe(61.5)
  })

  it('gói tin trùng mốc thời gian không tạo hai điểm chồng nhau trên biểu đồ', async () => {
    const link = await connected()

    // Bấm nút thì MES phát ngay chứ không đợi tick kế tiếp, nên cùng một mốc
    // thời gian có thể tới hai lần.
    FakeSocket.last?.receive(machinePayload(52.4, 2_000_000))
    FakeSocket.last?.receive(machinePayload(53.9, 2_000_000))
    FakeSocket.last?.receive(machinePayload(54.1, 2_001_500))

    const points = link.getSnapshot().telemetryHistory['SMT-LINE-01']
    expect(points.map((p) => p.t)).toEqual([2_000_000, 2_001_500])
  })

  it('bỏ qua gói tin hỏng thay vì làm chết store', async () => {
    const link = await connected()
    FakeSocket.last?.receive(machinePayload(52.4, 3_000_000))

    FakeSocket.last?.onmessage?.({ data: 'không phải JSON' })

    expect(link.getSnapshot().machines[0].temperature).toBe(52.4)
    expect(link.getMeta().status).toBe('online')
  })

  it('gửi lệnh qua chính socket đó chứ không mở một request riêng', async () => {
    const link = await connected()

    link.setLineSpeed(2.4)
    link.triggerFault('CNC-MILL-03', 'vibration')

    // WebSocket không bị CORS chặn, và lệnh đi cùng đường với dữ liệu nên
    // không có chuyện lệnh tới nơi trong khi kết nối dữ liệu đã chết.
    expect(FakeSocket.last?.sent.map((s) => JSON.parse(s))).toEqual([
      { cmd: 'setLineSpeed', value: 2.4 },
      { cmd: 'triggerFault', machineId: 'CNC-MILL-03', fault: 'vibration' },
    ])
  })

  it('socket chưa mở thì lệnh báo thất bại thay vì im lặng biến mất', async () => {
    const link = await newLink()
    detach = link.subscribe(() => {})

    expect(link.resetAll()).toBe(false)
  })
})
