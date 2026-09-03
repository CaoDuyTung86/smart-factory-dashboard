import { Link, Outlet } from '@tanstack/react-router'
import { Factory, Radio, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { useFactoryStore } from '../hooks/use-factory-store'
import { factoryModules } from '../lib/modules'
import { sensorSimulator } from '../services/sensorSimulator'

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
 * tab strip. Each module is its own route: the URL is shareable, the browser
 * back button works, and `autoCodeSplitting` gives every module its own chunk
 * instead of shipping all five on first paint.
 */
export function FactoryShell() {
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

      {/* ===== Module navigation + active module ===== */}
      <Main className='space-y-6 pb-12'>
        <div className='overflow-x-auto pb-1'>
          <nav
            aria-label='Factory modules'
            className='inline-flex h-11 items-center gap-1 rounded-xl border border-border/40 bg-muted/60 p-1'
          >
            {factoryModules.map(({ to, label, icon: Icon, iconClass }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold whitespace-nowrap',
                  'text-muted-foreground transition-colors hover:text-foreground',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                )}
                activeProps={{
                  className: 'bg-background text-foreground shadow-sm',
                  'aria-current': 'page',
                }}
              >
                <Icon className={cn('h-4 w-4', iconClass)} /> {label}
              </Link>
            ))}
          </nav>
        </div>

        <Outlet />
      </Main>
    </>
  )
}
