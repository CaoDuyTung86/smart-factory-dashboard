/**
 * Cầu nối tới backend MES (infra/mes) — FastAPI + TimescaleDB.
 *
 * Bật bằng biến môi trường:
 *   VITE_MES_API_URL=http://localhost:8002
 *
 * Không đặt biến này thì mọi thứ tắt hoàn toàn: tab SCADA chạy simulator trong
 * trình duyệt như trước, tab MES hiển thị dữ liệu mẫu, và không có request nào
 * được gửi đi. Cùng một cách xuống thang với `plcGateway` và `visionService`,
 * để dashboard vẫn deploy được lên Netlify/Vercel mà không cần hạ tầng.
 */

/**
 * Đọc cấu hình mỗi lần gọi chứ không chốt thành hằng số lúc import. Trong
 * browser mode của Vitest, `vi.resetModules()` không làm module chạy lại, nên
 * một hằng số ở tầng module thì không cách nào test được nhánh "chưa cấu hình"
 * — mà đó lại là nhánh cần được kiểm chứng nhất.
 */
function apiBase(): string {
  return (import.meta.env.VITE_MES_API_URL ?? '').trim().replace(/\/+$/, '')
}

export function isMesEnabled(): boolean {
  return apiBase() !== ''
}

export function mesWebSocketUrl(): string {
  const url = new URL(apiBase())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = url.pathname.replace(/\/$/, '') + '/ws'
  return url.toString()
}

const TIMEOUT_MS = 10_000

/** Serial không tìm thấy là một câu trả lời, không phải một sự cố mạng. */
export class MesNotFoundError extends Error {}

async function request<T>(path: string): Promise<T> {
  const base = apiBase()
  if (!base) throw new Error('Chưa cấu hình VITE_MES_API_URL')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(base + path, { signal: controller.signal })
    if (response.status === 404) {
      const body = (await response.json().catch(() => null)) as {
        detail?: string
      } | null
      throw new MesNotFoundError(body?.detail ?? 'Không tìm thấy')
    }
    if (!response.ok) {
      throw new Error('MES trả về ' + response.status)
    }
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------- kiểu dữ liệu

export interface MesHealth {
  mes: string
  dbConnected: boolean
  plcConnected: boolean
  plcPartCount: number | null
  ticks: number
  subscribers: number
  historian: {
    queued: number
    written: number
    dropped: number
    lastError: string | null
  } | null
}

export interface WorkOrder {
  wo_number: string
  product_sku: string
  product_name: string
  revision: string
  qty_planned: number
  qty_completed: number
  qty_scrapped: number
  status: 'PLANNED' | 'RELEASED' | 'RUNNING' | 'HELD' | 'CLOSED'
  planned_start: string
  planned_end: string
  actual_start: string | null
  actual_end: string | null
  /** Tính trên số đã ra khỏi dây chuyền, không phải trên qty_planned. */
  yield_pct: number | null
}

export interface BomItem {
  ref_des: string
  part_number: string
  description: string
  qty: number
  uom: string
}

export interface RoutingStep {
  seq: number
  station_name: string
  asset_code: string
  description: string | null
  std_cycle_sec: number
}

export interface UnitStep {
  seq: number
  attempt: number
  station_name: string
  asset_code: string
  operator: string
  started_at: string
  finished_at: string | null
  result: 'PASS' | 'WARNING' | 'FAIL'
  measurements: Record<string, number | string>
  details: string | null
}

export interface UnitMaterial {
  ref_des: string
  part_number: string
  lot_code: string
  qty: number
  consumed_at: string
  supplier: string
  lot_status: 'RELEASED' | 'QUARANTINED' | 'CONSUMED'
  received_at: string
}

export interface UnitDefect {
  ref_des: string | null
  code: string
  description: string
  detected_at: string
}

export interface UnitRecord {
  serial_number: string
  wo_number: string
  product_sku: string
  product_name: string
  revision: string
  started_at: string
  completed_at: string | null
  status: 'WIP' | 'PASS' | 'FAIL' | 'SCRAP' | 'REWORK'
  steps: UnitStep[]
  materials: UnitMaterial[]
  defects: UnitDefect[]
  /**
   * Lô vật tư đang bị cách ly mà bo mạch này đã ăn. Trả lời độc lập với kết
   * quả kiểm tra: một bo mạch PASS hết mọi trạm vẫn có thể nằm trong diện thu
   * hồi, và đó chính là lý do genealogy tồn tại.
   */
  quarantinedLots: string[]
}

export interface LotImpact {
  lot: {
    lot_code: string
    part_number: string
    supplier: string
    received_at: string
    qty_received: number
    expires_at: string | null
    status: 'RELEASED' | 'QUARANTINED' | 'CONSUMED'
  }
  summary: {
    units_affected: number
    units_passed: number
    units_failed: number
    units_wip: number
    work_orders: number
    first_consumed_at: string | null
    last_consumed_at: string | null
  }
  units: Array<{
    serial_number: string
    wo_number: string
    status: string
    ref_des: string
    consumed_at: string
  }>
  truncated: boolean
}

export interface TelemetryHistory {
  /** 'raw' | '1m' | '1h' — backend tự chọn theo độ dài khoảng thời gian. */
  resolution: string
  queryMs: number
  series: Record<string, Array<{ t: number; temp: number; vibration: number }>>
}

// ------------------------------------------------------------------- endpoints

export const mesApi = {
  health: () => request<MesHealth>('/health'),
  workOrders: () => request<WorkOrder[]>('/api/work-orders'),
  bom: (sku: string) =>
    request<BomItem[]>('/api/products/' + encodeURIComponent(sku) + '/bom'),
  routing: (sku: string) =>
    request<RoutingStep[]>(
      '/api/products/' + encodeURIComponent(sku) + '/routing'
    ),
  unit: (serial: string) =>
    request<UnitRecord>('/api/units/' + encodeURIComponent(serial)),
  lotImpact: (lot: string) =>
    request<LotImpact>('/api/lots/' + encodeURIComponent(lot) + '/impact'),
  history: (minutes: number) =>
    request<TelemetryHistory>('/api/telemetry/history?minutes=' + minutes),
}
