/**
 * A compass view turn moves the viewpoint, never the scene.
 *
 * arkinox, 2026-10-07: spectating him, the shards near him make a little
 * temple, and the compass's view turns took it apart. Each shard's place
 * turned with the view but its shape kept facing the old way, and its clip
 * box turned while the shape it cut did not.
 *
 * This draws an asymmetric scene the way the world draws it (placeShard for
 * the place, the scale, the clip box and the pose; flatten for the vertices;
 * renderPose and partMatrix for placed objects; placeCentre and avatarTurn
 * for avatars, one facing its last move and one that has not moved) in
 * every one of the 24 views
 * the compass can reach, and reads every drawn point back out of the view
 * frame. A rigid scene reads back the same in every view: no point drifts,
 * nothing mirrors or shears, and the same points survive the clip.
 */

import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { flatten, type Part, type ShardModel } from 'sno-core/shards'
import { partMatrix } from 'sno-core/parts'
import { alignTo, canonicalQuaternion, placeCentre, rotateView, viewAxes, type Position, type RotateDirection, type ViewAxes } from '../../lib/space'
import { csDirection, renderPose, type V3 } from '../../lib/pose'
import { avatarTurn } from '../../lib/facing'
import { gpsToDataspaceXyz } from '../../lib/hyperspace/landfall'
import { placeShard } from '../WorldShards'

const WHITE: [number, number, number] = [1, 1, 1]

function model(id: string, unit: number, points: Array<[number, number, number]>, faces: Array<[number, number, number]> = [], extra: Partial<ShardModel> = {}): ShardModel {
  return {
    id, name: id, unit, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0,
    vertices: points.map((p) => ({ p, c: WHITE })),
    faces,
    ...extra,
  }
}

/** An L: no mirror or quarter turn of it is itself, so a wrong turn cannot hide. */
const ELL = model('ell', 0, [[0, 0, 0], [3, 0, 0], [3, 1, 0], [1, 1, 0], [1, 4, 2], [0, 4, 2]], [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]])
/** A lopsided tetrahedron built off its own origin, at a coarser unit. */
const TETRA = model('tetra', 1, [[1, 0, -2], [4, 1, -2], [1, 3, -1], [2, 1, 2]], [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]])
/** Nothing but placed objects: two L's, turned and stood apart (DECK-0003 §1.10). */
const PARTS: Part[] = [
  { ref: 0, at: [240, 0, -120], turn: [0, 90, 0], step: 0 },
  { ref: 0, at: [-360, 120, 240], turn: [90, 0, 270], step: 1 },
]
const ASSEMBLY = model('assembly', 0, [], [], { refs: [['a', '33331:00:ell']], parts: PARTS })

/** Somewhere real in dataspace, so the standing shard has a planet under it. */
const HERE = gpsToDataspaceXyz(38.6270, -90.1994)
const at = (dx: bigint, dy: bigint, dz: bigint): Position => ({ x: HERE.x + dx, y: HERE.y + dy, z: HERE.z + dz })

const SCENE = [
  { key: 'ell', at: at(0n, 0n, 0n), height: 12, plane: 0 as const, shard: ELL },
  // Sealed to a region far smaller than it, so the clip cuts it.
  { key: 'ell-cut', at: at(3n, 1n, 2n), height: 1, plane: 0 as const, shard: ELL },
  { key: 'tetra', at: at(9n, -4n, 5n), height: 12, plane: 0 as const, shard: TETRA },
  { key: 'standing', at: at(-6n, 2n, 7n), height: 12, plane: 0 as const, shard: { ...ELL, id: 'standing', up: true, spin: 135 } },
  { key: 'assembly', at: at(-2n, 7n, -9n), height: 12, plane: 0 as const, shard: ASSEMBLY },
]

/**
 * Avatars, drawn as AvatarShape draws them: the avatar's shard in the plain
 * render mapping, scaled, inside a group turned by avatarTurn. One faces the
 * diagonal hop that brought it here, as you and a spectated avatar do (arkinox,
 * 2026-10-08: "the avatar im spectating is always screen-up oriented even if
 * the world is rotated upside down"); one has no move, as presence and
 * targets have none.
 */
const AVATARS = [
  { key: 'avatar-moving', at: at(4n, -1n, 3n), move: [at(3n, -1n, 1n), at(4n, -1n, 3n)] as const, k: 0.7 },
  { key: 'avatar-still', at: at(-5n, 3n, -2n), move: null, k: 0.5 },
]

/** Every view the compass's four turns reach from the canonical one: all 24. */
function reachableViews(): Quaternion[] {
  const seen = new Map<string, Quaternion>()
  const queue = [canonicalQuaternion()]
  while (queue.length > 0) {
    const q = queue.shift()!
    const key = JSON.stringify(viewAxes(q))
    if (seen.has(key)) continue
    seen.set(key, q)
    for (const d of ['left', 'right', 'up', 'down'] as RotateDirection[]) queue.push(rotateView(q, d))
  }
  return [...seen.values()]
}

interface Drawn { point: V3; inside: boolean }

/** Every point the world draws for the scene, in render space, and whether its clip keeps it. */
function draw(anchor: Position, scaleExp: number, axes: ViewAxes): Map<string, Drawn[]> {
  const origin = { x: alignTo(anchor.x, scaleExp), y: alignTo(anchor.y, scaleExp), z: alignTo(anchor.z, scaleExp) }
  const out = new Map<string, Drawn[]>()
  for (const item of SCENE) {
    const w = placeShard(item, origin, scaleExp, axes)
    // The world's group stack: the position, the scale, then the vertices
    // through the pose and the render mapping (ShardMesh flatten).
    const world = new Matrix4().makeTranslation(...w.centre).multiply(new Matrix4().makeScale(w.scale, w.scale, w.scale))
    const pts: Drawn[] = []
    const local = flatten(w.shard, w.pose).positions
    for (let i = 0; i < local.length; i += 3) {
      const v = new Vector3(local[i], local[i + 1], local[i + 2])
      const inside = [v.x, v.y, v.z].every((c, k) => c >= w.clip.min[k] - 1e-9 && c <= w.clip.max[k] + 1e-9)
      const p = v.applyMatrix4(world)
      pts.push({ point: [p.x, p.y, p.z], inside })
    }
    // Placed objects (ShardMesh Placements): the pose as a render turn,
    // then each placement's own matrix, then the placed model's vertices.
    for (const part of w.shard.parts ?? []) {
      const m = world.clone().multiply(renderPose(w.pose)).multiply(new Matrix4().fromArray(partMatrix(part, w.shard.unit, ELL.unit)))
      const v = flatten(ELL).positions
      for (let i = 0; i < v.length; i += 3) {
        const p = new Vector3(v[i], v[i + 1], v[i + 2]).applyMatrix4(m)
        pts.push({ point: [p.x, p.y, p.z], inside: true })
      }
    }
    out.set(item.key, pts)
  }
  for (const a of AVATARS) {
    const m = new Matrix4().makeTranslation(...placeCentre(a.at, origin, scaleExp, axes))
      .multiply(new Matrix4().makeRotationFromQuaternion(avatarTurn(axes, a.move)))
      .multiply(new Matrix4().makeScale(a.k, a.k, a.k))
    const v = flatten(ELL).positions
    const pts: Drawn[] = []
    for (let i = 0; i < v.length; i += 3) {
      const p = new Vector3(v[i], v[i + 1], v[i + 2]).applyMatrix4(m)
      pts.push({ point: [p.x, p.y, p.z], inside: true })
    }
    out.set(a.key, pts)
  }
  return out
}

/** The view frame's signed permutation as a matrix, cyberspace into render: its determinant says mirror or not. */
function det(axes: ViewAxes): number {
  const rows = [axes.right, axes.up, axes.out].map((a) => ['x', 'y', 'z'].map((n) => (n === a.axis ? a.dir : 0)))
  const [[a, b, c], [d, e, f], [g, h, i]] = rows
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

describe('a compass view turn', () => {
  const views = reachableViews()

  it('reaches all 24 axis-aligned views, every one a turn of the canonical frame and none a mirror of it', () => {
    expect(views.length).toBe(24)
    const canonical = det(viewAxes(canonicalQuaternion()))
    for (const q of views) expect(det(viewAxes(q))).toBe(canonical)
  })

  // 2^2 and 2^3 are where arkinox saw it; 2^40 is a long way out.
  for (const scaleExp of [2, 3, 40]) {
    it(`leaves every drawn point of the scene where it was, read back out of the view, at 2^${scaleExp}`, () => {
      const anchor = at(1n, 0n, -1n)
      const reference = draw(anchor, scaleExp, viewAxes(canonicalQuaternion()))
      for (const q of views) {
        const axes = viewAxes(q)
        const drawn = draw(anchor, scaleExp, axes)
        for (const [key, pts] of reference) {
          const now = drawn.get(key)!
          expect(now.length).toBe(pts.length)
          pts.forEach((ref, i) => {
            // Read back into the view-independent frame: where the point is
            // relative to the render origin, in cyberspace axes.
            const back = csDirection(axes, now[i].point)
            const was = csDirection(viewAxes(canonicalQuaternion()), ref.point)
            const tol = 1e-9 * Math.max(1, ...was.map(Math.abs))
            for (let k = 0; k < 3; k++) {
              if (Math.abs(back[k] - was[k]) > tol) {
                throw new Error(`${key} point ${i} drifted in view ${JSON.stringify(axes)}: ${back} vs ${was}`)
              }
            }
            // The clip keeps the same points: it cuts the shape, not the view.
            expect(now[i].inside, `${key} point ${i} clip in view ${JSON.stringify(axes)}`).toBe(ref.inside)
          })
        }
      }
    })
  }

  it('cuts something in the sealed shard, so the clip check above is not vacuous', () => {
    const pts = draw(at(0n, 0n, 0n), 2, viewAxes(canonicalQuaternion())).get('ell-cut')!
    expect(pts.some((p) => p.inside)).toBe(true)
    expect(pts.some((p) => !p.inside)).toBe(true)
  })
})
