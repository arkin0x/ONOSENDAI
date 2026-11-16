/**
 * walkFluid.test.ts - fluid WALK (arkinox, 2026-11-16; store/walkFluid.ts,
 * lib/fluidWalk.ts, store/useWalk.ts fluidCross):
 *
 * - a hold accelerates to FLUID_MAX_SPEED and a let go slows to rest; a tap nudges;
 * - the jump still rises 5 and the double jump 3;
 * - a wall at an angle is slid along, and the anchor never enters it;
 * - a Landscape Kit ramp is walked up standing on it, a step at a time;
 * - crossing N gibsons makes N legal steps, in order, proved as a chain;
 * - the speed eases near the LOSING SYNC warning and holds one under it;
 * - leaving WALK glides the eye onto the anchor;
 * - with the switch off, WALK is the step WALK, untouched.
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
const ceiling = vi.hoisted(() => ({ hopHeight: 40 }))
vi.mock('../../lib/calibration', async (orig) => {
  const mod = await orig<typeof import('../../lib/calibration')>()
  return { ...mod, recommendedHopHeight: () => ceiling.hopHeight }
})
vi.mock('../../lib/relay', async (orig) => {
  const mod = await orig<typeof import('../../lib/relay')>()
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { fromPayload, newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { SYNC_WARN_AT, fallState, tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { clearWalls, stepLimit, wallItemsAt, wallsBuilt } from '../walkWalls'
import { standing } from '../walkStep'
import { fluidState, resetFluid, tickFluid } from '../walkFluid'
import { useFluidWalk, fluidFromUrl } from '../fluidSwitch'
import { DOUBLE_JUMP_HEIGHT, JUMP_HEIGHT } from '../walkGravity'
import { walkFacing, walkFall, walkGlide } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { FLUID_ACCEL, FLUID_HOLD_AT, FLUID_MAX_SPEED, FLUID_WALL_REACH, len, onLine, syncSpeedFactor } from '../../lib/fluidWalk'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import RAMP from '../fixtures/landscape-kit-ramp-up.json'

/** Right +X, up +Y, toward the camera +Z: 'away' walks -Z. */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

const worldItemsOriginal = useShards.getState().worldItems

type V3 = [number, number, number]

/** Closed boxes from `lo` to `hi`, in gibsons from the shard's origin, at unit 0 (as walkStep.test.ts builds them). */
function boxes(name: string, c: Constrain, list: Array<[V3, V3]>): ShardModel {
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
  return withConstrain({ ...newShard(name), mode: 'solid', vertices, faces }, c)
}

/** The world holds exactly these shards, each with its origin `o` gibsons from `start`. */
function world(start: Position, ...placed: Array<[ShardModel, V3]>): WorldItem[] {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = placed.map(([shard, o], n) => ({
    key: `w${n}-${shard.id}`, type: 'shard', at: { x: start.x + BigInt(o[0]), y: start.y + BigInt(o[1]), z: start.z + BigInt(o[2]) }, plane, height: 84, mine: false, shard,
  }))
  useShards.setState({ worldItems: () => items })
  return items
}

const FLOOR: [V3, V3] = [[-40, -1, -40], [40, 0, 40]]

function rel(start: Position, p: Position = useCyberspace.getState().cursor): V3 {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

/** Land every proof the walk asks for, in order, until it has none left. */
async function landAll(): Promise<number> {
  let landed = 0
  for (let n = 0; n < 200; n++) {
    vi.advanceTimersByTime(700)
    const w = useWalk.getState()
    if (w.queue.length === 0 && w.open === null && w.running === null) break
    if (posted.length > landed) {
      await useCyberspace.getState().applyProofMessage(done(posted[landed]))
      landed++
    }
    await vi.waitFor(() => undefined)
  }
  return landed
}

let clock = 1_000_000
/** One frame of `ms`: the hold's timers, fluid WALK, then the fall, as the rig runs them. */
function frame(ms = 16): void {
  clock += ms
  vi.advanceTimersByTime(ms)
  tickFluid(clock)
  tickFall(clock)
}
function frames(ms: number, each = 16): void {
  for (let t = 0; t < ms; t += each) frame(each)
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

let start: Position

beforeEach(async () => {
  posted.length = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  ceiling.hopHeight = 40
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
  face(0)
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

function walk(gravity = false): void {
  useWalk.getState().setGravity(gravity)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
  frame(16)
}

describe('the switch', () => {
  it('reads ?fluidwalk=1 and ?fluidwalk=0 from the address', () => {
    expect(fluidFromUrl('?fluidwalk=1')).toBe(true)
    expect(fluidFromUrl('?a=b&fluidwalk=0')).toBe(false)
    expect(fluidFromUrl('?x=1')).toBeNull()
  })

  it('off: a press is a whole step at once, as the step WALK always was, and nothing smooth runs', () => {
    useFluidWalk.setState({ on: false })
    walk()
    down('KeyW')
    expect(rel(start)).toEqual([0, 0, -1])
    expect(tickFluid(clock)).toBe(false)
    expect(walkGlide.exact).toBe(false)
    up('KeyW')
  })
})

describe('acceleration', () => {
  it('a hold picks up to the walking speed and no faster; a let go slows to rest within a step', () => {
    walk()
    down('KeyW')
    // Nothing is pressed as a step: the first frame has barely moved.
    expect(rel(start)).toEqual([0, 0, 0])
    frames(96)
    const early = len(fluidState().v)
    expect(early).toBeGreaterThan(FLUID_ACCEL * 0.08)
    expect(early).toBeLessThan(FLUID_MAX_SPEED)
    frames(600)
    expect(len(fluidState().v)).toBeCloseTo(FLUID_MAX_SPEED, 6)
    frames(500)
    expect(len(fluidState().v)).toBeLessThanOrEqual(FLUID_MAX_SPEED + 1e-9)
    // About 9 steps a second, -Z, straight.
    const at = rel(start)
    expect(at[0]).toBe(0)
    expect(at[2]).toBeLessThan(-8)
    expect(at[2]).toBeGreaterThan(-12)
    up('KeyW')
    const before = rel(start)[2] + fluidState().frac.z
    frames(250)
    expect(len(fluidState().v)).toBe(0)
    const coast = before - (rel(start)[2] + fluidState().frac.z)
    expect(coast).toBeGreaterThan(0.3)
    expect(coast).toBeLessThan(1)
  })

  it('a tap is a short nudge: about half a step, into the next gibson', () => {
    walk()
    down('KeyW')
    up('KeyW')
    frames(600)
    expect(len(fluidState().v)).toBe(0)
    expect(rel(start)).toEqual([0, 0, -1])
    expect(fluidState().frac.z).toBeGreaterThan(-0.1)
  })
})

describe('jumps keep their heights', () => {
  it('a jump rises 5 and a double jump 3 above where it was pressed', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk(true)
    const eye = (): number => Number(useCyberspace.getState().cursor.y - start.y) + (walkFall.active ? walkFall.offset : 0)
    down('Space'); up('Space')
    let peak = -Infinity
    for (let t = 0; t < 2000; t += 16) { frame(16); if (fallState()) peak = Math.max(peak, eye()) }
    expect(JUMP_HEIGHT).toBe(5)
    expect(peak).toBeLessThanOrEqual(5)
    expect(peak).toBeGreaterThan(4)
    expect(fallState()).toBeNull()
    // Again, and the double jump just past the top.
    down('Space'); up('Space')
    frames(400)
    const pressedAt = eye()
    down('Space'); up('Space')
    expect(fallState()!.doubled).toBe(true)
    let peak2 = -Infinity
    for (let t = 0; t < 3000; t += 16) { frame(16); if (fallState()) peak2 = Math.max(peak2, eye()) }
    expect(DOUBLE_JUMP_HEIGHT).toBe(3)
    expect(peak2 - pressedAt).toBeGreaterThan(2.5)
    expect(peak2 - pressedAt).toBeLessThanOrEqual(3 + 1e-9)
    expect(rel(start)).toEqual([0, 0, 0])
  })
})

describe('walls', () => {
  it('walking into a wall at an angle slides along it, and never enters it', async () => {
    // A wall across -Z, its face 3 gibsons ahead.
    world(start, [boxes('Wall', 'all', [[[-40, -5, -6], [40, 10, -3]]]), [0, 0, 0]])
    face(-30) // 30 degrees left of -Z: into the wall, and along it toward -X.
    walk()
    await wallsBuilt()
    down('KeyW')
    let deepest = 0
    for (let t = 0; t < 2500; t += 16) {
      frame(16)
      const c = rel(start)
      deepest = Math.min(deepest, c[2] + fluidState().frac.z)
      // The anchor is always somewhere a step could stand: not into the wall.
      expect(c[2]).toBeGreaterThanOrEqual(-2)
    }
    up('KeyW')
    const c = rel(start)
    // Held at the wall: the last gibson before the face, and the eye no further than FLUID_WALL_REACH into it.
    expect(c[2]).toBe(-2)
    expect(deepest).toBeGreaterThanOrEqual(-2 - FLUID_WALL_REACH - 1e-9)
    // Slid well along it, toward -X.
    expect(c[0]).toBeLessThan(-6)
    // Nowhere it went is past the face: the face is still ahead of the anchor.
    expect(stepLimit(useCyberspace.getState().cursor, 'z', -1, 1n, wallItemsAt(useCyberspace.getState().plane, useCyberspace.getState().cursor)).reach).toBe(0n)
  })
})

describe('a running jump onto a ledge', () => {
  it('pushing on a ledge 3 up, a jump carries you onto it (the held face is asked again as the arc rises)', async () => {
    world(start, [boxes('Ground', 'all', [FLOOR, [[-40, -1, -40], [40, 3, -2.5]]]), [0, -1, 0]])
    walk(true)
    await wallsBuilt()
    down('KeyW')
    frames(800)
    // Held at the ledge's foot.
    expect(rel(start)).toEqual([0, 0, -2])
    down('Space'); up('Space')
    frames(2000)
    up('KeyW')
    frames(500)
    const c = rel(start)
    expect(c[1]).toBe(3)
    expect(c[2]).toBeLessThan(-2)
    expect(fallState()).toBeNull()
  })
})

describe('floors from Landscape Kit tiles', () => {
  it('walks up the Grass Ramp Up standing on it, a step at a time, under gravity', async () => {
    const ramp = withConstrain(fromPayload(RAMP, 'ramp')!, 'all')
    // The tile's flat foot (x -24, its ground a hair under 0) is just under the walker; the ramp rises along +X.
    world(start, [ramp, [24, 0, 0]])
    face(90) // facing +X
    walk(true)
    await wallsBuilt()
    frame(16)
    const plane = useCyberspace.getState().plane
    expect(standing(start, wallItemsAt(plane, start), true)).toBe(true)
    down('KeyW')
    let last = rel(start)
    let rose = 0
    for (let t = 0; t < 6000 && rel(start)[0] < 44; t += 16) {
      frame(16)
      const c = rel(start)
      if (c[0] !== last[0] || c[1] !== last[1]) {
        // One step at a time: one along X, and up or down at most a stair's 2.
        expect(Math.abs(c[0] - last[0])).toBeLessThanOrEqual(1)
        expect(Math.abs(c[1] - last[1])).toBeLessThanOrEqual(2)
        rose += Math.max(0, c[1] - last[1])
        last = c
      }
    }
    up('KeyW')
    frames(1500)
    const end = useCyberspace.getState().cursor
    // Up the ramp, about 10, standing on it.
    expect(rel(start)[0]).toBeGreaterThan(40)
    expect(rose).toBeGreaterThanOrEqual(8)
    expect(standing(end, wallItemsAt(plane, end), true)).toBe(true)
    expect(fallState()).toBeNull()
  })
})

describe('anchoring the chain', () => {
  it('crossing N gibsons queues N legal steps in order; the proofs chain from one landing to the next', async () => {
    walk()
    const steps: Position[] = [{ ...start }]
    const unsub = useCyberspace.subscribe((s, prev) => { if (s.cursor !== prev.cursor && (s.cursor.x !== prev.cursor.x || s.cursor.y !== prev.cursor.y || s.cursor.z !== prev.cursor.z)) steps.push({ ...s.cursor }) })
    face(0)
    down('KeyW')
    frames(700)
    // Turn 60 degrees right while walking: a curve, so more than one segment.
    for (let deg = 0; deg <= 60; deg += 4) { face(deg); frames(48) }
    frames(500)
    up('KeyW')
    frames(400)
    unsub()
    const n = steps.length - 1
    expect(n).toBeGreaterThan(10)
    // Each step: one gibson along one axis, or one diagonal across two; never a skip, never up or down here.
    for (let i = 1; i < steps.length; i++) {
      const d = rel(steps[i - 1], steps[i])
      expect(d[1]).toBe(0)
      expect(Math.abs(d[0])).toBeLessThanOrEqual(1)
      expect(Math.abs(d[2])).toBeLessThanOrEqual(1)
      expect(Math.abs(d[0]) + Math.abs(d[2])).toBeGreaterThan(0)
    }
    // Every step is in the walk: a straight run of them is one hop, ending on one of them.
    await landAll()
    expect(posted.length).toBeGreaterThanOrEqual(2)
    const ends = steps.map((p) => `${p.x},${p.z}`)
    let from = start
    for (const p of posted) {
      expect(p.from).toEqual(from)
      expect(ends).toContain(`${p.to.x},${p.to.z}`)
      expect(p.to.y).toBe(start.y)
      from = p.to
    }
    // The chain ends where the walk is anchored: the last gibson walked.
    expect(useCyberspace.getState().position).toEqual(steps[steps.length - 1])
  })

  it('a straight run is one hop, and the line test holds a segment honest', () => {
    const o = { x: 0n, y: 0n, z: 0n }
    const p = (x: number, z: number): Position => ({ x: BigInt(x), y: 0n, z: BigInt(z) })
    // A 30 degree walk zigzags round its line: still one hop.
    expect(onLine(o, [p(1, 0), p(2, -1), p(3, -1), p(4, -2), p(5, -2), p(6, -3)], p(6, -3))).toBe(true)
    // Round a corner: two.
    expect(onLine(o, [p(1, 0), p(2, 0), p(3, 0), p(3, -1), p(3, -2), p(3, -3)], p(3, -3))).toBe(false)
  })
})

describe('the queue stays honest', () => {
  it('eases the speed as proofs fall behind', () => {
    expect(syncSpeedFactor(0)).toBe(1)
    expect(syncSpeedFactor(5)).toBe(1)
    expect(syncSpeedFactor(6)).toBeCloseTo(0.75, 9)
    expect(syncSpeedFactor(7)).toBeCloseTo(0.5, 9)
    expect(syncSpeedFactor(8)).toBeCloseTo(0.25, 9)
    expect(FLUID_HOLD_AT).toBe(SYNC_WARN_AT - 1)
    expect(syncSpeedFactor(FLUID_HOLD_AT)).toBe(0)
  })

  it('a zigzag faster than the proofs holds at the gibson edge and never reaches the LOSING SYNC warning; it walks on once they land', async () => {
    walk()
    down('KeyW')
    let most = 0
    let still = 0
    let stillest = 0
    let last = rel(start)
    // Turn 90 degrees every 0.7 s: a new segment at every turn, and no proof ever lands.
    for (let t = 0; t < 16000; t += 16) {
      if (t % 1408 === 0) face(0)
      if (t % 1408 === 704) face(90)
      frame(16)
      most = Math.max(most, useWalk.getState().behind)
      const c = rel(start)
      if (c[0] === last[0] && c[2] === last[2]) still += 16
      else still = 0
      stillest = Math.max(stillest, still)
      last = c
      expect(Math.abs(fluidState().frac.x)).toBeLessThanOrEqual(0.75)
      expect(Math.abs(fluidState().frac.z)).toBeLessThanOrEqual(0.75)
    }
    expect(most).toBeGreaterThanOrEqual(FLUID_HOLD_AT - 2)
    expect(most).toBeLessThan(SYNC_WARN_AT)
    // Held a good while with the key down.
    expect(stillest).toBeGreaterThan(2000)
    const heldAt = rel(start)
    // The proofs land: it walks on.
    await landAll()
    face(0)
    frames(1000)
    expect(rel(start)).not.toEqual(heldAt)
    up('KeyW')
  })
})

describe('leaving WALK', () => {
  it('the eye glides from the smooth position onto the anchor, then rests there', async () => {
    walk()
    down('KeyW')
    frames(260)
    up('KeyW')
    frames(300)
    await landAll()
    const anchored = { ...useCyberspace.getState().cursor }
    expect(useCyberspace.getState().position).toEqual(anchored)
    const frac = fluidState().frac.z
    expect(frac).not.toBe(0)
    useWalk.getState().exit()
    frame(16)
    // Just out: the eye is still where the walker was, and on its way.
    expect(walkGlide.active).toBe(true)
    expect(walkGlide.exact).toBe(false)
    expect(Math.abs(walkGlide.z)).toBeGreaterThan(Math.abs(frac) * 0.5)
    frames(700)
    expect(Math.abs(walkGlide.z)).toBeLessThan(1e-3)
    expect(useCyberspace.getState().cursor).toEqual(anchored)
  })
})
