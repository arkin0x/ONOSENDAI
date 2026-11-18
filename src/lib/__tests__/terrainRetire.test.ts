/**
 * terrainRetire.test.ts: the terrain pool lets its workers go after a minute
 * with nothing to do, and starts them again for the next run (lib/workers.ts
 * TERRAIN_IDLE_MS). arkinox's ?diag=1 report of 2026-11-18 had 12 workers
 * alive, 7 of them this pool idling, each its own V8 heap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 3 }, configurable: true })
  type Listener = (event: { data?: unknown; message?: string }) => void
  const state = { made: [] as FakeWorker[] }
  class FakeWorker {
    message: Listener[] = []
    error: Listener[] = []
    running: { id: number; count: number } | null = null
    ended = false
    constructor() { state.made.push(this) }
    addEventListener(type: string, listener: Listener): void { (type === 'message' ? this.message : this.error).push(listener) }
    postMessage(run: { id: number; count: number }): void { this.running = run }
    terminate(): void { this.ended = true }
    fail(): void {
      this.running = null
      for (const l of [...this.error]) l({ message: 'Failed to fetch a worker script' })
    }
    answer(): void {
      const run = this.running!
      this.running = null
      for (const l of [...this.message]) l({ data: { id: run.id, values: new Uint8Array(run.count), elapsedMs: 0 } })
    }
  }
  ;(globalThis as { Worker?: unknown }).Worker = FakeWorker
  return { state }
})

const { TERRAIN_IDLE_MS, postRun, setRunDropHandler, setRunResultHandler, terrainWorkersAlive } = await import('../workers')
const { useVersionGate } = await import('../versionGate')

const run = (id: number) => ({ id, originX: 0n, originY: 0n, originZ: 0n, axis: 'x' as const, step: 1n, count: 2, plane: 0 as const })
const answered: number[] = []
const busy = () => fake.state.made.filter((w) => !w.ended && w.running)

beforeEach(() => {
  vi.useFakeTimers()
  answered.length = 0
  setRunResultHandler((a) => { answered.push(a.id) })
})
afterEach(() => {
  useVersionGate.setState({ verdict: 'ok' })
  vi.useRealTimers()
})

describe('the terrain pool', () => {
  it('lets its workers go a minute after the last answer, and starts new ones for the next run', () => {
    postRun(run(1)); postRun(run(2))
    expect(terrainWorkersAlive()).toBe(2)
    const first = fake.state.made.slice()
    for (const w of busy()) w.answer()
    expect(answered).toEqual([1, 2])
    vi.advanceTimersByTime(TERRAIN_IDLE_MS - 1)
    expect(terrainWorkersAlive()).toBe(2)
    vi.advanceTimersByTime(1)
    expect(terrainWorkersAlive()).toBe(0)
    expect(first.every((w) => w.ended)).toBe(true)
    // The next run: a fresh pool, and its answer still reaches the cache.
    postRun(run(3))
    expect(terrainWorkersAlive()).toBe(2)
    busy()[0].answer()
    expect(answered).toEqual([1, 2, 3])
    vi.advanceTimersByTime(TERRAIN_IDLE_MS)
  })

  it('keeps them while a run is out or waiting, and a new run puts the minute off', () => {
    postRun(run(10)); postRun(run(11)); postRun(run(12))
    // Two out, one waiting: never let go, however long the answers take.
    vi.advanceTimersByTime(TERRAIN_IDLE_MS * 3)
    expect(terrainWorkersAlive()).toBe(2)
    for (const w of busy()) w.answer()
    busy()[0].answer()
    expect(answered).toEqual([10, 11, 12])
    vi.advanceTimersByTime(TERRAIN_IDLE_MS / 2)
    postRun(run(13))
    vi.advanceTimersByTime(TERRAIN_IDLE_MS / 2 + 1)
    expect(terrainWorkersAlive()).toBe(2)
    busy()[0].answer()
    vi.advanceTimersByTime(TERRAIN_IDLE_MS)
    expect(terrainWorkersAlive()).toBe(0)
  })

  it('takes no answer from a worker it let go', () => {
    postRun(run(20))
    const w = busy()[0]
    // Let go while its run is out cannot happen; one that answers late after a retire is someone else's past.
    w.answer()
    vi.advanceTimersByTime(TERRAIN_IDLE_MS)
    expect(terrainWorkersAlive()).toBe(0)
    answered.length = 0
    w.running = { id: 99, count: 1 }
    w.answer()
    expect(answered).toEqual([])
  })

  it('keeps them once a newer build is deployed: a new worker may find its file gone', () => {
    postRun(run(30))
    busy()[0].answer()
    useVersionGate.setState({ verdict: 'hint' })
    vi.advanceTimersByTime(TERRAIN_IDLE_MS * 2)
    expect(terrainWorkersAlive()).toBe(2)
    // A move after the reload hint is still answered by the workers that hold their code.
    postRun(run(31))
    busy()[0].answer()
    expect(answered).toEqual([30, 31])
    useVersionGate.setState({ verdict: 'ok' })
    postRun(run(32)); busy()[0].answer()
    vi.advanceTimersByTime(TERRAIN_IDLE_MS)
    expect(terrainWorkersAlive()).toBe(0)
  })

  it('a pool whose workers never loaded gives every run back and starts over at the next run, never wedged', () => {
    const dropped: number[] = []
    setRunDropHandler((ids) => { dropped.push(...ids) })
    postRun(run(40)); postRun(run(41)); postRun(run(42))
    const failing = busy()
    expect(failing).toHaveLength(2)
    failing[0].fail()
    // Every run out or waiting given back, the whole pool gone.
    expect(dropped.sort()).toEqual([40, 41, 42])
    expect(terrainWorkersAlive()).toBe(0)
    // The sibling's own failure, after, changes nothing.
    failing[1].fail()
    expect(dropped).toHaveLength(3)
    // The next run: a new pool, answered.
    postRun(run(43))
    expect(terrainWorkersAlive()).toBe(2)
    busy()[0].answer()
    expect(answered).toEqual([43])
    // A worker that has answered and then throws costs only its own run, as before.
    postRun(run(44))
    const w = busy()[0]
    w.fail()
    expect(dropped).toContain(44)
    expect(terrainWorkersAlive()).toBe(2)
    setRunDropHandler(null)
  })
})
