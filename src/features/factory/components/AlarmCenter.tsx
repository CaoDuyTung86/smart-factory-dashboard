import { memo, useEffect, useState } from 'react'
import { BookOpen, History, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useFactoryStore } from '../hooks/use-factory-store'
import { formatClock, formatSeconds } from '../lib/format'
import { factorySource } from '../services/factorySource'
import {
  isMesEnabled,
  mesApi,
  type AlarmDefinitionRow,
  type AlarmJournalEntry,
  type AlarmPerformance,
} from '../services/mesApi'
import { sensorSimulator } from '../services/sensorSimulator'
import { AlarmStateBadge, PriorityBadge } from './AlarmBadges'
import { AlarmPerformancePanel } from './AlarmPerformancePanel'
import { AlarmTable } from './AlarmTable'

/**
 * Trung tâm cảnh báo — ISA-18.2.
 *
 * Ba thứ nằm trên một màn hình vì chúng trả lời ba câu hỏi khác nhau và người
 * vận hành cần cả ba:
 *
 *   * Đang có gì kêu?              -> Alarm Summary (cùng bảng với tab SCADA)
 *   * Chuyện gì đã xảy ra?         -> Nhật ký chuyển trạng thái
 *   * Hệ cảnh báo này có tốt không? -> Bảng chỉ số hiệu năng
 *
 * Chỉ số và nhật ký tính từ `alarm_transition` trong TimescaleDB nên chỉ có khi
 * backend MES đang chạy. Chạy ngoại tuyến thì vẫn còn Alarm Summary và Master
 * Alarm Database — đủ để thấy toàn bộ cấu hình rationalization.
 */

const REFRESH_MS = 30_000
const JOURNAL_HOURS = 8
const PERFORMANCE_HOURS = 24

const acknowledgeAlarm = (tag: string) => factorySource.acknowledgeAlarm(tag)
const acknowledgeAll = () => factorySource.acknowledgeAll()
const repairMachine = (machineId: string) =>
  factorySource.repairMachine(machineId)
const shelveAlarm = (tag: string, seconds: number, reason: string) =>
  factorySource.shelveAlarm(tag, seconds, reason)
const unshelveAlarm = (tag: string) => factorySource.unshelveAlarm(tag)

const SummarySection = memo(function SummarySection() {
  const alarms = useFactoryStore((s) => s.alarms)
  const inhibitedAlarms = useFactoryStore((s) => s.inhibitedAlarms)
  return (
    <AlarmTable
      alarms={alarms}
      inhibitedAlarms={inhibitedAlarms}
      onAcknowledge={acknowledgeAlarm}
      onRepair={repairMachine}
      onShelve={shelveAlarm}
      onUnshelve={unshelveAlarm}
    />
  )
})

const StateCounts = memo(function StateCounts() {
  const counts = useFactoryStore((s) => s.alarmCounts)
  const entries = Object.entries(counts) as Array<[keyof typeof counts, number]>

  return (
    <div className='flex flex-wrap items-center gap-2'>
      {entries.map(([state, n]) => (
        <span key={state} className='inline-flex items-center gap-1'>
          <AlarmStateBadge state={state} />
          <span className='font-mono text-xs font-bold'>{n}</span>
        </span>
      ))}
    </div>
  )
})

/**
 * Kết quả một lần đọc backend, gói thành MỘT state thay vì bốn.
 *
 * Bốn cờ rời (performance / journal / definitions / error) luôn phải đổi cùng
 * nhau; để rời thì sẽ có khoảnh khắc bảng chỉ số đã là dữ liệu mới còn nhật ký
 * vẫn là dữ liệu cũ. Cùng cách gói với `MesTraceability`.
 */
interface AlarmData {
  performance: AlarmPerformance | null
  journal: AlarmJournalEntry[]
  definitions: AlarmDefinitionRow[]
  error: string | null
}

const OFFLINE_NOTE =
  'Chưa cấu hình VITE_MES_API_URL — chỉ số và nhật ký tính từ bảng alarm_transition trong TimescaleDB nên cần backend MES đang chạy.'

export function AlarmCenter() {
  const live = isMesEnabled()
  const [data, setData] = useState<AlarmData | null>(() =>
    live
      ? null
      : {
          performance: null,
          journal: [],
          // Chạy ngoại tuyến thì cấu hình lấy từ engine trong trình duyệt; có
          // backend thì lấy từ bảng `alarm_definition`. Hai nơi sinh ra từ cùng
          // một công thức, nhưng vẽ bản suy ra lên màn hình trong khi hệ thống
          // đang chạy theo cấu hình của DB là nói sai cái đang có hiệu lực.
          definitions: localDefinitions(),
          error: OFFLINE_NOTE,
        }
  )
  const [reloadToken, setReloadToken] = useState(0)

  const loading = live && data === null

  useEffect(() => {
    if (!live) return
    let cancelled = false

    const load = () => {
      Promise.all([
        mesApi.alarmPerformance(PERFORMANCE_HOURS),
        mesApi.alarmJournal(JOURNAL_HOURS),
        mesApi.alarmDefinitions(),
      ])
        .then(([performance, journal, definitions]) => {
          if (!cancelled) {
            setData({ performance, journal, definitions, error: null })
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return
          // Giữ nguyên số liệu đọc được lần cuối và chỉ gắn thêm lỗi: xoá trắng
          // bảng chỉ số vì một lần mạng chập là mất đúng thứ đang cần đọc.
          setData((prev) => ({
            performance: prev?.performance ?? null,
            journal: prev?.journal ?? [],
            definitions: prev?.definitions ?? [],
            error: err instanceof Error ? err.message : String(err),
          }))
        })
    }

    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [live, reloadToken])

  return (
    <div className='space-y-6'>
      <Card className='border-border/60 bg-card/60'>
        <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3 pb-3'>
          <div>
            <CardTitle className='text-lg font-bold'>
              Trung Tâm Cảnh Báo — ANSI/ISA-18.2
            </CardTitle>
            <CardDescription>
              Bảy trạng thái vòng đời, chống chattering bằng deadband + độ trễ,
              shelving có hạn giờ, và chỉ số hiệu năng đối chiếu chỉ tiêu công
              bố của tiêu chuẩn.
            </CardDescription>
          </div>
          <div className='flex items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              className='h-8 text-xs'
              onClick={acknowledgeAll}
            >
              Xác nhận tất cả
            </Button>
            <Button
              size='sm'
              variant='ghost'
              className='h-8 gap-1 text-xs'
              onClick={() => setReloadToken((n) => n + 1)}
              disabled={!live}
            >
              <RefreshCw className='h-3.5 w-3.5' /> Tải lại
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <StateCounts />
        </CardContent>
      </Card>

      <SummarySection />

      <AlarmPerformancePanel
        data={data?.performance ?? null}
        loading={loading}
        error={data?.error ?? null}
      />

      <JournalCard
        entries={data?.journal ?? []}
        offline={!live}
        error={data?.error ?? null}
      />

      <MasterAlarmDatabase rows={data?.definitions ?? []} />
    </div>
  )
}

function JournalCard({
  entries,
  offline,
  error,
}: {
  entries: AlarmJournalEntry[]
  offline: boolean
  error: string | null
}) {
  return (
    <Card className='border-border/60 bg-card/60'>
      <CardHeader className='pb-3'>
        <CardTitle className='flex items-center gap-2 text-lg font-bold'>
          <History className='h-5 w-5 text-primary' />
          Nhật ký chuyển trạng thái ({JOURNAL_HOURS} giờ gần nhất)
        </CardTitle>
        <CardDescription>
          Đây là thứ mở ra sau một sự cố để dựng lại diễn biến: cảnh báo nào kêu
          trước, ai xác nhận lúc nào, cái nào bị shelve trong lúc đang xử lý.
          Mọi chỉ số hiệu năng đều tính từ bảng này chứ không từ danh sách đang
          sống.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/*
          "Không đọc được" và "đọc được, và không có gì" là hai câu trả lời khác
          hẳn nhau. Hiện "chưa có chuyển trạng thái nào" trong khi thật ra không
          gọi nổi backend là đúng kiểu nói dối mà toàn bộ dự án này tránh — cùng
          lý do mất kết nối MES thì màn hình đứng lại và báo, chứ không tụt về
          số mô phỏng.
        */}
        {offline ? (
          <p className='rounded-lg border border-dashed bg-muted/20 py-6 text-center text-sm text-muted-foreground'>
            Cần backend MES đang chạy.
          </p>
        ) : error ? (
          <p className='rounded-lg border border-dashed border-destructive/40 bg-destructive/5 py-6 text-center text-sm text-destructive'>
            Không đọc được nhật ký từ MES — {error}
          </p>
        ) : entries.length === 0 ? (
          <p className='rounded-lg border border-dashed bg-muted/20 py-6 text-center text-sm text-muted-foreground'>
            Đọc được nhật ký, và trong {JOURNAL_HOURS} giờ qua không có chuyển
            trạng thái nào.
          </p>
        ) : (
          <div className='max-h-[420px] overflow-auto rounded-lg border border-border/40'>
            <Table>
              <TableHeader className='sticky top-0 bg-muted/60 backdrop-blur'>
                <TableRow>
                  <TableHead className='w-[95px]'>Thời gian</TableHead>
                  <TableHead className='w-[190px]'>Chuyển</TableHead>
                  <TableHead className='w-[130px]'>Nguyên nhân</TableHead>
                  <TableHead>Cảnh báo</TableHead>
                  <TableHead className='w-[90px]'>Người</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className='font-mono text-xs text-muted-foreground'>
                      {formatClock(e.at)}
                    </TableCell>
                    <TableCell className='font-mono text-[10px] whitespace-nowrap'>
                      {e.fromState} → <strong>{e.toState}</strong>
                    </TableCell>
                    <TableCell className='font-mono text-[10px]'>
                      {e.cause}
                    </TableCell>
                    <TableCell className='text-xs'>
                      <span className='font-mono text-[10px] text-muted-foreground'>
                        {e.tag}
                      </span>
                      {e.note && (
                        <span className='ml-1.5 text-muted-foreground'>
                          “{e.note}”
                        </span>
                      )}
                    </TableCell>
                    <TableCell className='font-mono text-[10px] text-muted-foreground'>
                      {e.operator || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Cấu hình của engine trong trình duyệt, dùng khi chưa cấu hình MES. */
function localDefinitions(): AlarmDefinitionRow[] {
  return sensorSimulator.getAlarmDefinitions().map((d) => ({
    ...d,
    unit: d.unit ?? '',
    consequence: d.consequence ?? '',
    operatorResponse: d.operatorResponse ?? '',
    responseTimeSec: d.responseTimeSec ?? 0,
    maxShelveSec: d.maxShelveSec ?? 0,
    enabled: d.enabled ?? true,
  }))
}

/**
 * Master Alarm Database — kết quả của alarm rationalization.
 *
 * Câu hỏi "vì sao cái này kêu và tôi phải làm gì trong bao lâu" phải trả lời
 * được ngay trên màn hình; bắt người vận hành đi tra sổ tay là cách chắc chắn
 * để không ai tra.
 */
function MasterAlarmDatabase({ rows }: { rows: AlarmDefinitionRow[] }) {
  if (rows.length === 0) {
    return null
  }

  return (
    <Card className='border-border/60 bg-card/60'>
      <CardHeader className='pb-3'>
        <CardTitle className='flex items-center gap-2 text-lg font-bold'>
          <BookOpen className='h-5 w-5 text-primary' />
          Master Alarm Database ({rows.length} cảnh báo)
        </CardTitle>
        <CardDescription>
          Mức ưu tiên là <em>kết quả</em> của rationalization — hàm của (hậu quả
          nếu không xử lý) và (thời gian còn lại để xử lý) — chứ không phải một
          nhãn "độ nghiêm trọng" gán tuỳ ý. Lưu mức ưu tiên mà không lưu căn cứ
          thì lần sau không ai rà soát lại được.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className='overflow-x-auto rounded-lg border border-border/40'>
          <Table>
            <TableHeader className='bg-muted/40'>
              <TableRow>
                <TableHead className='w-[175px]'>Tag</TableHead>
                <TableHead className='w-[95px]'>Ưu tiên</TableHead>
                <TableHead className='w-[105px]'>Nhóm</TableHead>
                <TableHead className='w-[135px]'>Ngưỡng</TableHead>
                <TableHead className='w-[110px]'>Độ trễ bật/tắt</TableHead>
                <TableHead>Hậu quả / hành động</TableHead>
                <TableHead className='w-[95px]'>Hạn phản ứng</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.tag}>
                  <TableCell className='font-mono text-[10px]'>
                    {d.tag}
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={d.priority} />
                  </TableCell>
                  <TableCell className='font-mono text-[10px]'>
                    {d.alarmClass}
                  </TableCell>
                  <TableCell className='font-mono text-[10px]'>
                    {d.comparison === 'BOOL'
                      ? 'BOOL'
                      : `${d.comparison} ${d.setpoint}${d.unit}`}
                    {d.comparison !== 'BOOL' && (
                      <div className='text-muted-foreground'>
                        db {d.deadband}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className='font-mono text-[10px]'>
                    {d.onDelaySec}s / {d.offDelaySec}s
                  </TableCell>
                  <TableCell className='text-[11px]'>
                    <div>{d.consequence}</div>
                    <div className='mt-0.5 text-muted-foreground'>
                      → {d.operatorResponse}
                    </div>
                  </TableCell>
                  <TableCell className='font-mono text-[10px]'>
                    {formatSeconds(d.responseTimeSec)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
