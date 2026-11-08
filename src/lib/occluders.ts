/**
 * occluders.ts - which shards stand between the camera and the build cursor.
 *
 * arkinox, 2026-11-08: "in build mode, lets dim any shards between the camera
 * and the cursor to make it easier to see what we are placing inside or around
 * structures."
 *
 * Rays go from the camera to the build cursor's cell: its centre and its eight
 * corners, drawn in a little (CORNER_INSET), so the whole cell stays in sight
 * and a wall that only touches the cell's face is not counted. A shard is an
 * occluder when any ray meets one of its faces before the ray reaches its
 * point (FAR_MARGIN short of it). The test is the faces themselves, through
 * three's own Mesh.raycast, not their bounds: a structure beside the cursor,
 * or behind it, whose box happens to cross a ray, stays solid.
 *
 * Only faces block. A shard's points and its LINES wireframe are see-through
 * already, and three's ray test for them is a thick threshold, not what is
 * drawn. Nothing is allocated per frame: the scene asks at most every
 * RECOMPUTE_MS, and only when something it depends on moved (BuildOccluders).
 */

import { Ray, Raycaster, Vector3, type Intersection, type Mesh, type Object3D } from 'three'

/** How far in from the cell's corners the corner rays aim, in render cells (the cell is one across). */
export const CORNER_INSET = 0.05

/** How far short of its point a ray stops, in render cells: a face on the far side of the point never counts. */
export const FAR_MARGIN = 0.02

/** One shard as the picker sees it: its key, and the group that holds everything it draws. */
export interface OccluderTarget {
  key: string
  object: Object3D
}

/**
 * The nine points the rays aim at: the cell's centre, then its corners drawn
 * `inset` toward it, written into `out` (nine vectors, reused).
 */
export function cellPoints(centre: Vector3, out: Vector3[], inset = CORNER_INSET): Vector3[] {
  const h = 0.5 - inset
  out[0].copy(centre)
  for (let i = 0; i < 8; i++) out[i + 1].set(centre.x + (i & 1 ? h : -h), centre.y + (i & 2 ? h : -h), centre.z + (i & 4 ? h : -h))
  return out
}

/** Nine fresh vectors, for cellPoints. */
export function nineVectors(): Vector3[] {
  return Array.from({ length: 9 }, () => new Vector3())
}

// Hoisted, so a pick allocates only what three's own ray test does per hit.
const caster = new Raycaster()
const hits: Intersection[] = []
const dir = new Vector3()
let hit = false

function testOne(o: Object3D): void {
  if (hit || !(o as Mesh).isMesh) return
  hits.length = 0
  ;(o as Mesh).raycast(caster, hits)
  if (hits.length > 0) hit = true
}

/** Whether a ray from `eye` toward `point` meets a face of `object` before the point. */
function blocks(object: Object3D, eye: Vector3, point: Vector3): boolean {
  dir.subVectors(point, eye)
  const dist = dir.length()
  if (dist <= FAR_MARGIN) return false
  ;(caster.ray as Ray).set(eye, dir.divideScalar(dist))
  caster.near = 0
  caster.far = dist - FAR_MARGIN
  hit = false
  object.traverseVisible(testOne)
  hits.length = 0
  return hit
}

/**
 * The keys of `targets` whose faces stand between `eye` and any of `points`,
 * every position in world space. `skip` names keys never to count (the shard
 * EDIT is moving). Matrices are read as they stand: the caller asks after a
 * render has brought them up to date.
 */
export function pickOccluders(targets: Iterable<OccluderTarget>, eye: Vector3, points: readonly Vector3[], skip?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const t of targets) {
    if (skip?.has(t.key)) continue
    for (const p of points) {
      if (blocks(t.object, eye, p)) { out.add(t.key); break }
    }
  }
  return out
}

/**
 * The dimmed set after a pick, with a little hysteresis: a shard dims as soon
 * as it blocks, and comes back only once it has not blocked for `holdMs`, so
 * one ray grazing an edge on and off as the cursor steps does not flicker it.
 * `seen` keeps, per key, when it last blocked; it is updated in place.
 */
export function settleDimmed(seen: Map<string, number>, blocking: ReadonlySet<string>, now: number, holdMs: number): Set<string> {
  for (const k of blocking) seen.set(k, now)
  const out = new Set<string>()
  for (const [k, at] of seen) {
    if (now - at <= holdMs) out.add(k)
    else seen.delete(k)
  }
  return out
}

/** Two sets with the same members. */
export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const k of a) if (!b.has(k)) return false
  return true
}

/**
 * One step of a fade from `level` toward `target`, at a whole swing (1 to the
 * dim and back) per `fadeMs`. Lands exactly on the target.
 */
export function fadeToward(level: number, target: number, dtMs: number, fadeMs: number, span: number): number {
  if (level === target) return level
  const step = fadeMs > 0 ? (span * dtMs) / fadeMs : Infinity
  return level < target ? Math.min(target, level + step) : Math.max(target, level - step)
}
