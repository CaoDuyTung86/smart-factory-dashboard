import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  RefreshCw,
  Radio,
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
import {
  fetchHealth,
  fetchSamples,
  inspectFile,
  inspectSample,
  isVisionEnabled,
  sampleImageUrl,
  type VisionSample,
} from '../services/visionService'
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
  /**
   * Ngưỡng của người vận hành, nằm dưới ngưỡng thấp nhất trong recipe (60–80%)
   * để mặc định màn hình hiển thị đúng phán định của thuật toán. Kéo lên là
   * thấy ngay over-kill — đó mới là mục đích của thanh trượt này.
   */
  const [sensitivity, setSensitivity] = useState(70)
  const [boardImage, setBoardImage] = useState<string | null>(null)

  /** Chỉ bật khi service AOI thật trả lời — cấu hình URL thôi là chưa đủ. */
  const [engineOnline, setEngineOnline] = useState(false)
  const [samples, setSamples] = useState<VisionSample[]>([])
  const [error, setError] = useState<string | null>(null)

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

  /** Nhận kết quả thật, đồng thời hiện đúng tấm ảnh vừa được kiểm tra. */
  const applyRecord = useCallback(
    (record: PcbInspectionRecord, imageUrl: string | null) => {
      setInspection(record)
      setBoardImage(imageUrl)
      setSelectedComponentId(
        record.components.find((c) => c.status === 'NG')?.id ??
          record.components[0]?.id ??
          null
      )
    },
    []
  )

  // Bắt tay với service một lần khi mở tab. Không cấu hình URL thì không có
  // request nào được gửi đi.
  useEffect(() => {
    if (!isVisionEnabled()) return

    let cancelled = false

    void (async () => {
      try {
        await fetchHealth()
        const list = await fetchSamples()
        if (cancelled) return
        setEngineOnline(true)
        setSamples(list)

        // Chạy ngay một lần kiểm tra thật. Nếu không, màn hình sẽ treo nhãn
        // LIVE lên bộ số mô phỏng — đúng kiểu HMI nói dối mà dự án này đang
        // cố tránh: nhãn phải mô tả đúng dữ liệu đang hiển thị.
        const first = list[0]
        if (!first) return
        const record = await inspectSample(first.name)
        if (cancelled) return
        applyRecord(record, sampleImageUrl(first.name))
      } catch {
        // Service chưa chạy: giữ nguyên chế độ mô phỏng, không làm hỏng tab.
        if (!cancelled) setEngineOnline(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [applyRecord])

  const runSample = useCallback(
    async (name: string) => {
      setIsScanning(true)
      setError(null)
      try {
        const record = await inspectSample(name)
        applyRecord(record, sampleImageUrl(name))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'không gọi được service AOI')
      } finally {
        setIsScanning(false)
      }
    },
    [applyRecord]
  )

  /** Đường mô phỏng cũ: không có service thì tab vẫn dùng được như trước. */
  const handleMockRescan = (forcePass = false) => {
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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    releaseObjectUrl()
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url

    if (!engineOnline) {
      setBoardImage(url)
      handleMockRescan(false)
      return
    }

    setIsScanning(true)
    setError(null)
    try {
      const record = await inspectFile(file)
      applyRecord(record, url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'không gửi được ảnh')
      setBoardImage(url)
    } finally {
      setIsScanning(false)
    }
  }

  const handleClearImage = () => {
    releaseObjectUrl()
    setBoardImage(null)
  }

  /**
   * The detection threshold is a real knob, not decoration: a component whose
   * match score falls below it is rejected. Raising it catches more true
   * defects but produces over-kill (false NG); lowering it lets escapes
   * through. That trade-off is the daily argument on any AOI station.
   *
   * Với service thật, ngưỡng này nằm CHỒNG LÊN ngưỡng riêng của từng ô trong
   * recipe — đúng như núm "sensitivity" toàn máy trên AOI thật: kỹ sư đặt
   * ngưỡng từng ô khi lập trình, người vận hành chỉ được siết thêm.
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

  const foreignObjects = inspection.foreignObjects ?? []
  const result =
    graded.some((c) => c.effectiveStatus === 'NG') || foreignObjects.length > 0
      ? 'FAIL'
      : 'PASS'
  const overKillCount = graded.filter((c) => c.belowThreshold).length
  const selectedComp = graded.find((c) => c.id === selectedComponentId)
  const marksFound =
    inspection.markPoints.mark1.status === 'FOUND' &&
    inspection.markPoints.mark2.status === 'FOUND'

  return (
    <Card className='border-primary/30 bg-card/60'>
      <CardHeader className='flex flex-col gap-3 pb-3 xl:flex-row xl:items-center xl:justify-between'>
        <div>
          <CardTitle className='flex flex-wrap items-center gap-2 text-lg font-bold'>
            <Camera className='h-5 w-5 text-amber-500' />
            Hệ Thống Camera Vision & AOI Inspection
            {engineOnline ? (
              <Badge
                variant='outline'
                className='gap-1.5 border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-500'
              >
                <Radio className='h-3 w-3' /> LIVE — OpenCV golden-sample (
                {inspection.cycleTimeMs} ms)
              </Badge>
            ) : (
              <Badge
                variant='outline'
                className='font-mono text-[10px] text-muted-foreground'
              >
                MÔ PHỎNG — chưa nối service AOI
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {engineOnline
              ? 'Ảnh được căn theo 2 điểm Mark rồi so với ảnh mẫu bằng OpenCV — điểm khớp là tương quan chuẩn hoá (NCC), không phải xác suất của mô hình học sâu.'
              : 'Kiểm tra tự động bo mạch PCB bằng thị giác máy tính, nhận diện điểm Mark và phát hiện lỗi NG/OK'}
          </CardDescription>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {engineOnline ? (
            samples.map((s) => (
              <Button
                key={s.name}
                size='sm'
                variant={s.name === 'pass' ? 'default' : 'outline'}
                disabled={isScanning}
                title={s.description}
                onClick={() => void runSample(s.name)}
                className={
                  'h-7 gap-1.5 text-[11px] ' +
                  (s.name === 'pass'
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                    : 'text-amber-500 hover:bg-amber-500/10')
                }
              >
                {s.name === 'pass' ? (
                  <CheckCircle2 className='h-3.5 w-3.5' />
                ) : (
                  <AlertTriangle className='h-3.5 w-3.5' />
                )}
                {s.description}
              </Button>
            ))
          ) : (
            <>
              <Button
                size='sm'
                variant='outline'
                onClick={() => handleMockRescan(false)}
                disabled={isScanning}
                className='gap-1.5 text-xs text-amber-500 hover:bg-amber-500/10'
              >
                <RefreshCw
                  className={
                    'h-3.5 w-3.5 ' + (isScanning ? 'animate-spin' : '')
                  }
                />
                Scan Mẫu Lỗi (NG)
              </Button>

              <Button
                size='sm'
                className='gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-500'
                onClick={() => handleMockRescan(true)}
                disabled={isScanning}
              >
                <CheckCircle2 className='h-3.5 w-3.5' /> Scan Mẫu Đạt (PASS)
              </Button>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className='space-y-6 pt-2'>
        {error && (
          <div className='rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive'>
            ⚠️ Service AOI báo lỗi: {error}
          </div>
        )}

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
              aria-label='Detection threshold'
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
                onChange={(e) => void handleImageUpload(e)}
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
            {boardImage && (
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

            {/* Ảnh thật vừa kiểm tra, hoặc bo mạch vẽ tay khi chưa có ảnh */}
            <div className='relative flex aspect-[19/12] w-full max-w-[380px] items-center justify-center overflow-hidden rounded-lg border-2 border-emerald-600/70 bg-emerald-950/90 p-3 shadow-inner'>
              {boardImage ? (
                <img
                  src={boardImage}
                  alt='Bo mạch đang kiểm tra'
                  className='absolute inset-0 h-full w-full object-fill'
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

              {/* Vật lạ: nằm ngoài mọi ô linh kiện nên vẽ riêng */}
              {foreignObjects.map((fo, i) => (
                <div
                  key={'fm-' + i}
                  style={{
                    left: fo.box.x * 100 + '%',
                    top: fo.box.y * 100 + '%',
                    width: fo.box.w * 100 + '%',
                    height: fo.box.h * 100 + '%',
                  }}
                  className='absolute rounded border-2 border-dashed border-amber-400 bg-amber-400/20'
                  title={'Vật lạ ' + fo.areaPx + ' px²'}
                >
                  <span className='absolute -top-4 left-0 rounded bg-amber-400 px-1 font-mono text-[8px] font-bold text-slate-950'>
                    FM
                  </span>
                </div>
              ))}
            </div>

            {/* Camera Overlay Status Bar */}
            <div className='absolute top-3 left-3 flex items-center gap-2 rounded border border-slate-700 bg-slate-900/90 px-2.5 py-1 font-mono text-[11px] text-slate-300'>
              <span
                className={
                  'h-2 w-2 rounded-full ' +
                  (engineOnline ? 'bg-emerald-500' : 'bg-slate-500')
                }
              />
              <span>
                {engineOnline ? 'OpenCV AOI Station' : 'Cognex Cam #1'}
              </span>
              <span className='text-slate-500'>|</span>
              <span>Threshold: {sensitivity}%</span>
            </div>

            <div className='absolute right-3 bottom-3 rounded border border-slate-700 bg-slate-900/90 px-2.5 py-1 font-mono text-[11px] text-slate-300'>
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
                <span
                  className={
                    'font-mono ' +
                    (marksFound ? 'text-emerald-400' : 'text-destructive')
                  }
                >
                  {marksFound ? 'FOUND' : 'MISSING'} (Theta:{' '}
                  {inspection.markPoints.thetaOffset > 0 ? '+' : ''}
                  {inspection.markPoints.thetaOffset}°)
                </span>
              </div>

              {inspection.alignment && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground'>Sai số căn ảnh:</span>
                  <span className='font-mono'>
                    {inspection.alignment.residualPx === null
                      ? '—'
                      : inspection.alignment.residualPx + ' px'}{' '}
                    @ {inspection.alignment.scale}x
                  </span>
                </div>
              )}
            </div>

            {foreignObjects.length > 0 && (
              <div className='rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] font-medium text-amber-500'>
                ⚠️ {foreignObjects.length} vật lạ nằm ngoài mọi ô linh kiện
                (foreign material) — kiểm tra từng ô không bắt được loại lỗi
                này, phải quét lại phần bo mạch còn lại.
              </div>
            )}

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
                    {/* Chỉ gọi là NCC khi con số đó thật sự là NCC. Ở chế độ
                        mô phỏng nó chỉ là số bịa, gán cho nó cái tên của một
                        đại lượng đo được là nói dối trên HMI. */}
                    {engineOnline
                      ? 'Điểm khớp mẫu (NCC): '
                      : 'Độ tin cậy thuật toán Vision: '}
                    <strong>{selectedComp.confidence}%</strong>
                  </div>

                  {selectedComp.offsetPx && (
                    <div className='text-[11px] text-muted-foreground'>
                      Lệch vị trí: <strong>{selectedComp.offsetPx[0]}</strong>,{' '}
                      <strong>{selectedComp.offsetPx[1]}</strong> px
                      {selectedComp.defectAreaPct !== undefined && (
                        <>
                          {' · '}sai khác so với ảnh mẫu:{' '}
                          <strong>{selectedComp.defectAreaPct}%</strong>
                        </>
                      )}
                    </div>
                  )}
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
