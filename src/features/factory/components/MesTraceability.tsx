import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Database, Search, FileText, CheckCircle2, QrCode, Clock, ShieldCheck, Download } from 'lucide-react'

interface TraceabilityStep {
  stationName: string
  machineCode: string
  timestamp: string
  operator: string
  details: string
  status: 'PASS' | 'WARNING' | 'FAIL'
}

const MOCK_TRACE_TIMELINE: TraceabilityStep[] = [
  {
    stationName: '1. Nhập Bản (PCB Loader)',
    machineCode: 'LOADER-01',
    timestamp: '21:00:15',
    operator: 'Auto Robot Inovance',
    details: 'Jig SS #J-9042 loaded successfully. Bare PCB scanned.',
    status: 'PASS',
  },
  {
    stationName: '2. In Kem Hàn (Stencil Printer & SPI)',
    machineCode: 'PRINTER-02',
    timestamp: '21:00:32',
    operator: 'Auto Printer',
    details: 'Solder paste thickness: 120µm (Target 115-125µm). SPI Inspection: PASS.',
    status: 'PASS',
  },
  {
    stationName: '3. Gắn Linh Kiện SMT (Pick & Place)',
    machineCode: 'SMT-LINE-01',
    timestamp: '21:00:58',
    operator: 'Auto Nozzle Array',
    details: 'Placed 148 SMT components (Apple M3 Chip, Resistors, Capacitors). 0 Drops.',
    status: 'PASS',
  },
  {
    stationName: '4. Hàn Lò Reflow',
    machineCode: 'WAVE-SOLDER-02',
    timestamp: '21:01:40',
    operator: 'Reflow Controller',
    details: 'Peak Zone Temperature: 245.8°C (Soak Time: 65s). Lead-free Profile OK.',
    status: 'PASS',
  },
  {
    stationName: '5. Kiểm Tra Quang Học (AOI Camera)',
    machineCode: 'AOI-INSPECT-04',
    timestamp: '21:02:15',
    operator: 'Cognex Vision AI',
    details: 'Scanned 148 components. 148 PASS, 0 NG. Mark Alignment Offset: +0.02°.',
    status: 'PASS',
  },
]

export function MesTraceability() {
  const [searchSerial, setSearchSerial] = useState('FOX-APPLE-M3-90821')
  const [activeBarcode, setActiveBarcode] = useState('FOX-APPLE-M3-90821')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setActiveBarcode(searchSerial.trim().toUpperCase() || 'FOX-APPLE-M3-90821')
  }

  return (
    <Card className='border-primary/30 bg-card/60 backdrop-blur-sm'>
      <CardHeader className='pb-3 flex flex-row items-center justify-between'>
        <div>
          <CardTitle className='text-lg font-bold flex items-center gap-2'>
            <Database className='h-5 w-5 text-purple-400' />
            Hệ Thống MES & Truy Xuất Nguồn Gốc Bo Mạch (Product Traceability)
          </CardTitle>
          <CardDescription>
            Tra cứu lịch sử sản xuất từng giây của bo mạch qua chuỗi các trạm máy SMT, lô nguyên liệu và kết quả kiểm định
          </CardDescription>
        </div>

        <Button size='sm' variant='outline' className='gap-1.5 text-xs'>
          <Download className='h-3.5 w-3.5' /> Xuất Báo Cáo Log (CSV)
        </Button>
      </CardHeader>

      <CardContent className='space-y-6 pt-2'>
        {/* Search Bar for PCB Barcode / QR Code */}
        <form onSubmit={handleSearch} className='flex gap-3 max-w-xl'>
          <div className='relative flex-1'>
            <Search className='absolute left-3 top-2.5 h-4 w-4 text-muted-foreground' />
            <Input
              value={searchSerial}
              onChange={(e) => setSearchSerial(e.target.value)}
              placeholder='Nhập mã Serial / QR Barcode (VD: FOX-APPLE-M3-90821)...'
              className='ps-9 font-mono text-xs h-9 bg-background/60'
            />
          </div>
          <Button type='submit' size='sm' className='h-9 px-4 text-xs font-semibold'>
            Tra Cứu MES
          </Button>
        </form>

        {/* Traceability Header Summary */}
        <div className='p-4 rounded-xl bg-purple-500/10 border border-purple-500/30 flex flex-wrap items-center justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <div className='w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400'>
              <QrCode className='h-6 w-6' />
            </div>
            <div>
              <span className='text-xs text-muted-foreground font-mono'>SERIAL NUMBER:</span>
              <div className='text-lg font-bold font-mono text-purple-300'>{activeBarcode}</div>
            </div>
          </div>

          <div className='flex items-center gap-4 text-xs text-muted-foreground'>
            <div>
              Sản phẩm: <strong className='text-foreground'>MacBook M3 Logic Board</strong>
            </div>
            <div>
              Lô sản xuất (Lot): <strong className='text-foreground'>LOT-2026-AUG-01</strong>
            </div>
            <Badge className='bg-emerald-500/20 text-emerald-400 border-emerald-500/40 text-xs px-2.5 py-0.5'>
              <ShieldCheck className='h-3.5 w-3.5 me-1' /> VERIFIED PASS
            </Badge>
          </div>
        </div>

        {/* Vertical Lifecycle Timeline */}
        <div className='space-y-3 pt-2'>
          <h4 className='text-sm font-bold flex items-center gap-2'>
            <Clock className='h-4 w-4 text-primary' />
            Vòng Đời Sản Xuất Chi Tiết (Lifecycle Timeline)
          </h4>

          <div className='space-y-3 relative border-s-2 border-primary/30 ms-4 ps-6'>
            {MOCK_TRACE_TIMELINE.map((step, idx) => (
              <div key={idx} className='relative group'>
                {/* Timeline Dot */}
                <div className='absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full bg-primary border-2 border-background ring-4 ring-primary/20' />

                <div className='p-3 rounded-lg bg-muted/30 border border-border/40 space-y-1 text-xs hover:border-primary/40 transition-all'>
                  <div className='flex items-center justify-between'>
                    <span className='font-bold text-sm text-foreground'>{step.stationName}</span>
                    <span className='font-mono text-muted-foreground'>{step.timestamp}</span>
                  </div>

                  <div className='flex items-center gap-3 text-muted-foreground text-[11px] font-mono'>
                    <span>Máy: {step.machineCode}</span>
                    <span>|</span>
                    <span>Thao tác: {step.operator}</span>
                  </div>

                  <p className='text-muted-foreground pt-1'>{step.details}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
