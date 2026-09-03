import { Gauge, CheckCircle2, Clock, Zap } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { type OeeMetrics } from '../types'

interface OeeGaugeProps {
  oee: OeeMetrics
}

export function OeeGauge({ oee }: OeeGaugeProps) {
  const getOeeColor = (val: number) => {
    if (val >= 85) return 'text-emerald-500'
    if (val >= 70) return 'text-amber-500'
    return 'text-destructive'
  }

  return (
    <Card className='border-border/60 bg-card/60'>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 text-lg font-bold'>
          <Gauge className='h-5 w-5 text-emerald-500' />
          Hiệu Suất Tổng Thể Nhà Máy (OEE)
        </CardTitle>
        <CardDescription>
          Overall Equipment Effectiveness (Tiêu chuẩn thế giới: ≥85%)
        </CardDescription>
      </CardHeader>

      <CardContent className='space-y-4 pt-2'>
        {/* Main OEE Big Score */}
        <div className='flex items-center justify-between rounded-xl border border-border/40 bg-muted/30 p-4'>
          <div>
            <span className='text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
              OEE Global Score
            </span>
            <div
              className={`mt-1 font-mono text-4xl font-black ${getOeeColor(oee.overall)}`}
            >
              {oee.overall}%
            </div>
          </div>
          <div className='space-y-1 text-right text-xs text-muted-foreground'>
            <div>
              {oee.overall >= 85
                ? '🟢 Đạt KPI World-class (≥85%)'
                : oee.overall >= 70
                  ? '🟡 Dưới chuẩn World-class'
                  : '🔴 Cần cải tiến khẩn cấp'}
            </div>
            <div>⚡ Luỹ kế theo ca hiện tại</div>
          </div>
        </div>

        {/* 3 Component Breakdown */}
        <div className='space-y-3'>
          {/* Availability */}
          <div className='space-y-1'>
            <div className='flex justify-between text-xs'>
              <span className='flex items-center gap-1.5 font-medium'>
                <Clock className='h-3.5 w-3.5 text-blue-500' /> Availability
                (Khả dụng)
              </span>
              <span className='font-mono font-bold'>{oee.availability}%</span>
            </div>
            <Progress value={oee.availability} className='h-2' />
          </div>

          {/* Performance */}
          <div className='space-y-1'>
            <div className='flex justify-between text-xs'>
              <span className='flex items-center gap-1.5 font-medium'>
                <Zap className='h-3.5 w-3.5 text-amber-500' /> Performance (Hiệu
                suất)
              </span>
              <span className='font-mono font-bold'>{oee.performance}%</span>
            </div>
            <Progress value={oee.performance} className='h-2' />
          </div>

          {/* Quality */}
          <div className='space-y-1'>
            <div className='flex justify-between text-xs'>
              <span className='flex items-center gap-1.5 font-medium'>
                <CheckCircle2 className='h-3.5 w-3.5 text-emerald-500' />{' '}
                Quality (Chất lượng)
              </span>
              <span className='font-mono font-bold'>{oee.quality}%</span>
            </div>
            <Progress value={oee.quality} className='h-2' />
          </div>
        </div>

        {/* Công thức đang dùng — đúng định nghĩa Nakajima / SEMI E10 */}
        <div className='rounded-lg border border-border/40 bg-muted/20 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground'>
          <div>A = Run Time / Planned Production Time</div>
          <div>P = (Ideal Cycle Time × Total Count) / Run Time</div>
          <div>Q = Good Count / Total Count &nbsp;|&nbsp; OEE = A × P × Q</div>
        </div>
      </CardContent>
    </Card>
  )
}
