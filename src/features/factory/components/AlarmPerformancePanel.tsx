import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { AlarmPerformance, AlarmVerdict } from '../services/mesApi'

/**
 * Bảng chỉ số hiệu năng hệ cảnh báo — ISA-18.2 điều 16, đối chiếu EEMUA 191.
 *
 * Đây là phần trả lời câu hỏi "hệ cảnh báo của bạn có DÙNG ĐƯỢC không", khác
 * hẳn câu "hệ cảnh báo của bạn có CHẠY không". Một hệ thống bắn ra 600 cảnh báo
 * một ca vẫn chạy hoàn hảo về mặt kỹ thuật, và vẫn vô dụng: không ai đọc nổi
 * 600 dòng trong tám giờ.
 *
 * Bảng này nói thật kể cả khi chính hệ thống trong dự án trượt chỉ tiêu.
 */

const STATUS_META = {
  ok: {
    icon: CheckCircle2,
    className: 'text-emerald-500',
    border: 'border-emerald-500/30 bg-emerald-500/5',
    label: 'Đạt',
  },
  warn: {
    icon: AlertTriangle,
    className: 'text-amber-500',
    border: 'border-amber-500/30 bg-amber-500/5',
    label: 'Cần chú ý',
  },
  bad: {
    icon: XCircle,
    className: 'text-destructive',
    border: 'border-destructive/30 bg-destructive/5',
    label: 'Không đạt',
  },
} as const

export function AlarmPerformancePanel({
  data,
  loading,
  error,
}: {
  data: AlarmPerformance | null
  loading: boolean
  error: string | null
}) {
  if (error) {
    return (
      <Card className='border-border/60 bg-card/60'>
        <CardHeader>
          <CardTitle className='text-lg font-bold'>
            Chỉ số hiệu năng hệ cảnh báo
          </CardTitle>
          {/* Nói rõ là KHÔNG ĐỌC ĐƯỢC, chứ không để một khung rỗng cho người
              xem tự hiểu thành "hệ cảnh báo đang sạch". */}
          <CardDescription className='text-destructive'>
            Không đọc được chỉ số từ MES — {error}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (loading || !data) {
    return (
      <Card className='border-border/60 bg-card/60'>
        <CardHeader>
          <CardTitle className='text-lg font-bold'>
            Chỉ số hiệu năng hệ cảnh báo
          </CardTitle>
          <CardDescription>Đang đọc nhật ký cảnh báo…</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const overall = STATUS_META[data.overall]

  return (
    <Card className='border-border/60 bg-card/60'>
      <CardHeader className='flex flex-row items-start justify-between pb-3'>
        <div>
          <CardTitle className='text-lg font-bold'>
            Chỉ số hiệu năng hệ cảnh báo
          </CardTitle>
          <CardDescription>
            ISA-18.2 điều 16 / EEMUA 191 · cửa sổ {data.windowHours} giờ ·{' '}
            {data.annunciations} lần kêu trên {data.periods} khoảng{' '}
            {data.bucketMinutes} phút
          </CardDescription>
        </div>
        <Badge className={'px-3 py-1 text-xs ' + overall.border}>
          <overall.icon className={'mr-1 h-3.5 w-3.5 ' + overall.className} />
          {overall.label}
        </Badge>
      </CardHeader>

      <CardContent className='space-y-5'>
        <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
          {data.verdicts.map((v) => (
            <VerdictTile key={v.key} verdict={v} />
          ))}
        </div>

        <RateStrip data={data} />

        <div className='grid gap-4 lg:grid-cols-2'>
          <PriorityDistribution data={data} />
          <BadActors data={data} />
        </div>

        <AckResponse data={data} />
      </CardContent>
    </Card>
  )
}

function VerdictTile({ verdict }: { verdict: AlarmVerdict }) {
  const meta = STATUS_META[verdict.status]
  return (
    <div className={'rounded-lg border p-3 ' + meta.border}>
      <div className='flex items-start justify-between gap-2'>
        <span className='text-[11px] font-semibold text-muted-foreground'>
          {verdict.label}
        </span>
        <meta.icon className={'h-4 w-4 shrink-0 ' + meta.className} />
      </div>
      <div className='mt-1 font-mono text-xl font-bold'>{verdict.value}</div>
      <div className='text-[10px] text-muted-foreground'>
        Chỉ tiêu ≤ {verdict.target}
      </div>
      <p className='mt-1.5 text-[10px] leading-snug text-muted-foreground'>
        {verdict.note}
      </p>
    </div>
  )
}

/**
 * Số cảnh báo trong từng khoảng 10 phút.
 *
 * Vẽ cả những khoảng bằng 0: bỏ chúng đi là cách dễ nhất để một hệ thống đang
 * ngồi trên một trận cảnh báo vẫn báo cáo đẹp — mẫu số phải là toàn bộ thời
 * gian của ca, không phải chỉ những lúc có cảnh báo.
 */
function RateStrip({ data }: { data: AlarmPerformance }) {
  const buckets = data.rate.buckets
  const peak = Math.max(1, data.rate.perTenMinPeak)

  return (
    <div>
      <div className='mb-1.5 flex items-baseline justify-between text-xs'>
        <span className='font-semibold'>
          Cảnh báo theo từng khoảng {data.bucketMinutes} phút
        </span>
        <span className='font-mono text-[11px] text-muted-foreground'>
          trung bình {data.rate.perTenMinAvg} · đỉnh {data.rate.perTenMinPeak} ·{' '}
          {data.rate.floodPeriods} khoảng bị flood
        </span>
      </div>
      <div className='flex h-14 items-end gap-px overflow-x-auto rounded border border-border/40 bg-muted/20 p-1'>
        {buckets.map((count, i) => (
          <div
            key={i}
            title={`${count} cảnh báo`}
            className={
              'w-full min-w-[2px] rounded-t ' +
              (count > 10
                ? 'bg-destructive'
                : count > 2
                  ? 'bg-amber-500'
                  : count > 0
                    ? 'bg-emerald-500'
                    : 'bg-border')
            }
            style={{
              height: count === 0 ? '2px' : `${(count / peak) * 100}%`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function PriorityDistribution({ data }: { data: AlarmPerformance }) {
  return (
    <div className='rounded-lg border border-border/40 p-3'>
      <div className='mb-2 text-xs font-semibold'>
        Phân bố mức ưu tiên đã kêu
        <span className='ml-1 font-normal text-muted-foreground'>
          — chỉ tiêu ~80 / 15 / 5 / &lt;1
        </span>
      </div>
      <div className='space-y-1.5'>
        {data.priorityDistribution.map((row) => (
          <div key={row.priority} className='flex items-center gap-2 text-xs'>
            <span className='w-[86px] shrink-0 font-mono text-[10px]'>
              {row.priority}
            </span>
            <div className='relative h-4 flex-1 overflow-hidden rounded bg-muted/40'>
              <div
                className='h-full bg-primary/60'
                style={{ width: `${Math.min(100, row.pct)}%` }}
              />
              {/* Vạch chỉ tiêu vẽ đè lên thanh, để nhìn ra ngay lệch bên nào. */}
              <div
                className='absolute top-0 h-full w-px bg-foreground/60'
                style={{ left: `${Math.min(100, row.targetPct)}%` }}
                title={`chỉ tiêu ${row.targetPct}%`}
              />
            </div>
            <span className='w-[70px] shrink-0 text-right font-mono text-[10px] text-muted-foreground'>
              {row.pct}% ({row.count})
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BadActors({ data }: { data: AlarmPerformance }) {
  return (
    <div className='rounded-lg border border-border/40 p-3'>
      <div className='mb-2 text-xs font-semibold'>
        10 tag kêu nhiều nhất
        <span className='ml-1 font-normal text-muted-foreground'>
          — chiếm {data.topTenPct}% tổng tải
        </span>
      </div>
      {data.badActors.length === 0 ? (
        <p className='text-xs text-muted-foreground'>
          Chưa có cảnh báo nào trong cửa sổ này.
        </p>
      ) : (
        <ul className='space-y-1'>
          {data.badActors.map((a) => (
            <li key={a.tag} className='flex items-center gap-2 text-xs'>
              <span className='w-9 shrink-0 text-right font-mono font-bold'>
                {a.count}
              </span>
              <span className='w-11 shrink-0 text-right font-mono text-[10px] text-muted-foreground'>
                {a.pct}%
              </span>
              <span className='truncate font-mono text-[10px]'>{a.tag}</span>
            </li>
          ))}
        </ul>
      )}
      <p className='mt-2 text-[10px] leading-snug text-muted-foreground'>
        Tập trung cao là một phát hiện, không phải lời khen: sửa vài tag là giảm
        được phần lớn tải cảnh báo.
      </p>
    </div>
  )
}

function AckResponse({ data }: { data: AlarmPerformance }) {
  const { medianSec, p90Sec, count } = data.ackResponse
  return (
    <div className='rounded-lg border border-border/40 p-3 text-xs'>
      <span className='font-semibold'>Thời gian tới lúc xác nhận</span>{' '}
      {count === 0 ? (
        // "Chưa ai xác nhận cảnh báo nào" và "mọi người xác nhận tức thì trong
        // 0 giây" là hai tình huống ngược hẳn nhau, nên không hiển thị số 0.
        <span className='text-muted-foreground'>
          — chưa có lần xác nhận nào trong cửa sổ này.
        </span>
      ) : (
        <span className='font-mono text-muted-foreground'>
          trung vị {medianSec}s · p90 {p90Sec}s · trên {count} lần kêu
        </span>
      )}
      {data.shelvesWithoutReason > 0 && (
        <div className='mt-1.5 text-destructive'>
          {data.shelvesWithoutReason}/{data.shelves} lần shelve không ghi lý do
          — ISA-18.2 xếp đây là <em>unauthorized suppression</em>.
        </div>
      )}
    </div>
  )
}
