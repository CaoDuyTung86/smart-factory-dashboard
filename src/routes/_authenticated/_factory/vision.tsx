import { createFileRoute } from '@tanstack/react-router'
import { VisionInspector } from '@/features/factory/components/VisionInspector'

export const Route = createFileRoute('/_authenticated/_factory/vision')({
  component: VisionInspector,
})
