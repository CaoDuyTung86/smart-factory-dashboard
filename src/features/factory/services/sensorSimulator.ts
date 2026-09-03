import type {
  AlarmEvent,
  FactoryState,
  FeedDensity,
  Machine,
  OeeMetrics,
  TelemetryPoint,
} from '../types'

const TICK_MS = 1500
/** Points kept per machine — 40 x 1.5s = a 60 second rolling window. */
const HISTORY_LENGTH = 40
const MAX_ALARMS = 15

/**
 * Seeds runTime/downTime consistently with the units already produced, so the
 * OEE figures on first paint are the ones this machine would really have:
 * runTime = count x idealCycle / assumedPerformance.
 */
function seedMachine(
  m: Omit<Machine, 'runTimeMs' | 'downTimeMs' | 'lastUpdated'>
): Machine {
  const runTimeMs = (m.output * m.idealCycleSec * 1000) / 0.92
  return {
    ...m,
    runTimeMs,
    downTimeMs: runTimeMs * 0.065, // ~93.9% availability at start
    lastUpdated: Date.now(),
  }
}

const INITIAL_MACHINES: Machine[] = [
  seedMachine({
    id: 'm1',
    name: 'SMT Pick & Place',
    code: 'SMT-LINE-01',
    category: 'Assembly',
    status: 'running',
    temperature: 52.4,
    vibration: 1.2,
    output: 14250,
    defects: 28,
    powerUsage: 18.5,
    targetOutput: 15000,
    idealCycleSec: 0.4,
  }),
  seedMachine({
    // SMT line -> reflow oven. Wave soldering is a through-hole process and
    // does not belong on a surface-mount line.
    id: 'm2',
    name: 'Reflow Soldering Oven',
    code: 'REFLOW-OVEN-02',
    category: 'Soldering',
    status: 'running',
    temperature: 245.0, // peak zone of a lead-free profile
    vibration: 0.8,
    output: 13800,
    defects: 42,
    powerUsage: 35.2,
    targetOutput: 15000,
    idealCycleSec: 0.45,
  }),
  seedMachine({
    id: 'm3',
    name: 'CNC Enclosure Milling',
    code: 'CNC-MILL-03',
    category: 'Machining',
    status: 'running',
    temperature: 68.1,
    vibration: 2.4,
    output: 4800,
    defects: 15,
    powerUsage: 24.0,
    targetOutput: 5000,
    idealCycleSec: 1.2,
  }),
  seedMachine({
    id: 'm4',
    name: 'AOI Optical Inspection',
    code: 'AOI-INSPECT-04',
    category: 'Quality Control',
    status: 'running',
    temperature: 38.5,
    vibration: 0.4,
    output: 14100,
    defects: 0,
    powerUsage: 8.2,
    targetOutput: 15000,
    idealCycleSec: 0.42,
  }),
]

type Listener = () => void

function densityFactor(density: FeedDensity) {
  return density === 'HIGH' ? 1.4 : density === 'LOW' ? 0.7 : 1.0
}

function sameOee(a: OeeMetrics, b: OeeMetrics) {
  return (
    a.availability === b.availability &&
    a.performance === b.performance &&
    a.quality === b.quality &&
    a.overall === b.overall
  )
}

class SensorSimulator {
  private machines: Machine[] = INITIAL_MACHINES.map((m) => ({ ...m }))
  private telemetryHistory: Record<string, TelemetryPoint[]> = {}
  private alarms: AlarmEvent[] = []
  private oee: OeeMetrics = {
    availability: 0,
    performance: 0,
    quality: 0,
    overall: 0,
  }
  private lineSpeed = 1.0
  private feedDensity: FeedDensity = 'NORMAL'
  private audioEnabled = false

  private readonly listeners = new Set<Listener>()
  private intervalId: number | null = null
  private audioCtx: AudioContext | null = null
  private snapshot!: FactoryState

  constructor() {
    const now = Date.now()
    this.machines.forEach((m) => {
      this.telemetryHistory[m.id] = Array.from({ length: 12 }, (_, i) => ({
        t: now - (11 - i) * TICK_MS,
        temp: m.temperature,
        vibration: m.vibration,
      }))
    })
    this.oee = this.computeOee()
    this.rebuildSnapshot()
  }

  // ---------------------------------------------------------------- store API

  /**
   * External-store contract for useSyncExternalStore. The simulator only runs
   * while something is subscribed, so leaving the dashboard stops the timer
   * instead of burning CPU in a background tab.
   */
  public subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  public getSnapshot = (): FactoryState => this.snapshot

  private rebuildSnapshot() {
    this.snapshot = {
      machines: this.machines,
      telemetryHistory: this.telemetryHistory,
      alarms: this.alarms,
      oee: this.oee,
      lineSpeed: this.lineSpeed,
      feedDensity: this.feedDensity,
      audioEnabled: this.audioEnabled,
    }
  }

  private notify() {
    // OEE keeps its object identity while the numbers are unchanged, so panels
    // that only read OEE re-render on real movement instead of every tick.
    const next = this.computeOee()
    if (!sameOee(next, this.oee)) this.oee = next

    this.rebuildSnapshot()
    this.listeners.forEach((l) => l())
  }

  private start() {
    if (this.intervalId !== null) return
    this.intervalId = window.setInterval(() => this.tick(), TICK_MS)
  }

  private stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this.closeAudio()
  }

  // ------------------------------------------------------------------- audio

  private ensureAudioContext(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx
    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!AudioCtxClass) return null
    this.audioCtx = new AudioCtxClass()
    return this.audioCtx
  }

  private closeAudio() {
    if (!this.audioCtx) return
    void this.audioCtx.close().catch(() => undefined)
    this.audioCtx = null
  }

  public toggleAudioAlarm(enable: boolean) {
    this.audioEnabled = enable

    if (enable) {
      const ctx = this.ensureAudioContext()
      if (ctx?.state === 'suspended') void ctx.resume()
      this.playChime(660, 0.15)
    } else if (this.audioCtx) {
      // Suspended, not closed: re-enabling must not need a whole new context.
      void this.audioCtx.suspend().catch(() => undefined)
    }

    this.notify()
  }

  private playChime(freq: number, duration: number) {
    const ctx = this.audioCtx
    if (!ctx || ctx.state === 'closed') return
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      gain.gain.setValueAtTime(0.1, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + duration)
      // Oscillators are one-shot: release the graph once it has finished.
      osc.onended = () => {
        osc.disconnect()
        gain.disconnect()
      }
    } catch {
      // Autoplay policy or a closed context — alarms stay visual only.
    }
  }

  private playAlarmBeep() {
    if (!this.audioEnabled) return
    this.playChime(880, 0.3)
  }

  // -------------------------------------------------------------- simulation

  public setLineSpeed(speed: number) {
    const next = Math.max(0.5, Math.min(3.0, Number(speed.toFixed(1))))
    if (next === this.lineSpeed) return
    this.lineSpeed = next
    this.notify()
  }

  public setFeedDensity(density: FeedDensity) {
    if (density === this.feedDensity) return
    this.feedDensity = density
    this.notify()
  }

  private tick() {
    const now = Date.now()
    const dtSec = TICK_MS / 1000
    const density = densityFactor(this.feedDensity)

    this.machines = this.machines.map((m) => {
      const isProducing = m.status === 'running' || m.status === 'warning'

      if (!isProducing) {
        // A stopped machine still consumes planned production time — that is
        // exactly what pulls OEE Availability down.
        return { ...m, downTimeMs: m.downTimeMs + TICK_MS, lastUpdated: now }
      }

      const initial = INITIAL_MACHINES.find((init) => init.id === m.id) ?? m

      // Mean reversion keeps temperature/vibration bounded around the baseline.
      const tempDist = initial.temperature - m.temperature
      const vibDist = initial.vibration - m.vibration
      const speedHeatBonus =
        this.lineSpeed > 2.0 ? (this.lineSpeed - 2.0) * 8 : 0
      const speedVibBonus =
        this.lineSpeed > 2.0 ? (this.lineSpeed - 2.0) * 1.5 : 0

      const newTemp = Number(
        (
          m.temperature +
          tempDist * 0.15 +
          (Math.random() - 0.5) * 0.6 +
          speedHeatBonus * 0.2
        ).toFixed(1)
      )
      const newVib = Number(
        Math.max(
          0.1,
          m.vibration +
            vibDist * 0.15 +
            (Math.random() - 0.5) * 0.1 +
            speedVibBonus * 0.1
        ).toFixed(2)
      )

      // Units produced follow the machine's own ideal cycle time, degraded by a
      // small efficiency loss — so OEE Performance measures something real.
      const efficiency = 0.86 + Math.random() * 0.12
      const produced = Math.floor(
        (dtSec / m.idealCycleSec) * this.lineSpeed * density * efficiency
      )

      // Defect rate per unit climbs sharply once the line is pushed past 2.0x.
      const defectRate =
        0.004 + (this.lineSpeed > 2.0 ? (this.lineSpeed - 2.0) * 0.09 : 0)
      let newDefects = m.defects
      for (let i = 0; i < produced; i++) {
        if (Math.random() < defectRate) newDefects++
      }

      let status = m.status
      if (this.lineSpeed > 2.5) {
        status = 'warning'
        this.addAlarm(
          m,
          'WARNING: Line Speed Overclocked (' +
            this.lineSpeed +
            'x) - Overheating!',
          'warning',
          newTemp,
          '°C'
        )
      } else if (m.id === 'm1' && newTemp > 75) {
        status = 'warning'
        this.addAlarm(
          m,
          'Warning: SMT Head Temperature Elevated',
          'warning',
          newTemp,
          '°C'
        )
      } else if (
        status === 'warning' &&
        newTemp < 72 &&
        newVib < 4.0 &&
        this.lineSpeed <= 2.0
      ) {
        status = 'running'
      }

      return {
        ...m,
        temperature: newTemp,
        vibration: newVib,
        output: m.output + produced,
        defects: newDefects,
        runTimeMs: m.runTimeMs + TICK_MS,
        status,
        lastUpdated: now,
      }
    })

    // A fresh object each tick: mutating in place would let a memoised chart
    // silently keep rendering stale data.
    const history: Record<string, TelemetryPoint[]> = {}
    this.machines.forEach((m) => {
      const prev = this.telemetryHistory[m.id] ?? []
      history[m.id] = [
        ...prev.slice(-(HISTORY_LENGTH - 1)),
        { t: now, temp: m.temperature, vibration: m.vibration },
      ]
    })
    this.telemetryHistory = history

    this.notify()
  }

  private addAlarm(
    machine: Machine,
    message: string,
    severity: 'warning' | 'critical',
    value: number,
    unit: string
  ) {
    const alreadyActive = this.alarms.some(
      (a) =>
        a.machineId === machine.id && !a.acknowledged && a.severity === severity
    )
    if (alreadyActive) return

    this.playAlarmBeep()

    const newAlarm: AlarmEvent = {
      id: 'alarm-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      machineId: machine.id,
      machineName: machine.name,
      timestamp: Date.now(),
      severity,
      message,
      acknowledged: false,
      value,
      unit,
    }
    this.alarms = [newAlarm, ...this.alarms.slice(0, MAX_ALARMS - 1)]
  }

  public triggerFault(
    machineId: string,
    faultType: 'overheat' | 'vibration' | 'emergency_stop'
  ) {
    const now = Date.now()
    this.machines = this.machines.map((m) => {
      if (m.id !== machineId) return m

      if (faultType === 'overheat') {
        const val = m.id === 'm2' ? 295.0 : 88.5
        this.addAlarm(
          m,
          'CRITICAL: Thermal Overheat Detected! (' + val + '°C)',
          'critical',
          val,
          '°C'
        )
        return { ...m, temperature: val, status: 'error', lastUpdated: now }
      }

      if (faultType === 'vibration') {
        const val = 7.8
        this.addAlarm(
          m,
          'CRITICAL: Mechanical Bearing Fault Vibration (' + val + ' mm/s)',
          'critical',
          val,
          'mm/s'
        )
        return { ...m, vibration: val, status: 'error', lastUpdated: now }
      }

      this.addAlarm(
        m,
        'CRITICAL: Manual Emergency Stop Triggered',
        'critical',
        0,
        'N/A'
      )
      return { ...m, status: 'error', lastUpdated: now }
    })
    this.notify()
  }

  /** Cool down & repair: back to baseline, related alarms acknowledged. */
  public repairMachine(machineId: string) {
    const initial = INITIAL_MACHINES.find((m) => m.id === machineId)
    if (!initial) return

    const now = Date.now()
    this.machines = this.machines.map((m) =>
      m.id === machineId
        ? {
            ...m,
            temperature: initial.temperature,
            vibration: initial.vibration,
            status: 'running',
            lastUpdated: now,
          }
        : m
    )
    this.alarms = this.alarms.map((a) =>
      a.machineId === machineId ? { ...a, acknowledged: true } : a
    )
    this.notify()
  }

  public acknowledgeAlarm(alarmId: string) {
    this.alarms = this.alarms.map((a) =>
      a.id === alarmId ? { ...a, acknowledged: true } : a
    )
    this.notify()
  }

  public resetAll() {
    this.machines = INITIAL_MACHINES.map((m) => ({
      ...m,
      lastUpdated: Date.now(),
    }))
    this.alarms = []
    this.lineSpeed = 1.0
    this.feedDensity = 'NORMAL'
    this.notify()
  }

  // -------------------------------------------------------------------- OEE

  /**
   * OEE per the Nakajima / SEMI E10 definition, aggregated over the line:
   *   Availability = Run Time / Planned Production Time
   *   Performance  = (Ideal Cycle Time x Total Count) / Run Time
   *   Quality      = Good Count / Total Count
   * Performance is capped at 100%: a higher figure means the ideal cycle time
   * on record is wrong, not that the line beat physics.
   */
  private computeOee(): OeeMetrics {
    let runMs = 0
    let downMs = 0
    let totalCount = 0
    let goodCount = 0
    let idealRunMs = 0

    for (const m of this.machines) {
      runMs += m.runTimeMs
      downMs += m.downTimeMs
      totalCount += m.output
      goodCount += m.output - m.defects
      idealRunMs += m.output * m.idealCycleSec * 1000
    }

    const plannedMs = runMs + downMs
    const availability = plannedMs > 0 ? (runMs / plannedMs) * 100 : 0
    const performance =
      runMs > 0 ? Math.min(100, (idealRunMs / runMs) * 100) : 0
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
}

export const sensorSimulator = new SensorSimulator()
