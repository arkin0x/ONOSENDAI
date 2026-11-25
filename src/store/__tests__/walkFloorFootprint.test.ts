/**
 * walkFloorFootprint.test.ts - WALK over heightfield ground (arkinox,
 * 2026-11-23: "I am dipping under the floor").
 *
 * The ground here is authored by this test: closed heightfield slabs, a top
 * on a 2-gibson grid at fractional heights, four skirts and a base, the way
 * a landscape tile is built. No kit piece is ever a fixture. Two slabs meet
 * at a seam; the ground rolls, carries a ridge and a valley, and a channel
 * is cut into one of them with near-vertical sides.
 *
 * The walk is driven frame by frame as the rig drives it (scene/Scene.tsx
 * Rig): fluid WALK's frame (tickFluid, tickFall, groundFluid), or the step
 * WALK's eased walker point lifted by stepFloor, then the camera from
 * scene/walkEyeRig.ts. Two avatars 3 gibsons tall, the owner's: an operative
 * whose eye is 2.8 up and 0.27 forward, and one with the automatic eye; and
 * the default icosahedron, no avatar at all, whose eye is 0.875 up.
 *
 * - the feet are never below the ground under the drawn point, nor under the
 *   footprint (the walkable ground FOOT_RADIUS round it);
 * - the camera is never inside the ground, and never down at the feet;
 * - next to a wall taller than the step, or a face steeper than FOOT_SLOPE,
 *   the feet never climb it (footGround);
 * - the footprint costs a bounded share of a frame.
 */
import { provedFor } from '../fixtures/provedHop'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { Vector3 } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { FOOT_RADIUS, FOOT_SLOPE, clearWalls, footGround, groundUnder, wallItemsAt, wallsBuilt } from '../walkWalls'
import { groundFluid, resetFluid, stepFloor, tickFluid } from '../walkFluid'
import { useFluidWalk } from '../fluidSwitch'
import { walkFacing, walkFall, walkFallUp, walkGlide, walkRise } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { firstHit, trianglesNear, triGridUse, wallMesh, withConstrain } from '../../lib/walkConstrain'
import { csDirection } from '../../lib/pose'
import { WORLD_DOWN } from '../../lib/walkDown'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import { EYE_ROOM, WalkEyeRig } from '../../scene/walkEyeRig'

type V3 = [number, number, number]

const worldItemsOriginal = useShards.getState().worldItems

/** A vertex at a fractional place, in ticks (120 a gibson). */
function vertex(x: number, y: number, z: number): ShardModel['vertices'][number] {
  const t = [x, y, z].map((v) => Math.round(v * 120))
  const p = t.map((v) => Math.floor(v / 120)) as V3
  const r = t.map((v, n) => v - p[n] * 120) as V3
  return r.some((v) => v !== 0) ? { p, t: r, c: [1, 1, 1] } : { p, c: [1, 1, 1] }
}

/** Every `step` from -half to half. */
function grid(half: number, step: number): number[] {
  return Array.from({ length: Math.round((2 * half) / step) + 1 }, (_, k) => -half + k * step)
}

/**
 * A closed heightfield slab over the grid lines `xs` by `zs` (gibsons from its
 * origin, ascending, either side of it): a top at `top(x, z)`, rounded to
 * ticks, four skirts and a base at -16, wound the same way all round.
 */
function slab(name: string, xs: readonly number[], zs: readonly number[], top: (x: number, z: number) => number): ShardModel {
  const nx = xs.length - 1, nz = zs.length - 1
  const vertices: ShardModel['vertices'] = []
  const faces: Array<[number, number, number]> = []
  const idx = (i: number, j: number): number => i * (nz + 1) + j
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) vertices.push(vertex(xs[i], Math.round(top(xs[i], zs[j]) * 120) / 120, zs[j]))
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    faces.push([idx(i, j), idx(i, j + 1), idx(i + 1, j + 1)], [idx(i, j), idx(i + 1, j + 1), idx(i + 1, j)])
  }
  // The base's four corners, then the skirts down to them.
  const b = vertices.length
  for (const [x, z] of [[xs[0], zs[0]], [xs[nx], zs[0]], [xs[nx], zs[nz]], [xs[0], zs[nz]]]) vertices.push(vertex(x, -16, z))
  faces.push([b, b + 1, b + 2], [b, b + 2, b + 3])
  const edge = (cells: Array<[number, number]>, c0: number, c1: number): void => {
    for (let k = 0; k < cells.length - 1; k++) faces.push([idx(...cells[k]), c0, idx(...cells[k + 1])])
    faces.push([idx(...cells[cells.length - 1]), c0, c1])
  }
  const run = (n: number, f: (k: number) => [number, number]): Array<[number, number]> => Array.from({ length: n + 1 }, (_, k) => f(k))
  edge(run(nx, (k) => [k, 0]), b, b + 1)
  edge(run(nz, (k) => [nx, k]), b + 1, b + 2)
  edge(run(nx, (k) => [nx - k, nz]), b + 2, b + 3)
  edge(run(nz, (k) => [0, nz - k]), b + 3, b)
  return withConstrain({ ...newShard(name), mode: 'solid', vertices, faces }, 'all')
}

/** Rolling ground with a ridge along x = 10 and a valley along z = -12, flat at the slab's edges so two slabs meet at a seam. */
function rolling(x: number, z: number): number {
  const fade = Math.min(1, (32 - Math.abs(x)) / 8, (32 - Math.abs(z)) / 8)
  const ridge = 3 * Math.max(0, 1 - Math.abs(x - 10) / 3)
  const valley = -2.5 * Math.max(0, 1 - Math.abs(z + 12) / 4)
  return fade * (0.9 * Math.sin(x / 3.1) * Math.cos(z / 4.3) + ridge + valley)
}

/**
 * A culvert: a slab whose top is flat but for a channel along x, its floor 6
 * down from z 8 to z 10, its sides all but upright (rising 6 over 0.04, and
 * leaning out by that much), their feet on whole gibsons, where a walker in
 * the channel stands right at a side's foot.
 */
const CHANNEL_ZS = [...grid(16, 1).filter((z) => z < 8), 7.96, 8, 9, 10, 10.04, ...grid(16, 1).filter((z) => z > 10)]
function channel(x: number, z: number): number {
  void x
  return z >= 8 && z <= 10 ? -6 : 0
}

let start: Position
let clock = 1_000_000

/** Slabs `[shard, origin]`, origins gibsons from `start`. */
function world(list: Array<[ShardModel, V3]>): void {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = list.map(([shard, o], i) => ({
    key: `g${i}-${shard.id}`, type: 'shard', at: { x: start.x + BigInt(o[0]), y: start.y + BigInt(o[1]), z: start.z + BigInt(o[2]) }, plane, height: 84, mine: false, shard,
  }))
  useShards.setState({ worldItems: () => items })
}

/** The ground's height at (x, z), gibsons from `start`, for the slabs as authored (the top's triangles, straight between grid points). */
function makeSurface(list: Array<[(x: number, z: number) => number, V3, readonly number[], readonly number[]]>): (x: number, z: number) => number | null {
  const cell = (ls: readonly number[], v: number): number => { let k = 0; while (k < ls.length - 2 && v > ls[k + 1]) k++; return k }
  return (x, z) => {
    for (const [top, o, xs, zs] of list) {
      const lx = x - o[0], lz = z - o[2]
      if (lx < xs[0] || lx > xs[xs.length - 1] || lz < zs[0] || lz > zs[zs.length - 1]) continue
      const i = cell(xs, lx), j = cell(zs, lz)
      const x0 = xs[i], z0 = zs[j], sx = xs[i + 1] - x0, sz = zs[j + 1] - z0
      const u = (lx - x0) / sx, v = (lz - z0) / sz
      const H = (a: number, b: number): number => Math.round(top(a ? xs[i + 1] : x0, b ? zs[j + 1] : z0) * 120) / 120 + o[1]
      // The cell's two triangles: (0,0),(0,1),(1,1) and (0,0),(1,1),(1,0).
      return v >= u ? H(0, 0) + u * (H(1, 1) - H(0, 1)) + v * (H(0, 1) - H(0, 0)) : H(0, 0) + u * (H(1, 0) - H(0, 0)) + v * (H(1, 1) - H(1, 0))
    }
    return null
  }
}

/** The highest walkable ground under a footprint FOOT_RADIUS across at (x, z): grid-straight, no steeper than FOOT_SLOPE from the middle, sampled finely. */
function footTop(surface: (x: number, z: number) => number | null, x: number, z: number): number | null {
  const c = surface(x, z)
  if (c === null) return null
  let best = c
  for (let r = 1; r <= 4; r++) for (let a = 0; a < 24; a++) {
    const d = (r / 4) * FOOT_RADIUS
    const g = surface(x + d * Math.cos((a * Math.PI) / 12), z + d * Math.sin((a * Math.PI) / 12))
    // Ground the footprint is meant to stand on: rising gently, and not on a steep side (the channel's sides are 12 to 1).
    if (g !== null && g - c < FOOT_SLOPE * d) best = Math.max(best, g)
  }
  return best
}

function frame(ms: number): void {
  clock += ms
  vi.advanceTimersByTime(ms)
  tickFluid(clock)
  tickFall(clock)
  groundFluid(clock)
}

/** Where the rig aims at the walker (the cursor's middle, the fluid glide, the fall), gibsons from `start`. */
function target(): V3 {
  const cs = useCyberspace.getState()
  const p: V3 = [Number(cs.cursor.x - start.x), Number(cs.cursor.y - start.y), Number(cs.cursor.z - start.z)]
  if (walkGlide.active) { p[0] += walkGlide.x; p[1] += walkGlide.y; p[2] += walkGlide.z }
  if (walkFall.active) p[walkFallUp.axis === 'x' ? 0 : walkFallUp.axis === 'y' ? 1 : 2] += walkFall.offset * walkFallUp.dir
  return p
}

function toRender(axes: ViewAxes, v: V3): V3 {
  const at = (a: { axis: 'x' | 'y' | 'z'; dir: 1 | -1 }): number => v[a.axis === 'x' ? 0 : a.axis === 'y' ? 1 : 2] * a.dir
  return [at(axes.right), at(axes.up), at(axes.out)]
}

const eyeVec = new Vector3()
/** The camera, gibsons from `start`, for the walker drawn at `p` looking along `look`, as Scene.tsx asks the rig. */
function camera(rig: WalkEyeRig, shard: ShardModel | null, p: V3, look: V3): V3 {
  const cs = useCyberspace.getState()
  const axes = cs.axes()
  const c: V3 = [Number(cs.cursor.x - start.x), Number(cs.cursor.y - start.y), Number(cs.cursor.z - start.z)]
  const f = toRender(axes, look)
  rig.offset({
    shard, scaleExp: 0, axes, plane: cs.plane, cursor: cs.cursor, lead: toRender(axes, [p[0] - c[0], p[1] - c[1], p[2] - c[2]]),
    forward: { x: f[0], y: f[1], z: f[2] }, up: { axis: 'y', dir: 1 }, walls: true, stand: 2,
    rise: walkRise.offset < 0 ? { offset: walkRise.offset, axis: walkRise.up.axis, dir: walkRise.up.dir } : undefined,
    now: clock,
  }, eyeVec)
  const off = csDirection(axes, [eyeVec.x, eyeVec.y, eyeVec.z])
  return [p[0] + off[0], p[1] + off[1], p[2] + off[2]]
}

/** An avatar 3 gibsons tall, with an eye or with the automatic one: only the height and the eye are taken. */
function column(name: string, eye?: V3): ShardModel {
  return { ...newShard(name), vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [0, 3, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]], ...(eye ? { extra: { eye } } : {}) }
}
/**
 * Who walks, and the least height over the feet the camera may have before it
 * counts as down at them (camAtFeet). The 3-gibson avatars: half a gibson.
 * The default icosahedron (no avatar, arkinox 2026-11-25: "i am clipping under
 * the floor constantly"), whose eye is 0.875 up: a stair's trail lowers its
 * camera toward a riser taller than its eye by design (lib/walkEye.ts
 * walkRise), never nearer the feet than the near plane's room, EYE_ROOM.
 */
const AVATARS: Array<[string, ShardModel | null, number]> = [
  ['the default icosahedron (no avatar)', null, EYE_ROOM * (1 - 1 / 8)],
  ['a shape with no points, its eye set at the icosahedron’s top', { ...newShard('Empty'), extra: { eye: [0, 120, 0] } }, EYE_ROOM * (1 - 1 / 8)],
  ['an operative (eye 2.8 up, 0.27 forward)', column('Operative', [4, 336, -32]), 0.5],
  ['a 3-gibson avatar with the automatic eye', column('Auto'), 0.5],
]

const key = (code: string) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {} })
function face(x: number, z: number): void {
  const l = Math.hypot(x, z)
  walkFacing.forward = { x: x / l, y: 0, z: z / l }
  walkFacing.right = { x: -z / l, y: 0, z: x / l }
  walkFacing.valid = true
}
function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}
let landed = 0
async function keepUp(): Promise<void> {
  while (posted.length > landed) await useCyberspace.getState().applyProofMessage(done(posted[landed++]))
}

beforeEach(async () => {
  posted.length = 0
  landed = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  walkKeysReleased()
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useShards.setState({ worldItems: worldItemsOriginal })
  useWorkshop.setState({ open: false })
  clearWalls()
  useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0, view: canonicalQuaternion() })
  await useCyberspace.getState().respawn()
  useCyberspace.getState().cancel()
  useCalibration.setState({ cantorMsByHeight: undefined })
  start = { ...useCyberspace.getState().position }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  resetFluid()
})

afterEach(() => {
  walkKeysReleased()
  useWalk.getState().exit()
  useFluidWalk.setState({ on: false })
  walkFacing.valid = false
  resetFluid()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Into WALK with gravity on, settled on the ground, then gravity as asked. */
async function walk(fluid: boolean, gravity: boolean): Promise<void> {
  useFluidWalk.setState({ on: fluid })
  useWalk.getState().setGravity(true)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } })
  frame(16)
  await wallsBuilt()
  for (let k = 0; k < 60; k++) { frame(16); await keepUp() }
  if (!gravity) useWalk.getState().setGravity(false)
}

interface Walked { frames: number; feetUnder: number; footWorst: number; camInGround: number; camAtFeet: number }

/**
 * Walk `legs` (a heading and how far along it, in gibsons), a frame every
 * `ms`, the rig's walker point as Scene.tsx eases it (fluid exactly, the step
 * WALK eased and lifted by stepFloor), and measure against `surface`.
 */
async function walkLegs(legs: Array<[number, number, number]>, ms: number, avatar: ShardModel | null, fluid: boolean, surface: (x: number, z: number) => number | null, inGround: (p: V3) => boolean, atFeet = 0.5): Promise<Walked> {
  const rig = new WalkEyeRig()
  let smooth = target()
  const out: Walked = { frames: 0, feetUnder: 0, footWorst: 0, camInGround: 0, camAtFeet: 0 }
  for (const [dx, dz, dist] of legs) {
    face(dx, dz)
    const c0 = useCyberspace.getState().cursor
    const along = (): number => { const c = useCyberspace.getState().cursor; return (Number(c.x - c0.x) * dx + Number(c.z - c0.z) * dz) / Math.hypot(dx, dz) }
    walkKeyDown(key('KeyW'))
    for (let k = 0; k < Math.round(12000 / ms) && along() < dist; k++) {
      frame(ms)
      await keepUp()
      const t = target()
      if (fluid) smooth = t
      else {
        const e = 1 - Math.exp(-(ms / 1000) / 0.09)
        smooth = [smooth[0] + (t[0] - smooth[0]) * e, walkFall.active ? t[1] : smooth[1] + (t[1] - smooth[1]) * e, smooth[2] + (t[2] - smooth[2]) * e]
        const cs = useCyberspace.getState()
        const lead: V3 = [smooth[0] - Number(cs.cursor.x - start.x), smooth[1] - Number(cs.cursor.y - start.y), smooth[2] - Number(cs.cursor.z - start.z)]
        smooth = [smooth[0], smooth[1] + stepFloor(lead, clock), smooth[2]]
      }
      const p = smooth
      const cam = camera(rig, avatar, p, [dx / Math.hypot(dx, dz), 0, dz / Math.hypot(dx, dz)])
      out.frames++
      const s = surface(p[0], p[2])
      if (s !== null && p[1] < s - 1e-6) out.feetUnder++
      const f = footTop(surface, p[0], p[2])
      if (f !== null) out.footWorst = Math.max(out.footWorst, f - p[1])
      if (inGround(cam)) out.camInGround++
      if (cam[1] - p[1] < atFeet) out.camAtFeet++
    }
    walkKeyUp('KeyW')
    for (let k = 0; k < 20; k++) { frame(ms); await keepUp() }
  }
  return out
}

describe('over rolling heightfield slabs with a seam, a ridge and a valley', () => {
  // Two 64 slabs side by side along x, the walker over the first; the ground at the start is under its gibson.
  const ORIGIN_Y = -2
  const surface = makeSurface([[rolling, [0, ORIGIN_Y, 0], grid(32, 2), grid(32, 2)], [rolling, [64, ORIGIN_Y, 0], grid(32, 2), grid(32, 2)]])
  const inGround = (p: V3): boolean => { const s = surface(p[0], p[2]); return s !== null && p[1] < s - 1e-6 && p[1] > ORIGIN_Y - 16 }
  const LEGS: Array<[number, number, number]> = [[1, 0, 46], [-1, 0, 46], [0, -1, 20], [0, 1, 20], [1, 0.6, 30], [-1, -0.6, 30]]
  for (const fluid of [true, false]) for (const gravity of [true, false]) for (const ms of [16, 33]) for (const [who, avatar, atFeet] of AVATARS) {
    it(`${fluid ? 'fluid' : 'step'} WALK, gravity ${gravity ? 'on' : 'off'}, a frame every ${ms} ms, ${who}: the feet never under the ground or the footprint, the camera never in it`, async () => {
      world([[slab('Rolling A', grid(32, 2), grid(32, 2), rolling), [0, ORIGIN_Y, 0]], [slab('Rolling B', grid(32, 2), grid(32, 2), rolling), [64, ORIGIN_Y, 0]]])
      await walk(fluid, gravity)
      const r = await walkLegs(LEGS, ms, avatar, fluid, surface, inGround, atFeet)
      expect(r.frames).toBeGreaterThan(200)
      expect(r, JSON.stringify(r)).toMatchObject({ feetUnder: 0, camInGround: 0, camAtFeet: 0 })
      // Between the footprint's seventeen samples a crest can poke up a little: never a tenth of a gibson (1.5 cm).
      expect(r.footWorst, JSON.stringify(r)).toBeLessThan(0.1)
    }, 120_000)
  }
})

describe('along a channel with steep sides', () => {
  // The channel runs along x at z 9 (floor -5 under the slab's top), the walker walked into it and along it, pushing into its side.
  const ORIGIN_Y = -1
  const surface = makeSurface([[channel, [0, ORIGIN_Y, 0], grid(16, 2), CHANNEL_ZS]])
  const inGround = (p: V3): boolean => { const s = surface(p[0], p[2]); return s !== null && p[1] < s - 1e-6 && p[1] > ORIGIN_Y - 16 }
  for (const fluid of [true, false]) for (const ms of [16, 33]) for (const [who, avatar, atFeet] of AVATARS) {
    it(`${fluid ? 'fluid' : 'step'} WALK, a frame every ${ms} ms, ${who}: the feet never inside the side, the camera never down at them`, async () => {
      world([[slab('Channel', grid(16, 2), CHANNEL_ZS, channel), [0, ORIGIN_Y, 0]]])
      await walk(fluid, true)
      const r = await walkLegs([[0, 1, 9], [1, 0.45, 10], [-1, 0.45, 20], [1, -0.45, 20], [-1, -0.45, 10]], ms, avatar, fluid, surface, inGround, atFeet)
      expect(r.frames).toBeGreaterThan(100)
      expect(r, JSON.stringify(r)).toMatchObject({ feetUnder: 0, camInGround: 0, camAtFeet: 0 })
    }, 120_000)
  }
})

describe('the step WALK up and down a flight of steps (its eased point cut each nosing)', () => {
  // Treads every `run`, risers of `rise`, up along +x from x 2.3; the floor 0.4 under the walker's gibson.
  for (const [rise, run] of [[1, 1], [0.5, 0.5], [1, 1.5]] as const) {
    const LOW = -0.4, FIRST = 2.3
    const steps: Array<[V3, V3]> = [[[-20, -6, -20], [FIRST, LOW, 20]]]
    for (let k = 0; k < 5; k++) steps.push([[FIRST + k * run, -6, -20], [k === 4 ? 30 : FIRST + (k + 1) * run, LOW + (k + 1) * rise, 20]])
    const surface = (x: number, z: number): number | null => {
      let best: number | null = null
      for (const [lo, hi] of steps) if (x >= lo[0] && x <= hi[0] && z >= lo[2] && z <= hi[2]) best = best === null ? hi[1] : Math.max(best, hi[1])
      return best
    }
    const inGround = (p: V3): boolean => steps.some(([lo, hi]) => p[0] > lo[0] + 1e-6 && p[0] < hi[0] - 1e-6 && p[1] > lo[1] && p[1] < hi[1] - 1e-6 && p[2] > lo[2] && p[2] < hi[2])
    for (const ms of [16, 33]) for (const [who, avatar, atFeet] of AVATARS) {
      it(`risers of ${rise} every ${run}, a frame every ${ms} ms, ${who}: the walker point never inside a step, the camera never in one or down at the feet`, async () => {
        const vertices: ShardModel['vertices'] = []
        const faces: Array<[number, number, number]> = []
        for (const [lo, hi] of steps) {
          const b = vertices.length
          for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) vertices.push(vertex(x, y, z))
          for (const [a, c, d, e] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) faces.push([b + a, b + c, b + d], [b + a, b + d, b + e])
        }
        world([[withConstrain({ ...newShard('Steps'), mode: 'solid', vertices, faces }, 'all'), [0, 0, 0]]])
        await walk(false, true)
        const r = await walkLegs([[1, 0, FIRST + 5 * run + 2], [-1, 0, FIRST + 5 * run + 4]], ms, avatar, false, surface, inGround, atFeet)
        expect(r.frames).toBeGreaterThan(40)
        expect(r, JSON.stringify(r)).toMatchObject({ feetUnder: 0, camInGround: 0, camAtFeet: 0 })
      }, 120_000)
    }
  }
})

describe('footGround: the highest walkable ground under the footprint', () => {
  async function at(shard: ShardModel, origin: V3): Promise<{ items: ReturnType<typeof wallItemsAt>; cursor: Position }> {
    world([[shard, origin]])
    const cs = useCyberspace.getState()
    return { items: wallItemsAt(cs.plane, cs.cursor), cursor: cs.cursor }
  }

  it('beside a wall taller than the step (and beside a riser a gibson tall), the feet stay on the floor', async () => {
    // A floor 0.4 under the walker's gibson, a block 3 tall from x 0.3, and a riser 1 tall from z 0.3.
    const list: Array<[V3, V3]> = [[[-8, -3, -8], [8, -0.4, 8]], [[0.3, -3, -8], [8, 2.6, -2]], [[-8, -3, 0.3], [-2, 0.6, 8]]]
    const vertices: ShardModel['vertices'] = []
    const faces: Array<[number, number, number]> = []
    for (const [lo, hi] of list) {
      const b = vertices.length
      for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) vertices.push(vertex(x, y, z))
      for (const [a, c, d, e] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) faces.push([b + a, b + c, b + d], [b + a, b + d, b + e])
    }
    const { items, cursor } = await at(withConstrain({ ...newShard('Blocks'), mode: 'solid', vertices, faces }, 'all'), [0, 0, 0])
    // Drawn 0.1 short of the block, and 0.1 short of the riser (at -2.4, 0.2 on the riser's side): both within the footprint.
    for (const lead of [[0.2, 0, -4], [-4, 0, 0.2]] as V3[]) {
      const g = groundUnder(cursor, lead, items, WORLD_DOWN, 2, 3)
      expect(g).toBeCloseTo(-0.4, 9)
      expect(footGround(cursor, lead, g!, items, WORLD_DOWN)).toBeCloseTo(-0.4, 9)
    }
  })

  it('on a slope gentler than FOOT_SLOPE it stands on the footprint\'s uphill edge; on a steeper face it never climbs it', async () => {
    for (const [slope, lifts] of [[0.5, true], [1.5, true], [3, false], [12, false]] as const) {
      // A slab whose top rises along x from x 0 at `slope`, flat before it; the walker drawn at x -0.25, the slope 0.25 ahead.
      const top = (x: number): number => Math.min(6, Math.max(0, x * slope))
      const shard = slab(`Slope ${slope}`, grid(16, 0.25), grid(16, 2), (x) => top(x))
      const { items, cursor } = await at(shard, [0, -1, 0])
      const lead: V3 = [-0.25, 0, 0.1]
      const g = groundUnder(cursor, lead, items, WORLD_DOWN, 2, 3)
      expect(g).toBeCloseTo(-1, 6)
      const f = footGround(cursor, lead, g!, items, WORLD_DOWN)
      if (lifts) expect(f).toBeCloseTo(-1 + top(0.25), 3)
      else expect(f).toBeCloseTo(-1, 9)
    }
  })
})

describe('the walls\' grid (lib/walkConstrain.ts TriGrid) gives the answers reading every triangle gives', () => {
  it('firstHit and trianglesNear over a heightfield slab, with the grid and without, agree exactly', () => {
    const mesh = wallMesh(slab('Rolling', grid(32, 2), grid(32, 2), rolling), [])
    expect(mesh.own).toBeGreaterThan(1000)
    let seed = 7
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let n = 0; n < 2000; n++) {
      const o: V3 = [rnd() * 70 - 35, rnd() * 30 - 15, rnd() * 70 - 35]
      const i = Math.floor(rnd() * 3) as 0 | 1 | 2
      const sgn = rnd() < 0.5 ? 1 : -1
      const maxT = rnd() < 0.1 ? 1e6 : rnd() * 20
      const minT = rnd() < 0.2 ? -rnd() * 0.01 : rnd() * 0.01
      const lo = [o[0] - rnd() * 3, o[1] - rnd() * 3, o[2] - rnd() * 3], hi = [o[0] + rnd() * 3, o[1] + rnd() * 3, o[2] + rnd() * 3]
      triGridUse.on = false
      const hitAll = firstHit(mesh, o, i, sgn, maxT, minT)
      const nearAll = Array.from(trianglesNear(mesh, lo, hi))
      triGridUse.on = true
      expect(firstHit(mesh, o, i, sgn, maxT, minT)).toBe(hitAll)
      expect(Array.from(trianglesNear(mesh, lo, hi))).toEqual(nearAll)
    }
  })
})

describe('the footprint costs a bounded share of a frame', () => {
  it('footGround over heightfield slabs costs a few ground searches at most, and well under a millisecond', async () => {
    world([[slab('Rolling A', grid(32, 2), grid(32, 2), rolling), [0, -2, 0]], [slab('Rolling B', grid(32, 2), grid(32, 2), rolling), [64, -2, 0]]])
    const cs = useCyberspace.getState()
    const items = wallItemsAt(cs.plane, cs.cursor)
    const lead = (k: number): V3 => [((k * 37) % 97) / 97 - 0.5, 0, ((k * 53) % 89) / 89 - 0.5]
    // Warm: the walls are built on the first ask.
    groundUnder(cs.cursor, lead(0), items, WORLD_DOWN, 2, 3)
    // CPU time, not the clock: a busy machine's other work is not counted.
    const cpuMs = (u: NodeJS.CpuUsage): number => (u.user + u.system) / 1000
    const N = 400
    let t0 = process.cpuUsage()
    const grounds: number[] = []
    for (let k = 0; k < N; k++) grounds.push(groundUnder(cs.cursor, lead(k), items, WORLD_DOWN, 2, 3) ?? 0)
    const searchMs = cpuMs(process.cpuUsage(t0)) / N
    t0 = process.cpuUsage()
    for (let k = 0; k < N; k++) footGround(cs.cursor, lead(k), grounds[k], items, WORLD_DOWN)
    const footMs = cpuMs(process.cpuUsage(t0)) / N
    // Measured against the ground search it follows, loosely (a loaded machine shares its caches), and outright.
    expect(footMs).toBeLessThan(Math.max(8 * searchMs, 0.25))
    expect(footMs).toBeLessThan(1)
  })
})
