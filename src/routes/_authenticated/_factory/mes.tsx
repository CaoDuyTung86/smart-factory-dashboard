import { createFileRoute } from '@tanstack/react-router'
import { MesTraceability } from '@/features/factory/components/MesTraceability'

export const Route = createFileRoute('/_authenticated/_factory/mes')({
  component: MesTraceability,
})
