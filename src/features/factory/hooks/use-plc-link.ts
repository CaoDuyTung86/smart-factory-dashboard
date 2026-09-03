import { useSyncExternalStore } from 'react'
import { plcGateway, type PlcLinkState } from '../services/plcGateway'

/**
 * Trạng thái PLC thật từ edge gateway. Khi chưa cấu hình gateway,
 * `state.enabled === false` và component tự quay về chế độ mô phỏng cục bộ.
 */
export function usePlcLink(): PlcLinkState {
  return useSyncExternalStore(plcGateway.subscribe, plcGateway.getSnapshot)
}
