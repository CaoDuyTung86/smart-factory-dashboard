/**
 * One shared formatter instance. Timestamps are stored as epoch ms (sortable,
 * diffable, midnight-safe) and only turned into text at the edge — building a
 * new Intl formatter per cell is one of the more expensive things a table can
 * do on a 1.5s tick.
 */
const clockFormatter = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

export function formatClock(epochMs: number): string {
  return clockFormatter.format(epochMs)
}

/** Milliseconds to a compact "2h 14m" style duration. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm'
}

/**
 * Giây thành chuỗi đọc được cho cấu hình cảnh báo ("10 giây", "30 phút").
 *
 * Riêng biệt với `formatDuration`: cái kia đo thời gian đã trôi qua của một ca
 * (đơn vị nhỏ nhất là phút), cái này in ra một THAM SỐ cấu hình mà 10 giây và
 * 10 phút là hai thứ khác hẳn nhau.
 */
export function formatSeconds(seconds: number): string {
  if (!seconds) return '—'
  if (seconds < 60) return seconds + ' giây'
  if (seconds < 3600) return Math.round(seconds / 60) + ' phút'
  return Math.round((seconds / 3600) * 10) / 10 + ' giờ'
}
