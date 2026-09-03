import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/` is not a module of its own — the SCADA command center is the landing
 * screen, and giving it its own URL keeps every module deep-linkable.
 */
export const Route = createFileRoute('/_authenticated/')({
  beforeLoad: () => {
    throw redirect({ to: '/scada' })
  },
})
