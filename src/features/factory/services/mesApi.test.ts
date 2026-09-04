import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `mesApi` đọc `VITE_MES_API_URL` mỗi lần gọi, nên chỉ cần stub biến môi trường
 * là đủ — không phải nạp lại module (trong browser mode `vi.resetModules()`
 * không làm module chạy lại, vì registry là của trình duyệt chứ không phải của
 * Vite).
 */
async function loadApi(url: string) {
  vi.stubEnv('VITE_MES_API_URL', url)
  return await import('./mesApi')
}

const BASE = 'http://mes.test:8002'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('bật/tắt theo cấu hình', () => {
  it('tắt hoàn toàn khi không đặt VITE_MES_API_URL', async () => {
    const api = await loadApi('')

    // Đây là điều kiện để dashboard vẫn deploy được lên Netlify mà không cần
    // backend đi kèm: không cấu hình thì không có request nào được gửi.
    expect(api.isMesEnabled()).toBe(false)
  })

  it('bật khi có URL', async () => {
    const api = await loadApi(BASE)

    expect(api.isMesEnabled()).toBe(true)
  })

  it('bỏ dấu / thừa ở cuối URL thay vì tạo đường dẫn có //', async () => {
    const api = await loadApi(BASE + '///')
    fetchMock.mockResolvedValue(jsonResponse([]))

    await api.mesApi.workOrders()

    expect(fetchMock.mock.calls[0][0]).toBe(BASE + '/api/work-orders')
  })

  it('gọi khi chưa cấu hình thì báo lỗi rõ ràng chứ không fetch URL rỗng', async () => {
    const api = await loadApi('')

    await expect(api.mesApi.workOrders()).rejects.toThrow(/VITE_MES_API_URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('địa chỉ WebSocket', () => {
  it('đổi http sang ws và gắn /ws', async () => {
    const api = await loadApi(BASE)

    expect(api.mesWebSocketUrl()).toBe('ws://mes.test:8002/ws')
  })

  it('đổi https sang wss — trang chạy HTTPS mà mở ws:// sẽ bị trình duyệt chặn', async () => {
    const api = await loadApi('https://mes.example.com')

    expect(api.mesWebSocketUrl()).toBe('wss://mes.example.com/ws')
  })
})

describe('phân biệt "không tìm thấy" với "hỏng"', () => {
  it('404 trả về MesNotFoundError, không phải Error chung', async () => {
    const api = await loadApi(BASE)
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'Khong tim thay serial FOX-0 trong MES' }, 404)
    )

    // Serial không tồn tại là một CÂU TRẢ LỜI của MES; sự cố mạng là chuyện
    // khác hẳn. Giao diện phải hiện ra hai thứ đó khác nhau, nên tầng service
    // phải phân biệt được chúng.
    await expect(api.mesApi.unit('FOX-0')).rejects.toBeInstanceOf(
      api.MesNotFoundError
    )
  })

  it('500 trả về lỗi thường kèm mã trạng thái', async () => {
    const api = await loadApi(BASE)
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'boom' }, 500))

    const error = await api.mesApi.unit('FOX-1').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(api.MesNotFoundError)
    expect(String(error)).toContain('500')
  })
})

describe('dựng URL', () => {
  it('escape serial để dấu / trong mã vạch không tạo thêm một đoạn đường dẫn', async () => {
    const api = await loadApi(BASE)
    fetchMock.mockResolvedValue(jsonResponse({}))

    await api.mesApi.unit('FOX/APPLE 1')

    expect(fetchMock.mock.calls[0][0]).toBe(BASE + '/api/units/FOX%2FAPPLE%201')
  })

  it('escape mã lô trong truy vấn thu hồi', async () => {
    const api = await loadApi(BASE)
    fetchMock.mockResolvedValue(jsonResponse({}))

    await api.mesApi.lotImpact('LOT/CAP 1')

    expect(fetchMock.mock.calls[0][0]).toBe(
      BASE + '/api/lots/LOT%2FCAP%201/impact'
    )
  })

  it('truyền số phút vào truy vấn lịch sử', async () => {
    const api = await loadApi(BASE)
    fetchMock.mockResolvedValue(jsonResponse({ series: {} }))

    await api.mesApi.history(120)

    expect(fetchMock.mock.calls[0][0]).toBe(
      BASE + '/api/telemetry/history?minutes=120'
    )
  })
})
