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
 * point (FAR_MARGIN short of it). The test is the faces themselves, not their
 * bounds: a structure beside the cursor, or behind it, whose box happens to
 * cross a ray, stays solid.
 *
 * Only faces block. A shard's points and its LINES wireframe are see-through
 * already. Nothing is allocated per frame: the scene asks at most every
 * RECOMPUTE_MS, and only when something it depends on moved (BuildOccluders).
 *
 * The test is its own, not three's Mesh.raycast, which tries every triangle of
 * any mesh whose bounding sphere holds the line of sight and collects every
 * hit: a 20,000 triangle floor under the cursor cost 19 ms a recompute (review
 * of #618). Here, per mesh:
 *
 *  1. Its bounding sphere, in world space, against the thin cone the nine rays
 *     make round the line from the camera to the cell's centre. Most meshes
 *     stop here.
 *  2. The camera and the nine points carried into the mesh's own space, and
 *     each ray walked down a bounding volume hierarchy of its triangles
 *     (`bvhOf`), built once per geometry from the positions it rests at.
 *  3. The first triangle met before the point answers for the whole shard: one
 *     yes is all that is asked.
 *
 * A time budget per pick backs this up (`pickWithin`): past it, the shards not
 * reached keep what they were and the next pick starts where this one stopped.
 */

import { BackSide, DoubleSide, FrontSide, Matrix4, Vector3, type BufferGeometry, type Material, type Mesh, type Object3D, type Side } from 'three'

/** How far in from the cell's corners the corner rays aim, in render cells (the cell is one across). */
export const CORNER_INSET = 0.05

/** How far short of its point a ray stops, in render cells: a face on the far side of the point never counts. */
export const FAR_MARGIN = 0.02

/** The most triangles a leaf of the hierarchy holds. */
const LEAF = 8

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

/**
 * A geometry's triangles as a bounding volume hierarchy. Node n's box is
 * bounds[6n .. 6n + 6] (min xyz, max xyz). A leaf has nodes[2n + 1] triangles,
 * from tris[nodes[2n]]; an inner node has a count of 0, its left child right
 * after it (n + 1) and its right child at nodes[2n].
 */
export interface Bvh {
  /** The positions it was built from, and the index: built again only when either is replaced. */
  src: ArrayLike<number>
  index: ArrayLike<number> | null
  tris: Uint32Array
  bounds: Float32Array
  nodes: Int32Array
}

const built = new WeakMap<BufferGeometry, Bvh>()

/**
 * The positions a geometry rests at: ShardMesh hands over its final positions
 * as `userData.rest`, since a shard being born or dissolving moves its live
 * buffer every frame, and a hierarchy built mid-scramble would test the
 * scatter for good. Anything else, the position attribute itself.
 */
function restOf(g: BufferGeometry): ArrayLike<number> | null {
  const rest = g.userData.rest as ArrayLike<number> | undefined
  return rest ?? (g.attributes.position?.array as ArrayLike<number> | undefined) ?? null
}

/** The hierarchy of `g`'s triangles, built on first ask and kept while its positions and index are the same arrays. */
export function bvhOf(g: BufferGeometry): Bvh | null {
  const src = restOf(g)
  if (!src) return null
  const index = (g.index?.array as ArrayLike<number> | undefined) ?? null
  const had = built.get(g)
  if (had && had.src === src && had.index === index) return had
  const b = buildBvh(src, index)
  built.set(g, b)
  return b
}

/** Builds the hierarchy: split at the middle of the widest spread of triangle centres, or in half where that splits nothing. */
export function buildBvh(src: ArrayLike<number>, index: ArrayLike<number> | null): Bvh {
  const count = Math.floor((index ? index.length : src.length / 3) / 3)
  const box = new Float32Array(count * 6)
  const mid = new Float32Array(count * 3)
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) { box[t * 6 + k] = Infinity; box[t * 6 + 3 + k] = -Infinity }
    for (let c = 0; c < 3; c++) {
      const v = index ? index[t * 3 + c] : t * 3 + c
      for (let k = 0; k < 3; k++) {
        const x = src[v * 3 + k]
        if (x < box[t * 6 + k]) box[t * 6 + k] = x
        if (x > box[t * 6 + 3 + k]) box[t * 6 + 3 + k] = x
      }
    }
    for (let k = 0; k < 3; k++) mid[t * 3 + k] = (box[t * 6 + k] + box[t * 6 + 3 + k]) / 2
  }
  const tris = new Uint32Array(count)
  for (let t = 0; t < count; t++) tris[t] = t
  // A binary tree over `count` leaves of one or more triangles has at most 2 count - 1 nodes.
  const most = Math.max(1, 2 * count)
  const bounds = new Float32Array(most * 6)
  const nodes = new Int32Array(most * 2)
  let used = 0
  const node = (start: number, end: number): number => {
    const id = used++
    let cMin0 = Infinity, cMin1 = Infinity, cMin2 = Infinity, cMax0 = -Infinity, cMax1 = -Infinity, cMax2 = -Infinity
    for (let k = 0; k < 3; k++) { bounds[id * 6 + k] = Infinity; bounds[id * 6 + 3 + k] = -Infinity }
    for (let i = start; i < end; i++) {
      const t = tris[i]
      for (let k = 0; k < 3; k++) {
        if (box[t * 6 + k] < bounds[id * 6 + k]) bounds[id * 6 + k] = box[t * 6 + k]
        if (box[t * 6 + 3 + k] > bounds[id * 6 + 3 + k]) bounds[id * 6 + 3 + k] = box[t * 6 + 3 + k]
      }
      const x = mid[t * 3], y = mid[t * 3 + 1], z = mid[t * 3 + 2]
      if (x < cMin0) cMin0 = x; if (x > cMax0) cMax0 = x
      if (y < cMin1) cMin1 = y; if (y > cMax1) cMax1 = y
      if (z < cMin2) cMin2 = z; if (z > cMax2) cMax2 = z
    }
    // A hair of padding, so a face lying flat in a box's wall is still inside it.
    for (let k = 0; k < 3; k++) {
      const pad = 1e-6 + 1e-6 * Math.max(Math.abs(bounds[id * 6 + k]), Math.abs(bounds[id * 6 + 3 + k]))
      bounds[id * 6 + k] -= pad
      bounds[id * 6 + 3 + k] += pad
    }
    const n = end - start
    if (n <= LEAF) { nodes[id * 2] = start; nodes[id * 2 + 1] = n; return id }
    const spread = [cMax0 - cMin0, cMax1 - cMin1, cMax2 - cMin2]
    const axis = spread[0] >= spread[1] && spread[0] >= spread[2] ? 0 : spread[1] >= spread[2] ? 1 : 2
    const at = ([cMin0, cMin1, cMin2][axis] + [cMax0, cMax1, cMax2][axis]) / 2
    let m = start
    for (let i = start; i < end; i++) {
      if (mid[tris[i] * 3 + axis] < at) { const s = tris[i]; tris[i] = tris[m]; tris[m] = s; m++ }
    }
    if (m === start || m === end) m = (start + end) >> 1
    node(start, m)
    nodes[id * 2] = node(m, end)
    nodes[id * 2 + 1] = 0
    return id
  }
  if (count > 0) node(0, count)
  // No triangles, no nodes: nothing to hit.
  return { src, index, tris, bounds: bounds.slice(0, used * 6), nodes: nodes.slice(0, used * 2) }
}

// Hoisted, so a pick allocates nothing but a new hierarchy when it must build one.
const stack = new Int32Array(512)

/**
 * Whether the ray from `o` along `d` (not normalised: the point is at t = 1)
 * meets a triangle of `b` at 0 < t <= `tmax`, facing the way `side` lets a
 * face be hit (three's own rule: FrontSide only from in front).
 */
export function rayHitsBvh(b: Bvh, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, tmax: number, side: Side): boolean {
  if (b.nodes.length === 0) return false
  const ix = dx !== 0 ? 1 / dx : 1e30, iy = dy !== 0 ? 1 / dy : 1e30, iz = dz !== 0 ? 1 / dz : 1e30
  const { bounds, nodes, tris, src, index } = b
  let sp = 0
  stack[sp++] = 0
  while (sp > 0) {
    const n = stack[--sp]
    const o6 = n * 6
    let t0 = 0, t1 = tmax
    let a = (bounds[o6] - ox) * ix, c = (bounds[o6 + 3] - ox) * ix
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c))
    a = (bounds[o6 + 1] - oy) * iy; c = (bounds[o6 + 4] - oy) * iy
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c))
    a = (bounds[o6 + 2] - oz) * iz; c = (bounds[o6 + 5] - oz) * iz
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c))
    if (t0 > t1) continue
    const count = nodes[n * 2 + 1]
    if (count === 0) {
      if (sp + 2 > stack.length) return true // deeper than any real shard: count it, rather than miss a wall
      stack[sp++] = n + 1
      stack[sp++] = nodes[n * 2]
      continue
    }
    const first = nodes[n * 2]
    for (let i = first; i < first + count; i++) {
      const t = tris[i]
      const va = (index ? index[t * 3] : t * 3) * 3
      const vb = (index ? index[t * 3 + 1] : t * 3 + 1) * 3
      const vc = (index ? index[t * 3 + 2] : t * 3 + 2) * 3
      const ax = src[va], ay = src[va + 1], az = src[va + 2]
      const e1x = src[vb] - ax, e1y = src[vb + 1] - ay, e1z = src[vb + 2] - az
      const e2x = src[vc] - ax, e2y = src[vc + 1] - ay, e2z = src[vc + 2] - az
      // Möller-Trumbore. det > 0 is a face seen from in front (its winding counter-clockwise to the ray).
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
      const det = e1x * px + e1y * py + e1z * pz
      if (det === 0 || (side === FrontSide && det < 0) || (side === BackSide && det > 0)) continue
      const inv = 1 / det
      const sx = ox - ax, sy = oy - ay, sz = oz - az
      const u = (sx * px + sy * py + sz * pz) * inv
      if (u < 0 || u > 1) continue
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x
      const v = (dx * qx + dy * qy + dz * qz) * inv
      if (v < 0 || u + v > 1) continue
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv
      if (tt > 0 && tt <= tmax) return true
    }
  }
  return false
}

// One pick's working state, hoisted: the camera, the cell's centre and the nine points, in world space and in a mesh's.
const inv = new Matrix4()
const eyeW = new Vector3()
const axis = new Vector3()
const centreW = new Vector3()
const eyeL = new Vector3()
const pL = new Vector3()
const sc = new Vector3()
const off = new Vector3()
let pts: readonly Vector3[] = []
const tmaxes = new Float64Array(9)
let axisLenSq = 0
let coneR = 0
let hit = false

function sideOf(m: Material | Material[]): Side {
  return Array.isArray(m) ? DoubleSide : m.side
}

/** One object of a shard, while it has not yet been found to block. */
function testOne(o: Object3D): void {
  if (hit || !(o as Mesh).isMesh) return
  const mesh = o as Mesh
  const g = mesh.geometry
  if (!g?.attributes?.position || !mesh.material) return
  if (!g.boundingSphere) g.computeBoundingSphere()
  const s = g.boundingSphere!
  // 1. The sphere against the cone: no ray comes nearer the axis than coneR.
  sc.copy(s.center).applyMatrix4(mesh.matrixWorld)
  const r = s.radius * mesh.matrixWorld.getMaxScaleOnAxis()
  off.subVectors(sc, eyeW)
  const along = axisLenSq > 0 ? Math.min(1, Math.max(0, off.dot(axis) / axisLenSq)) : 0
  off.addScaledVector(axis, -along)
  const reach = r + coneR
  if (off.lengthSq() > reach * reach) return
  // 2. In the mesh's own space, down its hierarchy, ray by ray.
  const b = bvhOf(g)
  if (!b) return
  inv.copy(mesh.matrixWorld).invert()
  eyeL.copy(eyeW).applyMatrix4(inv)
  const side = sideOf(mesh.material)
  for (let k = 0; k < pts.length; k++) {
    const tmax = tmaxes[k]
    if (!(tmax > 0)) continue
    pL.copy(pts[k]).applyMatrix4(inv)
    if (rayHitsBvh(b, eyeL.x, eyeL.y, eyeL.z, pL.x - eyeL.x, pL.y - eyeL.y, pL.z - eyeL.z, tmax, side)) { hit = true; return }
  }
}

/** Whether `object` has a visible face between the camera and any point, as `begin` set them. */
function blocks(object: Object3D): boolean {
  hit = false
  object.traverseVisible(testOne)
  return hit
}

/** Sets up a pick: the camera, the points and what follows from them, once for every shard. */
function begin(eye: Vector3, points: readonly Vector3[]): void {
  eyeW.copy(eye)
  pts = points
  centreW.copy(points[0])
  axis.subVectors(centreW, eyeW)
  axisLenSq = axis.lengthSq()
  coneR = 0
  for (let k = 0; k < points.length; k++) {
    coneR = Math.max(coneR, points[k].distanceTo(centreW))
    const d = points[k].distanceTo(eyeW)
    // Parametric along each ray, so it holds in a mesh's own space too.
    tmaxes[k] = d > FAR_MARGIN ? 1 - FAR_MARGIN / d : 0
  }
}

/** What a pick within a budget found, and where the next one starts. */
export interface Picked {
  blocking: Set<string>
  /** Every shard was asked. */
  done: boolean
  /** The index the next pick starts at. */
  next: number
}

/**
 * Like pickOccluders, for at most about `budgetMs`: from `start` round the
 * list, and once past the budget, the shards not reached keep whether they
 * were in `carry`. At least one shard is always asked.
 */
export function pickWithin(targets: readonly OccluderTarget[], eye: Vector3, points: readonly Vector3[], opts: { budgetMs?: number; start?: number; carry?: ReadonlySet<string>; skip?: ReadonlySet<string>; now?: () => number } = {}): Picked {
  const { budgetMs = Infinity, carry, skip, now = () => performance.now() } = opts
  const n = targets.length
  const out = new Set<string>()
  if (n === 0) return { blocking: out, done: true, next: 0 }
  begin(eye, points)
  const from = ((opts.start ?? 0) % n + n) % n
  const t0 = budgetMs === Infinity ? 0 : now()
  let asked = 0
  for (; asked < n; asked++) {
    if (asked > 0 && budgetMs !== Infinity && now() - t0 > budgetMs) break
    const t = targets[(from + asked) % n]
    if (skip?.has(t.key)) continue
    if (blocks(t.object)) out.add(t.key)
  }
  pts = []
  if (asked < n && carry) {
    for (let i = asked; i < n; i++) {
      const t = targets[(from + i) % n]
      if (carry.has(t.key) && !skip?.has(t.key)) out.add(t.key)
    }
  }
  return { blocking: out, done: asked === n, next: (from + asked) % n }
}

/**
 * The keys of `targets` whose faces stand between `eye` and any of `points`,
 * every position in world space. `skip` names keys never to count (the shard
 * EDIT is moving). Matrices are read as they stand: the caller asks after a
 * render has brought them up to date.
 */
export function pickOccluders(targets: Iterable<OccluderTarget>, eye: Vector3, points: readonly Vector3[], skip?: ReadonlySet<string>): Set<string> {
  return pickWithin(Array.isArray(targets) ? targets : [...targets], eye, points, { skip }).blocking
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
