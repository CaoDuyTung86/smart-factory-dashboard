import { AlertTriangle, ArrowDown, HelpCircle, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import type { AlarmEpisode, AlarmEpisodes } from '../services/mesApi'

/**
 * First-out: trong một chuỗi cảnh báo, cái nào KHỞI PHÁT trước.
 *
 * Khi dây chuyền đổ, cảnh báo không đến một cái — chúng đến thành chùm, màn
 * hình đầy kín trong vài giây, và câu hỏi duy nhất đáng giá lúc đó là "cái nào
 * kêu TRƯỚC". Bảng điều khiển lò hơi và tua-bin đã có mạch first-out chốt riêng
 * cảnh báo đầu tiên từ những năm 1960 vì đúng lý do này.
 *
 * Ba điều màn hình này phải nói đúng, và cả ba đều là chỗ dễ làm sai:
 *
 *   1. **Thứ tự KÊU không phải thứ tự XẢY RA.** Mỗi cảnh báo có on-delay riêng,
 *      nên một nguyên nhân chờ 30 giây sẽ kêu sau một hậu quả chờ 6 giây. Nên
 *      mọi thứ ở đây xếp theo thời điểm khởi phát, và khi hai thứ tự khác nhau
 *      thì phải nói ra — đó chính là lúc đọc màn hình theo thứ tự kêu sẽ dẫn
 *      tới kết luận sai.
 *   2. **Thời gian không chứng minh được nhân quả**, nó chỉ loại trừ. Một mũi
 *      tên nhân quả chỉ hiện ra khi ma trận cause-and-effect đã khai báo sẵn
 *      quan hệ đó.
 *   3. **Máy đo nào cũng có giới hạn phân giải.** Cách nhau nhỏ hơn một nhịp
 *      thì không phân định được, và phải nói "chưa chắc" thay vì bừa một cái —
 *      chỉ sai thủ phạm sẽ đẩy người vận hành đi sửa nhầm máy.
 */

const gio = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

const PRIORITY_CLASS: Record<string, string> = {
  URGENT: 'border-destructive/40 text-destructive',
  HIGH: 'border-orange-500/40 text-orange-500',
  MEDIUM: 'border-amber-500/40 text-amber-500',
  LOW: 'border-sky-500/40 text-sky-500',
  DIAGNOSTIC: 'border-muted-foreground/40 text-muted-foreground',
}

function Khung({
  children,
  mo_ta,
}: {
  children: React.ReactNode
  mo_ta: React.ReactNode
}) {
  return (
    <Card className='border-border/60 bg-card/60'>
      <CardHeader>
        <CardTitle className='text-lg font-bold'>
          First-out &amp; cause-and-effect
        </CardTitle>
        <CardDescription>{mo_ta}</CardDescription>
      </CardHeader>
      {children}
    </Card>
  )
}

export function FirstOutPanel({
  data,
  loading,
  error,
}: {
  data: AlarmEpisodes | null
  loading: boolean
  error: string | null
}) {
  if (error) {
    // Nói rõ là KHÔNG ĐỌC ĐƯỢC, chứ không để một khung rỗng cho người xem tự
    // hiểu thành "không có chuỗi cảnh báo nào".
    return (
      <Khung
        mo_ta={
          <span className='text-destructive'>Không đọc được — {error}</span>
        }
      >
        <span />
      </Khung>
    )
  }

  if (loading || !data) {
    return (
      <Khung mo_ta='Đang dựng lại diễn biến từ nhật ký cảnh báo…'>
        <span />
      </Khung>
    )
  }

  const mo_ta = (
    <>
      Xếp theo thời điểm <strong>khởi phát</strong> (lúc kêu trừ độ trễ bật),
      chứ không theo thời điểm kêu. Cách nhau dưới{' '}
      <strong>{data.resolutionSec}s</strong> thì hệ thống không phân định được
      thứ tự và sẽ nói thẳng ra. Ma trận cause-and-effect hiện có{' '}
      <strong>{data.linkCount}</strong> quan hệ khai báo.
    </>
  )

  if (data.episodes.length === 0) {
    return (
      <Khung mo_ta={mo_ta}>
        <CardContent>
          <p className='text-sm text-muted-foreground'>
            Không có chuỗi nào trong {data.windowHours} giờ qua. Một cảnh báo lẻ
            loi không tính là chuỗi — nó tự là first-out của chính nó.
          </p>
        </CardContent>
      </Khung>
    )
  }

  return (
    <Khung mo_ta={mo_ta}>
      <CardContent className='space-y-4'>
        {data.episodes.map((ep) => (
          <ChuoiCanhBao key={ep.startedAt} ep={ep} />
        ))}
      </CardContent>
    </Khung>
  )
}

function ChuoiCanhBao({ ep }: { ep: AlarmEpisode }) {
  const dao_thu_tu = ep.reorderedByDelay.length > 0

  return (
    <div className='rounded-lg border border-border/60 p-3'>
      <div className='mb-3 flex flex-wrap items-center gap-2'>
        <Badge variant='outline' className='font-mono text-xs'>
          {gio.format(ep.startedAt)} → {gio.format(ep.endedAt)}
        </Badge>
        <span className='text-xs text-muted-foreground'>
          {ep.count} cảnh báo · {ep.assets.length} máy
        </span>
      </div>

      {/* First-out. Đây là dòng người ta mở màn hình này ra để đọc. */}
      <div className='mb-3 rounded-md bg-muted/40 p-3'>
        <div className='mb-1 flex items-center gap-2'>
          <Zap className='h-4 w-4 text-amber-500' />
          <span className='text-xs font-semibold tracking-wide uppercase'>
            First-out
          </span>
          {!ep.confident && (
            <Badge
              variant='outline'
              className='border-amber-500/40 text-[10px] text-amber-500'
            >
              chưa phân định được
            </Badge>
          )}
          {ep.confidenceBasis === 'CAUSAL_MATRIX' && (
            <Badge
              variant='outline'
              className='border-emerald-500/40 text-[10px] text-emerald-500'
            >
              phân định bằng ma trận C&amp;E
            </Badge>
          )}
        </div>
        <p className='font-mono text-sm font-semibold'>{ep.firstOut.tag}</p>
        <p className='text-xs text-muted-foreground'>{ep.firstOut.message}</p>

        {/* Đồng hồ bó tay nhưng quan hệ nhân quả đã khai báo vẫn gỡ được thế
            bế tắc — nói rõ căn cứ, vì "chắc vì đo được" và "chắc vì biết cơ
            chế" là hai loại chắc chắn khác nhau. */}
        {ep.confidenceBasis === 'CAUSAL_MATRIX' && (
          <p className='mt-2 text-xs text-emerald-600 dark:text-emerald-500'>
            Cách cảnh báo kế tiếp {ep.separationSec ?? 0}s — nhỏ hơn giới hạn
            phân giải {ep.resolutionSec}s, tức đồng hồ không tách nổi. Thứ tự ở
            đây xác định được nhờ quan hệ nhân quả đã khai báo, không nhờ đo.
          </p>
        )}

        {!ep.confident && (
          <p className='mt-2 text-xs text-amber-600 dark:text-amber-500'>
            Cách cảnh báo kế tiếp {ep.separationSec ?? 0}s, nhỏ hơn giới hạn
            phân giải {ep.resolutionSec}s của hệ.
            {ep.firstOut.tiedWith.length > 0 && (
              <>
                {' '}
                Đồng hạng với{' '}
                <span className='font-mono'>
                  {ep.firstOut.tiedWith.join(', ')}
                </span>{' '}
                — chọn ra một cái là do thứ tự chữ cái, không phải kết luận kỹ
                thuật.
              </>
            )}
          </p>
        )}
      </div>

      {dao_thu_tu && (
        <p className='mb-3 flex items-start gap-1.5 text-xs text-orange-600 dark:text-orange-400'>
          <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
          <span>
            Độ trễ bật đã làm đảo thứ tự {ep.reorderedByDelay.length} cảnh báo —
            đọc theo thứ tự kêu trên màn hình chính sẽ ra một kết luận khác.
          </span>
        </p>
      )}

      {ep.suspectedCommonCause && (
        <p className='mb-3 flex items-start gap-1.5 text-xs text-sky-600 dark:text-sky-400'>
          <HelpCircle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
          <span>
            {ep.unexplained} cảnh báo không có quan hệ nhân quả nào giải thích
            được, trải trên {ep.assets.length} máy. Đây nhiều khả năng không
            phải một chuỗi lan truyền mà là một{' '}
            <strong>nguyên nhân chung</strong> (tốc độ dây chuyền, mật độ cấp
            liệu, nguồn điện, môi trường) — truy theo kiểu chuỗi sẽ dẫn đi sai
            hướng. Hệ thống không đoán nguyên nhân, nó chỉ nói đây không phải
            một chuỗi.
          </span>
        </p>
      )}

      <ol className='space-y-1.5'>
        {ep.members.map((m) => (
          <li
            key={m.tag}
            className='flex flex-wrap items-baseline gap-x-2 text-xs'
          >
            <span className='w-10 shrink-0 text-right font-mono text-muted-foreground'>
              +{m.offsetSec}s
            </span>
            <Badge
              variant='outline'
              className={
                'shrink-0 text-[10px] ' + (PRIORITY_CLASS[m.priority] ?? '')
              }
            >
              {m.priority}
            </Badge>
            <span className='font-mono'>{m.tag}</span>
            {/* Hai mốc thời gian luôn đi cùng nhau: giấu thời điểm kêu đi thì
                không ai đối chiếu được màn hình này với nhật ký. */}
            <span className='text-muted-foreground'>
              khởi phát {gio.format(m.onsetAt)} · kêu{' '}
              {gio.format(m.annunciatedAt)}
              {m.onDelaySec > 0 && ` (trễ ${m.onDelaySec}s)`}
            </span>
            {m.explainedBy && (
              <span className='flex items-center gap-1 text-emerald-600 dark:text-emerald-500'>
                <ArrowDown className='h-3 w-3' />
                hậu quả của{' '}
                <span className='font-mono'>{m.explainedBy.causeTag}</span>
                <span className='text-muted-foreground'>
                  ({m.explainedBy.mechanism}, +{m.explainedBy.lagSec}s)
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
