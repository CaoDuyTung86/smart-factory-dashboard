import { createFileRoute } from '@tanstack/react-router'
import { PlcDiagnostics } from '@/features/factory/components/PlcDiagnostics'

export const Route = createFileRoute('/_authenticated/_factory/plc')({
  component: PlcDiagnostics,
})
