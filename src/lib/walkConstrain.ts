/**
 * walkConstrain.ts - a shard's walls in WALK (arkinox, 2026-10-23: "Constrain
 * Movement in WALK mode: OFF/ALL/OPAQUE").
 *
 * A shard may say that a walker cannot cross it: `constrain` in its payload
 * (DECK-0003 §1.12), `all` for every face, `opaque` for the faces of an
 * object that is drawn solid and fully opaque. Absent, or anything else, is
 * off. sno-core 0.1.18 does not know the field, so it rides in the model's
 * `extra`, carried through every read, edit and write untouched; this module
 * is the only place that reads or writes it.
 *
 * | Setting | Which of this object's faces stop a WALK step |
 * |---|---|
 * | off (absent) | none |
 * | all | every face, whatever the mode or opacity |
 * | opaque | every face when the object is SOLID and fully opaque; none when it is see-through (opacity below 100, or LINES or POINTS) |
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

/** A payload's `constrain`, read as §1.12 reads it: `all` or `opaque` exactly, and anything else, absent included, is off. */
export function readConstrain(raw: unknown): Constrain {
  return raw === 'all' || raw === 'opaque' ? raw : 'off'
}

/**
 * A model's setting, from the field sno-core carries for it. A top-level
 * `constrain` is read first, for a sno-core that has learned the field and
 * lifted it out of `extra`; walkConstrain.test.ts fails the day that happens,
 * so the writer here learns it too.
 */
export function constrainOf(s: Pick<ShardModel, 'extra'>): Constrain {
  const top = (s as { constrain?: unknown }).constrain
  return top !== undefined ? readConstrain(top) : readConstrain(s.extra?.[CONSTRAIN_FIELD])
}

/**
 * `s` with its setting at `c`: off is written as no field at all, the
 * canonical form, and `extra` goes when nothing else is in it. The same
 * object when it already says exactly that, so an untouched deploy stays
 * untouched; a malformed value is cleaned away even when it already read as
 * off.
 */
export function withConstrain<T extends ShardModel>(s: T, c: Constrain): T {
  const raw = s.extra?.[CONSTRAIN_FIELD]
  if (c === 'off' ? raw === undefined : raw === c) return s
  const { extra, ...rest } = s
  const kept: Array<[string, unknown]> = extra ? Object.entries(extra).filter(([k]) => k !== CONSTRAIN_FIELD) : []
  if (c !== 'off') kept.push([CONSTRAIN_FIELD, c])
  return (kept.length ? { ...rest, extra: Object.fromEntries(kept) } : rest) as T
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
 * The faces that stop a walker, as triangles in the shard's render frame in
 * its own model units: what ShardMesh draws, before the scene's scale and
 * place. The shard's own come first (`own` of them), since only they are cut
 * at the region's walls; placed objects are not (ShardMesh Placements).
 */
export interface WallMesh {
  /** Nine numbers a triangle: three corners. */
  tris: Float64Array
  /** How many of the triangles, from the start, are the shard's own. */
  own: number
  /** The corners' bounds, or null for no triangles. */
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
  const out: number[] = []
  // A face is a triangle (§1.4); a longer one, should a reader meet it, as a fan.
  const push = (m: ShardModel, pts: Array<[number, number, number]>): void => {
    for (const f of m.faces) {
      for (let k = 1; k + 1 < f.length; k++) {
        const a = pts[f[0]], b = pts[f[k]], c = pts[f[k + 1]]
        if (a && b && c) out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
      }
    }
  }
  // The shard's own corners take the pose through their ticks, as flatten does.
  if (blocks(shard)) push(shard, shard.vertices.map((v) => toRender(posed(ticksOf(v), pose))))
  const own = out.length / 9
  // Its parts, through the pose as a turn in the render frame (Placements' `turn`).
  const root = pose ? Array.from(renderPose(pose).elements) : IDENTITY
  const place = (parent: ShardModel, list: readonly Placed[], frame: M4): void => {
    for (const p of list) {
      const m = p.model
      if (!m || m.unit + p.part.step < 0 || m.unit + p.part.step > MAX_UNIT) continue
      const f = mul(frame, partMatrix(p.part, parent.unit, m.unit))
      if (blocks(m)) {
        push(m, m.vertices.map((v) => {
          const r = toRender(ticksOf(v))
          return [
            f[0] * r[0] + f[4] * r[1] + f[8] * r[2] + f[12],
            f[1] * r[0] + f[5] * r[1] + f[9] * r[2] + f[13],
            f[2] * r[0] + f[6] * r[1] + f[10] * r[2] + f[14],
          ]
        }))
      }
      if (p.children.length) place(m, p.children, f)
    }
  }
  place(shard, placed, root)
  const tris = Float64Array.from(out)
  if (tris.length === 0) return { tris, own: 0, min: null, max: null }
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
    if (tris[i + k] < min[k]) min[k] = tris[i + k]
    if (tris[i + k] > max[k]) max[k] = tris[i + k]
  }
  return { tris, own, min, max }
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

/**
 * How far along a straight step the first blocking face is, in model units,
 * or null when nothing is in the way. The step starts at `o` (the shard's
 * render frame, model units) and goes `s` (+1 or -1) along render axis `i`,
 * at most `maxT`. A face nearer than `minT` is the one the walker stands on,
 * and does not hold it: it can always step off. A face at exactly `maxT`
 * does: a step never lands on a wall. With `clip`, a hit on the shard's own
 * faces counts only inside the region box, where those faces are drawn.
 */
export function firstHit(mesh: WallMesh, o: readonly [number, number, number], i: 0 | 1 | 2, s: 1 | -1, maxT: number, minT: number, clip?: Box): number | null {
  const j = (i + 1) % 3, k = (i + 2) % 3
  const t = mesh.tris
  const pj = o[j], pk = o[k], pi = o[i]
  let best: number | null = null
  for (let n = 0; n < t.length; n += 9) {
    const aj = t[n + j], ak = t[n + k], bj = t[n + 3 + j], bk = t[n + 3 + k], cj = t[n + 6 + j], ck = t[n + 6 + k]
    // Cheap rejects first: the ray's line passes beside the triangle.
    if (pj < Math.min(aj, bj, cj) - NEAR || pj > Math.max(aj, bj, cj) + NEAR) continue
    if (pk < Math.min(ak, bk, ck) - NEAR || pk > Math.max(ak, bk, ck) + NEAR) continue
    const d = (bj - aj) * (ck - ak) - (bk - ak) * (cj - aj)
    const span = Math.max(Math.max(aj, bj, cj) - Math.min(aj, bj, cj), Math.max(ak, bk, ck) - Math.min(ak, bk, ck))
    if (Math.abs(d) <= FLAT * span * span) continue
    const wa = ((bj - pj) * (ck - pk) - (bk - pk) * (cj - pj)) / d
    const wb = ((cj - pj) * (ak - pk) - (ck - pk) * (aj - pj)) / d
    const wc = 1 - wa - wb
    if (wa < -EDGE_SLACK || wb < -EDGE_SLACK || wc < -EDGE_SLACK) continue
    const h = wa * t[n + i] + wb * t[n + 3 + i] + wc * t[n + 6 + i]
    const along = (h - pi) * s
    if (!(along > minT) || along > maxT) continue
    if (best !== null && along >= best) continue
    if (clip && n / 9 < mesh.own) {
      const hit = [0, 0, 0]
      hit[i] = h; hit[j] = pj; hit[k] = pk
      let inside = true
      for (let q = 0; q < 3; q++) if (hit[q] < clip.min[q] - EDGE_SLACK || hit[q] > clip.max[q] + EDGE_SLACK) inside = false
      if (!inside) continue
    }
    best = along
  }
  return best
}
