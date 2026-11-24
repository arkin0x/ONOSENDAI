/**
 * walkBounceSound.test.ts - the bounce's sound (lib/sfx.ts; arkinox,
 * 2026-11-24: "a bouncing sound effect when you bounce on a shard ... it
 * should always play for all shards, including the tutorial shard, and all
 * existing placed shards"). WALK (store/useWalk.ts (E)) asks sfx for one
 * `bounce` each time your walker is launched off a pad, and never when it
 * is not: one at a landing's bounce, one more each bounce after, one at a
 * step up onto a pad and a walk onto a springboard, step WALK and fluid walk
 * alike, on the tutorial's own trampoline from its own piece, and none
 * when Down absorbs it or on a plain floor. Under MUTE ALL and on TV's
 * broadcast the bounce still happens and sounds nothing. The audio context is a recording fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

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
/** The one audio context, a fake that counts the oscillators started: three a boing. */
const audio = vi.hoisted(() => ({ oscillators: 0 }))
vi.mock('../../lib/audioContext', async (orig) => {
  const mod = await orig<typeof import('../../lib/audioContext')>()
  const param = { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }
  const node = { connect: () => undefined, gain: param, frequency: param, Q: param, type: '' }
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    createGain: () => node,
    createBiquadFilter: () => node,
    createOscillator: () => ({ ...node, start: () => { audio.oscillators++ }, stop: () => undefined }),
  }
  return { ...mod, audioContext: () => ctx, wantSound: () => undefined }
})

import { fromPayload, newShard, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { fallState, tickFall, useWalk } from '../useWalk'
import { useShards, type WorldItem } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'
import { clearWalls } from '../walkWalls'
import { JUMP_HANG_S, JUMP_SPEED } from '../walkGravity'
import { resetFluid, tickFluid } from '../walkFluid'
import { useFluidWalk } from '../fluidSwitch'
import { useCalibration } from '../../lib/calibration'
import { withConstrain, type Constrain } from '../../lib/walkConstrain'
import { bounceOf } from '../../lib/walkBounce'
import { resetSfx, sfx } from '../../lib/sfx'
import { useSoundMutes } from '../useSoundMutes'
import { setBroadcastForTest } from '../../lib/tv/broadcast'
import { walkFacing } from '../../lib/walkEye'
import { canonicalQuaternion, type Position, type ViewAxes } from '../../lib/space'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import trampoline from '../../tutorial/pieces/trampoline-4.json'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const LANDS_MS = JUMP_HANG_S * 1000
const worldItemsOriginal = useShards.getState().worldItems

type V3 = [number, number, number]

/** Closed boxes from `lo` to `hi`, in gibsons from the shard's origin, at unit 0 (as walkBounce.test.ts builds them). */
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

function world(start: Position, ...placed: Array<[ShardModel, V3]>): WorldItem[] {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = placed.map(([shard, o], n) => ({
    key: `w${n}-${shard.id}`, type: 'shard', at: { x: start.x + BigInt(o[0]), y: start.y + BigInt(o[1]), z: start.z + BigInt(o[2]) }, plane, height: 84, mine: false, shard,
  }))
  useShards.setState({ worldItems: () => items })
  return items
}

function bouncy(s: ShardModel, bounce: unknown): ShardModel {
  return { ...s, extra: { ...s.extra, bounce } }
}

/** A floor under the walker, its top 1 below. */
const FLOOR: [V3, V3] = [[-10, -1, -10], [10, 0, 10]]

let clock = 1_000_000
function frame(ms: number): void {
  clock += ms
  tickFall()
}
/** Frames until the fall is on a bounce's arc (faster than a jump), at most `maxMs`. */
function untilBounce(maxMs = 10_000): void {
  for (let t = 0; t < maxMs && fallState() && fallState()!.v0 <= JUMP_SPEED + 1e-9; t += 16) frame(16)
}
/** Frames until the next bounce: the arc's launch time changes. */
function nextBounce(maxMs = 10_000): void {
  const t0 = fallState()!.t0
  for (let t = 0; t < maxMs && fallState() && fallState()!.t0 === t0; t += 16) frame(16)
}

/** How many times WALK asked for the bounce's sound, and how many of those sounded. */
let plays: MockInstance<typeof sfx.play>
const sounded = (): number => plays.mock.results.filter((r) => r.value === true).length

let start: Position

beforeEach(async () => {
  posted.length = 0
  audio.oscillators = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  plays = vi.spyOn(sfx, 'play')
  resetSfx()
  setBroadcastForTest(false)
  ceiling.hopHeight = 40
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  useShards.setState({ worldItems: worldItemsOriginal })
  useWorkshop.setState({ open: false })
  clearWalls()
  useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0, view: canonicalQuaternion() })
  await useCyberspace.getState().respawn()
  useCyberspace.getState().cancel()
  useCalibration.setState({ cantorMsByHeight: undefined })
  useToast.setState({ toast: null })
  start = { ...useCyberspace.getState().position }
})

afterEach(() => {
  useWalk.getState().exit()
  setBroadcastForTest(null)
  vi.restoreAllMocks()
})

function walk(gravity: boolean): void {
  useWalk.getState().setGravity(gravity)
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
}

describe('a landing on a pad', () => {
  it('a jump onto a pad of 8: nothing until it bounces, then exactly one play, and one more each bounce', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(LANDS_MS - 50)
    expect(plays).not.toHaveBeenCalled()
    untilBounce()
    expect(plays).toHaveBeenCalledTimes(1)
    expect(plays).toHaveBeenLastCalledWith('bounce', expect.any(Number))
    expect(sounded()).toBe(1)
    expect(audio.oscillators).toBe(3)
    nextBounce()
    expect(plays).toHaveBeenCalledTimes(2)
    nextBounce()
    expect(plays).toHaveBeenCalledTimes(3)
    expect(sounded()).toBe(3)
  })

  it('the tutorial\'s trampoline, from its own piece: one play at its bounce', () => {
    const tramp = fromPayload(trampoline as unknown as ShardPayload, 'tutorial-trampoline')!
    expect(bounceOf(tramp)).toBe(12)
    // The trampoline's top is 1 above its origin, so its origin 2 under the walker puts its top 1 below.
    world(start, [tramp, [0, -2, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    expect(fallState()!.v0).toBeGreaterThan(JUMP_SPEED)
    expect(plays).toHaveBeenCalledTimes(1)
    expect(sounded()).toBe(1)
  })

  it('a higher pad is a stronger bounce', () => {
    const strengthOn = (b: number): number => {
      plays.mockClear()
      resetSfx()
      useWalk.getState().exit()
      clearWalls()
      world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), b), [0, -1, 0]])
      walk(true)
      useWalk.getState().press('up')
      untilBounce()
      return plays.mock.calls[0][1] as number
    }
    expect(strengthOn(3)).toBeLessThan(strengthOn(20))
  })

  it('Down just before the landing absorbs it: no play', () => {
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    frame(LANDS_MS - 10)
    useWalk.getState().press('down')
    frame(30)
    expect(useWalk.getState().falling).toBe(false)
    expect(plays).not.toHaveBeenCalled()
  })

  it('a plain floor never plays', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    for (let t = 0; t < 3000; t += 16) frame(16)
    expect(plays).not.toHaveBeenCalled()
  })

  it('under MUTE ALL the bounce still happens, and nothing sounds', () => {
    useSoundMutes.setState({ master: true })
    try {
      world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
      walk(true)
      useWalk.getState().press('up')
      untilBounce()
      expect(fallState()!.v0).toBeGreaterThan(JUMP_SPEED)
      expect(plays).toHaveBeenCalledTimes(1)
      expect(sounded()).toBe(0)
      expect(audio.oscillators).toBe(0)
    } finally {
      useSoundMutes.setState({ master: false })
    }
  })

  it('on TV\'s broadcast the bounce still happens, and nothing sounds', () => {
    setBroadcastForTest(true)
    world(start, [bouncy(boxes('Pad', 'all', [FLOOR]), 8), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('up')
    untilBounce()
    expect(fallState()!.v0).toBeGreaterThan(JUMP_SPEED)
    expect(plays).toHaveBeenCalledTimes(1)
    expect(sounded()).toBe(0)
    expect(audio.oscillators).toBe(0)
  })
})

describe('arriving on a pad', () => {
  /** A plain floor, and a pad from 1 ahead whose top is 1 up: a riser the step-up climbs. */
  const PAD_TOP: [V3, V3] = [[-10, 0, -10], [10, 1, -0.5]]

  it('a step up onto a pad of 6: exactly one play as it launches', () => {
    world(start, [boxes('Floor', 'all', [FLOOR]), [0, -1, 0]], [bouncy(boxes('Pad', 'all', [PAD_TOP]), 6), [0, -1, 0]])
    walk(true)
    useWalk.getState().press('away')
    expect(useWalk.getState().falling).toBe(true)
    expect(plays).toHaveBeenCalledTimes(1)
    expect(sounded()).toBe(1)
  })

  it('a level walk onto a flush springboard, in fluid walk: one play as it launches', () => {
    const LEDGE: [V3, V3] = [[-10, -1, -0.5], [10, 0, 10]]
    const PAD: [V3, V3] = [[-10, -1, -40], [10, 0, -0.5]]
    const pad = bouncy(boxes('Board', 'all', [PAD]), 12)
    const board: ShardModel = { ...pad, extra: { ...pad.extra, springboard: true } }
    world(start, [boxes('Floor', 'all', [LEDGE]), [0, -1, 0]], [board, [0, -1, 0]])
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    useFluidWalk.setState({ on: true, paused: false, resumedAt: 0 })
    resetFluid()
    walkFacing.forward = { x: 0, y: 0, z: -1 }
    walkFacing.right = { x: 1, y: 0, z: 0 }
    walkFacing.valid = true
    const key = { code: 'KeyW', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {} }
    try {
      walk(true)
      walkKeyDown(key)
      for (let t = 0; t < 2000 && !useWalk.getState().falling; t += 16) {
        clock += 16
        vi.advanceTimersByTime(16)
        tickFluid(clock)
        tickFall(clock)
      }
      walkKeyUp('KeyW')
      expect(useWalk.getState().falling).toBe(true)
      expect(fallState()!.v0).toBeGreaterThan(JUMP_SPEED)
      expect(plays).toHaveBeenCalledTimes(1)
      expect(sounded()).toBe(1)
    } finally {
      walkKeysReleased()
      useWalk.getState().exit()
      useFluidWalk.setState({ on: false })
      walkFacing.valid = false
      resetFluid()
      vi.useRealTimers()
    }
  })
})
