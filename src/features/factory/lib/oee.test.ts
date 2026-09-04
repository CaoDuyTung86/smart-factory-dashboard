import { describe, expect, it } from 'vitest'
import type { Machine } from '../types'
import { computeOee, sameOee } from './oee'

const HOUR = 3_600_000

function machine(overrides: Partial<Machine> = {}): Machine {
  return {
    id: 'SMT-LINE-01',
    name: 'Test Cell',
    code: 'TEST-01',
    category: 'Assembly',
    status: 'running',
    temperature: 50,
    vibration: 1,
    output: 0,
    defects: 0,
    powerUsage: 10,
    targetOutput: 1000,
    idealCycleSec: 1,
    runTimeMs: 0,
    downTimeMs: 0,
    lastUpdated: 0,
    ...overrides,
  }
}

describe('computeOee — the textbook worked example', () => {
  /**
   * The canonical worked example, one shift, one machine:
   *   8 h shift minus a 30 min scheduled break -> 420 min planned production
   *   47 min of unplanned stops                -> 373 min run time
   *   Ideal cycle time 1.0 s, 19,271 units total, 423 rejects
   * Published answer: A 88.8% / P 86.1% / Q 97.8% / OEE 74.8%.
   *
   * Note what is NOT in the numbers: the 30 min break never enters planned
   * production time at all. Counting it would report ~83% availability for the
   * same shift — the most common way an OEE figure is quietly inflated.
   */
  const runMs = 373 * 60_000
  const downMs = 47 * 60_000

  const shift = machine({
    runTimeMs: runMs,
    downTimeMs: downMs,
    output: 19_271,
    defects: 423,
    idealCycleSec: 1,
  })

  it('reproduces the published availability, performance and quality', () => {
    const oee = computeOee([shift])

    expect(oee.availability).toBeCloseTo(88.8, 1)
    expect(oee.performance).toBeCloseTo(86.1, 1)
    expect(oee.quality).toBeCloseTo(97.8, 1)
  })

  it('multiplies the three factors rather than averaging them', () => {
    const oee = computeOee([shift])
    const average = (oee.availability + oee.performance + oee.quality) / 3

    expect(oee.overall).toBeCloseTo(74.8, 1)
    // The classic mistake: the mean of 88.8/86.1/97.8 is 90.9%, not 74.8%.
    expect(average).toBeCloseTo(90.9, 1)
    expect(oee.overall).toBeLessThan(average - 15)
  })
})

describe('computeOee — the three factors in isolation', () => {
  it('counts stopped time against availability, not against quality', () => {
    const oee = computeOee([
      machine({
        runTimeMs: 9 * HOUR,
        downTimeMs: HOUR,
        output: 100,
        defects: 0,
      }),
    ])

    expect(oee.availability).toBe(90)
    expect(oee.quality).toBe(100)
  })

  it('reads performance as the ratio of ideal to actual run time', () => {
    // 1,800 units x 2 s ideal = 1 h of ideal work done in 2 h of run time.
    const oee = computeOee([
      machine({ runTimeMs: 2 * HOUR, output: 1800, idealCycleSec: 2 }),
    ])

    expect(oee.performance).toBe(50)
  })

  it('caps performance at 100% instead of reporting a line beating physics', () => {
    // Twice as many units as the ideal cycle time allows: the cycle time on
    // record is wrong. Reporting 200% would silently push OEE above 100.
    const oee = computeOee([
      machine({ runTimeMs: HOUR, output: 7200, idealCycleSec: 1 }),
    ])

    expect(oee.performance).toBe(100)
  })

  it('measures quality on good units, so rework still costs', () => {
    const oee = computeOee([
      machine({ runTimeMs: HOUR, output: 1000, defects: 25 }),
    ])

    expect(oee.quality).toBe(97.5)
  })
})

describe('computeOee — line aggregation and edge cases', () => {
  it('aggregates the line before dividing, not by averaging machine OEEs', () => {
    const fast = machine({
      id: 'a',
      runTimeMs: 8 * HOUR,
      downTimeMs: 0,
      output: 28_800,
      idealCycleSec: 1,
    })
    const stopped = machine({
      id: 'b',
      status: 'error',
      runTimeMs: 0,
      downTimeMs: 8 * HOUR,
      output: 0,
    })

    const oee = computeOee([fast, stopped])

    // 8 run hours out of 16 planned: one dead machine halves line availability.
    expect(oee.availability).toBe(50)
    // The stopped machine contributes no run time, so it cannot drag P down.
    expect(oee.performance).toBe(100)
  })

  it('returns zeros rather than NaN before the shift has any time on it', () => {
    const oee = computeOee([machine()])

    expect(oee.availability).toBe(0)
    expect(oee.performance).toBe(0)
    expect(oee.overall).toBe(0)
  })

  it('does not call zero units produced a quality problem', () => {
    const oee = computeOee([machine({ runTimeMs: HOUR, output: 0 })])

    expect(oee.quality).toBe(100)
  })

  it('returns zeros for an empty line', () => {
    expect(computeOee([])).toEqual({
      availability: 0,
      performance: 0,
      quality: 100,
      overall: 0,
    })
  })
})

describe('sameOee', () => {
  it('compares the four figures, not object identity', () => {
    const a = { availability: 90, performance: 80, quality: 99, overall: 71.3 }

    expect(sameOee(a, { ...a })).toBe(true)
    expect(sameOee(a, { ...a, quality: 98.9 })).toBe(false)
  })
})
