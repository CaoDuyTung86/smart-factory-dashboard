/**
 * Cầu nối tới edge gateway (infra/gateway) — nơi đọc PLC thật qua Modbus TCP.
 *
 * Bật bằng biến môi trường:
 *   VITE_PLC_GATEWAY_URL=http://localhost:8000
 *
 * Không đặt biến này thì mọi thứ tắt hoàn toàn: tab PLC chạy logic mô phỏng
 * cục bộ y như trước, không có socket nào được mở. Nhờ vậy dashboard vẫn deploy
 * lên Netlify/Vercel bình thường mà không cần hạ tầng đi kèm.
 *
 * Lệnh gửi qua chính WebSocket chứ không dùng fetch: WebSocket không bị chặn
 * bởi CORS, nên frontend ở cổng 3000 nói chuyện với gateway ở cổng 8000 được
 * ngay mà không cần cấu hình gì thêm.
 */

export type PlcLinkStatus = 'disabled' | 'connecting' | 'online' | 'offline'

export type PlcCommand = 'start' | 'stop' | 'estop' | 'door_open'

export interface PlcOutputs {
  conveyor: boolean
  red_tower: boolean
  green_tower: boolean
}

export interface PlcCommands {
  start: boolean
  stop: boolean
  estop: boolean
  door_open: boolean
}

export interface PlcLinkState {
  /** Đã cấu hình VITE_PLC_GATEWAY_URL hay chưa. */
  enabled: boolean
  /** Trạng thái socket giữa trình duyệt và gateway. */
  status: PlcLinkStatus
  /** Gateway có nối được tới PLC hay không (gateway sống ≠ PLC sống). */
  plcConnected: boolean
  outputs: PlcOutputs
  commands: PlcCommands
  partCount: number
  scanMs: number
  updatedAt: number
  error: string | null
}

const GATEWAY_URL = (import.meta.env.VITE_PLC_GATEWAY_URL ?? '').trim()

const IDLE_STATE: PlcLinkState = {
  enabled: GATEWAY_URL !== '',
  status: GATEWAY_URL === '' ? 'disabled' : 'connecting',
  plcConnected: false,
  outputs: { conveyor: false, red_tower: false, green_tower: false },
  commands: { start: false, stop: false, estop: false, door_open: false },
  partCount: 0,
  scanMs: 0,
  updatedAt: 0,
  error: null,
}

function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = url.pathname.replace(/\/$/, '') + '/ws'
  return url.toString()
}

class PlcGatewayLink {
  private state: PlcLinkState = IDLE_STATE
  private readonly listeners = new Set<() => void>()
  private socket: WebSocket | null = null
  private reconnectTimer: number | null = null
  private reconnectDelay = 1000

  public subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.connect()

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.disconnect()
    }
  }

  public getSnapshot = (): PlcLinkState => this.state

  private setState(patch: Partial<PlcLinkState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
  }

  private connect() {
    if (!this.state.enabled || this.socket) return

    this.setState({ status: 'connecting' })
    let socket: WebSocket
    try {
      socket = new WebSocket(toWebSocketUrl(GATEWAY_URL))
    } catch (error) {
      this.setState({ status: 'offline', error: String(error) })
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.reconnectDelay = 1000
      this.setState({ status: 'online', error: null })
    }

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string)
        this.setState({
          status: 'online',
          plcConnected: Boolean(payload.connected),
          outputs: payload.outputs ?? this.state.outputs,
          commands: payload.commands ?? this.state.commands,
          partCount: Number(payload.partCount ?? 0),
          scanMs: Number(payload.scanMs ?? 0),
          updatedAt: Number(payload.updatedAt ?? Date.now()),
          error: payload.error ?? null,
        })
      } catch {
        // Gói tin hỏng thì bỏ qua, gói kế tiếp sẽ đồng bộ lại trạng thái.
      }
    }

    socket.onerror = () => this.setState({ status: 'offline' })

    socket.onclose = () => {
      this.socket = null
      this.setState({ status: 'offline', plcConnected: false })
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
    this.setState({ status: this.state.enabled ? 'connecting' : 'disabled' })
  }

  /**
   * Gửi lệnh xuống PLC. Nút nhấn nhả (start/stop) được gateway tự nhả ra sau
   * một xung ngắn, đúng như bấm rồi buông tay trên tủ điện thật.
   */
  public sendCommand(name: PlcCommand, value = true): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify({ name, value }))
    return true
  }
}

export const plcGateway = new PlcGatewayLink()
