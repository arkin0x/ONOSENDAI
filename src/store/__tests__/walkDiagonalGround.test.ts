/**
 * walkDiagonalGround.test.ts - facing diagonally on the ground, WALK goes
 * diagonally (arkinox's play test, 2026-11-10, after #651: "when i face
 * diagonal across the grid of gibsons my movement tended to snap to adjacent
 * gibsons instead of actually moving diagonally, which made me fall a few
 * times and made the controls felt clunky").
 *
 * The heading's snap was right (23 to 67 degrees is the diagonal); the
 * corner rule was not (lib/walkSlide.ts planWalkMove). A diagonal needed both
 * side cells open, and under GRAVITY both standing, and anything else became
 * a straight step: on a diagonal walkway that step went off the edge, and
 * beside a wall built of cubes along the diagonal it zigzagged, one hop a
 * step. Now:
 *
 * - facing 30, 45 or 60 on open floor, each press is x and z together, and a
 *   run is one segment, one hop, one chain event, gravity on or off;
 * - a 1-wide diagonal bridge is walked under GRAVITY without a fall;
 * - a diagonal goes round one wall at its side, but never through a crack
 *   between two walls that meet at a corner;
 * - under GRAVITY a slide (not the way you face) never steps off a ledge;
 * - with BOUNCE about, the ground diagonal is the same, and a diagonal step
 *   up onto a pad launches as a straight one does.
 */
import { provedFor } from '../fixtures/provedHop'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('../../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => 40 }
})
vi.mock('../../lib/relay', async (orig) => {
  const mod = await orig<typeof import('../../lib/relay')>()
  // Offline under these overrides too: no live relay is ever asked (src/test/offlineRelay.ts).
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { fallState, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useToast } from '../useToast'
import { clearWalls } from '../walkWalls'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { walkFacing } from '../../lib/walkEye'
import { walkKeysReleased } from '../../hooks/useKeyboard'
import type { Position, ViewAxes } from '../../lib/space'

/** Right +X, up +Y, toward the camera +Z: level, as WALK's keys are. */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

const worldItemsOriginal = useShards.getState().worldItems

type V3 = [number, number, number]

/** Closed boxes from `lo` to `hi`, in gibsons from the shard's origin, at unit 0 (as walkStep.test.ts builds them). */
function boxes(name: string, c: Constrain | null, list: Array<[V3, V3]>, extra: Partial<ShardModel> = {}): ShardModel {
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
  const model: ShardModel = { ...newShard(name), mode: 'solid', vertices, faces, ...extra }
  // null: no constrain field at all, which a walker reads as off (DECK-0003 §1.12).
  return c === null ? model : withConstrain(model, c)
}

/** The world holds exactly these shards, each with its origin at `start`. */
function world(start: Position, ...shards: ShardModel[]): void {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = shards.map((shard, n) => ({ key: `w${n}-${shard.id}`, type: 'shard', at: { ...start }, plane, height: 84, mine: false, shard }))
  useShards.setState({ worldItems: () => items })
}

/** Facing `deg` degrees right of -Z, level (+X at 90). */
function face(deg: number): void {
  const t = (deg * Math.PI) / 180
  walkFacing.valid = true
  walkFacing.forward = { x: Math.sin(t), y: 0, z: -Math.cos(t) }
  walkFacing.right = { x: Math.cos(t), y: 0, z: Math.sin(t) }
}

/** The walker's offset from where it started. */
function moved(start: Position, p: Position = useCyberspace.getState().cursor): V3 {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

const forward = (n: number): void => { for (let k = 0; k < n; k++) useWalk.getState().press('away') }

let start: Position
beforeEach(async () => {
  posted.length = 0
  walkFacing.valid = false
  walkKeysReleased()
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useShards.setState({ worldItems: worldItemsOriginal })
  clearWalls()
  useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0 })
  await useCyberspace.getState().respawn()
  useCyberspace.getState().cancel()
  useCalibration.setState({ cantorMsByHeight: undefined })
  useToast.setState({ toast: null })
  start = { ...useCyberspace.getState().position }
})

function walk(gravity = false): void {
  useWalk.getState().setGravity(gravity)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
}

/** `s` with a `bounce` in its payload (lib/walkBounce.ts), as sno-core carries a field it does not know. */
function bouncy(s: ShardModel, bounce: unknown): ShardModel {
  return { ...s, extra: { ...s.extra, bounce } }
}

/** A wide floor whose top is 1 under the walker. */
const wideFloor = (): ShardModel => boxes('Floor', 'all', [[[-30, -2, -30], [30, -1, 30]]])

/** A floor 10 under the walker's floor, to fall onto. */
const pit = (): ShardModel => boxes('Low', 'all', [[[-40, -12, -40], [40, -11, 40]]])

/** One gibson of floor at each cell [x, z] from the walker, its top 1 under it. */
const tiles = (name: string, cells: Array<[number, number]>): ShardModel =>
  boxes(name, 'all', cells.map(([x, z]): [V3, V3] => [[x - 0.5, -2, z - 0.5], [x + 0.5, -1, z + 0.5]]))

/** A post 4 tall filling the cell [x, z] from the walker. */
const posts = (name: string, cells: Array<[number, number]>): ShardModel =>
  boxes(name, 'all', cells.map(([x, z]): [V3, V3] => [[x - 0.5, -1, z - 0.5], [x + 0.5, 3, z + 0.5]]))

/** Press forward `n` times, and the walker's offset after each. */
function steps(n: number): V3[] {
  const out: V3[] = []
  for (let k = 0; k < n; k++) { forward(1); out.push(moved(start)) }
  return out
}

/** Each press moved both level axes by exactly one gibson, the way `dx`, `dz`. */
function expectDiagonal(path: V3[], dx: 1 | -1, dz: 1 | -1): void {
  let was: V3 = [0, 0, 0]
  for (const p of path) {
    expect([p[0] - was[0], p[2] - was[2]]).toEqual([dx, dz])
    was = p
  }
}

/** Close the open segment and land every hop it and the queue make; returns the hops posted. */
async function landAll(): Promise<number> {
  useWalk.getState().settle()
  for (let k = 0; k < 50 && (useWalk.getState().queue.length > 0 || useWalk.getState().open); k++) {
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(k))
    await useCyberspace.getState().applyProofMessage(done(posted[k]))
  }
  return posted.length
}

describe('facing diagonally on open floor', () => {
  for (const gravity of [false, true]) {
    for (const [deg, dx, dz] of [[30, 1, -1], [45, 1, -1], [60, 1, -1], [-40, -1, -1], [135, 1, 1], [-150, -1, 1]] as const) {
      it(`facing ${deg}, gravity ${gravity ? 'on' : 'off'}: every press is a true diagonal, and the run is ONE hop`, async () => {
        world(start, wideFloor())
        walk(gravity)
        face(deg)
        const path = steps(10)
        expectDiagonal(path, dx, dz)
        expect(useWalk.getState().queue).toHaveLength(0)
        expect(useWalk.getState().open).toMatchObject({ from: start })
        expect(await landAll()).toBe(1)
        expect(moved(start, posted[0].to)).toEqual([10 * dx, 0, 10 * dz])
        expect(moved(start, useCyberspace.getState().position)).toEqual([10 * dx, 0, 10 * dz])
        // spawn, then ONE hop for the whole run
        expect(useCyberspace.getState().events).toHaveLength(2)
      })
    }
  }

  it('the sector is 45 degrees wide: 23 and 67 are diagonal, 22 and 68 straight', () => {
    world(start, wideFloor())
    walk(true)
    for (const [deg, want] of [[22, [0, 0, -1]], [23, [1, 0, -1]], [67, [1, 0, -1]], [68, [1, 0, 0]]] as const) {
      const from = { ...useCyberspace.getState().cursor }
      face(deg)
      forward(1)
      expect(moved(from)).toEqual(want)
    }
  })
})

describe('a 1-wide diagonal bridge under GRAVITY', () => {
  /** Cells (i, -i): a walkway one gibson wide running at 45 degrees, nothing either side but a long drop. */
  const bridge = (): ShardModel => tiles('Bridge', Array.from({ length: 12 }, (_, i): [number, number] => [i, -i]))

  for (const deg of [30, 45, 60]) {
    it(`facing ${deg}: 10 steps along it, no fall, ONE hop`, async () => {
      world(start, bridge(), pit())
      walk(true)
      face(deg)
      const path = steps(10)
      expectDiagonal(path, 1, -1)
      expect(fallState()).toBeNull()
      expect(useWalk.getState().falling).toBe(false)
      expect(await landAll()).toBe(1)
      expect(moved(start, useCyberspace.getState().position)).toEqual([10, 0, -10])
    })
  }

  it('the other diagonal, and backward along it: no fall', () => {
    world(start, tiles('Bridge', Array.from({ length: 12 }, (_, i): [number, number] => [-i, -i])), pit())
    walk(true)
    face(-45)
    expectDiagonal(steps(6), -1, -1)
    // Backward from there, facing the same way: back down the bridge.
    for (let k = 0; k < 4; k++) useWalk.getState().press('toward')
    expect(moved(start)).toEqual([-2, 0, -2])
    expect(fallState()).toBeNull()
  })

  it('off its far end the diagonal walks on the way you face and falls there: never a step sideways', () => {
    world(start, bridge(), pit())
    walk(true)
    face(45)
    steps(11)
    expect(moved(start)).toEqual([11, 0, -11])
    expect(fallState()).toBeNull()
    forward(1)
    expect(moved(start)).toEqual([12, 0, -12])
    expect(fallState()).not.toBeNull()
  })
})

describe('the corner rule', () => {
  it('a post on either side cell: the diagonal goes round the open side', () => {
    for (const cell of [[1, 0], [0, -1]] as Array<[number, number]>) {
      world(start, wideFloor(), posts('Post', [cell]))
      walk(true)
      face(45)
      forward(1)
      expect(moved(start)).toEqual([1, 0, -1])
      useWalk.getState().exit()
      useCyberspace.setState({ cursor: { ...start } })
    }
  })

  it('a crack between two posts that meet at a corner: no squeezing through, and no step to either side', () => {
    world(start, wideFloor(), posts('Post', [[1, 0], [0, -1]]))
    walk()
    face(45)
    forward(3)
    expect(moved(start)).toEqual([0, 0, 0])
    expect(useToast.getState().toast).toMatchObject({ label: 'WALL', meta: 'Post' })
  })

  it('the diagonal cell a wall: a slide along the side nearer the facing', () => {
    world(start, wideFloor(), posts('Post', [[1, -1]]))
    walk()
    face(30)
    forward(1)
    expect(moved(start)).toEqual([0, 0, -1])
    useWalk.getState().exit()
    useCyberspace.setState({ cursor: { ...start } })
    walk()
    face(60)
    forward(1)
    expect(moved(start)).toEqual([1, 0, 0])
  })

  it('beside a wall of cubes laid along the diagonal (the grid\'s own staircase), the walk goes diagonally, ONE hop, no zigzag', async () => {
    // A cube at (k+1, -k) for every k: each step has a cube on one side cell.
    world(start, wideFloor(), posts('Stair wall', Array.from({ length: 14 }, (_, k): [number, number] => [k + 1, -k])))
    walk(true)
    face(45)
    expectDiagonal(steps(10), 1, -1)
    expect(await landAll()).toBe(1)
  })

  it('under GRAVITY the diagonal cell a wall and no floor either side: nothing, never a step off the ledge', () => {
    world(start, tiles('Perch', [[0, 0]]), posts('Post', [[1, -1]]), pit())
    walk(true)
    face(30)
    forward(3)
    expect(moved(start)).toEqual([0, 0, 0])
    expect(fallState()).toBeNull()
  })

  it('under GRAVITY the diagonal cell a wall and floor on one side: the slide takes the side with the floor', () => {
    // Floor at the start and to the east; nothing to the north. Facing 30 would slide north first.
    world(start, tiles('Perch', [[0, 0], [1, 0]]), posts('Post', [[1, -1]]), pit())
    walk(true)
    face(30)
    forward(1)
    expect(moved(start)).toEqual([1, 0, 0])
    expect(fallState()).toBeNull()
  })

  it('under GRAVITY a straight press angled into a wall never slides off a ledge', () => {
    world(start, tiles('Perch', [[0, 0]]), posts('Wall', [[-1, -1], [0, -1], [1, -1]]), pit())
    walk(true)
    face(10)
    forward(2)
    expect(moved(start)).toEqual([0, 0, 0])
    expect(fallState()).toBeNull()
  })
})

describe('with BOUNCE about', () => {
  it('a bounce pad elsewhere on the floor changes nothing: true diagonals, ONE hop', async () => {
    world(start, wideFloor(), bouncy(boxes('Pad', 'all', [[[-20, -2, 10], [-15, -1, 15]]]), 8))
    walk(true)
    face(45)
    expectDiagonal(steps(6), 1, -1)
    expect(useWalk.getState().falling).toBe(false)
    expect(await landAll()).toBe(1)
  })

  it('a diagonal step up onto a fixed pad launches, as a straight step up does', () => {
    // A pad whose top is 1 up, filling only the diagonal cell's quarter.
    world(start, wideFloor(), bouncy(boxes('Pad', 'all', [[[0.5, -1, -10], [10, 0, -0.5]]]), 6))
    walk(true)
    face(45)
    forward(1)
    expect(moved(start)).toEqual([1, 1, -1])
    expect(useWalk.getState().falling).toBe(true)
  })
})
