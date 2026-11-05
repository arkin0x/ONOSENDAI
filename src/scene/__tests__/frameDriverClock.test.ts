/**
 * frameDriverClock.test.ts: the scene's clock across a pause (review of #611).
 * The workshop covers the world and FrameDriver stops drawing it; when the bench
 * closes, the scene's time goes on from where it stopped, as if the pause never
 * happened (ClockKeeper's job before the idle cap). Several things time themselves
 * from clock.elapsedTime (fleet cube fades, the crossing flash, a glide), and a
 * clock that jumped by the pause would leave them done before they were seen.
 *
 * The driver itself runs here, under a small stand-in for React (effects run after
 * the render that asks for them, when their dependencies change), with R3F's
 * advance recorded and the display's frames and performance.now driven by hand.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

interface Effect { deps?: unknown[]; cleanup?: () => void }
const effects: Effect[] = []
const refs: Array<{ current: unknown }> = []
let pending: Array<() => void> = []
let ei = 0
let ri = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (v: unknown) => { refs[ri] ??= { current: v }; return refs[ri++] },
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    const k = ei++
    const prev = effects[k]
    if (prev && deps && prev.deps && deps.every((d, n) => d === prev.deps![n])) return
    pending.push(() => { prev?.cleanup?.(); effects[k] = { deps, cleanup: fn() || undefined } })
  },
}))

const fiber = vi.hoisted(() => ({ advanced: [] as number[] }))
const three = { clock: { autoStart: true, stop: () => {} }, scene: { children: [] }, camera: {} }
const get = (): typeof three => three
vi.mock('@react-three/fiber', () => ({
  advance: (at: number) => { fiber.advanced.push(at) },
  useThree: (sel: (s: { get: typeof get }) => unknown) => sel({ get }),
}))
const bench = vi.hoisted(() => ({ open: false }))
vi.mock('../../store/useWorkshop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/useWorkshop')>()
  // The hook reads the bench here; the store's own methods stay for everything else.
  return { ...actual, useWorkshop: Object.assign((sel: (s: { open: boolean }) => unknown) => sel(bench), actual.useWorkshop) }
})

const { FrameDriver } = await import('../frameDriver')

/** The display: frame callbacks queued, run by `frame(t)` at time t, with performance.now at t too. */
let now = 0
let queue = new Map<number, (t: number) => void>()
let id = 0
const frame = (t: number): void => {
  now = t
  const run = queue
  queue = new Map()
  for (const cb of run.values()) cb(t)
}
const listening = { addEventListener: () => {}, removeEventListener: () => {} }
const saved = { window: (globalThis as { window?: unknown }).window, document: (globalThis as { document?: unknown }).document }

beforeAll(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (t: number) => void) => { queue.set(++id, cb); return id }
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (i: number) => { queue.delete(i) }
  ;(globalThis as { window?: unknown }).window = listening
  ;(globalThis as { document?: unknown }).document = listening
})
afterAll(() => {
  vi.restoreAllMocks()
  ;(globalThis as { window?: unknown }).window = saved.window
  ;(globalThis as { document?: unknown }).document = saved.document
})

function render(): void {
  ei = 0
  ri = 0
  pending = []
  FrameDriver()
  for (const run of pending) run()
}

describe('the scene clock across the workshop', () => {
  it('runs with the display while drawing, stops while covered, and goes on from where it stopped', () => {
    now = 10_000
    render()
    // Awake from the start: every frame drawn, the scene's time is the display's.
    for (let t = 10_016; t <= 10_160; t += 16) frame(t)
    const before = fiber.advanced.at(-1)!
    expect(before).toBeCloseTo(0.16, 5)

    // The bench opens: nothing is drawn under it.
    bench.open = true
    render()
    const drawn = fiber.advanced.length
    for (let t = 10_176; t < 70_000; t += 1000) frame(t)
    expect(fiber.advanced.length).toBe(drawn)

    // A minute later it closes: the next frame is one frame on, not a minute on.
    bench.open = false
    now = 70_160
    render()
    frame(70_176)
    expect(fiber.advanced.at(-1)! - before).toBeCloseTo(0.016, 5)
    for (let t = 70_192; t <= 70_320; t += 16) frame(t)
    expect(fiber.advanced.at(-1)! - before).toBeCloseTo(0.16, 5)
  })
})
