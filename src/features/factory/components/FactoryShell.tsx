import { Link, Outlet } from '@tanstack/react-router'
import { Database, Factory, Radio, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { useAlarmAudio, useMesLinkStatus } from '../hooks/use-factory-store'
import { factoryModules } from '../lib/modules'
import { alarmChime } from '../services/alarmChime'
import { factorySource } from '../services/factorySource'

/**
 * Reads a single boolean, so the header button is the only thing that
 * re-renders when the audible alarm is toggled.
 */
function AudioAlarmToggle() {
  const audioEnabled = useAlarmAudio()

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
      onClick={() => alarmChime.setEnabled(!audioEnabled)}
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
 * Nói thật số liệu đang đến từ đâu.
 *
 * Chỗ này trước đây là một phù hiệu "IoT Stream Online" bật cứng — nó xanh kể
 * cả khi không có một byte nào đi qua mạng. Một dashboard công nghiệp mà báo
 * trạng thái kết nối sai thì tệ hơn là không báo gì: người vận hành sẽ tin vào
 * con số đang đứng im.
 */
function DataSourceBadge() {
  const link = useMesLinkStatus()

  if (factorySource.kind === 'simulator') {
    return (
      <Badge
        variant='outline'
        className='hidden gap-1.5 border-amber-500/30 bg-amber-500/10 py-1 font-mono text-xs text-amber-500 sm:flex'
        title='Chưa cấu hình VITE_MES_API_URL — số liệu sinh ngay trong trình duyệt'
      >
        <Radio className='h-3 w-3' /> Nguồn: Mô Phỏng
      </Badge>
    )
  }

  const online = link.status === 'online'
  return (
    <Badge
      variant='outline'
      className={cn(
        'hidden gap-1.5 py-1 font-mono text-xs sm:flex',
        online
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
          : 'border-destructive/40 bg-destructive/10 text-destructive'
      )}
      title={
        online
          ? 'Số liệu do backend MES phát ra, lịch sử lưu trong TimescaleDB'
          : 'Mất kết nối tới backend MES — số trên màn hình là số cuối cùng đọc được'
      }
    >
      <Database className='h-3 w-3' />
      {online ? 'MES LIVE · Historian' : 'MES MẤT KẾT NỐI'}
    </Badge>
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

          <DataSourceBadge />

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
