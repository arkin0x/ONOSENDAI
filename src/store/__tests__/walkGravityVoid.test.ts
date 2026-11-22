/**
 * walkGravityVoid.test.ts - nothing to catch you (arkinox, 2026-11-22): with
 * GRAVITY on, a fall that would never land (nothing straight below before a
 * grid boundary no hop can afford) turns gravity off, but only at the first
 * moment no input left could save you: not while a double jump or steering
 * in the air could still land you on a wall (store/walkGravity.ts
 * canStillLand). The GRAVITY OFF chip says why, and gravity never comes back
 * on by itself. Hard Mode Gravity, a Settings switch off by default and kept
 * on this device, keeps today's fall to the invisible floor. The fall search
 * (85 asks of the hop cost) is kept per height and region, so a walk along
 * it, or a walk with gravity off after it went off, does not ask it again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Every ask of the hop cost, counted: the fall search is 85 of them. */
const costAsks = vi.hoisted(() => ({ n: 0 }))
vi.mock('cyberspace-core', async (orig) => {
  const mod = await orig<typeof import('cyberspace-core')>()
  return { ...mod, estimateHopCost: (...a: Parameters<typeof mod.estimateHopCost>) => { costAsks.n++; return mod.estimateHopCost(...a) } }
})

vi.hoisted(() => {
  // One fixed identity, so one fixed spawn (identity IS position): with a
  // fresh key each run, about 1 spawn in 230 has no cap that puts a big
  // boundary 16 to 4095 gibsons under it (capNear), and (C) failed at random.
  // A throwaway key, only ever used here.
  const m = new Map<string, string>([['onosendai:nsec', 'nsec1tkpfjw7uzeyjxgrpr4mujt7nkzdpxw9n4dmwjcse57sjag83yq4q790w5c']])
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
import { clearWalls } from '../walkWalls'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { GRAVITY_OFF_VOID, fallState, fluidCross, segmentAffordable, tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'
import { AIR_REACH_SPEED, GRAVITY_KEY, HARD_GRAVITY_KEY, affordableAlongY, canStillLand, latestAt, loadGravity, loadHardGravity } from '../walkGravity'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'

/** Right +X, up +Y, toward the camera +Z: 'away' walks -Z. Level, as GRAVITY keeps the keys. */
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
 * steps off. The shards' origin is 1 under the walker.
 */
const LEDGE: [V3, V3] = [[-10, -1, -0.5], [10, 0, 10]]
const lowFloor = (drop: number): [V3, V3] => [[-10, -drop - 1, -20], [10, -drop, 10]]

/** Where the walker is, from where it started. */
function at(start: Position, p: Position = useCyberspace.getState().cursor): V3 {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

/** The clock the fall runs on. */
let clock = 1_000_000
/** Advance the clock by `ms` and give the fall one frame. */
function frame(ms: number): boolean {
  clock += ms
  return tickFall()
}
/** Frames of 16 ms until the fall resolves (or `maxMs` passes). */
function fallOut(maxMs = 120_000): void {
  for (let t = 0; t < maxMs && fallState(); t += 16) frame(16)
}

let start: Position

beforeEach(async () => {
  posted.length = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  ceiling.hopHeight = 40
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useWalk.getState().setHardGravity(false)
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

/** Into WALK with the level keys, gravity as asked. */
function walk(gravity: boolean): void {
  useWalk.getState().setGravity(gravity)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
}

/** A platform far off to the side, at the walker's height: further than any jump and steering can go. */
const FAR: [V3, V3] = [[200, -1, -10], [210, 0, 10]]

/** Frames of 16 ms until gravity goes off, the fall ends, or `maxMs` passes. */
function untilOff(maxMs = 10_000): void {
  for (let t = 0; t < maxMs && useWalk.getState().gravity && fallState(); t += 16) frame(16)
}

describe('the rescue check (walkGravity canStillLand)', () => {
  it('a double jump pressed at its best moment, and reaching DOUBLE_JUMP_HEIGHT and no higher', () => {
    const g = (8 * 3) / 0.36
    expect(latestAt(0, 0, 0, false)).toBe(0)
    // From rest the best press is not at once (2 v / g, 0.6 s) but 1.5 under, on the way down: about 0.724 s.
    expect(latestAt(0, 0, 0, true)).toBeGreaterThan((2 * 20) / g)
    expect(latestAt(0, 0, 0, true)).toBeCloseTo(Math.sqrt(3 / g) + (20 + Math.sqrt(400 - 3 * g)) / g, 3)
    expect(latestAt(0, 0, 3, true)).not.toBeNull()
    expect(latestAt(0, 0, 3.2, true)).toBeNull()
    // Falling fast, a little under the floor: still back up onto it.
    expect(latestAt(-2, -10, 0, true)).not.toBeNull()
    expect(latestAt(-2, -10, 0, false)).toBeNull()
  })

  it('a box to the side counts while steering could reach it in that time', () => {
    const t = latestAt(0, 0, 0, true)!
    const reach = t * AIR_REACH_SPEED + 1
    expect(canStillLand(0, 0, true, -1e9, [{ d: Math.floor(reach), top: 0 }])).toBe(true)
    expect(canStillLand(0, 0, true, -1e9, [{ d: Math.ceil(reach) + 1, top: 0 }])).toBe(false)
    // Its top under the boundary: never.
    expect(canStillLand(0, 0, true, -5, [{ d: 0, top: -6 }])).toBe(false)
  })
})

describe('gravity stays on while something could still catch you', () => {
  it('walking off a ledge with ground below: you fall and land, gravity on', () => {
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(20)]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    expect(useWalk.getState().falling).toBe(true)
    fallOut()
    expect(at(start)).toEqual([0, -20, -1])
    expect(useWalk.getState().gravity).toBe(true)
    expect(useToast.getState().toast?.label).not.toBe(GRAVITY_OFF_VOID.label)
  })

  it('a jump across a gap onto a far platform: gravity on all the way, and you land', () => {
    // The start ends half a gibson behind; the gap is z -1 to -4; the far platform from z -5.
    world(start, [boxes('Stones', 'all', [LEDGE, [[-10, -1, -14.5], [10, 0, -4.5]]]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(100)
    for (let i = 0; i < 5; i++) useWalk.getState().press('away')
    expect(at(start)[2]).toBe(-5)
    // Over the gap, nothing straight below: never judged lost while the platform is in reach.
    for (let t = 0; t < 2000 && fallState(); t += 16) {
      frame(16)
      expect(useWalk.getState().gravity).toBe(true)
    }
    expect(at(start)).toEqual([0, 0, -5])
    expect(useWalk.getState().gravity).toBe(true)
  })

  it('falling past a ledge a double jump can still reach: gravity on, and the double jump lands you back on it', () => {
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    frame(150)
    expect(useWalk.getState().gravity).toBe(true)
    expect(useWalk.getState().falling).toBe(true)
    expect(useWalk.getState().doubleJump()).toBe(true)
    frame(100)
    useWalk.getState().press('toward')
    fallOut()
    expect(at(start)).toEqual([0, 0, 0])
    expect(useWalk.getState().gravity).toBe(true)
  })
})

describe('gravity goes off once nothing could catch you', () => {
  it('into the void with nothing in reach: off at once, where you are, with the chip', () => {
    world(start, [boxes('Far', 'all', [FAR]), [0, -1, 0]])
    walk(true)
    expect(useWalk.getState().gravity).toBe(false)
    expect(fallState()).toBeNull()
    expect(useWalk.getState().falling).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(useToast.getState().toast).toMatchObject({ label: 'GRAVITY OFF', meta: 'nothing below to catch you', mark: 'walk' })
    // Kept on this device, as Z would keep it.
    expect(localStorage.getItem(GRAVITY_KEY)).toBe('off')
    expect(loadGravity()).toBe(false)
    expect(posted).toHaveLength(0)
  })

  it('stepping off into the void: off as soon as no double jump could bring you back, and never back on by itself', async () => {
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    expect(useWalk.getState().falling).toBe(true)
    untilOff()
    expect(useWalk.getState().gravity).toBe(false)
    expect(useWalk.getState().falling).toBe(false)
    expect(fallState()).toBeNull()
    // A double jump rises 3: off once more than 3 under the ledge, and no further.
    const [x, y, z] = at(start)
    expect([x, z]).toEqual([0, -1])
    expect(y).toBeLessThanOrEqual(-3)
    expect(y).toBeGreaterThanOrEqual(-5)
    expect(useToast.getState().toast).toMatchObject({ label: 'GRAVITY OFF' })
    // The step-off and the fall's one hop, where it stopped.
    expect(useWalk.getState().queue).toEqual([{ ...start, z: start.z - 1n }, useCyberspace.getState().cursor])
    // You float there: a press is a step at this height, and gravity stays off.
    useWalk.getState().press('away')
    for (let i = 0; i < 20; i++) frame(100)
    expect(at(start)).toEqual([0, y, -2])
    expect(useWalk.getState().gravity).toBe(false)
  })

  it('the double jump spent and still missing: off as soon as you come down past the ledge', () => {
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    frame(16)
    expect(useWalk.getState().doubleJump()).toBe(true)
    // At its top, 3 up: on (you could still steer back over the ledge).
    frame(300)
    expect(useWalk.getState().gravity).toBe(true)
    untilOff()
    expect(useWalk.getState().gravity).toBe(false)
    // With no double jump left, the ledge is lost the moment you are under its top.
    const y = at(start)[1]
    expect(y).toBeLessThanOrEqual(0)
    expect(y).toBeGreaterThanOrEqual(-2)
  })

  it('a jump that ends over the void: on through the arc, off only once coming down with nothing in reach', () => {
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]])
    walk(true)
    const t0 = clock
    useWalk.getState().press('up')
    frame(100)
    useWalk.getState().press('away')
    useWalk.getState().press('away')
    expect(at(start)[2]).toBe(-2)
    // Rising, and at the top: on.
    frame(287)
    expect(useWalk.getState().gravity).toBe(true)
    untilOff()
    expect(useWalk.getState().gravity).toBe(false)
    // Coming down by then, and under where it left (the double jump was still in hand).
    expect((clock - t0) / 1000).toBeGreaterThan(0.387)
    expect(at(start)[1]).toBeLessThan(0)
  })
})

describe('Hard Mode Gravity', () => {
  it('is off by default, and kept on this device', () => {
    localStorage.removeItem(HARD_GRAVITY_KEY)
    expect(loadHardGravity()).toBe(false)
    useWalk.getState().setHardGravity(true)
    expect(useWalk.getState().hardGravity).toBe(true)
    expect(localStorage.getItem(HARD_GRAVITY_KEY)).toBe('on')
    expect(loadHardGravity()).toBe(true)
    useWalk.getState().setHardGravity(false)
    expect(localStorage.getItem(HARD_GRAVITY_KEY)).toBe('off')
    expect(loadHardGravity()).toBe(false)
  })

  it('keeps gravity on over nothing: you fall, as before', () => {
    useWalk.getState().setHardGravity(true)
    world(start, [boxes('Far', 'all', [FAR]), [0, -1, 0]])
    walk(true)
    expect(useWalk.getState().falling).toBe(true)
    for (let i = 0; i < 100; i++) frame(16)
    expect(useWalk.getState().gravity).toBe(true)
    expect(fallState()).not.toBeNull()
    expect(useToast.getState().toast?.label).not.toBe('GRAVITY OFF')
  })
})

describe('the fall search is not asked again on every crossing', () => {
  it('gravity off over the void: a walk asks no fall search at all', () => {
    world(start, [boxes('Far', 'all', [FAR]), [0, -1, 0]])
    walk(true)
    expect(useWalk.getState().gravity).toBe(false)
    costAsks.n = 0
    for (let i = 0; i < 10; i++) useWalk.getState().press('left')
    expect(at(start)[0]).toBe(-10)
    // A segment's budget is one or two asks a step; the fall search alone was 85.
    expect(costAsks.n).toBeLessThan(10 * 5)
  })

  it('fluid WALK crossings over the void with gravity off: the same', () => {
    world(start, [boxes('Far', 'all', [FAR]), [0, -1, 0]])
    walk(true)
    expect(useWalk.getState().gravity).toBe(false)
    costAsks.n = 0
    for (let i = 0; i < 10; i++) expect(fluidCross({ axis: 'x', dir: -1 }, null).kind).toBe('moved')
    expect(costAsks.n).toBeLessThan(10 * 5)
  })

  it('Hard Mode, hovering at the invisible floor: the search is asked once for that height, not once a step', () => {
    useWalk.getState().setHardGravity(true)
    const off = { ...start, z: start.z - 1n }
    let hover: Position | null = null
    for (let cap = 5; cap < 30 && !hover; cap++) {
      ceiling.hopHeight = cap + 3
      const drop = affordableAlongY(off, -1, 1n << 85n, (a, b) => segmentAffordable(a, b, useCyberspace.getState().plane))
      if (drop >= 16n && drop < 4096n) hover = { ...off, y: off.y - drop }
    }
    expect(hover).not.toBeNull()
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    fallOut()
    expect(useCyberspace.getState().cursor).toEqual(hover)
    expect(useWalk.getState().gravity).toBe(true)
    costAsks.n = 0
    useWalk.getState().press('left')
    const first = costAsks.n
    // The first step at this height asks the whole search, a binary search over 85 bits.
    expect(first).toBeGreaterThanOrEqual(80)
    costAsks.n = 0
    for (let i = 0; i < 10; i++) useWalk.getState().press('left')
    expect(useWalk.getState().falling).toBe(false)
    // The rest find it kept: a few asks a step for the segment, never the search again.
    expect(costAsks.n).toBeLessThan(10 * 5)
  })
})
