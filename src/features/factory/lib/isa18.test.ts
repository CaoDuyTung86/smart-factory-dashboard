import { describe, expect, it } from 'vitest'
import { AlarmEngine, definitionsForAsset, type AlarmDefinition } from './isa18'

/**
 * Bản TypeScript của máy trạng thái ISA-18.2.
 *
 * Những tình huống ở đây là bản dịch từng ca của `infra/mes/tests/test_alarms.py`
 * — cùng số liệu, cùng mốc thời gian, cùng kết quả mong đợi. Hai bản cài đặt
 * lệch nhau một nhánh là lúc màn hình người dùng thấy khi demo không còn là màn
 * hình mà hệ thống thật tạo ra, và mọi lời khẳng định về ISA-18.2 chỉ đúng một
 * nửa. Cùng kỷ luật đã áp cho `oee.ts` ↔ `oee.py`.
 *
 * Thời gian ở bản TypeScript tính bằng mili-giây (Date.now()), bản Python tính
 * bằng giây (time.time()); các mốc dưới đây là cùng những giây đó nhân 1000.
 */

const TAG = 'SMT-LINE-01.TEMP.HI'
const ASSET = 'SMT-LINE-01'

function makeDef(overrides: Partial<AlarmDefinition> = {}): AlarmDefinition {
  return {
    tag: TAG,
    assetCode: ASSET,
    metric: 'temperature',
    comparison: 'HI',
    setpoint: 75,
    deadband: 3,
    onDelaySec: 0,
    offDelaySec: 0,
    priority: 'MEDIUM',
    alarmClass: 'PROCESS',
    message: 'nhiệt độ vượt ngưỡng',
    unit: '°C',
    consequence: 'chất lượng mối hàn giảm',
    operatorResponse: 'kiểm tra quạt làm mát',
    responseTimeSec: 600,
    ...overrides,
  }
}

function engineWith(overrides: Partial<AlarmDefinition> = {}) {
  return new AlarmEngine([makeDef(overrides)])
}

function temp(value: number) {
  return new Map([[`${ASSET}|temperature`, value]])
}

describe('vòng đời cảnh báo', () => {
  it('vượt ngưỡng thì sang UNACK_ALM', () => {
    const e = engineWith()
    const tx = e.evaluate(0, temp(80))

    expect(tx.map((t) => t.toState)).toEqual(['UNACK_ALM'])
    expect(tx[0].cause).toBe('ALARM')
    expect(tx[0].fromState).toBe('NORMAL')
  })

  it('xác nhận rồi trở về bình thường thì về NORMAL', () => {
    const e = engineWith()
    e.evaluate(0, temp(80))
    expect(e.acknowledge(TAG, 1000)?.toState).toBe('ACKED_ALM')

    e.evaluate(2000, temp(70))
    expect(e.stateOf(TAG)).toBe('NORMAL')
  })

  it('tự hết trước khi ai xác nhận thì vào RTN_UNACK', () => {
    // Trạng thái mà một hệ cảnh báo chỉ có cờ boolean sẽ làm mất hẳn: sự cố tự
    // hết, và không ai biết nó đã từng xảy ra.
    const e = engineWith()
    e.evaluate(0, temp(80))
    e.evaluate(3000, temp(70))
    expect(e.stateOf(TAG)).toBe('RTN_UNACK')

    expect(e.acknowledge(TAG, 4000)?.toState).toBe('NORMAL')
  })

  it('đang ở RTN_UNACK mà sự cố quay lại thì kêu lại', () => {
    const e = engineWith()
    e.evaluate(0, temp(80))
    e.evaluate(1000, temp(70))
    const tx = e.evaluate(2000, temp(80))

    expect(tx.map((t) => t.cause)).toEqual(['RE_ALARM'])
    expect(e.stateOf(TAG)).toBe('UNACK_ALM')
  })

  it('không phát lại khi điều kiện vẫn đang đúng', () => {
    const e = engineWith()
    e.evaluate(0, temp(80))
    for (let t = 1; t < 40; t++) {
      expect(e.evaluate(t * 1000, temp(80))).toEqual([])
    }
  })

  it('mất số đo thì giữ nguyên trạng thái chứ không tự tắt', () => {
    // Mất cảm biến không phải bằng chứng rằng mọi thứ đã bình thường trở lại.
    const e = engineWith()
    e.evaluate(0, temp(80))
    expect(e.evaluate(1000, new Map())).toEqual([])
    expect(e.stateOf(TAG)).toBe('UNACK_ALM')
  })
})

describe('deadband', () => {
  it('chỉ nới rộng phía tắt, không phía bật', () => {
    // Nếu áp deadband cả hai phía (bật tại 78) thì kỹ sư đặt ngưỡng 75 sẽ không
    // bao giờ được báo ở 75 — làm sai chính con số họ vừa chọn.
    const e = engineWith({ setpoint: 75, deadband: 3 })
    expect(e.evaluate(0, temp(75.5))).not.toEqual([])

    e.acknowledge(TAG, 1000)
    e.evaluate(2000, temp(73))
    expect(e.stateOf(TAG)).toBe('ACKED_ALM')

    e.evaluate(3000, temp(71.9))
    expect(e.stateOf(TAG)).toBe('NORMAL')
  })

  it('chặn nhấp nháy ngay tại ngưỡng', () => {
    const count = (deadband: number) => {
      const e = engineWith({ deadband })
      e.evaluate(0, temp(75.5))
      e.acknowledge(TAG, 0)
      let raised = 0
      for (let i = 0; i < 20; i++) {
        const value = i % 2 === 0 ? 75.5 : 74.5
        for (const tx of e.evaluate((i + 1) * 1000, temp(value))) {
          if (tx.toState === 'UNACK_ALM') raised++
        }
      }
      return raised
    }

    expect(count(3)).toBe(0)
    expect(count(0)).toBe(9)
  })

  it('cảnh báo LO áp deadband ngược chiều', () => {
    const e = engineWith({ comparison: 'LO', setpoint: 10, deadband: 2 })
    expect(e.evaluate(0, temp(9.5))).not.toEqual([])
    e.acknowledge(TAG, 0)
    e.evaluate(1000, temp(11))
    expect(e.stateOf(TAG)).toBe('ACKED_ALM')
    e.evaluate(2000, temp(12.5))
    expect(e.stateOf(TAG)).toBe('NORMAL')
  })
})

describe('độ trễ', () => {
  it('on-delay nuốt xung thoáng qua', () => {
    // Deadband bao nhiêu cũng không chặn được: giá trị vọt lên gấp đôi ngưỡng
    // rồi về ngay. Hai biện pháp chữa hai bệnh khác nhau.
    const e = engineWith({ onDelaySec: 10 })
    expect(e.evaluate(0, temp(200))).toEqual([])
    expect(e.evaluate(1000, temp(50))).toEqual([])
    expect(e.stateOf(TAG)).toBe('NORMAL')
  })

  it('vẫn kêu khi điều kiện kéo dài đủ lâu', () => {
    const e = engineWith({ onDelaySec: 10 })
    e.evaluate(0, temp(80))
    expect(e.evaluate(9900, temp(80))).toEqual([])
    expect(e.evaluate(10_000, temp(80))).not.toEqual([])
  })

  it('bộ đếm on-delay tính lại từ đầu sau mỗi lần gián đoạn', () => {
    const e = engineWith({ onDelaySec: 10 })
    e.evaluate(0, temp(80))
    e.evaluate(9000, temp(80))
    e.evaluate(9500, temp(50))
    e.evaluate(18_000, temp(80))
    expect(e.stateOf(TAG)).toBe('NORMAL')
    expect(e.evaluate(27_900, temp(80))).toEqual([])
    expect(e.evaluate(28_000, temp(80))).not.toEqual([])
  })

  it('off-delay giữ cảnh báo qua một lần tụt ngắn', () => {
    const e = engineWith({ offDelaySec: 15 })
    e.evaluate(0, temp(80))
    e.acknowledge(TAG, 0)
    e.evaluate(5000, temp(50))
    expect(e.stateOf(TAG)).toBe('ACKED_ALM')
    e.evaluate(10_000, temp(80))
    e.evaluate(20_000, temp(50))
    expect(e.stateOf(TAG)).toBe('ACKED_ALM')
    e.evaluate(35_000, temp(50))
    expect(e.stateOf(TAG)).toBe('NORMAL')
  })

  it('cảnh báo an toàn không được phép có on-delay', () => {
    // Chặn ngay lúc khai báo, giống ràng buộc CHECK trên bảng alarm_definition.
    expect(
      () => new AlarmEngine([makeDef({ alarmClass: 'SAFETY', onDelaySec: 3 })])
    ).toThrow(/SAFETY/)

    expect(
      () => new AlarmEngine([makeDef({ alarmClass: 'SAFETY', onDelaySec: 0 })])
    ).not.toThrow()
  })

  it('deadband âm bị chặn', () => {
    expect(() => new AlarmEngine([makeDef({ deadband: -1 })])).toThrow(
      /deadband/
    )
  })
})

describe('shelving', () => {
  it('gỡ khỏi màn hình chính nhưng vẫn nằm ở danh sách riêng', () => {
    const e = engineWith()
    e.evaluate(0, temp(80))
    const tx = e.shelve(TAG, 10_000, 3600, 'chờ thay cảm biến', 'op1')

    expect(tx?.toState).toBe('SHELVED')
    expect(tx?.note).toBe('chờ thay cảm biến')
    expect(e.summary(10_000)).toEqual([])
    expect(e.inhibited(10_000).map((r) => r.tag)).toEqual([TAG])
    expect(e.inhibited(10_000)[0].shelveReason).toBe('chờ thay cảm biến')
  })

  it('không kêu dù điều kiện vẫn xấu', () => {
    const e = engineWith()
    e.shelve(TAG, 0, 3600)
    for (let t = 1; t < 20; t++) {
      expect(e.evaluate(t * 1000, temp(200))).toEqual([])
    }
    expect(e.stateOf(TAG)).toBe('SHELVED')
  })

  it('tự hết hạn rồi kêu lại nếu vẫn còn xấu', () => {
    // Shelve vĩnh viễn là cách một cảnh báo bị tắt rồi không ai nhớ bật lại.
    const e = engineWith()
    e.shelve(TAG, 0, 600)
    e.evaluate(300_000, temp(200))
    expect(e.stateOf(TAG)).toBe('SHELVED')

    const tx = e.evaluate(600_000, temp(200))
    expect(tx.map((t) => t.cause)).toEqual(['SHELVE_EXPIRED'])
    expect(e.stateOf(TAG)).toBe('UNACK_ALM')
  })

  it('hết shelve mà mọi thứ đã tốt thì về NORMAL, không kêu', () => {
    const e = engineWith()
    e.shelve(TAG, 0, 600)
    e.evaluate(700_000, temp(50))
    expect(e.stateOf(TAG)).toBe('NORMAL')
  })

  it('bật lại thủ công thì kêu lại và lại là chưa xác nhận', () => {
    // Không được cho nó về thẳng NORMAL chỉ vì trước đó đã có người xác nhận —
    // đó là giấu một sự cố đang diễn ra.
    const e = engineWith()
    e.evaluate(0, temp(80))
    e.acknowledge(TAG, 1000)
    e.shelve(TAG, 2000, 3600)
    e.evaluate(3000, temp(80))

    const tx = e.unshelve(TAG, 4000, 'op1')
    expect(tx?.toState).toBe('UNACK_ALM')
    expect(tx?.cause).toBe('UNSHELVE')
  })

  it('hạn shelve bị kẹp bởi cấu hình của chính cảnh báo', () => {
    const e = engineWith({
      alarmClass: 'SAFETY',
      onDelaySec: 0,
      maxShelveSec: 300,
    })
    e.shelve(TAG, 0, 8 * 3600)
    expect(e.inhibited(0)[0].shelvedUntil).toBe(300_000)
  })

  it('không shelve được cái đang out-of-service', () => {
    const e = engineWith()
    e.setOutOfService(TAG, true, 0)
    expect(e.shelve(TAG, 1000, 600)).toBeNull()
    expect(e.shelve('KHÔNG-CÓ-TAG-NÀY', 1000, 600)).toBeNull()
  })
})

describe('suppression và out-of-service', () => {
  it('là hai trạng thái khác nhau, không gộp làm một', () => {
    // Gộp ba khái niệm làm một là mất khả năng trả lời "ai đã tắt cái này và
    // theo thẩm quyền nào".
    const e = new AlarmEngine([
      makeDef(),
      makeDef({ tag: 'B', metric: 'vibration' }),
    ])
    e.suppress(TAG, 0, 'logic')
    e.setOutOfService('B', true, 0, 'bảo-trì')

    const counts = e.stateCounts()
    expect(counts.SUPPRESSED_BY_DESIGN).toBe(1)
    expect(counts.OUT_OF_SERVICE).toBe(1)
    expect(e.summary(0)).toEqual([])
    expect(e.inhibited(0)).toHaveLength(2)
  })

  it('bỏ suppress thì đánh giá lại như bình thường', () => {
    const e = engineWith()
    expect(e.unsuppress(TAG, 0)).toBeNull()
    e.suppress(TAG, 0)
    expect(e.suppress(TAG, 1000)).toBeNull()
    expect(e.unsuppress(TAG, 2000)?.toState).toBe('NORMAL')
  })

  it('vào lại service thì đánh giá lại từ đầu', () => {
    const e = engineWith()
    e.setOutOfService(TAG, true, 0)
    e.evaluate(1000, temp(200))
    expect(e.stateOf(TAG)).toBe('OUT_OF_SERVICE')

    const tx = e.setOutOfService(TAG, false, 2000, 'bảo-trì')
    expect(tx?.toState).toBe('UNACK_ALM')
    expect(tx?.cause).toBe('IN_SERVICE')
  })
})

describe('màn hình người vận hành', () => {
  it('sắp theo ưu tiên trước rồi mới theo thời gian', () => {
    // Khi 20 cảnh báo ập đến cùng lúc, để thứ tự thời gian quyết định cái nguy
    // hiểm nhất nằm ở đâu là chuyện may rủi.
    const e = new AlarmEngine([
      makeDef({ tag: 'THẤP', metric: 'a', priority: 'LOW' }),
      makeDef({
        tag: 'CAO',
        metric: 'b',
        priority: 'URGENT',
        alarmClass: 'EQUIPMENT',
      }),
      makeDef({ tag: 'VỪA', metric: 'c', priority: 'MEDIUM' }),
    ])
    e.evaluate(0, new Map([[`${ASSET}|a`, 80]]))
    e.evaluate(1000, new Map([[`${ASSET}|b`, 80]]))
    e.evaluate(2000, new Map([[`${ASSET}|c`, 80]]))

    expect(e.summary(3000).map((r) => r.tag)).toEqual(['CAO', 'VỪA', 'THẤP'])
  })

  it('đếm chattering theo định nghĩa của tiêu chuẩn', () => {
    // Từ 3 lần kêu trở lên trong một phút.
    const e = engineWith()
    for (let i = 0; i < 2; i++) {
      e.evaluate(i * 2000, temp(80))
      e.evaluate(i * 2000 + 1000, temp(50))
      e.acknowledge(TAG, i * 2000 + 1000)
    }
    e.evaluate(4000, temp(80))
    expect(e.summary(5000)[0].chattering).toBe(true)
  })

  it('không báo chattering khi thưa thớt', () => {
    const e = engineWith()
    for (let i = 0; i < 5; i++) {
      e.evaluate(i * 600_000, temp(80))
      e.evaluate(i * 600_000 + 1000, temp(50))
      e.acknowledge(TAG, i * 600_000 + 1000)
    }
    e.evaluate(3_000_000, temp(80))
    expect(e.summary(3_001_000)[0].chattering).toBe(false)
  })

  it('đánh dấu stale khi kêu liên tục quá 24 giờ', () => {
    const e = engineWith()
    e.evaluate(0, temp(80))
    expect(e.summary(23 * 3600_000)[0].stale).toBe(false)
    expect(e.summary(25 * 3600_000)[0].stale).toBe(true)
  })

  it('bảng rationalization lộ ra cả căn cứ tồn tại', () => {
    const rows = engineWith().definitionRows()
    expect(rows[0].consequence).toBeTruthy()
    expect(rows[0].operatorResponse).toBeTruthy()
    expect(rows[0].responseTimeSec).toBe(600)
  })

  it('cảnh báo bị tắt trong cấu hình thì không đánh giá', () => {
    const e = engineWith({ enabled: false })
    expect(e.evaluate(0, temp(500))).toEqual([])
    expect(e.stateOf(TAG)).toBe('NORMAL')
  })
})

describe('xác nhận hàng loạt', () => {
  it('xác nhận theo máy chỉ động tới máy đó', () => {
    const e = new AlarmEngine([
      makeDef({ tag: 'A1', assetCode: 'MÁY-1', metric: 'a' }),
      makeDef({ tag: 'A2', assetCode: 'MÁY-1', metric: 'b' }),
      makeDef({ tag: 'B1', assetCode: 'MÁY-2', metric: 'a' }),
    ])
    e.evaluate(
      0,
      new Map([
        ['MÁY-1|a', 80],
        ['MÁY-1|b', 80],
        ['MÁY-2|a', 80],
      ])
    )
    const tx = e.acknowledgeAsset('MÁY-1', 1000, 'op1')

    expect(tx.map((t) => t.tag).sort()).toEqual(['A1', 'A2'])
    expect(e.stateOf('B1')).toBe('UNACK_ALM')
    expect(tx.every((t) => t.operator === 'op1')).toBe(true)
  })

  it('xác nhận tất cả', () => {
    const e = new AlarmEngine([
      makeDef({ tag: 'A', metric: 'a' }),
      makeDef({ tag: 'B', metric: 'b' }),
    ])
    e.evaluate(
      0,
      new Map([
        [`${ASSET}|a`, 80],
        [`${ASSET}|b`, 80],
      ])
    )
    expect(e.acknowledgeAll(1000)).toHaveLength(2)
    expect(e.acknowledgeAll(2000)).toEqual([])
  })
})

describe('cấu hình sinh từ hồ sơ thiết bị', () => {
  it('dùng cùng công thức với 05-alarms.sql', () => {
    // Ngưỡng nằm ở hồ sơ máy, cảnh báo chỉ trỏ tới nó. Gõ lại tay từng con số ở
    // hai nơi là tạo ra hai nguồn sự thật rồi chờ chúng lệch nhau.
    const defs = definitionsForAsset({
      assetCode: 'REFLOW-OVEN-02',
      name: 'Reflow Soldering Oven',
      warnTemp: 262,
      critTemp: 295,
      warnVibration: 3,
      nominalPower: 35.2,
    })
    const byTag = new Map(defs.map((d) => [d.tag, d]))

    expect(byTag.get('REFLOW-OVEN-02.TEMP.HI')?.setpoint).toBe(262)
    expect(byTag.get('REFLOW-OVEN-02.TEMP.HIHI')?.setpoint).toBe(295)
    expect(byTag.get('REFLOW-OVEN-02.PWR.HI')?.setpoint).toBe(44)
  })

  it('cảnh báo E-Stop không có độ trễ và không được shelve quá 5 phút', () => {
    const estop = definitionsForAsset({
      assetCode: 'A',
      name: 'A',
      warnTemp: 75,
      critTemp: 88,
      warnVibration: 4,
      nominalPower: 10,
    }).find((d) => d.tag === 'A.ESTOP')!

    expect(estop.alarmClass).toBe('SAFETY')
    expect(estop.priority).toBe('URGENT')
    expect(estop.onDelaySec).toBe(0)
    expect(estop.maxShelveSec).toBe(300)
  })

  it('độ trễ bật/tắt của cảnh báo tới hạn cố ý không đối xứng', () => {
    // Muốn biết thật nhanh, nhưng không muốn nó nhấp nháy tắt khi máy đang
    // nguội chậm.
    const hihi = definitionsForAsset({
      assetCode: 'A',
      name: 'A',
      warnTemp: 75,
      critTemp: 88,
      warnVibration: 4,
      nominalPower: 10,
    }).find((d) => d.tag === 'A.TEMP.HIHI')!

    expect(hihi.onDelaySec).toBeLessThan(hihi.offDelaySec)
  })

  it('cảnh báo rung có on-delay dài hơn hẳn nhiệt độ', () => {
    // Rung là tín hiệu xung: một xe nâng đi ngang qua cũng làm kim nhảy. Cảnh
    // báo rung không có độ trễ là nguồn chattering kinh điển nhất.
    const defs = definitionsForAsset({
      assetCode: 'A',
      name: 'A',
      warnTemp: 75,
      critTemp: 88,
      warnVibration: 4,
      nominalPower: 10,
    })
    const byTag = new Map(defs.map((d) => [d.tag, d]))

    expect(byTag.get('A.VIB.HI')!.onDelaySec).toBeGreaterThan(
      byTag.get('A.TEMP.HI')!.onDelaySec
    )
  })
})
