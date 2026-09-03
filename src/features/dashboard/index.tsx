import {
  Camera,
  Cpu,
  Database,
  Factory,
  LayoutDashboard,
  Radio,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { DigitalTwinLine } from '../factory/components/DigitalTwinLine'
import { MesTraceability } from '../factory/components/MesTraceability'
import { PlcDiagnostics } from '../factory/components/PlcDiagnostics'
import { ScadaPanel } from '../factory/components/ScadaPanel'
import { VisionInspector } from '../factory/components/VisionInspector'
import { useFactoryStore } from '../factory/hooks/use-factory-store'
import { sensorSimulator } from '../factory/services/sensorSimulator'

/**
 * Reads a single boolean from the simulator, so the header button is the only
 * thing that re-renders when the audio alarm is toggled.
 */
function AudioAlarmToggle() {
  const audioEnabled = useFactoryStore((s) => s.audioEnabled)

  return (
    <Button
      size='sm'
      variant={audioEnabled ? 'default' : 'outline'}
      className={
        'h-8 gap-1.5 text-xs font-semibold ' +
        (audioEnabled
          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20 hover:bg-amber-400'
          : 'text-muted-foreground')
      }
      onClick={() => sensorSimulator.toggleAudioAlarm(!audioEnabled)}
    >
      {audioEnabled ? (
        <Volume2 className='h-4 w-4' />
      ) : (
        <VolumeX className='h-4 w-4' />
      )}
      {audioEnabled ? '🔊 Còi Cảnh Báo: BẬT' : '🔇 Còi Cảnh Báo: TẮT'}
    </Button>
  )
}

/**
 * Shell only — it holds no live data, so a telemetry tick never re-renders the
 * tab strip or the inactive modules. Each tab owns its own subscriptions.
 */
export function Dashboard() {
  return (
    <>
      {/* ===== Top Header ===== */}
      <Header>
        <div className='flex items-center gap-2 text-lg font-bold text-foreground'>
          <Factory className='h-5 w-5 text-primary' />
          <span>SMART FACTORY ULTRA EDITION</span>
        </div>

        <div className='ms-auto flex items-center space-x-3'>
          <AudioAlarmToggle />

          <Badge
            variant='outline'
            className='hidden gap-1.5 border-emerald-500/30 bg-emerald-500/10 py-1 font-mono text-xs text-emerald-500 sm:flex'
          >
            <Radio className='h-3 w-3' /> IoT Stream Online
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
            <TabsList className='h-11 gap-1 rounded-xl border border-border/40 bg-muted/60 p-1'>
              <TabsTrigger
                value='scada'
                className='h-9 gap-2 px-3 text-xs font-semibold'
              >
                <LayoutDashboard className='h-4 w-4 text-primary' /> SCADA
                Command Center
              </TabsTrigger>
              <TabsTrigger
                value='twin'
                className='h-9 gap-2 px-3 text-xs font-semibold'
              >
                <Cpu className='h-4 w-4 text-blue-400' /> Digital Twin 2D/3D
                Line
              </TabsTrigger>
              <TabsTrigger
                value='vision'
                className='h-9 gap-2 px-3 text-xs font-semibold'
              >
                <Camera className='h-4 w-4 text-amber-500' /> Vision AOI
                Inspector
              </TabsTrigger>
              <TabsTrigger
                value='plc'
                className='h-9 gap-2 px-3 text-xs font-semibold'
              >
                <Factory className='h-4 w-4 text-emerald-400' /> PLC S7-1200
                Rack & Ladder
              </TabsTrigger>
              <TabsTrigger
                value='mes'
                className='h-9 gap-2 px-3 text-xs font-semibold'
              >
                <Database className='h-4 w-4 text-purple-400' /> MES Product
                Traceability
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value='scada' className='m-0'>
            <ScadaPanel />
          </TabsContent>

          <TabsContent value='twin' className='m-0'>
            <DigitalTwinLine />
          </TabsContent>

          <TabsContent value='vision' className='m-0'>
            <VisionInspector />
          </TabsContent>

          <TabsContent value='plc' className='m-0'>
            <PlcDiagnostics />
          </TabsContent>

          <TabsContent value='mes' className='m-0'>
            <MesTraceability />
          </TabsContent>
        </Tabs>
      </Main>
    </>
  )
}
