export type MachineStatus = 'running' | 'idle' | 'warning' | 'error'

export interface Machine {
  id: string
  name: string
  code: string
  category: string
  status: MachineStatus
  temperature: number // °C
  vibration: number // mm/s
  output: number // total units produced
  defects: number // defective units
  powerUsage: number // kW
  targetOutput: number
  lastUpdated: string
}

export interface TelemetryPoint {
  timestamp: string
  temp: number
  vibration: number
}

export interface OeeMetrics {
  availability: number // %
  performance: number // %
  quality: number // %
  overall: number // %
}

export interface AlarmEvent {
  id: string
  machineId: string
  machineName: string
  timestamp: string
  severity: 'warning' | 'critical'
  message: string
  acknowledged: boolean
  value: number
  unit: string
}

export interface VisionComponentInspection {
  id: string
  name: string
  type: 'IC' | 'Resistor' | 'Capacitor' | 'Connector' | 'SolderJoint'
  status: 'OK' | 'NG'
  issue?: string
  confidence: number // %
  box: { x: number; y: number; w: number; h: number }
}

export interface PcbInspectionRecord {
  id: string
  serialNumber: string
  modelName: string
  timestamp: string
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
    I0_1_EStopBtn: boolean
    I0_2_JigInPlace: boolean
    I0_3_DoorSafetySensor: boolean
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
