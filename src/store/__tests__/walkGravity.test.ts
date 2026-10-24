/**
 * walkGravity.test.ts - GRAVITY in WALK (store/useWalk.ts, store/walkGravity.ts;
 * arkinox, rulings of 2026-10-24). Off by default and kept per device; Z in
 * WALK switches it, Z on the workshop bench does not, and X is still stop or
 * back to HOP. Stepping off a floor is a normal hop, proved at once, and the
 * fall that follows proves nothing until it resolves:
 *
 * - (A) it lands: one hop from the step-off point to the landing;
 * - (B) a press in mid-air: one hop to that point, and the fall goes on;
 * - (C) it reaches the last gibson a hop can afford: one hop there, hovering,
 *   so a big grid boundary is an invisible floor even with a floor below it;
 * - (D) gravity goes off mid-fall: one hop to where you are.
 *
 * A jump in place publishes nothing; a jump onto a ledge is one hop; the
 * stair step-up still works with gravity on; floors the walls did not know
 * when the fall began, and floors without collision, are fallen through; a
 * fall over a real Maze Kit room lands on its floor; a frame of a fall
 * touches neither store nor the walls' cache; and a STOP mid-fall leaves
 * nothing behind.
 */
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
  return { ...mod, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { fromPayload, newShard, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { fallState, segmentAffordable, tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'
import { clearWalls, entryFor, wallItems } from '../walkWalls'
import { GIBSON_METRES, GRAVITY_KEY, JUMP_HANG_S, JUMP_HEIGHT, JUMP_SPEED, STANDARD_GRAVITY, WALK_GRAVITY, affordableAlongY, arcHeight, loadGravity } from '../walkGravity'
import { walkFall } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { canonicalQuaternion, levelQuaternion, levelScreenAxes, rotateView, viewAxes, type Position, type ViewAxes } from '../../lib/space'
import { carryLook } from '../../lib/walkLook'
import { walkCancel, walkKeyDown } from '../../hooks/useKeyboard'
import { Vector3 } from 'three'
import hallStairs from '../fixtures/maze-kit-basilica-hall-stairs.json'

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
/** A floor under the walker, its top 1 below. */
const FLOOR: [V3, V3] = [[-10, -1, -10], [10, 0, 10]]

/** Where the walker is, from where it started. */
function at(start: Position, p: Position = useCyberspace.getState().cursor): V3 {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, proofHash: 'dd'.repeat(32), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

/** Land the newest proof, and wait for the next one when one is due. */
async function land(): Promise<void> {
  const before = posted.length
  await useCyberspace.getState().applyProofMessage(done(posted[posted.length - 1]))
  if (useWalk.getState().queue.length > 0) await vi.waitFor(() => expect(posted.length).toBe(before + 1))
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

describe('the numbers', () => {
  it('the ruled jump is exactly standard gravity at a gibson of about 0.147 m', () => {
    expect(JUMP_HEIGHT).toBe(3)
    expect(JUMP_HANG_S).toBe(0.6)
    expect(WALK_GRAVITY).toBeCloseTo(66.667, 3)
    expect(JUMP_SPEED).toBeCloseTo(20, 12)
    expect(GIBSON_METRES).toBeCloseTo(0.1471, 4)
    expect(WALK_GRAVITY * GIBSON_METRES).toBeCloseTo(STANDARD_GRAVITY, 12)
    // Up 3 at the top, and back where it left after 0.6 s.
    expect(arcHeight(JUMP_SPEED, JUMP_HANG_S / 2)).toBeCloseTo(3, 9)
    expect(arcHeight(JUMP_SPEED, JUMP_HANG_S)).toBeCloseTo(0, 9)
    // A fall accelerates: d = g t^2 / 2, no terminal velocity.
    expect(arcHeight(0, 1)).toBeCloseTo(-WALK_GRAVITY / 2, 9)
    expect(arcHeight(0, 10)).toBeCloseTo(-100 * WALK_GRAVITY / 2, 6)
  })
})

describe('the switch', () => {
  it('is off by default, and only an explicit on turns it on', () => {
    localStorage.removeItem(GRAVITY_KEY)
    expect(loadGravity()).toBe(false)
    localStorage.setItem(GRAVITY_KEY, 'off')
    expect(loadGravity()).toBe(false)
    localStorage.setItem(GRAVITY_KEY, 'true')
    expect(loadGravity()).toBe(false)
    localStorage.setItem(GRAVITY_KEY, 'on')
    expect(loadGravity()).toBe(true)
  })

  it('is kept on this device', () => {
    useWalk.getState().setGravity(true)
    expect(localStorage.getItem(GRAVITY_KEY)).toBe('on')
    expect(loadGravity()).toBe(true)
    useWalk.getState().setGravity(false)
    expect(localStorage.getItem(GRAVITY_KEY)).toBe('off')
    expect(loadGravity()).toBe(false)
  })

  it('Z in WALK switches it; Z with a modifier, Z outside WALK and Z on the workshop bench do not', () => {
    const key = (code: string, mods: Partial<KeyboardEvent> = {}) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: vi.fn(), ...mods })
    // Outside WALK: not WALK's key.
    expect(walkKeyDown(key('KeyZ'))).toBe(false)
    expect(useWalk.getState().gravity).toBe(false)
    walk(false)
    const z = key('KeyZ')
    expect(walkKeyDown(z)).toBe(true)
    expect(z.preventDefault).toHaveBeenCalled()
    expect(useWalk.getState().gravity).toBe(true)
    expect(useToast.getState().toast).toMatchObject({ label: 'GRAVITY', meta: 'ON' })
    walkKeyDown(key('KeyZ'))
    expect(useWalk.getState().gravity).toBe(false)
    // Ctrl+Z is the browser's (or a field's) undo.
    expect(walkKeyDown(key('KeyZ', { ctrlKey: true }))).toBe(false)
    expect(walkKeyDown(key('KeyZ', { metaKey: true }))).toBe(false)
    expect(useWalk.getState().gravity).toBe(false)
    // The bench's Z is its undo: with the workshop open nothing of WALK's answers.
    useWorkshop.setState({ open: true })
    expect(walkKeyDown(key('KeyZ'))).toBe(false)
    expect(useWalk.getState().gravity).toBe(false)
  })

  it('X is still stop, or with nothing to stop, back to HOP', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('right')
    walkCancel()
    // Something to stop: stopped, still walking.
    expect(useCyberspace.getState().walking).toBe(true)
    expect(useWalk.getState().open).toBeNull()
    walkCancel()
    // Nothing: back to HOP.
    expect(useCyberspace.getState().walking).toBe(false)
  })
})

describe('gravity off', () => {
  it('walking off a ledge stays at its height, as WALK always has', () => {
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(20)]), [0, -1, 0]])
    walk(false)
    for (let k = 1; k <= 3; k++) useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, -3])
    expect(fallState()).toBeNull()
    expect(useWalk.getState().falling).toBe(false)
    expect(useWalk.getState().open).toMatchObject({ from: start })
    expect(useWalk.getState().queue).toHaveLength(0)
  })

  it('Up flies and Down comes down, as before', () => {
    walk(false)
    useWalk.getState().press('up')
    useWalk.getState().press('up')
    expect(at(start)).toEqual([0, 2, 0])
    useWalk.getState().press('down')
    expect(at(start)).toEqual([0, 1, 0])
    expect(fallState()).toBeNull()
  })
})

describe('a fall', () => {
  it('stepping off is a normal hop, proved now; the fall proves nothing; (A) landing is one hop more', async () => {
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(20)]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    const off = { ...start, z: start.z - 1n }
    // The press stopped on the first gibson past the edge: the step-off.
    expect(at(start)).toEqual([0, 0, -1])
    expect(useWalk.getState().falling).toBe(true)
    // The step-off segment closed there and went to be proved at once.
    expect(useWalk.getState().queue).toEqual([off])
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].from).toEqual(start)
    expect(posted[0].to).toEqual(off)

    // Mid-fall: the eye goes down at g, and no proof is made.
    frame(300)
    expect(walkFall.active).toBe(true)
    expect(walkFall.offset).toBeCloseTo(-WALK_GRAVITY * 0.09 / 2, 6)
    frame(200)
    expect(walkFall.offset).toBeCloseTo(-WALK_GRAVITY * 0.25 / 2, 6)
    await land()
    expect(useCyberspace.getState().position).toEqual(off)
    expect(posted).toHaveLength(1)
    expect(useWalk.getState().queue).toEqual([])
    expect(useCyberspace.getState().cursor).toEqual(off)

    // A drop of 20: 0.77 s, to standing 1 above the low floor's top.
    fallOut()
    const landing = { ...off, y: start.y - 20n }
    expect(useWalk.getState().falling).toBe(false)
    expect(walkFall.active).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(landing)
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1].from).toEqual(off)
    expect(posted[1].to).toEqual(landing)
    await land()
    expect(useCyberspace.getState().position).toEqual(landing)
    // spawn, the step-off, and ONE hop for the fall
    expect(useCyberspace.getState().events).toHaveLength(3)
  })

  it('lands no sooner than real gravity would bring it there', () => {
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(40)]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    const t0 = clock
    fallOut()
    // 40 gibsons down, from standing height to standing height.
    const t = (clock - t0) / 1000
    expect(at(start)).toEqual([0, -40, -1])
    expect(t).toBeGreaterThanOrEqual(Math.sqrt((2 * 40) / WALK_GRAVITY))
    expect(t).toBeLessThan(Math.sqrt((2 * 40) / WALK_GRAVITY) + 0.02)
  })

  it('(B) a press in mid-air is one hop to that point, and the fall goes on from it', async () => {
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(30)]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    const off = { ...start, z: start.z - 1n }
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    // 0.3 s in: 3 gibsons down.
    frame(300)
    useWalk.getState().press('away')
    const mid = { ...off, y: off.y - 3n, z: off.z - 1n }
    expect(useCyberspace.getState().cursor).toEqual(mid)
    expect(fallState()!.waypoints).toEqual([mid])
    // Still falling, still nothing queued for the fall.
    expect(useWalk.getState().falling).toBe(true)
    expect(useWalk.getState().queue).toEqual([off])
    // The eye did not jump: it is where the arc is, not on the whole gibson.
    expect(walkFall.offset).toBeCloseTo(-WALK_GRAVITY * 0.09 / 2 + 3, 6)
    // Up and down in the air do nothing.
    useWalk.getState().press('up')
    useWalk.getState().press('down')
    expect(useCyberspace.getState().cursor).toEqual(mid)
    fallOut()
    const landing = { ...mid, y: start.y - 30n }
    expect(useCyberspace.getState().cursor).toEqual(landing)
    expect(useWalk.getState().queue).toEqual([off, mid, landing])
    await land()
    await land()
    expect(posted[1].from).toEqual(off)
    expect(posted[1].to).toEqual(mid)
    await land()
    expect(posted[2].from).toEqual(mid)
    expect(posted[2].to).toEqual(landing)
    expect(useCyberspace.getState().position).toEqual(landing)
  })

  it('(B) a mid-air press is held by a wall like any step', () => {
    // A wall 1.5 further along, from the low floor up past the ledge.
    world(start, [boxes('Pit', 'all', [LEDGE, lowFloor(30), [[-10, -31, -3.5], [10, 5, -2.5]]]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    frame(300)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, -3, -2])
    useWalk.getState().press('away')
    // The wall is a gibson ahead: no step, no waypoint, the WALL chip.
    expect(at(start)).toEqual([0, -3, -2])
    expect(fallState()!.waypoints).toHaveLength(1)
    expect(useToast.getState().toast).toMatchObject({ label: 'WALL', meta: 'Pit' })
  })

  it('(D) gravity off mid-fall: one hop to where you are, and you float there', async () => {
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(30)]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    const off = { ...start, z: start.z - 1n }
    // 0.4 s in: 5.33 down, so the whole gibson you have been at is 5 down.
    frame(400)
    useWalk.getState().setGravity(false)
    const here = { ...off, y: off.y - 5n }
    expect(useWalk.getState().falling).toBe(false)
    expect(fallState()).toBeNull()
    expect(walkFall.active).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(here)
    expect(useWalk.getState().queue).toEqual([off, here])
    // No more falling: frames do nothing.
    expect(frame(1000)).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(here)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await land()
    expect(posted[1].to).toEqual(here)
  })

  it('a STOP mid-fall drops the fall: nothing of it is queued, the view goes home, nothing is kept', async () => {
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(30)]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    const off = { ...start, z: start.z - 1n }
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await land()
    frame(300)
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).sort()
    // X: there is a fall to stop, so it stops, and stays in WALK.
    walkCancel()
    expect(useCyberspace.getState().walking).toBe(true)
    expect(fallState()).toBeNull()
    expect(walkFall).toEqual({ active: false, offset: 0 })
    expect(useWalk.getState()).toMatchObject({ falling: false, queue: [], open: null, running: null, behind: 0 })
    // Back at the step-off point, the head of the chain.
    expect(useCyberspace.getState().cursor).toEqual(off)
    expect(useCyberspace.getState().position).toEqual(off)
    expect(frame(2000)).toBe(false)
    expect(posted).toHaveLength(1)
    // Nothing of the fall was written anywhere a reload would read.
    expect(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).sort()).toEqual(keys)
  })

  it('leaving WALK mid-fall drops it too', () => {
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(30)]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    frame(300)
    useWalk.getState().exit()
    expect(fallState()).toBeNull()
    expect(walkFall.active).toBe(false)
    expect(useWalk.getState().falling).toBe(false)
  })

  it('floors without collision, and floors not known when the fall began, are fallen through', () => {
    const ledge = boxes('Ledge', 'all', [LEDGE, lowFloor(40)])
    const loose = boxes('Loose', 'off', [lowFloor(10)])
    const items = world(start, [ledge, [0, -1, 0]], [loose, [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    // A floor 20 down arrives mid-fall (a part resolving, a shard placed): it was not known.
    frame(100)
    const late = boxes('Late', 'all', [lowFloor(20)])
    useShards.setState({ worldItems: () => [...items, { ...items[0], key: 'late', shard: late }] })
    fallOut()
    // Through both, onto the floor 40 down.
    expect(at(start)).toEqual([0, -40, -1])
  })

  it('a step-down of 2 or less is still a step-down, not a fall', () => {
    world(start, [boxes('Steps', 'all', [LEDGE, [[-10, -3, -20], [10, -2, -0.5]]]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, -2, -1])
    expect(useWalk.getState().falling).toBe(false)
    expect(useWalk.getState().open).toMatchObject({ from: start, end: { ...start, y: start.y - 2n, z: start.z - 1n } })
  })
})

describe('as far as a hop can afford (C)', () => {
  /**
   * A cap low enough that a big boundary is a few dozen gibsons under the
   * step-off point, wherever the spawn put it: the walk's own budget is
   * h <= hopHeight - 3 here.
   */
  function capNear(off: Position): { cap: number; hover: Position } {
    for (let cap = 5; cap < 30; cap++) {
      ceiling.hopHeight = cap + 3
      const drop = affordableAlongY(off, -1, 1n << 85n, (a, b) => segmentAffordable(a, b, useCyberspace.getState().plane))
      if (drop >= 16n && drop < 4096n) return { cap, hover: { ...off, y: off.y - drop } }
    }
    throw new Error('no cap puts a boundary in reach')
  }

  it('one hop to the last affordable gibson, and you hover there: a big boundary is an invisible floor', async () => {
    const off = { ...start, z: start.z - 1n }
    const { hover } = capNear(off)
    const below = Number(off.y - hover.y)
    // A floor 10 under the boundary: never reached.
    world(start, [boxes('Ledge', 'all', [LEDGE, lowFloor(below + 10)]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    fallOut()
    expect(useWalk.getState().falling).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(hover)
    // Affordable, and one gibson more is not.
    const plane = useCyberspace.getState().plane
    expect(segmentAffordable(off, hover, plane)).toBe(true)
    expect(segmentAffordable(off, { ...hover, y: hover.y - 1n }, plane)).toBe(false)
    expect(useToast.getState().toast).toMatchObject({ label: 'HOVERING' })
    expect(useWalk.getState().queue).toEqual([off, hover])
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await land()
    expect(posted[1]).toMatchObject({ from: off, to: hover })
    // Hovering: a press along does not fall past it either.
    await land()
    useWalk.getState().press('left')
    expect(useWalk.getState().falling).toBe(false)
    expect(at(start)[1]).toBe(Number(hover.y - start.y))
    // Off a floor there is no jump, and Down does nothing: no flying.
    const here = { ...useCyberspace.getState().cursor }
    useWalk.getState().press('up')
    useWalk.getState().press('down')
    expect(fallState()).toBeNull()
    expect(useCyberspace.getState().cursor).toEqual(here)
  })

  it('over the void, too: no floor at all is a fall to the invisible floor', () => {
    const off = { ...start, z: start.z - 1n }
    const { hover } = capNear(off)
    world(start, [boxes('Ledge', 'all', [LEDGE]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    fallOut()
    expect(useCyberspace.getState().cursor).toEqual(hover)
  })
})

describe('a jump', () => {
  it('in place publishes nothing', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    expect(useWalk.getState().falling).toBe(true)
    frame(300)
    // Up 3 at the top.
    expect(walkFall.offset).toBeCloseTo(3, 6)
    // Up again in the air: no flying.
    useWalk.getState().press('up')
    fallOut()
    expect(useWalk.getState().falling).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(useWalk.getState()).toMatchObject({ queue: [], open: null, behind: 0 })
    expect(posted).toHaveLength(0)
  })

  it('takes about 0.6 s in the air', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    const t0 = clock
    fallOut()
    expect((clock - t0) / 1000).toBeCloseTo(JUMP_HANG_S, 1)
  })

  it('onto a ledge 3 up (too high for a step-up): one hop, onto the ledge', async () => {
    // A ledge whose top is 3 above the floor, from 1 ahead.
    world(start, [boxes('Ledge', 'all', [FLOOR, [[-10, 0, -10], [10, 3, -0.5]]]), [0, -1, 0]])
    walk(true)
    // Walking into it is a WALL: a riser of 3 does not climb.
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, 0])
    useToast.setState({ toast: null })
    useWalk.getState().press('up')
    // Rising, 2 up: the ledge's edge is in the way.
    frame(150)
    useWalk.getState().press('away')
    expect(at(start)).toEqual([0, 0, 0])
    expect(fallState()!.waypoints).toHaveLength(0)
    // Past the top, coming down through 2.5: it has been at 3, over the ledge's top.
    frame(250)
    useWalk.getState().press('away')
    const top = { ...start, y: start.y + 3n, z: start.z - 1n }
    expect(useCyberspace.getState().cursor).toEqual(top)
    fallOut()
    expect(useCyberspace.getState().cursor).toEqual(top)
    expect(useWalk.getState().queue).toEqual([top])
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: top })
    await land()
    expect(useCyberspace.getState().events).toHaveLength(2)
  })

  it('under a low ceiling rises only to it, and comes back down', () => {
    world(start, [boxes('Low room', 'all', [FLOOR, [[-10, 3, -10], [10, 4, 10]]]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    let peak = 0
    for (let t = 0; t < 2000 && fallState(); t += 16) { frame(16); if (walkFall.active) peak = Math.max(peak, walkFall.offset) }
    // The ceiling's face is 2 over the walker: it rises 1, a gibson short of it.
    expect(peak).toBeCloseTo(1, 6)
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(posted).toHaveLength(0)
  })

  it('toggled off at the top: one hop to where you are', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(300)
    useWalk.getState().setGravity(false)
    const top = { ...start, y: start.y + 3n }
    expect(useCyberspace.getState().cursor).toEqual(top)
    expect(useWalk.getState().queue).toEqual([top])
  })
})

describe('a Maze Kit room', () => {
  const stair = (): ShardModel => withConstrain(fromPayload(hallStairs as unknown as ShardPayload, 'x')!, 'all')

  it('the step-up climbs the grand stair with gravity on, one segment, no fall', () => {
    // The walker at the stair's foot doorway, as walkStepWalk.test.ts puts it.
    world(start, [stair(), [0, 7, -8]])
    walk(true)
    for (let k = 1; k <= 16; k++) {
      useWalk.getState().press('away')
      expect(useWalk.getState().falling).toBe(false)
    }
    expect(at(start)).toEqual([0, 16, -16])
    expect(useWalk.getState().queue).toHaveLength(0)
    // And back down, settling onto every tread.
    for (let k = 0; k < 16; k++) useWalk.getState().press('toward')
    expect(at(start)).toEqual([0, 0, 0])
    expect(useWalk.getState().falling).toBe(false)
  })

  it('out of the top landing\'s back door, down onto the vault of the room below: one hop', async () => {
    // Room A: the walker on its top landing (9 over its origin, 8 behind).
    // Room B: 40 lower, its middle under A's back door, where its vault's
    // crown has a walker standing 16 over B's origin.
    world(start, [stair(), [0, -9, 8]], [stair(), [0, -40, -1]])
    walk(true)
    expect(useWalk.getState().falling).toBe(false)
    useWalk.getState().press('away')
    const off = { ...start, z: start.z - 1n }
    expect(at(start)).toEqual([0, 0, -1])
    expect(useWalk.getState().falling).toBe(true)
    fallOut()
    const landing = { ...off, y: start.y - 24n }
    expect(useCyberspace.getState().cursor).toEqual(landing)
    expect(useWalk.getState().queue).toEqual([off, landing])
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await land()
    await land()
    expect(posted[1]).toMatchObject({ from: off, to: landing })
    expect(useCyberspace.getState().position).toEqual(landing)
  })

  it('a fall\'s frames touch neither store, and the walls are built once a model, as #480 holds them', () => {
    const a = stair()
    const items = world(start, [a, [0, -9, 8]], [a, [0, -40, -1]])
    walk(true)
    const walls = wallItems(useCyberspace.getState().plane)
    const meshes = walls.map((w) => entryFor(w).mesh)
    useWalk.getState().press('away')
    let writes = 0
    const off1 = useCyberspace.subscribe(() => { writes++ })
    const off2 = useWalk.subscribe(() => { writes++ })
    // Every frame but the last, which lands.
    for (let k = 0; k < 40; k++) frame(16)
    expect(fallState()).not.toBeNull()
    expect(writes).toBe(0)
    off1(); off2()
    // The same walls, not rebuilt, and one set for the model placed twice.
    expect(walls.map((w) => entryFor(w).mesh)).toEqual(meshes)
    meshes.forEach((m, n) => expect(entryFor(walls[n]).mesh).toBe(m))
    expect(items[0].shard).toBe(items[1].shard)
  })
})

describe('the level view', () => {
  it('turns a view that is not level to the nearest level one, and leaves a level one alone', () => {
    const level = canonicalQuaternion()
    expect(levelQuaternion(level)).toBeNull()
    expect(levelQuaternion(rotateView(level, 'left'))).toBeNull()
    const tilted = rotateView(level, 'up')
    const back = levelQuaternion(tilted)!
    expect(viewAxes(back).up).toEqual({ axis: 'y', dir: 1 })
    // The nearest: the one it was tilted from.
    expect(viewAxes(back)).toEqual(viewAxes(level))
  })

  it('in WALK with gravity on, a view turned off level comes back level', () => {
    walk(true)
    useCyberspace.getState().rotate('up')
    expect(viewAxes(useCyberspace.getState().view).up).toEqual({ axis: 'y', dir: 1 })
    // Turning about Y is level, and stays as turned.
    useCyberspace.getState().rotate('left')
    expect(viewAxes(useCyberspace.getState().view)).toEqual(viewAxes(rotateView(canonicalQuaternion(), 'left')))
  })

  it('switching gravity on in WALK levels a view that was not, and gravity off leaves views alone', () => {
    useCyberspace.setState({ view: rotateView(canonicalQuaternion(), 'up') })
    walk(false)
    expect(viewAxes(useCyberspace.getState().view).up.axis).not.toBe('y')
    useWalk.getState().setGravity(true)
    expect(viewAxes(useCyberspace.getState().view).up).toEqual({ axis: 'y', dir: 1 })
  })

  it('keeps the way you look, in cyberspace, through the levelling', () => {
    const from = viewAxes(rotateView(canonicalQuaternion(), 'up'))
    const to = viewAxes(canonicalQuaternion())
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.5, 0.8]]) {
      const look = { x: v[0], y: v[1], z: v[2] }
      carryLook(look, from, to)
      // The same cyberspace direction in both frames.
      const cs = (a: ViewAxes, w: { x: number; y: number; z: number }) => {
        const out: Record<string, number> = { x: 0, y: 0, z: 0 }
        ;[a.right, a.up, a.out].forEach((b, i) => { out[b.axis] += b.dir * [w.x, w.y, w.z][i] })
        return out
      }
      expect(cs(to, look)).toEqual(cs(from, { x: v[0], y: v[1], z: v[2] }))
    }
  })

  it('the keys stay level however far you look down: W is forward on the floor, never down', () => {
    const local = viewAxes(canonicalQuaternion())
    for (const pitch of [0, 0.5, 1.0, 1.4, 1.55]) {
      for (const yaw of [0, 0.3, 1.2, 2.5, -2.0]) {
        // The camera looking along `forward`, pitched down, with no roll.
        const forward = new Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
        const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
        const up = new Vector3().crossVectors(right, forward).normalize()
        const out = forward.clone().negate()
        const keys = levelScreenAxes(right, up, out, local)
        expect(keys.up).toEqual({ axis: 'y', dir: 1 })
        expect(keys.out.axis).not.toBe('y')
        expect(keys.right.axis).not.toBe('y')
        // W ('away', -out) points the horizontal way the camera faces.
        const h = new Vector3(forward.x, 0, forward.z)
        const w = keys.out.axis === 'x' ? new Vector3(-keys.out.dir, 0, 0) : new Vector3(0, 0, keys.out.dir)
        expect(w.dot(h)).toBeGreaterThan(0)
      }
    }
  })
})
