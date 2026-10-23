/**
 * walkConstrain.ts - a shard's walls in WALK (arkinox, 2026-10-23: "Constrain
 * Movement in WALK mode: OFF/ALL/OPAQUE").
 *
 * A shard may say that a walker cannot cross it: `constrain` in its payload
 * (DECK-0003 §1.12), `all` for every face, `opaque` for the faces of an
 * object that is drawn solid and fully opaque, `off` for none. sno-core does
 * not know the field, so it rides in the model's `extra`, carried through
 * every read, edit and write untouched; this module is the only place that
 * reads or writes it.
 *
 * | Setting | Which of this object's faces stop a WALK step |
 * |---|---|
 * | off | none |
 * | all | every face, whatever the mode or opacity |
 * | opaque | every face when the object is SOLID and fully opaque; none when it is see-through (opacity below 100, or LINES or POINTS) |
 *
 * Two readings of one field (arkinox, 2026-10-23: "ALL shards should publish
 * with the OPAQUE option on by default"):
 *
 * | The payload says | A walker meets (readConstrain, constrainOf) | The workshop shows and publishes (authoredConstrain) |
 * |---|---|---|
 * | `all` / `opaque` / `off` | that | that |
 * | nothing | off: every shard published before the default keeps its meaning | opaque: the author has not chosen, so the default |
 * | anything else | off | opaque: not a choice either |
 *
 * So OFF is written as `"off"`, never as no field, or the next publish would
 * turn it to OPAQUE. Every SNO payload this app publishes goes through
 * withAuthoredConstrain (lib/published.ts, lib/hidden.ts); an avatar does not,
 * since every reader ignores the field there (§3.3).
 *
 * Each object is judged by its own setting, mode and opacity, and never by
 * its parent's (§1.10): a room placed in a parts-only object holds you by
 * the room's own setting, and the water placed in a pool lets you through by
 * the water's.
 *
 * The test is geometric and exact on the lattice: a WALK step is a straight
 * move along one cyberspace axis, so it is a ray along that axis, tested
 * against every blocking triangle in the shard's own frame, measured from the
 * shard's origin with bigint arithmetic first, so nothing far from the origin
 * is ever a float. The avatar is a point, at the centre of its gibson, as the
 * scene draws it; a shard's origin is at the centre of its gibson too, so
 * the two half gibsons cancel. Only HOP's and BUILD's paths never come here.
 */

import { MAX_UNIT, posed, readOpacity, ticksOf, toRender, type ShardModel } from 'sno-core/shards'
import { partMatrix, type Placed } from 'sno-core/parts'
import type { Box } from './clip'
import { renderPose, type Pose } from './pose'

/** What a shard asks of a walker. */
export type Constrain = 'off' | 'all' | 'opaque'

/** What a shard whose author has not chosen publishes as (DECK-0003 §1.12). */
export const CONSTRAIN_DEFAULT: Constrain = 'opaque'

/** The three settings, in the order the controls show them. */
export const CONSTRAINS: readonly Constrain[] = ['off', 'all', 'opaque']

/** Each setting's tooltip, in the workshop and the deploy bar alike. */
export const CONSTRAIN_TIPS: Readonly<Record<Constrain, string>> = {
  off: 'WALK passes through',
  all: 'WALK cannot cross any face',
  opaque: 'WALK cannot cross it while solid and opaque',
}

/** The payload field (DECK-0003 §1.12). */
export const CONSTRAIN_FIELD = 'constrain'

/** A payload's `constrain`, read as §1.12 has a walker read it: `all` or `opaque` exactly, and anything else, `off` and absent included, is off. */
export function readConstrain(raw: unknown): Constrain {
  return raw === 'all' || raw === 'opaque' ? raw : 'off'
}

/** A payload's `constrain` as its author chose it: one of the three words exactly, and anything else, absent included, the default (§1.12). */
export function authoredConstrain(raw: unknown): Constrain {
  return raw === 'all' || raw === 'opaque' || raw === 'off' ? raw : CONSTRAIN_DEFAULT
}

/** The raw field, top level first (see constrainOf). */
function rawConstrain(s: Pick<ShardModel, 'extra'>): unknown {
  const top = (s as { constrain?: unknown }).constrain
  return top !== undefined ? top : s.extra?.[CONSTRAIN_FIELD]
}

/**
 * A model's setting, from the field sno-core carries for it. A top-level
 * `constrain` is read first, for a sno-core that has learned the field and
 * lifted it out of `extra`; walkConstrain.test.ts fails the day that happens,
 * so the writer here learns it too.
 */
export function constrainOf(s: Pick<ShardModel, 'extra'>): Constrain {
  return readConstrain(rawConstrain(s))
}

/** A model's setting as the workshop and the deploy bar show it, and as it publishes: OPAQUE when its author has not chosen. */
export function authoredConstrainOf(s: Pick<ShardModel, 'extra'>): Constrain {
  return authoredConstrain(rawConstrain(s))
}

/** The word a model's author chose, or undefined when nobody chose: absent, or a malformed value. */
export function chosenConstrainOf(s: Pick<ShardModel, 'extra'>): Constrain | undefined {
  const raw = rawConstrain(s)
  return raw === 'all' || raw === 'opaque' || raw === 'off' ? raw : undefined
}

/**
 * `s` with its setting at `c`, written as the word itself: OFF is `"off"`,
 * never no field, so a deliberate OFF survives the default (§1.12). The
 * same object when it already says exactly that, so an untouched deploy
 * stays untouched; a malformed value is replaced.
 */
export function withConstrain<T extends ShardModel>(s: T, c: Constrain): T {
  if (s.extra?.[CONSTRAIN_FIELD] === c) return s
  const { extra, ...rest } = s
  const kept: Array<[string, unknown]> = extra ? Object.entries(extra).filter(([k]) => k !== CONSTRAIN_FIELD) : []
  kept.push([CONSTRAIN_FIELD, c])
  return { ...rest, extra: Object.fromEntries(kept) } as T
}

/**
 * `s` as it publishes: its author's word kept, and OPAQUE written for a shard
 * whose author never chose (a new one, one published before the default, a
 * kit piece or an import without the field). The same object when it already
 * carries a word. Never for an avatar (§3.3).
 */
export function withAuthoredConstrain<T extends ShardModel>(s: T): T {
  return withConstrain(s, authoredConstrainOf(s))
}

/** Whether an object can be seen through: below full opacity, or drawn as points or lines (DECK-0003 §6). */
export function seeThrough(s: Pick<ShardModel, 'mode' | 'opacity'>): boolean {
  return readOpacity(s.opacity) !== undefined || s.mode !== 'solid'
}

/** Whether this object's own faces stop a walker. */
export function blocks(s: Pick<ShardModel, 'mode' | 'opacity' | 'extra'>): boolean {
  const c = constrainOf(s)
  return c === 'all' || (c === 'opaque' && !seeThrough(s))
}

/** A 4x4, column-major, as three.js and sno-core partMatrix write it. */
type M4 = number[]

const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function mul(a: M4, b: M4): M4 {
  const out = new Array<number>(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return out
}

/**
 * One object's walls in its own render frame, model units: every corner once
 * (`corners`, three numbers each) and every triangle as three corner indices
 * (`tris`; a longer face as a fan). Made once per model and shared by every
 * placement of it (2026-10-23): a room of a Maze Kit placed many times over
 * holds its walls once, not once a placement.
 */
export interface ModelWalls {
  corners: Float64Array
  tris: Uint32Array
  /** The corners some triangle uses, each once: what a placement's bounds are taken over. */
  used: Uint32Array
}

const modelWalls = new WeakMap<ShardModel, ModelWalls>()

/** The walls of `m` in its own frame, built once per model object. */
export function wallsOf(m: ShardModel): ModelWalls {
  const held = modelWalls.get(m)
  if (held) return held
  const n = m.vertices.length
  const corners = new Float64Array(n * 3)
  m.vertices.forEach((v, q) => {
    const r = toRender(ticksOf(v))
    corners[q * 3] = r[0]; corners[q * 3 + 1] = r[1]; corners[q * 3 + 2] = r[2]
  })
  let count = 0
  for (const f of m.faces) for (let k = 1; k + 1 < f.length; k++) if (f[0] < n && f[k] < n && f[k + 1] < n) count++
  const tris = new Uint32Array(count * 3)
  const seen = new Uint8Array(n)
  let t = 0
  // A face is a triangle (§1.4); a longer one, should a reader meet it, as a fan.
  // A corner that names no vertex leaves that triangle out, as it always has.
  for (const f of m.faces) for (let k = 1; k + 1 < f.length; k++) {
    const a = f[0], b = f[k], c = f[k + 1]
    if (!(a < n && b < n && c < n)) continue
    tris[t++] = a; tris[t++] = b; tris[t++] = c
    seen[a] = 1; seen[b] = 1; seen[c] = 1
  }
  let u = 0
  for (let q = 0; q < n; q++) u += seen[q]
  const used = new Uint32Array(u)
  u = 0
  for (let q = 0; q < n; q++) if (seen[q]) used[u++] = q
  const walls = { corners, tris, used }
  modelWalls.set(m, walls)
  return walls
}

/** A placed object's walls where it stands: its model's, through `f`, inside `min`..`max`. */
export interface WallPlacement {
  walls: ModelWalls
  /** Column-major, from the model's render frame to the shard's. */
  f: Float64Array
  min: [number, number, number]
  max: [number, number, number]
}

/**
 * The faces that stop a walker, in the shard's render frame in its own model
 * units: what ShardMesh draws, before the scene's scale and place. The
 * shard's own triangles are held here (they are the only ones cut at the
 * region's walls); each object it places is held as its model's shared walls
 * and a placement, and its triangles are worked out only when a step comes
 * near it (firstHit). Built that way, a world of rooms placed by reference
 * costs a few numbers a placement, where it once cost every corner of every
 * placement as an array of its own: entering WALK among Maze Kit rooms froze
 * the tab and grew it by gigabytes (arkinox, 2026-10-23: "I was at 1.9GB and
 * then I went into walk mode, it froze, and then I was suddenly at 6.9GB").
 */
export interface WallMesh {
  /** The shard's own triangles: nine numbers a triangle, three corners. */
  tris: Float64Array
  /** How many triangles the shard's own are. */
  own: number
  /** The objects it places, and theirs, each where it stands. */
  placements: WallPlacement[]
  /** The bounds of every corner of every triangle, own and placed, or null for no triangles. */
  min: [number, number, number] | null
  max: [number, number, number] | null
}

/**
 * Every blocking triangle of `shard` and the objects it places (`placed`, as
 * sno-core resolveParts gives them), standing at `pose` as the world draws it
 * (WorldShards placeShard). A placeholder, or a part scaled out of range,
 * stops nothing: it is a cube the scene draws for something it does not have.
 */
export function wallMesh(shard: ShardModel, placed: readonly Placed[], pose?: Pose): WallMesh {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  // The shard's own corners take the pose through their ticks, as flatten does.
  let tris = new Float64Array(0)
  if (blocks(shard)) {
    const pts = shard.vertices.map((v) => toRender(posed(ticksOf(v), pose)))
    const own = wallsOf(shard).tris
    tris = new Float64Array(own.length * 3)
    for (let q = 0; q < own.length; q++) {
      const p = pts[own[q]]
      for (let k = 0; k < 3; k++) {
        tris[q * 3 + k] = p[k]
        if (p[k] < min[k]) min[k] = p[k]
        if (p[k] > max[k]) max[k] = p[k]
      }
    }
  }
  const placements: WallPlacement[] = []
  // Its parts, through the pose as a turn in the render frame (Placements' `turn`).
  const root = pose ? Array.from(renderPose(pose).elements) : IDENTITY
  const place = (parent: ShardModel, list: readonly Placed[], frame: M4): void => {
    for (const p of list) {
      const m = p.model
      if (!m || m.unit + p.part.step < 0 || m.unit + p.part.step > MAX_UNIT) continue
      const f = mul(frame, partMatrix(p.part, parent.unit, m.unit))
      if (blocks(m)) {
        const walls = wallsOf(m)
        if (walls.tris.length) {
          const at = { walls, f: Float64Array.from(f), min: [Infinity, Infinity, Infinity] as [number, number, number], max: [-Infinity, -Infinity, -Infinity] as [number, number, number] }
          const c = walls.corners
          for (let u = 0; u < walls.used.length; u++) {
            const q = walls.used[u] * 3
            const r0 = c[q], r1 = c[q + 1], r2 = c[q + 2]
            // The same arithmetic, in the same order, as the triangles firstHit makes from it.
            const x = f[0] * r0 + f[4] * r1 + f[8] * r2 + f[12]
            const y = f[1] * r0 + f[5] * r1 + f[9] * r2 + f[13]
            const z = f[2] * r0 + f[6] * r1 + f[10] * r2 + f[14]
            if (x < at.min[0]) at.min[0] = x
            if (x > at.max[0]) at.max[0] = x
            if (y < at.min[1]) at.min[1] = y
            if (y > at.max[1]) at.max[1] = y
            if (z < at.min[2]) at.min[2] = z
            if (z > at.max[2]) at.max[2] = z
          }
          for (let k = 0; k < 3; k++) { if (at.min[k] < min[k]) min[k] = at.min[k]; if (at.max[k] > max[k]) max[k] = at.max[k] }
          placements.push(at)
        }
      }
      if (p.children.length) place(m, p.children, f)
    }
  }
  place(shard, placed, root)
  const any = tris.length > 0 || placements.length > 0
  return { tris, own: tris.length / 9, placements, min: any ? min : null, max: any ? max : null }
}

/** Barycentric slack: a ray through an edge or a corner hits, so two triangles that share an edge leave no seam. */
const EDGE_SLACK = 1e-9
/** The box reject's slack, in model units: it only ever lets a borderline triangle on to the exact test, never decides a hit. */
const NEAR = 1e-9
/**
 * Below this share of its own size squared, a triangle is seen edge-on along
 * the ray: parallel to the step, never crossed. Relative, so a part placed far
 * finer than its parent (a tick-sized tile at a unit 20 below) is still a wall.
 */
const FLAT = 1e-12

/** One placement's corners where it stands, written here a step at a time and reused: no step allocates. */
let scratch = new Float64Array(0)

/**
 * How far along a straight step the first blocking face is, in model units,
 * or null when nothing is in the way. The step starts at `o` (the shard's
 * render frame, model units) and goes `s` (+1 or -1) along render axis `i`,
 * at most `maxT`. A face nearer than `minT` is the one the walker stands on,
 * and does not hold it: it can always step off. A face at exactly `maxT`
 * does: a step never lands on a wall. With `clip`, a hit on the shard's own
 * faces counts only inside the region box, where those faces are drawn.
 *
 * A placed object is passed by when the step's line misses its bounds, and
 * otherwise its corners are put where it stands with exactly the arithmetic
 * that once made its triangles ahead of time, so every hit is the same
 * number to the last bit (walkConstrain.test.ts holds the old way beside the
 * new one).
 */
export function firstHit(mesh: WallMesh, o: readonly [number, number, number], i: 0 | 1 | 2, s: 1 | -1, maxT: number, minT: number, clip?: Box): number | null {
  const j = (i + 1) % 3, k = (i + 2) % 3
  const pj = o[j], pk = o[k], pi = o[i]
  let best: number | null = null
  // One triangle: the cheap rejects, then the exact test.
  const test = (t: Float64Array, a: number, b: number, c: number, own: boolean): void => {
    const aj = t[a + j], ak = t[a + k], bj = t[b + j], bk = t[b + k], cj = t[c + j], ck = t[c + k]
    // Cheap rejects first: the ray's line passes beside the triangle.
    if (pj < Math.min(aj, bj, cj) - NEAR || pj > Math.max(aj, bj, cj) + NEAR) return
    if (pk < Math.min(ak, bk, ck) - NEAR || pk > Math.max(ak, bk, ck) + NEAR) return
    const d = (bj - aj) * (ck - ak) - (bk - ak) * (cj - aj)
    const span = Math.max(Math.max(aj, bj, cj) - Math.min(aj, bj, cj), Math.max(ak, bk, ck) - Math.min(ak, bk, ck))
    if (Math.abs(d) <= FLAT * span * span) return
    const wa = ((bj - pj) * (ck - pk) - (bk - pk) * (cj - pj)) / d
    const wb = ((cj - pj) * (ak - pk) - (ck - pk) * (aj - pj)) / d
    const wc = 1 - wa - wb
    if (wa < -EDGE_SLACK || wb < -EDGE_SLACK || wc < -EDGE_SLACK) return
    const h = wa * t[a + i] + wb * t[b + i] + wc * t[c + i]
    const along = (h - pi) * s
    if (!(along > minT) || along > maxT) return
    if (best !== null && along >= best) return
    if (clip && own) {
      const hit = [0, 0, 0]
      hit[i] = h; hit[j] = pj; hit[k] = pk
      let inside = true
      for (let q = 0; q < 3; q++) if (hit[q] < clip.min[q] - EDGE_SLACK || hit[q] > clip.max[q] + EDGE_SLACK) inside = false
      if (!inside) return
    }
    best = along
  }
  const t = mesh.tris
  for (let n = 0; n < t.length; n += 9) test(t, n, n + 3, n + 6, true)
  for (const p of mesh.placements) {
    // The step's line beside the placement's bounds misses every one of its
    // triangles (each lies inside them); NEAR as the triangle test has it.
    if (pj < p.min[j] - NEAR || pj > p.max[j] + NEAR || pk < p.min[k] - NEAR || pk > p.max[k] + NEAR) continue
    // Along the step: a hit is a mix of a triangle's corners with weights no
    // further below zero than EDGE_SLACK, so it lies within the bounds widened
    // by far less than `wide`.
    const wide = NEAR + 1e-8 * (Math.abs(p.min[i]) + Math.abs(p.max[i]) + 1)
    const near = s > 0 ? p.min[i] - wide - pi : pi - (p.max[i] + wide)
    const far = s > 0 ? p.max[i] + wide - pi : pi - (p.min[i] - wide)
    if (far <= minT || near > maxT || (best !== null && near >= best)) continue
    const { corners, tris } = p.walls
    const f = p.f
    if (scratch.length < corners.length) scratch = new Float64Array(Math.max(corners.length, scratch.length * 2))
    for (let q = 0; q < corners.length; q += 3) {
      const r0 = corners[q], r1 = corners[q + 1], r2 = corners[q + 2]
      scratch[q] = f[0] * r0 + f[4] * r1 + f[8] * r2 + f[12]
      scratch[q + 1] = f[1] * r0 + f[5] * r1 + f[9] * r2 + f[13]
      scratch[q + 2] = f[2] * r0 + f[6] * r1 + f[10] * r2 + f[14]
    }
    for (let n = 0; n < tris.length; n += 3) test(scratch, tris[n] * 3, tris[n + 1] * 3, tris[n + 2] * 3, false)
  }
  return best
}
