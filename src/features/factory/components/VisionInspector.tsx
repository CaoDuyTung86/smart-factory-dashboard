import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Eye, CheckCircle2, AlertTriangle, Scan, Camera, RefreshCw, Upload, Sliders } from 'lucide-react'
import { PcbInspectionRecord } from '../types'

const MOCK_INSPECTION_DATA: PcbInspectionRecord = {
  id: 'pcb-9021',
  serialNumber: 'FOX-APPLE-M3-2026-0982',
  modelName: 'MacBook M3 Logic Board Revision B',
  timestamp: new Date().toLocaleTimeString(),
  result: 'FAIL',
  cycleTimeMs: 1240,
  markPoints: {
    mark1: { x: 45, y: 35, status: 'FOUND' },
    mark2: { x: 340, y: 220, status: 'FOUND' },
    thetaOffset: 0.04,
  },
  components: [
    { id: 'c1', name: 'IC-U1 (Main Processor)', type: 'IC', status: 'OK', confidence: 99.8, box: { x: 120, y: 60, w: 100, h: 90 } },
    { id: 'c2', name: 'Resistor R12', type: 'Resistor', status: 'NG', issue: 'Component Misaligned (Lệch chân 12°)', confidence: 94.2, box: { x: 250, y: 70, w: 40, h: 30 } },
    { id: 'c3', name: 'Capacitor C45', type: 'Capacitor', status: 'OK', confidence: 98.5, box: { x: 60, y: 160, w: 35, h: 40 } },
    { id: 'c4', name: 'Solder Pin 8-12', type: 'SolderJoint', status: 'NG', issue: 'Solder Bridge (Dính thiếc ngắn mạch)', confidence: 91.5, box: { x: 130, y: 175, w: 80, h: 35 } },
    { id: 'c5', name: 'Type-C Port Connector', type: 'Connector', status: 'OK', confidence: 99.1, box: { x: 260, y: 155, w: 85, h: 65 } },
  ],
}

export function VisionInspector() {
  const [inspection, setInspection] = useState<PcbInspectionRecord>(MOCK_INSPECTION_DATA)
  const [isScanning, setIsScanning] = useState(false)
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>('c2')
  const [sensitivity, setSensitivity] = useState<number>(85) // % threshold
  const [customImage, setCustomImage] = useState<string | null>(null)

  const handleRescan = (forcePass = false) => {
    setIsScanning(true)
    setTimeout(() => {
      setIsScanning(false)
      if (forcePass) {
        setInspection({
          ...inspection,
          id: 'pcb-' + Math.floor(Math.random() * 9000 + 1000),
          serialNumber: 'FOX-APPLE-M3-2026-' + Math.floor(Math.random() * 9000 + 1000),
          timestamp: new Date().toLocaleTimeString(),
          result: 'PASS',
          components: inspection.components.map((c) => ({ ...c, status: 'OK', issue: undefined })),
        })
      } else {
        setInspection({
          ...inspection,
          id: 'pcb-' + Math.floor(Math.random() * 9000 + 1000),
          serialNumber: 'FOX-APPLE-M3-2026-' + Math.floor(Math.random() * 9000 + 1000),
          timestamp: new Date().toLocaleTimeString(),
          result: 'FAIL',
          components: MOCK_INSPECTION_DATA.components,
        })
      }
    }, 800)
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setCustomImage(url)
      handleRescan(false)
    }
  }

  const selectedComp = inspection.components.find((c) => c.id === selectedComponentId)

  return (
    <Card className='border-primary/30 bg-card/60 backdrop-blur-sm'>
      <CardHeader className='pb-3 flex flex-row items-center justify-between'>
        <div>
          <CardTitle className='text-lg font-bold flex items-center gap-2'>
            <Camera className='h-5 w-5 text-amber-500' />
            Hệ Thống Camera Vision & AOI Inspection (Cognex / VisionPro Simulator)
          </CardTitle>
          <CardDescription>
            Kiểm tra tự động bo mạch PCB 2D/3D bằng thị giác máy tính, nhận diện điểm Mark và phát hiện lỗi NG/OK
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
            <RefreshCw className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            Scan Mẫu Lỗi (NG)
          </Button>

          <Button
            size='sm'
            className='gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white'
            onClick={() => handleRescan(true)}
            disabled={isScanning}
          >
            <CheckCircle2 className='h-3.5 w-3.5' /> Scan Mẫu Đạt (PASS)
          </Button>
        </div>
      </CardHeader>

      <CardContent className='space-y-6 pt-2'>
        {/* Fine-Tuning Vision Threshold Bar */}
        <div className='p-3 rounded-lg bg-muted/30 border border-border/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs'>
          <div className='flex items-center gap-3 w-full sm:w-auto'>
            <Sliders className='h-4 w-4 text-primary' />
            <span>Độ Nhạy Thuật Toán Vision (Detection Threshold): <strong className='font-mono text-primary'>{sensitivity}%</strong></span>
            <input
              type='range'
              min='50'
              max='99'
              value={sensitivity}
              onChange={(e) => setSensitivity(parseInt(e.target.value))}
              className='w-32 accent-primary cursor-pointer'
            />
          </div>

          {/* Custom Upload Button */}
          <div className='flex items-center gap-2 w-full sm:w-auto justify-end'>
            <label className='cursor-pointer'>
              <input type='file' accept='image/*' className='hidden' onChange={handleImageUpload} />
              <Button size='sm' variant='outline' asChild className='h-7 text-[11px] gap-1.5'>
                <span><Upload className='h-3 w-3' /> Tải Ảnh Bo Mạch Tùy Chỉnh</span>
              </Button>
            </label>
            {customImage && (
              <Button size='sm' variant='ghost' className='h-7 text-[11px] text-muted-foreground' onClick={() => setCustomImage(null)}>
                Xóa Ảnh
              </Button>
            )}
          </div>
        </div>

        {/* Main Workspace: Left Inspection Viewport, Right Details */}
        <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
          {/* Simulated Industrial Camera Viewport */}
          <div className='lg:col-span-2 relative bg-slate-950 rounded-xl border border-primary/30 p-4 min-h-[340px] flex items-center justify-center overflow-hidden shadow-2xl'>
            <div className='absolute inset-0 pointer-events-none opacity-20 bg-[linear-gradient(to_right,#3b82f6_1px,transparent_1px),linear-gradient(to_bottom,#3b82f6_1px,transparent_1px)] bg-[size:24px_24px]' />

            {/* Scanning Laser Beam Effect */}
            {isScanning && (
              <div className='absolute left-0 right-0 h-1 bg-amber-400 shadow-[0_0_15px_#f59e0b] z-30 animate-[bounce_0.8s_infinite]' />
            )}

            {/* Custom Uploaded Image vs Synthetic PCB Board Graphic */}
            <div className='relative w-[380px] h-[240px] bg-emerald-950/90 border-2 border-emerald-600/70 rounded-lg p-3 shadow-inner overflow-hidden flex items-center justify-center'>
              {customImage ? (
                <img src={customImage} alt='Custom PCB' className='w-full h-full object-cover rounded opacity-80' />
              ) : (
                <>
                  <div className='absolute inset-0 opacity-25 border-dashed border border-amber-500/40 m-2 rounded' />
                  <div className='absolute top-3 left-3 w-4 h-4 rounded-full border-2 border-amber-400 flex items-center justify-center text-[8px] font-mono text-amber-400 font-bold'>
                    M1
                  </div>
                  <div className='absolute bottom-3 right-3 w-4 h-4 rounded-full border-2 border-amber-400 flex items-center justify-center text-[8px] font-mono text-amber-400 font-bold'>
                    M2
                  </div>
                </>
              )}

              {/* PCB Components & Bounding Boxes */}
              {inspection.components.map((comp) => {
                const isNG = comp.status === 'NG'
                const isSelected = selectedComponentId === comp.id

                return (
                  <div
                    key={comp.id}
                    onClick={() => setSelectedComponentId(comp.id)}
                    style={{
                      left: comp.box.x,
                      top: comp.box.y,
                      width: comp.box.w,
                      height: comp.box.h,
                    }}
                    className={`absolute rounded border-2 transition-all cursor-pointer flex flex-col justify-between p-1 text-[9px] font-mono font-bold ${
                      isNG
                        ? 'border-destructive bg-destructive/20 shadow-lg shadow-destructive/30 animate-pulse'
                        : 'border-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                    } ${isSelected ? 'ring-2 ring-primary ring-offset-1 ring-offset-slate-950' : ''}`}
                  >
                    <span className={isNG ? 'text-destructive-foreground bg-destructive/80 px-1 rounded text-[8px]' : 'text-emerald-300'}>
                      {comp.name.split(' ')[0]}
                    </span>

                    <span className='text-[8px] opacity-90 text-right'>
                      {isNG ? 'NG' : 'OK'} ({comp.confidence.toFixed(0)}%)
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Camera Overlay Status Bar */}
            <div className='absolute top-3 left-3 bg-slate-900/90 border border-slate-700 backdrop-blur rounded px-2.5 py-1 text-[11px] font-mono text-slate-300 flex items-center gap-2'>
              <span className='h-2 w-2 rounded-full bg-emerald-500 animate-pulse' />
              <span>Cognex Industrial Cam #1</span>
              <span className='text-slate-500'>|</span>
              <span>Threshold: {sensitivity}%</span>
            </div>

            <div className='absolute bottom-3 right-3 bg-slate-900/90 border border-slate-700 backdrop-blur rounded px-2.5 py-1 text-[11px] font-mono text-slate-300'>
              Cycle Time: <strong className='text-primary'>{inspection.cycleTimeMs} ms</strong>
            </div>
          </div>

          {/* Right Inspection Details Panel */}
          <div className='space-y-4'>
            <div className={`p-4 rounded-xl border flex items-center justify-between ${
              inspection.result === 'PASS' 
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400' 
                : 'bg-destructive/10 border-destructive/40 text-destructive'
            }`}>
              <div>
                <span className='text-xs font-mono uppercase tracking-wider block opacity-80'>KẾT QUẢ KIỂM TRA AOI</span>
                <div className='text-2xl font-black font-mono mt-0.5'>{inspection.result}</div>
              </div>

              {inspection.result === 'PASS' ? (
                <CheckCircle2 className='h-8 w-8 text-emerald-500' />
              ) : (
                <AlertTriangle className='h-8 w-8 text-destructive animate-bounce' />
              )}
            </div>

            <div className='rounded-lg bg-muted/30 p-3 border border-border/40 space-y-2 text-xs'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Serial Number:</span>
                <span className='font-mono font-bold'>{inspection.serialNumber}</span>
              </div>
              <div className='flex justify-between'>
                <span className='text-muted-foreground'>Mark Point 1 & 2:</span>
                <span className='font-mono text-emerald-400'>FOUND (Theta: +{inspection.markPoints.thetaOffset}°)</span>
              </div>
            </div>

            <div className='rounded-lg bg-muted/30 p-3 border border-border/40 space-y-2 text-xs'>
              <span className='font-semibold text-muted-foreground uppercase tracking-wider block text-[11px]'>
                🔍 Chi Tiết Linh Kiện (Click trên hình để xem)
              </span>

              {selectedComp ? (
                <div className='space-y-1.5 pt-1'>
                  <div className='flex justify-between font-medium'>
                    <span>{selectedComp.name}</span>
                    <Badge variant={selectedComp.status === 'OK' ? 'outline' : 'destructive'} className='text-[10px] px-1.5 py-0'>
                      {selectedComp.status}
                    </Badge>
                  </div>

                  {selectedComp.issue && (
                    <div className='p-2 rounded bg-destructive/15 text-destructive border border-destructive/30 font-medium text-[11px]'>
                      ⚠️ Lỗi: {selectedComp.issue}
                    </div>
                  )}

                  <div className='text-muted-foreground text-[11px]'>
                    Độ tin cậy thuật toán Vision: <strong>{selectedComp.confidence}%</strong>
                  </div>
                </div>
              ) : (
                <div className='text-muted-foreground italic py-2 text-center'>
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
