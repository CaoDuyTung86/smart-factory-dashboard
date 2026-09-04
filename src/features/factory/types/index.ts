import type { ActiveAlarm, AlarmCounts } from '../lib/isa18'

export type MachineStatus = 'running' | 'idle' | 'warning' | 'error'

export type FeedDensity = 'LOW' | 'NORMAL' | 'HIGH'

export interface Machine {
  id: string
  name: string
  code: string
  category: string
  status: MachineStatus
  temperature: number // °C
  vibration: number // mm/s
  output: number // good + bad units produced in the current shift
  defects: number // defective units in the current shift
  powerUsage: number // kW
  targetOutput: number
  /**
   * Ideal cycle time (seconds per unit) at 1.0x line speed — the theoretical
   * fastest this machine can produce one unit. Basis of the OEE Performance
   * factor: Performance = (idealCycleSec x totalCount) / runTime.
   */
  idealCycleSec: number
  /**
   * Where the unit count came from: 'plc' means a real PLC counter, 'model'
   * means the figure was generated. Absent when the browser simulator produced
   * the record. Stated explicitly so nobody reads a modelled count as a
   * measured one.
   */
  countSource?: 'plc' | 'model'
  /** Accumulated time in a producing state (ms) — OEE Availability numerator. */
  runTimeMs: number
  /** Accumulated stopped time inside planned production time (ms). */
  downTimeMs: number
  /**
   * Emergency-stop button held. A PROCESS variable, not an alarm: the E-Stop
   * alarm is the thing that reads this flag, never the thing that sets it.
   */
  estop?: boolean
  lastUpdated: number // epoch ms
}

export interface TelemetryPoint {
  t: number // epoch ms
  temp: number
  vibration: number
}

export interface OeeMetrics {
  availability: number // % — runTime / plannedProductionTime
  performance: number // % — (idealCycleSec x count) / runTime
  quality: number // % — goodCount / totalCount
  overall: number // % — availability x performance x quality
}

/**
 * The alarm types live in `../lib/isa18` next to the state machine that
 * produces them, and are re-exported here so components keep importing every
 * shop-floor type from one place.
 */
export type {
  ActiveAlarm,
  AlarmClass,
  AlarmCounts,
  AlarmDefinition,
  AlarmPriority,
  AlarmState,
  AlarmTransition,
} from '../lib/isa18'

/**
 * Everything a UI component can read about the line, whatever produced it —
 * the browser simulator or the MES backend. The audible-alarm setting is
 * deliberately not here: that belongs to the operator station, not to the line.
 */
export interface FactoryState {
  machines: Machine[]
  telemetryHistory: Record<string, TelemetryPoint[]>
  /** What the operator sees: UNACK_ALM / ACKED_ALM / RTN_UNACK. */
  alarms: ActiveAlarm[]
  /**
   * Shelved, suppressed and out-of-service alarms, carried in the SAME payload
   * rather than behind a separate endpoint. Silencing an alarm with nowhere to
   * see it again is deleting it.
   */
  inhibitedAlarms: ActiveAlarm[]
  alarmCounts: AlarmCounts
  oee: OeeMetrics
  lineSpeed: number
  feedDensity: FeedDensity
}

/** Normalised to the board image (0..1) so boxes track any image size. */
export interface NormalisedBox {
  x: number
  y: number
  w: number
  h: number
}

export interface VisionComponentInspection {
  id: string
  name: string
  type: 'IC' | 'Resistor' | 'Capacitor' | 'Connector' | 'SolderJoint'
  status: 'OK' | 'NG'
  issue?: string
  /**
   * Match score as a percentage. With the OpenCV service running this is the
   * normalised cross-correlation score against the golden sample — a
   * measurable quantity, not a model's probability.
   */
  confidence: number // %
  box: NormalisedBox
  /** How far the component sat from its nominal position, in pixels. */
  offsetPx?: [number, number]
  /** Share of the inspection window that differs from the golden sample. */
  defectAreaPct?: number
}

/**
 * A difference large enough to matter that sits outside every component
 * window — solder splash, a stray wire, a dropped part. Per-component checks
 * cannot see these, which is why the board is swept a second time.
 */
export interface ForeignObjectDetection {
  box: NormalisedBox
  areaPx: number
}

export interface PcbInspectionRecord {
  id: string
  serialNumber: string
  modelName: string
  timestamp: number // epoch ms
  result: 'PASS' | 'FAIL'
  cycleTimeMs: number
  markPoints: {
    mark1: { x: number; y: number; status: 'FOUND' | 'MISSING' }
    mark2: { x: number; y: number; status: 'FOUND' | 'MISSING' }
    thetaOffset: number // degrees
  }
  components: VisionComponentInspection[]
  foreignObjects?: ForeignObjectDetection[]
  /** Present only when a real inspection engine produced this record. */
  alignment?: {
    ok: boolean
    scale: number
    /** How far the second fiducial missed its nominal spot after alignment. */
    residualPx: number | null
  }
  /** Which engine produced the record — absent means the built-in simulation. */
  engine?: string
}

export interface PlcIoState {
  inputs: {
    I0_0_StartBtn: boolean
    I0_1_EStopHealthy: boolean
    I0_2_StopBtnHealthy: boolean
    I0_3_DoorClosed: boolean
    I0_4_VacuumSensor: boolean
    I0_5_CylinderExtended: boolean
  }
  outputs: {
    Q0_0_ConveyorMotor: boolean
    Q0_1_VacuumValve: boolean
    Q0_2_RedTowerLight: boolean
    Q0_3_GreenTowerLight: boolean
    Q0_4_CylinderSolenoid: boolean
    Q0_5_AlarmBuzzer: boolean
  }
  analogs: {
    AI0_TempSensor: number
    AI1_VibSensor: number
    AQ0_InverterSpeed: number
  }
}
