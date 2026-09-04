import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cpu, Pause, Play, RotateCcw, Sliders, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useFactoryStore } from '../hooks/use-factory-store'
import { factorySource } from '../services/factorySource'
import type { FeedDensity } from '../types'

interface StationInfo {
  id: string
  name: string
  /** Asset code — the same identifier SCADA and MES use for this machine. */
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

/** Travel is quantised into 5% steps: 20 React renders per lap instead of ~90. */
const PHASE_STEP = 5
const POS_MIN = 5
const POS_MAX = 95
/** Percent of the track covered per millisecond at 1.0x line speed. */
const PERCENT_PER_MS = 1 / 150

/**
 * Bottleneck of the SMT line is the reflow oven (REFLOW-OVEN-02, ideal cycle
 * 0.45 s/unit), so line throughput is derived from it rather than a magic
 * number — the figure here matches what the SCADA tab actually counts.
 */
const BOTTLENECK_CYCLE_SEC = 0.45
const LINE_EFFICIENCY = 0.92

function buildStations(position: number, lineSpeed: number): StationInfo[] {
  // Deterministic sweep of the placement head, driven by travel position rather
  // than Date.now() — same picture, no render-on-every-frame requirement.
  const sweep = position * 0.14 * lineSpeed

  return [
    {
      id: 'st1',
      name: 'Máy Lên Bản (PCB Loader)',
      code: 'LOADER-A1',
      type: 'Feed Mechanism',
      status: position < 20 ? 'BUSY' : 'ACTIVE',
      actuators: {
        cylinder: position < 20 ? 'EXTENDED' : 'RETRACTED',
        vacuum: 'OFF',
        servoX: 12.0,
        servoY: 0,
        servoZ: position < 20 ? 45.0 : 0,
        doorSensor: true,
      },
    },
    {
      id: 'st2',
      name: 'In Kem Hàn & SPI (Stencil Printer)',
      code: 'PRINTER-SPI-A2',
      type: 'Solder Paste Printing',
      status: position >= 20 && position < 35 ? 'BUSY' : 'ACTIVE',
      actuators: {
        cylinder: position >= 22 && position < 32 ? 'EXTENDED' : 'RETRACTED',
        vacuum: 'OFF',
        servoX: 60.0,
        servoY: 40.0,
        servoZ: position >= 22 && position < 32 ? -8.0 : 6.0,
        doorSensor: true,
      },
    },
    {
      id: 'st3',
      name: 'Máy Dán Linh Kiện SMT (Pick & Place)',
      code: 'SMT-LINE-01',
      type: 'Placement Technology',
      status: position >= 35 && position < 52 ? 'BUSY' : 'ACTIVE',
      actuators: {
        cylinder: 'RETRACTED',
        vacuum: position >= 38 && position <= 48 ? 'ON' : 'OFF',
        servoX: Number((120 + Math.sin(sweep) * 35).toFixed(1)),
        servoY: Number((80 + Math.cos(sweep) * 25).toFixed(1)),
        servoZ: position >= 38 && position <= 48 ? -15.2 : 5.0,
        doorSensor: true,
      },
    },
    {
      id: 'st4',
      name: 'Lò Hàn Hồi Lưu Reflow',
      code: 'REFLOW-OVEN-02',
      type: 'Thermal Process',
      status: position >= 52 && position < 68 ? 'BUSY' : 'ACTIVE',
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
      id: 'st5',
      name: 'Camera Vision & AOI Inspector',
      code: 'AOI-INSPECT-04',
      type: 'Quality Inspection',
      status: position >= 68 && position < 85 ? 'BUSY' : 'ACTIVE',
      actuators: {
        cylinder: position >= 72 && position < 80 ? 'EXTENDED' : 'RETRACTED',
        vacuum: 'OFF',
        servoX: 210.5,
        servoY: 140.2,
        servoZ: -5.0,
        doorSensor: true,
      },
    },
    {
      id: 'st6',
      name: 'Máy Thu Bản (Unloader)',
      code: 'UNLOADER-A6',
      type: 'Sorting & Stacking',
      status: position >= 85 ? 'BUSY' : 'IDLE',
      actuators: {
        cylinder: position >= 88 ? 'EXTENDED' : 'RETRACTED',
        vacuum: 'OFF',
        servoX: 0,
        servoY: 0,
        servoZ: position >= 88 ? 50.0 : 0,
        doorSensor: true,
      },
    },
  ]
}

export function DigitalTwinLine() {
  // Line speed and feed density live in the simulator, not in this component:
  // they drive the SCADA numbers, and they survive a tab switch.
  const lineSpeed = useFactoryStore((s) => s.lineSpeed)
  const feedDensity = useFactoryStore((s) => s.feedDensity)

  const [isPlaying, setIsPlaying] = useState(true)
  const [phase, setPhase] = useState(Math.floor(15 / PHASE_STEP))
  const [activeStationId, setActiveStationId] = useState('st3')

  const trackRef = useRef<HTMLDivElement>(null)
  const pcbRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(15)
  const phaseRef = useRef(phase)
  const trackWidthRef = useRef(0)
  // Kept in a ref so a speed change does not restart the animation frame loop.
  const lineSpeedRef = useRef(lineSpeed)
  useEffect(() => {
    lineSpeedRef.current = lineSpeed
  }, [lineSpeed])

  const paintPcb = useCallback(() => {
    const el = pcbRef.current
    if (!el) return
    // translateX only: composited on the GPU, no layout pass. Animating `left`
    // reflowed the whole viewport on every frame.
    el.style.transform =
      'translateX(' + (posRef.current / 100) * trackWidthRef.current + 'px)'
  }, [])

  // Track width feeds the pixel transform; ResizeObserver keeps it correct.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new ResizeObserver(() => {
      trackWidthRef.current = track.clientWidth
      paintPcb()
    })
    observer.observe(track)
    return () => observer.disconnect()
  }, [paintPcb])

  // Animation runs entirely outside React: the board position is written
  // straight to the DOM, and state only changes when it crosses a 5% boundary.
  // rAF also pauses itself when the browser tab is hidden.
  useEffect(() => {
    if (!isPlaying) return

    let frame = 0
    let last = performance.now()

    const loop = (now: number) => {
      const dt = Math.min(now - last, 100) // clamp after a background stall
      last = now

      let next = posRef.current + PERCENT_PER_MS * lineSpeedRef.current * dt
      if (next >= POS_MAX) next = POS_MIN
      posRef.current = next
      paintPcb()

      const nextPhase = Math.floor(next / PHASE_STEP)
      if (nextPhase !== phaseRef.current) {
        phaseRef.current = nextPhase
        setPhase(nextPhase)
      }

      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [isPlaying, paintPcb])

  const handleResetPosition = () => {
    posRef.current = POS_MIN
    phaseRef.current = Math.floor(POS_MIN / PHASE_STEP)
    setPhase(phaseRef.current)
    paintPcb()
  }

  const handleAutoOptimize = () => {
    factorySource.setLineSpeed(1.2)
    factorySource.setFeedDensity('NORMAL')
  }

  const stations = useMemo(
    () => buildStations(phase * PHASE_STEP, lineSpeed),
    [phase, lineSpeed]
  )
  const selectedStation =
    stations.find((s) => s.id === activeStationId) ?? stations[2]

  // Same throughput and defect model the simulator uses, so the "what-if"
  // prediction and the SCADA counters cannot drift apart.
  const densityFactor =
    feedDensity === 'HIGH' ? 1.4 : feedDensity === 'LOW' ? 0.7 : 1.0
  const predictedOutputPcs = Math.round(
    (3600 / BOTTLENECK_CYCLE_SEC) * lineSpeed * densityFactor * LINE_EFFICIENCY
  )
  const predictedDefectPercent = Number(
    ((0.004 + Math.max(0, lineSpeed - 2.0) * 0.09) * 100).toFixed(2)
  )
  const isOverclocked = lineSpeed > 2.0

  return (
    <div className='space-y-6'>
      {/* Simulation & What-If Process Optimization Control Bar */}
      <Card className='border-amber-500/30 bg-amber-500/5'>
        <CardContent className='space-y-4 p-4'>
          <div className='flex flex-col items-start justify-between gap-2 border-b border-amber-500/20 pb-3 sm:flex-row sm:items-center'>
            <div>
              <h4 className='flex items-center gap-2 text-sm font-bold text-foreground'>
                <Sliders className='h-4 w-4 text-amber-500' />
                <span>
                  Bảng Thử Nghiệm Tối Ưu Hóa Dây Chuyền (What-If Line Process
                  Optimization)
                </span>
              </h4>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                Thay đổi tốc độ băng tải & mật độ hàng để đánh giá tác động tới
                sản lượng, tỷ lệ phế phẩm và hiệu suất OEE
              </p>
            </div>

            <Button
              size='sm'
              className='gap-1.5 bg-amber-500 text-xs font-bold text-slate-950 shadow-md shadow-amber-500/20 hover:bg-amber-400'
              onClick={handleAutoOptimize}
            >
              <Sparkles className='h-3.5 w-3.5' /> Tự Động Tối Ưu Điểm Ngọt
              (Sweet Spot)
            </Button>
          </div>

          {/* Interactive Controls & Live Predictions */}
          <div className='grid grid-cols-1 items-center gap-4 text-xs md:grid-cols-4'>
            {/* Line Speed Control Slider */}
            <div className='space-y-1.5 rounded-lg border border-border/40 bg-background/50 p-3 md:col-span-2'>
              <div className='flex justify-between font-medium'>
                <span>
                  Tốc Độ Băng Tải / Robot:{' '}
                  <strong className='font-mono text-sm text-primary'>
                    {lineSpeed.toFixed(1)}x
                  </strong>
                </span>
                <span
                  className={
                    isOverclocked
                      ? 'font-bold text-destructive'
                      : 'font-bold text-emerald-500'
                  }
                >
                  {isOverclocked
                    ? '⚠️ Nguy cơ Ép Tải (Overclocked)'
                    : '🟢 Vận Hành An Toàn'}
                </span>
              </div>
              <input
                type='range'
                min='0.5'
                max='3.0'
                step='0.1'
                value={lineSpeed}
                onChange={(e) =>
                  factorySource.setLineSpeed(parseFloat(e.target.value))
                }
                className='w-full cursor-pointer accent-primary'
              />
              <div className='flex justify-between font-mono text-[10px] text-muted-foreground'>
                <span>0.5x (Chậm / Tiết kiệm)</span>
                <span>1.0x (Chuẩn)</span>
                <span>2.0x (Nhanh)</span>
                <span>3.0x (Cực đại)</span>
              </div>
            </div>

            {/* Feed Density Selector */}
            <div className='space-y-1.5 rounded-lg border border-border/40 bg-background/50 p-3'>
              <span className='block font-medium text-muted-foreground'>
                Mật Độ Nạp PCB:
              </span>
              <div className='flex gap-1 pt-0.5'>
                {(['LOW', 'NORMAL', 'HIGH'] as FeedDensity[]).map((d) => (
                  <Button
                    key={d}
                    size='sm'
                    variant={feedDensity === d ? 'default' : 'outline'}
                    className='h-7 flex-1 px-1 text-[10px]'
                    onClick={() => factorySource.setFeedDensity(d)}
                  >
                    {d === 'LOW' ? 'Thưa' : d === 'NORMAL' ? 'Vừa' : 'Dày'}
                  </Button>
                ))}
              </div>
            </div>

            {/* Predicted Analytics Output */}
            <div className='space-y-1 rounded-lg border border-border/40 bg-background/50 p-3 font-mono text-[11px]'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Dự báo Sản Lượng:</span>
                <strong className='text-emerald-400'>
                  {predictedOutputPcs.toLocaleString()} pcs/h
                </strong>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Dự báo Phế Phẩm:</span>
                <strong
                  className={
                    predictedDefectPercent > 5
                      ? 'font-bold text-destructive'
                      : 'text-foreground'
                  }
                >
                  {predictedDefectPercent}%
                </strong>
              </div>
              <div className='pt-0.5 text-[10px] text-muted-foreground'>
                Nút thắt cổ chai: REFLOW-OVEN-02 ({BOTTLENECK_CYCLE_SEC}s/pcs)
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conveyor 2D Digital Twin Header & Control */}
      <Card className='border-primary/30 bg-card/60'>
        <CardHeader className='flex flex-row items-center justify-between pb-3'>
          <div>
            <CardTitle className='flex items-center gap-2 text-lg font-bold'>
              <Cpu className='h-5 w-5 text-primary' />
              2D/3D Digital Twin — Dây Chuyền Sản Xuất SMT Tự Động
            </CardTitle>
            <CardDescription>
              Mô phỏng chuyển động cơ khí, hành trình robot X/Y/Z và dòng luồng
              bo mạch PCB thời gian thực
            </CardDescription>
          </div>

          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setIsPlaying((p) => !p)}
              className='gap-1.5 text-xs'
            >
              {isPlaying ? (
                <Pause className='h-3.5 w-3.5' />
              ) : (
                <Play className='h-3.5 w-3.5' />
              )}
              {isPlaying ? 'Tạm Dừng' : 'Tiếp Tục'}
            </Button>

            <Button
              size='sm'
              variant='outline'
              onClick={handleResetPosition}
              className='gap-1.5 text-xs'
            >
              <RotateCcw className='h-3.5 w-3.5' /> Reset Vị Trí
            </Button>
          </div>
        </CardHeader>

        <CardContent className='space-y-6 pt-2'>
          {/* Interactive Animated Conveyor Viewport */}
          <div className='relative h-[220px] w-full overflow-hidden rounded-xl border border-primary/20 bg-slate-950/80 p-4 shadow-inner'>
            <div className='absolute inset-0 bg-[radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:16px_16px] opacity-15' />

            {/* Main Conveyor Belt Graphic */}
            <div className='absolute top-[110px] right-8 left-8 flex h-6 items-center justify-around overflow-hidden rounded-md border border-slate-700 bg-slate-800 shadow-md'>
              <div className='h-full w-full bg-[linear-gradient(90deg,transparent_50%,rgba(59,130,246,0.3)_50%)] bg-[length:24px_100%]' />
            </div>

            {/* Station Nodes along the line */}
            <div className='absolute top-6 right-8 left-8 z-10 flex items-center justify-between'>
              {stations.map((st, idx) => {
                const isCurrent = activeStationId === st.id
                return (
                  <button
                    key={st.id}
                    onClick={() => setActiveStationId(st.id)}
                    className={
                      'group flex flex-col items-center gap-1.5 transition-transform ' +
                      (isCurrent ? 'scale-110' : 'hover:scale-105')
                    }
                  >
                    <div
                      className={
                        'flex h-12 w-12 items-center justify-center rounded-xl border text-xs font-bold transition-colors ' +
                        (isCurrent
                          ? 'border-primary bg-primary text-primary-foreground shadow-lg ring-4 shadow-primary/40 ring-primary/20'
                          : st.status === 'BUSY'
                            ? 'border-amber-500/50 bg-amber-500/20 text-amber-400'
                            : 'border-slate-700 bg-slate-900 text-slate-300 group-hover:border-primary/50')
                      }
                    >
                      ST-0{idx + 1}
                    </div>

                    <span className='max-w-[86px] truncate text-center font-mono text-[10px] font-medium text-slate-400'>
                      {st.name.split('(')[0]}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Animated PCB Component Traveling (transform-driven, ref-painted) */}
            <div
              ref={trackRef}
              className='absolute top-[96px] right-8 left-8 z-20'
            >
              <div ref={pcbRef} className='w-14 will-change-transform'>
                <div className='flex h-9 w-14 flex-col items-center justify-center rounded border-2 border-emerald-400 bg-emerald-700/90 font-mono text-[9px] font-bold text-emerald-100 shadow-lg shadow-emerald-500/20'>
                  <span>PCB-M3</span>
                  <span className='text-[7px] text-emerald-300 opacity-80'>
                    SMT PASS
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Station Hardware Inspector Details */}
          <div className='grid grid-cols-1 gap-4 border-t border-border/40 pt-4 md:grid-cols-3'>
            <div className='space-y-2 rounded-lg border border-border/40 bg-muted/30 p-3'>
              <span className='block text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
                ⚙️ Cơ Cấu Vận Hành (Station Hardware)
              </span>
              <div className='text-sm font-bold'>{selectedStation.name}</div>
              <div className='font-mono text-xs text-muted-foreground'>
                Asset code: {selectedStation.code}
              </div>
              <Badge
                variant='outline'
                className='border-primary/30 bg-primary/10 text-[10px] text-primary'
              >
                {selectedStation.type}
              </Badge>
            </div>

            {/* Pneumatic & Vacuum Actuators */}
            <div className='space-y-2 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs'>
              <span className='block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
                💨 Khí Nén & Chân Không (Actuators)
              </span>

              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>
                  Xi-lanh Định Vị (Pneumatic):
                </span>
                <Badge
                  className={
                    selectedStation.actuators.cylinder === 'EXTENDED'
                      ? 'border-blue-500/40 bg-blue-500/20 text-[10px] text-blue-400'
                      : 'bg-slate-800 text-[10px] text-slate-400'
                  }
                >
                  {selectedStation.actuators.cylinder}
                </Badge>
              </div>

              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground'>
                  Hút Chân Không (Vacuum Nozzle):
                </span>
                <Badge
                  className={
                    selectedStation.actuators.vacuum === 'ON'
                      ? 'border-emerald-500/40 bg-emerald-500/20 text-[10px] text-emerald-400'
                      : 'bg-slate-800 text-[10px] text-slate-400'
                  }
                >
                  {selectedStation.actuators.vacuum}
                </Badge>
              </div>
            </div>

            {/* Servo Motors Axis Readout */}
            <div className='space-y-2 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs'>
              <span className='block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
                🤖 Trục Servo Robot X/Y/Z (Encoder Position)
              </span>

              <div className='grid grid-cols-3 gap-2 pt-1 text-center font-mono'>
                <div className='rounded border border-border/40 bg-background/60 p-1.5'>
                  <div className='text-[10px] text-muted-foreground'>
                    Trục X
                  </div>
                  <div className='font-bold text-primary'>
                    {selectedStation.actuators.servoX}mm
                  </div>
                </div>

                <div className='rounded border border-border/40 bg-background/60 p-1.5'>
                  <div className='text-[10px] text-muted-foreground'>
                    Trục Y
                  </div>
                  <div className='font-bold text-blue-400'>
                    {selectedStation.actuators.servoY}mm
                  </div>
                </div>

                <div className='rounded border border-border/40 bg-background/60 p-1.5'>
                  <div className='text-[10px] text-muted-foreground'>
                    Trục Z
                  </div>
                  <div className='font-bold text-amber-400'>
                    {selectedStation.actuators.servoZ}mm
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
