import { describe, expect, it } from 'vitest'
import {
  INITIAL_LADDER_INPUTS,
  safetyFaultOf,
  solveLadder,
  type LadderInputs,
} from './ladder'

/**
 * These assertions encode the safety behaviour of `infra/plc/conveyor.st`.
 * If a rung here is changed without changing the ST program (or the other way
 * round), the simulated HMI and the real PLC would disagree — which is exactly
 * the class of bug that is invisible on screen and dangerous on a machine.
 */

/** Runs `scans` consecutive scan cycles, carrying Q0.0 forward each time. */
function run(inputs: LadderInputs, prevConveyor = false, scans = 1) {
  let out = solveLadder(inputs, prevConveyor)
  for (let i = 1; i < scans; i++) out = solveLadder(inputs, out.q00_conveyor)
  return out
}

const healthy = INITIAL_LADDER_INPUTS

describe('conveyor ladder — Network 1 (motor with seal-in)', () => {
  it('does not start on power-up: the coil needs a Start pulse', () => {
    expect(run(healthy).q00_conveyor).toBe(false)
  })

  it('starts while the NO Start button is held', () => {
    expect(run({ ...healthy, i00_startPb: true }).q00_conveyor).toBe(true)
  })

  it('keeps running after Start is released — the seal-in branch holds Q0.0', () => {
    const pressed = run({ ...healthy, i00_startPb: true })
    const released = solveLadder(healthy, pressed.q00_conveyor)

    expect(released.q00_conveyor).toBe(true)
  })

  it.each([
    ['Stop pressed (NC opens)', { i01_stopPb: false }],
    ['E-Stop pressed (NC opens)', { i02_eStop: false }],
    ['guard door opened', { i03_doorClosed: false }],
  ])('drops the motor when %s', (_label, open) => {
    const running = run({ ...healthy, i00_startPb: true })

    expect(
      solveLadder({ ...healthy, ...open }, running.q00_conveyor).q00_conveyor
    ).toBe(false)
  })

  it('does not restart by itself when the E-Stop is released (restart interlock)', () => {
    const running = run({ ...healthy, i00_startPb: true })
    const tripped = solveLadder(
      { ...healthy, i02_eStop: false },
      running.q00_conveyor
    )

    // E-Stop reset — the button is healthy again but nobody pressed Start.
    const afterReset = run(healthy, tripped.q00_conveyor, 5)

    expect(tripped.q00_conveyor).toBe(false)
    expect(afterReset.q00_conveyor).toBe(false)
  })

  it('restarts only on a fresh Start pulse after the fault is cleared', () => {
    const tripped = solveLadder({ ...healthy, i02_eStop: false }, true)
    const restarted = solveLadder(
      { ...healthy, i00_startPb: true },
      tripped.q00_conveyor
    )

    expect(restarted.q00_conveyor).toBe(true)
  })

  it('refuses to start while a safety contact is still open', () => {
    const held = run(
      { ...healthy, i00_startPb: true, i02_eStop: false },
      false,
      3
    )

    expect(held.q00_conveyor).toBe(false)
  })

  it('treats a broken wire the same as a pressed button (fail-safe)', () => {
    // A cut NC loop reads FALSE — identical to the pressed case above, which
    // is the whole point of wiring Stop/E-Stop normally-closed.
    const brokenLoop = run(
      { ...healthy, i00_startPb: true, i01_stopPb: false },
      true
    )

    expect(brokenLoop.q00_conveyor).toBe(false)
  })
})

describe('conveyor ladder — Networks 2 & 3 (tower lights)', () => {
  it('keeps both lamps sane while stopped but healthy', () => {
    const out = run(healthy)

    expect(out.q02_redTower).toBe(false)
    expect(out.q03_greenTower).toBe(false)
  })

  it('lights green only while actually running with no fault', () => {
    const out = run({ ...healthy, i00_startPb: true })

    expect(out.q03_greenTower).toBe(true)
    expect(out.q02_redTower).toBe(false)
  })

  it.each([
    ['E-Stop', { i02_eStop: false }],
    ['open guard door', { i03_doorClosed: false }],
  ])('lights red and kills green on %s', (_label, open) => {
    const out = solveLadder({ ...healthy, ...open }, true)

    expect(out.q02_redTower).toBe(true)
    expect(out.q03_greenTower).toBe(false)
  })

  it('does not call a Stop press a safety fault', () => {
    // Stop is a control function, not a safety function: the line halts but
    // the red beacon is for safety circuits only.
    const out = solveLadder({ ...healthy, i01_stopPb: false }, true)

    expect(out.q02_redTower).toBe(false)
    expect(out.q00_conveyor).toBe(false)
  })

  it('exposes the same fault expression the coils use', () => {
    expect(safetyFaultOf(healthy)).toBe(false)
    expect(safetyFaultOf({ ...healthy, i02_eStop: false })).toBe(true)
    expect(safetyFaultOf({ ...healthy, i03_doorClosed: false })).toBe(true)
    expect(safetyFaultOf({ ...healthy, i01_stopPb: false })).toBe(false)
  })
})
