/**
 * walkViewGravity.test.ts - GRAVITY follows the view (arkinox, 2026-11-10:
 * "JUMP should always make you go upward relative to how the user sees the
 * screen, and gravity should make you go downward likewise"). Down is the
 * axis nearest the screen's down (lib/walkDown.ts), so with the view turned
 * by the compass's controls:
 *
 * - a fall and a jump go along each of the six axes, and the hops they make
 *   go along that axis only;
 * - a bounce and a springboard launch against that gravity;
 * - walking forward stays on a floor across that gravity, and off its edge
 *   falls along it;
 * - a turn of the view in the air starts a fall from rest along the new down
 *   at the gibson reached, which is a hop of its own; standing, a turn that
 *   leaves nothing under you starts a fall;
 * - in the default view, and any view turned only left or right, nothing is
 *   any different from before: down is -Y, and a turn about Y mid-fall
 *   changes nothing of the fall.
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
import { Vector3, type Quaternion } from 'three'
import { useCyberspace } from '../useCyberspace'
import { fallState, tickFall, useWalk, walkDown } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'
import { clearWalls } from '../walkWalls'
import { DOUBLE_JUMP_SPEED, JUMP_HANG_S, JUMP_SPEED, WALK_GRAVITY, launchSpeed } from '../walkGravity'
import { walkFall, walkFallUp } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { withConstrain } from '../../lib/walkConstrain'
import { canonicalQuaternion, levelScreenAxes, rotateView, viewAxes, type AxisDirection, type Position, type RotateDirection, type ViewAxes } from '../../lib/space'
import { raised, sameDir, upOf, viewDown } from '../../lib/walkDown'

/** Right +X, up +Y, toward the camera +Z: the level keys of the default view. */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

const worldItemsOriginal = useShards.getState().worldItems

type V3 = [number, number, number]
const D = (axis: 'x' | 'y' | 'z', dir: 1 | -1): AxisDirection => ({ axis, dir })
const SIX: AxisDirection[] = [D('y', -1), D('y', 1), D('x', -1), D('x', 1), D('z', -1), D('z', 1)]
const name = (g: AxisDirection): string => `${g.dir < 0 ? '-' : '+'}${g.axis.toUpperCase()}`
const TURNS: RotateDirection[] = ['left', 'right', 'up', 'down']

/** A view the compass's controls reach whose down is `g`. */
function viewFor(g: AxisDirection): Quaternion {
  let frontier: Quaternion[] = [canonicalQuaternion()]
  for (let depth = 0; depth < 4; depth++) {
    for (const q of frontier) if (sameDir(viewDown(q), g)) return q
    frontier = frontier.flatMap((q) => TURNS.map((t) => rotateView(q, t)))
  }
  throw new Error('unreachable')
}

/** Closed boxes from `lo` to `hi`, in gibsons from the shard's origin (cyberspace axes), at unit 0. */
function boxes(label: string, list: Array<[V3, V3]>): ShardModel {
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
  return withConstrain({ ...newShard(label), mode: 'solid', vertices, faces }, 'all')
}

const IDX = { x: 0, y: 1, z: 2 } as const

/**
 * A slab across gravity `g`: its face toward the walker `near` gibsons away
 * along `g`, 1 thick, `half` wide each way on the other two axes, or along
 * `w` only from `from` to `to` (signed by `w`'s direction) when given.
 */
function slab(g: AxisDirection, near: number, opts: { half?: number; w?: AxisDirection; from?: number; to?: number } = {}): [V3, V3] {
  const half = opts.half ?? 10
  const lo: V3 = [-half, -half, -half]
  const hi: V3 = [half, half, half]
  const a = [g.dir * near, g.dir * (near + 1)]
  lo[IDX[g.axis]] = Math.min(...a)
  hi[IDX[g.axis]] = Math.max(...a)
  if (opts.w) {
    const b = [opts.w.dir * opts.from!, opts.w.dir * opts.to!]
    lo[IDX[opts.w.axis]] = Math.min(...b)
    hi[IDX[opts.w.axis]] = Math.max(...b)
  }
  return [lo, hi]
}

/** The world holds exactly these shards, each with its origin at `start`. */
function world(start: Position, ...shards: ShardModel[]): WorldItem[] {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = shards.map((shard, n) => ({ key: `w${n}-${shard.id}`, type: 'shard', at: { ...start }, plane, height: 84, mine: false, shard }))
  useShards.setState({ worldItems: () => items })
  return items
}

const bouncy = (s: ShardModel, bounce: unknown, springboard = false): ShardModel => ({ ...s, extra: { ...s.extra, bounce, ...(springboard ? { springboard: true } : {}) } })

function at(start: Position, p: Position = useCyberspace.getState().cursor): V3 {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

/** `p` moved `n` gibsons along `d`. */
function along(p: Position, d: AxisDirection, n: number): Position {
  return { ...p, [d.axis]: p[d.axis] + BigInt(d.dir * n) }
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
function peakOver(ms: number): number {
  let peak = -Infinity
  for (let t = 0; t < ms; t += 16) { frame(16); if (walkFall.active) peak = Math.max(peak, walkFall.offset) }
  return peak
}

/** The level keys a camera looking straight ahead in `view` gives under its gravity (scene/Scene.tsx ScreenAxes). */
function keysFor(view: Quaternion): ViewAxes {
  return levelScreenAxes(new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), viewAxes(view), viewDown(view))
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

/** Into WALK in `view`, gravity as asked, with that view's level keys. */
function walkIn(view: Quaternion, gravity = true): void {
  useCyberspace.setState({ view })
  useWalk.getState().setGravity(gravity)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: gravity ? keysFor(view) : AXES })
}

describe.each(SIX.map((g) => [name(g), g] as const))('gravity %s', (_, g) => {
  it('a fall goes along it to the floor, and its one hop goes along that axis only', async () => {
    world(start, boxes('Floor', [slab(g, 6)]))
    walkIn(viewFor(g))
    expect(walkDown()).toEqual(g)
    expect(fallState()!.down).toEqual(g)
    expect(walkFallUp).toEqual(upOf(g))
    fallOut()
    const landed = along(start, g, 5)
    expect(useCyberspace.getState().cursor).toEqual(landed)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: landed })
  })

  it('a jump rises 5 against it; gravity off at the top is one hop there, against it only', async () => {
    world(start, boxes('Floor', [slab(g, 1)]))
    walkIn(viewFor(g))
    expect(useWalk.getState().falling).toBe(false)
    useWalk.getState().press('up')
    expect(fallState()!).toMatchObject({ down: g, v0: JUMP_SPEED })
    frame((JUMP_HANG_S / 2) * 1000)
    expect(walkFall.offset).toBeCloseTo(5, 3)
    useWalk.getState().setGravity(false)
    const top = raised(start, g, 5n)
    expect(useCyberspace.getState().cursor).toEqual(top)
    expect(at(start)[IDX[g.axis]]).toBe(-5 * g.dir)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: top })
  })

  it('a jump in place comes back down where it left and publishes nothing', () => {
    world(start, boxes('Floor', [slab(g, 1)]))
    walkIn(viewFor(g))
    useWalk.getState().press('up')
    fallOut()
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(posted).toHaveLength(0)
  })

  it('a pad of 8 under it bounces a jump 8 against it', () => {
    world(start, bouncy(boxes('Pad', [slab(g, 1)]), 8))
    walkIn(viewFor(g))
    useWalk.getState().press('up')
    for (let t = 0; t < 5000 && fallState() && fallState()!.v0 <= JUMP_SPEED + 1e-9; t += 16) frame(16)
    expect(fallState()!).toMatchObject({ down: g })
    expect(fallState()!.v0).toBeCloseTo(launchSpeed(8), 6)
    const peak = peakOver(1500)
    expect(Math.abs(peak - 8)).toBeLessThan(1)
    expect(posted).toHaveLength(0)
  })

  it('walking forward stays on the floor across it, and a flush springboard ahead launches 12 against it', async () => {
    const view = viewFor(g)
    const keys = keysFor(view)
    // 'away' walks into the screen, across gravity.
    const w: AxisDirection = { axis: keys.out.axis, dir: (keys.out.dir < 0 ? 1 : -1) }
    expect(w.axis).not.toBe(g.axis)
    world(start,
      boxes('Floor', [slab(g, 1, { w, from: -10, to: 2.5 })]),
      bouncy(boxes('Board', [slab(g, 1, { w, from: 2.5, to: 40 })]), 12, true))
    walkIn(view)
    useWalk.getState().press('away')
    expect(useCyberspace.getState().cursor).toEqual(along(start, w, 1))
    expect(useWalk.getState().falling).toBe(false)
    useWalk.getState().press('away')
    useWalk.getState().press('away')
    const onto = along(start, w, 3)
    expect(useCyberspace.getState().cursor).toEqual(onto)
    expect(fallState()!).toMatchObject({ down: g })
    expect(fallState()!.v0).toBeCloseTo(launchSpeed(12), 6)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: onto })
  })

  it('walking off the floor\'s edge falls along it', async () => {
    const view = viewFor(g)
    const keys = keysFor(view)
    const w: AxisDirection = { axis: keys.out.axis, dir: (keys.out.dir < 0 ? 1 : -1) }
    world(start, boxes('Ledge', [slab(g, 1, { w, from: -10, to: 0.5 })]), boxes('Below', [slab(g, 4)]))
    walkIn(view)
    useWalk.getState().press('away')
    expect(useWalk.getState().falling).toBe(true)
    expect(fallState()!.down).toEqual(g)
    fallOut()
    expect(useCyberspace.getState().cursor).toEqual(along(along(start, w, 1), g, 3))
  })
})

describe('a turn of the view in the air', () => {
  it('starts a fall from rest along the new down at the gibson reached; that point is a hop of its own', async () => {
    // Nothing under you along -Y for 40; a wall 3 off along -X runs the whole way down.
    world(start, boxes('Deep', [slab(D('y', -1), 40)]), boxes('Wall', [[[-4, -60, -10], [-3, 10, 10]]]))
    walkIn(canonicalQuaternion())
    expect(fallState()!.down).toEqual(D('y', -1))
    frame(500)
    // Half a second down: about 8.3 gibsons, so at least the 8th gibson reached.
    const fell = Math.floor((WALK_GRAVITY * 0.5 * 0.5) / 2)
    // Turned so that down is -X.
    useCyberspace.setState({ view: viewFor(D('x', -1)) })
    const f = fallState()!
    expect(f.down).toEqual(D('x', -1))
    expect(f.v0).toBe(0)
    const bend = f.anchor
    expect(bend.x).toBe(start.x)
    expect(bend.z).toBe(start.z)
    expect(Number(start.y - bend.y)).toBeGreaterThanOrEqual(fell)
    expect(f.waypoints).toEqual([bend])
    expect(useCyberspace.getState().cursor).toEqual(bend)
    fallOut()
    const landed = { ...bend, x: start.x - 2n }
    expect(useCyberspace.getState().cursor).toEqual(landed)
    // Two hops: down to the bend, then across to the wall.
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: bend })
    await land()
    expect(posted[1]).toMatchObject({ from: bend, to: landed })
  })

  it('lands at once on a floor right under you along the new down', async () => {
    // A wall 1 off along -X, from 2 below to far below: falling past it, a turn to -X stands you on it.
    world(start, boxes('Deep', [slab(D('y', -1), 40)]), boxes('Wall', [[[-2, -60, -10], [-1, -2, 10]]]))
    walkIn(canonicalQuaternion())
    frame(400)
    useCyberspace.setState({ view: viewFor(D('x', -1)) })
    expect(fallState()).toBeNull()
    expect(useWalk.getState().falling).toBe(false)
    const bend = useCyberspace.getState().cursor
    expect(bend.x).toBe(start.x)
    expect(bend.y < start.y - 2n).toBe(true)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: bend })
  })

  it('rising in a jump, it drops the rise: the fall along the new down starts from rest', () => {
    world(start, boxes('Floor', [slab(D('y', -1), 1)]), boxes('Wall', [[[-6, -1, -10], [-5, 20, 10]]]))
    walkIn(canonicalQuaternion())
    useWalk.getState().press('up')
    frame(150)
    useCyberspace.setState({ view: viewFor(D('x', -1)) })
    const f = fallState()!
    expect(f).toMatchObject({ down: D('x', -1), v0: 0 })
    expect(f.anchor.y > start.y).toBe(true)
    fallOut()
    expect(useCyberspace.getState().cursor).toEqual({ ...f.anchor, x: start.x - 4n })
  })

  it('a spent double jump stays spent, and a fresh one jumps against the new down', () => {
    world(start, boxes('Deep', [slab(D('y', -1), 40)]), boxes('Wall', [[[-30, -60, -10], [-29, 10, 10]]]))
    walkIn(canonicalQuaternion())
    frame(100)
    expect(useWalk.getState().doubleJump()).toBe(true)
    frame(100)
    useCyberspace.setState({ view: viewFor(D('x', -1)) })
    expect(fallState()!.doubled).toBe(true)
    expect(useWalk.getState().doubleJump()).toBe(false)
    // A new walk: a double jump after the turn goes up along +X.
    useWalk.getState().stop()
    useCyberspace.setState({ view: canonicalQuaternion() })
    useWalk.getState().exit()
    walkIn(canonicalQuaternion())
    frame(100)
    useCyberspace.setState({ view: viewFor(D('x', -1)) })
    expect(useWalk.getState().doubleJump()).toBe(true)
    expect(fallState()!).toMatchObject({ down: D('x', -1), v0: DOUBLE_JUMP_SPEED })
    expect(walkFallUp).toEqual(D('x', 1))
  })

  it('with gravity off, a turn starts nothing', () => {
    world(start)
    walkIn(canonicalQuaternion(), false)
    useCyberspace.setState({ view: viewFor(D('x', -1)) })
    expect(fallState()).toBeNull()
    expect(useCyberspace.getState().cursor).toEqual(start)
  })
})

describe('a turn of the view standing', () => {
  it('with nothing under you along the new down, starts a fall that way; a floor there lands it', async () => {
    world(start, boxes('Floor', [slab(D('y', -1), 1)]), boxes('Wall', [slab(D('z', 1), 3)]))
    walkIn(canonicalQuaternion())
    expect(useWalk.getState().falling).toBe(false)
    useCyberspace.getState().rotate('up')
    expect(walkDown()).toEqual(D('z', 1))
    expect(fallState()!.down).toEqual(D('z', 1))
    fallOut()
    const landed = along(start, D('z', 1), 2)
    expect(useCyberspace.getState().cursor).toEqual(landed)
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ from: start, to: landed })
    // And back: down is -Y again, and the floor is right under you, so you stand.
    await land()
    useCyberspace.getState().rotate('down')
    expect(walkDown()).toEqual(D('y', -1))
    expect(useWalk.getState().falling).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(landed)
  })
})

describe('the default view, as before', () => {
  it('down is -Y, and a turn left or right keeps it', () => {
    world(start, boxes('Floor', [slab(D('y', -1), 1)]))
    walkIn(canonicalQuaternion())
    expect(walkDown()).toEqual(D('y', -1))
    useCyberspace.getState().rotate('left')
    expect(walkDown()).toEqual(D('y', -1))
    useCyberspace.getState().rotate('right')
    useCyberspace.getState().rotate('right')
    expect(walkDown()).toEqual(D('y', -1))
    expect(useWalk.getState().falling).toBe(false)
  })

  it('a turn about Y mid-fall changes nothing of the fall', () => {
    world(start, boxes('Floor', [slab(D('y', -1), 30)]))
    walkIn(canonicalQuaternion())
    frame(300)
    const before = JSON.stringify(fallState(), (_, v) => (typeof v === 'bigint' ? v.toString() : v))
    useCyberspace.getState().rotate('left')
    expect(JSON.stringify(fallState(), (_, v) => (typeof v === 'bigint' ? v.toString() : v))).toBe(before)
    fallOut()
    expect(useCyberspace.getState().cursor).toEqual(along(start, D('y', -1), 29))
  })
})
