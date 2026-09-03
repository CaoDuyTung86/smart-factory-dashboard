/**
 * Cầu nối tới service AOI thật (infra/vision) — OpenCV chạy trên Python.
 *
 * Bật bằng biến môi trường:
 *   VITE_VISION_API_URL=http://localhost:8001
 *
 * Không đặt biến này thì tab Vision chạy đúng như trước bằng dữ liệu mô phỏng,
 * không có request nào được gửi đi. Cùng một cách xuống thang với `plcGateway`,
 * để dashboard vẫn deploy được lên Netlify/Vercel mà không cần hạ tầng.
 *
 * Service chấm điểm bằng template matching + so ảnh mẫu, nên `confidence` trả
 * về là điểm tương quan chuẩn hoá (NCC) — một đại lượng đo được, không phải
 * xác suất của một mô hình học sâu.
 */
import type { PcbInspectionRecord } from '../types'

/**
 * Đọc cấu hình mỗi lần gọi chứ không chốt lại thành hằng số lúc import.
 * Giá trị không đổi khi chạy thật, nhưng một hằng số ở tầng module thì không
 * cách nào thay được trong test — mà đúng cái nhánh "chưa cấu hình" mới là
 * nhánh cần được kiểm chứng nhất.
 */
function apiBase(): string {
  return (import.meta.env.VITE_VISION_API_URL ?? '').trim().replace(/\/+$/, '')
}

/** Có cấu hình service AOI hay chưa. Chưa thì tab Vision chạy dữ liệu mô phỏng. */
export function isVisionEnabled(): boolean {
  return apiBase() !== ''
}

/** Ảnh demo do service sinh ra, để thử không cần camera. */
export interface VisionSample {
  name: string
  modelId: string
  description: string
}

export interface VisionHealth {
  status: string
  engine: string
  opencv: string
  recipes: string[]
}

export const DEFAULT_MODEL_ID = 'mbp-m3-logic-rev-b'

/** Chờ tối đa bao lâu trước khi coi như service không phản hồi. */
const TIMEOUT_MS = 10_000

function url(path: string): string {
  return apiBase() + path
}

/**
 * Ảnh mẫu và ảnh demo được `<img src>` tải trực tiếp, không qua fetch — thẻ
 * img không bị CORS chặn nên không cần cấu hình gì thêm ở service.
 */
export function goldenImageUrl(modelId: string = DEFAULT_MODEL_ID): string {
  return url('/golden/' + encodeURIComponent(modelId))
}

export function sampleImageUrl(name: string): string {
  return url('/samples/' + encodeURIComponent(name))
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url(path), { ...init, signal: controller.signal })

    if (!res.ok) {
      // FastAPI trả lỗi ở trường `detail`; giữ nguyên câu chữ của service để
      // người vận hành đọc được lý do thật thay vì "request failed".
      let detail = res.status + ' ' + res.statusText
      try {
        const body = (await res.json()) as { detail?: string }
        if (body?.detail) detail = body.detail
      } catch {
        // Lỗi không phải JSON — giữ nguyên mã trạng thái.
      }
      throw new Error(detail)
    }

    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export function fetchHealth(): Promise<VisionHealth> {
  return request<VisionHealth>('/health')
}

export function fetchSamples(): Promise<VisionSample[]> {
  return request<VisionSample[]>('/samples')
}

/** Chạy kiểm tra trên một ảnh demo của service. */
export function inspectSample(
  name: string,
  modelId: string = DEFAULT_MODEL_ID
): Promise<PcbInspectionRecord> {
  return request<PcbInspectionRecord>(
    '/inspect?sample=' +
      encodeURIComponent(name) +
      '&model=' +
      encodeURIComponent(modelId),
    { method: 'POST' }
  )
}

/** Gửi ảnh người vận hành tải lên cho service kiểm tra. */
export function inspectFile(
  file: File,
  modelId: string = DEFAULT_MODEL_ID
): Promise<PcbInspectionRecord> {
  const form = new FormData()
  form.append('file', file)

  return request<PcbInspectionRecord>(
    '/inspect?model=' + encodeURIComponent(modelId),
    { method: 'POST', body: form }
  )
}
