/**
 * walkJumpUp.test.ts - Space and C go up and down as you see the world, R
 * and F by where you look (arkinox, 2026-11-24: "in walk and terrain modes,
 * jump (space) should always go up relative to the view, and down (c)
 * should always go down. but R/F should continue to be relative, like the
 * WASD"; lib/walkKeys.ts verticalAlong).
 *
 * Through the real keys, the real pad and the real walk, in the step WALK
 * and fluid WALK, with the camera level, looking up, looking down and
 * rolled, in the canonical view and in compass views whose up is another
 * axis:
 *
 * - gravity off, Space and the pad's JUMP step or push along the view's up,
 *   C and the pad's DOWN along its down, however the camera looks;
 * - R and F go along the camera's own snapped up and down, as before, and W
 *   goes the way you face, as before;
 * - under GRAVITY Space and R are the jump they were, against gravity, with
 *   its arc and its fall: back where it left, nothing published.
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
  ;(globalThis as { window?: unknown }).window ??= globalThis
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

import { Euler, Matrix4, Vector3, type Quaternion } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { WALK_SETTLE_MS, fallState, tickFall, useWalk, walkDown } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { clearWalls } from '../walkWalls'
import { resetFluid, tickFluid } from '../walkFluid'
import { useFluidWalk } from '../fluidSwitch'
import { useCalibration } from '../../lib/calibration'
import { setWalkFacing, walkFacing, walkFall } from '../../lib/walkEye'
import { JUMP_HEIGHT } from '../walkGravity'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { canonicalQuaternion, claimScreenAxes, levelScreenAxes, rotateView, viewAxes, type AxisDirection, type Position, type ViewAxes } from '../../lib/space'
import { upOf } from '../../lib/walkDown'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import { padHold, walkPad } from '../../hud/TouchControls'

type V3 = [number, number, number]

const worldItemsOriginal = useShards.getState().worldItems

function rel(p: Position = useCyberspace.getState().cursor): V3 {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

/** One axis direction as a step of `n`. */
function along(d: AxisDirection, n = 1): V3 {
  const v: V3 = [0, 0, 0]
  v[d.axis === 'x' ? 0 : d.axis === 'y' ? 1 : 2] = d.dir * n
  return v
}

/** Closed boxes from `lo` to `hi`, in gibsons from the shard's origin (as walkFluid.test.ts builds them). */
function boxes(name: string, c: Constrain, list: Array<[V3, V3]>): ShardModel {
  const vertices: ShardModel['vertices'] = []
  const faces: Array<[number, number, number]> = []
  for (const [lo, hi] of list) {
    const base = vertices.length
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) vertices.push({ p: [x, y, z], c: [1, 1, 1] })
    for (const [a, b, cc, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
      faces.push([base + a, base + b, base + cc], [base + a, base + cc, base + d])
    }
  }
  return withConstrain({ ...newShard(name), mode: 'solid', vertices, faces }, c)
}

function floorUnder(): void {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const shard = boxes('Floor', 'all', [[[-40, -1, -40], [40, 0, 40]]])
  const items: WorldItem[] = [{ key: 'floor', type: 'shard', at: { x: start.x, y: start.y - 1n, z: start.z }, plane, height: 84, mine: false, shard }]
  useShards.setState({ worldItems: () => items })
}

let clock = 1_000_000
function frame(ms = 16): void {
  clock += ms
  vi.advanceTimersByTime(ms)
  tickFluid(clock)
  tickFall(clock)
}
function frames(ms: number): void {
  for (let t = 0; t < ms; t += 16) frame(16)
}

const key = (code: string) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {} })
function tap(code: string): void { walkKeyDown(key(code)); walkKeyUp(code) }

const pointer = { preventDefault: () => {}, stopPropagation: () => {}, clientX: 0 } as unknown as React.PointerEvent
function padTap(cell: 'jump' | 'down'): void {
  const k = walkPad(useWalk.getState().gravity, () => () => {}).find((b) => b.cell === cell)!
  const h = padHold(k)
  h.onPointerDown(pointer)
  h.onPointerUp()
}

/**
 * Look the way the camera would, as the scene's ScreenAxes reads it: the
 * camera turned `yaw`, pitched `pitch` (up positive) and rolled `roll`
 * degrees in the view's own frame; its facing and the screen's axes (level
 * across gravity under GRAVITY) set from it.
 */
function look(pitch: number, yaw = 0, roll = 0): ViewAxes {
  const r = Math.PI / 180
  const m = new Matrix4().makeRotationFromEuler(new Euler(pitch * r, yaw * r, roll * r, 'YXZ'))
  const right = new Vector3(), up = new Vector3(), out = new Vector3()
  m.extractBasis(right, up, out)
  const local = useCyberspace.getState().axes()
  setWalkFacing(right, out, local)
  const screen = useWalk.getState().gravity ? levelScreenAxes(right, up, out, local, walkDown()) : claimScreenAxes(right, up, out, local)
  useCyberspace.setState({ screenAxes: screen })
  return screen
}

/** A compass view whose up is not +Y: tipped once, then turned. */
function tippedView(): Quaternion {
  return rotateView(rotateView(canonicalQuaternion(), 'up'), 'left')
}

let start: Position

beforeEach(async () => {
  posted.length = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  walkKeysReleased()
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useWalk.getState().setHardGravity(false)
  useFluidWalk.setState({ on: false, paused: false, resumedAt: 0 })
  useShards.setState({ worldItems: () => [] })
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
  useShards.setState({ worldItems: worldItemsOriginal })
  useCyberspace.setState({ view: canonicalQuaternion() })
  walkFacing.valid = false
  resetFluid()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function walk(view: Quaternion = canonicalQuaternion(), gravity = false): void {
  useCyberspace.setState({ view })
  useWalk.getState().setGravity(gravity)
  useWalk.getState().enter()
  frame(16)
}

/** The step WALK: what one tap of `code` moves, from where it starts, then back to the start's place. */
function stepOf(code: string): V3 {
  const before = rel()
  tap(code)
  const after = rel()
  return [after[0] - before[0], after[1] - before[1], after[2] - before[2]]
}

describe('the step WALK, gravity off', () => {
  const LOOKS: Array<[string, number, number, number]> = [
    ['level', 0, 0, 0],
    ['looking up 60 degrees', 60, 0, 0],
    ['looking down 60 degrees', -60, 0, 0],
    ['rolled 60 degrees', 0, 0, 60],
    ['turned 135, looking up 70', 70, 135, 0],
  ]
  for (const [name, pitch, yaw, roll] of LOOKS) {
    for (const [viewName, view] of [['the canonical view', canonicalQuaternion()], ['a tipped compass view', tippedView()]] as const) {
      it(`${name}, ${viewName}: Space and JUMP go the view's up, C and DOWN its down; R and F the camera's up and down`, () => {
        walk(view)
        const screen = look(pitch, yaw, roll)
        const up = viewAxes(view).up
        expect(upOf(walkDown())).toEqual(up)
        const camUp = screen.up
        const camDown: AxisDirection = { axis: camUp.axis, dir: camUp.dir === 1 ? -1 : 1 }
        const viewDownDir: AxisDirection = { axis: up.axis, dir: up.dir === 1 ? -1 : 1 }
        expect(stepOf('Space')).toEqual(along(up))
        expect(stepOf('KeyC')).toEqual(along(viewDownDir))
        expect(stepOf('KeyR')).toEqual(along(camUp))
        expect(stepOf('KeyF')).toEqual(along(camDown))
        const before = rel()
        padTap('jump')
        expect(rel()).toEqual(before.map((v, i) => v + along(up)[i]))
        padTap('down')
        expect(rel()).toEqual(before)
      })
    }
  }

  it('looking up 60 degrees in the canonical view, by hand: Space +Y, R toward -Z (behind), and W still flies the way you face (+Y)', () => {
    walk()
    look(60)
    expect(stepOf('Space')).toEqual([0, 1, 0])
    expect(stepOf('KeyR')).toEqual([0, 0, -1])
    expect(stepOf('KeyF')).toEqual([0, 0, 1])
    expect(stepOf('KeyC')).toEqual([0, -1, 0])
    // WASD as before: forward laid flat across the camera's up (-Z) is +Y.
    expect(stepOf('KeyW')).toEqual([0, 1, 0])
    expect(stepOf('KeyS')).toEqual([0, -1, 0])
    expect(stepOf('KeyD')).toEqual([1, 0, 0])
    expect(stepOf('KeyA')).toEqual([-1, 0, 0])
  })

  it('Space and R held together go the view\'s up; Space, C and R together leave R\'s, the camera\'s', () => {
    walk()
    look(60)
    // R alone steps along the camera's up (-Z); Space going down with R
    // held presses what both make, and the view's key agrees: the view's up.
    walkKeyDown(key('KeyR'))
    expect(rel()).toEqual([0, 0, -1])
    walkKeyDown(key('Space'))
    expect(rel()).toEqual([0, 1, -1])
    walkKeysReleased()
    // Space (+Y), then C with it: they cancel, nothing; then R: what is left
    // is R's, along the camera's up (-Z).
    walkKeyDown(key('Space'))
    expect(rel()).toEqual([0, 2, -1])
    walkKeyDown(key('KeyC'))
    expect(rel()).toEqual([0, 2, -1])
    walkKeyDown(key('KeyR'))
    expect(rel()).toEqual([0, 2, -2])
    walkKeysReleased()
  })

  it('a step is still one step long, and the steps go to be proved through the walk as before', async () => {
    walk()
    look(-60)
    tap('Space')
    tap('Space')
    tap('Space')
    expect(rel()).toEqual([0, 3, 0])
    // One heading, one open segment from the start: the walk's own pipeline.
    const w = useWalk.getState()
    expect(w.open?.from).toEqual(start)
    expect(w.open?.end).toEqual({ ...start, y: start.y + 3n })
    const events = useCyberspace.getState().events.length
    await vi.advanceTimersByTimeAsync(WALK_SETTLE_MS + 10)
    expect(posted).toHaveLength(1)
    expect(posted[0].from).toEqual(start)
    expect(posted[0].to).toEqual({ ...start, y: start.y + 3n })
    await useCyberspace.getState().applyProofMessage({ type: 'done', id: posted[0].id, mode: posted[0].mode as 'hop', elapsedMs: 5, ...provedFor(posted[0]), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 })
    await vi.advanceTimersByTimeAsync(10)
    // One chain step, to where the walk went.
    expect(useCyberspace.getState().events.length).toBe(events + 1)
    expect(useCyberspace.getState().position).toEqual({ ...start, y: start.y + 3n })
  })
})

describe('fluid WALK, gravity off', () => {
  beforeEach(() => { useFluidWalk.setState({ on: true }) })

  /** Hold `code` for `ms`, let go, and let it come to rest: where it went. */
  function hold(code: string, ms = 400): V3 {
    const before = rel()
    walkKeyDown(key(code))
    frames(ms)
    walkKeyUp(code)
    frames(400)
    const after = rel()
    return [after[0] - before[0], after[1] - before[1], after[2] - before[2]]
  }

  /** Only along `d`, at least `min` gibsons. */
  function onlyAlong(v: V3, d: AxisDirection, min = 2): void {
    const i = d.axis === 'x' ? 0 : d.axis === 'y' ? 1 : 2
    for (let k = 0; k < 3; k++) {
      if (k === i) expect(v[k] * d.dir).toBeGreaterThanOrEqual(min)
      else expect(v[k]).toBe(0)
    }
  }

  for (const [name, pitch, roll] of [['looking up 60 degrees', 60, 0], ['looking down 60 degrees', -60, 0], ['rolled 60 degrees', 0, 60]] as const) {
    for (const [viewName, view] of [['the canonical view', canonicalQuaternion()], ['a tipped compass view', tippedView()]] as const) {
      it(`${name}, ${viewName}: Space held pushes along the view's up, C its down; R and F along the camera's`, () => {
        walk(view)
        const screen = look(pitch, 0, roll)
        const up = viewAxes(view).up
        const flip = (d: AxisDirection): AxisDirection => ({ axis: d.axis, dir: d.dir === 1 ? -1 : 1 })
        onlyAlong(hold('Space'), up)
        onlyAlong(hold('KeyC'), flip(up))
        onlyAlong(hold('KeyR'), screen.up)
        onlyAlong(hold('KeyF'), flip(screen.up))
      })
    }
  }

  it('a tap of Space nudges along the view\'s up too, looking up 60 degrees', () => {
    walk()
    look(60)
    tap('Space')
    frames(600)
    expect(rel()).toEqual([0, 1, 0])
    tap('KeyR')
    frames(600)
    expect(rel()).toEqual([0, 1, -1])
  })

  it('W held, looking up 60 degrees: along the whole look, up and on together (arkinox, 2026-11-27), never snapped to +Y alone', () => {
    walk()
    look(60)
    const v = hold('KeyW')
    // 60 degrees up from +Z (the canonical view faces the black sun): mostly +Y, some +Z (sin 60 to cos 60, about
    // 1.7 to 1), none across.
    expect(v[0]).toBe(0)
    expect(v[1]).toBeGreaterThanOrEqual(2)
    expect(v[2]).toBeGreaterThanOrEqual(1)
    expect(v[1]).toBeGreaterThan(v[2])
  })
})

describe('under GRAVITY nothing changes: Space and R jump, against gravity, and come down', () => {
  for (const [name, pitch] of [['level', 0], ['looking up 60 degrees', 60], ['looking down 60 degrees', -60]] as const) {
    for (const code of ['Space', 'KeyR'] as const) {
      it(`${name}: ${code === 'Space' ? 'Space' : 'R'} jumps and lands where it left, nothing published`, () => {
        for (const fluid of [false, true]) {
          useFluidWalk.setState({ on: fluid })
          floorUnder()
          walk(canonicalQuaternion(), true)
          look(pitch)
          tap(code)
          expect(fallState()).not.toBeNull()
          // The arc rises against gravity (+Y), whatever the camera does, then falls back.
          const eye = (): number => Number(useCyberspace.getState().cursor.y - start.y) + (walkFall.active ? walkFall.offset : 0)
          let peak = -Infinity
          for (let t = 0; t < 2000; t += 16) { frame(16); if (fallState()) peak = Math.max(peak, eye()) }
          expect(peak).toBeGreaterThan(4)
          expect(peak).toBeLessThanOrEqual(JUMP_HEIGHT)
          expect(fallState()).toBeNull()
          expect(rel()).toEqual([0, 0, 0])
          useWalk.getState().exit()
        }
        expect(posted).toHaveLength(0)
      })
    }
  }

  it('C under GRAVITY on the floor does nothing, as before', () => {
    floorUnder()
    walk(canonicalQuaternion(), true)
    look(-60)
    tap('KeyC')
    frames(300)
    expect(fallState()).toBeNull()
    expect(rel()).toEqual([0, 0, 0])
  })
})
