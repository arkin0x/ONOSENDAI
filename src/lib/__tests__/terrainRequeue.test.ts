/**
 * terrainRequeue.test.ts: a block whose run is dropped before any worker
 * starts it is asked for again, and a block is never sampled twice.
 *
 * Leaving the main view for an Earth or hyperspace view clears the run queue
 * (useTerrainVolume, clearRunQueue). Until 2026-10-20 that dropped the queued
 * runs but left their blocks marked as asked for, so on return the volume
 * skipped them as pending and they stayed empty for good. A worker that threw
 * on a run did the same to that run's blocks.
 *
 * Everything here is real (the pull queue, the cache and its bookkeeping, the
 * volume layout and read) except the Worker class, which holds each run until
 * the test answers it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plane } from 'cyberspace-core'
import type { Position, ViewAxes } from '../space'

const fake = vi.hoisted(() => {
  // The terrain worker's module, where UNKNOWN lives, installs its message
  // handler on `self` when imported.
  ;(globalThis as { self?: unknown }).self ??= globalThis
  // Two workers, so most of a volume's runs wait in the queue.
  Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 3 }, configurable: true })

  type Run = { id: number; originX: bigint; originY: bigint; originZ: bigint; axis: 'x' | 'y' | 'z'; step: bigint; count: number; plane: number }
  type Listener = (event: { data?: unknown; message?: string }) => void

  const state = {
    workers: [] as FakeWorker[],
    /** How many times each block has been handed to a worker. */
    sampled: new Map<string, number>(),
    keyOf: null as ((x: bigint, y: bigint, z: bigint, plane: number) => string) | null,
  }

  class FakeWorker {
    message: Listener[] = []
    error: Listener[] = []
    running: Run | null = null
    constructor() { state.workers.push(this) }
    addEventListener(type: string, listener: Listener): void {
      if (type === 'message') this.message.push(listener)
      if (type === 'error') this.error.push(listener)
    }
    postMessage(run: Run): void {
      if (this.running) throw new Error('a busy worker was handed a run')
      this.running = run
      const at = { x: run.originX, y: run.originY, z: run.originZ }
      for (let i = 0; i < run.count; i++, at[run.axis] += run.step) {
        const key = state.keyOf!(at.x, at.y, at.z, run.plane)
        state.sampled.set(key, (state.sampled.get(key) ?? 0) + 1)
      }
    }
    /** Post this worker's run back, each cell's K made from its block key. */
    answer(): void {
      const run = this.running!
      this.running = null
      const values = new Uint8Array(run.count)
      const at = { x: run.originX, y: run.originY, z: run.originZ }
      for (let i = 0; i < run.count; i++, at[run.axis] += run.step) values[i] = kOf(state.keyOf!(at.x, at.y, at.z, run.plane))
      for (const listener of [...this.message]) listener({ data: { id: run.id, values, elapsedMs: 0 } })
    }
    /** Throw on this worker's run: no answer, only an error event. */
    fail(): void {
      this.running = null
      for (const listener of [...this.error]) listener({ message: 'boom' })
    }
  }

  function kOf(key: string): number {
    let h = 0
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0
    return (h >>> 0) % 200
  }

  ;(globalThis as { Worker?: unknown }).Worker = FakeWorker
  return { state, kOf }
})

const { layoutVolume, readVolume } = await import('../../hooks/useTerrainVolume')
const { blockKey, inflightRuns, isKeyPending, readKey } = await import('../terrainCache')
const { clearRunQueue, queuedRuns } = await import('../workers')
fake.state.keyOf = (x, y, z, plane) => blockKey(x, y, z, plane as Plane)

const busy = (): typeof fake.state.workers => fake.state.workers.filter((w) => w.running)

/** Answer `n` started runs, oldest worker first. Each answer starts the next queued run. */
function answer(n: number): void {
  for (let i = 0; i < n; i++) busy()[0]?.answer()
}

/** Flush and answer until nothing is left to ask for or answer, as the hook's flushes would. */
function settle(layout: ReturnType<typeof layoutVolume>): Uint8Array {
  let values = readVolume(layout)
  for (let guard = 0; busy().length > 0; guard++) {
    if (guard > 100_000) throw new Error('never settled')
    for (const w of busy()) w.answer()
    values = readVolume(layout)
  }
  return values
}

// Each test starts with the pool idle, and counts in-flight runs from what it
// began with, so a test that failed part way does not fail the next one too.
let inflightBefore = 0
beforeEach(() => {
  clearRunQueue()
  answer(busy().length)
  inflightBefore = inflightRuns()
})

/** Every block of the layout known with its own K, none asked for, nothing queued, and nothing left in flight. */
function expectComplete(layout: ReturnType<typeof layoutVolume>, values: Uint8Array): void {
  // Gathered and checked once: an expect per block is most of this file's time.
  const unknown = layout.keys.filter((k) => readKey(k) === undefined)
  expect(unknown.length).toBe(0)
  const wrong = layout.keys.filter((k, s) => values[layout.at[s]] !== fake.kOf(k))
  expect(wrong).toEqual([])
  expect(layout.keys.filter(isKeyPending)).toEqual([])
  expect(queuedRuns()).toBe(0)
  expect(inflightRuns()).toBe(inflightBefore)
}

/** No block of these layouts was handed to a worker more than once. */
function expectSampledOnce(...layouts: ReturnType<typeof layoutVolume>[]): void {
  for (const layout of layouts) {
    expect(layout.keys.filter((key) => fake.state.sampled.get(key) !== 1)).toEqual([])
  }
}

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: -1 }, out: { axis: 'z', dir: 1 } }
// Far apart, so no two tests share a block of the module-wide cache.
const place = (i: number): Position => ({ x: (1n << 80n) + BigInt(i) * (1n << 40n), y: 1n << 79n, z: (1n << 78n) + BigInt(i) * 12_345n })
// scaleExp 4: every cell is its own block, so a volume is 361 runs of 19.
const SCALE = 4
const plane = 0 as Plane

describe('terrain runs dropped before they start', () => {
  it('are asked for again when the main view comes back after an Earth or hyperspace view', () => {
    const centre = place(1)
    const before = layoutVolume(centre, AXES, SCALE, plane)
    readVolume(before)
    expect(queuedRuns()).toBeGreaterThan(300)
    // A few answers land, then the view is left with most runs still queued.
    answer(5)
    clearRunQueue()
    expect(queuedRuns()).toBe(0)
    // The runs already on a worker are not dropped. Their answers arrive
    // after leaving and are kept.
    const late = busy().length
    expect(late).toBe(2)
    answer(late)
    expect(busy().length).toBe(0)
    expect(inflightRuns()).toBe(inflightBefore)

    // Back to the main view: the hook lays the volume out again and reads it.
    const after = layoutVolume(centre, AXES, SCALE, plane)
    readVolume(after)
    const missing = after.keys.filter((k) => readKey(k) === undefined)
    expect(missing.length).toBeGreaterThan(6000)
    // Every block not yet known is asked for again, none left marked from before.
    for (const key of missing) expect(isKeyPending(key)).toBe(true)

    expectComplete(after, settle(after))
    // The dropped runs never reached a worker, so nothing was sampled twice,
    // the late answers included.
    expectSampledOnce(after)
  })

  it('fill in over several leaves and returns, some of them somewhere else', () => {
    const home = place(2), away = place(3)
    for (let trip = 0; trip < 4; trip++) {
      const layout = layoutVolume(trip % 2 ? away : home, AXES, SCALE, plane)
      readVolume(layout)
      answer(40 + trip * 13)
      // A flush or two while there, then leave.
      readVolume(layout)
      answer(7)
      clearRunQueue()
      // Some late answers land before the return, some after.
      if (trip % 2) answer(busy().length)
    }
    const last = layoutVolume(home, AXES, SCALE, plane)
    expectComplete(last, settle(last))
    const other = layoutVolume(away, AXES, SCALE, plane)
    expectComplete(other, settle(other))
    expectSampledOnce(last, other)
  })

  it('are asked for again after a worker throws on one', () => {
    const centre = place(4)
    const layout = layoutVolume(centre, AXES, SCALE, plane)
    readVolume(layout)
    answer(3)
    const failed = busy()[0]
    const run = failed.running!
    failed.fail()
    // The failed run's blocks are free to be asked for again, and the next
    // flush, which other answers bring, asks for them.
    const at = { x: run.originX, y: run.originY, z: run.originZ }
    const keys: string[] = []
    for (let i = 0; i < run.count; i++, at[run.axis] += run.step) keys.push(blockKey(at.x, at.y, at.z, plane))
    for (const key of keys) expect(isKeyPending(key)).toBe(false)

    expectComplete(layout, settle(layout))
    // Only the failed run's blocks went to a worker twice.
    expect(layout.keys.filter((key) => fake.state.sampled.get(key) !== (keys.includes(key) ? 2 : 1))).toEqual([])
  })
})

describe('the main view never left', () => {
  it('asks for every block once and fills the volume, at every scale', () => {
    for (const [i, scaleExp] of [0, 1, 3, 4, 11].entries()) {
      const centre = place(10 + i)
      const layout = layoutVolume(centre, AXES, scaleExp, plane)
      expectComplete(layout, settle(layout))
      expectSampledOnce(layout)
      // A step along each axis asks only for what it does not share.
      for (const a of ['x', 'y', 'z'] as const) {
        const moved = layoutVolume({ ...centre, [a]: centre[a] + (1n << BigInt(scaleExp)) }, AXES, scaleExp, plane)
        expectComplete(moved, settle(moved))
        expectSampledOnce(moved)
      }
    }
    // Twenty volumes filled: generous, for a suite run on a busy machine.
  }, 60_000)
})
