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
  acknowledgeAlarm: (alarmId: string) => void
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
  acknowledgeAlarm: (alarmId) => void mesLink.acknowledgeAlarm(alarmId),
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
  acknowledgeAlarm: (alarmId) => sensorSimulator.acknowledgeAlarm(alarmId),
  resetAll: () => sensorSimulator.resetAll(),
}

export function pickSource(mesEnabled: boolean): FactorySource {
  return mesEnabled ? liveSource : offlineSource
}

export const factorySource: FactorySource = pickSource(isMesEnabled())
