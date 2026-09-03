import { Flame, AlertOctagon, RotateCcw, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface ControlPanelProps {
  onTriggerFault: (
    machineId: string,
    faultType: 'overheat' | 'vibration' | 'emergency_stop'
  ) => void
  onResetAll: () => void
}

export function ControlPanel({
  onTriggerFault,
  onResetAll,
}: ControlPanelProps) {
  return (
    <Card className='border border-primary/20 bg-gradient-to-r from-primary/5 via-card to-card'>
      <CardContent className='flex flex-col items-center justify-between gap-4 p-4 sm:flex-row'>
        <div>
          <h4 className='flex items-center gap-2 text-sm font-bold'>
            <span>
              🎮 Bảng Tương Tác Mô Phỏng Sự Cố (Fault Injection Console)
            </span>
          </h4>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            Sử dụng các nút bấm dưới đây để tạo sự cố ảo và trải nghiệm tính
            năng phát hiện & cảnh báo thời gian thực.
          </p>
        </div>

        <div className='flex w-full flex-wrap items-center gap-2 sm:w-auto'>
          <Button
            size='sm'
            variant='outline'
            className='gap-1.5 border-amber-500/30 text-xs text-amber-500 hover:bg-amber-500/10'
            onClick={() => onTriggerFault('m1', 'overheat')}
          >
            <Flame className='h-3.5 w-3.5' /> Lỗi SMT Overheat
          </Button>

          <Button
            size='sm'
            variant='outline'
            className='gap-1.5 border-blue-400/30 text-xs text-blue-400 hover:bg-blue-400/10'
            onClick={() => onTriggerFault('m3', 'vibration')}
          >
            <Activity className='h-3.5 w-3.5' /> Lỗi CNC Rung Lắc
          </Button>

          <Button
            size='sm'
            variant='destructive'
            className='gap-1.5 text-xs'
            onClick={() => onTriggerFault('m2', 'emergency_stop')}
          >
            <AlertOctagon className='h-3.5 w-3.5' /> Dừng Khẩn Cấp (E-Stop)
          </Button>

          <Button
            size='sm'
            variant='secondary'
            className='gap-1.5 text-xs'
            onClick={onResetAll}
          >
            <RotateCcw className='h-3.5 w-3.5' /> Khôi Phục Tất Cả
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
