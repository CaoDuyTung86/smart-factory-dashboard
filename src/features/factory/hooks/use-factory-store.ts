import { useSyncExternalStore } from 'react'
import { sensorSimulator } from '../services/sensorSimulator'
import type { FactoryState } from '../types'

/**
 * Subscribes a component to one slice of the simulator.
 *
 * The selector must return a value the simulator keeps stable between changes
 * (a slice of the snapshot, or a primitive) — building a new object inside the
 * selector would make React see a fresh value on every read and loop.
 *
 * Reading per slice is what keeps the cost down: a tick that only moves machine
 * telemetry re-renders the machine grid, not the Digital Twin or PLC tabs.
 */
export function useFactoryStore<T>(selector: (state: FactoryState) => T): T {
  return useSyncExternalStore(sensorSimulator.subscribe, () =>
    selector(sensorSimulator.getSnapshot())
  )
}
