/**
 * softPick.tsx: how a shard with no solid surface is tapped, and how it is
 * seen while it is being placed.
 *
 * A shard can be nothing but fog, glow or points (DECK-0003 §1.15, §1.16):
 * POINTS at point size 0 with a FOG or LIGHT glow, POINTS at opacity 0 whose
 * glow still shows (glow is read in POINTS mode only), points drawn at a
 * POINT SIZE, or a cloud of the client's own dots. None of those has a face
 * for a tap to land on: the halos take no rays (glowHalos noRaycast), so a
 * tap on the fog did nothing (arkinox, 2026-11-22: "I can't tap on a shard
 * when it's only fog").
 *
 * Such a shard gets a pick volume: a mesh that is only ever raycast, never
 * drawn (`visible` false, and a material that writes neither colour nor
 * depth even if it were), so like every invisible thing it occludes nothing.
 * Its box is the points' box widened by the glow's radius, which is what the
 * tap target measures (TapTarget, Box3.setFromObject reads invisible
 * children too). A ray hits it only where the shard draws: within a halo's
 * radius of a point, or a drawn point's half width; for the client's own
 * dots, which are a few pixels across at any distance, within a fingertip of
 * one (the tap's own slop, as the dots were tapped before). So the empty air
 * in a sparse cloud lets a tap through to what stands inside it.
 *
 * A hit on it is soft (`userData.softPick`), and so is a hit on such a
 * shard's own dots and points, or on the invisible copy a shard at opacity 0
 * keeps (ShardMesh `shard-hit`): it takes the tap
 * only when nothing solid under the same tap is hit nearer than the fog's
 * body (TapTarget softYields), so a solid shard in front of a fog, or
 * standing in its front half, still wins, and a wall behind it does not.
 *
 * While placing (the BUILD ghost), the same shard is outlined: its pick box
 * as thin white edges drawn over everything (depthTest off for the outline
 * only), so a fog you are placing can be seen and lined up even inside or
 * behind other shards (arkinox, 2026-11-22: "the fog shard is invisible
 * while I'm trying to place it in BUILD").
 */

import { useEffect, useMemo } from 'react'
import { Box3, BoxGeometry, BufferGeometry, DoubleSide, EdgesGeometry, Matrix4, Mesh, MeshBasicMaterial, Ray, Vector3, type Intersection, type Object3D, type Raycaster } from 'three'
import { BUILD } from '../lib/palette'
import { drawPlan, pointLookOf, type DrawPlan } from '../lib/pointLook'
import type { ShardModel } from 'sno-core/shards'
import { NO_BLOOM_BLEND } from './shardFaces'

/**
 * Whether a shard draws nothing a tap can land on but points and glow: no
 * faces and no lines of its own, and something to see (points, or a glow
 * that is drawn here). Culled (WALK's own body) or unseen, it has none.
 */
export function softPicked(plan: DrawPlan, cull = false): boolean {
  return !cull && !plan.faces && !plan.lines && (plan.points !== 'none' || plan.halos)
}

/** Whether a model, drawn with glow on, has nothing solid of its own: only points, fog or glow (softPicked). */
export function softModel(shard: ShardModel): boolean {
  if (shard.vertices.length === 0) return false
  return softPicked(drawPlan(shard.mode, pointLookOf(shard)))
}

/**
 * The radius a ray must pass within of a point to hit a soft shard, in model
 * units: its halo's, or its drawn point's half width when that is larger; 0
 * with neither (the client's own dots), which means the tap's own slop.
 */
export function pickRadius(plan: DrawPlan, look: { glowRadius: number; pointSize: number | undefined }): number {
  const halo = plan.halos ? look.glowRadius : 0
  const core = plan.points === 'billboard' ? (look.pointSize ?? 0) / 2 : 0
  return Math.max(halo, core)
}

/** Without a radius, the measured box is widened by this share of its longest side, so a flat sheet of dots is not a box of no depth. */
const BOX_PAD = 0.02

/** The points' box widened by `radius` (or by BOX_PAD of its size with none); null with no points. */
export function pickBox(points: ArrayLike<number>, radius: number): Box3 | null {
  if (points.length < 3) return null
  const box = new Box3()
  const v = new Vector3()
  for (let i = 0; i + 2 < points.length; i += 3) box.expandByPoint(v.set(points[i], points[i + 1], points[i + 2]))
  if (box.isEmpty()) return null
  const size = box.getSize(v)
  box.expandByScalar(radius > 0 ? radius : BOX_PAD * Math.max(size.x, size.y, size.z))
  return box
}

/** Never drawn, and if it ever were, it would write nothing: no colour, no depth. */
export const PICK_MATERIAL = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false, side: DoubleSide })

const inverse = new Matrix4()
const local = new Ray()
const hitAt = new Vector3()
const centre = new Vector3()

/** A soft hit: where the ray enters the fog (`distance` and `point`, as three reports any hit) and where its body lies along the ray (`softPoint`). */
export type SoftIntersection = Intersection & { softPoint: Vector3 }

/**
 * The pick volume's raycast: one hit for the whole shard, or none.
 *
 * The ray must pass within a radius of a point: the halo's or the drawn
 * point's (`radius`), and never less than the raycaster's Points threshold,
 * which a tap target sets to its fingertip slop (TapTarget): all a dot of the
 * client's own has, being a few pixels across at any distance. The
 * hit is where it enters the nearest such sphere, and its body is where the
 * ray passes closest to that point, the middle of what is drawn there. A
 * solid thing is weighed against the body (TapTarget softYields), so one
 * standing in the front of a fog wins its taps, and a wall behind the fog
 * does not. Read at the tap from the final positions, never a birth's
 * scramble.
 */
export function softRaycast(points: ArrayLike<number>, radius: number): (this: Mesh, raycaster: Raycaster, intersects: Intersection[]) => void {
  return function raycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
    // A threshold is in world units; the points are in the shard's own, under its scale (as three's Points.raycast works it).
    // Never less than a fingertip: a halo or a point drawn smaller than that is still a thing to tap.
    const r = Math.max(radius, (raycaster.params.Points?.threshold ?? 0) / Math.max(this.matrixWorld.getMaxScaleOnAxis(), 1e-30))
    if (!(r > 0)) return
    inverse.copy(this.matrixWorld).invert()
    local.copy(raycaster.ray).applyMatrix4(inverse)
    // Quick refusal on the points' box widened by the radius.
    if (!slab(pickBoxCached(this, points, r))) return
    let enter = Infinity
    let deep = Infinity
    const r2 = r * r
    for (let i = 0; i + 2 < points.length; i += 3) {
      centre.set(points[i], points[i + 1], points[i + 2])
      const off = local.distanceSqToPoint(centre)
      if (off > r2) continue
      // Along the ray to its closest approach, then back by half the chord: where it enters this sphere (0 from inside).
      const along = hitAt.copy(centre).sub(local.origin).dot(local.direction)
      const half = Math.sqrt(Math.max(0, r2 - off))
      if (along + half < 0) continue
      const t = Math.max(0, along - half)
      if (t >= enter) continue
      enter = t
      deep = Math.max(t, along)
    }
    if (enter === Infinity) return
    const point = local.at(enter, new Vector3()).applyMatrix4(this.matrixWorld)
    const distance = raycaster.ray.origin.distanceTo(point)
    if (distance < raycaster.near || distance > raycaster.far) return
    const softPoint = local.at(deep, new Vector3()).applyMatrix4(this.matrixWorld)
    const hit: SoftIntersection = { distance, point, object: this as Object3D, softPoint }
    intersects.push(hit)
  }
}

/** The points' box widened by `r`, kept on the mesh while `r` stays the same. */
function pickBoxCached(mesh: Mesh, points: ArrayLike<number>, r: number): Box3 {
  const kept = mesh.userData.pickBox as { r: number; box: Box3; points: ArrayLike<number> } | undefined
  if (kept && kept.r === r && kept.points === points) return kept.box
  const box = pickBox(points, r) ?? new Box3()
  mesh.userData.pickBox = { r, box, points }
  return box
}

/** Where the local ray crosses `box`, as [enter, leave] along it; null when it misses or the box is behind. */
function slab(box: Box3): [number, number] | null {
  let lo = -Infinity
  let hi = Infinity
  const o = local.origin, d = local.direction
  for (const a of ['x', 'y', 'z'] as const) {
    if (d[a] === 0) { if (o[a] < box.min[a] || o[a] > box.max[a]) return null; continue }
    let t0 = (box.min[a] - o[a]) / d[a]
    let t1 = (box.max[a] - o[a]) / d[a]
    if (t0 > t1) [t0, t1] = [t1, t0]
    lo = Math.max(lo, t0)
    hi = Math.min(hi, t1)
    if (lo > hi) return null
  }
  return hi < 0 ? null : [lo, hi]
}

/** How far from `origin` a hit lies for weighing against other things: a soft hit's body, else where it was hit. */
export function hitDepth(hit: Intersection, origin: Vector3): number {
  return ((hit as Partial<SoftIntersection>).softPoint ?? hit.point).distanceTo(origin)
}

/** Whether a hit is on a soft pick (the pick volume, or the invisible copy of a shard at opacity 0). */
export function isSoftHit(object: Object3D): boolean {
  return object.userData?.softPick === true
}

/** A box as a geometry in its own coordinates. */
function boxGeometry(box: Box3): BufferGeometry {
  const size = box.getSize(new Vector3())
  const mid = box.getCenter(new Vector3())
  const g = new BoxGeometry(size.x, size.y, size.z)
  g.translate(mid.x, mid.y, mid.z)
  g.computeBoundingBox()
  return g
}

/**
 * A soft shard's pick volume: raycast only, never drawn, never writing depth.
 * `points` are the final positions, model units, in the shard's own frame.
 */
export function PickVolume({ points, radius }: { points: ArrayLike<number>; radius: number }): JSX.Element | null {
  const box = useMemo(() => pickBox(points, radius), [points, radius])
  const geometry = useMemo(() => (box ? boxGeometry(box) : null), [box])
  useEffect(() => () => { geometry?.dispose() }, [geometry])
  const raycast = useMemo(() => softRaycast(points, radius), [points, radius])
  if (!geometry) return null
  return <mesh name="shard-pick" visible={false} geometry={geometry} material={PICK_MATERIAL} raycast={raycast} frustumCulled={false} userData-softPick />
}

/** The placing ghost's outline of a soft shard: BUILD's white, faint, drawn over everything, never in the bloom. */
export const SOFT_OUTLINE = { color: BUILD, opacity: 0.55 } as const
/** Drawn after everything else in the scene, so nothing is drawn over it. */
export const SOFT_OUTLINE_ORDER = 10

/**
 * A soft shard's outline while it is being placed: the pick box's twelve
 * edges, depthTest and depthWrite off (only these lines), so it shows where
 * the shard goes from inside or behind anything.
 */
export function SoftOutline({ points, radius, dim = 1 }: { points: ArrayLike<number>; radius: number; dim?: number }): JSX.Element | null {
  const box = useMemo(() => pickBox(points, radius), [points, radius])
  const geometry = useMemo(() => {
    if (!box) return null
    const solid = boxGeometry(box)
    const edges = new EdgesGeometry(solid)
    solid.dispose()
    return edges
  }, [box])
  useEffect(() => () => { geometry?.dispose() }, [geometry])
  if (!geometry) return null
  return (
    <lineSegments name="soft-outline" geometry={geometry} frustumCulled={false} renderOrder={SOFT_OUTLINE_ORDER} raycast={noPick}>
      {/* Its own share (userData-share), so EDIT's breath fades it from there, as it fades faces (WorldShards breatheMaterial). */}
      <lineBasicMaterial color={SOFT_OUTLINE.color} toneMapped={false} transparent opacity={SOFT_OUTLINE.opacity * dim} depthTest={false} depthWrite={false} userData-share={SOFT_OUTLINE.opacity * dim} {...NO_BLOOM_BLEND} />
    </lineSegments>
  )
}

/** The outline is for the eye only: no ray ever lands on it. */
function noPick(): void {}
