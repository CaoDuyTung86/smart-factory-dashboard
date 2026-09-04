import { createFileRoute } from '@tanstack/react-router'
import { AlarmCenter } from '@/features/factory/components/AlarmCenter'

export const Route = createFileRoute('/_authenticated/_factory/alarms')({
  component: AlarmCenter,
})
