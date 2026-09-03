import { memo, useState } from 'react'
import { Activity, Flame } from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatClock } from '../lib/format'
import { type Machine, type TelemetryPoint } from '../types'

interface TelemetryChartProps {
  machines: Machine[]
  telemetryHistory: Record<string, TelemetryPoint[]>
}

export const TelemetryChart = memo(function TelemetryChart({
  machines,
  telemetryHistory,
}: TelemetryChartProps) {
  const [selectedMachineId, setSelectedMachineId] = useState<string>(
    machines[0]?.id || 'm1'
  )
  const [activeMetric, setActiveMetric] = useState<'temp' | 'vibration'>('temp')

  const data = telemetryHistory[selectedMachineId] || []

  // Thresholds based on selected machine & metric
  const tempThreshold = selectedMachineId === 'm2' ? 280 : 80
  const vibThreshold = 5.0

  return (
    <Card className='border-border/60 bg-card/60'>
      <CardHeader className='flex flex-col items-start justify-between space-y-2 pb-3 sm:flex-row sm:items-center sm:space-y-0'>
        <div>
          <CardTitle className='flex items-center gap-2 text-lg font-bold'>
            {activeMetric === 'temp' ? (
              <Flame className='h-5 w-5 text-amber-500' />
            ) : (
              <Activity className='h-5 w-5 text-blue-500' />
            )}
            Biểu Đồ Telemetry Thời Gian Thực
          </CardTitle>
          <CardDescription>
            Theo dõi biến thiên{' '}
            {activeMetric === 'temp' ? 'Nhiệt độ (°C)' : 'Độ rung (mm/s)'} theo
            từng giây
          </CardDescription>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {/* Metric Selector */}
          <Tabs
            value={activeMetric}
            onValueChange={(val) =>
              setActiveMetric(val as 'temp' | 'vibration')
            }
          >
            <TabsList className='h-8'>
              <TabsTrigger value='temp' className='px-2.5 text-xs'>
                Nhiệt độ (°C)
              </TabsTrigger>
              <TabsTrigger value='vibration' className='px-2.5 text-xs'>
                Độ rung (mm/s)
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Machine Selector */}
          <Tabs value={selectedMachineId} onValueChange={setSelectedMachineId}>
            <TabsList className='h-8'>
              {machines.map((m) => (
                <TabsTrigger
                  key={m.id}
                  value={m.id}
                  className='px-2.5 font-mono text-xs'
                >
                  {m.code.split('-')[0]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>

      <CardContent>
        <div className='h-[280px] w-full pt-4'>
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart
              data={data}
              margin={{ top: 10, right: 20, left: -10, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray='3 3'
                stroke='rgba(255,255,255,0.08)'
              />
              <XAxis
                dataKey='t'
                type='number'
                scale='time'
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatClock}
                stroke='rgba(255,255,255,0.4)'
                fontSize={11}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                stroke='rgba(255,255,255,0.4)'
                fontSize={11}
                tickLine={false}
                domain={['auto', 'auto']}
              />
              <Tooltip
                labelFormatter={(value) => formatClock(Number(value))}
                contentStyle={{
                  backgroundColor: 'rgba(15, 23, 42, 0.9)',
                  borderColor: 'rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  fontSize: '12px',
                }}
              />

              {/* Threshold Limit Line */}
              <ReferenceLine
                y={activeMetric === 'temp' ? tempThreshold : vibThreshold}
                stroke='#ef4444'
                strokeDasharray='4 4'
                label={{
                  value: 'Ngưỡng nguy hiểm',
                  fill: '#ef4444',
                  fontSize: 10,
                  position: 'top',
                }}
              />

              <Line
                type='monotone'
                dataKey={activeMetric}
                stroke={activeMetric === 'temp' ? '#f59e0b' : '#3b82f6'}
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
})
