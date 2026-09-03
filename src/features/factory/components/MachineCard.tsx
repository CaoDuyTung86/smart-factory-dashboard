import { memo } from 'react'
import { Activity, AlertTriangle, Flame, Wrench, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { type Machine } from '../types'

interface MachineCardProps {
  machine: Machine
  onTriggerFault: (
    machineId: string,
    faultType: 'overheat' | 'vibration' | 'emergency_stop'
  ) => void
  onRepair: (machineId: string) => void
}

export const MachineCard = memo(function MachineCard({
  machine,
  onTriggerFault,
  onRepair,
}: MachineCardProps) {
  const getStatusBadge = () => {
    switch (machine.status) {
      case 'running':
        return (
          <Badge className='flex items-center gap-1.5 border-emerald-500/30 bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25'>
            <span className='h-2 w-2 rounded-full bg-emerald-500' />
            Running
          </Badge>
        )
      case 'warning':
        return (
          <Badge className='flex items-center gap-1.5 border-amber-500/30 bg-amber-500/15 text-amber-500 hover:bg-amber-500/25'>
            <span className='h-2 w-2 animate-pulse rounded-full bg-amber-500' />
            Warning
          </Badge>
        )
      case 'error':
        return (
          <Badge
            variant='destructive'
            className='flex animate-pulse items-center gap-1.5'
          >
            <AlertTriangle className='h-3.5 w-3.5' />
            Fault / Stop
          </Badge>
        )
      default:
        return <Badge variant='outline'>Idle</Badge>
    }
  }

  const progressPercent = Math.min(
    100,
    Math.round((machine.output / machine.targetOutput) * 100)
  )
  const isHighTempOrVib =
    machine.temperature > 80 ||
    machine.vibration > 5.0 ||
    machine.status !== 'running'

  return (
    <Card
      className={`relative overflow-hidden transition-all duration-300 ${
        machine.status === 'error'
          ? 'border-destructive/60 bg-destructive/10 shadow-lg shadow-destructive/10'
          : machine.status === 'warning'
            ? 'border-amber-500/50 bg-amber-500/5'
            : 'border-border/60 bg-card/60 hover:border-primary/40'
      }`}
    >
      {/* Status top accent line */}
      <div
        className={`h-1 w-full ${
          machine.status === 'running'
            ? 'bg-emerald-500'
            : machine.status === 'warning'
              ? 'bg-amber-500'
              : 'bg-destructive'
        }`}
      />

      <CardHeader className='pt-4 pb-3'>
        <div className='flex items-start justify-between'>
          <div>
            <span className='font-mono text-xs tracking-wider text-muted-foreground uppercase'>
              {machine.code}
            </span>
            <CardTitle className='mt-0.5 text-lg font-bold'>
              {machine.name}
            </CardTitle>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>

      <CardContent className='space-y-3 pb-4 text-sm'>
        {/* Sensor Readouts Grid */}
        <div className='grid grid-cols-2 gap-2 pt-1'>
          <div className='rounded-lg border border-border/40 bg-muted/40 p-2'>
            <div className='mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground'>
              <Flame className='h-3 w-3 text-amber-500' />
              <span>Nhiệt độ</span>
            </div>
            <div
              className={`font-mono text-base font-bold ${machine.temperature > 80 ? 'animate-pulse text-destructive' : ''}`}
            >
              {machine.temperature.toFixed(1)}{' '}
              <span className='text-xs font-normal text-muted-foreground'>
                °C
              </span>
            </div>
          </div>

          <div className='rounded-lg border border-border/40 bg-muted/40 p-2'>
            <div className='mb-0.5 flex items-center gap-1 text-[11px] text-muted-foreground'>
              <Activity className='h-3 w-3 text-blue-500' />
              <span>Độ rung</span>
            </div>
            <div
              className={`font-mono text-base font-bold ${machine.vibration > 5.0 ? 'animate-pulse text-destructive' : ''}`}
            >
              {machine.vibration.toFixed(2)}{' '}
              <span className='text-xs font-normal text-muted-foreground'>
                mm/s
              </span>
            </div>
          </div>
        </div>

        {/* Production Output Progress */}
        <div className='space-y-1'>
          <div className='flex justify-between text-xs'>
            <span className='text-[11px] text-muted-foreground'>
              Sản lượng:{' '}
              <strong className='text-foreground'>
                {machine.output.toLocaleString()}
              </strong>{' '}
              / {machine.targetOutput.toLocaleString()}
            </span>
            <span className='font-mono text-[11px] font-medium'>
              {progressPercent}%
            </span>
          </div>
          <Progress value={progressPercent} className='h-1.5' />
        </div>

        {/* Secondary Info */}
        <div className='flex items-center justify-between border-t border-border/40 pt-1 text-[11px] text-muted-foreground'>
          <span className='flex items-center gap-1'>
            <Zap className='h-3 w-3 text-amber-400' /> {machine.powerUsage} kW
          </span>
          <span>
            Phế phẩm:{' '}
            <strong className={machine.defects > 30 ? 'text-amber-500' : ''}>
              {machine.defects} pcs
            </strong>
          </span>
        </div>

        {/* Action Controls & Repair Button */}
        <div className='space-y-1.5 pt-1'>
          {isHighTempOrVib && (
            <Button
              size='sm'
              className='h-8 w-full gap-1.5 bg-emerald-600 text-xs font-bold text-white shadow-md shadow-emerald-500/20 hover:bg-emerald-500'
              onClick={() => onRepair(machine.id)}
            >
              <Wrench className='h-3.5 w-3.5' /> 🔧 Sửa Máy & Hạ Nhiệt
            </Button>
          )}

          <div className='grid grid-cols-2 gap-1.5'>
            <Button
              size='sm'
              variant='outline'
              className='h-7 px-1 text-[11px] text-amber-500 hover:bg-amber-500/10 hover:text-amber-400'
              onClick={() => onTriggerFault(machine.id, 'overheat')}
            >
              🔥 Quá nhiệt
            </Button>
            <Button
              size='sm'
              variant='outline'
              className='h-7 px-1 text-[11px] text-destructive hover:bg-destructive/10'
              onClick={() => onTriggerFault(machine.id, 'vibration')}
            >
              ⚠️ Rung lắc
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})
