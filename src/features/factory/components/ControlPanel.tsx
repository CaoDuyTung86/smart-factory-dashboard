import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Flame, AlertOctagon, RotateCcw, Activity } from 'lucide-react'

interface ControlPanelProps {
  onTriggerFault: (machineId: string, faultType: 'overheat' | 'vibration' | 'emergency_stop') => void
  onResetAll: () => void
}

export function ControlPanel({ onTriggerFault, onResetAll }: ControlPanelProps) {
  return (
    <Card className='border-primary/20 bg-gradient-to-r from-primary/5 via-card to-card border backdrop-blur-sm'>
      <CardContent className='p-4 flex flex-col sm:flex-row items-center justify-between gap-4'>
        <div>
          <h4 className='font-bold text-sm flex items-center gap-2'>
            <span>🎮 Bảng Tương Tác Mô Phỏng Sự Cố (Fault Injection Console)</span>
          </h4>
          <p className='text-xs text-muted-foreground mt-0.5'>
            Sử dụng các nút bấm dưới đây để tạo sự cố ảo và trải nghiệm tính năng phát hiện & cảnh báo thời gian thực.
          </p>
        </div>

        <div className='flex flex-wrap items-center gap-2 w-full sm:w-auto'>
          <Button
            size='sm'
            variant='outline'
            className='text-xs text-amber-500 border-amber-500/30 hover:bg-amber-500/10 gap-1.5'
            onClick={() => onTriggerFault('m1', 'overheat')}
          >
            <Flame className='h-3.5 w-3.5' /> Lỗi SMT Overheat
          </Button>

          <Button
            size='sm'
            variant='outline'
            className='text-xs text-blue-400 border-blue-400/30 hover:bg-blue-400/10 gap-1.5'
            onClick={() => onTriggerFault('m3', 'vibration')}
          >
            <Activity className='h-3.5 w-3.5' /> Lỗi CNC Rung Lắc
          </Button>

          <Button
            size='sm'
            variant='destructive'
            className='text-xs gap-1.5'
            onClick={() => onTriggerFault('m2', 'emergency_stop')}
          >
            <AlertOctagon className='h-3.5 w-3.5' /> Dừng Khẩn Cấp (E-Stop)
          </Button>

          <Button
            size='sm'
            variant='secondary'
            className='text-xs gap-1.5'
            onClick={onResetAll}
          >
            <RotateCcw className='h-3.5 w-3.5' /> Khôi Phục Tất Cả
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
