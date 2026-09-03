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
  /** Accumulated time in a producing state (ms) — OEE Availability numerator. */
  runTimeMs: number
  /** Accumulated stopped time inside planned production time (ms). */
  downTimeMs: number
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

export interface AlarmEvent {
  id: string
  machineId: string
  machineName: string
  timestamp: number // epoch ms
  severity: 'warning' | 'critical'
  message: string
  acknowledged: boolean
  value: number
  unit: string
}

/** Everything a UI component can read from the simulator. */
export interface FactoryState {
  machines: Machine[]
  telemetryHistory: Record<string, TelemetryPoint[]>
  alarms: AlarmEvent[]
  oee: OeeMetrics
  lineSpeed: number
  feedDensity: FeedDensity
  audioEnabled: boolean
}

export interface VisionComponentInspection {
  id: string
  name: string
  type: 'IC' | 'Resistor' | 'Capacitor' | 'Connector' | 'SolderJoint'
  status: 'OK' | 'NG'
  issue?: string
  confidence: number // %
  /** Normalised to the board image (0..1) so boxes track any image size. */
  box: { x: number; y: number; w: number; h: number }
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
