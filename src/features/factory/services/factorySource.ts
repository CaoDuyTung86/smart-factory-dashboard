/**
 * Chọn nguồn dữ liệu cho tab SCADA, và là chỗ duy nhất trong frontend biết có
 * hai nguồn.
 *
 *   Có `VITE_MES_API_URL`  ->  backend MES (WebSocket + TimescaleDB)
 *   Không có               ->  simulator chạy trong trình duyệt
 *
 * Việc chọn diễn ra một lần lúc nạp trang chứ không đổi giữa chừng. Đã cấu
 * hình MES mà backend chết thì màn hình đứng lại và báo mất kết nối, chứ không
 * lặng lẽ tụt về dữ liệu mô phỏng — xem ghi chú trong `mesLink.ts`.
 */
import type { FactoryState, FeedDensity } from '../types'
import { isMesEnabled } from './mesApi'
import { mesLink } from './mesLink'
import { sensorSimulator } from './sensorSimulator'

export type FaultType = 'overheat' | 'vibration' | 'emergency_stop'

export interface FactorySource {
  /** 'mes' khi số liệu do backend phát ra, 'simulator' khi sinh tại trình duyệt. */
  kind: 'mes' | 'simulator'
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => FactoryState
  setLineSpeed: (speed: number) => void
  setFeedDensity: (density: FeedDensity) => void
  triggerFault: (machineId: string, faultType: FaultType) => void
  repairMachine: (machineId: string) => void
  /**
   * Xác nhận theo `tag` của cảnh báo, không theo một id ngẫu nhiên mỗi lần kêu.
   * `tag` là danh tính bền của cảnh báo trong Master Alarm Database, dùng chung
   * từ cấu hình qua nhật ký tới màn hình — giống hệt cách mã tài sản thay cho
   * khoá `m1` của frontend.
   */
  acknowledgeAlarm: (tag: string) => void
  acknowledgeAsset: (machineId: string) => void
  acknowledgeAll: () => void
  /** Tạm gỡ khỏi màn hình, có hạn giờ và có lý do ghi lại. */
  shelveAlarm: (tag: string, seconds: number, reason: string) => void
  unshelveAlarm: (tag: string) => void
  setAlarmOutOfService: (tag: string, value: boolean) => void
  resetAll: () => void
}

const liveSource: FactorySource = {
  kind: 'mes',
  subscribe: mesLink.subscribe,
  getSnapshot: mesLink.getSnapshot,
  setLineSpeed: (speed) => void mesLink.setLineSpeed(speed),
  setFeedDensity: (density) => void mesLink.setFeedDensity(density),
  triggerFault: (machineId, faultType) =>
    void mesLink.triggerFault(machineId, faultType),
  repairMachine: (machineId) => void mesLink.repairMachine(machineId),
  acknowledgeAlarm: (tag) => void mesLink.acknowledgeAlarm(tag),
  acknowledgeAsset: (machineId) => void mesLink.acknowledgeAsset(machineId),
  acknowledgeAll: () => void mesLink.acknowledgeAll(),
  shelveAlarm: (tag, seconds, reason) =>
    void mesLink.shelveAlarm(tag, seconds, reason),
  unshelveAlarm: (tag) => void mesLink.unshelveAlarm(tag),
  setAlarmOutOfService: (tag, value) =>
    void mesLink.setAlarmOutOfService(tag, value),
  resetAll: () => void mesLink.resetAll(),
}

const offlineSource: FactorySource = {
  kind: 'simulator',
  subscribe: sensorSimulator.subscribe,
  getSnapshot: sensorSimulator.getSnapshot,
  setLineSpeed: (speed) => sensorSimulator.setLineSpeed(speed),
  setFeedDensity: (density) => sensorSimulator.setFeedDensity(density),
  triggerFault: (machineId, faultType) =>
    sensorSimulator.triggerFault(machineId, faultType),
  repairMachine: (machineId) => sensorSimulator.repairMachine(machineId),
  acknowledgeAlarm: (tag) => sensorSimulator.acknowledgeAlarm(tag),
  acknowledgeAsset: (machineId) => sensorSimulator.acknowledgeAsset(machineId),
  acknowledgeAll: () => sensorSimulator.acknowledgeAll(),
  shelveAlarm: (tag, seconds, reason) =>
    sensorSimulator.shelveAlarm(tag, seconds, reason),
  unshelveAlarm: (tag) => sensorSimulator.unshelveAlarm(tag),
  setAlarmOutOfService: (tag, value) =>
    sensorSimulator.setAlarmOutOfService(tag, value),
  resetAll: () => sensorSimulator.resetAll(),
}

export function pickSource(mesEnabled: boolean): FactorySource {
  return mesEnabled ? liveSource : offlineSource
}

export const factorySource: FactorySource = pickSource(isMesEnabled())
