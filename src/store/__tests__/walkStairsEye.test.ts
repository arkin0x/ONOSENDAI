/**
 * walkStairsEye.test.ts - the WALK camera on stairs (arkinox, 2026-11-22:
 * "walking up stairs, i get these full-screen glitches where it looks like
 * my avatar falls down under the stairs or something for just a frame";
 * "when i look forward the screen glitches out").
 *
 * The camera is placed the way the rig places it (scene/Scene.tsx Rig):
 * fluid WALK's frame (tickFluid, tickFall, groundFluid), then the eye from
 * scene/walkEyeRig.ts, a stair's trail (walkRise) included, over the walker
 * as drawn. Three eyes: the default icosahedron's, a Ship's (straight up,
 * 1.33), and an operative's (2.8 up and 0.27 forward, his avatar's numbers).
 *
 * - walking up and down a staircase, the feet never drop for a frame on the
 *   way up, the camera never drops toward the feet, and it never comes
 *   nearer any step than the near plane's room (EYE_ROOM);
 * - stopped on a step at the foot of the next riser, looking all the way
 *   round, up and down, the camera stays at the eye's height and keeps the
 *   room from the riser.
 *
 * The stairs are boxes authored here: no kit piece is ever a fixture.
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
import { clearWalls, wallsBuilt } from '../walkWalls'
import { groundFluid, resetFluid, tickFluid } from '../walkFluid'
import { useFluidWalk } from '../fluidSwitch'
import { walkFacing, walkFall, walkFallUp, walkGlide, walkRise } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { withConstrain } from '../../lib/walkConstrain'
import { csDirection } from '../../lib/pose'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import { EYE_ROOM, WalkEyeRig } from '../../scene/walkEyeRig'
import { CAMERA_NEAR } from '../../scene/camera'

type V3 = [number, number, number]

const worldItemsOriginal = useShards.getState().worldItems

/** Closed boxes from `lo` to `hi`, in gibsons from the shard's origin (the model's axes are cyberspace's), at unit 0, set to stop a walker. */
function boxes(name: string, list: ReadonlyArray<readonly [V3, V3]>): ShardModel {
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
  return withConstrain({ ...newShard(name), mode: 'solid', vertices, faces }, 'all')
}

/** The floor's top, under the walker's starting gibson. */
const LOW = -0.4
/** Where the first riser is, along +X from the start. */
const FIRST = 2.3

/** A staircase up along +X: risers of `rise` every `run`, `n` of them, the last step running on. */
function staircase(rise: number, run: number, n: number): Array<[V3, V3]> {
  const list: Array<[V3, V3]> = [[[-40, -6, -40], [FIRST, LOW, 40]]]
  for (let k = 0; k < n; k++) list.push([[FIRST + k * run, -6, -40], [k === n - 1 ? 40 : FIRST + (k + 1) * run, LOW + (k + 1) * rise, 40]])
  return list
}

/** How far `p` is outside the boxes (negative inside one). */
function clearance(p: V3, list: ReadonlyArray<readonly [V3, V3]>): number {
  let best = Infinity
  for (const [lo, hi] of list) {
    const q = [0, 1, 2].map((i) => Math.max(lo[i] - p[i], p[i] - hi[i]))
    best = Math.min(best, Math.hypot(...q.map((v) => Math.max(v, 0))) + Math.min(Math.max(q[0], q[1], q[2]), 0))
  }
  return best
}

/**
 * Three eyes: none (the icosahedron's 0.875), a Ship's 1.33 straight up,
 * and an operative 3 tall whose eye is 2.8 up and 0.27 toward its nose
 * (payload -Z), the numbers of the owner's avatar. Only the eye and the
 * height are taken; the shapes are stand-ins.
 */
function column(name: string, top: number, eye?: V3): ShardModel {
  const t = Math.round(top * 120)
  return { ...newShard(name), vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [0, Math.floor(t / 120), 0], t: [0, t % 120, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]], ...(eye ? { extra: { eye } } : {}) }
}
const EYES: Array<[string, ShardModel | null, number]> = [
  ['the icosahedron', null, 0.875],
  ['a Ship', column('Ship', 1.4, [0, 159, 0]), 159 / 120],
  ['an operative', column('Operative', 3, [4, 336, -32]), 336 / 120],
]

/** The world holds exactly this shard, its origin at `start`. */
function world(start: Position, shard: ShardModel): void {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = [{ key: `g-${shard.id}`, type: 'shard', at: { ...start }, plane, height: 84, mine: false, shard }]
  useShards.setState({ worldItems: () => items })
}

let start: Position
let clock = 1_000_000

/** The rig's frame (Scene.tsx Rig): fluid WALK, the fall, then the ground under the walker. */
function frame(ms = 16): void {
  clock += ms
  vi.advanceTimersByTime(ms)
  tickFluid(clock)
  tickFall(clock)
  groundFluid(clock)
}

/** Where the rig draws the walker, in gibsons from `start`, by cyberspace axis. */
function drawn(): V3 {
  const cs = useCyberspace.getState()
  const p: V3 = [Number(cs.cursor.x - start.x), Number(cs.cursor.y - start.y), Number(cs.cursor.z - start.z)]
  const step = 2 ** cs.scaleExp
  if (walkGlide.active) {
    p[0] += walkGlide.x * step
    p[1] += walkGlide.y * step
    p[2] += walkGlide.z * step
  }
  if (walkFall.active) p[walkFallUp.axis === 'x' ? 0 : walkFallUp.axis === 'y' ? 1 : 2] += walkFall.offset * walkFallUp.dir
  return p
}

/** A cyberspace vector in render axes: the inverse of csDirection. */
function toRender(axes: ViewAxes, v: V3): V3 {
  const at = (a: { axis: 'x' | 'y' | 'z'; dir: 1 | -1 }): number => v[a.axis === 'x' ? 0 : a.axis === 'y' ? 1 : 2] * a.dir
  return [at(axes.right), at(axes.up), at(axes.out)]
}

const eyeVec = new Vector3()

/**
 * Where the camera is, gibsons from `start`, the walker drawn at `p` from its
 * anchor `cursor`: the rig's eye (scene/walkEyeRig.ts), looking along the
 * cyberspace direction `look`, with the stair's trail as Scene.tsx passes it.
 */
function camera(rig: WalkEyeRig, shard: ShardModel | null, p: V3, look: V3, cursor = useCyberspace.getState().cursor): V3 {
  const cs = useCyberspace.getState()
  const axes = cs.axes()
  const c: V3 = [Number(cursor.x - start.x), Number(cursor.y - start.y), Number(cursor.z - start.z)]
  const lead = toRender(axes, [p[0] - c[0], p[1] - c[1], p[2] - c[2]])
  const f = toRender(axes, look)
  rig.offset({
    shard, scaleExp: 0, axes, plane: cs.plane, cursor, lead, forward: { x: f[0], y: f[1], z: f[2] }, up: { axis: 'y', dir: 1 }, walls: true, stand: 2,
    rise: walkRise.offset < 0 ? { offset: walkRise.offset, axis: walkRise.up.axis, dir: walkRise.up.dir } : undefined,
    now: clock,
  }, eyeVec)
  const off = csDirection(axes, [eyeVec.x, eyeVec.y, eyeVec.z])
  return [p[0] + off[0], p[1] + off[1], p[2] + off[2]]
}

const key = (code: string) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {} })
function down(code: string): void { walkKeyDown(key(code)) }
function up(code: string): void { walkKeyUp(code) }

/** Facing +X, level: up the stairs. */
function faceUpStairs(): void {
  walkFacing.forward = { x: 1, y: 0, z: 0 }
  walkFacing.right = { x: 0, y: 0, z: 1 }
  walkFacing.valid = true
}

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

let landedSoFar = 0
/** The chain keeps up, as a relay would. */
async function keepUp(): Promise<void> {
  while (posted.length > landedSoFar) await useCyberspace.getState().applyProofMessage(done(posted[landedSoFar++]))
}

beforeEach(async () => {
  posted.length = 0
  landedSoFar = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  walkKeysReleased()
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useFluidWalk.setState({ on: true })
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
  faceUpStairs()
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

async function walk(): Promise<void> {
  useWalk.getState().setGravity(true)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } })
  frame(16)
  await wallsBuilt()
  frame(16)
}

/** How near the camera may come to a step: the near plane's room, less a hair for the rig's key (a sixteenth of it). */
const ROOM_KEPT = EYE_ROOM * (1 - 1 / 8)

describe('walking up and down stairs, the camera never drops and never cuts a step', () => {
  for (const [rise, run] of [[1, 1], [1, 1.5], [0.5, 0.5], [1, 2]] as const) {
    for (const [who, shard, eyeUp] of EYES) {
      for (const ms of [16, 33]) {
        it(`risers of ${rise} every ${run}, ${who}, a frame every ${ms} ms`, async () => {
          const list = staircase(rise, run, 5)
          world(start, boxes(`Stairs ${rise} ${run}`, list))
          await walk()
          const rig = new WalkEyeRig()
          let lastFeet = drawn()[1]
          let lastCam: V3 | null = null
          let worstRoom = Infinity
          let worstHeight = Infinity
          let worstFeetDrop = 0
          let worstCamDrop = 0
          let frames = 0
          const check = (climbing: boolean): void => {
            const p = drawn()
            const c = camera(rig, shard, p, [1, 0, 0])
            worstRoom = Math.min(worstRoom, clearance(c, list))
            // Never down at the feet: at least the near plane's room over them (a stair's trail lowers it that far at most).
            worstHeight = Math.min(worstHeight, c[1] - p[1])
            if (climbing) {
              worstFeetDrop = Math.max(worstFeetDrop, lastFeet - p[1])
              if (lastCam) worstCamDrop = Math.max(worstCamDrop, lastCam[1] - c[1])
            }
            lastFeet = p[1]
            lastCam = c
            frames++
          }
          const top = FIRST + 5 * run + 2
          down('KeyW')
          for (let k = 0; k < 3000 && drawn()[0] < top; k++) { frame(ms); check(true); await keepUp() }
          up('KeyW')
          for (let k = 0; k < 40; k++) { frame(ms); check(true); await keepUp() }
          expect(drawn()[1]).toBeCloseTo(LOW + 5 * rise, 9)
          down('KeyS')
          for (let k = 0; k < 3000 && drawn()[0] > -2; k++) { frame(ms); check(false); await keepUp() }
          up('KeyS')
          for (let k = 0; k < 40; k++) { frame(ms); check(false); await keepUp() }
          expect(drawn()[1]).toBeCloseTo(LOW, 9)
          expect(frames).toBeGreaterThan(40)
          // The ground on the way up: never a frame lower than the one before.
          expect(worstFeetDrop).toBeLessThan(1e-9)
          // The camera on the way up: never a drop (it was the full eye, 0.9 to 2.8, for a frame).
          expect(worstCamDrop).toBeLessThan(0.02)
          expect(worstHeight).toBeGreaterThan(EYE_ROOM - 1e-6)
          expect(worstHeight).toBeLessThan(eyeUp + 1e-6)
          // Never nearer a step than the near plane's room, so the near plane (and its corners) never cut one.
          expect(worstRoom).toBeGreaterThan(ROOM_KEPT)
          expect(ROOM_KEPT).toBeGreaterThan(CAMERA_NEAR * 2)
        })
      }
    }
  }
})

describe('stopped at the foot of a riser, looking around', () => {
  // Rises of 1 every 1: the step the walker stands on runs from x 2.3 to 3.3 with its top at 0.6, the next riser at 3.3 up to 1.6.
  const list = staircase(1, 1, 5)
  for (const [who, shard, eyeUp] of EYES) {
    it(`${who}: at every heading, up and down, the camera stays at the eye's height and keeps the room`, async () => {
      world(start, boxes('Stairs 1 1', list))
      await walk()
      // Standing still on that step's top, its gibson (3, 1) whose middle is clear of every step.
      const cursor = { x: start.x + 3n, y: start.y + 1n, z: start.z }
      for (const gap of [0.001, 0.02, 0.05, 0.1, 0.2, 0.4]) {
        const p: V3 = [FIRST + 1 - gap, LOW + 1, 0]
        for (let deg = 0; deg < 360; deg += 15) {
          for (const pitch of [-60, 0, 40]) {
            const r = (deg * Math.PI) / 180, e = (pitch * Math.PI) / 180
            const look: V3 = [Math.cos(r) * Math.cos(e), Math.sin(e), Math.sin(r) * Math.cos(e)]
            const rig = new WalkEyeRig()
            const c = camera(rig, shard, p, look, cursor)
            const at = JSON.stringify({ gap, deg, pitch, c })
            expect(c[1] - p[1], at).toBeCloseTo(eyeUp, 6)
            expect(clearance(c, list), at).toBeGreaterThan(ROOM_KEPT)
          }
        }
      }
    })
  }

  it('the same rig, turned a little at a time to face the riser and away, never moves the camera more than the eye swings', async () => {
    world(start, boxes('Stairs 1 1', list))
    await walk()
    const cursor = { x: start.x + 3n, y: start.y + 1n, z: start.z }
    const p: V3 = [FIRST + 1 - 0.03, LOW + 1, 0]
    const rig = new WalkEyeRig()
    const [, shard] = EYES[2]
    let last: V3 | null = null
    let worst = 0
    for (let deg = -180; deg <= 180; deg += 2) {
      const r = (deg * Math.PI) / 180
      const c = camera(rig, shard, p, [Math.cos(r), 0, Math.sin(r)], cursor)
      expect(c[1] - p[1]).toBeCloseTo(336 / 120, 6)
      if (last) worst = Math.max(worst, Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2]))
      last = c
    }
    // A 2 degree turn swings an eye 0.27 forward by under a hundredth of a gibson.
    expect(worst).toBeLessThan(0.02)
  })
})
