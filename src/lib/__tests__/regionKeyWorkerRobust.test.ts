/**
 * The shared region worker settles every call (review of #624).
 *
 * A module worker whose script fails to load fires `error`, never `message`,
 * and a hung one fires nothing; regionKeyOffThread used to wait on either
 * forever, and the module-level singleton made every later deploy, room and
 * TEST DISCOVERY wait behind it. Now `error`, `messageerror` and a timeout
 * scaled to height each end the worker, refuse what waits on it, and the next
 * call makes a fresh one. No key is derived here: the worker is a fake that
 * answers, fails or stays silent as told.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { H20_TIMEOUT_MS, MIN_TIMEOUT_MS, endRegionKeyWorker, regionKeyOffThread, regionKeyTimeoutMs, regionKeyWorker } from '../regionKeyOffThread'
import { useCalibration } from '../calibration'
import type { RegionRequest, RegionResponse } from '../../workers/region.worker'

type Listener = (e: { data?: unknown }) => void

/** Every fake worker made, newest last. */
let made: FakeWorker[] = []
/** Throw from the constructor, as a browser can for a bad URL. */
let constructorThrows = false

class FakeWorker {
  listeners: Record<string, Set<Listener>> = {}
  asked: RegionRequest[] = []
  ended = false
  constructor() {
    if (constructorThrows) throw new Error('no worker for you')
    made.push(this)
  }
  addEventListener(type: string, fn: Listener): void { (this.listeners[type] ??= new Set()).add(fn) }
  removeEventListener(type: string, fn: Listener): void { this.listeners[type]?.delete(fn) }
  postMessage(request: RegionRequest): void { this.asked.push(request) }
  terminate(): void { this.ended = true }
  fire(type: string, data?: unknown): void { for (const fn of [...(this.listeners[type] ?? [])]) fn({ data }) }
  /** Answer one request with a key at each height it asked, then done. */
  answer(request: RegionRequest): void {
    for (const height of request.heights) {
      this.fire('message', { type: 'key', id: request.id, key: { height, lookupId: `lookup${height}`, keyHex: '11'.repeat(32) } } satisfies RegionResponse)
    }
    this.fire('message', { type: 'done', id: request.id } satisfies RegionResponse)
  }
}

const AT = { x: 1n, y: 2n, z: 3n }
const realWorker = (globalThis as { Worker?: unknown }).Worker
/** A fast machine's measurements: every height's floor stands. */
const FAST = { 10: 1, 20: 50 }

/** The page, as far as visibility goes: one for the file, since the module watches the first it sees. */
const page = {
  visibilityState: 'visible' as 'visible' | 'hidden',
  listeners: [] as Array<() => void>,
  addEventListener(type: string, fn: () => void): void { if (type === 'visibilitychange') this.listeners.push(fn) },
  set(state: 'visible' | 'hidden'): void { this.visibilityState = state; for (const fn of this.listeners) fn() },
}
;(globalThis as { document?: unknown }).document = page

beforeEach(() => {
  made = []
  constructorThrows = false
  ;(globalThis as { Worker?: unknown }).Worker = FakeWorker
  useCalibration.setState({ cantorMsByHeight: FAST })
  page.visibilityState = 'visible'
})

afterEach(() => {
  endRegionKeyWorker()
  ;(globalThis as { Worker?: unknown }).Worker = realWorker
  vi.useRealTimers()
})

describe('regionKeyTimeoutMs', () => {
  it('gives ten minutes at height 20, halving per height below, never under a minute', () => {
    expect(regionKeyTimeoutMs(20, FAST)).toBe(H20_TIMEOUT_MS)
    expect(regionKeyTimeoutMs(19, FAST)).toBe(H20_TIMEOUT_MS / 2)
    expect(regionKeyTimeoutMs(17, FAST)).toBe(H20_TIMEOUT_MS / 8)
    expect(regionKeyTimeoutMs(12, FAST)).toBe(MIN_TIMEOUT_MS)
    expect(regionKeyTimeoutMs(1, FAST)).toBe(MIN_TIMEOUT_MS)
  })

  it('gives the ten minutes at any height before the device is measured (review of #625)', () => {
    expect(regionKeyTimeoutMs(1)).toBe(H20_TIMEOUT_MS)
    expect(regionKeyTimeoutMs(12, {})).toBe(H20_TIMEOUT_MS)
    expect(regionKeyTimeoutMs(21)).toBe(H20_TIMEOUT_MS * 2)
  })

  it('never allows less than ten times what this device measured for the three axes', () => {
    // A very slow phone: 100 s per axis at height 20, so 300 s for the key.
    expect(regionKeyTimeoutMs(20, { 20: 100_000 })).toBe(3_000_000)
    // A fast one changes nothing: the floor stands.
    expect(regionKeyTimeoutMs(20, { 20: 50 })).toBe(H20_TIMEOUT_MS)
  })
})

describe('regionKeyOffThread', () => {
  it('resolves with the key the worker answers, and its timer never fires after', async () => {
    vi.useFakeTimers()
    const p = regionKeyOffThread(AT, 10, 20)
    made[0].answer(made[0].asked[0])
    await expect(p).resolves.toMatchObject({ lookupId: 'lookup10' })
    vi.advanceTimersByTime(H20_TIMEOUT_MS * 4)
    expect(made[0].ended).toBe(false)
  })

  it('refuses a call when the worker fires error (its script failed to load), and the next call makes a fresh worker', async () => {
    const first = regionKeyOffThread(AT, 10, 20)
    const second = regionKeyOffThread(AT, 12, 20)
    made[0].fire('error')
    await expect(first).rejects.toThrow(/failed to start/)
    await expect(second).rejects.toThrow(/failed to start/)
    expect(made[0].ended).toBe(true)
    const third = regionKeyOffThread(AT, 10, 20)
    expect(made).toHaveLength(2)
    made[1].answer(made[1].asked[0])
    await expect(third).resolves.toMatchObject({ lookupId: 'lookup10' })
  })

  it('refuses a call on messageerror, and the next call makes a fresh worker', async () => {
    const p = regionKeyOffThread(AT, 10, 20)
    made[0].fire('messageerror')
    await expect(p).rejects.toThrow(/could not be read/)
    void regionKeyOffThread(AT, 10, 20).catch(() => undefined)
    expect(made).toHaveLength(2)
  })

  it('refuses a call the worker never answers once its time at that height runs out, and drops the hung worker', async () => {
    vi.useFakeTimers()
    const p = regionKeyOffThread(AT, 20, 20)
    const settled = vi.fn()
    p.then(settled, settled)
    vi.advanceTimersByTime(H20_TIMEOUT_MS - 1000)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    await expect(p).rejects.toThrow(/did not answer within 10 min at height 20\. Try again\./)
    expect(made[0].ended).toBe(true)
    void regionKeyOffThread(AT, 10, 20).catch(() => undefined)
    expect(made).toHaveLength(2)
  })

  it('starts a queued call\'s clock where the one ahead of it ends: the worker answers one at a time', async () => {
    vi.useFakeTimers()
    const a = regionKeyOffThread(AT, 10, 20)
    const b = regionKeyOffThread(AT, 10, 20)
    const bSettled = vi.fn()
    b.then(bSettled, bSettled)
    // A takes almost its whole minute, then answers.
    vi.advanceTimersByTime(MIN_TIMEOUT_MS - 1000)
    made[0].answer(made[0].asked[0])
    await expect(a).resolves.toBeTruthy()
    // B is past its own minute from when it was asked, but not past A's plus its own.
    vi.advanceTimersByTime(30_000)
    await Promise.resolve()
    expect(bSettled).not.toHaveBeenCalled()
    vi.advanceTimersByTime(MIN_TIMEOUT_MS)
    await expect(b).rejects.toThrow(/did not answer/)
  })

  it('a page hidden at any point since the call re-arms its timer instead of ending the worker: backgrounding never kills a deploy', async () => {
    vi.useFakeTimers()
    const p = regionKeyOffThread(AT, 20, 20)
    const settled = vi.fn()
    p.then(settled, settled)
    // The phone locked for a while, and came back.
    page.set('hidden')
    page.set('visible')
    vi.advanceTimersByTime(H20_TIMEOUT_MS + 1000)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    expect(made[0].ended).toBe(false)
    // Its full time again, visible throughout: now it is hung.
    vi.advanceTimersByTime(H20_TIMEOUT_MS)
    await expect(p).rejects.toThrow(/Try again/)
    expect(made[0].ended).toBe(true)
  })

  it('a page hidden when the time runs out re-arms too, and the answer that comes later is taken', async () => {
    vi.useFakeTimers()
    const p = regionKeyOffThread(AT, 20, 20)
    page.set('hidden')
    vi.advanceTimersByTime(H20_TIMEOUT_MS * 3)
    expect(made[0].ended).toBe(false)
    made[0].answer(made[0].asked[0])
    await expect(p).resolves.toMatchObject({ lookupId: 'lookup20' })
  })

  it('a worker that cannot even be made refuses the call instead of throwing', async () => {
    constructorThrows = true
    await expect(regionKeyOffThread(AT, 10, 20)).rejects.toThrow(/no worker for you/)
  })

  it('a worker\'s own error message still refuses only its call', async () => {
    const p = regionKeyOffThread(AT, 10, 20)
    made[0].fire('message', { type: 'error', id: made[0].asked[0].id, message: 'height too big' } satisfies RegionResponse)
    await expect(p).rejects.toThrow('height too big')
    expect(made[0].ended).toBe(false)
  })
})

describe('regionKeyWorker (Cyberspace TV)', () => {
  it('refuses what waits on a worker that fires error, and the next ask makes a fresh one', async () => {
    const w = regionKeyWorker()
    const p = w.keys(AT, [4, 6], 20)
    made[0].fire('error')
    await expect(p).rejects.toThrow(/failed to start/)
    expect(made[0].ended).toBe(true)
    const q = w.keys(AT, [4], 20)
    expect(made).toHaveLength(2)
    made[1].answer(made[1].asked[0])
    await expect(q).resolves.toHaveLength(1)
    w.close()
  })
})
