import { useState } from 'react'
import {
  Clock,
  Database,
  Download,
  QrCode,
  Search,
  ShieldCheck,
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
import { Input } from '@/components/ui/input'

interface TraceabilityStep {
  stationName: string
  /** Same asset codes SCADA and the Digital Twin use for these machines. */
  machineCode: string
  timestamp: string
  operator: string
  details: string
  status: 'PASS' | 'WARNING' | 'FAIL'
}

const TRACE_TIMELINE: TraceabilityStep[] = [
  {
    stationName: '1. Nhập Bản (PCB Loader)',
    machineCode: 'LOADER-A1',
    timestamp: '21:00:15',
    operator: 'Auto Robot Inovance',
    details: 'Jig SS #J-9042 loaded successfully. Bare PCB scanned.',
    status: 'PASS',
  },
  {
    stationName: '2. In Kem Hàn & SPI (Stencil Printer)',
    machineCode: 'PRINTER-SPI-A2',
    timestamp: '21:00:32',
    operator: 'Auto Printer',
    details:
      'Solder paste thickness: 120µm (Target 115-125µm). Lô kem hàn: SAC305 #P-2261. SPI Inspection: PASS.',
    status: 'PASS',
  },
  {
    stationName: '3. Gắn Linh Kiện SMT (Pick & Place)',
    machineCode: 'SMT-LINE-01',
    timestamp: '21:00:58',
    operator: 'Auto Nozzle Array',
    details:
      'Placed 148 SMT components (Apple M3 Chip, Resistors, Capacitors). 0 Drops. Feeder lot: FD-8891.',
    status: 'PASS',
  },
  {
    stationName: '4. Hàn Lò Hồi Lưu (Reflow Oven)',
    machineCode: 'REFLOW-OVEN-02',
    timestamp: '21:01:40',
    operator: 'Reflow Controller',
    details:
      'Lead-free profile 4 zone — Preheat 150→180°C, Soak 65s, Peak 245.8°C, Cooling < 4°C/s. TAL 58s.',
    status: 'PASS',
  },
  {
    stationName: '5. Kiểm Tra Quang Học (AOI Camera)',
    machineCode: 'AOI-INSPECT-04',
    timestamp: '21:02:15',
    operator: 'Cognex Vision AI',
    details:
      'Scanned 148 components. 148 PASS, 0 NG. Mark Alignment Offset: +0.02°.',
    status: 'PASS',
  },
]

const DEFAULT_SERIAL = 'FOX-APPLE-M3-90821'

function toCsv(serialNumber: string, steps: TraceabilityStep[]): string {
  const header = [
    'serial_number',
    'sequence',
    'station',
    'asset_code',
    'timestamp',
    'operator',
    'status',
    'details',
  ]
  const escape = (v: string) => '"' + v.replace(/"/g, '""') + '"'

  const rows = steps.map((s, i) =>
    [
      serialNumber,
      String(i + 1),
      s.stationName,
      s.machineCode,
      s.timestamp,
      s.operator,
      s.status,
      s.details,
    ]
      .map(escape)
      .join(',')
  )

  return [header.join(','), ...rows].join('\n')
}

export function MesTraceability() {
  const [searchSerial, setSearchSerial] = useState(DEFAULT_SERIAL)
  const [activeBarcode, setActiveBarcode] = useState(DEFAULT_SERIAL)

  // Stand-in for the MES lookup: only serials issued by this plant resolve.
  const isKnownSerial = activeBarcode.startsWith('FOX-')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setActiveBarcode(searchSerial.trim().toUpperCase() || DEFAULT_SERIAL)
  }

  const handleExportCsv = () => {
    const blob = new Blob([toCsv(activeBarcode, TRACE_TIMELINE)], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'mes-trace-' + activeBarcode + '.csv'
    link.click()
    // Free the blob as soon as the download has been handed to the browser.
    URL.revokeObjectURL(url)
  }

  return (
    <Card className='border-primary/30 bg-card/60'>
      <CardHeader className='flex flex-row items-center justify-between pb-3'>
        <div>
          <CardTitle className='flex items-center gap-2 text-lg font-bold'>
            <Database className='h-5 w-5 text-purple-400' />
            Hệ Thống MES & Truy Xuất Nguồn Gốc Bo Mạch (Product Traceability)
          </CardTitle>
          <CardDescription>
            Tra cứu lịch sử sản xuất từng giây của bo mạch qua chuỗi các trạm
            máy SMT, lô nguyên liệu và kết quả kiểm định
          </CardDescription>
        </div>

        <Button
          size='sm'
          variant='outline'
          className='gap-1.5 text-xs'
          onClick={handleExportCsv}
          disabled={!isKnownSerial}
        >
          <Download className='h-3.5 w-3.5' /> Xuất Báo Cáo Log (CSV)
        </Button>
      </CardHeader>

      <CardContent className='space-y-6 pt-2'>
        {/* Search Bar for PCB Barcode / QR Code */}
        <form onSubmit={handleSearch} className='flex max-w-xl gap-3'>
          <div className='relative flex-1'>
            <Search className='absolute top-2.5 left-3 h-4 w-4 text-muted-foreground' />
            <Input
              value={searchSerial}
              onChange={(e) => setSearchSerial(e.target.value)}
              placeholder='Nhập mã Serial / QR Barcode (VD: FOX-APPLE-M3-90821)...'
              className='h-9 bg-background/60 ps-9 font-mono text-xs'
            />
          </div>
          <Button
            type='submit'
            size='sm'
            className='h-9 px-4 text-xs font-semibold'
          >
            Tra Cứu MES
          </Button>
        </form>

        {!isKnownSerial ? (
          <div className='rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground'>
            🔍 Không tìm thấy bản ghi nào cho serial{' '}
            <strong className='font-mono'>{activeBarcode}</strong> trong MES.
            <div className='mt-1 text-xs'>
              Serial hợp lệ do nhà máy phát hành bắt đầu bằng tiền tố{' '}
              <span className='font-mono'>FOX-</span>.
            </div>
          </div>
        ) : (
          <>
            {/* Traceability Header Summary */}
            <div className='flex flex-wrap items-center justify-between gap-4 rounded-xl border border-purple-500/30 bg-purple-500/10 p-4'>
              <div className='flex items-center gap-3'>
                <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400'>
                  <QrCode className='h-6 w-6' />
                </div>
                <div>
                  <span className='font-mono text-xs text-muted-foreground'>
                    SERIAL NUMBER:
                  </span>
                  <div className='font-mono text-lg font-bold text-purple-300'>
                    {activeBarcode}
                  </div>
                </div>
              </div>

              <div className='flex items-center gap-4 text-xs text-muted-foreground'>
                <div>
                  Sản phẩm:{' '}
                  <strong className='text-foreground'>
                    MacBook M3 Logic Board
                  </strong>
                </div>
                <div>
                  Lô sản xuất (Lot):{' '}
                  <strong className='text-foreground'>LOT-2026-AUG-01</strong>
                </div>
                <Badge className='border-emerald-500/40 bg-emerald-500/20 px-2.5 py-0.5 text-xs text-emerald-400'>
                  <ShieldCheck className='me-1 h-3.5 w-3.5' /> VERIFIED PASS
                </Badge>
              </div>
            </div>

            {/* Vertical Lifecycle Timeline */}
            <div className='space-y-3 pt-2'>
              <h4 className='flex items-center gap-2 text-sm font-bold'>
                <Clock className='h-4 w-4 text-primary' />
                Vòng Đời Sản Xuất Chi Tiết (Lifecycle Timeline)
              </h4>

              <div className='relative ms-4 space-y-3 border-s-2 border-primary/30 ps-6'>
                {TRACE_TIMELINE.map((step) => (
                  <div key={step.machineCode} className='group relative'>
                    <div className='absolute top-1 -left-[31px] h-3.5 w-3.5 rounded-full border-2 border-background bg-primary ring-4 ring-primary/20' />

                    <div className='space-y-1 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs transition-colors hover:border-primary/40'>
                      <div className='flex items-center justify-between'>
                        <span className='text-sm font-bold text-foreground'>
                          {step.stationName}
                        </span>
                        <span className='font-mono text-muted-foreground'>
                          {step.timestamp}
                        </span>
                      </div>

                      <div className='flex items-center gap-3 font-mono text-[11px] text-muted-foreground'>
                        <span>Máy: {step.machineCode}</span>
                        <span>|</span>
                        <span>Thao tác: {step.operator}</span>
                      </div>

                      <p className='pt-1 text-muted-foreground'>
                        {step.details}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
