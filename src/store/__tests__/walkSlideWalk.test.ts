/**
 * walkSlideWalk.test.ts - WALK's diagonal steps and wall sliding in the walk
 * store, among real shard walls (store/useWalk.ts press, lib/walkSlide.ts,
 * RULED 2026-11-03):
 *
 * - a corridor corner: angled into its end wall you slide round the corner,
 *   straight on you stop, angled into the corner's own wall you stop;
 * - the constrain rules decide what is a wall, as for a straight step: ALL
 *   and a solid OPAQUE hold and slide you; a see-through OPAQUE, OFF and no
 *   setting at all do not, and you walk straight on through;
 * - a diagonal into a wall slides along it, never through its corner;
 * - a riser is climbed while sliding and on a diagonal;
 * - a diagonal step is ONE hop, ONE chain event, changing two axes, and costs
 *   per axis what the two straight steps would;
 * - under GRAVITY a diagonal off a ledge stops past the edge and falls;
 * - W with D held, and the facing, both make the diagonal; S mirrors W.
 *
 * Review of #594 (the reviewer's probes, now with what they must do): a
 * diagonal is walked gibson by gibson, so a pillar inside a coarse step's
 * square holds it; past 16 gibsons a press is no diagonal; under GRAVITY
 * both side cells must hold you; facing 50 then 40 is one diagonal, one hop;
 * and a diagonal segment is budgeted for both its trees.
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

import { estimateHopCost } from 'cyberspace-core'
import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { WALK_SEGMENT_BUDGET_MS, fallState, segmentAffordable, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useToast } from '../useToast'
import { clearWalls } from '../walkWalls'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { walkFacing } from '../../lib/walkEye'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
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

/** A floor whose top is 1 under the walker (who stands at y 1 over it, in the shards' frame at y 0). */
const floor = (): ShardModel => boxes('Floor', 'all', [[[-10, -2, -20], [20, -1, 10]]])

/**
 * A corridor running -Z from the walker, x -1 to 1, its end wall's face at
 * z -8, turning +X past an inner corner at z -4.5: the corner's block is
 * the right wall up to there. Walls 4 high.
 */
const corridor = (c: Constrain | null, extra: Partial<ShardModel> = {}): ShardModel => boxes('Corridor', c, [
  [[-4, -1, -20], [-2, 3, 10]],
  [[-4, -1, -10], [20, 3, -8]],
  [[2, -1, -4.5], [20, 3, 10]],
], extra)

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

function walk(): void {
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
}

describe('a corridor corner', () => {
  it('angled right into the end wall, the walk slides round the corner: two hops, never back', async () => {
    world(start, floor(), corridor('all'))
    walk()
    face(10)
    forward(7)
    // Straight down the corridor to a gibson short of the end wall.
    expect(moved(start)).toEqual([0, 0, -7])
    const path: V3[] = []
    for (let k = 0; k < 6; k++) { forward(1); path.push(moved(start)) }
    // Then along the end wall, round the corner, one gibson a press.
    expect(path).toEqual([1, 2, 3, 4, 5, 6].map((x) => [x, 0, -7]))
    // Two headings, two segments: down the corridor, then along the wall.
    expect(useWalk.getState().queue).toHaveLength(1)
    expect(useWalk.getState().open).toMatchObject({ axis: 'x', dir: 1 })
    useWalk.getState().settle()
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    await useCyberspace.getState().applyProofMessage(done(posted[0]))
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    await useCyberspace.getState().applyProofMessage(done(posted[1]))
    expect(moved(start, useCyberspace.getState().position)).toEqual([6, 0, -7])
    // spawn, the corridor, the slide
    expect(useCyberspace.getState().events).toHaveLength(3)
  })

  it('straight on into the end wall does nothing, and says WALL', () => {
    world(start, floor(), corridor('all'))
    walk()
    face(0)
    forward(12)
    expect(moved(start)).toEqual([0, 0, -7])
    expect(useToast.getState().toast).toMatchObject({ label: 'WALL', meta: 'Corridor' })
    // A hair off straight is still straight on.
    face(3)
    forward(3)
    expect(moved(start)).toEqual([0, 0, -7])
  })

  it('angled left, into the wall the corridor does not turn by: it slides to that wall and stops', () => {
    world(start, floor(), corridor('all'))
    walk()
    face(-10)
    forward(12)
    expect(moved(start)).toEqual([-1, 0, -7])
  })

  it('BACKWARD mirrors it: facing back up the corridor, angled 10 to the right, S backs down it and slides round the corner', () => {
    world(start, floor(), corridor('all'))
    walk()
    // Facing +Z, angled 10 degrees to its right (-X): backward is -Z leaning +X.
    face(180 + 10)
    for (let k = 0; k < 13; k++) useWalk.getState().press('toward')
    expect(moved(start)).toEqual([6, 0, -7])
  })

  const cases: Array<[string, Constrain | null, Partial<ShardModel>, boolean]> = [
    ['ALL', 'all', {}, true],
    ['OPAQUE, solid and opaque', 'opaque', {}, true],
    ['OPAQUE, see-through', 'opaque', { opacity: 50 }, false],
    ['OFF', 'off', {}, false],
    ['no setting at all', null, {}, false],
  ]
  for (const [name, c, extra, holds] of cases) {
    it(`walls set to ${name} ${holds ? 'hold and slide you' : 'are walked through, straight on'}`, () => {
      world(start, floor(), corridor(c, extra))
      walk()
      face(10)
      forward(10)
      expect(moved(start)).toEqual(holds ? [3, 0, -7] : [0, 0, -10])
    })
  }
})

describe('a diagonal', () => {
  it('is one step on two axes, and a run of them one segment: ONE hop, ONE chain event', async () => {
    world(start, floor())
    walk()
    face(45)
    forward(1)
    expect(moved(start)).toEqual([1, 0, -1])
    forward(2)
    expect(moved(start)).toEqual([3, 0, -3])
    expect(useWalk.getState().queue).toHaveLength(0)
    expect(useWalk.getState().open).toMatchObject({ from: start })
    useWalk.getState().settle()
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].from).toEqual(start)
    expect(moved(start, posted[0].to)).toEqual([3, 0, -3])
    await useCyberspace.getState().applyProofMessage(done(posted[0]))
    expect(moved(start, useCyberspace.getState().position)).toEqual([3, 0, -3])
    // spawn, then ONE hop for the diagonal walk
    const events = useCyberspace.getState().events
    expect(events).toHaveLength(2)
    expect(posted).toHaveLength(1)
  })

  it('costs per axis what the two straight steps would, so its proof is as small as theirs', () => {
    const plane = useCyberspace.getState().plane as 0 | 1
    for (let k = 0; k < 64; k++) {
      const from = { x: start.x + BigInt(k), y: start.y, z: start.z - BigInt(k * 3) }
      const diag = estimateHopCost(from.x, from.y, from.z, from.x + 1n, from.y, from.z - 1n, plane, 40)
      const alongX = estimateHopCost(from.x, from.y, from.z, from.x + 1n, from.y, from.z, plane, 40)
      const alongZ = estimateHopCost(from.x, from.y, from.z, from.x, from.y, from.z - 1n, plane, 40)
      expect(diag.lcaX).toBe(alongX.lcaX)
      expect(diag.lcaZ).toBe(alongZ.lcaZ)
      expect(diag.lcaY).toBe(0)
      expect(Math.max(diag.lcaX, diag.lcaY, diag.lcaZ)).toBe(Math.max(alongX.lcaX, alongZ.lcaZ))
    }
  })

  it('into a wall, slides along it and never through its corner', () => {
    world(start, floor(), corridor('all'))
    walk()
    face(45)
    forward(1)
    expect(moved(start)).toEqual([1, 0, -1])
    // The right wall is at x 2: on along it, -Z only.
    forward(3)
    expect(moved(start)).toEqual([1, 0, -4])
    // Past the inner corner (z -4.5) the diagonal opens again.
    forward(1)
    expect(moved(start)).toEqual([1, 0, -5])
    forward(1)
    expect(moved(start)).toEqual([2, 0, -6])
    forward(1)
    expect(moved(start)).toEqual([3, 0, -7])
    // The end wall: along it, +X.
    forward(1)
    expect(moved(start)).toEqual([4, 0, -7])
  })

  it('climbs a riser on the way, the same on both ways round its square', () => {
    // A riser 1 high from z -1.5 on, across the whole floor.
    world(start, floor(), boxes('Riser', 'all', [[[-10, -1, -20], [20, 0, -1.5]]]))
    walk()
    face(45)
    forward(1)
    expect(moved(start)).toEqual([1, 0, -1])
    forward(1)
    // Up onto the riser in the same diagonal step: three axes in one step, still one segment.
    expect(moved(start)).toEqual([2, 1, -2])
    expect(useWalk.getState().queue).toHaveLength(0)
  })
})

describe('a slide', () => {
  it('climbs a riser on the way along the wall', () => {
    // A riser 1 high along the end wall from x 3.5 on.
    world(start, floor(), corridor('all'), boxes('Riser', 'all', [[[3.5, -1, -8], [20, 0, -4.5]]]))
    walk()
    face(10)
    forward(7 + 3)
    expect(moved(start)).toEqual([3, 0, -7])
    forward(1)
    expect(moved(start)).toEqual([4, 1, -7])
    forward(1)
    expect(moved(start)).toEqual([5, 1, -7])
  })
})

describe('under GRAVITY', () => {
  it('a diagonal off a floor\'s outside corner stops past the edge, and the fall starts there', () => {
    // A floor under the walker with its -Z, +X quarter cut away past half a gibson, and a floor 4 further down.
    world(start, boxes('Ledge', 'all', [[[-10, -2, -10], [0.5, -1, 10]], [[0.5, -2, -0.5], [10, -1, 10]]]), boxes('Low', 'all', [[[-10, -6, -10], [20, -5, 10]]]))
    useWalk.getState().setGravity(true)
    walk()
    face(45)
    forward(1)
    expect(moved(start)).toEqual([1, 0, -1])
    expect(fallState()).not.toBeNull()
    // The step that walked off is a hop of its own, queued now.
    expect(useWalk.getState().queue.map((p) => moved(start, p))).toEqual([[1, 0, -1]])
  })

  it('a diagonal whose side cell is past a ledge\'s edge is the straight step instead: no diagonal over a gap (review of #594)', () => {
    world(start, boxes('Ledge', 'all', [[[-10, -2, -10], [0.5, -1, 10]]]), boxes('Low', 'all', [[[-10, -6, -10], [20, -5, 10]]]))
    useWalk.getState().setGravity(true)
    walk()
    face(45)
    forward(1)
    expect(moved(start)).not.toEqual([1, 0, -1])
    const m = moved(start)
    expect(Math.abs(m[0]) + Math.abs(m[2])).toBe(1)
  })
})

describe('the keyboard', () => {
  const key = (code: string) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {} })

  it('W with D held steps forward and right, whichever key repeats; let go of D and W is straight again', () => {
    world(start, floor())
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    expect(moved(start)).toEqual([0, 0, -1])
    walkKeyDown(key('KeyD'))
    expect(moved(start)).toEqual([1, 0, -2])
    walkKeyDown(key('KeyD'))
    expect(moved(start)).toEqual([2, 0, -3])
    walkKeyUp('KeyD')
    walkKeyDown(key('KeyW'))
    expect(moved(start)).toEqual([2, 0, -4])
  })

  it('S with A held steps back and left', () => {
    world(start, floor())
    walk()
    face(0)
    walkKeyDown(key('KeyA'))
    expect(moved(start)).toEqual([-1, 0, 0])
    walkKeyDown(key('KeyS'))
    expect(moved(start)).toEqual([-2, 0, 1])
  })

  it('W follows the facing: at 45 degrees W alone is the diagonal', () => {
    world(start, floor())
    walk()
    face(45)
    walkKeyDown(key('KeyW'))
    expect(moved(start)).toEqual([1, 0, -1])
    walkKeyDown(key('KeyS'))
    expect(moved(start)).toEqual([0, 0, 0])
  })
})

describe('review of #594', () => {
  it('a post across either way round a one-gibson diagonal holds it: the press slides instead', () => {
    // Across the way that goes +X first and then -Z, along x 1.
    world(start, floor(), boxes('Post', 'all', [[[0.8, -1, -0.7], [1.2, 3, -0.3]]]))
    walk()
    face(45)
    forward(1)
    const m = moved(start)
    expect(m).not.toEqual([1, 0, -1])
    expect(Math.abs(m[0]) + Math.abs(m[2])).toBe(1)
  })

  it('known limit: a post wholly inside one gibson\'s square, touching neither way round, is not seen (the walls are asked along axes)', () => {
    world(start, floor(), boxes('Post', 'all', [[[0.3, -1, -0.7], [0.7, 3, -0.3]]]))
    walk()
    face(45)
    forward(1)
    expect(moved(start)).toEqual([1, 0, -1])
  })

  it('at 2^3 a 2x2 pillar in the middle of the 8x8 square holds the diagonal short of it', () => {
    world(start, floor(), boxes('Pillar', 'all', [[[3, -1, -5], [5, 3, -3]]]))
    walk()
    useCyberspace.setState({ scaleExp: 3 })
    face(45)
    forward(1)
    expect(moved(start)).toEqual([2, 0, -2])
    expect(useToast.getState().toast).toMatchObject({ label: 'WALL', meta: 'Pillar' })
  })

  it('the same pillar on a straight line holds a straight step (control)', () => {
    world(start, floor(), boxes('Pillar', 'all', [[[-1, -1, -5], [1, 3, -3]]]))
    walk()
    useCyberspace.setState({ scaleExp: 3 })
    face(0)
    forward(1)
    expect(moved(start)[2]).toBeGreaterThan(-8)
  })

  it('past 16 gibsons (2^5) a press is no diagonal: the straight step along one axis', () => {
    world(start, floor())
    walk()
    useCyberspace.setState({ scaleExp: 5 })
    face(40)
    forward(1)
    expect(moved(start)).toEqual([0, 0, -32])
  })

  it('under GRAVITY no diagonal crosses between two pits onto a floor that touches only at a corner', () => {
    world(start,
      boxes('A', 'all', [[[-0.5, -2, -0.5], [0.5, -1, 0.5]]]),
      boxes('D', 'all', [[[0.5, -2, -1.5], [1.5, -1, -0.5]]]),
      boxes('Low', 'all', [[[-10, -8, -10], [20, -7, 10]]]))
    useWalk.getState().setGravity(true)
    walk()
    face(45)
    forward(1)
    const m = moved(start)
    // The straight step instead: one axis, off the edge, and the fall starts.
    expect(m).not.toEqual([1, 0, -1])
    expect(Math.abs(m[0]) + Math.abs(m[2])).toBe(1)
    expect(fallState()).not.toBeNull()
  })

  it('under GRAVITY straight into either side cell falls (control)', () => {
    world(start,
      boxes('A', 'all', [[[-0.5, -2, -0.5], [0.5, -1, 0.5]]]),
      boxes('D', 'all', [[[0.5, -2, -1.5], [1.5, -1, -0.5]]]),
      boxes('Low', 'all', [[[-10, -8, -10], [20, -7, 10]]]))
    useWalk.getState().setGravity(true)
    walk()
    face(0)
    forward(1)
    expect(fallState()).not.toBeNull()
  })

  it('facing 50 and then 40 is one diagonal: one segment, one hop', () => {
    world(start, floor())
    walk()
    face(50)
    forward(2)
    face(40)
    forward(2)
    expect(moved(start)).toEqual([4, 0, -4])
    expect(useWalk.getState().queue).toHaveLength(0)
    expect(useWalk.getState().open).toMatchObject({ from: start })
  })

  it('a diagonal segment is budgeted for both its trees: one tree fits where two do not', () => {
    const plane = useCyberspace.getState().plane
    const diag = { x: start.x + 1n, y: start.y, z: start.z - 1n }
    const est = estimateHopCost(start.x, start.y, start.z, diag.x, diag.y, diag.z, plane as 0 | 1, 40)
    // Each tree 60% of the budget, measured.
    useCalibration.setState({ cantorMsByHeight: { [est.lcaX]: WALK_SEGMENT_BUDGET_MS * 0.6, [est.lcaZ]: WALK_SEGMENT_BUDGET_MS * 0.6 } })
    expect(segmentAffordable(start, { ...start, x: diag.x }, plane)).toBe(true)
    expect(segmentAffordable(start, { ...start, z: diag.z }, plane)).toBe(true)
    expect(segmentAffordable(start, diag, plane)).toBe(false)
  })
})
