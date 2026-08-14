import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { OeeMetrics } from '../types'
import { Gauge, CheckCircle2, Clock, Zap } from 'lucide-react'

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
    <Card className='border-border/60 bg-card/60 backdrop-blur-sm'>
      <CardHeader className='pb-2'>
        <CardTitle className='text-lg font-bold flex items-center gap-2'>
          <Gauge className='h-5 w-5 text-emerald-500' />
          Hiệu Suất Tổng Thể Nhà Máy (OEE)
        </CardTitle>
        <CardDescription>Overall Equipment Effectiveness (Tiêu chuẩn thế giới: ≥85%)</CardDescription>
      </CardHeader>

      <CardContent className='space-y-4 pt-2'>
        {/* Main OEE Big Score */}
        <div className='flex items-center justify-between p-4 rounded-xl bg-muted/30 border border-border/40'>
          <div>
            <span className='text-xs text-muted-foreground uppercase font-semibold tracking-wider'>OEE Global Score</span>
            <div className={`text-4xl font-black font-mono mt-1 ${getOeeColor(oee.overall)}`}>
              {oee.overall}%
            </div>
          </div>
          <div className='text-right text-xs text-muted-foreground space-y-1'>
            <div>🟢 Thỏa mãn KPI sản xuất</div>
            <div>⚡ Cập nhật theo ca 8h</div>
          </div>
        </div>

        {/* 3 Component Breakdown */}
        <div className='space-y-3'>
          {/* Availability */}
          <div className='space-y-1'>
            <div className='flex justify-between text-xs'>
              <span className='flex items-center gap-1.5 font-medium'>
                <Clock className='h-3.5 w-3.5 text-blue-500' /> Availability (Khả dụng)
              </span>
              <span className='font-mono font-bold'>{oee.availability}%</span>
            </div>
            <Progress value={oee.availability} className='h-2' />
          </div>

          {/* Performance */}
          <div className='space-y-1'>
            <div className='flex justify-between text-xs'>
              <span className='flex items-center gap-1.5 font-medium'>
                <Zap className='h-3.5 w-3.5 text-amber-500' /> Performance (Hiệu suất)
              </span>
              <span className='font-mono font-bold'>{oee.performance}%</span>
            </div>
            <Progress value={oee.performance} className='h-2' />
          </div>

          {/* Quality */}
          <div className='space-y-1'>
            <div className='flex justify-between text-xs'>
              <span className='flex items-center gap-1.5 font-medium'>
                <CheckCircle2 className='h-3.5 w-3.5 text-emerald-500' /> Quality (Chất lượng)
              </span>
              <span className='font-mono font-bold'>{oee.quality}%</span>
            </div>
            <Progress value={oee.quality} className='h-2' />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
