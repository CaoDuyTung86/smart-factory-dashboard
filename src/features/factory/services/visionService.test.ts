import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Service đọc `VITE_VISION_API_URL` mỗi lần gọi, nên chỉ cần stub biến môi
 * trường là đủ — không phải nạp lại module (trong browser mode
 * `vi.resetModules()` không làm module chạy lại, vì registry là của trình
 * duyệt chứ không phải của Vite).
 */
async function loadService(url: string) {
  vi.stubEnv('VITE_VISION_API_URL', url)
  return await import('./visionService')
}

const BASE = 'http://vision.test:8001'

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
  it('tắt hoàn toàn khi không đặt VITE_VISION_API_URL', async () => {
    const svc = await loadService('')

    // Đây là điều kiện để dashboard vẫn deploy được lên Netlify mà không cần
    // service Python đi kèm: không cấu hình thì không có request nào được gửi.
    expect(svc.isVisionEnabled()).toBe(false)
  })

  it('bật khi có URL', async () => {
    const svc = await loadService(BASE)

    expect(svc.isVisionEnabled()).toBe(true)
  })

  it('bỏ dấu / thừa ở cuối URL thay vì tạo đường dẫn có //', async () => {
    const svc = await loadService(BASE + '///')

    expect(svc.goldenImageUrl('m1')).toBe(BASE + '/golden/m1')
  })

  it('escape tên model và tên ảnh mẫu trong URL', async () => {
    const svc = await loadService(BASE)

    expect(svc.sampleImageUrl('a b/c')).toBe(BASE + '/samples/a%20b%2Fc')
  })
})

describe('inspectSample', () => {
  it('gọi POST /inspect kèm tên mẫu và model', async () => {
    const svc = await loadService(BASE)
    fetchMock.mockResolvedValue(jsonResponse({ result: 'PASS' }))

    await svc.inspectSample('missing-r12')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      BASE + '/inspect?sample=missing-r12&model=' + svc.DEFAULT_MODEL_ID
    )
    expect(init.method).toBe('POST')
  })

  it('trả về nguyên bản ghi mà service gửi xuống', async () => {
    const svc = await loadService(BASE)
    const record = { result: 'FAIL', components: [{ id: 'R12', status: 'NG' }] }
    fetchMock.mockResolvedValue(jsonResponse(record))

    await expect(svc.inspectSample('missing-r12')).resolves.toEqual(record)
  })
})

describe('inspectFile', () => {
  it('gửi ảnh dưới dạng multipart ở trường `file`', async () => {
    const svc = await loadService(BASE)
    fetchMock.mockResolvedValue(jsonResponse({ result: 'PASS' }))
    const file = new File([new Uint8Array([1, 2, 3])], 'board.png', {
      type: 'image/png',
    })

    await svc.inspectFile(file)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(BASE + '/inspect?model=' + svc.DEFAULT_MODEL_ID)
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBe(file)
  })
})

describe('xử lý lỗi', () => {
  it('nêu đúng lý do service từ chối, không nuốt thành lỗi chung chung', async () => {
    // Người vận hành cần đọc được "ảnh hỏng" hay "sai model", chứ "request
    // failed" thì không sửa được gì.
    const svc = await loadService(BASE)
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: 'khong doc duoc anh' }, 400)
    )

    await expect(svc.inspectSample('x')).rejects.toThrow('khong doc duoc anh')
  })

  it('rơi về mã trạng thái khi thân lỗi không phải JSON', async () => {
    const svc = await loadService(BASE)
    fetchMock.mockResolvedValue(
      new Response('<html>502</html>', {
        status: 502,
        statusText: 'Bad Gateway',
      })
    )

    await expect(svc.fetchHealth()).rejects.toThrow('502')
  })

  it('đẩy lỗi mạng ra ngoài để component tự quyết định xuống thang', async () => {
    const svc = await loadService(BASE)
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(svc.fetchSamples()).rejects.toThrow('Failed to fetch')
  })

  it('gắn AbortSignal để một service treo không làm treo tab', async () => {
    const svc = await loadService(BASE)
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))

    await svc.fetchHealth()

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
})
