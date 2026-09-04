import { useSyncExternalStore } from 'react'
import { alarmChime } from '../services/alarmChime'
import { factorySource } from '../services/factorySource'
import { mesLink } from '../services/mesLink'
import type { FactoryState } from '../types'

/**
 * Đăng ký một component vào một lát dữ liệu của dây chuyền.
 *
 * Selector phải trả về một giá trị mà nguồn dữ liệu giữ nguyên tham chiếu giữa
 * hai lần thay đổi (một lát của snapshot, hoặc một primitive) — dựng object mới
 * ngay trong selector sẽ khiến React thấy giá trị mới ở mỗi lần đọc và lặp vô
 * hạn.
 *
 * Đọc theo từng lát là thứ giữ chi phí thấp: một tick chỉ làm thay đổi telemetry
 * sẽ vẽ lại lưới máy, không vẽ lại Digital Twin hay tab PLC.
 *
 * Nguồn dữ liệu là simulator hay backend MES do `factorySource` quyết định —
 * component không cần biết, và không nên biết.
 */
export function useFactoryStore<T>(selector: (state: FactoryState) => T): T {
  return useSyncExternalStore(factorySource.subscribe, () =>
    selector(factorySource.getSnapshot())
  )
}

/**
 * Trạng thái đường truyền tới backend MES, dùng cho phù hiệu LIVE / MẤT KẾT
 * NỐI. Ở chế độ simulator thì luôn là 'disabled'.
 */
export function useMesLinkStatus() {
  return useSyncExternalStore(mesLink.subscribe, mesLink.getMeta)
}

/**
 * Còi cảnh báo của chính máy này. Không nằm trong `FactoryState` vì đó là thiết
 * lập của trạm vận hành, không phải trạng thái của dây chuyền.
 */
export function useAlarmAudio(): boolean {
  return useSyncExternalStore(alarmChime.subscribe, alarmChime.isEnabled)
}
