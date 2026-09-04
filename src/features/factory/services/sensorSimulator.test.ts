import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sensorSimulator } from './sensorSimulator'

/** The simulator ticks on this period; the tests advance time in whole ticks. */
const TICK_MS = 1500

/**
 * The simulator is a module-level singleton — one clock for the whole app — so
 * every test subscribes, drives it, and unsubscribes. `subscribe` returning an
 * unsubscribe that stops the timer is itself part of the contract.
 */
function attach() {
  return sensorSimulator.subscribe(() => {})
}

function ticks(n: number) {
  vi.advanceTimersByTime(n * TICK_MS)
}

function machine(id: string) {
  const m = sensorSimulator.getSnapshot().machines.find((x) => x.id === id)
  if (!m) throw new Error('unknown machine ' + id)
  return m
}

beforeEach(() => {
  vi.useFakeTimers()
  sensorSimulator.resetAll()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('external-store contract', () => {
  it('only runs the clock while something is subscribed', () => {
    const before = machine('SMT-LINE-01').output

    // Nothing subscribed: the timer must not exist at all.
    ticks(10)
    expect(machine('SMT-LINE-01').output).toBe(before)

    const detach = attach()
    ticks(10)
    const whileSubscribed = machine('SMT-LINE-01').output
    expect(whileSubscribed).toBeGreaterThan(before)

    detach()
    ticks(10)
    expect(machine('SMT-LINE-01').output).toBe(whileSubscribed)
  })

  it('notifies subscribers once per tick', () => {
    const listener = vi.fn()
    const detach = sensorSimulator.subscribe(listener)

    ticks(3)
    detach()

    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('hands out a new snapshot object per tick so React sees the change', () => {
    const detach = attach()
    const first = sensorSimulator.getSnapshot()

    ticks(1)
    const second = sensorSimulator.getSnapshot()
    detach()

    expect(second).not.toBe(first)
    expect(second.machines).not.toBe(first.machines)
  })

  it('replaces telemetry history instead of mutating it in place', () => {
    // Mutating the array would let a memoised chart keep rendering stale data
    // while its props compare equal — the bug this guards against.
    const detach = attach()
    const before = sensorSimulator.getSnapshot().telemetryHistory['SMT-LINE-01']

    ticks(1)
    const after = sensorSimulator.getSnapshot().telemetryHistory['SMT-LINE-01']
    detach()

    expect(after).not.toBe(before)
    expect(after[after.length - 1].t).toBeGreaterThan(
      before[before.length - 1].t
    )
  })

  it('caps the rolling window instead of growing forever', () => {
    const detach = attach()

    ticks(80)
    const history =
      sensorSimulator.getSnapshot().telemetryHistory['SMT-LINE-01']
    detach()

    expect(history).toHaveLength(40)
  })
})

describe('OEE time accounting', () => {
  it('charges a stopped machine to down time, never to run time', () => {
    const detach = attach()
    sensorSimulator.triggerFault('SMT-LINE-01', 'emergency_stop')

    const stopped = machine('SMT-LINE-01')
    ticks(20)
    const after = machine('SMT-LINE-01')
    detach()

    expect(after.status).toBe('error')
    expect(after.downTimeMs).toBe(stopped.downTimeMs + 20 * TICK_MS)
    expect(after.runTimeMs).toBe(stopped.runTimeMs)
  })

  it('keeps a stopped machine inside planned production time', () => {
    // Planned time keeps ticking for a broken machine — that is the whole
    // reason a stoppage shows up as an availability loss rather than vanishing.
    const detach = attach()
    sensorSimulator.triggerFault('SMT-LINE-01', 'emergency_stop')

    const before = machine('SMT-LINE-01')
    ticks(20)
    const after = machine('SMT-LINE-01')
    detach()

    expect(after.runTimeMs + after.downTimeMs).toBe(
      before.runTimeMs + before.downTimeMs + 20 * TICK_MS
    )
  })

  it('pulls line availability down while a machine is stopped', () => {
    const detach = attach()
    const before = sensorSimulator.getSnapshot().oee.availability

    sensorSimulator.triggerFault('SMT-LINE-01', 'emergency_stop')
    ticks(400) // ~10 minutes of shift time
    const during = sensorSimulator.getSnapshot().oee.availability
    detach()

    expect(during).toBeLessThan(before)
  })

  it('charges a producing machine to run time', () => {
    const detach = attach()
    const before = machine('CNC-MILL-03')

    ticks(10)
    const after = machine('CNC-MILL-03')
    detach()

    expect(after.runTimeMs).toBe(before.runTimeMs + 10 * TICK_MS)
    expect(after.downTimeMs).toBe(before.downTimeMs)
  })

  it('still counts a warning state as producing', () => {
    // A machine running hot is degraded, not stopped: it keeps making units,
    // so it belongs in run time and shows up as a performance/quality loss.
    const detach = attach()
    sensorSimulator.setLineSpeed(3.0) // pushes every machine into 'warning'
    ticks(2)

    const before = machine('SMT-LINE-01')
    ticks(5)
    const after = machine('SMT-LINE-01')
    detach()

    expect(after.status).toBe('warning')
    expect(after.runTimeMs).toBe(before.runTimeMs + 5 * TICK_MS)
    expect(after.output).toBeGreaterThan(before.output)
  })

  it('keeps the reported OEE the product of its three factors', () => {
    const detach = attach()
    ticks(50)
    const { availability, performance, quality, overall } =
      sensorSimulator.getSnapshot().oee
    detach()

    expect(overall).toBeCloseTo(
      (availability * performance * quality) / 10000,
      1
    )
  })
})

describe('line speed', () => {
  it('clamps to the 0.5x-3.0x range the HMI slider offers', () => {
    sensorSimulator.setLineSpeed(9)
    expect(sensorSimulator.getSnapshot().lineSpeed).toBe(3.0)

    sensorSimulator.setLineSpeed(0.1)
    expect(sensorSimulator.getSnapshot().lineSpeed).toBe(0.5)
  })

  it('produces more units per tick when the line runs faster', () => {
    const detach = attach()

    sensorSimulator.setLineSpeed(0.5)
    const slowStart = machine('CNC-MILL-03').output
    ticks(20)
    const slow = machine('CNC-MILL-03').output - slowStart

    sensorSimulator.setLineSpeed(2.0)
    const fastStart = machine('CNC-MILL-03').output
    ticks(20)
    const fast = machine('CNC-MILL-03').output - fastStart
    detach()

    expect(fast).toBeGreaterThan(slow)
  })

  it('costs quality once the line is pushed past 2.0x', () => {
    const detach = attach()
    sensorSimulator.setLineSpeed(3.0)

    const before = machine('CNC-MILL-03').defects
    ticks(60)
    const after = machine('CNC-MILL-03').defects
    detach()

    expect(after).toBeGreaterThan(before)
  })
})

describe('faults and alarms', () => {
  it.each(['overheat', 'vibration', 'emergency_stop'] as const)(
    'stops the machine and raises a critical alarm on %s',
    (fault) => {
      sensorSimulator.triggerFault('CNC-MILL-03', fault)
      const { alarms } = sensorSimulator.getSnapshot()

      expect(machine('CNC-MILL-03').status).toBe('error')
      expect(alarms[0].machineId).toBe('CNC-MILL-03')
      expect(alarms[0].severity).toBe('critical')
      expect(alarms[0].acknowledged).toBe(false)
    }
  )

  it('does not stack duplicate unacknowledged alarms for one machine', () => {
    // Chattering alarms are how a real alarm list becomes unreadable, and why
    // an operator stops looking at it.
    sensorSimulator.triggerFault('CNC-MILL-03', 'overheat')
    sensorSimulator.triggerFault('CNC-MILL-03', 'overheat')
    sensorSimulator.triggerFault('CNC-MILL-03', 'vibration')

    const critical = sensorSimulator
      .getSnapshot()
      .alarms.filter(
        (a) => a.machineId === 'CNC-MILL-03' && a.severity === 'critical'
      )

    expect(critical).toHaveLength(1)
  })

  it('lets a new alarm through once the previous one is acknowledged', () => {
    sensorSimulator.triggerFault('CNC-MILL-03', 'overheat')
    const first = sensorSimulator.getSnapshot().alarms[0]

    sensorSimulator.acknowledgeAlarm(first.id)
    sensorSimulator.triggerFault('CNC-MILL-03', 'vibration')

    const alarms = sensorSimulator.getSnapshot().alarms
    expect(alarms).toHaveLength(2)
    expect(alarms[0].acknowledged).toBe(false)
  })

  it('restores baseline and acknowledges the alarms when repaired', () => {
    const baseline = machine('CNC-MILL-03')

    sensorSimulator.triggerFault('CNC-MILL-03', 'overheat')
    expect(machine('CNC-MILL-03').temperature).toBeGreaterThan(
      baseline.temperature
    )

    sensorSimulator.repairMachine('CNC-MILL-03')
    const repaired = machine('CNC-MILL-03')

    expect(repaired.status).toBe('running')
    expect(repaired.temperature).toBe(baseline.temperature)
    expect(
      sensorSimulator
        .getSnapshot()
        .alarms.filter((a) => a.machineId === 'CNC-MILL-03' && !a.acknowledged)
    ).toHaveLength(0)
  })

  it('does not lose the accumulated down time when a machine is repaired', () => {
    // Repair fixes the machine, not the shift: the stop already happened and
    // must keep counting against availability.
    const detach = attach()
    sensorSimulator.triggerFault('CNC-MILL-03', 'overheat')
    ticks(20)
    const stoppedFor = machine('CNC-MILL-03').downTimeMs

    sensorSimulator.repairMachine('CNC-MILL-03')
    detach()

    expect(machine('CNC-MILL-03').downTimeMs).toBe(stoppedFor)
  })

  it('ignores a fault or repair aimed at an unknown machine', () => {
    const before = sensorSimulator.getSnapshot().machines
    sensorSimulator.triggerFault('nope', 'overheat')
    sensorSimulator.repairMachine('nope')

    expect(sensorSimulator.getSnapshot().alarms).toHaveLength(0)
    expect(sensorSimulator.getSnapshot().machines).toHaveLength(before.length)
  })
})

describe('resetAll', () => {
  it('clears alarms and returns every machine to its seeded state', () => {
    const detach = attach()
    sensorSimulator.setLineSpeed(2.5)
    sensorSimulator.triggerFault('SMT-LINE-01', 'overheat')
    ticks(20)

    sensorSimulator.resetAll()
    detach()

    const state = sensorSimulator.getSnapshot()
    expect(state.alarms).toHaveLength(0)
    expect(state.lineSpeed).toBe(1.0)
    expect(state.feedDensity).toBe('NORMAL')
    expect(state.machines.every((m) => m.status === 'running')).toBe(true)
  })
})
