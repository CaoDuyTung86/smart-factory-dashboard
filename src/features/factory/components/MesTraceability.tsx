import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Database,
  Download,
  Loader2,
  Package,
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
import {
  MesNotFoundError,
  isMesEnabled,
  mesApi,
  type LotImpact,
  type UnitRecord,
} from '../services/mesApi'

const DEFAULT_SERIAL = 'FOX-APPLE-M3-90821'

/**
 * Dòng thời gian mẫu, dùng khi chưa cấu hình `VITE_MES_API_URL`.
 *
 * Nó là dữ liệu tĩnh và được gọi đúng như vậy trên giao diện. Trước đây phần
 * này trông y hệt dữ liệu thật; giờ backend MES đã có, thứ đáng làm rõ nhất là
 * cái nào đến từ cơ sở dữ liệu và cái nào không.
 */
const SAMPLE_TIMELINE = [
  {
    seq: 1,
    station_name: 'Nhập Bản (PCB Loader)',
    asset_code: 'LOADER-A1',
    operator: 'Auto Robot Inovance',
    result: 'PASS' as const,
    time: '21:00:15',
    details: 'Jig SS #J-9042 loaded successfully. Bare PCB scanned.',
  },
  {
    seq: 2,
    station_name: 'In Kem Hàn & SPI',
    asset_code: 'PRINTER-SPI-A2',
    operator: 'Auto Printer',
    result: 'PASS' as const,
    time: '21:00:32',
    details:
      'Solder paste thickness 120µm (spec 115–125µm). Lô kem hàn SAC305 #P-2261.',
  },
  {
    seq: 3,
    station_name: 'Gắn Linh Kiện SMT (Pick & Place)',
    asset_code: 'SMT-LINE-01',
    operator: 'Auto Nozzle Array',
    result: 'PASS' as const,
    time: '21:00:58',
    details: 'Placed 148 SMT components. 0 drops. Feeder lot FD-8891.',
  },
  {
    seq: 4,
    station_name: 'Hàn Lò Hồi Lưu (Reflow Oven)',
    asset_code: 'REFLOW-OVEN-02',
    operator: 'Reflow Controller',
    result: 'PASS' as const,
    time: '21:01:40',
    details:
      'Lead-free 4 zone — preheat 150→180°C, soak 65s, peak 245.8°C, TAL 58s.',
  },
  {
    seq: 5,
    station_name: 'Kiểm Tra Quang Học (AOI)',
    asset_code: 'AOI-INSPECT-04',
    operator: 'AOI OpenCV (infra/vision)',
    result: 'PASS' as const,
    time: '21:02:15',
    details: 'Scanned 148 components. 148 PASS, 0 NG. Mark offset +0.02°.',
  },
]

const timeFormat = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function clockOf(iso: string): string {
  return timeFormat.format(new Date(iso))
}

const RESULT_STYLE: Record<string, string> = {
  PASS: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500',
  WARNING: 'border-amber-500/40 bg-amber-500/15 text-amber-500',
  FAIL: 'border-destructive/40 bg-destructive/15 text-destructive',
}

function csvEscape(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"'
}

/**
 * Xuất đủ cả lộ trình lẫn hệ phả vật tư trong một file.
 *
 * Một file chỉ có các trạm đã đi qua không trả lời được câu hỏi mà người ta
 * thực sự hỏi khi có sự cố: bo mạch này ăn lô linh kiện nào. Vì vậy hai khối
 * nằm chung một CSV, phân biệt bằng cột `record_type`.
 */
function toCsv(unit: UnitRecord): string {
  const header = [
    'record_type',
    'serial_number',
    'seq',
    'station_or_ref_des',
    'asset_or_part_number',
    'timestamp_or_lot',
    'operator_or_supplier',
    'result_or_lot_status',
    'details',
  ]
  const rows = [
    ...unit.steps.map((s) =>
      [
        'STEP',
        unit.serial_number,
        String(s.seq),
        s.station_name,
        s.asset_code,
        s.started_at,
        s.operator,
        s.result,
        JSON.stringify(s.measurements),
      ].map(csvEscape)
    ),
    ...unit.materials.map((m) =>
      [
        'MATERIAL',
        unit.serial_number,
        '',
        m.ref_des,
        m.part_number,
        m.lot_code,
        m.supplier,
        m.lot_status,
        m.consumed_at,
      ].map(csvEscape)
    ),
  ]
  return [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
}

function download(name: string, body: string) {
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Kết quả một lần tra cứu, gói chung trong một state.
 *
 * Gói lại chứ không tách thành năm `useState` riêng vì năm cờ đó luôn phải
 * thay đổi cùng lúc: một serial vừa "đang tải" vừa "không tìm thấy" là một
 * trạng thái không tồn tại. `serial` nằm trong đây để so với serial đang xem
 * mà biết còn đang tải hay không, thay vì gọi setState ngay trong effect.
 */
interface LookupResult {
  serial: string
  status: 'ok' | 'notfound' | 'error'
  unit: UnitRecord | null
  error: string | null
}

export function MesTraceability() {
  const live = isMesEnabled()
  const [searchSerial, setSearchSerial] = useState(DEFAULT_SERIAL)
  const [activeSerial, setActiveSerial] = useState(DEFAULT_SERIAL)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [impact, setImpact] = useState<LotImpact | null>(null)

  const settled = result?.serial === activeSerial ? result : null
  const loading = live && settled === null

  useEffect(() => {
    if (!live) return
    let cancelled = false

    mesApi
      .unit(activeSerial)
      .then((unit) => {
        if (!cancelled) {
          setResult({ serial: activeSerial, status: 'ok', unit, error: null })
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Không tìm thấy serial là một câu trả lời của MES, không phải sự cố
        // mạng — hai thứ này phải hiện ra khác nhau.
        setResult({
          serial: activeSerial,
          status: err instanceof MesNotFoundError ? 'notfound' : 'error',
          unit: null,
          error: err instanceof Error ? err.message : String(err),
        })
      })

    return () => {
      cancelled = true
    }
  }, [live, activeSerial])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setImpact(null)
    setActiveSerial(searchSerial.trim().toUpperCase() || DEFAULT_SERIAL)
  }

  const showLotImpact = useCallback((lotCode: string) => {
    mesApi
      .lotImpact(lotCode)
      .then(setImpact)
      .catch(() => setImpact(null))
  }, [])

  const unit = settled?.status === 'ok' ? settled.unit : null

  const handleExport = () => {
    if (unit) download('mes-trace-' + unit.serial_number + '.csv', toCsv(unit))
  }

  // Chế độ mẫu: giữ nguyên giao diện cũ nhưng nói rõ đây là dữ liệu tĩnh.
  const sampleMode = !live
  const knownSample = activeSerial.startsWith('FOX-')

  return (
    <Card className='border-primary/30 bg-card/60'>
      <CardHeader className='flex flex-row items-start justify-between pb-3'>
        <div>
          <CardTitle className='flex flex-wrap items-center gap-2 text-lg font-bold'>
            <Database className='h-5 w-5 text-purple-400' />
            Hệ Thống MES & Truy Xuất Nguồn Gốc (Product Genealogy)
            {sampleMode ? (
              <Badge
                variant='outline'
                className='border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-500'
              >
                DỮ LIỆU MẪU
              </Badge>
            ) : (
              <Badge
                variant='outline'
                className='border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-500'
              >
                MES LIVE · PostgreSQL
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Tra cứu lịch sử sản xuất của từng bo mạch: lộ trình qua các trạm, số
            đo tại mỗi trạm, và lô vật tư đã tiêu thụ
          </CardDescription>
        </div>

        <Button
          size='sm'
          variant='outline'
          className='shrink-0 gap-1.5 text-xs'
          onClick={handleExport}
          disabled={!unit}
        >
          <Download className='h-3.5 w-3.5' /> Xuất Hệ Phả (CSV)
        </Button>
      </CardHeader>

      <CardContent className='space-y-6 pt-2'>
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
            disabled={sampleMode}
          >
            Tra Cứu MES
          </Button>
        </form>

        {sampleMode ? (
          <SampleView knownSerial={knownSample} serial={activeSerial} />
        ) : loading ? (
          <div className='flex items-center gap-2 rounded-xl border border-dashed border-border/60 p-8 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' /> Đang tra cứu{' '}
            <span className='font-mono'>{activeSerial}</span> trong MES…
          </div>
        ) : settled?.status === 'notfound' ? (
          <div className='rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground'>
            🔍 Không tìm thấy bản ghi nào cho serial{' '}
            <strong className='font-mono'>{activeSerial}</strong> trong MES.
            <div className='mt-1 text-xs'>
              Lệnh sản xuất WO-2026-0901 phát hành các serial từ{' '}
              <span className='font-mono'>FOX-APPLE-M3-90801</span> đến{' '}
              <span className='font-mono'>FOX-APPLE-M3-90860</span>.
            </div>
          </div>
        ) : settled?.status === 'error' ? (
          <div className='rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive'>
            Không gọi được backend MES: {settled.error}
          </div>
        ) : unit ? (
          <UnitView
            unit={unit}
            impact={impact}
            onShowLotImpact={showLotImpact}
            onCloseImpact={() => setImpact(null)}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------- chế độ mẫu

function SampleView({
  knownSerial,
  serial,
}: {
  knownSerial: boolean
  serial: string
}) {
  if (!knownSerial) {
    return (
      <div className='rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground'>
        🔍 Không tìm thấy bản ghi nào cho serial{' '}
        <strong className='font-mono'>{serial}</strong>.
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-600 dark:text-amber-400'>
        Chưa cấu hình <span className='font-mono'>VITE_MES_API_URL</span> nên
        đây là dòng thời gian tĩnh viết sẵn trong mã nguồn. Chạy{' '}
        <span className='font-mono'>infra/docker-compose.yml</span> rồi trỏ biến
        đó tới backend MES để tra cứu dữ liệu thật trong PostgreSQL.
      </div>

      <div className='relative ms-4 space-y-3 border-s-2 border-primary/30 ps-6'>
        {SAMPLE_TIMELINE.map((step) => (
          <div key={step.seq} className='relative'>
            <div className='absolute top-1 -left-[31px] h-3.5 w-3.5 rounded-full border-2 border-background bg-primary ring-4 ring-primary/20' />
            <div className='space-y-1 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-bold'>
                  {step.seq}. {step.station_name}
                </span>
                <span className='font-mono text-muted-foreground'>
                  {step.time}
                </span>
              </div>
              <div className='flex items-center gap-3 font-mono text-[11px] text-muted-foreground'>
                <span>Máy: {step.asset_code}</span>
                <span>|</span>
                <span>Thao tác: {step.operator}</span>
              </div>
              <p className='pt-1 text-muted-foreground'>{step.details}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- chế độ live

function UnitView({
  unit,
  impact,
  onShowLotImpact,
  onCloseImpact,
}: {
  unit: UnitRecord
  impact: LotImpact | null
  onShowLotImpact: (lotCode: string) => void
  onCloseImpact: () => void
}) {
  const recalled = unit.quarantinedLots.length > 0

  return (
    <div className='space-y-6'>
      {/* Header */}
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
              {unit.serial_number}
            </div>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-4 text-xs text-muted-foreground'>
          <div>
            Sản phẩm:{' '}
            <strong className='text-foreground'>
              {unit.product_name} rev {unit.revision}
            </strong>
          </div>
          <div>
            Lệnh sản xuất:{' '}
            <strong className='font-mono text-foreground'>
              {unit.wo_number}
            </strong>
          </div>
          <Badge
            className={
              'px-2.5 py-0.5 text-xs ' +
              (RESULT_STYLE[unit.status] ?? RESULT_STYLE.WARNING)
            }
          >
            <ShieldCheck className='me-1 h-3.5 w-3.5' /> {unit.status}
          </Badge>
        </div>
      </div>

      {/* Cảnh báo thu hồi — độc lập với kết quả kiểm tra */}
      {recalled && (
        <div className='space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4'>
          <div className='flex items-center gap-2 text-sm font-bold text-destructive'>
            <AlertTriangle className='h-4 w-4' /> Bo mạch này nằm trong diện thu
            hồi vật tư
          </div>
          <p className='text-xs text-muted-foreground'>
            Bo mạch đã tiêu thụ lô đang bị cách ly:{' '}
            {unit.quarantinedLots.map((lot) => (
              <button
                key={lot}
                type='button'
                onClick={() => onShowLotImpact(lot)}
                className='mx-1 rounded border border-destructive/40 px-1.5 py-0.5 font-mono text-destructive underline-offset-2 hover:underline'
              >
                {lot}
              </button>
            ))}
            . Kết luận này độc lập với kết quả kiểm tra —{' '}
            {unit.status === 'PASS'
              ? 'bo mạch PASS toàn bộ các trạm vẫn phải thu hồi'
              : 'kể cả khi AOI đã bắt được lỗi'}
            . Đây chính là câu hỏi mà MES sinh ra để trả lời.
          </p>
        </div>
      )}

      {impact && <LotImpactPanel impact={impact} onClose={onCloseImpact} />}

      {/* Lộ trình */}
      <div className='space-y-3'>
        <h4 className='flex items-center gap-2 text-sm font-bold'>
          <Clock className='h-4 w-4 text-primary' />
          Vòng Đời Sản Xuất (Lifecycle Timeline)
        </h4>

        <div className='relative ms-4 space-y-3 border-s-2 border-primary/30 ps-6'>
          {unit.steps.map((step) => (
            <div key={step.seq + '-' + step.attempt} className='relative'>
              <div className='absolute top-1 -left-[31px] h-3.5 w-3.5 rounded-full border-2 border-background bg-primary ring-4 ring-primary/20' />
              <div className='space-y-1.5 rounded-lg border border-border/40 bg-muted/30 p-3 text-xs transition-colors hover:border-primary/40'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='text-sm font-bold text-foreground'>
                    {step.seq}. {step.station_name}
                    {step.attempt > 1 && (
                      <span className='ms-2 font-mono text-[10px] text-amber-500'>
                        lần {step.attempt}
                      </span>
                    )}
                  </span>
                  <span className='flex items-center gap-2'>
                    <Badge
                      className={
                        'px-1.5 py-0 text-[10px] ' +
                        (RESULT_STYLE[step.result] ?? '')
                      }
                    >
                      {step.result}
                    </Badge>
                    <span className='font-mono text-muted-foreground'>
                      {clockOf(step.started_at)}
                    </span>
                  </span>
                </div>

                <div className='flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-muted-foreground'>
                  <span>Máy: {step.asset_code}</span>
                  <span>|</span>
                  <span>Thao tác: {step.operator}</span>
                </div>

                {/* Số đo của trạm: đây là thứ để điều tra khi có sự cố, không
                    phải một câu mô tả tự do. */}
                {Object.keys(step.measurements).length > 0 && (
                  <div className='flex flex-wrap gap-1.5 pt-1'>
                    {Object.entries(step.measurements).map(([key, value]) => (
                      <span
                        key={key}
                        className='rounded border border-border/50 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'
                      >
                        {key}:{' '}
                        <strong className='text-foreground'>{value}</strong>
                      </span>
                    ))}
                  </div>
                )}

                {step.details && (
                  <p className='pt-0.5 text-muted-foreground'>{step.details}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lỗi */}
      {unit.defects.length > 0 && (
        <div className='space-y-2'>
          <h4 className='text-sm font-bold text-destructive'>
            Lỗi đã ghi nhận ({unit.defects.length})
          </h4>
          <div className='space-y-1.5'>
            {unit.defects.map((d, i) => (
              <div
                key={d.code + i}
                className='rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs'
              >
                <span className='font-mono font-bold text-destructive'>
                  {d.code}
                </span>
                {d.ref_des && (
                  <span className='ms-2 font-mono text-muted-foreground'>
                    @ {d.ref_des}
                  </span>
                )}
                <span className='ms-2 text-muted-foreground'>
                  {d.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hệ phả vật tư */}
      <div className='space-y-3'>
        <h4 className='flex items-center gap-2 text-sm font-bold'>
          <Package className='h-4 w-4 text-primary' />
          Hệ Phả Vật Tư ({unit.materials.length} dòng)
        </h4>
        <div className='overflow-x-auto rounded-lg border border-border/40'>
          <table className='w-full text-xs'>
            <thead className='bg-muted/50 text-[11px] text-muted-foreground'>
              <tr>
                <th className='px-3 py-2 text-start font-semibold'>Vị trí</th>
                <th className='px-3 py-2 text-start font-semibold'>Mã hàng</th>
                <th className='px-3 py-2 text-start font-semibold'>Lô</th>
                <th className='px-3 py-2 text-start font-semibold'>
                  Nhà cung cấp
                </th>
                <th className='px-3 py-2 text-start font-semibold'>
                  Trạng thái lô
                </th>
              </tr>
            </thead>
            <tbody>
              {unit.materials.map((m) => {
                const bad = m.lot_status === 'QUARANTINED'
                return (
                  <tr
                    key={m.ref_des + m.lot_code}
                    className={
                      'border-t border-border/30 ' +
                      (bad ? 'bg-destructive/10' : '')
                    }
                  >
                    <td className='px-3 py-1.5 font-mono font-semibold'>
                      {m.ref_des}
                    </td>
                    <td className='px-3 py-1.5 font-mono text-muted-foreground'>
                      {m.part_number}
                    </td>
                    <td className='px-3 py-1.5 font-mono'>
                      {bad ? (
                        <button
                          type='button'
                          onClick={() => onShowLotImpact(m.lot_code)}
                          className='text-destructive underline-offset-2 hover:underline'
                        >
                          {m.lot_code}
                        </button>
                      ) : (
                        m.lot_code
                      )}
                    </td>
                    <td className='px-3 py-1.5 text-muted-foreground'>
                      {m.supplier}
                    </td>
                    <td className='px-3 py-1.5'>
                      <span
                        className={
                          'rounded px-1.5 py-0.5 font-mono text-[10px] ' +
                          (bad
                            ? 'bg-destructive/20 text-destructive'
                            : 'text-muted-foreground')
                        }
                      >
                        {m.lot_status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/**
 * Truy vấn thu hồi: một lô vật tư đã đi vào những bo mạch nào.
 *
 * Con số đáng chú ý nhất trên bảng này là "đã PASS": đó là những bo mạch không
 * có bất kỳ dấu hiệu lỗi nào nhưng vẫn phải thu hồi. Không có hệ phả thì cách
 * duy nhất để an toàn là thu hồi toàn bộ khoảng thời gian nghi ngờ.
 */
function LotImpactPanel({
  impact,
  onClose,
}: {
  impact: LotImpact
  onClose: () => void
}) {
  const { lot, summary, units } = impact

  return (
    <div className='space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <h4 className='text-sm font-bold'>
            Phạm vi ảnh hưởng của lô{' '}
            <span className='font-mono text-amber-500'>{lot.lot_code}</span>
          </h4>
          <p className='text-xs text-muted-foreground'>
            {lot.part_number} · {lot.supplier} · trạng thái {lot.status}
          </p>
        </div>
        <Button size='sm' variant='ghost' className='text-xs' onClick={onClose}>
          Đóng
        </Button>
      </div>

      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        {[
          ['Bo mạch bị ảnh hưởng', summary.units_affected, 'text-foreground'],
          ['Trong đó đã PASS', summary.units_passed, 'text-amber-500'],
          ['Đã FAIL', summary.units_failed, 'text-destructive'],
          ['Lệnh sản xuất', summary.work_orders, 'text-foreground'],
        ].map(([label, value, tone]) => (
          <div
            key={String(label)}
            className='rounded-lg border border-border/40 bg-background/50 p-2 text-center'
          >
            <div className='text-[10px] text-muted-foreground'>{label}</div>
            <div className={'font-mono text-lg font-bold ' + tone}>{value}</div>
          </div>
        ))}
      </div>

      <div className='max-h-40 overflow-y-auto rounded-lg border border-border/40'>
        <table className='w-full text-xs'>
          <tbody>
            {units.map((u) => (
              <tr key={u.serial_number} className='border-b border-border/20'>
                <td className='px-3 py-1 font-mono'>{u.serial_number}</td>
                <td className='px-3 py-1 font-mono text-muted-foreground'>
                  {u.ref_des}
                </td>
                <td className='px-3 py-1 text-end'>
                  <span
                    className={
                      'rounded px-1.5 py-0.5 font-mono text-[10px] ' +
                      (RESULT_STYLE[u.status] ?? '')
                    }
                  >
                    {u.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {impact.truncated && (
        <p className='text-[11px] text-muted-foreground'>
          Danh sách đã bị cắt bớt — truy vấn còn nhiều bo mạch hơn số hiện ra.
        </p>
      )}
    </div>
  )
}
