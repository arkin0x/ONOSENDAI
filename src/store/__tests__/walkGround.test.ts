/**
 * walkGround.test.ts - fluid WALK stands on the geometry (arkinox,
 * 2026-11-17: "with the new fluid movement, sometimes for a frame i'll dip
 * under the floor"; "my avatar ... stands on the nearest gibson. that looks
 * pretty off when the geometry is halfway between gibsons").
 *
 * The walker is drawn where the rig draws it (scene/Scene.tsx Rig): its
 * anchor gibson, plus walkGlide steps, plus a fall's offset. The camera is
 * the avatar's eye above that, placed among the walls by eyePlace as the rig asks it.
 *
 * - a continuous walk up and down a ramp, and over a half-gibson ledge,
 *   never draws the feet or the eye below the surface, at 60 and 30 fps and
 *   through frame-time spikes, with gravity on and off;
 * - at a fractional position the walker is drawn at the surface's height;
 * - stopped on a half-height surface, once its move has landed, it still
 *   stands on that surface, not on the gibson;
 * - with the switch off, the step WALK draws exactly what it drew.
 *
 * The fixtures are authored here and in fixtures/rampFixture.ts: no kit
 * piece is ever a fixture.
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

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { REST_FLOOR, clearWalls, eyePlace, eyeReach, restDrop, wallItemsAt, wallsBuilt } from '../walkWalls'
import { MARKER_LIFT, markerEdges } from '../../scene/avatarMarker'
import { MARKER_EYE } from '../../lib/avatarEye'
import { groundFluid, resetFluid, tickFluid } from '../walkFluid'
import { useFluidWalk } from '../fluidSwitch'
import { walkFacing, walkFall, walkFallUp, walkGlide, walkRise } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { withConstrain } from '../../lib/walkConstrain'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import { rampFixture } from '../fixtures/rampFixture'

/** Right +X, up +Y, toward the camera +Z. */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

const worldItemsOriginal = useShards.getState().worldItems

type V3 = [number, number, number]

/** Closed boxes from `lo` to `hi`, in gibsons from the shard's origin, at unit 0, set to stop a walker. */
function boxes(name: string, list: Array<[V3, V3]>): ShardModel {
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

/** The world holds exactly this shard, its origin `o` gibsons from `start`. */
function world(start: Position, shard: ShardModel, o: V3): void {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = [{
    key: `g-${shard.id}`, type: 'shard', at: { x: start.x + BigInt(o[0]), y: start.y + BigInt(o[1]), z: start.z + BigInt(o[2]) }, plane, height: 84, mine: false, shard,
  }]
  useShards.setState({ worldItems: () => items })
}

/**
 * A half-gibson ledge, authored for this test: a ground slab whose top is
 * 0.4 under the walker's starting gibson, and from x 2.3 on, a ledge whose
 * top is 0.1 over it, half a gibson higher. Neither top is on a gibson.
 */
const LEDGE_AT = 2.3
const LOW = -0.4
const HIGH = 0.1
function ledge(): ShardModel {
  return boxes('Half ledge', [[[-40, -3, -40], [LEDGE_AT, LOW, 40]], [[LEDGE_AT, -3, -40], [40, HIGH, 40]]])
}
const ledgeHeight = (x: number): number => (x < LEDGE_AT ? LOW : HIGH)

/** The ramp fixture's surface at model x, as its triangles have it: straight between its vertices, every 2 along X, at tick heights. */
function rampSurface(): (x: number) => number {
  const shard = rampFixture()
  const heights = new Map<number, number>()
  for (const v of shard.vertices) {
    const t = v.t ?? [0, 0, 0]
    heights.set(v.p[0] * 120 + t[0], (v.p[1] * 120 + t[1]) / 120)
  }
  return (x: number) => {
    const x0 = Math.floor(x / 2) * 2
    const a = heights.get(x0 * 120)!
    const b = heights.get((x0 + 2) * 120)!
    return a + ((b - a) * (x - x0)) / 2
  }
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

/** An avatar's eye, straight up from its origin in gibsons: the Ship's 1.33. */
const EYE: V3 = [0, 1.33, 0]

/** The near plane's room the rig keeps (scene/walkEyeRig.ts EYE_ROOM), in gibsons at 2^0. */
const ROOM = 0.15

/**
 * Where the camera is, in gibsons from `start`: the eye over the drawn walker,
 * lowered by a stair's rise and then placed among the walls, as the rig does
 * it (scene/walkEyeRig.ts: walkRise, then eyePlace).
 */
function camera(p: V3): V3 {
  const cs = useCyberspace.getState()
  const lead: V3 = [p[0] - Number(cs.cursor.x - start.x), p[1] - Number(cs.cursor.y - start.y), p[2] - Number(cs.cursor.z - start.z)]
  const lower = walkRise.offset < 0 ? Math.max(walkRise.offset, -Math.max(0, EYE[1] - ROOM)) : 0
  const e = eyePlace(cs.cursor, lead, [EYE[0], EYE[1] + lower, EYE[2]], ROOM, wallItemsAt(cs.plane, cs.cursor), { axis: 'y', dir: 1 }, undefined, walkGlide.exact ? 2 : false)
  return [p[0] + e[0], p[1] + e[1], p[2] + e[2]]
}

const key = (code: string) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {} })
function down(code: string): void { walkKeyDown(key(code)) }
function up(code: string): void { walkKeyUp(code) }

/** Facing `deg` degrees right of -Z, level. */
function face(deg: number): void {
  const r = (deg * Math.PI) / 180
  walkFacing.forward = { x: Math.sin(r), y: 0, z: -Math.cos(r) }
  walkFacing.right = { x: Math.cos(r), y: 0, z: Math.sin(r) }
  walkFacing.valid = true
}

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

/** Land every proof the walk asks for, in order, a frame between each. */
async function landAll(): Promise<void> {
  let landed = 0
  for (let n = 0; n < 200; n++) {
    frame(16)
    vi.advanceTimersByTime(700)
    const w = useWalk.getState()
    if (w.queue.length === 0 && w.open === null && w.running === null) break
    if (posted.length > landed) {
      await useCyberspace.getState().applyProofMessage(done(posted[landed]))
      landed++
    }
    await vi.waitFor(() => undefined)
  }
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
  face(90) // facing +X
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

async function walk(gravity: boolean): Promise<void> {
  useWalk.getState().setGravity(gravity)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
  frame(16)
  await wallsBuilt()
  frame(16)
}

let landedSoFar = 0
/** The chain keeps up, as a relay would: every proof asked for lands, so the walk never holds at the LOSING SYNC edge. */
async function keepUp(): Promise<void> {
  while (posted.length > landedSoFar) await useCyberspace.getState().applyProofMessage(done(posted[landedSoFar++]))
}

/** A frame-time pattern: steady at `ms`, or with a long frame every so often. */
function* times(ms: number, spikes: boolean): Generator<number> {
  for (let n = 0; ; n++) yield spikes && n % 23 === 7 ? 120 + (n % 5) * 30 : ms
}

/**
 * Walk `key` held until the drawn x passes `until` (or back under it), then
 * let go and settle; on every frame, the feet and the eye must be on or over
 * `surface` at their own x. The lowest margin seen, for the message.
 */
async function walkOver(surface: (x: number) => number, keyCode: string, until: (x: number) => boolean, ms: number, spikes: boolean): Promise<{ worstFeet: number; worstEye: number; frames: number; camStep: number }> {
  let worstFeet = Infinity
  let worstEye = Infinity
  let camStep = 0
  let lastCam: number | null = null
  let n = 0
  const check = (): void => {
    const p = drawn()
    const c = camera(p)
    worstFeet = Math.min(worstFeet, p[1] - surface(p[0]))
    // The eye well over the surface, not pulled in to the feet.
    worstEye = Math.min(worstEye, c[1] - surface(c[0]))
    if (lastCam !== null) camStep = Math.max(camStep, Math.abs(c[1] - lastCam))
    lastCam = c[1]
    n++
  }
  down(keyCode)
  const t = times(ms, spikes)
  for (let k = 0; k < 4000 && !until(drawn()[0]); k++) { frame(t.next().value as number); check(); await keepUp() }
  up(keyCode)
  for (let k = 0; k < 60; k++) { frame(t.next().value as number); check(); await keepUp() }
  return { worstFeet, worstEye, frames: n, camStep }
}

const PACES: Array<[string, number, boolean]> = [['60 fps', 16, false], ['30 fps', 33, false], ['60 fps with spikes', 16, true]]

describe('the feet and the eye never go below the surface', () => {
  for (const gravity of [true, false]) {
    for (const [name, ms, spikes] of PACES) {
      it(`up and down the ramp, gravity ${gravity ? 'on' : 'off'}, ${name}`, async () => {
        const ramp = withConstrain(rampFixture(), 'all')
        world(start, ramp, [24, 0, 0])
        const at = rampSurface()
        const surface = (x: number): number => at(x - 24)
        await walk(gravity)
        const upHill = await walkOver(surface, 'KeyW', (x) => x > 44, ms, spikes)
        expect(drawn()[0]).toBeGreaterThan(44)
        const downHill = await walkOver(surface, 'KeyS', (x) => x < 6, ms, spikes)
        expect(drawn()[0]).toBeLessThan(6)
        expect(upHill.worstFeet).toBeGreaterThanOrEqual(-1e-6)
        expect(downHill.worstFeet).toBeGreaterThanOrEqual(-1e-6)
        expect(upHill.worstEye).toBeGreaterThan(EYE[1] / 2)
        expect(downHill.worstEye).toBeGreaterThan(EYE[1] / 2)
      })

      it(`onto and off a half-gibson ledge, gravity ${gravity ? 'on' : 'off'}, ${name}`, async () => {
        world(start, ledge(), [0, 0, 0])
        await walk(gravity)
        const onto = await walkOver(ledgeHeight, 'KeyW', (x) => x > 6, ms, spikes)
        expect(drawn()[0]).toBeGreaterThan(6)
        const off = await walkOver(ledgeHeight, 'KeyS', (x) => x < -3, ms, spikes)
        expect(drawn()[0]).toBeLessThan(-3)
        expect(onto.worstFeet).toBeGreaterThanOrEqual(-1e-6)
        expect(off.worstFeet).toBeGreaterThanOrEqual(-1e-6)
        expect(onto.worstEye).toBeGreaterThan(EYE[1] / 2)
        expect(off.worstEye).toBeGreaterThan(EYE[1] / 2)
      })
    }
  }
})

/**
 * Stairs authored for this test: risers of `rise` gibsons every `run`, the
 * first at x 2.3, the floor 0.4 under the start gibson.
 */
function stairs(rise: number, run: number, n: number): { shard: ShardModel; height: (x: number) => number } {
  const list: Array<[V3, V3]> = [[[-40, -6, -40], [2.3, LOW, 40]]]
  for (let k = 0; k < n; k++) list.push([[2.3 + k * run, -6, -40], [k === n - 1 ? 40 : 2.3 + (k + 1) * run, LOW + (k + 1) * rise, 40]])
  const height = (x: number): number => (x < 2.3 ? LOW : LOW + Math.min(n, Math.floor((x - 2.3) / run) + 1) * rise)
  return { shard: boxes(`Stairs ${rise}`, list), height }
}

describe('stairs: the feet stand on each step and the camera climbs smoothly', () => {
  for (const [rise, run] of [[1, 1.5], [2, 3], [0.6, 0.7]] as const) {
    for (const gravity of [true, false]) {
      it(`risers of ${rise} every ${run}, gravity ${gravity ? 'on' : 'off'}: never below a step, and the camera never jumps`, async () => {
        const { shard, height } = stairs(rise, run, 5)
        world(start, shard, [0, 0, 0])
        await walk(gravity)
        const upStairs = await walkOver(height, 'KeyW', (x) => x > 2.3 + 5 * run + 2, 16, false)
        expect(drawn()[0]).toBeGreaterThan(2.3 + 5 * run + 2)
        expect(drawn()[1]).toBeCloseTo(LOW + 5 * rise, 9)
        const downStairs = await walkOver(height, 'KeyS', (x) => x < -2, 16, false)
        expect(drawn()[1]).toBeCloseTo(LOW, 9)
        for (const r of [upStairs, downStairs]) {
          expect(r.worstFeet).toBeGreaterThanOrEqual(-1e-6)
          expect(r.worstEye).toBeGreaterThan(0)
          // At 60 fps a step's rise reaches the camera over several frames, never at once. The
          // camera never trails below the feet's height (plus the near plane's room), so of a
          // riser taller than the eye, the part over it is climbed at once.
          expect(r.camStep).toBeLessThan(Math.max(0.45, rise - (EYE[1] - ROOM) + 0.15))
        }
      })
    }
  }
})

describe('jumps leave from the feet and land on the surface', () => {
  it('running jumps up the ramp never draw the feet or the eye below it, and each leaves from the feet', async () => {
    const ramp = withConstrain(rampFixture(), 'all')
    world(start, ramp, [24, 0, 0])
    const at = rampSurface()
    const surface = (x: number): number => at(x - 24)
    await walk(true)
    down('KeyW')
    let worstFeet = Infinity
    let worstEye = Infinity
    let jumps = 0
    let landed = 0
    let lastJump = -20
    for (let k = 0; k < 4000 && drawn()[0] < 44; k++) {
      // A jump half a second after the last landing's press, from the ground, pressed and let go: it leaves from the feet.
      if (k - lastJump >= 30 && !walkFall.active) {
        lastJump = k
        const before = drawn()[1]
        down('Space'); up('Space'); frame(16); jumps++
        expect(drawn()[1]).toBeGreaterThanOrEqual(before - 1e-9)
      } else frame(16)
      // The chain keeps up, as a relay would: the walk never holds at the LOSING SYNC edge.
      while (posted.length > landed) await useCyberspace.getState().applyProofMessage(done(posted[landed++]))
      const p = drawn()
      const c = camera(p)
      worstFeet = Math.min(worstFeet, p[1] - surface(p[0]))
      worstEye = Math.min(worstEye, c[1] - surface(c[0]))
    }
    up('KeyW')
    for (let k = 0; k < 120; k++) frame(16)
    expect(jumps).toBeGreaterThanOrEqual(4)
    expect(worstFeet).toBeGreaterThanOrEqual(-1e-6)
    expect(worstEye).toBeGreaterThanOrEqual(-1e-6)
    // Landed and stopped: on the slope, to the float.
    const p = drawn()
    expect(walkFall.active).toBe(false)
    expect(p[1]).toBeCloseTo(surface(p[0]), 9)
  })
})

describe('a jump onto a block, and leaving WALK', () => {
  it('a jump from a floor 0.9 under the gibson onto a block 2.6 up never draws the feet inside it, and the eye stays out', async () => {
    const shard = boxes('Floor and block', [[[-40, -3, -40], [40, -0.9, 40]], [[2.6, -3, -40], [40, 2.6, 40]]])
    world(start, shard, [0, 0, 0])
    const height = (x: number): number => (x < 2.6 ? -0.9 : 2.6)
    await walk(true)
    let worstFeet = Infinity
    let worstEye = Infinity
    down('KeyW')
    for (let k = 0; k < 400 && drawn()[0] < 8; k++) {
      if (k === 6) { down('Space'); up('Space') }
      frame(16)
      const p = drawn()
      const c = camera(p)
      worstFeet = Math.min(worstFeet, p[1] - height(p[0]))
      worstEye = Math.min(worstEye, c[1] - height(c[0]))
    }
    up('KeyW')
    for (let k = 0; k < 120; k++) frame(16)
    expect(drawn()[0]).toBeGreaterThan(2.6)
    expect(worstFeet).toBeGreaterThanOrEqual(-1e-6)
    expect(worstEye).toBeGreaterThan(0)
    expect(drawn()[1]).toBeCloseTo(2.6, 9)
  })

  it('leaving WALK on a half-height surface, the eye glides off the surface, never jumping to the gibson', async () => {
    world(start, ledge(), [0, 0, 0])
    await walk(true)
    for (let k = 0; k < 20; k++) frame(16)
    expect(drawn()[1]).toBeCloseTo(LOW, 9)
    let last = drawn()[1]
    useWalk.getState().exit()
    let biggest = 0
    for (let k = 0; k < 60; k++) {
      frame(16)
      const y = drawn()[1]
      biggest = Math.max(biggest, Math.abs(y - last))
      last = y
    }
    expect(biggest).toBeLessThan(0.2)
    expect(last).toBeCloseTo(0, 3) // onto the gibson, where the step WALK and the orbit draw it
  })
})

describe('the walker stands on the geometry, not on the gibson', () => {
  for (const gravity of [true, false]) {
    it(`at a fractional position on the ramp it is drawn at the surface's height, gravity ${gravity ? 'on' : 'off'}`, async () => {
      const ramp = withConstrain(rampFixture(), 'all')
      world(start, ramp, [24, 0, 0])
      const at = rampSurface()
      await walk(gravity)
      down('KeyW')
      let fractional = 0
      for (let k = 0; k < 4000 && drawn()[0] < 40; k++) {
        frame(16)
        const p = drawn()
        // Well up the slope, between gibsons both ways: on it, to the float.
        if (p[0] > 18 && Math.abs(p[0] - Math.round(p[0])) > 0.1 && Math.abs(p[1] - Math.round(p[1])) > 0.05) {
          expect(p[1]).toBeCloseTo(at(p[0] - 24), 9)
          fractional++
        }
      }
      up('KeyW')
      expect(fractional).toBeGreaterThan(20)
    })

    it(`stopped on a half-height surface, its move landed, it stands on that surface, gravity ${gravity ? 'on' : 'off'}`, async () => {
      world(start, ledge(), [0, 0, 0])
      await walk(gravity)
      // Standing on the low ground, 0.4 under its gibson: drawn on it, not on the gibson.
      for (let k = 0; k < 10; k++) frame(16)
      expect(drawn()[1]).toBeCloseTo(LOW, 9)
      // Up onto the ledge, and stop there.
      down('KeyW')
      for (let k = 0; k < 4000 && drawn()[0] < 4; k++) frame(16)
      up('KeyW')
      for (let k = 0; k < 120; k++) frame(16)
      await landAll()
      for (let k = 0; k < 120; k++) frame(16)
      const cs = useCyberspace.getState()
      expect(Number(cs.position.y - start.y)).toBe(1) // the chain: a whole gibson over the ledge
      expect(Number(cs.position.x - start.x)).toBeGreaterThan(2)
      const p = drawn()
      expect(p[1]).toBeCloseTo(HIGH, 9) // drawn on the ledge's top, 0.9 under that gibson
      // And it stays there, frame after frame.
      for (let k = 0; k < 60; k++) { frame(16); expect(drawn()[1]).toBeCloseTo(HIGH, 9) }
    })
  }
})

describe('every avatar stands with its origin on the surface (restDrop, markerEdges)', () => {
  /** Where an avatar's origin is drawn, in gibsons from `start`, standing at `at`: its gibson's centre, lowered by restDrop. */
  async function restsAt(at: Position): Promise<number> {
    const plane = useCyberspace.getState().plane
    let r = restDrop(at, plane)
    if (r.pending) { await wallsBuilt(); r = restDrop(at, plane) }
    expect(r.pending).toBe(false)
    return Number(at.y - start.y) - r.drop
  }
  const up = (n: number): Position => ({ ...start, y: start.y + BigInt(n) })

  it('a feet-origin avatar just above a half-height platform has its feet on the top, not a gibson over it', async () => {
    world(start, boxes('Half platform', [[[-4, -3, -4], [4, -0.5, 4]]]), [0, 0, 0])
    expect(await restsAt(start)).toBeCloseTo(-0.5, 9)
  })

  it('a whole gibson over a whole-unit platform top, the feet are on it', async () => {
    world(start, boxes('Whole platform', [[[-4, -3, -4], [4, -1, 4]]]), [0, 0, 0])
    expect(await restsAt(start)).toBeCloseTo(-1, 9)
    // In the top's own plane: on it already.
    expect(await restsAt(up(-1))).toBeCloseTo(-1, 9)
  })

  it('never floats or sinks at a fractional surface height', async () => {
    // Tick-exact heights (a vertex is a whole number of 1/120 units), on both sides of the gibson's floor.
    for (const top of [-2, -30, -59, -61, -92, -119].map((t) => t / 120)) {
      clearWalls()
      world(start, boxes(`Platform ${top}`, [[[-4, -3, -4], [4, top, 4]]]), [0, 0, 0])
      expect(await restsAt(start)).toBeCloseTo(top, 9)
    }
  })

  it('with nothing within a gibson under it, it stands on its own gibson\'s floor', async () => {
    world(start, boxes('Low platform', [[[-4, -3, -4], [4, -1.5, 4]]]), [0, 0, 0])
    expect(await restsAt(start)).toBe(-REST_FLOOR)
    expect(await restsAt(up(5))).toBe(5 - REST_FLOOR)
  })

  it('a face that stops no walker holds no avatar up, as it holds no walker', async () => {
    const open = withConstrain(boxes('Unconstrained', [[[-4, -3, -4], [4, -0.5, 4]]]), 'off')
    world(start, open, [0, 0, 0])
    expect(await restsAt(start)).toBe(-REST_FLOOR)
  })

  it('the default icosahedron is lifted onto the ground by half its height, and still turns about its centre', () => {
    // Drawn centred, inside the turn that faces it the way it moved, so a turn never swings it off its gibson.
    const g = markerEdges()
    g.computeBoundingBox()
    expect(g.boundingBox!.min.y).toBeCloseTo(-0.5, 12)
    expect(g.boundingBox!.max.y).toBeCloseTo(0.5, 12)
    // Lifted outside that turn by MARKER_LIFT: its lowest vertex on where the avatar stands.
    expect(g.boundingBox!.min.y + MARKER_LIFT).toBeCloseTo(0, 12)
    g.dispose()
    // The workshop's still views build the lift in.
    const still = markerEdges(true)
    still.computeBoundingBox()
    expect(still.boundingBox!.min.y).toBeCloseTo(0, 12)
    still.dispose()
  })

  it('the default avatar\'s eye is where it was on its shape: 0.375 over its centre', () => {
    expect(MARKER_EYE - MARKER_LIFT).toBe(0.375)
  })
})

describe('the step WALK (the switch off)', () => {
  it('steps whole gibsons as it always did, the walker drawn with its origin on the surface, and the eye asked as it always was', async () => {
    useFluidWalk.setState({ on: false })
    world(start, ledge(), [0, 0, 0])
    await walk(false)
    const cells: V3[] = []
    for (const code of ['KeyW', 'KeyW', 'KeyW', 'KeyW', 'KeyS', 'KeyS']) {
      down(code)
      frame(16)
      up(code)
      for (let k = 0; k < 30; k++) {
        frame(16)
        expect(walkGlide.exact).toBe(false)
      }
      const cs = useCyberspace.getState()
      const cell: V3 = [Number(cs.cursor.x - start.x), Number(cs.cursor.y - start.y), Number(cs.cursor.z - start.z)]
      cells.push(cell)
      // The rig eases onto this point: the gibson, lowered onto the surface under its centre.
      const p = drawn()
      expect(p[0]).toBe(cell[0])
      expect(p[1]).toBeCloseTo(ledgeHeight(cell[0]), 9)
    }
    // Whole gibsons only: up onto the ledge and back down, on the gibsons the step WALK always stood on.
    for (const c of cells) for (const v of c) expect(Number.isInteger(v)).toBe(true)
    expect(cells.some((c) => c[1] === 1)).toBe(true)
    // With the switch off, the eye's question is the one it always was.
    const cs = useCyberspace.getState()
    const items = wallItemsAt(cs.plane, cs.cursor)
    expect(eyeReach(cs.cursor, [0.3, 0, 0], EYE, 0.15, items, { axis: 'y', dir: 1 })).toBe(eyeReach(cs.cursor, [0.3, 0, 0], EYE, 0.15, items, { axis: 'y', dir: 1 }, undefined, false))
  })
})
