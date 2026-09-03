import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  RefreshCw,
  Sliders,
  Upload,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatClock } from '../lib/format'
import type { PcbInspectionRecord } from '../types'

/**
 * Bounding boxes are normalised to the board (0..1), so they stay on the right
 * component whatever the viewport or uploaded image size is. Pixel coordinates
 * only ever matched the one hard-coded 380x240 render.
 */
const MOCK_INSPECTION_DATA: PcbInspectionRecord = {
  id: 'pcb-9021',
  serialNumber: 'FOX-APPLE-M3-2026-0982',
  modelName: 'MacBook M3 Logic Board Revision B',
  timestamp: Date.now(),
  result: 'FAIL',
  cycleTimeMs: 1240,
  markPoints: {
    mark1: { x: 0.08, y: 0.1, status: 'FOUND' },
    mark2: { x: 0.9, y: 0.88, status: 'FOUND' },
    thetaOffset: 0.04,
  },
  components: [
    {
      id: 'c1',
      name: 'IC-U1 (Main Processor)',
      type: 'IC',
      status: 'OK',
      confidence: 99.8,
      box: { x: 0.3, y: 0.22, w: 0.26, h: 0.36 },
    },
    {
      id: 'c2',
      name: 'Resistor R12',
      type: 'Resistor',
      status: 'NG',
      issue: 'Component Misaligned (Lệch chân 12°)',
      confidence: 94.2,
      box: { x: 0.64, y: 0.26, w: 0.12, h: 0.13 },
    },
    {
      id: 'c3',
      name: 'Capacitor C45',
      type: 'Capacitor',
      status: 'OK',
      confidence: 98.5,
      box: { x: 0.13, y: 0.62, w: 0.1, h: 0.17 },
    },
    {
      id: 'c4',
      name: 'Solder Pin 8-12',
      type: 'SolderJoint',
      status: 'NG',
      issue: 'Solder Bridge (Dính thiếc ngắn mạch)',
      confidence: 91.5,
      box: { x: 0.32, y: 0.7, w: 0.22, h: 0.15 },
    },
    {
      id: 'c5',
      name: 'Type-C Port Connector',
      type: 'Connector',
      status: 'OK',
      confidence: 99.1,
      box: { x: 0.66, y: 0.6, w: 0.24, h: 0.28 },
    },
  ],
}

function serial() {
  return 'FOX-APPLE-M3-2026-' + Math.floor(Math.random() * 9000 + 1000)
}

export function VisionInspector() {
  const [inspection, setInspection] =
    useState<PcbInspectionRecord>(MOCK_INSPECTION_DATA)
  const [isScanning, setIsScanning] = useState(false)
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
    'c2'
  )
  const [sensitivity, setSensitivity] = useState(85) // % confidence threshold
  const [customImage, setCustomImage] = useState<string | null>(null)

  const scanTimer = useRef<number | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  // An object URL pins the whole file in memory until it is revoked — dropping
  // the reference alone leaks every image the operator ever loaded.
  const releaseObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      releaseObjectUrl()
      if (scanTimer.current !== null) clearTimeout(scanTimer.current)
    }
  }, [])

  const handleRescan = (forcePass = false) => {
    setIsScanning(true)
    if (scanTimer.current !== null) clearTimeout(scanTimer.current)

    scanTimer.current = window.setTimeout(() => {
      setIsScanning(false)
      setInspection((prev) => ({
        ...prev,
        id: 'pcb-' + Math.floor(Math.random() * 9000 + 1000),
        serialNumber: serial(),
        timestamp: Date.now(),
        components: forcePass
          ? prev.components.map((c) => ({
              ...c,
              status: 'OK' as const,
              issue: undefined,
              confidence: Number((97 + Math.random() * 2.9).toFixed(1)),
            }))
          : MOCK_INSPECTION_DATA.components,
      }))
    }, 800)
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    releaseObjectUrl()
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setCustomImage(url)
    handleRescan(false)
  }

  const handleClearImage = () => {
    releaseObjectUrl()
    setCustomImage(null)
  }

  /**
   * The detection threshold is a real knob, not decoration: a component whose
   * match score falls below it is rejected. Raising it catches more true
   * defects but produces over-kill (false NG); lowering it lets escapes
   * through. That trade-off is the daily argument on any AOI station.
   */
  const graded = useMemo(
    () =>
      inspection.components.map((c) => ({
        ...c,
        effectiveStatus:
          c.status === 'NG' || c.confidence < sensitivity
            ? ('NG' as const)
            : ('OK' as const),
        belowThreshold: c.status === 'OK' && c.confidence < sensitivity,
      })),
    [inspection.components, sensitivity]
  )

  const result = graded.some((c) => c.effectiveStatus === 'NG')
    ? 'FAIL'
    : 'PASS'
  const overKillCount = graded.filter((c) => c.belowThreshold).length
  const selectedComp = graded.find((c) => c.id === selectedComponentId)

  return (
    <Card className='border-primary/30 bg-card/60'>
      <CardHeader className='flex flex-row items-center justify-between pb-3'>
        <div>
          <CardTitle className='flex items-center gap-2 text-lg font-bold'>
            <Camera className='h-5 w-5 text-amber-500' />
            Hệ Thống Camera Vision & AOI Inspection (Cognex / VisionPro
            Simulator)
          </CardTitle>
          <CardDescription>
            Kiểm tra tự động bo mạch PCB 2D/3D bằng thị giác máy tính, nhận diện
            điểm Mark và phát hiện lỗi NG/OK
          </CardDescription>
        </div>

        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => handleRescan(false)}
            disabled={isScanning}
            className='gap-1.5 text-xs text-amber-500 hover:bg-amber-500/10'
          >
            <RefreshCw
              className={'h-3.5 w-3.5 ' + (isScanning ? 'animate-spin' : '')}
            />
            Scan Mẫu Lỗi (NG)
          </Button>

          <Button
            size='sm'
            className='gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500'
            onClick={() => handleRescan(true)}
            disabled={isScanning}
          >
            <CheckCircle2 className='h-3.5 w-3.5' /> Scan Mẫu Đạt (PASS)
          </Button>
        </div>
      </CardHeader>

      <CardContent className='space-y-6 pt-2'>
        {/* Fine-Tuning Vision Threshold Bar */}
        <div className='flex flex-col items-start justify-between gap-3 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs sm:flex-row sm:items-center'>
          <div className='flex w-full flex-wrap items-center gap-3 sm:w-auto'>
            <Sliders className='h-4 w-4 text-primary' />
            <span>
              Độ Nhạy Thuật Toán Vision (Detection Threshold):{' '}
              <strong className='font-mono text-primary'>{sensitivity}%</strong>
            </span>
            <input
              type='range'
              min='50'
              max='99'
              value={sensitivity}
              onChange={(e) => setSensitivity(parseInt(e.target.value))}
              className='w-32 cursor-pointer accent-primary'
            />
            <span className='text-[11px] text-muted-foreground'>
              {overKillCount > 0
                ? '⚠️ ' + overKillCount + ' linh kiện bị loại oan (over-kill)'
                : 'Không có over-kill ở ngưỡng này'}
            </span>
          </div>

          {/* Custom Upload Button */}
          <div className='flex w-full items-center justify-end gap-2 sm:w-auto'>
            <label className='cursor-pointer'>
              <input
                type='file'
                accept='image/*'
                className='hidden'
                onChange={handleImageUpload}
              />
              <Button
                size='sm'
                variant='outline'
                asChild
                className='h-7 gap-1.5 text-[11px]'
              >
                <span>
                  <Upload className='h-3 w-3' /> Tải Ảnh Bo Mạch Tùy Chỉnh
                </span>
              </Button>
            </label>
            {customImage && (
              <Button
                size='sm'
                variant='ghost'
                className='h-7 text-[11px] text-muted-foreground'
                onClick={handleClearImage}
              >
                Xóa Ảnh
              </Button>
            )}
          </div>
        </div>

        {/* Main Workspace: Left Inspection Viewport, Right Details */}
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
          {/* Simulated Industrial Camera Viewport */}
          <div className='relative flex min-h-[340px] items-center justify-center overflow-hidden rounded-xl border border-primary/30 bg-slate-950 p-4 shadow-2xl lg:col-span-2'>
            <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#3b82f6_1px,transparent_1px),linear-gradient(to_bottom,#3b82f6_1px,transparent_1px)] bg-[size:24px_24px] opacity-20' />

            {/* Scanning Laser Beam Effect */}
            {isScanning && (
              <div className='absolute right-0 left-0 z-30 h-1 animate-[bounce_0.8s_infinite] bg-amber-400 shadow-[0_0_15px_#f59e0b]' />
            )}

            {/* Custom Uploaded Image vs Synthetic PCB Board Graphic */}
            <div className='relative flex aspect-[19/12] w-full max-w-[380px] items-center justify-center overflow-hidden rounded-lg border-2 border-emerald-600/70 bg-emerald-950/90 p-3 shadow-inner'>
              {customImage ? (
                <img
                  src={customImage}
                  alt='Custom PCB'
                  className='h-full w-full rounded object-cover opacity-80'
                />
              ) : (
                <>
                  <div className='absolute inset-0 m-2 rounded border border-dashed border-amber-500/40 opacity-25' />
                  <div className='absolute top-3 left-3 flex h-4 w-4 items-center justify-center rounded-full border-2 border-amber-400 font-mono text-[8px] font-bold text-amber-400'>
                    M1
                  </div>
                  <div className='absolute right-3 bottom-3 flex h-4 w-4 items-center justify-center rounded-full border-2 border-amber-400 font-mono text-[8px] font-bold text-amber-400'>
                    M2
                  </div>
                </>
              )}

              {/* PCB Components & Bounding Boxes (normalised coordinates) */}
              {graded.map((comp) => {
                const isNG = comp.effectiveStatus === 'NG'
                const isSelected = selectedComponentId === comp.id

                return (
                  <div
                    key={comp.id}
                    onClick={() => setSelectedComponentId(comp.id)}
                    style={{
                      left: comp.box.x * 100 + '%',
                      top: comp.box.y * 100 + '%',
                      width: comp.box.w * 100 + '%',
                      height: comp.box.h * 100 + '%',
                    }}
                    className={
                      'absolute flex cursor-pointer flex-col justify-between rounded border-2 p-1 font-mono text-[9px] font-bold transition-colors ' +
                      (isNG
                        ? 'border-destructive bg-destructive/20 shadow-lg shadow-destructive/30'
                        : 'border-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20') +
                      (isSelected
                        ? ' ring-2 ring-primary ring-offset-1 ring-offset-slate-950'
                        : '')
                    }
                  >
                    <span
                      className={
                        isNG
                          ? 'text-destructive-foreground rounded bg-destructive/80 px-1 text-[8px]'
                          : 'text-emerald-300'
                      }
                    >
                      {comp.name.split(' ')[0]}
                    </span>

                    <span className='text-right text-[8px] opacity-90'>
                      {isNG ? 'NG' : 'OK'} ({comp.confidence.toFixed(0)}%)
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Camera Overlay Status Bar */}
            <div className='absolute top-3 left-3 flex items-center gap-2 rounded border border-slate-700 bg-slate-900/90 px-2.5 py-1 font-mono text-[11px] text-slate-300 backdrop-blur'>
              <span className='h-2 w-2 rounded-full bg-emerald-500' />
              <span>Cognex Industrial Cam #1</span>
              <span className='text-slate-500'>|</span>
              <span>Threshold: {sensitivity}%</span>
            </div>

            <div className='absolute right-3 bottom-3 rounded border border-slate-700 bg-slate-900/90 px-2.5 py-1 font-mono text-[11px] text-slate-300 backdrop-blur'>
              Cycle Time:{' '}
              <strong className='text-primary'>
                {inspection.cycleTimeMs} ms
              </strong>
            </div>
          </div>

          {/* Right Inspection Details Panel */}
          <div className='space-y-4'>
            <div
              className={
                'flex items-center justify-between rounded-xl border p-4 ' +
                (result === 'PASS'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                  : 'border-destructive/40 bg-destructive/10 text-destructive')
              }
            >
              <div>
                <span className='block font-mono text-xs tracking-wider uppercase opacity-80'>
                  KẾT QUẢ KIỂM TRA AOI
                </span>
                <div className='mt-0.5 font-mono text-2xl font-black'>
                  {result}
                </div>
              </div>

              {result === 'PASS' ? (
                <CheckCircle2 className='h-8 w-8 text-emerald-500' />
              ) : (
                <AlertTriangle className='h-8 w-8 text-destructive' />
              )}
            </div>

            <div className='space-y-2 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Serial Number:</span>
                <span className='font-mono font-bold'>
                  {inspection.serialNumber}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Thời điểm chụp:</span>
                <span className='font-mono'>
                  {formatClock(inspection.timestamp)}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Mark Point 1 & 2:</span>
                <span className='font-mono text-emerald-400'>
                  FOUND (Theta: +{inspection.markPoints.thetaOffset}°)
                </span>
              </div>
            </div>

            <div className='space-y-2 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs'>
              <span className='block text-[11px] font-semibold tracking-wider text-muted-foreground uppercase'>
                🔍 Chi Tiết Linh Kiện (Click trên hình để xem)
              </span>

              {selectedComp ? (
                <div className='space-y-1.5 pt-1'>
                  <div className='flex justify-between font-medium'>
                    <span>{selectedComp.name}</span>
                    <Badge
                      variant={
                        selectedComp.effectiveStatus === 'OK'
                          ? 'outline'
                          : 'destructive'
                      }
                      className='px-1.5 py-0 text-[10px]'
                    >
                      {selectedComp.effectiveStatus}
                    </Badge>
                  </div>

                  {selectedComp.issue && (
                    <div className='rounded border border-destructive/30 bg-destructive/15 p-2 text-[11px] font-medium text-destructive'>
                      ⚠️ Lỗi: {selectedComp.issue}
                    </div>
                  )}

                  {selectedComp.belowThreshold && (
                    <div className='rounded border border-amber-500/30 bg-amber-500/15 p-2 text-[11px] font-medium text-amber-500'>
                      ⚠️ Over-kill: linh kiện đạt nhưng điểm khớp{' '}
                      {selectedComp.confidence}% thấp hơn ngưỡng {sensitivity}%
                      → bị loại oan. Hạ ngưỡng để giảm tỷ lệ NG giả.
                    </div>
                  )}

                  <div className='text-[11px] text-muted-foreground'>
                    Độ tin cậy thuật toán Vision:{' '}
                    <strong>{selectedComp.confidence}%</strong>
                  </div>
                </div>
              ) : (
                <div className='py-2 text-center text-muted-foreground italic'>
                  Click vào một linh kiện trên bo mạch để xem chi tiết
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
