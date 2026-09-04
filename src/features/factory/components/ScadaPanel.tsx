import { memo } from 'react'
import { useFactoryStore } from '../hooks/use-factory-store'
import { formatDuration } from '../lib/format'
import { factorySource } from '../services/factorySource'
import { AlarmTable } from './AlarmTable'
import { ControlPanel } from './ControlPanel'
import { MachineCard } from './MachineCard'
import { OeeGauge } from './OeeGauge'
import { TelemetryChart } from './TelemetryChart'

// Module-scope handlers: stable identities, so memoised children are not
// invalidated by a new closure on every render.
const triggerFault = (
  machineId: string,
  faultType: 'overheat' | 'vibration' | 'emergency_stop'
) => factorySource.triggerFault(machineId, faultType)
const repairMachine = (machineId: string) =>
  factorySource.repairMachine(machineId)
const acknowledgeAlarm = (alarmId: string) =>
  factorySource.acknowledgeAlarm(alarmId)
const resetAll = () => factorySource.resetAll()

/**
 * Each section subscribes to the slice it draws. A tick that only changes
 * machine telemetry no longer re-renders the OEE gauge or the alarm log, and
 * nothing here re-renders the other dashboard tabs at all.
 */

const OeeSection = memo(function OeeSection() {
  const oee = useFactoryStore((s) => s.oee)
  return <OeeGauge oee={oee} />
})

/**
 * The raw counters behind Availability. A 30-second stop barely moves an
 * 8-hour shift percentage — that is genuinely how OEE behaves — so the downtime
 * clock is shown next to it, where a fault is visible the moment it happens.
 */
const ShiftStats = memo(function ShiftStats() {
  const machines = useFactoryStore((s) => s.machines)

  const runMs = machines.reduce((sum, m) => sum + m.runTimeMs, 0)
  const downMs = machines.reduce((sum, m) => sum + m.downTimeMs, 0)
  const stopped = machines.filter(
    (m) => m.status === 'error' || m.status === 'idle'
  ).length

  return (
    <div className='mt-4 rounded-xl border border-border/60 bg-card/60 p-3 text-xs'>
      <span className='mb-2 block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
        ⏱️ Đồng Hồ Thời Gian Ca (Planned Production Time)
      </span>
      <div className='grid grid-cols-3 gap-2 text-center font-mono'>
        <div className='rounded border border-border/40 bg-muted/30 p-2'>
          <div className='text-[10px] text-muted-foreground'>Run Time</div>
          <div className='font-bold text-emerald-500'>
            {formatDuration(runMs)}
          </div>
        </div>
        <div className='rounded border border-border/40 bg-muted/30 p-2'>
          <div className='text-[10px] text-muted-foreground'>Down Time</div>
          <div
            className={
              'font-bold ' +
              (stopped > 0 ? 'text-destructive' : 'text-foreground')
            }
          >
            {formatDuration(downMs)}
          </div>
        </div>
        <div className='rounded border border-border/40 bg-muted/30 p-2'>
          <div className='text-[10px] text-muted-foreground'>Máy đang dừng</div>
          <div
            className={
              'font-bold ' +
              (stopped > 0 ? 'text-destructive' : 'text-foreground')
            }
          >
            {stopped} / {machines.length}
          </div>
        </div>
      </div>
    </div>
  )
})

const TelemetrySection = memo(function TelemetrySection() {
  const machines = useFactoryStore((s) => s.machines)
  const telemetryHistory = useFactoryStore((s) => s.telemetryHistory)
  return (
    <TelemetryChart machines={machines} telemetryHistory={telemetryHistory} />
  )
})

const MachineGridSection = memo(function MachineGridSection() {
  const machines = useFactoryStore((s) => s.machines)
  const runningCount = machines.filter((m) => m.status === 'running').length

  return (
    <div>
      <div className='mb-4 flex items-center justify-between'>
        <h3 className='flex items-center gap-2 text-lg font-bold'>
          <span>🏭 Giám Sát Chi Tiết Máy Sản Xuất (Line Status)</span>
        </h3>
        <span className='font-mono text-xs text-muted-foreground'>
          Tổng số: {machines.length} Máy | {runningCount} Đang hoạt động
        </span>
      </div>

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {machines.map((machine) => (
          <MachineCard
            key={machine.id}
            machine={machine}
            onTriggerFault={triggerFault}
            onRepair={repairMachine}
          />
        ))}
      </div>
    </div>
  )
})

const AlarmSection = memo(function AlarmSection() {
  const alarms = useFactoryStore((s) => s.alarms)
  return (
    <AlarmTable
      alarms={alarms}
      onAcknowledge={acknowledgeAlarm}
      onRepair={repairMachine}
    />
  )
})

export function ScadaPanel() {
  return (
    <div className='space-y-6'>
      <ControlPanel onTriggerFault={triggerFault} onResetAll={resetAll} />

      <div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
        <div className='lg:col-span-1'>
          <OeeSection />
          <ShiftStats />
        </div>
        <div className='lg:col-span-2'>
          <TelemetrySection />
        </div>
      </div>

      <MachineGridSection />
      <AlarmSection />
    </div>
  )
}
