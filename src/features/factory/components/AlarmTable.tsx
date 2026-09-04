import { useState } from 'react'
import { AlertOctagon, BellOff, Check, Undo2, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatClock, formatSeconds } from '../lib/format'
import { type ActiveAlarm } from '../types'
import { AlarmStateBadge, PriorityBadge } from './AlarmBadges'

/** Hạn shelve mặc định trên nút bấm nhanh. */
const QUICK_SHELVE_SEC = 30 * 60

interface AlarmTableProps {
  alarms: ActiveAlarm[]
  inhibitedAlarms: ActiveAlarm[]
  onAcknowledge: (tag: string) => void
  onRepair: (machineId: string) => void
  onShelve: (tag: string, seconds: number, reason: string) => void
  onUnshelve: (tag: string) => void
}

export function AlarmTable({
  alarms,
  inhibitedAlarms,
  onAcknowledge,
  onRepair,
  onShelve,
  onUnshelve,
}: AlarmTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const unackCount = alarms.filter((a) => a.state === 'UNACK_ALM').length
  const rtnCount = alarms.filter((a) => a.state === 'RTN_UNACK').length

  return (
    <Card className='border-border/60 bg-card/60'>
      <CardHeader className='flex flex-row items-start justify-between pb-3'>
        <div>
          <CardTitle className='flex items-center gap-2 text-lg font-bold'>
            <AlertOctagon className='h-5 w-5 text-destructive' />
            Alarm Summary — ISA-18.2
          </CardTitle>
          <CardDescription>
            Sắp theo mức ưu tiên trước, thời gian sau. Khi nhiều cảnh báo ập đến
            cùng lúc, để thứ tự thời gian quyết định cái nguy hiểm nhất nằm ở
            đâu là chuyện may rủi.
          </CardDescription>
        </div>
        <div className='flex shrink-0 gap-2'>
          {unackCount > 0 && (
            <Badge variant='destructive' className='px-3 py-1 text-xs'>
              {unackCount} chưa xác nhận
            </Badge>
          )}
          {rtnCount > 0 && (
            <Badge className='bg-sky-500/20 px-3 py-1 text-xs text-sky-400 hover:bg-sky-500/30'>
              {rtnCount} đã tự hết, chờ xác nhận
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className='space-y-4'>
        {alarms.length === 0 ? (
          <div className='rounded-lg border border-dashed bg-muted/20 py-8 text-center text-sm text-muted-foreground'>
            🟢 Không có cảnh báo nào đang hoạt động.
          </div>
        ) : (
          <div className='overflow-x-auto rounded-lg border border-border/40'>
            <Table>
              <TableHeader className='bg-muted/40'>
                <TableRow>
                  <TableHead className='w-[95px]'>Thời gian</TableHead>
                  <TableHead className='w-[105px]'>Ưu tiên</TableHead>
                  <TableHead className='w-[135px]'>Trạng thái</TableHead>
                  <TableHead>Nội dung</TableHead>
                  <TableHead className='w-[110px] text-right'>
                    Giá trị
                  </TableHead>
                  <TableHead className='w-[230px] text-right'>
                    Thao tác
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alarms.map((alarm) => (
                  <AlarmRow
                    key={alarm.tag}
                    alarm={alarm}
                    expanded={expanded === alarm.tag}
                    onToggle={() =>
                      setExpanded(expanded === alarm.tag ? null : alarm.tag)
                    }
                    onAcknowledge={onAcknowledge}
                    onRepair={onRepair}
                    onShelve={onShelve}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {inhibitedAlarms.length > 0 && (
          <InhibitedList alarms={inhibitedAlarms} onUnshelve={onUnshelve} />
        )}
      </CardContent>
    </Card>
  )
}

interface AlarmRowProps {
  alarm: ActiveAlarm
  expanded: boolean
  onToggle: () => void
  onAcknowledge: (tag: string) => void
  onRepair: (machineId: string) => void
  onShelve: (tag: string, seconds: number, reason: string) => void
}

function AlarmRow({
  alarm,
  expanded,
  onToggle,
  onAcknowledge,
  onRepair,
  onShelve,
}: AlarmRowProps) {
  const unack = alarm.state === 'UNACK_ALM'
  const inAlarm = unack || alarm.state === 'ACKED_ALM'

  return (
    <>
      <TableRow
        className={
          'cursor-pointer ' +
          (unack ? 'bg-destructive/10 hover:bg-destructive/15' : 'opacity-90')
        }
        onClick={onToggle}
      >
        <TableCell className='font-mono text-xs text-muted-foreground'>
          {alarm.raisedAt ? formatClock(alarm.raisedAt) : '—'}
        </TableCell>
        <TableCell>
          <PriorityBadge priority={alarm.priority} />
        </TableCell>
        <TableCell>
          <AlarmStateBadge state={alarm.state} />
        </TableCell>
        <TableCell className='text-xs font-semibold'>
          {alarm.message}
          <div className='mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] font-normal text-muted-foreground'>
            <span>{alarm.tag}</span>
            {alarm.chattering && (
              <span className='rounded bg-amber-500/20 px-1 text-amber-500'>
                CHATTERING
              </span>
            )}
            {alarm.stale && (
              <span className='rounded bg-purple-500/20 px-1 text-purple-400'>
                STALE &gt;24h
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className='text-right font-mono text-xs'>
          {alarm.comparison === 'BOOL' ? (
            <span className='text-muted-foreground'>—</span>
          ) : (
            <>
              <span className={inAlarm ? 'font-bold text-destructive' : ''}>
                {alarm.value}
              </span>
              <span className='text-muted-foreground'>
                {' '}
                {alarm.unit}
                <br />
                SP {alarm.setpoint}
              </span>
            </>
          )}
        </TableCell>
        <TableCell
          className='space-x-1.5 text-right'
          onClick={(e) => e.stopPropagation()}
        >
          {inAlarm && (
            <Button
              size='sm'
              variant='outline'
              className='h-7 gap-1 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500'
              onClick={() => onRepair(alarm.assetCode)}
            >
              <Wrench className='h-3 w-3' /> Sửa Máy
            </Button>
          )}
          {unack || alarm.state === 'RTN_UNACK' ? (
            <Button
              size='sm'
              variant='outline'
              className='h-7 bg-background text-xs hover:bg-muted'
              onClick={() => onAcknowledge(alarm.tag)}
            >
              Xác nhận
            </Button>
          ) : (
            <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
              <Check className='h-3.5 w-3.5 text-emerald-500' /> Đã xác nhận
            </span>
          )}
          {inAlarm && (
            <Button
              size='sm'
              variant='ghost'
              title='Tạm gỡ khỏi màn hình 30 phút'
              className='h-7 gap-1 px-2 text-xs'
              onClick={() =>
                onShelve(
                  alarm.tag,
                  Math.min(QUICK_SHELVE_SEC, alarm.maxShelveSec),
                  'Tạm gỡ từ màn hình SCADA'
                )
              }
            >
              <BellOff className='h-3 w-3' />
            </Button>
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className='bg-muted/20 hover:bg-muted/20'>
          <TableCell colSpan={6} className='py-3'>
            {/*
              Đây là phần rationalization của ISA-18.2. Câu hỏi "vì sao cái này
              kêu, và tôi phải làm gì trong bao lâu" phải trả lời được ngay tại
              chỗ; bắt người vận hành đi tra sổ tay là cách chắc chắn để không
              ai tra.
            */}
            <div className='grid gap-3 text-xs sm:grid-cols-3'>
              <Field label='Hậu quả nếu bỏ qua' value={alarm.consequence} />
              <Field
                label='Người vận hành phải làm'
                value={alarm.operatorResponse}
              />
              <Field
                label='Thời gian cho phép phản ứng'
                value={formatSeconds(alarm.responseTimeSec)}
              />
              <Field label='Nhóm cảnh báo' value={alarm.alarmClass} />
              <Field
                label='Ngưỡng / deadband'
                value={
                  alarm.comparison === 'BOOL'
                    ? 'Tín hiệu số'
                    : `${alarm.comparison} ${alarm.setpoint}${alarm.unit} · tắt dưới ${
                        alarm.setpoint - alarm.deadband
                      }${alarm.unit}`
                }
              />
              <Field
                label='Hạn shelve tối đa'
                value={formatSeconds(alarm.maxShelveSec)}
              />
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className='text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'>
        {label}
      </div>
      <div className='mt-0.5'>{value || '—'}</div>
    </div>
  )
}

function InhibitedList({
  alarms,
  onUnshelve,
}: {
  alarms: ActiveAlarm[]
  onUnshelve: (tag: string) => void
}) {
  return (
    <div className='rounded-lg border border-amber-500/30 bg-amber-500/5 p-3'>
      <div className='mb-2 flex items-center gap-2 text-xs font-semibold'>
        <BellOff className='h-4 w-4 text-amber-500' />
        Đang bị tắt tiếng ({alarms.length})
        <span className='font-normal text-muted-foreground'>
          — tắt một cảnh báo mà không có chỗ nào nhìn lại được thì đúng là đã
          xoá nó
        </span>
      </div>
      <ul className='space-y-1.5'>
        {alarms.map((a) => (
          <li key={a.tag} className='flex flex-wrap items-center gap-2 text-xs'>
            <AlarmStateBadge state={a.state} />
            <span className='font-mono text-[10px] text-muted-foreground'>
              {a.tag}
            </span>
            <span className='font-medium'>{a.message}</span>
            {a.shelveReason && (
              <span className='text-muted-foreground'>
                — “{a.shelveReason}”
              </span>
            )}
            {a.shelvedUntil && (
              <span className='font-mono text-[10px] text-muted-foreground'>
                tự bật lại {formatClock(a.shelvedUntil)}
              </span>
            )}
            {a.state === 'SHELVED' && (
              <Button
                size='sm'
                variant='ghost'
                className='h-6 gap-1 px-2 text-[11px]'
                onClick={() => onUnshelve(a.tag)}
              >
                <Undo2 className='h-3 w-3' /> Bật lại
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
