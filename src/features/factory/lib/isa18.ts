/**
 * Máy trạng thái cảnh báo theo ANSI/ISA-18.2 — bản TypeScript.
 *
 * Đây là bản cài đặt thứ hai của cùng một máy trạng thái với `infra/mes/
 * alarms.py`. Hai bản phải cho kết quả giống hệt trên cùng bộ tình huống, và
 * `isa18.test.ts` ghim chúng vào nhau đúng như cách `oee.ts` và `oee.py` được
 * ghim vào cùng một ví dụ mẫu.
 *
 * Vì sao lại có hai bản: khi chưa cấu hình `VITE_MES_API_URL`, dashboard chạy
 * hoàn toàn trong trình duyệt bằng `sensorSimulator`. Nếu bản trong trình duyệt
 * dùng một cơ chế cảnh báo khác — chẳng hạn chỉ có một cờ boolean như trước
 * đây — thì màn hình người dùng nhìn thấy khi demo sẽ không phải màn hình mà hệ
 * thống thật tạo ra, và mọi lời khẳng định về ISA-18.2 chỉ đúng ở một nửa.
 *
 * Đọc `infra/mes/alarms.py` để có phần giải thích đầy đủ vì sao mỗi trạng thái
 * tồn tại. Ở đây chỉ ghi lại những chỗ bản TypeScript dễ bị viết sai.
 */

export const ALARM_STATES = [
  'NORMAL',
  'UNACK_ALM',
  'ACKED_ALM',
  'RTN_UNACK',
  'SHELVED',
  'SUPPRESSED_BY_DESIGN',
  'OUT_OF_SERVICE',
] as const

export type AlarmState = (typeof ALARM_STATES)[number]

/** Những trạng thái xuất hiện trên màn hình chính của người vận hành. */
export const ACTIVE_STATES: readonly AlarmState[] = [
  'UNACK_ALM',
  'ACKED_ALM',
  'RTN_UNACK',
]

/**
 * Ba đường khác nhau dẫn tới cùng một sự im lặng. Tiêu chuẩn tách ba vì ai có
 * quyền bật/tắt chúng là khác nhau: người vận hành (shelve, tạm thời, có hạn),
 * logic thiết kế (suppress), và bảo trì (out of service).
 */
export const INHIBITED_STATES: readonly AlarmState[] = [
  'SHELVED',
  'SUPPRESSED_BY_DESIGN',
  'OUT_OF_SERVICE',
]

/**
 * Mức ưu tiên — kết quả của rationalization, không phải "độ nghiêm trọng".
 * Thứ tự trong mảng chính là thứ tự xếp hạng.
 */
export const PRIORITIES = [
  'DIAGNOSTIC',
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
] as const

export type AlarmPriority = (typeof PRIORITIES)[number]

export const PRIORITY_RANK: Record<AlarmPriority, number> = {
  DIAGNOSTIC: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4,
}

export type AlarmClass =
  'SAFETY' | 'ENVIRONMENTAL' | 'QUALITY' | 'PROCESS' | 'EQUIPMENT' | 'ENERGY'

export type Comparison = 'HI' | 'HIHI' | 'LO' | 'LOLO' | 'BOOL'

/** Từ 3 lần kêu trở lên trong một phút — định nghĩa chattering của tiêu chuẩn. */
export const CHATTER_WINDOW_MS = 60_000
export const CHATTER_THRESHOLD = 3
export const STALE_AFTER_MS = 24 * 3600 * 1000

export interface AlarmDefinition {
  tag: string
  assetCode: string
  metric: string
  comparison: Comparison
  setpoint: number
  deadband: number
  onDelaySec: number
  offDelaySec: number
  priority: AlarmPriority
  alarmClass: AlarmClass
  message: string
  unit?: string
  consequence?: string
  operatorResponse?: string
  responseTimeSec?: number
  enabled?: boolean
  maxShelveSec?: number
}

export interface AlarmTransition {
  tag: string
  assetCode: string
  at: number
  fromState: AlarmState
  toState: AlarmState
  cause: string
  priority: AlarmPriority
  alarmClass: AlarmClass
  message: string
  value: number | null
  unit: string
  operator: string
  note: string
}

/** Một dòng trên màn hình cảnh báo. Khớp đúng payload backend phát ra. */
export interface ActiveAlarm {
  tag: string
  assetCode: string
  machineName: string
  metric: string
  state: AlarmState
  priority: AlarmPriority
  alarmClass: AlarmClass
  message: string
  comparison: Comparison
  setpoint: number
  deadband: number
  value: number
  unit: string
  raisedAt: number | null
  ackedAt: number | null
  rtnAt: number | null
  shelvedUntil: number | null
  shelveReason: string
  consequence: string
  operatorResponse: string
  responseTimeSec: number
  maxShelveSec: number
  chattering: boolean
  stale: boolean
}

export type AlarmCounts = Record<AlarmState, number>

interface Runtime {
  tag: string
  state: AlarmState
  /** Điều kiện sau deadband, trước độ trễ. */
  condition: boolean
  /** Điều kiện sau độ trễ — đây mới là thứ đẩy máy trạng thái. */
  active: boolean
  pendingSince: number | null
  clearingSince: number | null
  raisedAt: number | null
  ackedAt: number | null
  rtnAt: number | null
  shelvedUntil: number | null
  shelveReason: string
  value: number
  annunciations: number[]
}

const DEFAULT_MAX_SHELVE_SEC = 8 * 3600

function newRuntime(tag: string): Runtime {
  return {
    tag,
    state: 'NORMAL',
    condition: false,
    active: false,
    pendingSince: null,
    clearingSince: null,
    raisedAt: null,
    ackedAt: null,
    rtnAt: null,
    shelvedUntil: null,
    shelveReason: '',
    value: 0,
    annunciations: [],
  }
}

/**
 * Deadband CHỈ nới rộng phía TẮT, không bao giờ phía BẬT.
 *
 * Cảnh báo HI bật tại `value > setpoint` nhưng chỉ tắt khi
 * `value < setpoint - deadband`. Làm ngược lại là lỗi hay gặp, và nó làm chậm
 * đúng cái cảnh báo mà kỹ sư vừa đặt setpoint cho: người ta chọn 75 độ vì 75 độ
 * là ngưỡng, không phải 78.
 */
function rawCondition(
  defn: AlarmDefinition,
  value: number,
  wasTrue: boolean
): boolean {
  if (defn.comparison === 'BOOL') return Boolean(value)
  if (defn.comparison === 'HI' || defn.comparison === 'HIHI') {
    return wasTrue
      ? value > defn.setpoint - defn.deadband
      : value > defn.setpoint
  }
  return wasTrue ? value < defn.setpoint + defn.deadband : value < defn.setpoint
}

/**
 * Áp on-delay / off-delay.
 *
 * Deadband chữa bệnh "giá trị dao động quanh đúng setpoint"; độ trễ chữa bệnh
 * "giá trị nhảy vọt rồi về ngay". Một biện pháp không chữa được bệnh kia: một
 * xung rung 0.2 giây vọt lên gấp đôi ngưỡng thì deadband bao nhiêu cũng không
 * chặn nổi.
 *
 * Bộ đếm trễ bắt đầu lại từ đầu mỗi lần điều kiện đổi chiều — đó chính là lý do
 * một xung thoáng qua không bao giờ chạm tới ngưỡng on-delay.
 */
function debounce(defn: AlarmDefinition, rt: Runtime, nowMs: number): void {
  const onDelayMs = defn.onDelaySec * 1000
  const offDelayMs = defn.offDelaySec * 1000

  if (rt.condition && !rt.active) {
    if (rt.pendingSince === null) rt.pendingSince = nowMs
    rt.clearingSince = null
    if (nowMs - rt.pendingSince >= onDelayMs) {
      rt.active = true
      rt.pendingSince = null
    }
  } else if (rt.condition && rt.active) {
    rt.clearingSince = null
    rt.pendingSince = null
  } else if (!rt.condition && rt.active) {
    if (rt.clearingSince === null) rt.clearingSince = nowMs
    rt.pendingSince = null
    if (nowMs - rt.clearingSince >= offDelayMs) {
      rt.active = false
      rt.clearingSince = null
    }
  } else {
    rt.pendingSince = null
    rt.clearingSince = null
  }
}

export class AlarmEngine {
  private readonly definitions = new Map<string, AlarmDefinition>()
  private readonly runtime = new Map<string, Runtime>()

  constructor(definitions: AlarmDefinition[] = []) {
    definitions.forEach((d) => this.add(d))
  }

  public add(defn: AlarmDefinition): void {
    if (defn.alarmClass === 'SAFETY' && defn.onDelaySec > 0) {
      // Một độ trễ 3 giây trên E-Stop là ba giây người vận hành không biết máy
      // đã dừng. Chặn ngay lúc khai báo, giống hệt ràng buộc CHECK trên bảng
      // `alarm_definition`.
      throw new Error(`${defn.tag}: cảnh báo SAFETY không được có on-delay`)
    }
    if (defn.deadband < 0) {
      throw new Error(`${defn.tag}: deadband không được âm`)
    }
    this.definitions.set(defn.tag, defn)
    if (!this.runtime.has(defn.tag)) {
      this.runtime.set(defn.tag, newRuntime(defn.tag))
    }
  }

  public definition(tag: string): AlarmDefinition | undefined {
    return this.definitions.get(tag)
  }

  public stateOf(tag: string): AlarmState | undefined {
    return this.runtime.get(tag)?.state
  }

  // ------------------------------------------------------------------ nội bộ

  private tx(
    defn: AlarmDefinition,
    rt: Runtime,
    at: number,
    toState: AlarmState,
    cause: string,
    operator = '',
    note = ''
  ): AlarmTransition {
    const transition: AlarmTransition = {
      tag: defn.tag,
      assetCode: defn.assetCode,
      at,
      fromState: rt.state,
      toState,
      cause,
      priority: defn.priority,
      alarmClass: defn.alarmClass,
      message: defn.message,
      value: rt.value,
      unit: defn.unit ?? '',
      operator,
      note,
    }
    rt.state = toState
    return transition
  }

  private annunciate(
    defn: AlarmDefinition,
    rt: Runtime,
    nowMs: number,
    cause: string
  ): AlarmTransition {
    rt.raisedAt = nowMs
    rt.ackedAt = null
    rt.rtnAt = null
    rt.annunciations = [...rt.annunciations, nowMs].filter(
      (t) => t >= nowMs - 3600_000
    )
    return this.tx(defn, rt, nowMs, 'UNACK_ALM', cause)
  }

  private resume(
    defn: AlarmDefinition,
    rt: Runtime,
    nowMs: number,
    cause: string,
    operator = ''
  ): AlarmTransition {
    rt.shelvedUntil = null
    rt.shelveReason = ''
    // Điều kiện còn xấu thì cảnh báo kêu LẠI từ đầu và lại là chưa xác nhận.
    // Cho nó về thẳng NORMAL chỉ vì trước đó đã có người bấm xác nhận là giấu
    // một sự cố đang diễn ra — đúng cái mà shelving sinh ra để tránh.
    if (rt.active) return this.annunciate(defn, rt, nowMs, cause)
    return this.tx(defn, rt, nowMs, 'NORMAL', cause, operator)
  }

  // ----------------------------------------------------------------- đánh giá

  /**
   * Đẩy toàn bộ cảnh báo đi một bước.
   *
   * `readings` khoá theo `assetCode|metric`. Thiếu số đo thì cảnh báo đó GIỮ
   * NGUYÊN trạng thái chứ không tự tắt: mất cảm biến không phải là bằng chứng
   * rằng mọi thứ đã bình thường trở lại.
   */
  public evaluate(
    nowMs: number,
    readings: Map<string, number>
  ): AlarmTransition[] {
    const out: AlarmTransition[] = []

    for (const [tag, defn] of this.definitions) {
      const rt = this.runtime.get(tag)!

      // Hết hạn shelve xử lý TRƯỚC khi đọc số đo, để một cảnh báo vừa hết hạn
      // được đánh giá lại ngay trong chính vòng này.
      if (
        rt.state === 'SHELVED' &&
        rt.shelvedUntil !== null &&
        nowMs >= rt.shelvedUntil
      ) {
        out.push(this.resume(defn, rt, nowMs, 'SHELVE_EXPIRED'))
      }

      if (defn.enabled === false) continue

      const value = readings.get(`${defn.assetCode}|${defn.metric}`)
      if (value === undefined) continue

      rt.value = value
      rt.condition = rawCondition(defn, value, rt.condition)
      debounce(defn, rt, nowMs)

      // Đã bị tắt khỏi màn hình thì vẫn theo dõi điều kiện, nhưng không kêu.
      if (INHIBITED_STATES.includes(rt.state)) continue

      if (rt.state === 'NORMAL') {
        if (rt.active) out.push(this.annunciate(defn, rt, nowMs, 'ALARM'))
      } else if (rt.state === 'UNACK_ALM') {
        if (!rt.active) {
          // Điều kiện hết nhưng chưa ai xác nhận. Bỏ trạng thái này đi thì một
          // sự cố thoáng qua biến mất không dấu vết.
          rt.rtnAt = nowMs
          out.push(this.tx(defn, rt, nowMs, 'RTN_UNACK', 'RTN'))
        }
      } else if (rt.state === 'ACKED_ALM') {
        if (!rt.active) {
          rt.rtnAt = nowMs
          out.push(this.tx(defn, rt, nowMs, 'NORMAL', 'RTN'))
        }
      } else if (rt.state === 'RTN_UNACK') {
        if (rt.active) out.push(this.annunciate(defn, rt, nowMs, 'RE_ALARM'))
      }
    }
    return out
  }

  // ------------------------------------------------- thao tác người vận hành

  public acknowledge(
    tag: string,
    nowMs: number,
    operator = ''
  ): AlarmTransition | null {
    const defn = this.definitions.get(tag)
    const rt = this.runtime.get(tag)
    if (!defn || !rt) return null
    if (rt.state === 'UNACK_ALM') {
      rt.ackedAt = nowMs
      return this.tx(defn, rt, nowMs, 'ACKED_ALM', 'ACK', operator)
    }
    if (rt.state === 'RTN_UNACK') {
      // Xác nhận một cảnh báo đã tự hết thì nó về hẳn NORMAL: không còn gì để
      // xử lý nữa, chỉ còn việc đã có người nhìn thấy.
      rt.ackedAt = nowMs
      return this.tx(defn, rt, nowMs, 'NORMAL', 'ACK', operator)
    }
    return null
  }

  public acknowledgeAsset(
    assetCode: string,
    nowMs: number,
    operator = ''
  ): AlarmTransition[] {
    const out: AlarmTransition[] = []
    for (const [tag, defn] of this.definitions) {
      if (defn.assetCode !== assetCode) continue
      const tx = this.acknowledge(tag, nowMs, operator)
      if (tx) out.push(tx)
    }
    return out
  }

  public acknowledgeAll(nowMs: number, operator = ''): AlarmTransition[] {
    const out: AlarmTransition[] = []
    for (const tag of this.definitions.keys()) {
      const tx = this.acknowledge(tag, nowMs, operator)
      if (tx) out.push(tx)
    }
    return out
  }

  /**
   * Tạm gỡ một cảnh báo khỏi màn hình, có hạn giờ.
   *
   * Hạn bị kẹp bởi `maxShelveSec` của chính cảnh báo đó — cảnh báo an toàn
   * thường không được phép shelve quá vài phút.
   */
  public shelve(
    tag: string,
    nowMs: number,
    durationSec: number,
    reason = '',
    operator = ''
  ): AlarmTransition | null {
    const defn = this.definitions.get(tag)
    const rt = this.runtime.get(tag)
    if (!defn || !rt) return null
    if (rt.state === 'SHELVED' || rt.state === 'OUT_OF_SERVICE') return null

    const max = defn.maxShelveSec ?? DEFAULT_MAX_SHELVE_SEC
    const duration = Math.max(0, Math.min(durationSec, max))
    if (duration <= 0) return null

    rt.shelvedUntil = nowMs + duration * 1000
    rt.shelveReason = reason
    return this.tx(defn, rt, nowMs, 'SHELVED', 'SHELVE', operator, reason)
  }

  public unshelve(
    tag: string,
    nowMs: number,
    operator = ''
  ): AlarmTransition | null {
    const defn = this.definitions.get(tag)
    const rt = this.runtime.get(tag)
    if (!defn || !rt || rt.state !== 'SHELVED') return null
    return this.resume(defn, rt, nowMs, 'UNSHELVE', operator)
  }

  /**
   * Tắt theo LOGIC THIẾT KẾ, không phải theo ý người vận hành.
   *
   * Ví dụ kinh điển: không báo áp suất thấp khi bơm đang tắt. Khác shelve ở chỗ
   * nó không có hạn giờ và không do người trực bật/tắt — nên tiêu chuẩn tách
   * riêng, và màn hình cũng phải tô khác màu.
   */
  public suppress(
    tag: string,
    nowMs: number,
    operator = ''
  ): AlarmTransition | null {
    const defn = this.definitions.get(tag)
    const rt = this.runtime.get(tag)
    if (!defn || !rt || rt.state === 'SUPPRESSED_BY_DESIGN') return null
    return this.tx(
      defn,
      rt,
      nowMs,
      'SUPPRESSED_BY_DESIGN',
      'SUPPRESS',
      operator
    )
  }

  public unsuppress(
    tag: string,
    nowMs: number,
    operator = ''
  ): AlarmTransition | null {
    const defn = this.definitions.get(tag)
    const rt = this.runtime.get(tag)
    if (!defn || !rt || rt.state !== 'SUPPRESSED_BY_DESIGN') return null
    return this.resume(defn, rt, nowMs, 'UNSUPPRESS', operator)
  }

  public setOutOfService(
    tag: string,
    out: boolean,
    nowMs: number,
    operator = ''
  ): AlarmTransition | null {
    const defn = this.definitions.get(tag)
    const rt = this.runtime.get(tag)
    if (!defn || !rt) return null
    if (out) {
      if (rt.state === 'OUT_OF_SERVICE') return null
      return this.tx(
        defn,
        rt,
        nowMs,
        'OUT_OF_SERVICE',
        'OUT_OF_SERVICE',
        operator
      )
    }
    if (rt.state !== 'OUT_OF_SERVICE') return null
    return this.resume(defn, rt, nowMs, 'IN_SERVICE', operator)
  }

  // -------------------------------------------------------------------- đọc ra

  private entry(
    defn: AlarmDefinition,
    rt: Runtime,
    nowMs: number,
    names: Map<string, string>
  ): ActiveAlarm {
    return {
      tag: defn.tag,
      assetCode: defn.assetCode,
      machineName: names.get(defn.assetCode) ?? defn.assetCode,
      metric: defn.metric,
      state: rt.state,
      priority: defn.priority,
      alarmClass: defn.alarmClass,
      message: defn.message,
      comparison: defn.comparison,
      setpoint: defn.setpoint,
      deadband: defn.deadband,
      value: Math.round(rt.value * 1000) / 1000,
      unit: defn.unit ?? '',
      raisedAt: rt.raisedAt,
      ackedAt: rt.ackedAt,
      rtnAt: rt.rtnAt,
      shelvedUntil: rt.shelvedUntil,
      shelveReason: rt.shelveReason,
      consequence: defn.consequence ?? '',
      operatorResponse: defn.operatorResponse ?? '',
      responseTimeSec: defn.responseTimeSec ?? 0,
      maxShelveSec: defn.maxShelveSec ?? DEFAULT_MAX_SHELVE_SEC,
      chattering:
        rt.annunciations.filter((t) => t >= nowMs - CHATTER_WINDOW_MS).length >=
        CHATTER_THRESHOLD,
      stale:
        (rt.state === 'UNACK_ALM' || rt.state === 'ACKED_ALM') &&
        rt.raisedAt !== null &&
        nowMs - rt.raisedAt >= STALE_AFTER_MS,
    }
  }

  /**
   * Danh sách cảnh báo trên màn hình, sắp theo (ưu tiên giảm dần, mới nhất
   * trước). Khi 20 cảnh báo ập đến cùng lúc, để thứ tự thời gian quyết định
   * cái nguy hiểm nhất nằm ở đâu là chuyện may rủi.
   */
  public summary(
    nowMs: number,
    names = new Map<string, string>()
  ): ActiveAlarm[] {
    return this.collect(ACTIVE_STATES, nowMs, names).sort(
      (a, b) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        (b.raisedAt ?? 0) - (a.raisedAt ?? 0)
    )
  }

  /** Cảnh báo đang bị tắt. Bắt buộc phải có màn hình này. */
  public inhibited(
    nowMs: number,
    names = new Map<string, string>()
  ): ActiveAlarm[] {
    return this.collect(INHIBITED_STATES, nowMs, names).sort(
      (a, b) => a.state.localeCompare(b.state) || a.tag.localeCompare(b.tag)
    )
  }

  private collect(
    states: readonly AlarmState[],
    nowMs: number,
    names: Map<string, string>
  ): ActiveAlarm[] {
    const rows: ActiveAlarm[] = []
    for (const [tag, rt] of this.runtime) {
      if (!states.includes(rt.state)) continue
      const defn = this.definitions.get(tag)
      if (defn) rows.push(this.entry(defn, rt, nowMs, names))
    }
    return rows
  }

  public stateCounts(): AlarmCounts {
    const counts = Object.fromEntries(
      ALARM_STATES.map((s) => [s, 0])
    ) as AlarmCounts
    for (const rt of this.runtime.values()) counts[rt.state] += 1
    return counts
  }

  public definitionRows(): Array<AlarmDefinition & { state: AlarmState }> {
    return [...this.definitions.values()]
      .map((d) => ({ ...d, state: this.runtime.get(d.tag)!.state }))
      .sort(
        (a, b) =>
          a.assetCode.localeCompare(b.assetCode) ||
          PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
          a.tag.localeCompare(b.tag)
      )
  }
}

/**
 * Sinh cấu hình cảnh báo từ hồ sơ thiết bị.
 *
 * Cùng một bộ công thức với `infra/db/init/05-alarms.sql`: ngưỡng nằm ở hồ sơ
 * máy, cảnh báo chỉ trỏ tới nó. Gõ lại tay từng con số ở hai nơi là tạo ra hai
 * nguồn sự thật rồi chờ chúng lệch nhau.
 */
export function definitionsForAsset(asset: {
  assetCode: string
  name: string
  warnTemp: number
  critTemp: number
  warnVibration: number
  nominalPower: number
}): AlarmDefinition[] {
  const { assetCode, name } = asset
  return [
    {
      tag: `${assetCode}.TEMP.HI`,
      assetCode,
      metric: 'temperature',
      comparison: 'HI',
      setpoint: asset.warnTemp,
      deadband: 3,
      onDelaySec: 6,
      offDelaySec: 10,
      priority: 'MEDIUM',
      alarmClass: 'PROCESS',
      message: `${name} — nhiệt độ vượt ngưỡng cảnh báo`,
      unit: '°C',
      consequence:
        'Sai lệch nhiệt độ kéo chất lượng mối hàn xuống; kéo dài sẽ sang mức HIHI và phải dừng máy.',
      operatorResponse:
        'Kiểm tra quạt làm mát và tải của máy, giảm tốc độ dây nếu cần.',
      responseTimeSec: 600,
      maxShelveSec: 28800,
    },
    {
      tag: `${assetCode}.TEMP.HIHI`,
      assetCode,
      metric: 'temperature',
      comparison: 'HIHI',
      setpoint: asset.critTemp,
      deadband: 5,
      // Độ trễ bật/tắt cố ý KHÔNG đối xứng: muốn biết thật nhanh, nhưng không
      // muốn nó nhấp nháy tắt khi máy đang nguội chậm.
      onDelaySec: 2,
      offDelaySec: 30,
      priority: 'HIGH',
      alarmClass: 'EQUIPMENT',
      message: `${name} — NHIỆT ĐỘ TỚI HẠN, nguy cơ hư hỏng`,
      unit: '°C',
      consequence:
        'Hỏng ổ trục/động cơ hoặc cháy bản mạch; dừng kế hoạch sản xuất ca.',
      operatorResponse: 'Dừng máy, cắt tải, gọi bảo trì cơ khí.',
      responseTimeSec: 60,
      maxShelveSec: 3600,
    },
    {
      tag: `${assetCode}.VIB.HI`,
      assetCode,
      metric: 'vibration',
      comparison: 'HI',
      setpoint: asset.warnVibration,
      deadband: 0.4,
      // Dài hơn hẳn nhiệt độ: rung là tín hiệu xung. Một xe nâng đi ngang qua
      // cũng làm kim nhảy. Cảnh báo rung không có độ trễ là nguồn chattering
      // kinh điển nhất trong một nhà máy.
      onDelaySec: 10,
      offDelaySec: 15,
      priority: 'MEDIUM',
      alarmClass: 'EQUIPMENT',
      message: `${name} — độ rung vượt ngưỡng`,
      unit: 'mm/s',
      consequence:
        'Vòng bi hoặc cân bằng trục đang xuống cấp; bỏ qua sẽ dẫn tới kẹt hỏng đột ngột.',
      operatorResponse:
        'Ghi nhận vào phiếu bảo trì, hẹn kiểm tra vòng bi trong ca kế tiếp.',
      responseTimeSec: 1800,
      maxShelveSec: 28800,
    },
    {
      tag: `${assetCode}.PWR.HI`,
      assetCode,
      metric: 'power_kw',
      comparison: 'HI',
      setpoint: Math.round(asset.nominalPower * 1.25 * 100) / 100,
      deadband: Math.round(asset.nominalPower * 0.05 * 100) / 100,
      onDelaySec: 30,
      offDelaySec: 60,
      priority: 'LOW',
      alarmClass: 'ENERGY',
      message: `${name} — công suất vượt 125% định mức`,
      unit: 'kW',
      consequence:
        'Chi phí điện tăng và có thể là dấu hiệu ma sát cơ học; không ảnh hưởng ngay tới sản phẩm.',
      operatorResponse: 'Ghi nhận để đối chiếu với báo cáo năng lượng cuối ca.',
      responseTimeSec: 3600,
      maxShelveSec: 28800,
    },
    {
      tag: `${assetCode}.ESTOP`,
      assetCode,
      metric: 'estop',
      comparison: 'BOOL',
      setpoint: 1,
      deadband: 0,
      // Bằng không cả hai chiều. Cảnh báo an toàn không được trễ.
      onDelaySec: 0,
      offDelaySec: 0,
      priority: 'URGENT',
      alarmClass: 'SAFETY',
      message: `${name} — DỪNG KHẨN CẤP (E-Stop)`,
      unit: '',
      consequence: 'Dây chuyền dừng; sản phẩm đang trên băng có thể phải loại.',
      operatorResponse:
        'Xác định nguyên nhân dừng, giải trừ nguy hiểm, nhả nút và bấm Start để khởi động lại.',
      responseTimeSec: 10,
      // Cảnh báo an toàn không được phép shelve quá 5 phút.
      maxShelveSec: 300,
    },
  ]
}
