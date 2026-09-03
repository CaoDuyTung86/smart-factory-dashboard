import { createFileRoute } from '@tanstack/react-router'
import { ScadaPanel } from '@/features/factory/components/ScadaPanel'

export const Route = createFileRoute('/_authenticated/_factory/scada')({
  component: ScadaPanel,
})
