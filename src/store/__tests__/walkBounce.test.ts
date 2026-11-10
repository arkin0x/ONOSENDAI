/**
 * walkBounce.test.ts - BOUNCE in WALK, EXPERIMENTAL (store/useWalk.ts (E),
 * lib/walkBounce.ts; arkinox, 2026-11-10). With gravity on, a landing on the
 * top of an object whose payload has `bounce` launches the walker: to that
 * many gibsons, or with "reflect" back to the height it fell from, at most
 * 24, and a jump just before landing adds 3. Side faces, gravity off and a
 * bad field never launch. A step up onto a fixed pad launches as a landing
 * would; onto a reflect pad it does nothing. Bouncing in place publishes
 * nothing, however long it goes on, as a jump in place does; a bounce onto
 * a higher ledge is one hop, as a jump onto one is; a fall onto a pad is one
 * hop for the landing, and nothing after it. Steering while bouncing is one
 * hop a landing, straight from the landing before; Down absorbs a bounce;
 * the walls are fetched fresh at every landing.
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
import { anyBounce, clearWalls, padQueries } from '../walkWalls'
import { JUMP_HANG_S, JUMP_SPEED, WALK_GRAVITY } from '../walkGravity'

/** When a jump in place comes back down, in ms: about 775 (a jump of 5; it was 600 at 3). */
const LANDS_MS = JUMP_HANG_S * 1000
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
    // The jump lands at LANDS_MS; the frame comes 100 ms late.
    frame(LANDS_MS + 100)
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

  it('a jump just before landing adds JUMP_HEIGHT, 5', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    // The jump lands at LANDS_MS: Up within BOUNCE_BOOST_MS of it.
    frame(LANDS_MS - BOUNCE_BOOST_MS + 50)
    useWalk.getState().press('up')
    untilBounce()
    expect(Math.abs(peakOver(1500) - 13)).toBeLessThan(1)
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

describe('a step up onto a pad (ruling of 2026-11-10)', () => {
  /** A plain floor, and a pad from 1 ahead whose top is 1 up: a riser the step-up climbs. */
  const PAD_TOP: [V3, V3] = [[-10, 0, -10], [10, 1, -0.5]]

  it('onto a fixed pad of 6: the step is one hop, the launch goes to about 6, and bouncing on makes nothing', async () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]], [bouncy(boxes('Pad', 'all', [PAD_TOP]), 6), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    const top = { ...start, y: start.y + 1n, z: start.z - 1n }
    expect(useCyberspace.getState().cursor).toEqual(top)
    expect(useWalk.getState().falling).toBe(true)
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 6), 6)
    // The step's segment closed where the launch began: a normal hop, proved now.
    expect(useWalk.getState().queue).toEqual([top])
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: top })
    await land()
    for (let n = 0; n < 3; n++) expect(Math.abs(peakOver(900) - 6)).toBeLessThan(1)
    for (let t = 0; t < 10_000; t += 16) frame(16)
    expect(useWalk.getState().falling).toBe(true)
    expect(useCyberspace.getState().cursor).toEqual(top)
    expect(posted).toHaveLength(1)
    expect(useWalk.getState()).toMatchObject({ queue: [], open: null, behind: 0 })
  })

  it('onto a reflect pad: nothing, it fell from nowhere; you stand on it as on any step', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]], [bouncy(boxes('Pad', 'all', [PAD_TOP]), 'reflect'), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 1, -1])
    expect(useWalk.getState().falling).toBe(false)
    expect(fallState()).toBeNull()
  })

  it('walking level along a plain floor next to nothing launches nothing', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, -1])
    expect(useWalk.getState().falling).toBe(false)
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

  it('a jump in place on a reflect pad bounces at 5 forever and publishes nothing', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 'reflect'), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(400)
    for (let n = 0; n < 5; n++) expect(Math.abs(peakOver(Math.ceil(LANDS_MS)) - 5)).toBeLessThan(1)
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

  it('reflect plus a jump on landing adds JUMP_HEIGHT, 5', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 'reflect'), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(LANDS_MS - BOUNCE_BOOST_MS + 50)
    useWalk.getState().press('up')
    frame(BOUNCE_BOOST_MS)
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 10), 6)
    expect(Math.abs(peakOver(1200) - 10)).toBeLessThan(1)
    nothingMade()
  })
})

/** The tests that run many seconds of frames: room to finish under a loaded machine. */
const LONG_TEST_MS = 60_000

/** Every posted hop starts where the one before it ended. */
function chainOk(): void {
  for (let n = 1; n < posted.length; n++) expect(posted[n].from).toEqual(posted[n - 1].to)
}
/** Land every proof that comes, until the head is where the last one went. */
async function landAll(maxRounds = 50): Promise<void> {
  for (let r = 0; r < maxRounds; r++) {
    if (posted.length === 0) return
    const last = posted[posted.length - 1]
    const pos = useCyberspace.getState().position
    if (pos.x === last.to.x && pos.y === last.to.y && pos.z === last.to.z) return
    await land()
  }
}
/** Frames until the arc is coming down and due on the floor within `ms`. */
function untilLandingIn(ms: number, maxMs = 5000): void {
  const due = (): number => { const f = fallState()!; return f.t0 + ((f.v0 + Math.sqrt(f.v0 * f.v0 - 2 * WALK_GRAVITY * f.bottomN)) / WALK_GRAVITY) * 1000 }
  for (let t = 0; t < maxMs && fallState() && due() - clock > ms; t += 16) frame(16)
}
/** How many hops `fn` queues. */
function queuedBy(fn: () => void): number {
  let queued = 0
  let prev = useWalk.getState().queue.length
  const off = useWalk.subscribe((s) => { if (s.queue.length > prev) queued += s.queue.length - prev; prev = s.queue.length })
  fn()
  off()
  return queued
}

describe('Down absorbs (D5)', () => {
  it('Down just before the landing: it lands and stands, and nothing is made', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    // The jump reaches the pad at LANDS_MS.
    frame(LANDS_MS - 10)
    useWalk.getState().press('down')
    frame(30)
    expect(useWalk.getState().falling).toBe(false)
    expect(fallState()).toBeNull()
    expect(useCyberspace.getState().cursor).toEqual(start)
    nothingMade()
  })

  it('Down long before the landing does nothing; of Down and Up, the later wins', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(100)
    useWalk.getState().press('down')
    untilBounce()
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 8), 6)
    useWalk.getState().exit()
    clearWalls()
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(LANDS_MS - 150)
    useWalk.getState().press('down')
    frame(50)
    useWalk.getState().press('up')
    untilBounce()
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 13), 6)
  })

  it('a step up into a narrow shaft onto a pad: walls hold every steer, Down lets you out', async () => {
    // A 1-wide nook 1 ahead: a pad of 6 whose top is 1 up, walls 30 tall either side and behind.
    world(
      start,
      [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]],
      [bouncy(boxes('Pad', 'all', [[[-0.5, 0, -1.5], [0.5, 1, -0.5]]]), 6), [0, -1, 0]],
      [boxes('Shaft', 'all', [[[-1.5, 0, -1.5], [-0.5, 30, -0.5]], [[0.5, 0, -1.5], [1.5, 30, -0.5]], [[-1.5, 0, -2.5], [1.5, 30, -1.5]]]), [0, -1, 0]],
    )
    walk(true)
    useWalk.getState().press('away')
    const top = { ...start, y: start.y + 1n, z: start.z - 1n }
    expect(useCyberspace.getState().cursor).toEqual(top)
    expect(useWalk.getState().falling).toBe(true)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await land()
    // Bouncing in the nook: left, right and on are walls.
    for (let n = 0; n < 3; n++) {
      for (let t = 0; t < 300; t += 16) frame(16)
      for (const k of ['left', 'right', 'away'] as const) useWalk.getState().press(k)
    }
    expect(at(start, fallState()!.anchor)).toEqual([0, 1, -1])
    // Down as it comes down onto the pad: it lands, and stands.
    untilLandingIn(100)
    useWalk.getState().press('down')
    fallOut()
    expect(useWalk.getState().falling).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(top)
    expect(posted).toHaveLength(1)
    // And out: back down the step, a normal walk.
    useWalk.getState().press('toward')
    expect(at(start)).toEqual([0, 0, 0])
    expect(useWalk.getState().falling).toBe(false)
  })
})

describe('the Up and Down windows count from the landing, not the frame', () => {
  it('Up 200 ms before the landing boosts, though the frame that sees it is 100 ms late', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(LANDS_MS - 200)
    useWalk.getState().press('up')
    // One frame, 300 ms on: 100 ms past the landing at LANDS_MS, the Up 200 ms before it.
    frame(300)
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 13), 6)
  })
})

describe('walls a bounce meets', () => {
  it('a wall that loads mid-bounce holds the steers after the next landing', () => {
    const items = world(start, [bouncy(boxes('Pad', 'all', [[[-10, -1, -40], [10, 0, 10]]]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    for (let t = 0; t < 2000; t += 16) frame(16)
    // A wall arrives 2 ahead, from the pad up to 30.
    const plane = useCyberspace.getState().plane as WorldItem['plane']
    const wall: WorldItem = { key: 'wall', type: 'shard', at: { x: start.x, y: start.y - 1n, z: start.z }, plane, height: 84, mine: false, shard: boxes('Wall', 'all', [[[-10, 0, -3], [10, 30, -2]]]) }
    useShards.setState({ worldItems: () => [...items, wall] })
    // One whole bounce (just under a second at 8) for a landing to see it, then six steers into it.
    for (let t = 0; t < 1100; t += 16) frame(16)
    for (let k = 0; k < 6; k++) { for (let t = 0; t < 200; t += 16) frame(16); useWalk.getState().press('away') }
    expect(at(start, fallState()!.anchor)[2]).toBeGreaterThanOrEqual(-1)
    // Its walls stay built across bounces: nothing evicts them.
    for (let t = 0; t < 3000; t += 16) frame(16)
    useWalk.getState().press('away')
    expect(at(start, fallState()!.anchor)[2]).toBeGreaterThanOrEqual(-1)
  })

  it('a fixed 24 under a ceiling 10 up never passes the ceiling, and goes on bouncing', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 24), [0, -1, 0]], [boxes('Lid', 'all', [[[-10, 10, -10], [10, 11, 10]]]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    const peak = peakOver(5000)
    // The lid's underside is 9 over the walker: it rises 8, a gibson short of it, never past.
    expect(peak).toBeLessThanOrEqual(8)
    expect(peak).toBeGreaterThan(7.9)
    expect(useWalk.getState().falling).toBe(true)
    nothingMade()
  })

  it('a pad flush with a floor beside it, the floor listed first: the pad still bounces', () => {
    // Floor and pad as two shards, their tops at exactly the same height under the walker.
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]], [bouncy(boxes('Pad', 'all', [[[-1, -1, -1], [1, 0, 1]]]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce(2000)
    expect(fallState()?.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 8), 6)
  })
})

describe('steering and leaving', () => {
  it('steering off a small pad lands on the floor below; the hops chain and land', async () => {
    world(start, [bouncy(boxes('Pad', 'all', [[[-1, -1, -1], [1, 0, 1]]]), 8), [0, -1, 0]], [boxes('Floor', 'all', [lowFloor(6)]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    for (let t = 0; t < 700; t += 16) frame(16)
    for (let k = 0; k < 3; k++) useWalk.getState().press('away')
    fallOut()
    expect(useWalk.getState().falling).toBe(false)
    const floor = { ...start, y: start.y - 6n, z: start.z - 3n }
    expect(useCyberspace.getState().cursor).toEqual(floor)
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0))
    await landAll()
    chainOk()
    expect(posted[0].from).toEqual(start)
    expect(posted[posted.length - 1].to).toEqual(floor)
    expect(useCyberspace.getState().position).toEqual(floor)
  })

  it('leaving WALK mid-bounce with a hop queued: nothing more is posted', async () => {
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]], [bouncy(boxes('Pad', 'all', [lowFloor(6)]), 4), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    untilBounce()
    expect(useWalk.getState().queue.length).toBeGreaterThan(0)
    useWalk.getState().exit()
    expect(fallState()).toBeNull()
    const n = posted.length
    for (let t = 0; t < 3000; t += 16) frame(16)
    expect(posted).toHaveLength(n)
    expect(useWalk.getState().queue).toEqual([])
  })

  it('switching identity mid-bounce stops the walk and drops the bounce', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    useCyberspace.setState({ identity: { ...useCyberspace.getState().identity, pubkey: 'ab'.repeat(32) } })
    expect(fallState()).toBeNull()
    expect(useWalk.getState()).toMatchObject({ falling: false, queue: [], open: null, behind: 0 })
    for (let t = 0; t < 2000; t += 16) frame(16)
    expect(posted).toHaveLength(0)
  })

  it('reflect with Up held climbs by 5 (JUMP_HEIGHT) a bounce to 24, and stays there, publishing nothing', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 'reflect'), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    const seen: number[] = []
    let last = -1
    for (let t = 0; t < 30_000; t += 16) {
      frame(16)
      if (t % 32 === 0) useWalk.getState().press('up')
      const f = fallState()
      // (An arc that meets its top exactly, a float hair under its apex, restarts there at rest: v0 0, the same motion.)
      if (f && f.v0 !== last && f.v0 > 0) { last = f.v0; seen.push(Math.round((f.v0 * f.v0) / (2 * WALK_GRAVITY))) }
    }
    expect(seen).toEqual([5, 10, 15, 20, 24])
    // And it stays at 24, Up or not.
    expect(Math.abs(peakOver(3000) - 24)).toBeLessThan(1)
    nothingMade()
  }, LONG_TEST_MS)
})

describe('the hop rate', () => {
  it('steering along 1-high pads: one hop a bounce at most; jumping along a floor, two a jump at most', () => {
    const LONG: [V3, V3] = [[-10, -1, -400], [10, 0, 10]]
    const steer = (jump: boolean) => () => { for (let t = 0; t < 5000; t += 16) { frame(16); if (t % 96 === 0) { if (jump) useWalk.getState().press('up'); useWalk.getState().press('away') } } }
    world(start, [bouncy(boxes('Pad', 'all', [LONG]), 1), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    const bounce = queuedBy(steer(false))
    useWalk.getState().exit()
    clearWalls()
    world(start, [boxes('Floor', 'all', [LONG]), [0, -1, 0]])
    walk(true)
    const jump = queuedBy(steer(true))
    // A bounce at 1 is 0.35 s: 14 landings in 5 s, each a hop to the next spot
    // along (26 before steer points were folded into the landing's hop).
    expect(bounce).toBe(14)
    // A jump is about 0.775 s now (5 high; at 3 it was 0.6 s and out-hopped the
    // bounce): its steer point and its landing, at most, for each jump in 5 s.
    expect(jump).toBeGreaterThan(0)
    expect(jump).toBeLessThanOrEqual(2 * Math.ceil(5 / JUMP_HANG_S))
  }, LONG_TEST_MS)

  it('steering across a long pad while proofs land: the chain stays whole and the walk never stops', async () => {
    world(start, [bouncy(boxes('Pad', 'all', [[[-10, -1, -400], [10, 0, 10]]]), 4), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    for (let round = 0; round < 12; round++) {
      // On for the whole first arc (the jump, about 0.775 s), then a turn every third round.
      for (let t = 0; t < 300; t += 16) { frame(16); if (t % 96 === 0) useWalk.getState().press(round > 2 && round % 3 === 2 ? 'right' : 'away') }
      await landAll()
    }
    expect(posted.length).toBeGreaterThan(3)
    chainOk()
    expect(posted[0].from).toEqual(start)
    // The first arc is the jump, a plain fall: its steer point is a hop of its own (B), then its landing.
    expect(at(start, posted[0].to as Position)[1]).toBeGreaterThan(0)
    expect(at(start, posted[1].to as Position)[1]).toBe(0)
    // Every bounce after it is one hop, landing to landing, at the pad's standing height.
    for (const h of posted.slice(1)) expect(h.to.y).toBe(start.y)
    expect(useWalk.getState().falling).toBe(true)
    expect(useCyberspace.getState().proof.status).not.toBe('infeasible')
  }, LONG_TEST_MS)
})

describe('the cost of a press', () => {
  it('a world with no bounce asks no floor query on any press; one with a pad does', () => {
    world(start, [boxes('Floor', 'all', [[[-20, -1, -20], [20, 0, 20]]]), [0, -1, 0]], [boxes('Step', 'all', [[[-20, 0, -20], [20, 1, -3.5]]]), [0, -1, 0]])
    walk(true)
    const before = padQueries()
    for (let k = 0; k < 6; k++) useWalk.getState().press('away')
    for (let k = 0; k < 6; k++) useWalk.getState().press('toward')
    useWalk.getState().press('right')
    expect(anyBounce()).toBe(false)
    expect(padQueries()).toBe(before)
    useWalk.getState().exit()
    clearWalls()
    world(start, [boxes('Floor', 'all', [[[-20, -1, -20], [20, 0, 20]]]), [0, -1, 0]], [bouncy(boxes('Pad', 'all', [[[18, -1, 18], [20, 0, 20]]]), 6), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    expect(anyBounce()).toBe(true)
    expect(padQueries()).toBeGreaterThan(before)
  })
})

describe('a springboard (arkinox, 2026-11-10: launches however you arrive)', () => {
  /** `s` a springboard too. */
  const board = (s: ShardModel, v: unknown = true): ShardModel => ({ ...s, extra: { ...s.extra, springboard: v } })
  /** A plain floor ending half a gibson ahead, and from there a pad flush with it, 12 gibsons wide along the way on. */
  const flush = (pad: ShardModel): void => {
    world(start, [boxes('Floor', 'all', [LEDGE]), [0, -1, 0]], [pad, [0, -1, 0]])
  }
  const PAD: [V3, V3] = [[-10, -1, -40], [10, 0, -0.5]]
  const on = { x: 0n, y: 0n, z: -1n }

  it('a level walk onto a flush springboard launches; the walk is one hop to it, and bouncing on makes nothing', async () => {
    flush(board(bouncy(boxes('Board', 'all', [PAD]), 12)))
    walk(true)
    useWalk.getState().press('away')
    const top = { ...start, z: start.z + on.z }
    expect(useCyberspace.getState().cursor).toEqual(top)
    expect(useWalk.getState().falling).toBe(true)
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 12), 6)
    // The walk segment closed at the launch point: one normal hop.
    expect(useWalk.getState().queue).toEqual([top])
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: top })
    await land()
    expect(Math.abs(peakOver(1500) - 12)).toBeLessThan(1)
    for (let t = 0; t < 10_000; t += 16) frame(16)
    expect(useWalk.getState().falling).toBe(true)
    expect(posted).toHaveLength(1)
    expect(useWalk.getState()).toMatchObject({ queue: [], open: null, behind: 0 })
  })

  it('without springboard, a level walk onto the same pad does not launch', () => {
    flush(bouncy(boxes('Pad', 'all', [PAD]), 12))
    walk(true)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, -1])
    expect(useWalk.getState().falling).toBe(false)
  })

  it('only true makes one: "true" and 1 do not launch on a walk-on', () => {
    for (const v of ['true', 1]) {
      clearWalls()
      flush(board(bouncy(boxes(`Board ${String(v)}`, 'all', [PAD]), 12), v))
      walk(true)
      useWalk.getState().press('away')
      expect(useWalk.getState().falling).toBe(false)
      useWalk.getState().exit()
    }
  })

  it('with "reflect" it adds nothing: a walk-on fell from nowhere', () => {
    flush(board(bouncy(boxes('Board', 'all', [PAD]), 'reflect')))
    walk(true)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, -1])
    expect(useWalk.getState().falling).toBe(false)
  })

  it('Down just before walking on absorbs it: you stand on it; a Down long before does not', () => {
    flush(board(bouncy(boxes('Board', 'all', [PAD]), 12)))
    walk(true)
    useWalk.getState().press('down')
    clock += 100
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, -1])
    expect(useWalk.getState().falling).toBe(false)
    // Down pressed again just before the next step: on along the board, still standing.
    useWalk.getState().press('down')
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, -2])
    expect(useWalk.getState().falling).toBe(false)
    // Let go: the next step on the board launches.
    clock += 1000
    useWalk.getState().press('away')
    expect(useWalk.getState().falling).toBe(true)
  })

  it('a step up onto a springboard launches too, and a landing on it bounces, as on any pad', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]], [board(bouncy(boxes('Board', 'all', [[[-10, 0, -10], [10, 1, -0.5]]]), 6)), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 1, -1])
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 6), 6)
  })

  it('steering on along a wide springboard: one hop a landing, no storm', () => {
    flush(board(bouncy(boxes('Board', 'all', [[[-10, -1, -400], [10, 0, -0.5]]]), 12)))
    walk(true)
    let landings = 0
    let last = -1
    const hops = queuedBy(() => {
      useWalk.getState().press('away')
      for (let t = 0; t < 5000; t += 16) {
        frame(16)
        if (t % 96 === 0) useWalk.getState().press('away')
        const f = fallState()
        if (f && f.t0 !== last) { if (last !== -1) landings++; last = f.t0 }
      }
    })
    // A bounce at 12 is 1.2 s: the walk-on, then a hop at each landing somewhere new along the board.
    expect(useWalk.getState().falling).toBe(true)
    expect(landings).toBe(4)
    expect(hops).toBe(1 + landings)
    expect(at(start, fallState()!.anchor)[2]).toBeLessThan(-20)
  }, LONG_TEST_MS)
})
