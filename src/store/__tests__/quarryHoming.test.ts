/**
 * quarryHoming.test.ts - the Quarry Charge's drops fly to you (owner,
 * 2026-11-28: "we need the floating collectible blocks to heat seek the
 * player within 7 gibsons"; store/quarryHoming.ts, lib/terrain/quarry.ts):
 *
 * - a drop sets off at 7 gibsons and not at 7.1, and one further away floats
 *   as it did until you come within 7;
 * - a cloud streams in: the nearer first, each at its own moment;
 * - every drop is carried exactly once, whether its flight or the walk
 *   passing over it gets there first, with gravity on or off;
 * - with reduced motion a drop does not fly: it fades where it is, quickly;
 * - only the drops' owner draws them in.
 */

import 'fake-indexeddb/auto'
import inspector from 'node:inspector'
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  publish: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { offsetOf, setTerrainSession, terrainSession, useTerrain } from '../useTerrain'
import { useQuarry } from '../useQuarry'
import { dropsFlying, flights, idleHoming, readBody, resetHoming, tickHoming } from '../quarryHoming'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import { HOME_RADIUS, HOME_REDUCED_MS, HOME_STAGGER_MS, flightMs, flightShare, flown, homeDelay, homesFrom, makeDrop, type Drop } from '../../lib/terrain/quarry'
import { walkGlide } from '../../lib/walkEye'
import type { Position } from '../../lib/space'

const post = <T>(s: inspector.Session, method: string, params?: object): Promise<T> =>
  new Promise((resolve, reject) => { s.post(method, params as never, (e, r) => (e ? reject(e) : resolve(r as T))) })
interface SampledNode { selfSize: number; children: SampledNode[] }
/** What `run` allocated in KB, by V8's sampling heap profiler (as frameAlloc.test.ts measures). */
async function allocatedKb(run: () => void): Promise<number> {
  const s = new inspector.Session()
  s.connect()
  try {
    await post(s, 'HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
    run()
    const { profile } = await post<{ profile: { head: SampledNode } }>(s, 'HeapProfiler.stopSampling')
    const sum = (n: SampledNode): number => n.selfSize + n.children.reduce((t, c) => t + sum(c), 0)
    return sum(profile.head) / 1024
  } finally {
    s.disconnect()
  }
}

let run = 0
let A = ''
const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const Q = () => useQuarry.getState()
const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

function as(pubkey: string, at: Position = HEAD): void {
  useCyberspace.setState({ identity: { pubkey, npub: '' }, position: { ...at }, cursor: { ...at }, anchor: { ...at }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null, live: false })
}

async function openSurveyed(): Promise<void> {
  await T().enter()
  const key = chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))
  if (!terrainSession!.world.slotByKey(key)?.surveyed) await T().survey(key)
  await settle()
}

/** Where your feet are (cs offsets in the field). */
const feet = (): [number, number, number] => offsetOf(terrainSession!, useCyberspace.getState().cursor)
/** The body's middle as the walk reads it, at rest (lib quarryHoming readBody). */
const body = (): { x: number; y: number; z: number } => { const f = feet(); return { x: f[0] + 0.5, y: f[1] + 1, z: f[2] + 0.5 } }

/** Drops of kind `id` in these cells (offsets from your feet), put among the drops as a blast would. */
function dropsAt(cells: Array<readonly [number, number, number]>, id = 5): Drop[] {
  const s = terrainSession!
  const o = s.world.origin
  const f = feet()
  const now = Date.now()
  const made = cells.map((c) => makeDrop(o.x + BigInt(f[0] + c[0]), o.y + BigInt(f[1] + c[1]), o.z + BigInt(f[2] + c[2]), 0, id, now))
  useQuarry.setState({ owner: s.owner, drops: [...Q().drops, ...made], version: Q().version + 1 })
  return made
}

/** The body moved so a drop at `cell` (offset from your feet) is exactly `d` gibsons away along x, level with it. */
function bodyAt(cell: readonly [number, number, number], d: number): { x: number; y: number; z: number } {
  const f = feet()
  return { x: f[0] + cell[0] + 0.5 - d, y: f[1] + cell[1] + 0.5, z: f[2] + cell[2] + 0.5 }
}

const carried = (id = 5): number => T().inventory.counts[id] ?? 0

beforeEach(async () => {
  if (T().active) await T().exit()
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  run++
  A = run.toString(16).padStart(64, 'e')
  useWalk.setState({ gravity: false })
  useQuarry.setState({ charges: [], drops: [], owner: '', version: 0, tally: { placed: 0, quarried: 0 } })
  resetHoming()
  as(A)
  await openSurveyed()
})

describe('the flight (lib/terrain/quarry.ts)', () => {
  it('7 gibsons is within reach, 7.1 is not', () => {
    expect(HOME_RADIUS).toBe(7)
    expect(homesFrom(7)).toBe(true)
    expect(homesFrom(6.99)).toBe(true)
    expect(homesFrom(7.1)).toBe(false)
    expect(homesFrom(7.0001)).toBe(false)
  })

  it('speeds up smoothly to a top speed, and arrives exactly when its share reaches 1', () => {
    // Ease in: the first half of the time covers well under half the way.
    const ms = flightMs(7)
    expect(flown(ms / 2)).toBeLessThan(3.5)
    expect(flightShare(ms, 7)).toBe(1)
    expect(flightShare(ms - 5, 7)).toBeLessThan(1)
    expect(flightShare(0, 7)).toBe(0)
    // Steady at the top speed once reached: equal times, equal ways.
    expect(flown(2000) - flown(1900)).toBeCloseTo(flown(1900) - flown(1800), 6)
    // The farthest takes under a second; one at arm's length, a blink.
    expect(ms).toBeLessThan(1000)
    expect(flightMs(1)).toBeLessThan(300)
  })
})

describe('setting off', () => {
  it('a drop exactly 7 gibsons away sets off; one 7.1 away does not', () => {
    const cell = [2, 0, 0] as const
    const [d] = dropsAt([cell])
    tickHoming(Date.now(), false, bodyAt(cell, 7.1))
    expect(flights.has(d)).toBe(false)
    tickHoming(Date.now(), false, bodyAt(cell, 7))
    expect(flights.has(d)).toBe(true)
    expect(flights.get(d)!.len).toBeCloseTo(7, 9)
  })

  it('drops beyond 7 float as they were, untouched, and set off once you come within 7', () => {
    const [far] = dropsAt([[9, 0, 0]])
    const t0 = Date.now()
    for (let t = 0; t <= 20_000; t += 500) expect(tickHoming(t0 + t, false, body())).toBe(0)
    expect(flights.size).toBe(0)
    expect(Q().drops).toContain(far)
    expect(carried()).toBe(0)
    // Two steps nearer: 7 gibsons along x, level.
    tickHoming(t0 + 20_500, false, { ...body(), x: body().x + 2, y: body().y - 0.5 })
    expect(flights.has(far)).toBe(true)
  })

  it('a cloud streams in: each drop sets off at its own moment, the nearer sooner, within HOME_STAGGER_MS', () => {
    const cells: Array<[number, number, number]> = []
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = -2; y <= 2; y++) if (x || y || z) cells.push([x, y, z])
    const made = dropsAt(cells)
    const now = Date.now()
    tickHoming(now, false, body())
    expect(flights.size).toBe(made.length)
    const starts = made.map((d) => flights.get(d)!.start - now)
    for (const s of starts) { expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThanOrEqual(HOME_STAGGER_MS) }
    // Many different moments, spread over most of the stagger: not one block moving together.
    expect(new Set(starts.map((s) => Math.round(s))).size).toBeGreaterThan(made.length / 3)
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(HOME_STAGGER_MS / 2)
    // The nearer half sets off sooner, on the whole, than the farther half.
    const byLen = made.map((d) => flights.get(d)!).sort((a, b) => a.len - b.len)
    const mean = (l: typeof byLen): number => l.reduce((t, f) => t + f.start, 0) / l.length
    expect(mean(byLen.slice(0, byLen.length / 2))).toBeLessThan(mean(byLen.slice(byLen.length / 2)))
    // And it arrives as a stream: some carried partway through, all by the end.
    const half = tickHoming(now + 350, false, body())
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(made.length)
    tickHoming(now + 5000, false, body())
    expect(carried()).toBe(made.length)
    expect(Q().drops).toHaveLength(0)
    expect(flights.size).toBe(0)
  })

  it('a stagger is never longer than HOME_STAGGER_MS, nearer is sooner for the same chance, and none with reduced motion', () => {
    expect(homeDelay(7, 1)).toBeLessThanOrEqual(HOME_STAGGER_MS)
    expect(homeDelay(1, 0.5)).toBeLessThan(homeDelay(6, 0.5))
    expect(homeDelay(6, 0.9, true)).toBe(0)
  })

  it('only the drops\' owner draws them in: another identity on screen, and none sets off', () => {
    const [d] = dropsAt([[2, 0, 0]])
    as('f'.repeat(64))
    tickHoming(Date.now(), false, body())
    expect(flights.has(d)).toBe(false)
  })
})

describe('carried exactly once', () => {
  for (const gravity of [false, true]) {
    it(`the flight arriving carries it once; the walk passing over it after carries nothing more (gravity ${gravity ? 'on' : 'off'})`, () => {
      useWalk.setState({ gravity })
      const cell = [3, 0, 0] as const
      const [d] = dropsAt([cell])
      const now = Date.now()
      tickHoming(now, false, body())
      const f = flights.get(d)!
      expect(tickHoming(f.arrive - 1, false, body())).toBe(0)
      expect(carried()).toBe(0)
      expect(tickHoming(f.arrive, false, body())).toBe(1)
      expect(carried()).toBe(1)
      // Walking over its cell now, and asking again by the drop itself: nothing more.
      const o = terrainSession!.world.origin
      const ft = feet()
      const at = { x: o.x + BigInt(ft[0] + cell[0]), y: o.y + BigInt(ft[1] + cell[1]), z: o.z + BigInt(ft[2] + cell[2]) }
      useCyberspace.setState({ position: at, cursor: at })
      expect(Q().collectDrops([d])).toBe(0)
      expect(tickHoming(f.arrive + 1000, false, body())).toBe(0)
      expect(carried()).toBe(1)
    })

    it(`the walk passing over it mid-flight carries it once; its arrival after carries nothing more (gravity ${gravity ? 'on' : 'off'})`, () => {
      useWalk.setState({ gravity })
      const cell = [3, 0, 0] as const
      const [d, other] = dropsAt([cell, [-2, 0, 1]])
      const now = Date.now()
      tickHoming(now, false, body())
      const f = flights.get(d)!
      const o = terrainSession!.world.origin
      const ft = feet()
      const at = { x: o.x + BigInt(ft[0] + cell[0]), y: o.y + BigInt(ft[1] + cell[1]), z: o.z + BigInt(ft[2] + cell[2]) }
      useCyberspace.setState({ position: at, cursor: at })
      expect(Q().drops).not.toContain(d)
      expect(carried()).toBe(1)
      // Its flight is let go, and its arrival time carries only the other drop's.
      tickHoming(f.arrive, false, body())
      expect(flights.has(d)).toBe(false)
      tickHoming(now + 5000, false, body())
      expect(Q().drops).not.toContain(other)
      expect(carried()).toBe(2)
    })
  }

  it('the walk taking the last drop mid-flight leaves nothing flying: the frame driver is not kept busy (review)', () => {
    const cell = [3, 0, 0] as const
    const [d] = dropsAt([cell])
    tickHoming(Date.now(), false, body())
    expect(dropsFlying()).toBe(true)
    const o = terrainSession!.world.origin
    const ft = feet()
    const at = { x: o.x + BigInt(ft[0] + cell[0]), y: o.y + BigInt(ft[1] + cell[1]), z: o.z + BigInt(ft[2] + cell[2]) }
    useCyberspace.setState({ position: at, cursor: at })
    expect(Q().drops).not.toContain(d)
    expect(carried()).toBe(1)
    expect(dropsFlying()).toBe(false)
    // And the scene, finding no drops, lets the flight go (scene/QuarryFx.tsx).
    idleHoming()
    expect(flights.size).toBe(0)
  })

  it('nothing drawing them (zoomed out, another plane): the flights are let go, the drops kept, and they set off again when drawn', () => {
    const made = dropsAt([[3, 0, 0], [-2, 1, 0]])
    tickHoming(Date.now(), false, body())
    expect(flights.size).toBe(2)
    idleHoming()
    expect(flights.size).toBe(0)
    expect(Q().drops).toEqual(made)
    tickHoming(Date.now(), false, body())
    expect(flights.size).toBe(2)
    tickHoming(Date.now() + 5000, false, body())
    expect(carried()).toBe(2)
  })

  it('asked for the same drop twice in one call, or twice over, it is carried once', () => {
    const [d] = dropsAt([[2, 0, 0]])
    expect(Q().collectDrops([d, d])).toBe(1)
    expect(Q().collectDrops([d])).toBe(0)
    expect(carried()).toBe(1)
  })
})

describe('every frame', () => {
  it('a full blast\'s 343 drops, some flying and some out of reach, cost a frame nothing to tick', async () => {
    const cells: Array<[number, number, number]> = []
    for (let y = 0; y < 7; y++) for (let z = 0; z < 7; z++) for (let x = 0; x < 7; x++) cells.push([x + 5, y - 3, z - 3])
    dropsAt(cells)
    const now = Date.now()
    // Some within 7 and many not; those within set off and are a long way from arriving. The body read from the walk.
    tickHoming(now, false)
    expect(flights.size).toBeGreaterThan(0)
    expect(flights.size).toBeLessThan(343)
    const frame = (): void => { tickHoming(now + 1, false) }
    await allocatedKb(() => { for (let i = 0; i < 3000; i++) frame() })
    const kb = await allocatedKb(() => { for (let i = 0; i < 3000; i++) frame() })
    expect((kb * 1024) / 3000).toBeLessThan(64)
    expect(Q().drops).toHaveLength(343)
  })
})

describe('reduced motion', () => {
  it('a drop does not fly or wait: it fades where it is over HOME_REDUCED_MS, then is carried', () => {
    const made = dropsAt([[3, 0, 0], [-5, 1, 2], [1, -1, -4]])
    const now = Date.now()
    tickHoming(now, true, body())
    for (const d of made) {
      const f = flights.get(d)!
      expect(f.reduced).toBe(true)
      expect(f.start).toBe(now)
      expect(f.arrive).toBe(now + HOME_REDUCED_MS)
    }
    expect(HOME_REDUCED_MS).toBeLessThanOrEqual(200)
    expect(flightShare(HOME_REDUCED_MS / 2, 6, true)).toBeCloseTo(0.5)
    expect(tickHoming(now + HOME_REDUCED_MS - 1, true, body())).toBe(0)
    expect(tickHoming(now + HOME_REDUCED_MS, true, body())).toBe(3)
    expect(carried()).toBe(3)
  })
})

describe('where the body is', () => {
  it('at rest: the middle of the feet\'s cell and the one over it; fluid WALK moves it by its glide', () => {
    const s = terrainSession!
    const out = { x: 0, y: 0, z: 0 }
    readBody(s, out)
    expect(out).toEqual(body())
    useCyberspace.setState({ walking: true })
    Object.assign(walkGlide, { active: true, exact: true, x: 0.25, y: -0.5, z: 0 })
    try {
      readBody(s, out)
      expect(out.x).toBeCloseTo(body().x + 0.25)
      expect(out.y).toBeCloseTo(body().y - 0.5)
    } finally {
      Object.assign(walkGlide, { active: false, exact: false, x: 0, y: 0, z: 0 })
      useCyberspace.setState({ walking: false })
    }
  })
})
