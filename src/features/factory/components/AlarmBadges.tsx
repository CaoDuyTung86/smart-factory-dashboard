import { Badge } from '@/components/ui/badge'
import type { AlarmPriority, AlarmState } from '../types'

/**
 * Màu và nhãn cho bảy trạng thái ISA-18.2 và năm mức ưu tiên.
 *
 * Để riêng một file vì cả `AlarmTable` (tab SCADA) lẫn màn hình `/alarms` đều
 * vẽ chúng, và hai chỗ tô khác màu cho cùng một trạng thái là cách chắc chắn
 * để người vận hành đọc nhầm.
 *
 * Ba trạng thái "bị tắt tiếng" cố ý KHÔNG dùng chung một màu: shelve là việc
 * của người vận hành, suppress là của logic thiết kế, out-of-service là của bảo
 * trì. Nhìn màu phải biết ngay ai đã tắt nó.
 */

const STATE_STYLE: Record<AlarmState, { label: string; className: string }> = {
  NORMAL: {
    label: 'Bình thường',
    className: 'bg-muted text-muted-foreground hover:bg-muted',
  },
  UNACK_ALM: {
    label: 'Chưa xác nhận',
    className: 'bg-destructive text-white hover:bg-destructive/90',
  },
  ACKED_ALM: {
    label: 'Đã xác nhận',
    className: 'bg-amber-500/20 text-amber-500 hover:bg-amber-500/30',
  },
  RTN_UNACK: {
    label: 'Đã hết · chờ xác nhận',
    className: 'bg-sky-500/20 text-sky-400 hover:bg-sky-500/30',
  },
  SHELVED: {
    label: 'Shelved',
    className: 'bg-violet-500/20 text-violet-400 hover:bg-violet-500/30',
  },
  SUPPRESSED_BY_DESIGN: {
    label: 'Suppressed',
    className: 'bg-slate-500/25 text-slate-400 hover:bg-slate-500/35',
  },
  OUT_OF_SERVICE: {
    label: 'Out of service',
    className: 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30',
  },
}

const PRIORITY_STYLE: Record<AlarmPriority, string> = {
  DIAGNOSTIC: 'bg-muted text-muted-foreground hover:bg-muted',
  LOW: 'bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30',
  MEDIUM: 'bg-amber-500/20 text-amber-500 hover:bg-amber-500/30',
  HIGH: 'bg-orange-500/25 text-orange-400 hover:bg-orange-500/35',
  URGENT: 'bg-destructive text-white hover:bg-destructive/90',
}

export function AlarmStateBadge({ state }: { state: AlarmState }) {
  const style = STATE_STYLE[state]
  return (
    <Badge
      className={'px-2 py-0.5 text-[10px] font-semibold ' + style.className}
    >
      {style.label}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority: AlarmPriority }) {
  return (
    <Badge
      className={
        'px-2 py-0.5 text-[10px] font-bold ' + PRIORITY_STYLE[priority]
      }
    >
      {priority}
    </Badge>
  )
}

export { STATE_STYLE, PRIORITY_STYLE }
