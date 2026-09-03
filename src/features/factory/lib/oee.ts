import type { Machine, OeeMetrics } from '../types'

/**
 * OEE per the Nakajima / SEMI E10 definition, aggregated over the line:
 *
 *   Availability = Run Time / Planned Production Time
 *   Performance  = (Ideal Cycle Time x Total Count) / Run Time
 *   Quality      = Good Count / Total Count
 *   OEE          = A x P x Q
 *
 * Planned production time is run time plus down time — a stopped machine still
 * burns planned time, which is exactly what pulls Availability down. Time lost
 * to a scheduled break is *not* planned production time and is never counted
 * here, which is why the simulator only ever accumulates one of the two.
 *
 * Performance is capped at 100%: anything above means the ideal cycle time on
 * record is wrong, not that the line beat physics.
 *
 * Kept pure and separate from the simulator so the formula can be checked
 * against a worked example without running a clock.
 */
export function computeOee(machines: readonly Machine[]): OeeMetrics {
  let runMs = 0
  let downMs = 0
  let totalCount = 0
  let goodCount = 0
  let idealRunMs = 0

  for (const m of machines) {
    runMs += m.runTimeMs
    downMs += m.downTimeMs
    totalCount += m.output
    goodCount += m.output - m.defects
    idealRunMs += m.output * m.idealCycleSec * 1000
  }

  const plannedMs = runMs + downMs
  const availability = plannedMs > 0 ? (runMs / plannedMs) * 100 : 0
  const performance = runMs > 0 ? Math.min(100, (idealRunMs / runMs) * 100) : 0
  // No units made yet is not a quality problem — 100% until proven otherwise.
  const quality = totalCount > 0 ? (goodCount / totalCount) * 100 : 100

  return {
    availability: Number(availability.toFixed(1)),
    performance: Number(performance.toFixed(1)),
    quality: Number(quality.toFixed(1)),
    overall: Number(
      ((availability * performance * quality) / 10000).toFixed(1)
    ),
  }
}

/** True when the four figures are identical, so the snapshot can keep identity. */
export function sameOee(a: OeeMetrics, b: OeeMetrics): boolean {
  return (
    a.availability === b.availability &&
    a.performance === b.performance &&
    a.quality === b.quality &&
    a.overall === b.overall
  )
}
