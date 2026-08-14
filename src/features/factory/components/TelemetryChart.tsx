import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Machine, TelemetryPoint } from '../types'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { Activity, Flame } from 'lucide-react'

interface TelemetryChartProps {
  machines: Machine[]
  telemetryHistory: Record<string, TelemetryPoint[]>
}

export function TelemetryChart({ machines, telemetryHistory }: TelemetryChartProps) {
  const [selectedMachineId, setSelectedMachineId] = useState<string>(machines[0]?.id || 'm1')
  const [activeMetric, setActiveMetric] = useState<'temp' | 'vibration'>('temp')

  const selectedMachine = machines.find((m) => m.id === selectedMachineId) || machines[0]
  const data = telemetryHistory[selectedMachineId] || []

  // Thresholds based on selected machine & metric
  const tempThreshold = selectedMachineId === 'm2' ? 280 : 80
  const vibThreshold = 5.0

  return (
    <Card className='border-border/60 bg-card/60 backdrop-blur-sm'>
      <CardHeader className='flex flex-col sm:flex-row items-start sm:items-center justify-between pb-3 space-y-2 sm:space-y-0'>
        <div>
          <CardTitle className='text-lg font-bold flex items-center gap-2'>
            {activeMetric === 'temp' ? <Flame className='h-5 w-5 text-amber-500' /> : <Activity className='h-5 w-5 text-blue-500' />}
            Biểu Đồ Telemetry Thời Gian Thực
          </CardTitle>
          <CardDescription>
            Theo dõi biến thiên {activeMetric === 'temp' ? 'Nhiệt độ (°C)' : 'Độ rung (mm/s)'} theo từng giây
          </CardDescription>
        </div>

        <div className='flex flex-wrap gap-2 items-center'>
          {/* Metric Selector */}
          <Tabs value={activeMetric} onValueChange={(val) => setActiveMetric(val as 'temp' | 'vibration')}>
            <TabsList className='h-8'>
              <TabsTrigger value='temp' className='text-xs px-2.5'>Nhiệt độ (°C)</TabsTrigger>
              <TabsTrigger value='vibration' className='text-xs px-2.5'>Độ rung (mm/s)</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Machine Selector */}
          <Tabs value={selectedMachineId} onValueChange={setSelectedMachineId}>
            <TabsList className='h-8'>
              {machines.map((m) => (
                <TabsTrigger key={m.id} value={m.id} className='text-xs px-2.5 font-mono'>
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
            <LineChart data={data} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray='3 3' stroke='rgba(255,255,255,0.08)' />
              <XAxis dataKey='timestamp' stroke='rgba(255,255,255,0.4)' fontSize={11} tickLine={false} />
              <YAxis stroke='rgba(255,255,255,0.4)' fontSize={11} tickLine={false} domain={['auto', 'auto']} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                  borderColor: 'rgba(255, 255, 255, 0.15)',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                  fontSize: '12px'
                }} 
              />
              
              {/* Threshold Limit Line */}
              <ReferenceLine 
                y={activeMetric === 'temp' ? tempThreshold : vibThreshold} 
                stroke='#ef4444' 
                strokeDasharray='4 4' 
                label={{ value: 'Ngưỡng nguy hiểm', fill: '#ef4444', fontSize: 10, position: 'top' }} 
              />

              <Line
                type='monotone'
                dataKey={activeMetric}
                stroke={activeMetric === 'temp' ? '#f59e0b' : '#3b82f6'}
                strokeWidth={2.5}
                dot={{ r: 3, fill: activeMetric === 'temp' ? '#f59e0b' : '#3b82f6' }}
                activeDot={{ r: 6 }}
                animationDuration={300}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
