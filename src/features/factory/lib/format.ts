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
