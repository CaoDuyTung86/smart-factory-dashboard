import { describe, expect, it } from 'vitest'
import { pickSource } from './factorySource'
import { sensorSimulator } from './sensorSimulator'

/**
 * Việc chọn nguồn dữ liệu phải kiểm chứng được mà không cần dựng backend.
 * `pickSource` được tách ra chính vì lý do đó: hằng số `factorySource` chỉ là
 * `pickSource(isMesEnabled())`.
 */
describe('chọn nguồn dữ liệu cho tab SCADA', () => {
  it('chưa cấu hình MES thì chạy simulator trong trình duyệt', () => {
    const source = pickSource(false)

    expect(source.kind).toBe('simulator')
    expect(source.subscribe).toBe(sensorSimulator.subscribe)
  })

  it('cấu hình MES rồi thì mọi thứ đi qua backend, kể cả lệnh điều khiển', () => {
    const source = pickSource(true)

    // Nếu lệnh vẫn gọi thẳng simulator thì bấm nút sẽ đổi số trên MỘT trình
    // duyệt còn backend không biết gì — hai người xem sẽ thấy hai dây chuyền.
    expect(source.kind).toBe('mes')
    expect(source.subscribe).not.toBe(sensorSimulator.subscribe)
  })

  it('hai nguồn có cùng bề mặt API để component không phải phân biệt', () => {
    const live = pickSource(true)
    const offline = pickSource(false)

    expect(Object.keys(live).sort()).toEqual(Object.keys(offline).sort())
  })
})

describe('hợp đồng external store của simulator', () => {
  it('id của máy chính là mã tài sản dùng chung với backend và MES', () => {
    // Trước đây id là 'm1'..'m4', một khoá chỉ tồn tại trong frontend. Mã tài
    // sản là danh tính thật của máy, dùng xuyên suốt telemetry, routing và
    // unit_step — nhờ vậy không cần một bảng ánh xạ phải giữ đồng bộ.
    const ids = sensorSimulator.getSnapshot().machines.map((m) => m.id)

    expect(ids).toEqual([
      'SMT-LINE-01',
      'REFLOW-OVEN-02',
      'CNC-MILL-03',
      'AOI-INSPECT-04',
    ])
    expect(
      sensorSimulator.getSnapshot().machines.every((m) => m.id === m.code)
    ).toBe(true)
  })

  it('cờ còi cảnh báo không nằm trong trạng thái dây chuyền', () => {
    // Còi bật hay tắt là thiết lập của trạm vận hành đang ngồi, không phải
    // trạng thái của dây chuyền — và từ khi gói tin do backend phát cho mọi
    // trình duyệt thì để nó trong đó là sai hẳn về mô hình.
    expect('audioEnabled' in sensorSimulator.getSnapshot()).toBe(false)
  })
})
