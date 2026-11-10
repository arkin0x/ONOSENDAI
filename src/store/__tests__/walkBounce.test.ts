/**
 * walkBounce.test.ts - BOUNCE in WALK, EXPERIMENTAL (store/useWalk.ts (E),
 * lib/walkBounce.ts; arkinox, 2026-11-10). With gravity on, a landing on the
 * top of an object whose payload has `bounce` launches the walker: to that
 * many gibsons, or with "reflect" back to the height it fell from, at most
 * 24, and a jump just before landing adds 3. Side faces, gravity off and a
 * bad field never launch. Bouncing in place publishes nothing, however long
 * it goes on, as a jump in place does; a bounce onto a higher ledge is one
 * hop, as a jump onto one is; a fall onto a pad is one hop for the landing,
 * and nothing after it.
 */
import { provedFor } from '../fixtures/provedHop'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

const posted: Array<{ id: number; mode: string; from: { x: bigint; y: bigint; z: bigint }; to: { x: bigint; y: bigint; z: bigint } }> = []
vi.mock('../../lib/workers', () => ({
  postProof: vi.fn((req: (typeof posted)[number]) => { posted.push(req) }),
  cancelProof: vi.fn(),
  setProofHandler: vi.fn(),
}))
/** The machine's hop ceiling, which sets the walk's segment budget (h <= hopHeight - 3 here). */
const ceiling = vi.hoisted(() => ({ hopHeight: 40 }))
vi.mock('../../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => ceiling.hopHeight }
})
vi.mock('../../lib/relay', async (orig) => {
  const mod = await orig<typeof import('../../lib/relay')>()
  // Offline under these overrides too: no live relay is ever asked (src/test/offlineRelay.ts).
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { BOUNCE_BOOST_MS, fallState, tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'
import { clearWalls } from '../walkWalls'
import { JUMP_SPEED, WALK_GRAVITY } from '../walkGravity'
import { walkFall } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'

/** Right +X, up +Y, toward the camera +Z: 'away' walks -Z. */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

const worldItemsOriginal = useShards.getState().worldItems

type V3 = [number, number, number]

/** Closed boxes from `lo` to `hi`, in gibsons from the shard's origin, at unit 0 (as walkStep.test.ts builds them). */
function boxes(name: string, c: Constrain, list: Array<[V3, V3]>): ShardModel {
  const vertices: ShardModel['vertices'] = []
  const faces: Array<[number, number, number]> = []
  for (const [lo, hi] of list) {
    const base = vertices.length
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      const t = [x, y, z].map((v) => Math.round(v * 120))
      const p = t.map((v) => Math.floor(v / 120)) as V3
      const r = t.map((v, n) => v - p[n] * 120) as V3
      vertices.push(r.some((v) => v !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] })
    }
    for (const [a, b, cc, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
      faces.push([base + a, base + b, base + cc], [base + a, base + cc, base + d])
    }
  }
  return withConstrain({ ...newShard(name), mode: 'solid', vertices, faces }, c)
}

/** The world holds exactly these shards, each with its origin `o` gibsons from `start`. */
function world(start: Position, ...placed: Array<[ShardModel, V3]>): WorldItem[] {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = placed.map(([shard, o], n) => ({
    key: `w${n}-${shard.id}`, type: 'shard', at: { x: start.x + BigInt(o[0]), y: start.y + BigInt(o[1]), z: start.z + BigInt(o[2]) }, plane, height: 84, mine: false, shard,
  }))
  useShards.setState({ worldItems: () => items })
  return items
}

/**
 * A ledge whose top is 1 under the walker, ending half a gibson behind it
 * (-Z), and a floor `drop` further down that runs on past the edge. 'away'

/** `s` with a `bounce` in its payload, as sno-core carries a field it does not know. */
function bouncy(s: ShardModel, bounce: unknown): ShardModel {
  return { ...s, extra: { ...s.extra, bounce } }
}

/** A floor under the walker, its top 1 below. */
const FLOOR: [V3, V3] = [[-10, -1, -10], [10, 0, 10]]
/** A ledge whose top is 1 under the walker, ending half a gibson behind it (-Z). */
const LEDGE: [V3, V3] = [[-10, -1, -0.5], [10, 0, 10]]
/** A floor `drop` further down than LEDGE, running on past its edge. */
const lowFloor = (drop: number): [V3, V3] => [[-10, -drop - 1, -20], [10, -drop, 10]]

function at(start: Position, p: Position = useCyberspace.getState().cursor): V3 {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

/** Land the newest proof, and wait for the next one when one is due. */
async function land(): Promise<void> {
  const before = posted.length
  await useCyberspace.getState().applyProofMessage(done(posted[posted.length - 1]))
  if (useWalk.getState().queue.length > 0) await vi.waitFor(() => expect(posted.length).toBe(before + 1))
}

let clock = 1_000_000
function frame(ms: number): boolean {
  clock += ms
  return tickFall()
}
function fallOut(maxMs = 120_000): void {
  for (let t = 0; t < maxMs && fallState(); t += 16) frame(16)
}
/** The highest the eye goes over `ms` of 16 ms frames, from where the arc's hop starts. */
function peakOver(ms: number): number {
  let peak = -Infinity
  for (let t = 0; t < ms; t += 16) { frame(16); if (walkFall.active) peak = Math.max(peak, walkFall.offset) }
  return peak
}
/** Frames until the fall is on a bounce's arc (faster than a jump), at most `maxMs`. */
function untilBounce(maxMs = 10_000): void {
  for (let t = 0; t < maxMs && fallState() && fallState()!.v0 <= JUMP_SPEED + 1e-9; t += 16) frame(16)
}

let start: Position

beforeEach(async () => {
  posted.length = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  ceiling.hopHeight = 40
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useShards.setState({ worldItems: worldItemsOriginal })
  useWorkshop.setState({ open: false })
  clearWalls()
  useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0, view: canonicalQuaternion() })
  await useCyberspace.getState().respawn()
  useCyberspace.getState().cancel()
  useCalibration.setState({ cantorMsByHeight: undefined })
  useToast.setState({ toast: null })
  start = { ...useCyberspace.getState().position }
})

afterEach(() => {
  vi.restoreAllMocks()
})

function walk(gravity: boolean): void {
  useWalk.getState().setGravity(gravity)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
}

/** Nothing queued, open, proving or posted. */
function nothingMade(): void {
  expect(useWalk.getState()).toMatchObject({ queue: [], open: null, behind: 0 })
  expect(posted).toHaveLength(0)
}

describe('a fixed bounce', () => {
  it('a jump onto the pad launches to about its height, keeps bouncing, and publishes nothing', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 8), 6)
    const peak = peakOver(1500)
    expect(Math.abs(peak - 8)).toBeLessThan(1)
    expect(peak).toBeLessThanOrEqual(8)
    // Still bouncing ten seconds on, and none of it made anything or touched either store.
    let touched = 0
    const offWalk = useWalk.subscribe(() => { touched++ })
    const offCs = useCyberspace.subscribe(() => { touched++ })
    for (let t = 0; t < 10_000; t += 16) frame(16)
    offWalk()
    offCs()
    expect(touched).toBe(0)
    expect(useWalk.getState().falling).toBe(true)
    expect(useCyberspace.getState().cursor).toEqual(start)
    nothingMade()
  })

  it('a long gap between frames never shortens the bounce: the arc restarts when it met the pad', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    // The jump lands at 600 ms; the frame comes 100 ms late.
    frame(700)
    const f = fallState()!
    expect(f.v0).toBeGreaterThan(JUMP_SPEED)
    expect(f.t0).toBeCloseTo(clock - 100, 6)
  })

  it('a fall onto the pad is one hop for the landing, and nothing after it', async () => {
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]], [bouncy(boxes('Pad', 'all', [lowFloor(6)]), 4), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    const off = { ...start, z: start.z - 1n }
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await land()
    untilBounce()
    const landing = { ...off, y: start.y - 6n }
    expect(useCyberspace.getState().cursor).toEqual(landing)
    expect(useWalk.getState().queue).toEqual([landing])
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]).toMatchObject({ from: off, to: landing })
    await land()
    // Bouncing at 4 over the landing, again and again: nothing more.
    expect(Math.abs(peakOver(1500) - 4)).toBeLessThan(1)
    for (let t = 0; t < 10_000; t += 16) frame(16)
    expect(useWalk.getState().falling).toBe(true)
    expect(posted).toHaveLength(2)
    expect(useWalk.getState()).toMatchObject({ queue: [], behind: 0 })
  })

  it('a bounce onto a higher ledge is one hop, as a jump onto one is', async () => {
    // The pad under the walker, and a ledge from 1 ahead whose top is 5 up: standing on it is 6 up.
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]], [boxes('Ledge', 'all', [[[-10, 5, -10], [10, 6, -0.5]]]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    // Coming down through 5.5, it has been at 6: a press over the ledge goes onto its top.
    let last = walkFall.offset
    for (let t = 0; t < 3000; t += 16) {
      frame(16)
      const now = walkFall.offset
      if (now < last && now > 5 && now <= 6) break
      last = now
    }
    useWalk.getState().press('away')
    const top = { ...start, y: start.y + 6n, z: start.z - 1n }
    expect(useCyberspace.getState().cursor).toEqual(top)
    fallOut()
    expect(useWalk.getState().falling).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(top)
    expect(useWalk.getState().queue).toEqual([top])
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: top })
    await land()
    expect(useCyberspace.getState().events).toHaveLength(2)
  })

  it('a jump just before landing adds 3', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    // The jump lands at 600 ms: Up within BOUNCE_BOOST_MS of it.
    frame(600 - BOUNCE_BOOST_MS + 50)
    useWalk.getState().press('up')
    untilBounce()
    expect(Math.abs(peakOver(1500) - 11)).toBeLessThan(1)
    nothingMade()
  })

  it('an Up long before landing adds nothing', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(100)
    useWalk.getState().press('up')
    untilBounce()
    expect(Math.abs(peakOver(1500) - 8)).toBeLessThan(1)
  })
})

describe('what never bounces', () => {
  it('a side face: walking into a bounce block, or jumping against it, lands on the plain floor', () => {
    // A plain floor, and a bounce block from 1 ahead, 6 tall: a wall.
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]], [bouncy(boxes('Block', 'all', [[[-10, 0, -10], [10, 6, -0.5]]]), 12), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, 0])
    expect(useWalk.getState().falling).toBe(false)
    useWalk.getState().press('up')
    frame(150)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, 0])
    fallOut()
    expect(useWalk.getState().falling).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(start)
    nothingMade()
  })

  it('gravity off: no fall and no launch, on the pad or onto it', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(false)
    useWalk.getState().press('up')
    expect(fallState()).toBeNull()
    expect(at(start)).toEqual([0, 1, 0])
    useWalk.getState().press('down')
    expect(fallState()).toBeNull()
    expect(at(start)).toEqual([0, 0, 0])
    frame(2000)
    expect(useWalk.getState().falling).toBe(false)
  })

  it('gravity off mid-bounce ends it where it is, one hop there, as any fall', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    for (let t = 0; t < 2000 && walkFall.offset < 4; t += 16) frame(16)
    useWalk.getState().setGravity(false)
    expect(fallState()).toBeNull()
    const q = useWalk.getState().queue
    expect(q).toHaveLength(1)
    expect(q[0].y > start.y).toBe(true)
  })

  it('a bad field is ignored: the jump just lands', () => {
    for (const bad of [0, 25, -3, 2.5, '8', 'Reflect', 'bounce', null, true]) {
      clearWalls()
      world(start, [bouncy(boxes(`Pad ${String(bad)}`, 'all', [FLOOR]), bad), [0, -1, 0]])
      walk(true)
      useWalk.getState().press('up')
      fallOut()
      expect(useWalk.getState().falling).toBe(false)
      expect(useCyberspace.getState().cursor).toEqual(start)
      useWalk.getState().exit()
    }
    expect(posted).toHaveLength(0)
  })

  it('a pad set to OFF has no face to land on: you fall through it', () => {
    world(start, [bouncy(boxes('Pad', 'off', [FLOOR]), 8), [0, -1, 0]], [boxes('Floor', 'all', [lowFloor(10)]), [0, -1, 0]])
    walk(true)
    fallOut()
    expect(at(start)).toEqual([0, -10, 0])
    expect(useWalk.getState().falling).toBe(false)
  })
})

describe('reflect', () => {
  it('a 5-gibson drop bounces back to about 5, and on forever, publishing nothing after the landing', async () => {
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]], [bouncy(boxes('Pad', 'all', [lowFloor(5)]), 'reflect'), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    const off = { ...start, z: start.z - 1n }
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await land()
    untilBounce(3000)
    // A drop of 5 lands at sqrt(2 g 5), about 25.8 gibsons/s, and goes back up at it.
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 5), 6)
    const landing = { ...off, y: start.y - 5n }
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]).toMatchObject({ from: off, to: landing })
    await land()
    for (let n = 0; n < 5; n++) {
      const peak = peakOver(1100)
      expect(Math.abs(peak - 5)).toBeLessThan(1)
    }
    for (let t = 0; t < 10_000; t += 16) frame(16)
    expect(useWalk.getState().falling).toBe(true)
    expect(posted).toHaveLength(2)
    expect(useWalk.getState()).toMatchObject({ queue: [], behind: 0 })
  })

  it('a jump in place on a reflect pad bounces at 3 forever and publishes nothing', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 'reflect'), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(300)
    for (let n = 0; n < 5; n++) expect(Math.abs(peakOver(600) - 3)).toBeLessThan(1)
    for (let t = 0; t < 10_000; t += 16) frame(16)
    expect(useWalk.getState().falling).toBe(true)
    expect(useCyberspace.getState().cursor).toEqual(start)
    nothingMade()
  })

  it('a 40-gibson fall bounces back to 24 at most', () => {
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]], [bouncy(boxes('Pad', 'all', [lowFloor(40)]), 'reflect'), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    untilBounce(5000)
    const peak = peakOver(2500)
    expect(peak).toBeLessThanOrEqual(24)
    expect(peak).toBeGreaterThan(23)
    // And it stays at 24: reflecting a 24 is 24.
    expect(Math.abs(peakOver(2000) - 24)).toBeLessThan(1)
  })

  it('reflect plus a jump on landing adds 3', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 'reflect'), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(600 - BOUNCE_BOOST_MS + 50)
    useWalk.getState().press('up')
    frame(BOUNCE_BOOST_MS)
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 6), 6)
    expect(Math.abs(peakOver(900) - 6)).toBeLessThan(1)
    nothingMade()
  })
})
