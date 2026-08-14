import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Machine } from '../types'
import { Activity, AlertTriangle, Flame, Wrench, Zap } from 'lucide-react'

interface MachineCardProps {
  machine: Machine
  onTriggerFault: (machineId: string, faultType: 'overheat' | 'vibration' | 'emergency_stop') => void
  onReset: (machineId: string) => void
  onRepair: (machineId: string) => void
}

export function MachineCard({ machine, onTriggerFault, onRepair }: MachineCardProps) {
  const getStatusBadge = () => {
    switch (machine.status) {
      case 'running':
        return (
          <Badge className='bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25 border-emerald-500/30 flex items-center gap-1.5'>
            <span className='h-2 w-2 rounded-full bg-emerald-500 animate-pulse' />
            Running
          </Badge>
        )
      case 'warning':
        return (
          <Badge className='bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 border-amber-500/30 flex items-center gap-1.5'>
            <span className='h-2 w-2 rounded-full bg-amber-500 animate-ping' />
            Warning
          </Badge>
        )
      case 'error':
        return (
          <Badge variant='destructive' className='flex items-center gap-1.5 animate-bounce'>
            <AlertTriangle className='h-3.5 w-3.5' />
            Fault / Stop
          </Badge>
        )
      default:
        return <Badge variant='outline'>Idle</Badge>
    }
  }

  const progressPercent = Math.min(100, Math.round((machine.output / machine.targetOutput) * 100))
  const isHighTempOrVib = machine.temperature > 80 || machine.vibration > 5.0 || machine.status !== 'running'

  return (
    <Card className={`relative overflow-hidden transition-all duration-300 ${
      machine.status === 'error' 
        ? 'border-destructive/60 bg-destructive/10 shadow-lg shadow-destructive/10' 
        : machine.status === 'warning'
        ? 'border-amber-500/50 bg-amber-500/5'
        : 'border-border/60 hover:border-primary/40 bg-card/60 backdrop-blur-sm'
    }`}>
      {/* Status top accent line */}
      <div className={`h-1 w-full ${
        machine.status === 'running' ? 'bg-emerald-500' : machine.status === 'warning' ? 'bg-amber-500' : 'bg-destructive'
      }`} />

      <CardHeader className='pb-3 pt-4'>
        <div className='flex items-start justify-between'>
          <div>
            <span className='text-xs font-mono text-muted-foreground uppercase tracking-wider'>{machine.code}</span>
            <CardTitle className='text-lg font-bold mt-0.5'>{machine.name}</CardTitle>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>

      <CardContent className='space-y-3 text-sm pb-4'>
        {/* Sensor Readouts Grid */}
        <div className='grid grid-cols-2 gap-2 pt-1'>
          <div className='rounded-lg bg-muted/40 p-2 border border-border/40'>
            <div className='flex items-center gap-1 text-[11px] text-muted-foreground mb-0.5'>
              <Flame className='h-3 w-3 text-amber-500' />
              <span>Nhiệt độ</span>
            </div>
            <div className={`text-base font-bold font-mono ${machine.temperature > 80 ? 'text-destructive animate-pulse' : ''}`}>
              {machine.temperature.toFixed(1)} <span className='text-xs font-normal text-muted-foreground'>°C</span>
            </div>
          </div>

          <div className='rounded-lg bg-muted/40 p-2 border border-border/40'>
            <div className='flex items-center gap-1 text-[11px] text-muted-foreground mb-0.5'>
              <Activity className='h-3 w-3 text-blue-500' />
              <span>Độ rung</span>
            </div>
            <div className={`text-base font-bold font-mono ${machine.vibration > 5.0 ? 'text-destructive animate-pulse' : ''}`}>
              {machine.vibration.toFixed(2)} <span className='text-xs font-normal text-muted-foreground'>mm/s</span>
            </div>
          </div>
        </div>

        {/* Production Output Progress */}
        <div className='space-y-1'>
          <div className='flex justify-between text-xs'>
            <span className='text-muted-foreground text-[11px]'>Sản lượng: <strong className='text-foreground'>{machine.output.toLocaleString()}</strong> / {machine.targetOutput.toLocaleString()}</span>
            <span className='font-mono font-medium text-[11px]'>{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className='h-1.5' />
        </div>

        {/* Secondary Info */}
        <div className='flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40'>
          <span className='flex items-center gap-1'>
            <Zap className='h-3 w-3 text-amber-400' /> {machine.powerUsage} kW
          </span>
          <span>Phế phẩm: <strong className={machine.defects > 30 ? 'text-amber-500' : ''}>{machine.defects} pcs</strong></span>
        </div>

        {/* Action Controls & Repair Button */}
        <div className='space-y-1.5 pt-1'>
          {isHighTempOrVib && (
            <Button
              size='sm'
              className='w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold gap-1.5 shadow-md shadow-emerald-500/20'
              onClick={() => onRepair(machine.id)}
            >
              <Wrench className='h-3.5 w-3.5' /> 🔧 Sửa Máy & Hạ Nhiệt
            </Button>
          )}

          <div className='grid grid-cols-2 gap-1.5'>
            <Button 
              size='sm' 
              variant='outline'
              className='h-7 text-[11px] px-1 text-amber-500 hover:text-amber-400 hover:bg-amber-500/10'
              onClick={() => onTriggerFault(machine.id, 'overheat')}
            >
              🔥 Quá nhiệt
            </Button>
            <Button 
              size='sm' 
              variant='outline'
              className='h-7 text-[11px] px-1 text-destructive hover:bg-destructive/10'
              onClick={() => onTriggerFault(machine.id, 'vibration')}
            >
              ⚠️ Rung lắc
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
