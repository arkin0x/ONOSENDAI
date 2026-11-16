/**
 * helpers.ts - small worlds for the simulation's tests: boxes as triangles,
 * shards authored here as payloads (a ground slab and a plumb wall, read by
 * sno-core like any published object), a flat test field, and inputs.
 */

import { fromPayload, type ShardModel } from 'sno-core/shards'
import base from '../../variants/drone-run-base.json'
import type { DroneRunVariant, LevelInfo, RunInput, Vec3 } from '../../types'
import { buildSolids, type Solids } from '../solids'

/** The 12 triangles of a box from lo to hi. */
export function boxTris(lo: Vec3, hi: Vec3): number[] {
  const v = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]])
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
  const out: number[] = []
  for (const [a, b, c, d] of quads) for (const t of [[a, b, c], [a, c, d]]) for (const k of t) out.push(...v[k])
  return out
}

/** Solids from boxes. */
export function boxes(...bs: Array<[Vec3, Vec3]>): Solids {
  return buildSolids(bs.flatMap(([lo, hi]) => boxTris(lo, hi)))
}

/** The ground of the test field: its top at y 64 over x, z 0..255. */
export const GROUND: [Vec3, Vec3] = [[-0.5, 48, -0.5], [255.5, 64, 255.5]]

/** Corners and triangles of a payload under construction. */
interface Build { vertices: number[][]; faces: number[][] }

/** A grid of quads from corner `o` along `u` (nu cells) and `v` (nv cells), each cell two triangles. */
function grid(b: Build, o: number[], u: number[], v: number[], nu: number, nv: number): void {
  const first = b.vertices.length
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) b.vertices.push([0, 1, 2].map((a) => o[a] + u[a] * i + v[a] * j))
  const at = (i: number, j: number): number => first + j * (nu + 1) + i
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) b.faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)], [at(i, j), at(i + 1, j + 1), at(i, j + 1)])
}

/** A closed box's six faces as grids of whole-unit cells. */
function gridBox(b: Build, lo: number[], hi: number[], step: number[]): void {
  const [dx, dy, dz] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
  const n = (d: number, a: number): number => Math.max(1, Math.round(d / step[a]))
  grid(b, lo, [dx / n(dx, 0), 0, 0], [0, 0, dz / n(dz, 2)], n(dx, 0), n(dz, 2))
  grid(b, [lo[0], hi[1], lo[2]], [dx / n(dx, 0), 0, 0], [0, 0, dz / n(dz, 2)], n(dx, 0), n(dz, 2))
  grid(b, lo, [dx / n(dx, 0), 0, 0], [0, dy / n(dy, 1), 0], n(dx, 0), n(dy, 1))
  grid(b, [lo[0], lo[1], hi[2]], [dx / n(dx, 0), 0, 0], [0, dy / n(dy, 1), 0], n(dx, 0), n(dy, 1))
  grid(b, lo, [0, dy / n(dy, 1), 0], [0, 0, dz / n(dz, 2)], n(dy, 1), n(dz, 2))
  grid(b, [hi[0], lo[1], lo[2]], [0, dy / n(dy, 1), 0], [0, 0, dz / n(dz, 2)], n(dy, 1), n(dz, 2))
}

/** A payload parsed by sno-core: unit 0, solid, constrain all, with `patch` over it. */
function parse(name: string, b: Build, patch: Record<string, unknown>): ShardModel {
  const raw = { v: 2, name, unit: 0, mode: 'solid', vertices: b.vertices, colors: b.vertices.map(() => 1), faces: b.faces, constrain: 'all', ...patch }
  const s = fromPayload(raw, `${name}-${JSON.stringify(patch)}`)
  if (!s) throw new Error(name)
  return s
}

/** A ground slab 32 across (x, z -16..16), its top at 0 in cells of 4, its base at -16: 320 triangles. */
export function groundSlab(patch: Record<string, unknown> = {}): ShardModel {
  const b: Build = { vertices: [], faces: [] }
  gridBox(b, [-16, -16, -16], [16, 0, 16], [4, 16, 4])
  return parse('Test ground slab', b, patch)
}

/**
 * A plumb wall 16 long (x -8..8), 14 high (y 0..14) and 7 thick (payload z
 * -4..3, off centre so a flip of Z would show), in cells of 1 on its long
 * faces: about 1000 triangles.
 */
export function plumbWall(patch: Record<string, unknown> = {}): ShardModel {
  const b: Build = { vertices: [], faces: [] }
  gridBox(b, [-8, 0, -4], [8, 14, 3], [1, 1, 7])
  return parse('Test plumb wall', b, patch)
}

/** The base variant, deep-copied so a test can change it. */
export function variant(): DroneRunVariant {
  return JSON.parse(JSON.stringify(base)) as DroneRunVariant
}

/** The test field's level: start zone at the +Z end, finish at the -Z end, twelve spawn points high over the field. */
export function testLevel(): LevelInfo {
  const spawns: Record<string, Vec3> = {}
  for (let i = 1; i <= 12; i++) spawns[`s${i}`] = [96 + ((i * 37) % 64), 76, 60 + i * 10]
  return {
    id: 'test-field',
    zones: { start: { lo: [120, 64, 200], hi: [136, 80, 216] }, finish: { lo: [120, 64, 34], hi: [136, 80, 56] } },
    entry: { at: [128, 64, 208], yaw: 0 },
    spawns,
  }
}

/** An input: nothing pressed, looking along -Z. */
export function input(over: Partial<RunInput> = {}): RunInput {
  return { move: { fwd: 0, strafe: 0 }, yaw: 0, pitch: 0, jump: false, fire: false, select: null, reload: false, ...over }
}
