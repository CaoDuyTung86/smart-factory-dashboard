import type { Machine, AlarmEvent, OeeMetrics, TelemetryPoint } from '../types'

const INITIAL_MACHINES: Machine[] = [
  {
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
    lastUpdated: new Date().toLocaleTimeString(),
  },
  {
    id: 'm2',
    name: 'Wave Soldering Oven',
    code: 'WAVE-SOLDER-02',
    category: 'Soldering',
    status: 'running',
    temperature: 245.0,
    vibration: 0.8,
    output: 13800,
    defects: 42,
    powerUsage: 35.2,
    targetOutput: 15000,
    lastUpdated: new Date().toLocaleTimeString(),
  },
  {
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
    lastUpdated: new Date().toLocaleTimeString(),
  },
  {
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
    lastUpdated: new Date().toLocaleTimeString(),
  },
]

type Listener = (data: {
  machines: Machine[]
  telemetryHistory: Record<string, TelemetryPoint[]>
  alarms: AlarmEvent[]
  oee: OeeMetrics
  lineSpeed: number
  feedDensity: 'LOW' | 'NORMAL' | 'HIGH'
  audioEnabled: boolean
}) => void

class SensorSimulator {
  private machines: Machine[] = JSON.parse(JSON.stringify(INITIAL_MACHINES))
  private telemetryHistory: Record<string, TelemetryPoint[]> = {}
  private alarms: AlarmEvent[] = []
  private readonly listeners: Set<Listener> = new Set()
  private intervalId: number | null = null
  private lineSpeed: number = 1.0
  private feedDensity: 'LOW' | 'NORMAL' | 'HIGH' = 'NORMAL'
  private audioEnabled: boolean = false
  private audioCtx: AudioContext | null = null

  constructor() {
    const now = Date.now()
    this.machines.forEach((m) => {
      this.telemetryHistory[m.id] = Array.from({ length: 12 }).map((_, i) => {
        const t = new Date(now - (11 - i) * 2000).toLocaleTimeString()
        return {
          timestamp: t,
          temp: m.temperature,
          vibration: m.vibration,
        }
      })
    })
  }

  public setLineSpeed(speed: number) {
    this.lineSpeed = Math.max(0.5, Math.min(3.0, speed))
    this.notify()
  }

  public setFeedDensity(density: 'LOW' | 'NORMAL' | 'HIGH') {
    this.feedDensity = density
    this.notify()
  }

  public toggleAudioAlarm(enable: boolean) {
    this.audioEnabled = enable
    if (enable) {
      if (!this.audioCtx) {
        const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.audioCtx = new AudioCtxClass()
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume()
      }
      // Play a short pleasant test chime when user enables sound
      this.playChime(660, 0.15)
    }
    this.notify()
  }

  private playChime(freq: number, duration: number) {
    if (!this.audioCtx) return
    try {
      const osc = this.audioCtx.createOscillator()
      const gain = this.audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime)
      gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration)
      osc.connect(gain)
      gain.connect(this.audioCtx.destination)
      osc.start()
      osc.stop(this.audioCtx.currentTime + duration)
    } catch {
      // Audio playback fallback
    }
  }

  private playAlarmBeep() {
    if (!this.audioEnabled || !this.audioCtx) return
    this.playChime(880, 0.3)
  }

  public start() {
    if (this.intervalId) return
    // Fixed tick rate (1.5 seconds) to prevent React state lag and memory leaks!
    this.intervalId = window.setInterval(() => this.tick(), 1500)
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  public subscribe(listener: Listener) {
    this.listeners.add(listener)
    this.notify(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(listener?: Listener) {
    const state = {
      machines: this.machines,
      telemetryHistory: this.telemetryHistory,
      alarms: this.alarms,
      oee: this.calculateOee(),
      lineSpeed: this.lineSpeed,
      feedDensity: this.feedDensity,
      audioEnabled: this.audioEnabled,
    }
    if (listener) {
      listener(state)
    } else {
      this.listeners.forEach((l) => l(state))
    }
  }

  private tick() {
    const timeStr = new Date().toLocaleTimeString()
    const densityMultiplier = this.feedDensity === 'HIGH' ? 1.4 : this.feedDensity === 'LOW' ? 0.7 : 1.0

    this.machines = this.machines.map((m) => {
      // If error or cooling down, keep stable
      if (m.status === 'error') {
        return { ...m, lastUpdated: timeStr }
      }

      const initial = INITIAL_MACHINES.find((init) => init.id === m.id) || m
      const targetBaseTemp = initial.temperature
      const targetBaseVib = initial.vibration

      // Mean-reverting Physics Formula: Pull temperature & vibration back to baseline!
      // This prevents infinite temperature creep & high RAM memory leaks.
      const tempDist = targetBaseTemp - m.temperature
      const vibDist = targetBaseVib - m.vibration

      // If line speed is high (>2.0x), add small heat stress
      const speedHeatBonus = this.lineSpeed > 2.0 ? (this.lineSpeed - 2.0) * 8 : 0
      const speedVibBonus = this.lineSpeed > 2.0 ? (this.lineSpeed - 2.0) * 1.5 : 0

      const newTemp = Number((m.temperature + tempDist * 0.15 + (Math.random() - 0.5) * 0.6 + speedHeatBonus * 0.2).toFixed(1))
      const newVib = Number(Math.max(0.1, m.vibration + vibDist * 0.15 + (Math.random() - 0.5) * 0.1 + speedVibBonus * 0.1).toFixed(2))

      // Increment production
      const isRunning = m.status === 'running' || m.status === 'warning'
      const baseProductCount = Math.floor((Math.random() * 3 + 1) * this.lineSpeed * densityMultiplier)
      const newOutput = isRunning ? m.output + baseProductCount : m.output

      const defectChance = this.lineSpeed > 2.2 ? 0.2 : 0.03
      const newDefects = isRunning && Math.random() < defectChance ? m.defects + 1 : m.defects

      let status = m.status
      if (this.lineSpeed > 2.5) {
        status = 'warning'
        this.addAlarm(m, `WARNING: Line Speed Overclocked (${this.lineSpeed}x) - Overheating!`, 'warning', newTemp, '°C')
      } else if (m.id === 'm1' && newTemp > 75) {
        status = 'warning'
        this.addAlarm(m, 'Warning: SMT Head Temperature Elevated', 'warning', newTemp, '°C')
      } else if (status === 'warning' && newTemp < 72 && newVib < 4.0 && this.lineSpeed <= 2.0) {
        status = 'running'
      }

      return {
        ...m,
        temperature: newTemp,
        vibration: newVib,
        output: newOutput,
        defects: newDefects,
        status,
        lastUpdated: timeStr,
      }
    })

    // Limit telemetry history length to max 12 items to prevent memory bloat!
    this.machines.forEach((m) => {
      const history = this.telemetryHistory[m.id] || []
      const updated = [
        ...history.slice(-11),
        {
          timestamp: timeStr,
          temp: m.temperature,
          vibration: m.vibration,
        },
      ]
      this.telemetryHistory[m.id] = updated
    })

    this.notify()
  }

  private addAlarm(machine: Machine, message: string, severity: 'warning' | 'critical', value: number, unit: string) {
    const existing = this.alarms.some(
      (a) => a.machineId === machine.id && !a.acknowledged && a.severity === severity
    )
    if (existing) return

    this.playAlarmBeep()

    const newAlarm: AlarmEvent = {
      id: 'alarm-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      machineId: machine.id,
      machineName: machine.name,
      timestamp: new Date().toLocaleTimeString(),
      severity,
      message,
      acknowledged: false,
      value,
      unit,
    }
    this.alarms = [newAlarm, ...this.alarms.slice(0, 14)]
  }

  public triggerFault(machineId: string, faultType: 'overheat' | 'vibration' | 'emergency_stop') {
    const timeStr = new Date().toLocaleTimeString()
    this.machines = this.machines.map((m) => {
      if (m.id !== machineId) return m

      if (faultType === 'overheat') {
        const val = m.id === 'm2' ? 295.0 : 88.5
        this.addAlarm(m, `CRITICAL: Thermal Overheat Detected! (${val}°C)`, 'critical', val, '°C')
        return { ...m, temperature: val, status: 'error', lastUpdated: timeStr }
      }

      if (faultType === 'vibration') {
        const val = 7.8
        this.addAlarm(m, `CRITICAL: Mechanical Bearing Fault Vibration (${val} mm/s)`, 'critical', val, 'mm/s')
        return { ...m, vibration: val, status: 'error', lastUpdated: timeStr }
      }

      if (faultType === 'emergency_stop') {
        this.addAlarm(m, 'CRITICAL: Manual Emergency Stop Triggered', 'critical', 0, 'N/A')
        return { ...m, status: 'error', lastUpdated: timeStr }
      }

      return m
    })
    this.notify()
  }

  // 🔧 Cool Down & Repair Machine (Sửa Máy & Hạ Nhiệt)
  public repairMachine(machineId: string) {
    const initial = INITIAL_MACHINES.find((m) => m.id === machineId)
    if (!initial) return

    const timeStr = new Date().toLocaleTimeString()
    this.machines = this.machines.map((m) =>
      m.id === machineId
        ? {
            ...m,
            temperature: initial.temperature,
            vibration: initial.vibration,
            status: 'running',
            lastUpdated: timeStr,
          }
        : m
    )

    // Mark related alarms as acknowledged
    this.alarms = this.alarms.map((a) =>
      a.machineId === machineId ? { ...a, acknowledged: true } : a
    )

    this.notify()
  }

  public acknowledgeAlarm(alarmId: string) {
    this.alarms = this.alarms.map((a) => (a.id === alarmId ? { ...a, acknowledged: true } : a))
    this.notify()
  }

  public resetMachine(machineId: string) {
    this.repairMachine(machineId)
  }

  public resetAll() {
    this.machines = JSON.parse(JSON.stringify(INITIAL_MACHINES))
    this.alarms = []
    this.lineSpeed = 1.0
    this.feedDensity = 'NORMAL'
    this.notify()
  }

  public calculateOee(): OeeMetrics {
    const totalOutput = this.machines.reduce((sum, m) => sum + m.output, 0)
    const totalDefects = this.machines.reduce((sum, m) => sum + m.defects, 0)
    const runningCount = this.machines.filter((m) => m.status === 'running').length

    const availability = Number(((runningCount / this.machines.length) * 100).toFixed(1))
    const speedPerf = Math.min(100, Number((85 * (this.lineSpeed / 1.0)).toFixed(1)))
    const performance = Number(Math.max(50, speedPerf).toFixed(1))

    const rawQuality = totalOutput > 0 ? ((totalOutput - totalDefects) / totalOutput) * 100 : 100
    const qualityPenalty = this.lineSpeed > 1.8 ? (this.lineSpeed - 1.8) * 15 : 0
    const quality = Number(Math.max(40, rawQuality - qualityPenalty).toFixed(1))

    const overall = Number(((availability * performance * quality) / 10000).toFixed(1))

    return { availability, performance, quality, overall }
  }
}

export const sensorSimulator = new SensorSimulator()
