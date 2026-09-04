import {
  BellRing,
  Camera,
  Cpu,
  Database,
  Factory,
  LayoutDashboard,
} from 'lucide-react'

/**
 * The five shop-floor modules, in the order an operator walks the line.
 *
 * Single source of truth for both the tab strip inside the factory shell and
 * the app sidebar, so the two cannot drift apart when a module is added.
 */
export const factoryModules = [
  {
    to: '/scada',
    label: 'SCADA Command Center',
    shortLabel: 'SCADA Command Center',
    icon: LayoutDashboard,
    iconClass: 'text-primary',
  },
  {
    // Ngay sau SCADA: khi có gì kêu, đây là nơi người vận hành mở ra tiếp theo.
    to: '/alarms',
    label: 'Alarm Management ISA-18.2',
    shortLabel: 'Alarm ISA-18.2',
    icon: BellRing,
    iconClass: 'text-destructive',
  },
  {
    to: '/twin',
    label: 'Digital Twin 2D/3D Line',
    shortLabel: 'Digital Twin',
    icon: Cpu,
    iconClass: 'text-blue-400',
  },
  {
    to: '/vision',
    label: 'Vision AOI Inspector',
    shortLabel: 'Vision AOI',
    icon: Camera,
    iconClass: 'text-amber-500',
  },
  {
    to: '/plc',
    label: 'PLC S7-1200 Rack & Ladder',
    shortLabel: 'PLC & Ladder',
    icon: Factory,
    iconClass: 'text-emerald-400',
  },
  {
    to: '/mes',
    label: 'MES Product Traceability',
    shortLabel: 'MES Traceability',
    icon: Database,
    iconClass: 'text-purple-400',
  },
] as const
