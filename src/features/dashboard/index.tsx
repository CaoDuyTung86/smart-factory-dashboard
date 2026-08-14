import { useEffect, useState } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { sensorSimulator } from '../factory/services/sensorSimulator'
import { AlarmEvent, Machine, OeeMetrics, TelemetryPoint } from '../factory/types'
import { MachineCard } from '../factory/components/MachineCard'
import { TelemetryChart } from '../factory/components/TelemetryChart'
import { OeeGauge } from '../factory/components/OeeGauge'
import { AlarmTable } from '../factory/components/AlarmTable'
import { ControlPanel } from '../factory/components/ControlPanel'
import { DigitalTwinLine } from '../factory/components/DigitalTwinLine'
import { VisionInspector } from '../factory/components/VisionInspector'
import { PlcDiagnostics } from '../factory/components/PlcDiagnostics'
import { MesTraceability } from '../factory/components/MesTraceability'
import { Factory, Radio, Cpu, Camera, Database, LayoutDashboard, Volume2, VolumeX } from 'lucide-react'

export function Dashboard() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [telemetryHistory, setTelemetryHistory] = useState<Record<string, TelemetryPoint[]>>({})
  const [alarms, setAlarms] = useState<AlarmEvent[]>([])
  const [oee, setOee] = useState<OeeMetrics>({ availability: 100, performance: 95, quality: 100, overall: 95 })
  const [audioEnabled, setAudioEnabled] = useState(false)

  useEffect(() => {
    sensorSimulator.start()
    const unsubscribe = sensorSimulator.subscribe((state) => {
      setMachines(state.machines)
      setTelemetryHistory(state.telemetryHistory)
      setAlarms(state.alarms)
      setOee(state.oee)
      setAudioEnabled(state.audioEnabled)
    })

    return () => {
      unsubscribe()
      sensorSimulator.stop()
    }
  }, [])

  const handleTriggerFault = (machineId: string, faultType: 'overheat' | 'vibration' | 'emergency_stop') => {
    sensorSimulator.triggerFault(machineId, faultType)
  }

  const handleResetMachine = (machineId: string) => {
    sensorSimulator.resetMachine(machineId)
  }

  const handleRepairMachine = (machineId: string) => {
    sensorSimulator.repairMachine(machineId)
  }

  const handleResetAll = () => {
    sensorSimulator.resetAll()
  }

  const handleAcknowledgeAlarm = (alarmId: string) => {
    sensorSimulator.acknowledgeAlarm(alarmId)
  }

  const handleToggleAudio = () => {
    sensorSimulator.toggleAudioAlarm(!audioEnabled)
  }

  return (
    <>
      {/* ===== Top Header ===== */}
      <Header>
        <div className='flex items-center gap-2 font-bold text-lg text-foreground'>
          <Factory className='h-5 w-5 text-primary' />
          <span>SMART FACTORY ULTRA EDITION</span>
        </div>

        <div className='ms-auto flex items-center space-x-3'>
          {/* Audio Alarm Switch */}
          <Button
            size='sm'
            variant={audioEnabled ? 'default' : 'outline'}
            className={`h-8 text-xs font-semibold gap-1.5 ${
              audioEnabled ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20' : 'text-muted-foreground'
            }`}
            onClick={handleToggleAudio}
          >
            {audioEnabled ? <Volume2 className='h-4 w-4 animate-bounce' /> : <VolumeX className='h-4 w-4' />}
            {audioEnabled ? '🔊 Còi Cảnh Báo: BẬT' : '🔇 Còi Cảnh Báo: TẮT'}
          </Button>

          <Badge variant='outline' className='bg-emerald-500/10 text-emerald-500 border-emerald-500/30 font-mono text-xs gap-1.5 py-1 hidden sm:flex'>
            <Radio className='h-3 w-3 animate-pulse' /> IoT Stream Online
          </Badge>

          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      {/* ===== Main Content Area with Enterprise Navigation Tabs ===== */}
      <Main className='space-y-6 pb-12'>
        <Tabs defaultValue='scada' className='space-y-6'>
          {/* Navigation Bar */}
          <div className='overflow-x-auto pb-1'>
            <TabsList className='h-11 bg-muted/60 p-1 rounded-xl border border-border/40 gap-1'>
              <TabsTrigger value='scada' className='text-xs font-semibold gap-2 px-3 h-9'>
                <LayoutDashboard className='h-4 w-4 text-primary' /> SCADA Command Center
              </TabsTrigger>
              <TabsTrigger value='twin' className='text-xs font-semibold gap-2 px-3 h-9'>
                <Cpu className='h-4 w-4 text-blue-400' /> Digital Twin 2D/3D Line
              </TabsTrigger>
              <TabsTrigger value='vision' className='text-xs font-semibold gap-2 px-3 h-9'>
                <Camera className='h-4 w-4 text-amber-500' /> Vision AOI Inspector
              </TabsTrigger>
              <TabsTrigger value='plc' className='text-xs font-semibold gap-2 px-3 h-9'>
                <Factory className='h-4 w-4 text-emerald-400' /> PLC S7-1200 Rack & Ladder
              </TabsTrigger>
              <TabsTrigger value='mes' className='text-xs font-semibold gap-2 px-3 h-9'>
                <Database className='h-4 w-4 text-purple-400' /> MES Product Traceability
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Tab 1: SCADA Main Dashboard */}
          <TabsContent value='scada' className='space-y-6 m-0'>
            <ControlPanel onTriggerFault={handleTriggerFault} onResetAll={handleResetAll} />

            <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
              <div className='lg:col-span-1'>
                <OeeGauge oee={oee} />
              </div>
              <div className='lg:col-span-2'>
                <TelemetryChart machines={machines} telemetryHistory={telemetryHistory} />
              </div>
            </div>

            <div>
              <div className='flex items-center justify-between mb-4'>
                <h3 className='text-lg font-bold flex items-center gap-2'>
                  <span>🏭 Giám Sát Chi Tiết Máy Sản Xuất (Line Status)</span>
                </h3>
                <span className='text-xs text-muted-foreground font-mono'>
                  Tổng số: {machines.length} Máy | {machines.filter(m => m.status === 'running').length} Đang hoạt động
                </span>
              </div>

              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
                {machines.map((machine) => (
                  <MachineCard
                    key={machine.id}
                    machine={machine}
                    onTriggerFault={handleTriggerFault}
                    onReset={handleResetMachine}
                    onRepair={handleRepairMachine}
                  />
                ))}
              </div>
            </div>

            <AlarmTable alarms={alarms} onAcknowledge={handleAcknowledgeAlarm} onRepair={handleRepairMachine} />
          </TabsContent>

          {/* Tab 2: Digital Twin Line */}
          <TabsContent value='twin' className='m-0'>
            <DigitalTwinLine />
          </TabsContent>

          {/* Tab 3: Vision AOI Inspection Console */}
          <TabsContent value='vision' className='m-0'>
            <VisionInspector />
          </TabsContent>

          {/* Tab 4: PLC Siemens S7-1200 & Ladder Logic */}
          <TabsContent value='plc' className='m-0'>
            <PlcDiagnostics />
          </TabsContent>

          {/* Tab 5: MES Traceability */}
          <TabsContent value='mes' className='m-0'>
            <MesTraceability />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
