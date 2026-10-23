/**
 * walkConstrainShared.test.ts - WALK's walls held once per model, and every
 * answer exactly what it was (2026-10-23).
 *
 * arkinox, 2026-10-23: "I was at 1.9GB and then I went into walk mode, it
 * froze, and then I was suddenly at 6.9GB." Entering WALK built every placed
 * object's triangles ahead of time, a fresh array for every corner of every
 * placement. Now a model's walls are made once and shared, and a placement's
 * triangles are worked out only when a step comes near it.
 *
 * The collision must not move by a bit. So the way it was is kept here,
 * verbatim (`before`), and thousands of random scenes, placed objects nested
 * and turned by any degree, scaled finer and coarser, posed on the Earth and
 * clipped to their region, are asked the same steps both ways: every answer,
 * and the bounds the exact box test is built on, must be the same number.
 */
import { describe, expect, it } from 'vitest'
import { MAX_UNIT, newShard, posed, ticksOf, toRender, type ShardModel } from 'sno-core/shards'
import { partMatrix, type Placed } from 'sno-core/parts'
import { blocks, firstHit, wallMesh, wallsOf, withConstrain, type Constrain } from '../walkConstrain'
import { placedPose, renderPose, type Pose } from '../pose'
import type { Box } from '../clip'
import type { ViewAxes } from '../space'

// ---- The way it was (src/lib/walkConstrain.ts before 2026-10-23), verbatim. ----
type M4 = number[]
const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function mul(a: M4, b: M4): M4 {
  const out = new Array<number>(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return out
}
interface OldMesh { tris: Float64Array; own: number; min: [number, number, number] | null; max: [number, number, number] | null }
function beforeMesh(shard: ShardModel, placed: readonly Placed[], pose?: Pose): OldMesh {
  const out: number[] = []
  const push = (m: ShardModel, pts: Array<[number, number, number]>): void => {
    for (const f of m.faces) {
      for (let k = 1; k + 1 < f.length; k++) {
        const a = pts[f[0]], b = pts[f[k]], c = pts[f[k + 1]]
        if (a && b && c) out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
      }
    }
  }
  if (blocks(shard)) push(shard, shard.vertices.map((v) => toRender(posed(ticksOf(v), pose))))
  const own = out.length / 9
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
const EDGE_SLACK = 1e-9, NEAR = 1e-9, FLAT = 1e-12
function beforeHit(mesh: OldMesh, o: readonly [number, number, number], i: 0 | 1 | 2, s: 1 | -1, maxT: number, minT: number, clip?: Box): number | null {
  const j = (i + 1) % 3, k = (i + 2) % 3
  const t = mesh.tris
  const pj = o[j], pk = o[k], pi = o[i]
  let best: number | null = null
  for (let n = 0; n < t.length; n += 9) {
    const aj = t[n + j], ak = t[n + k], bj = t[n + 3 + j], bk = t[n + 3 + k], cj = t[n + 6 + j], ck = t[n + 6 + k]
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
// ---- end of the way it was ----

/** A seeded generator (mulberry32), so a failure names its scene. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const SETTINGS: Constrain[] = ['all', 'all', 'opaque', 'off']
const REF = ['a', `33331:${'a'.repeat(64)}:r`] as ['a', string]

function scene(seed: number): { root: ShardModel; placed: Placed[]; pose?: Pose; clip?: Box } {
  const r = rng(seed)
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1))
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const model = (unit: number): ShardModel => {
    const n = int(0, 9)
    const vertices = Array.from({ length: n }, () => ({ p: [0, 0, 0] as [number, number, number], t: [int(-480, 480), int(-480, 480), int(-480, 480)] as [number, number, number], c: [1, 1, 1] as [number, number, number] }))
    const faces: number[][] = []
    // Triangles mostly, a quad now and then (read as a fan), and an index past the end once in a while.
    for (let f = 0; n >= 3 && f < int(0, 8); f++) faces.push(r() < 0.15 && n >= 4 ? [int(0, n - 1), int(0, n - 1), int(0, n - 1), int(0, n - 1)] : [int(0, n - 1), int(0, n - 1), r() < 0.03 ? n + 2 : int(0, n - 1)])
    const opacity = r() < 0.2 ? 40 : undefined
    return withConstrain({ ...newShard('m'), unit, mode: r() < 0.85 ? 'solid' : 'lines', vertices, faces: faces as ShardModel['faces'], ...(opacity ? { opacity } : {}) }, pick(SETTINGS))
  }
  const turn = (): [number, number, number] => [pick([0, 90, 180, 270, int(0, 359)]), pick([0, 90, 180, 270, int(0, 359)]), pick([0, 0, 90, int(0, 359)])]
  const parts = (parentUnit: number, depth: number): Placed[] => {
    if (depth > 3) return []
    return Array.from({ length: int(0, depth === 1 ? 5 : 2) }, (): Placed => {
      // Finer and coarser than the parent, now and then by a lot (a tile at a unit far below).
      const unit = Math.max(0, Math.min(MAX_UNIT, parentUnit + pick([0, 0, 1, -1, 2, -3, -20, 12])))
      const m = r() < 0.08 ? null : model(unit)
      const step = pick([0, 0, 0, 1, -1, 2])
      return {
        part: { ref: 0, at: [int(-3000, 3000), int(-3000, 3000), int(-3000, 3000)], turn: turn(), step },
        ref: REF,
        model: m,
        ...(m ? {} : { missing: 'unreachable' as const }),
        children: m && r() < 0.4 ? parts(m.unit, depth + 1) : [],
      }
    })
  }
  const unit = pick([0, 0, 2, 5, 26, 40])
  const root = model(unit)
  const pose = r() < 0.3 ? placedPose(AXES, { at: { x: BigInt(int(-1e6, 1e6)) * 2n ** 60n, y: BigInt(int(-1e6, 1e6)) * 2n ** 60n, z: BigInt(int(-1e6, 1e6)) * 2n ** 60n }, spin: int(0, 359) }) : undefined
  const clip = r() < 0.4 ? { min: [int(-6, 0), int(-6, 0), int(-6, 0)] as [number, number, number], max: [int(0, 6), int(0, 6), int(0, 6)] as [number, number, number] } : undefined
  return { root, placed: parts(unit, 1), pose, clip }
}

describe("WALK's walls, held once a model", () => {
  it('give every step exactly the answer they always did, in thousands of random scenes', () => {
    let hits = 0, steps = 0
    for (let seed = 1; seed <= 1500; seed++) {
      const { root, placed, pose, clip } = scene(seed)
      const was = beforeMesh(root, placed, pose)
      const now = wallMesh(root, placed, pose)
      expect(now.own, `seed ${seed}`).toBe(was.own)
      expect(now.min, `seed ${seed}`).toEqual(was.min)
      expect(now.max, `seed ${seed}`).toEqual(was.max)
      if (!was.tris.length) continue
      const r = rng(seed * 7919)
      for (let q = 0; q < 40; q++) {
        // Aimed at a corner, along an edge, or through a triangle, from just short of it or far off, or anywhere at all.
        const n = Math.floor(r() * (was.tris.length / 9)) * 9
        const wa = r() < 0.3 ? Math.round(r()) : r(), wb = (1 - wa) * (r() < 0.3 ? Math.round(r()) : r())
        const at = [0, 1, 2].map((k) => wa * was.tris[n + k] + wb * was.tris[n + 3 + k] + (1 - wa - wb) * was.tris[n + 6 + k])
        const i = Math.floor(r() * 3) as 0 | 1 | 2
        const s = (r() < 0.5 ? 1 : -1) as 1 | -1
        const span = Math.max(1e-6, ...[0, 1, 2].map((k) => (was.max![k] - was.min![k])))
        const o: [number, number, number] = r() < 0.85 ? [at[0], at[1], at[2]] : [0, 1, 2].map((k) => was.min![k] + r() * (was.max![k] - was.min![k])) as [number, number, number]
        o[i] -= s * span * (r() < 0.5 ? r() : r() * 1e-3)
        const maxT = r() < 0.5 ? span * 2 : Math.abs(at[i] - o[i]) * (r() < 0.5 ? 1 : 1 - 1e-12)
        const minT = r() < 0.9 ? span * 1e-9 : span * r() * 0.5
        const a = beforeHit(was, o, i, s, maxT, minT, clip)
        const b = firstHit(now, o, i, s, maxT, minT, clip)
        expect(Object.is(a, b), `seed ${seed} ray ${q}: was ${a}, now ${b}`).toBe(true)
        steps++
        if (a !== null) hits++
      }
    }
    // The scenes really are hit, often.
    expect(steps).toBeGreaterThan(20_000)
    expect(hits).toBeGreaterThan(steps / 5)
  })

  it('make one model\'s walls once, however many times it is placed', () => {
    const room = withConstrain({ ...newShard('Room'), mode: 'solid', vertices: Array.from({ length: 300 }, (_, q) => ({ p: [q % 10, Math.floor(q / 10) % 10, Math.floor(q / 100)] as [number, number, number], c: [1, 1, 1] as [number, number, number] })), faces: Array.from({ length: 280 }, (_, q) => [q, q + 1, q + 10]) }, 'all')
    const placed: Placed[] = Array.from({ length: 500 }, (_, q) => ({ part: { ref: 0, at: [q * 1200, 0, 0], turn: [0, 90 * (q % 4), 0], step: 0 }, ref: REF, model: room, children: [] }))
    const m = wallMesh({ ...newShard('Maze'), vertices: [], faces: [] }, placed)
    expect(m.placements).toHaveLength(500)
    // One model's corners and triangles, the same arrays in every placement: 500 placements hold no triangles of their own.
    const walls = wallsOf(room)
    expect(m.placements.every((p) => p.walls === walls)).toBe(true)
    expect(m.tris.length).toBe(0)
    expect(walls.corners.length).toBe(900)
    expect(walls.tris.length).toBe(280 * 3)
    // And a step through the row meets the first room in its way.
    const hit = firstHit(m, [-5, 0.5, -0.5], 0, 1, 1e6, 1e-9)
    expect(hit).not.toBeNull()
  })
})
