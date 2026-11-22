/**
 * walkFluid.test.ts - fluid WALK (arkinox, 2026-11-16; store/walkFluid.ts,
 * lib/fluidWalk.ts, store/useWalk.ts fluidCross):
 *
 * - a hold accelerates to FLUID_MAX_SPEED and a let go slows to rest; a tap nudges;
 * - straight and diagonal, keys or pad, walk at the same FLUID_MAX_SPEED, and
 *   with phone proof times a walk that turns, zigzags or jumps never reaches
 *   the slowdown (arkinox, 2026-11-18: "my walk speed seems slow");
 * - the jump still rises 5 and the double jump 3;
 * - a wall at an angle is slid along, and the anchor never enters it;
 * - a ramp is walked up standing on it, a step at a time;
 * - crossing N gibsons makes N legal steps, in order, proved as a chain;
 * - fluid WALK pauses itself 21 events ahead and comes back on at 15 if it
 *   was on, a switch by hand wins, the sync limit off means no pause, the
 *   pause is never saved, and it does not flap (arkinox, 2026-11-22); the
 *   slowdown and LOSING SYNC warning are parked behind one flag, and
 *   switched back on they slow from 15 to their slowest at 20, never a stop
 *   (arkinox, 2026-11-17 and 22);
 * - on a slow device (frames further apart than WALK_SETTLE_MS) a straight
 *   walk is still one segment, and with late proofs the walker never goes
 *   back (walk-snapback investigation, 2026-11-17);
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

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { SYNC_WARN_AT, fallState, tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { clearWalls, stepLimit, wallItemsAt, wallsBuilt } from '../walkWalls'
import { standing } from '../walkStep'
import { fluidState, fluidWalking, resetFluid, tickFluid } from '../walkFluid'
import { FLUID_KEY, fluidOn, loadFluid, useFluidWalk, fluidFromUrl } from '../fluidSwitch'
import { SYNC_SLOWDOWN_ON, syncSlowdownOn, walkSpeedFactor, walkWarnOpacity } from '../walkLimits'
import { DOUBLE_JUMP_HEIGHT, JUMP_HEIGHT } from '../walkGravity'
import { walkFacing, walkFall, walkGlide } from '../../lib/walkEye'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { FLUID_ACCEL, FLUID_EASE_FROM, FLUID_HOLD_AT, FLUID_PAUSE_AT, FLUID_RESUME_AT, FLUID_SLOWEST, FLUID_MAX_SPEED, FLUID_NUDGE_STEPS, FLUID_WALL_REACH, len, onLine, syncSpeedFactor, syncWarnOpacity } from '../../lib/fluidWalk'
import { eventsAhead } from '../walkAhead'
import { useLayers } from '../useLayers'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import { rampFixture } from '../fixtures/rampFixture'
import { holdEnd, holdStart } from '../walkHold'
import { estimateHopCost } from 'cyberspace-core'
import { projectCantorMs } from '../../lib/calibration'

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
  useFluidWalk.setState({ on: true, paused: false, resumedAt: 0 })
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
    // About FLUID_MAX_SPEED steps a second (12.5), -Z, straight.
    const at = rel(start)
    expect(at[0]).toBe(0)
    expect(at[2]).toBeLessThan(-FLUID_MAX_SPEED * 0.9)
    expect(at[2]).toBeGreaterThan(-FLUID_MAX_SPEED * 1.3)
    up('KeyW')
    const before = rel(start)[2] + fluidState().frac.z
    frames(250)
    expect(len(fluidState().v)).toBe(0)
    const coast = before - (rel(start)[2] + fluidState().frac.z)
    expect(coast).toBeGreaterThan(0.3)
    expect(coast).toBeLessThan(1)
  })

  it('a tap is a short nudge: about three quarters of a step (FLUID_NUDGE_STEPS) whatever the speed, into the next gibson', () => {
    walk()
    down('KeyW')
    up('KeyW')
    frames(600)
    expect(len(fluidState().v)).toBe(0)
    expect(rel(start)).toEqual([0, 0, -1])
    expect(fluidState().frac.z).toBeGreaterThan(-0.1)
    // About FLUID_NUDGE_STEPS (a frame's worth less at 60 fps), and never two gibsons on, even
    // from the far edge of the middle one (a tap from 0.5 stops short of 1.5).
    const went = -(rel(start)[2] + fluidState().frac.z)
    expect(went).toBeGreaterThan(FLUID_NUDGE_STEPS - 0.15)
    expect(went).toBeLessThan(FLUID_NUDGE_STEPS + 0.05)
    expect(FLUID_NUDGE_STEPS + 0.05).toBeLessThan(1)
  })
})

describe('speed (arkinox, 2026-11-18: "my walk speed seems slow ... maybe faster when i go diagonal")', () => {
  /** Gibsons a second walked on flat ground under gravity, over 2 s at full speed, holding what `hold` holds, in frames of `ms`. */
  async function topSpeed(hold: () => void, release: () => void, deg: number, ms = 16): Promise<number> {
    world(start, [boxes('Floor', 'all', [[[-120, -1, -120], [120, 0, 120]]]), [0, -1, 0]])
    walk(true)
    await wallsBuilt()
    face(deg)
    const at = (): V3 => { const r = rel(start); const f = fluidState().frac; return [r[0] + f.x, r[1] + f.y, r[2] + f.z] }
    hold()
    frames(600, ms)
    const a = at()
    const t0 = clock
    frames(2000, ms)
    const b = at()
    release()
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / ((clock - t0) / 1000)
  }

  it('straight and diagonal walk at the same speed, FLUID_MAX_SPEED, from the keys or the pad, at 60 and 30 frames a second', async () => {
    const keys = (...codes: string[]) => [() => codes.forEach(down), () => codes.forEach(up)] as const
    const pad = (fwd: -1 | 0 | 1, strafe: -1 | 0 | 1) => [
      () => { holdStart('pad:forward', { fwd, strafe: 0, vert: 0 }); if (strafe) holdStart('pad:right', { fwd: 0, strafe, vert: 0 }) },
      () => { holdEnd('pad:forward'); holdEnd('pad:right') },
    ] as const
    const cases: Array<[string, readonly [() => void, () => void], number, number]> = [
      ['W', keys('KeyW'), 0, 16],
      ['W+D', keys('KeyW', 'KeyD'), 0, 16],
      ['W facing 45 degrees', keys('KeyW'), 45, 16],
      ['W+A facing 30 degrees', keys('KeyW', 'KeyA'), 30, 16],
      ['pad forward', pad(1, 0), 0, 16],
      ['pad forward and right', pad(1, 1), 0, 16],
      ['W at 30 fps', keys('KeyW'), 0, 33],
      ['W+D at 30 fps', keys('KeyW', 'KeyD'), 0, 33],
    ]
    for (const [name, [hold, release], deg, ms] of cases) {
      const v = await topSpeed(hold, release, deg, ms)
      expect(v, name).toBeGreaterThan(FLUID_MAX_SPEED * 0.99)
      expect(v, name).toBeLessThan(FLUID_MAX_SPEED * 1.01)
      walkKeysReleased()
      useWalk.getState().exit()
      await useCyberspace.getState().respawn()
      useCyberspace.getState().cancel()
      start = { ...useCyberspace.getState().position }
      resetFluid()
    }
    // 12.5 gibsons a second: 37.5% faster than the 9.09 it was.
    expect(FLUID_MAX_SPEED).toBe(12.5)
  })

  /**
   * A phone's proof of `req`, in ms: `overheadMs` for every move (the worker,
   * the signature, the landing) and each changed axis's Cantor tree at its
   * height, on a phone measured as lib/__tests__/crossover.test.ts has one,
   * so a long hop costs more than a short one.
   */
  const PHONE = { 14: 300, 15: 700, 16: 1600, 17: 3800 }
  function phoneProofMs(req: (typeof posted)[number], overheadMs: number): number {
    const est = estimateHopCost(req.from.x, req.from.y, req.from.z, req.to.x, req.to.y, req.to.z, useCyberspace.getState().plane as 0 | 1, 20)
    const lca = { x: est.lcaX, y: est.lcaY, z: est.lcaZ }
    return overheadMs + (['x', 'y', 'z'] as const).filter((a) => req.from[a] !== req.to[a]).reduce((ms, a) => ms + projectCantorMs(PHONE, lca[a]), 0)
  }

  /**
   * Walk 8 s holding W on a wide floor while `drive` steers, a phone proving
   * each move one after another in `proofMs(move)`, with the segment budget
   * measured on that phone: the most events it got ahead.
   */
  async function aheadWithProofs(proofMs: (req: (typeof posted)[number]) => number, drive: (ms: number) => void): Promise<number> {
    return (await walkWithProofs(proofMs, drive)).most
  }

  /** aheadWithProofs, and how many events the walk made in its 8 s: those landed on the chain and those still ahead. */
  async function walkWithProofs(proofMs: (req: (typeof posted)[number]) => number, drive: (ms: number) => void): Promise<{ most: number; made: number }> {
    useCalibration.setState({ cantorMsByHeight: PHONE })
    world(start, [boxes('Floor', 'all', [[[-200, -1, -200], [200, 0, 200]]]), [0, -1, 0]])
    walk(true)
    await wallsBuilt()
    face(0)
    down('KeyW')
    const askedAt: number[] = []
    let landed = 0
    let lastLand = clock
    let most = 0
    const t0 = clock
    while (clock - t0 < 8000) {
      drive(clock - t0)
      frame(16)
      // The walk asks for a proof a microtask or two after the move.
      await Promise.resolve(); await Promise.resolve()
      while (askedAt.length < posted.length) askedAt.push(clock)
      if (landed < posted.length && clock >= Math.max(askedAt[landed], lastLand) + proofMs(posted[landed])) {
        await useCyberspace.getState().applyProofMessage(done(posted[landed]))
        landed++
        lastLand = clock
        await vi.waitFor(() => undefined)
      }
      most = Math.max(most, eventsAhead())
    }
    up('KeyW')
    return { most, made: landed + eventsAhead() }
  }

  it('with phone proof times (300 ms a move, more for a long hop), a walk that goes straight, turns, zigzags or keeps jumping stays well under the slowdown', async () => {
    let jumps = -1
    const walks: Array<[string, (ms: number) => void]> = [
      ['straight on', () => {}],
      ['turning 120 degrees a second', (ms) => face((ms / 1000) * 120)],
      ['zigzag, 45 degrees each way every 0.4 s', (ms) => face(Math.floor(ms / 400) % 2 ? 45 : -45)],
      ['a running jump every 1.2 s', (ms) => { const k = Math.floor(ms / 1200); if (k !== jumps) { jumps = k; down('Space'); up('Space') } }],
    ]
    for (const [name, drive] of walks) {
      const most = await aheadWithProofs((req) => phoneProofMs(req, 300), drive)
      // Measured 1, 3, 4 and 4 (1, 3, 3 and 4 at the old 9.09 a second). On a slow phone (700 ms a
      // move) 1, 11, 12 and 12 (1, 8, 10 and 10 before). The slowdown starts past FLUID_EASE_FROM (14).
      expect(most, name).toBeLessThanOrEqual(6)
      expect(most, name).toBeLessThan(FLUID_EASE_FROM)
      walkKeysReleased()
      useWalk.getState().exit()
      posted.length = 0
      await useCyberspace.getState().respawn()
      useCyberspace.getState().cancel()
      start = { ...useCyberspace.getState().position }
      resetFluid()
      face(0)
    }
  })

  it('the step WALK makes fewer events a minute than fluid WALK on a walk that turns (arkinox, 2026-11-22: "you publish less actions when fluid-walk is off because you take more linear paths"), so the fluid pause drains the queue', async () => {
    let jumps = -1
    const walks: Array<[string, (ms: number) => void]> = [
      ['straight on', () => {}],
      ['a slow curve, 30 degrees a second', (ms) => face((ms / 1000) * 30)],
      ['turning 120 degrees a second', (ms) => face((ms / 1000) * 120)],
      ['a wobble, 20 degrees each way every 0.6 s', (ms) => face(Math.floor(ms / 600) % 2 ? 20 : -20)],
      ['zigzag, 45 degrees each way every 0.4 s', (ms) => face(Math.floor(ms / 400) % 2 ? 45 : -45)],
      ['a running jump every 1.2 s', (ms) => { const k = Math.floor(ms / 1200); if (k !== jumps) { jumps = k; down('Space'); up('Space') } }],
    ]
    const rows: string[] = []
    let fluidTotal = 0
    let stepTotal = 0
    for (const [name, drive] of walks) {
      const perMinute: Record<'fluid' | 'step', number> = { fluid: 0, step: 0 }
      for (const mode of ['fluid', 'step'] as const) {
        useFluidWalk.setState({ on: mode === 'fluid', paused: false })
        jumps = -1
        const { made } = await walkWithProofs((req) => phoneProofMs(req, 300), drive)
        perMinute[mode] = made * (60 / 8)
        walkKeysReleased()
        useWalk.getState().exit()
        posted.length = 0
        await useCyberspace.getState().respawn()
        useCyberspace.getState().cancel()
        start = { ...useCyberspace.getState().position }
        resetFluid()
        face(0)
      }
      rows.push(`${name}: fluid ${perMinute.fluid}/min, step ${perMinute.step}/min`)
      fluidTotal += perMinute.fluid
      stepTotal += perMinute.step
      // A walk that bends: the step WALK snaps to 8 headings and makes no more events than fluid's lines.
      // A walk that bends gently, the way a queue builds without sharp
      // turns: the step WALK snaps to 8 headings and makes far fewer events.
      if (name.startsWith('a slow curve') || name.startsWith('a wobble')) expect(perMinute.step, name).toBeLessThan(perMinute.fluid / 2)
    }
    useFluidWalk.setState({ on: true, paused: false })
    console.log(`events a minute, phone proof times (300 ms a move):\n${rows.join('\n')}\ntotal: fluid ${fluidTotal}, step ${stepTotal}`)
    // Measured (2026-11-22), events a minute fluid / step: straight 7.5 / 7.5,
    // slow curve 105 / 45, turning 120 a second 150 / 165, wobble 127.5 / 7.5,
    // zigzag 165 / 157.5, running jumps 150 / 135; total 705 / 517.5. Sharp
    // turns are a corner in both, so about even there.
    expect(stepTotal).toBeLessThan(fluidTotal * 0.85)
  }, 60000)
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

describe('floors on a slope', () => {
  it('walks up a ramp standing on it, a step at a time, under gravity', async () => {
    const ramp = withConstrain(rampFixture(), 'all')
    // The ramp's flat foot (x -24, its ground a hair under 0) is just under the walker; it rises along +X.
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
  /** Turn the parked slowdown and warning (store/walkLimits.ts SYNC_SLOWDOWN_ON) on for `body`. */
  async function withSlowdown(body: () => void | Promise<void>): Promise<void> {
    const g = globalThis as { __ONOSENDAI_SYNC_SLOWDOWN__?: boolean }
    g.__ONOSENDAI_SYNC_SLOWDOWN__ = true
    try { await body() } finally { delete g.__ONOSENDAI_SYNC_SLOWDOWN__ }
  }

  /**
   * Hold the events ahead at `n` while walking (the open segment is one of
   * them): set after the timers, so a settle never shows the walk a short
   * queue.
   */
  const at = (n: number, ms: number): void => {
    for (let t = 0; t < ms; t += 16) {
      clock += 16
      vi.advanceTimersByTime(16)
      useWalk.setState({ behind: Math.max(0, n - (useWalk.getState().open ? 1 : 0)) })
      expect(eventsAhead()).toBe(n)
      tickFluid(clock)
      tickFall(clock)
    }
  }
  const speed = (): number => len(fluidState().v)

  it('the slowdown and LOSING SYNC warning are parked behind one flag, off (arkinox, 2026-11-22: "lets turn off the slowdown and LOSING SYNC features for now")', () => {
    expect(SYNC_SLOWDOWN_ON).toBe(false)
    expect(syncSlowdownOn()).toBe(false)
    for (const n of [0, 14, 15, 17, 20, 21, 40]) {
      expect(walkSpeedFactor(n, true), `${n}`).toBe(1)
      expect(walkWarnOpacity(n, true), `${n}`).toBe(0)
    }
  })

  it('a held walk keeps full speed from 15 to 20 ahead: no slowdown, no stop', () => {
    walk()
    down('KeyW')
    for (const n of [14, 15, 17, 19, 20]) {
      const before = rel(start)
      at(n, 600)
      expect(speed(), `${n} ahead`).toBeCloseTo(FLUID_MAX_SPEED, 6)
      expect(rel(start), `${n} ahead`).not.toEqual(before)
    }
    up('KeyW')
    useWalk.setState({ behind: 0 })
  })

  it('parked, the slowdown is as it was from 15 to 19, and slowest (never stopped) at 20 and past, so the walk can reach the pause at 21', async () => {
    expect(FLUID_EASE_FROM).toBe(14)
    expect(FLUID_HOLD_AT).toBe(20)
    for (let n = 0; n <= 14; n++) expect(syncSpeedFactor(n)).toBe(1)
    for (let n = 15; n <= 19; n++) expect(syncSpeedFactor(n)).toBeCloseTo((20 - n) / 6, 9)
    expect(FLUID_SLOWEST).toBeCloseTo(1 / 6, 9)
    expect(syncSpeedFactor(20)).toBeCloseTo(1 / 6, 9)
    expect(syncSpeedFactor(31)).toBeCloseTo(1 / 6, 9)
    // The warning: 0 at 14, half at 17, full at 20.
    expect(syncWarnOpacity(14)).toBe(0)
    expect(syncWarnOpacity(15)).toBeCloseTo(1 / 6, 9)
    expect(syncWarnOpacity(17)).toBeCloseTo(0.5, 9)
    expect(syncWarnOpacity(20)).toBe(1)
    expect(syncWarnOpacity(40)).toBe(1)
    expect(SYNC_WARN_AT).toBe(15)
    await withSlowdown(() => {
      expect(walkSpeedFactor(17, true)).toBeCloseTo(0.5, 9)
      expect(walkSpeedFactor(17, false)).toBe(1)
      expect(walkWarnOpacity(20, true)).toBe(1)
      walk()
      down('KeyW')
      at(14, 1000)
      expect(speed()).toBeCloseTo(FLUID_MAX_SPEED, 6)
      for (let n = 15; n <= 19; n++) {
        at(n, 600)
        expect(speed()).toBeCloseTo(FLUID_MAX_SPEED * (20 - n) / 6, 6)
      }
      const was = rel(start)
      at(20, 1500)
      expect(speed()).toBeCloseTo(FLUID_MAX_SPEED / 6, 6)
      expect(rel(start)).not.toEqual(was)
      up('KeyW')
      useWalk.setState({ behind: 0 })
    })
  })
})

describe('the fluid pause (arkinox, 2026-11-22: "on the 21st action ahead ... automatically switch off fluid walk mode")', () => {
  const at = (n: number, ms = 48): void => {
    for (let t = 0; t < ms; t += 16) {
      clock += 16
      vi.advanceTimersByTime(16)
      useWalk.setState({ behind: Math.max(0, n - (useWalk.getState().open ? 1 : 0)) })
      tickFluid(clock)
      tickFall(clock)
    }
  }
  const sw = () => useFluidWalk.getState()

  afterEach(() => {
    useLayers.getState().setLayer('walkLimits', true)
    useFluidWalk.setState({ paused: false, resumedAt: 0 })
  })

  it('pauses at 21, not before, and the walk goes on as the step WALK; it comes back on at 15, not before', () => {
    expect(FLUID_PAUSE_AT).toBe(21)
    expect(FLUID_RESUME_AT).toBe(15)
    walk()
    down('KeyW')
    at(20, 600)
    expect(fluidOn()).toBe(true)
    expect(fluidWalking()).toBe(true)
    at(21)
    expect(sw().paused).toBe(true)
    expect(sw().on).toBe(true)
    expect(fluidOn()).toBe(false)
    expect(fluidWalking()).toBe(false)
    // The held key presses now, every WALK_HOLD_MS, as the step WALK did: still walking.
    const was = rel(start)
    at(25, 1000)
    expect(rel(start)).not.toEqual(was)
    expect(fluidOn()).toBe(false)
    for (const n of [20, 18, 16]) { at(n); expect(sw().paused, `${n}`).toBe(true) }
    at(15)
    expect(sw().paused).toBe(false)
    expect(fluidOn()).toBe(true)
    expect(sw().resumedAt).toBeGreaterThan(0)
    expect(fluidWalking()).toBe(true)
    up('KeyW')
    useWalk.setState({ behind: 0 })
  })

  it('leaving WALK while paused ends the pause quietly: no "back on" for a resume nobody saw', () => {
    walk()
    at(22)
    expect(sw().paused).toBe(true)
    useWalk.getState().exit()
    expect(sw().paused).toBe(false)
    expect(sw().resumedAt).toBe(0)
    expect(sw().on).toBe(true)
  })

  it('a fluid WALK switched off by hand stays off: nothing pauses, nothing turns it on', () => {
    useFluidWalk.getState().set(false)
    walk()
    at(25)
    expect(sw().paused).toBe(false)
    at(3)
    expect(sw().on).toBe(false)
    expect(sw().resumedAt).toBe(0)
    expect(fluidOn()).toBe(false)
  })

  it('a switch by hand while paused ends the pause and cancels the return', () => {
    walk()
    at(22)
    expect(sw().paused).toBe(true)
    // Off by hand: off it stays, all the way down.
    useFluidWalk.getState().set(false)
    expect(sw().paused).toBe(false)
    at(15)
    at(0)
    expect(sw().on).toBe(false)
    expect(sw().resumedAt).toBe(0)
    expect(fluidOn()).toBe(false)
    // On by hand while paused (18 ahead): on at once; nothing more happens at 15.
    useFluidWalk.getState().set(true)
    at(22)
    expect(sw().paused).toBe(true)
    at(18)
    useFluidWalk.getState().set(true)
    expect(sw().paused).toBe(false)
    expect(fluidOn()).toBe(true)
    at(15)
    expect(sw().resumedAt).toBe(0)
  })

  it('with the sync limit off in Settings, nothing pauses at 21 or 40, and turning it off while paused brings fluid back at once', () => {
    walk()
    down('KeyW')
    useLayers.getState().setLayer('walkLimits', false)
    for (const n of [21, 40]) {
      at(n, 600)
      expect(sw().paused, `${n}`).toBe(false)
      expect(fluidWalking(), `${n}`).toBe(true)
      expect(len(fluidState().v), `${n}`).toBeCloseTo(FLUID_MAX_SPEED, 6)
    }
    useLayers.getState().setLayer('walkLimits', true)
    at(40)
    expect(sw().paused).toBe(true)
    useLayers.getState().setLayer('walkLimits', false)
    expect(sw().paused).toBe(false)
    expect(fluidOn()).toBe(true)
    up('KeyW')
    useWalk.setState({ behind: 0 })
  })

  it('the pause is never saved: your choice stays "on" on this device, a reload starts fluid, and another identity starts from your choice', () => {
    useFluidWalk.getState().set(true)
    expect(localStorage.getItem(FLUID_KEY)).toBe('on')
    walk()
    at(21)
    expect(sw().paused).toBe(true)
    expect(localStorage.getItem(FLUID_KEY)).toBe('on')
    // A reload while paused reads your choice, not the pause.
    expect(loadFluid()).toBe(true)
    // An identity switch while paused: the pause goes with the walk, and no "back on" notice.
    const me = useCyberspace.getState().identity
    useCyberspace.setState({ identity: { pubkey: 'ab'.repeat(32), npub: 'npub1other' } })
    try {
      expect(sw().paused).toBe(false)
      expect(sw().resumedAt).toBe(0)
      expect(sw().on).toBe(true)
      expect(fluidOn()).toBe(true)
      expect(localStorage.getItem(FLUID_KEY)).toBe('on')
    } finally {
      useCyberspace.setState({ identity: me })
    }
    // Off by hand is saved as always.
    useFluidWalk.getState().set(false)
    expect(localStorage.getItem(FLUID_KEY)).toBe('off')
    expect(loadFluid()).toBe(false)
  })

  it('no flapping: a count that swings between 16 and 21 pauses once and comes back once, at 15', () => {
    walk()
    let changes = 0
    const off = useFluidWalk.subscribe((s, prev) => { if (s.paused !== prev.paused) changes++ })
    try {
      for (const n of [19, 20, 21, 20, 21, 19, 16, 21, 17, 20, 16]) at(n, 16)
      expect(changes).toBe(1)
      expect(sw().paused).toBe(true)
      at(15, 16)
      expect(changes).toBe(2)
      for (const n of [16, 18, 20, 16, 19, 20]) at(n, 16)
      expect(changes).toBe(2)
      expect(fluidOn()).toBe(true)
    } finally { off() }
  })

  it('a zigzag faster than the proofs: fluid pauses at 21 and the walk goes on stepping; once they land fluid is back on', async () => {
    walk()
    down('KeyW')
    let most = 0
    let pausedAt: V3 | null = null
    let leg = 0
    let facing = 0
    face(0)
    // Turn 90 degrees every 0.7 s: a new segment at every turn, and no proof ever lands.
    for (let t = 0; t < 30000 && !sw().paused; t += 16) {
      leg += 16
      if (leg >= 704) { leg = 0; facing = facing === 0 ? 90 : 0; face(facing) }
      frame(16)
      most = Math.max(most, eventsAhead())
      expect(Math.abs(fluidState().frac.x)).toBeLessThanOrEqual(0.75)
      expect(Math.abs(fluidState().frac.z)).toBeLessThanOrEqual(0.75)
    }
    expect(sw().paused).toBe(true)
    expect(most).toBe(FLUID_PAUSE_AT)
    pausedAt = rel(start)
    // Paused, the held key steps on.
    frames(1500)
    expect(rel(start)).not.toEqual(pausedAt)
    expect(fluidWalking()).toBe(false)
    // The proofs land: back to fluid.
    await landAll()
    expect(eventsAhead()).toBeLessThanOrEqual(FLUID_RESUME_AT)
    expect(sw().paused).toBe(false)
    expect(fluidOn()).toBe(true)
    up('KeyW')
  })
})

describe('a slow device (frames longer than WALK_SETTLE_MS)', () => {
  /** A straight walk east under gravity in frames of `ms`, held for `holdMs`: the hops it makes and the most events it was ahead. */
  async function eastIn(ms: number, holdMs: number): Promise<{ walked: number; hops: number; maxAhead: number }> {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk(true)
    face(90)
    down('KeyW')
    let maxAhead = 0
    for (let t = 0; t < holdMs; t += ms) { frame(ms); maxAhead = Math.max(maxAhead, eventsAhead()) }
    up('KeyW')
    for (let t = 0; t < 2000; t += ms) frame(ms)
    const walked = Number(useCyberspace.getState().cursor.x - start.x)
    await landAll()
    return { walked, hops: posted.length, maxAhead }
  }

  it('a straight walk is one hop and one event ahead at 16, 590 and 610 ms a frame, and at a frame a second', async () => {
    // Before the fix, a frame longer than WALK_SETTLE_MS let the stillness
    // timer close the open segment between every two frames while W was
    // held: 610 ms frames made a hop a frame (5 for 11 gibsons).
    for (const ms of [16, 590, 610, 1000]) {
      const r = await eastIn(ms, 3000)
      expect(r.walked, `${ms} ms`).toBeGreaterThan(5)
      expect(r.hops, `${ms} ms`).toBe(1)
      expect(r.maxAhead, `${ms} ms`).toBe(1)
      useWalk.getState().exit()
      posted.length = 0
      await useCyberspace.getState().respawn()
      useCyberspace.getState().cancel()
      start = { ...useCyberspace.getState().position }
      resetFluid()
    }
  })

  it('with proofs landing 2 s late: at most 3 events ahead (11 before the fix), the walker never goes back, and the walk ends on the chain', async () => {
    // Wide enough for both walks at FLUID_MAX_SPEED: off its edge the walker falls.
    world(start, [boxes('Floor', 'all', [[[-80, -1, -80], [80, 0, 80]]]), [0, -1, 0]])
    walk(true)
    face(86)
    let landed = 0
    let lastLand = clock
    let maxAhead = 0
    const xs: number[] = []
    // Where the walker is drawn along x: its gibson, plus the smooth position and the glide.
    const drawn = (): number => Number(useCyberspace.getState().cursor.x - start.x) + fluidState().frac.x + fluidState().glide.x
    const step = async (): Promise<void> => {
      frame(650)
      maxAhead = Math.max(maxAhead, eventsAhead())
      xs.push(drawn())
      if (posted.length > landed && clock - lastLand >= 2000) {
        await useCyberspace.getState().applyProofMessage(done(posted[landed]))
        landed++
        lastLand = clock
        await vi.waitFor(() => undefined)
        xs.push(drawn())
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      down('KeyW')
      for (let t = 0; t < 4000; t += 650) await step()
      up('KeyW')
      for (let t = 0; t < 4000; t += 650) await step()
    }
    await landAll()
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9)
    expect(xs[xs.length - 1]).toBeGreaterThan(8)
    // At most the segment proving, the one waiting behind it, and the one being walked (it was 11 before the fix).
    expect(maxAhead).toBeLessThanOrEqual(3)
    expect(useCyberspace.getState().proof.status).not.toBe('infeasible')
    expect(useCyberspace.getState().cursor).toEqual(useCyberspace.getState().position)
  })

  it('frames that stop mid-walk (a hidden tab): the open segment still closes and goes to be proved', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk(true)
    face(90)
    down('KeyW')
    frames(600)
    expect(useWalk.getState().open).not.toBeNull()
    expect(len(fluidState().v)).toBeGreaterThan(0)
    // No frame from here: the keys go (useKeyboard.ts on blur), the speed stays as the last frame left it.
    walkKeysReleased()
    for (let t = 0; t < 4000; t += 250) { clock += 250; vi.advanceTimersByTime(250) }
    expect(useWalk.getState().open).toBeNull()
    expect(useWalk.getState().behind).toBe(1)
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
