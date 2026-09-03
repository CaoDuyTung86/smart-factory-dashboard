import { createFileRoute } from '@tanstack/react-router'
import { DigitalTwinLine } from '@/features/factory/components/DigitalTwinLine'

export const Route = createFileRoute('/_authenticated/_factory/twin')({
  component: DigitalTwinLine,
})
