import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Cpu, Zap, Activity, Play, Pause, RotateCcw, Sliders, TrendingUp, AlertTriangle, Sparkles } from 'lucide-react'
import { sensorSimulator } from '../services/sensorSimulator'

interface StationInfo {
  id: string
  name: string
  code: string
  type: string
  status: 'ACTIVE' | 'IDLE' | 'BUSY'
  actuators: {
    cylinder: 'EXTENDED' | 'RETRACTED'
    vacuum: 'ON' | 'OFF'
    servoX: number
    servoY: number
    servoZ: number
    doorSensor: boolean
  }
}

export function DigitalTwinLine() {
  const [isPlaying, setIsPlaying] = useState(true)
  const [pcbPosition, setPcbPosition] = useState(15)
  const [activeStationId, setActiveStationId] = useState('st2')

  // Simulation Controls
  const [lineSpeed, setLineSpeed] = useState<number>(1.0)
  const [feedDensity, setFeedDensity] = useState<'LOW' | 'NORMAL' | 'HIGH'>('NORMAL')

  useEffect(() => {
    sensorSimulator.setLineSpeed(lineSpeed)
  }, [lineSpeed])

  useEffect(() => {
    sensorSimulator.setFeedDensity(feedDensity)
  }, [feedDensity])

  useEffect(() => {
    if (!isPlaying) return
    const intervalTime = Math.max(40, Math.round(150 / lineSpeed))
    const interval = setInterval(() => {
      setPcbPosition((prev) => (prev >= 95 ? 5 : prev + 1))
    }, intervalTime)
    return () => clearInterval(interval)
  }, [isPlaying, lineSpeed])

  // Optimize Golden Sweet Spot
  const handleAutoOptimize = () => {
    setLineSpeed(1.2)
    setFeedDensity('NORMAL')
  }

  const stations: StationInfo[] = [
    {
      id: 'st1',
      name: 'Máy Lên Bản (PCB Loader)',
      code: 'LOADER-01',
      type: 'Feed Mechanism',
      status: pcbPosition < 20 ? 'BUSY' : 'ACTIVE',
      actuators: {
        cylinder: pcbPosition < 20 ? 'EXTENDED' : 'RETRACTED',
        vacuum: 'OFF',
        servoX: 12.0,
        servoY: 0,
        servoZ: pcbPosition < 20 ? 45.0 : 0,
        doorSensor: true,
      },
    },
    {
      id: 'st2',
      name: 'Máy Dán Linh Kiện SMT',
      code: 'PICK-PLACE-02',
      type: 'Placement Technology',
      status: pcbPosition >= 30 && pcbPosition <= 50 ? 'BUSY' : 'ACTIVE',
      actuators: {
        cylinder: 'RETRACTED',
        vacuum: pcbPosition >= 35 && pcbPosition <= 45 ? 'ON' : 'OFF',
        servoX: Number((120 + Math.sin(Date.now() / (300 / lineSpeed)) * 35).toFixed(1)),
        servoY: Number((80 + Math.cos(Date.now() / (300 / lineSpeed)) * 25).toFixed(1)),
        servoZ: pcbPosition >= 35 && pcbPosition <= 45 ? -15.2 : 5.0,
        doorSensor: true,
      },
    },
    {
      id: 'st3',
      name: 'Lò Hàn Hồi Lưu Reflow',
      code: 'REFLOW-OVEN-03',
      type: 'Thermal Process',
      status: pcbPosition > 50 && pcbPosition < 70 ? 'BUSY' : 'ACTIVE',
      actuators: {
        cylinder: 'RETRACTED',
        vacuum: 'OFF',
        servoX: 0,
        servoY: 0,
        servoZ: 0,
        doorSensor: true,
      },
    },
    {
      id: 'st4',
      name: 'Camera Vision & AOI Inspector',
      code: 'AOI-VISION-04',
      type: 'Quality Inspection',
      status: pcbPosition >= 70 && pcbPosition <= 85 ? 'BUSY' : 'ACTIVE',
      actuators: {
        cylinder: pcbPosition >= 75 && pcbPosition <= 80 ? 'EXTENDED' : 'RETRACTED',
        vacuum: 'OFF',
        servoX: 210.5,
        servoY: 140.2,
        servoZ: -5.0,
        doorSensor: true,
      },
    },
    {
      id: 'st5',
      name: 'Máy Thu Bản (Unloader)',
      code: 'UNLOADER-05',
      type: 'Sorting & Stacking',
      status: pcbPosition > 85 ? 'BUSY' : 'IDLE',
      actuators: {
        cylinder: pcbPosition > 88 ? 'EXTENDED' : 'RETRACTED',
        vacuum: 'OFF',
        servoX: 0,
        servoY: 0,
        servoZ: pcbPosition > 88 ? 50.0 : 0,
        doorSensor: true,
      },
    },
  ]

  const selectedStation = stations.find((s) => s.id === activeStationId) || stations[1]

  // Calculated optimization metrics
  const predictedOutputPcs = Math.round(1800 * lineSpeed * (feedDensity === 'HIGH' ? 1.4 : feedDensity === 'LOW' ? 0.7 : 1.0))
  const predictedDefectPercent = lineSpeed > 2.0 ? Number((12.5 * (lineSpeed / 2.0)).toFixed(1)) : lineSpeed > 1.4 ? 4.2 : 0.2
  const isOverclocked = lineSpeed > 2.0

  return (
    <div className='space-y-6'>
      {/* Simulation & What-If Process Optimization Control Bar */}
      <Card className='border-amber-500/30 bg-amber-500/5 backdrop-blur-sm'>
        <CardContent className='p-4 space-y-4'>
          <div className='flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-amber-500/20 pb-3'>
            <div>
              <h4 className='font-bold text-sm flex items-center gap-2 text-foreground'>
                <Sliders className='h-4 w-4 text-amber-500' />
                <span>Bảng Thử Nghiệm Tối Ưu Hóa Dây Chuyền (What-If Line Process Optimization)</span>
              </h4>
              <p className='text-xs text-muted-foreground mt-0.5'>
                Thay đổi tốc độ băng tải & mật độ hàng để đánh giá tác động tới sản lượng, tỷ lệ phế phẩm và hiệu suất OEE
              </p>
            </div>

            <Button
              size='sm'
              className='gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold shadow-md shadow-amber-500/20'
              onClick={handleAutoOptimize}
            >
              <Sparkles className='h-3.5 w-3.5' /> Tự Động Tối Ưu Điểm Ngọt (Sweet Spot)
            </Button>
          </div>

          {/* Interactive Controls & Live Predictions */}
          <div className='grid grid-cols-1 md:grid-cols-4 gap-4 items-center text-xs'>
            {/* Line Speed Control Slider */}
            <div className='space-y-1.5 md:col-span-2 bg-background/50 p-3 rounded-lg border border-border/40'>
              <div className='flex justify-between font-medium'>
                <span>Tốc Độ Băng Tải / Robot: <strong className='font-mono text-primary text-sm'>{lineSpeed.toFixed(1)}x</strong></span>
                <span className={isOverclocked ? 'text-destructive font-bold animate-pulse' : 'text-emerald-500 font-bold'}>
                  {isOverclocked ? '⚠️ Nguy cơ Ép Tải (Overclocked)' : '🟢 Vận Hành An Toàn'}
                </span>
              </div>
              <input
                type='range'
                min='0.5'
                max='3.0'
                step='0.1'
                value={lineSpeed}
                onChange={(e) => setLineSpeed(parseFloat(e.target.value))}
                className='w-full accent-primary cursor-pointer'
              />
              <div className='flex justify-between text-[10px] text-muted-foreground font-mono'>
                <span>0.5x (Chậm / Tiết kiệm)</span>
                <span>1.0x (Chuẩn)</span>
                <span>2.0x (Nhanh)</span>
                <span>3.0x (Cực đại)</span>
              </div>
            </div>

            {/* Feed Density Selector */}
            <div className='space-y-1.5 bg-background/50 p-3 rounded-lg border border-border/40'>
              <span className='font-medium text-muted-foreground block'>Mật Độ Nạp PCB:</span>
              <div className='flex gap-1 pt-0.5'>
                {(['LOW', 'NORMAL', 'HIGH'] as const).map((d) => (
                  <Button
                    key={d}
                    size='sm'
                    variant={feedDensity === d ? 'default' : 'outline'}
                    className='flex-1 h-7 text-[10px] px-1'
                    onClick={() => setFeedDensity(d)}
                  >
                    {d === 'LOW' ? 'Thưa' : d === 'NORMAL' ? 'Vừa' : 'Dày'}
                  </Button>
                ))}
              </div>
            </div>

            {/* Predicted Analytics Output */}
            <div className='p-3 rounded-lg bg-background/50 border border-border/40 space-y-1 font-mono text-[11px]'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Dự báo Sản Lượng:</span>
                <strong className='text-emerald-400'>{predictedOutputPcs.toLocaleString()} pcs/h</strong>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Dự báo Phế Phẩm:</span>
                <strong className={predictedDefectPercent > 5 ? 'text-destructive font-bold' : 'text-foreground'}>
                  {predictedDefectPercent}%
                </strong>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conveyor 2D Digital Twin Header & Control */}
      <Card className='border-primary/30 bg-card/60 backdrop-blur-sm'>
        <CardHeader className='pb-3 flex flex-row items-center justify-between'>
          <div>
            <CardTitle className='text-lg font-bold flex items-center gap-2'>
              <Cpu className='h-5 w-5 text-primary' />
              2D/3D Digital Twin — Dây Chuyền Sản Xuất SMT Tự Động
            </CardTitle>
            <CardDescription>
              Mô phỏng chuyển động cơ khí, hành trình robot X/Y/Z và dòng luồng bo mạch PCB thời gian thực
            </CardDescription>
          </div>

          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setIsPlaying(!isPlaying)}
              className='gap-1.5 text-xs'
            >
              {isPlaying ? <Pause className='h-3.5 w-3.5' /> : <Play className='h-3.5 w-3.5' />}
              {isPlaying ? 'Tạm Dừng' : 'Tiếp Tục'}
            </Button>

            <Button
              size='sm'
              variant='outline'
              onClick={() => setPcbPosition(5)}
              className='gap-1.5 text-xs'
            >
              <RotateCcw className='h-3.5 w-3.5' /> Reset Vị Trí
            </Button>
          </div>
        </CardHeader>

        <CardContent className='space-y-6 pt-2'>
          {/* Interactive Animated Conveyor SVG Viewport */}
          <div className='relative w-full h-[220px] bg-slate-950/80 rounded-xl border border-primary/20 p-4 overflow-hidden shadow-inner'>
            <div className='absolute inset-0 opacity-15 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:16px_16px]' />

            {/* Main Conveyor Belt Graphic */}
            <div className='absolute left-8 right-8 top-[110px] h-6 bg-slate-800 rounded-md border border-slate-700 flex items-center justify-around overflow-hidden shadow-md'>
              <div className='w-full h-full bg-[linear-gradient(90deg,transparent_50%,rgba(59,130,246,0.3)_50%)] bg-[length:24px_100%] animate-[pulse_1s_infinite]' />
            </div>

            {/* Station Nodes along the line */}
            <div className='absolute left-8 right-8 top-6 flex justify-between items-center z-10'>
              {stations.map((st, idx) => {
                const isCurrent = activeStationId === st.id
                return (
                  <button
                    key={st.id}
                    onClick={() => setActiveStationId(st.id)}
                    className={`flex flex-col items-center gap-1.5 transition-all group ${
                      isCurrent ? 'scale-110' : 'hover:scale-105'
                    }`}
                  >
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-xs border transition-all ${
                        isCurrent
                          ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/40 ring-4 ring-primary/20'
                          : st.status === 'BUSY'
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/50 animate-pulse'
                          : 'bg-slate-900 text-slate-300 border-slate-700 group-hover:border-primary/50'
                      }`}
                    >
                      ST-0{idx + 1}
                    </div>

                    <span className='text-[10px] font-mono font-medium text-slate-400 max-w-[90px] text-center truncate'>
                      {st.name.split('(')[0]}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Animated PCB Component Traveling */}
            <div
              className='absolute top-[96px] z-20 transition-all duration-150 ease-linear'
              style={{ left: `calc(${pcbPosition}% + 20px)` }}
            >
              <div className='relative w-14 h-9 bg-emerald-700/90 border-2 border-emerald-400 rounded shadow-lg shadow-emerald-500/20 flex flex-col items-center justify-center text-[9px] font-mono text-emerald-100 font-bold'>
                <span>PCB-M3</span>
                <span className='text-[7px] text-emerald-300 opacity-80'>SMT PASS</span>
                <div className='absolute -top-1 -right-1 h-2 w-2 rounded-full bg-emerald-400 animate-ping' />
              </div>
            </div>
          </div>

          {/* Station Hardware Inspector Details */}
          <div className='grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-border/40 pt-4'>
            <div className='rounded-lg bg-muted/30 p-3 border border-border/40 space-y-2'>
              <span className='text-xs font-semibold text-muted-foreground uppercase tracking-wider block'>
                ⚙️ Cơ Cấu Vận Hành (Station Hardware)
              </span>
              <div className='text-sm font-bold'>{selectedStation.name}</div>
              <div className='text-xs font-mono text-muted-foreground'>Code: {selectedStation.code}</div>
              <Badge variant='outline' className='text-[10px] bg-primary/10 text-primary border-primary/30'>
                {selectedStation.type}
              </Badge>
            </div>

            {/* Pneumatic & Vacuum Actuators */}
            <div className='rounded-lg bg-muted/30 p-3 border border-border/40 space-y-2 text-xs'>
              <span className='font-semibold text-muted-foreground uppercase tracking-wider block text-[11px]'>
                💨 Khí Nén & Chân Không (Actuators)
              </span>

              <div className='flex justify-between items-center'>
                <span className='text-muted-foreground'>Xi-lanh Định Vị (Pneumatic):</span>
                <Badge
                  className={
                    selectedStation.actuators.cylinder === 'EXTENDED'
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/40 text-[10px]'
                      : 'bg-slate-800 text-slate-400 text-[10px]'
                  }
                >
                  {selectedStation.actuators.cylinder}
                </Badge>
              </div>

              <div className='flex justify-between items-center'>
                <span className='text-muted-foreground'>Hút Chân Không (Vacuum Nozzle):</span>
                <Badge
                  className={
                    selectedStation.actuators.vacuum === 'ON'
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-[10px]'
                      : 'bg-slate-800 text-slate-400 text-[10px]'
                  }
                >
                  {selectedStation.actuators.vacuum}
                </Badge>
              </div>
            </div>

            {/* Servo Motors Axis Readout */}
            <div className='rounded-lg bg-muted/30 p-3 border border-border/40 space-y-2 text-xs'>
              <span className='font-semibold text-muted-foreground uppercase tracking-wider block text-[11px]'>
                🤖 Trục Servo Robot X/Y/Z (Encoder Position)
              </span>

              <div className='grid grid-cols-3 gap-2 font-mono text-center pt-1'>
                <div className='bg-background/60 p-1.5 rounded border border-border/40'>
                  <div className='text-[10px] text-muted-foreground'>Trục X</div>
                  <div className='font-bold text-primary'>{selectedStation.actuators.servoX}mm</div>
                </div>

                <div className='bg-background/60 p-1.5 rounded border border-border/40'>
                  <div className='text-[10px] text-muted-foreground'>Trục Y</div>
                  <div className='font-bold text-blue-400'>{selectedStation.actuators.servoY}mm</div>
                </div>

                <div className='bg-background/60 p-1.5 rounded border border-border/40'>
                  <div className='text-[10px] text-muted-foreground'>Trục Z</div>
                  <div className='font-bold text-amber-400'>{selectedStation.actuators.servoZ}mm</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
