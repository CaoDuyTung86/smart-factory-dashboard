/**
 * One scan cycle of the conveyor ladder, as a pure function.
 *
 * This is the browser-side twin of `infra/plc/conveyor.st` — the Structured
 * Text actually running on OpenPLC. The two must stay line-for-line
 * equivalent: when the edge gateway is up the PLC solves these rungs, and when
 * it is not, this function does, and the HMI must behave identically either
 * way. Keeping it out of the component is what makes that claim testable.
 *
 * Wiring convention (fail-safe, IEC 60204-1): Stop and E-Stop are wired
 * normally-closed, so an untouched button feeds 24 V and the input reads TRUE.
 * A cut wire reads FALSE and stops the machine. Every contact in the program
 * is therefore examined as normally-open — the "normally closed" lives in the
 * wiring, not in the code.
 */
export interface LadderInputs {
  /** I0.0 — momentary NO push button. TRUE only while held. */
  i00_startPb: boolean
  /** I0.1 — NC wiring: TRUE = healthy / not pressed. */
  i01_stopPb: boolean
  /** I0.2 — NC safety chain: TRUE = healthy / not pressed. */
  i02_eStop: boolean
  /** I0.3 — TRUE = guard door closed. */
  i03_doorClosed: boolean
}

export interface LadderOutputs {
  /** Q0.0 — conveyor motor contactor. */
  q00_conveyor: boolean
  /** Q0.2 — red tower light: a safety circuit is open. */
  q02_redTower: boolean
  /** Q0.3 — green tower light: running, no safety fault. */
  q03_greenTower: boolean
  /** Derived: E-Stop pressed or guard door open. */
  safetyFault: boolean
}

export const INITIAL_LADDER_INPUTS: LadderInputs = {
  i00_startPb: false,
  i01_stopPb: true,
  i02_eStop: true,
  i03_doorClosed: true,
}

/** Network 2's condition, shared by the solver and the HMI indicators. */
export function safetyFaultOf(inputs: LadderInputs): boolean {
  return !inputs.i02_eStop || !inputs.i03_doorClosed
}

/**
 * @param inputs      state of the physical inputs this scan
 * @param prevConveyor Q0.0 from the previous scan — the seal-in contact. Q0.0
 *                     has memory, which is why the caller must carry it.
 */
export function solveLadder(
  inputs: LadderInputs,
  prevConveyor: boolean
): LadderOutputs {
  const safetyFault = safetyFaultOf(inputs)

  // Network 1 — motor with seal-in branch. Releasing Start keeps the motor
  // running through Q0.0 itself; opening any safety contact drops it and it
  // does NOT restart when the contact closes again (restart interlock,
  // ISO 13849-1) because the seal-in has already been broken.
  const q00_conveyor =
    (inputs.i00_startPb || prevConveyor) &&
    inputs.i01_stopPb &&
    inputs.i02_eStop &&
    inputs.i03_doorClosed

  return {
    q00_conveyor,
    // Network 2 — red tower on a safety fault.
    q02_redTower: safetyFault,
    // Network 3 — green tower only while genuinely running.
    q03_greenTower: q00_conveyor && !safetyFault,
    safetyFault,
  }
}
