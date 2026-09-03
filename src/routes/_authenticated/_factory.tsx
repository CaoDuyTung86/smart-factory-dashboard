import { createFileRoute } from '@tanstack/react-router'
import { FactoryShell } from '@/features/factory/components/FactoryShell'

/**
 * Pathless layout: it contributes no URL segment, so the modules stay at
 * `/scada`, `/twin`, ... while sharing one header and one tab strip.
 */
export const Route = createFileRoute('/_authenticated/_factory')({
  component: FactoryShell,
})
