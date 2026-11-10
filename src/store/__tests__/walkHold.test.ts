/**
 * walkHold.test.ts - WALK's controls after the owner's play test of
 * 2026-11-10 (store/walkHold.ts, store/useWalk.ts, hud/TouchControls.tsx):
 *
 * - a held key or pad key walks from the press on, one press every
 *   WALK_HOLD_MS, with no pause first; the keyboard's own repeats add
 *   nothing; letting go stops it;
 * - two directions held are one diagonal, on the keyboard and on the pad
 *   (FORWARD and a side arrow held, or FORWARD pressed in an outer third,
 *   veering as the thumb slides);
 * - the sides go along the facing's right, and a press in the air goes the
 *   way you face, a diagonal included (it went along the screen's axis);
 * - a hold publishes what the same taps publish: the same hops, as many.
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
  // Offline: no live relay is ever asked (src/test/offlineRelay.ts).
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { useCyberspace } from '../useCyberspace'
import { WALK_SETTLE_MS, fallState, useWalk } from '../useWalk'
import { WALK_HOLD_MS, holding } from '../walkHold'
import { useShards } from '../useShards'
import { clearWalls } from '../walkWalls'
import { useCalibration } from '../../lib/calibration'
import { walkFacing } from '../../lib/walkEye'
import { walkKeyDown, walkKeyUp, walkKeysReleased } from '../../hooks/useKeyboard'
import { padHold, padLean, walkPad, type PadKey } from '../../hud/TouchControls'
import type { Position, ViewAxes } from '../../lib/space'

/** Right +X, up +Y, toward the camera +Z: level, as WALK's keys are. */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

type V3 = [number, number, number]

/** Facing `deg` degrees right of -Z, level (+X at 90). */
function face(deg: number): void {
  const t = (deg * Math.PI) / 180
  walkFacing.valid = true
  walkFacing.forward = { x: Math.sin(t), y: 0, z: -Math.cos(t) }
  walkFacing.right = { x: Math.cos(t), y: 0, z: Math.sin(t) }
}

function moved(start: Position, p: Position = useCyberspace.getState().cursor): V3 {
  return [Number(p.x - start.x), Number(p.y - start.y), Number(p.z - start.z)]
}

function done(req: (typeof posted)[number]) {
  return { type: 'done' as const, id: req.id, mode: req.mode as 'hop' | 'sidestep', elapsedMs: 5, ...provedFor(req), terrainK: 3, lca: { x: 1, y: 0, z: 0 }, totalOps: 4 }
}

const key = (code: string, extra: { repeat?: boolean } = {}) => ({ code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault: () => {}, ...extra })

/** The WALK pad's key for `cell`, and a pointer on it `across` of the way from its left (0 to 1). */
const pad = (cell: string): PadKey => {
  const k = walkPad(false, () => () => {}).find((b) => b.cell === cell)
  if (!k) throw new Error(`no ${cell}`)
  return k
}
const pointer = (across = 0.5) => ({
  preventDefault: () => {},
  stopPropagation: () => {},
  clientX: 100 + across * 120,
  currentTarget: { getBoundingClientRect: () => ({ left: 100, width: 120 }) },
}) as unknown as React.PointerEvent

let start: Position
beforeEach(async () => {
  posted.length = 0
  walkFacing.valid = false
  walkKeysReleased()
  useWalk.getState().exit()
  useWalk.getState().setGravity(false)
  // Open space: nothing to stand on or bump into.
  useShards.setState({ worldItems: () => [] })
  clearWalls()
  useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode: 'off' }, scaleExp: 0 })
  await useCyberspace.getState().respawn()
  useCyberspace.getState().cancel()
  useCalibration.setState({ cantorMsByHeight: undefined })
  start = { ...useCyberspace.getState().position }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})

afterEach(() => {
  walkKeysReleased()
  useWalk.getState().exit()
  vi.useRealTimers()
})

function walk(): void {
  useWalk.getState().enter()
  useCyberspace.setState({ screenAxes: AXES })
}

describe('holding a key walks from the press on', () => {
  it('one step at once, then one every WALK_HOLD_MS: no pause first', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    expect(moved(start)).toEqual([0, 0, -1])
    vi.advanceTimersByTime(WALK_HOLD_MS - 1)
    expect(moved(start)).toEqual([0, 0, -1])
    vi.advanceTimersByTime(1)
    expect(moved(start)).toEqual([0, 0, -2])
    vi.advanceTimersByTime(WALK_HOLD_MS * 3)
    expect(moved(start)).toEqual([0, 0, -5])
  })

  it('ignores the keyboard\'s own repeats: they add no step', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    for (let k = 0; k < 10; k++) expect(walkKeyDown(key('KeyW', { repeat: true }))).toBe(true)
    expect(moved(start)).toEqual([0, 0, -1])
    vi.advanceTimersByTime(WALK_HOLD_MS)
    expect(moved(start)).toEqual([0, 0, -2])
  })

  it('letting go stops it cleanly: no step after the keyup', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    vi.advanceTimersByTime(WALK_HOLD_MS * 2)
    walkKeyUp('KeyW')
    expect(holding()).toBe(false)
    const at = moved(start)
    vi.advanceTimersByTime(WALK_HOLD_MS * 10)
    expect(moved(start)).toEqual(at)
    expect(at).toEqual([0, 0, -3])
  })

  it('losing focus, or leaving WALK, lets go of everything', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    walkKeysReleased()
    vi.advanceTimersByTime(WALK_HOLD_MS * 5)
    expect(moved(start)).toEqual([0, 0, -1])

    walkKeyDown(key('KeyW'))
    useWalk.getState().exit()
    expect(holding()).toBe(false)
    walk()
    vi.advanceTimersByTime(WALK_HOLD_MS * 5)
    expect(moved(start)).toEqual([0, 0, 0])
  })
})

describe('two directions held go diagonally', () => {
  it('W and D held: forward and right, every beat; let go of D and it is straight again', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    walkKeyDown(key('KeyD'))
    expect(moved(start)).toEqual([1, 0, -2])
    vi.advanceTimersByTime(WALK_HOLD_MS * 2)
    expect(moved(start)).toEqual([3, 0, -4])
    walkKeyUp('KeyD')
    vi.advanceTimersByTime(WALK_HOLD_MS)
    expect(moved(start)).toEqual([3, 0, -5])
  })

  it('S and A held: back and left', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyS'))
    walkKeyDown(key('KeyA'))
    vi.advanceTimersByTime(WALK_HOLD_MS)
    expect(moved(start)).toEqual([-2, 0, 3])
  })

  it('W, S and D held: the side step; W, A and D held: straight forward (opposites cancel)', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    walkKeyDown(key('KeyS'))
    walkKeyDown(key('KeyD'))
    expect(moved(start)).toEqual([1, 0, -1])
    walkKeysReleased()
    walkKeyDown(key('KeyA'))
    walkKeyDown(key('KeyD'))
    walkKeyDown(key('KeyW'))
    expect(moved(start)).toEqual([0, 0, -2])
  })

  it('a side alone goes along the facing\'s right: at 45 degrees, D is a diagonal', () => {
    walk()
    face(45)
    walkKeyDown(key('KeyD'))
    expect(moved(start)).toEqual([1, 0, 1])
    walkKeyUp('KeyD')
    walkKeyDown(key('KeyA'))
    expect(moved(start)).toEqual([0, 0, 0])
  })
})

describe('the touch pad', () => {
  it('FORWARD pressed in its right third goes forward and right, in its left third forward and left', () => {
    walk()
    face(0)
    const fwd = padHold(pad('forward'))
    fwd.onPointerDown(pointer(0.9))
    expect(moved(start)).toEqual([1, 0, -1])
    fwd.onPointerUp()
    fwd.onPointerDown(pointer(0.1))
    expect(moved(start)).toEqual([0, 0, -2])
    fwd.onPointerUp()
    fwd.onPointerDown(pointer(0.5))
    expect(moved(start)).toEqual([0, 0, -3])
    fwd.onPointerUp()
  })

  it('sliding the thumb along FORWARD veers the walk with it', () => {
    walk()
    face(0)
    const fwd = padHold(pad('forward'))
    fwd.onPointerDown(pointer(0.5))
    expect(moved(start)).toEqual([0, 0, -1])
    fwd.onPointerMove?.(pointer(0.95))
    // The slide itself presses nothing: the next beat goes the new way.
    expect(moved(start)).toEqual([0, 0, -1])
    vi.advanceTimersByTime(WALK_HOLD_MS * 2)
    expect(moved(start)).toEqual([2, 0, -3])
    fwd.onPointerMove?.(pointer(0.5))
    vi.advanceTimersByTime(WALK_HOLD_MS)
    expect(moved(start)).toEqual([2, 0, -4])
    fwd.onPointerUp()
  })

  it('FORWARD held with a side arrow is the diagonal too; BACK with a side the same backward', () => {
    walk()
    face(0)
    const fwd = padHold(pad('forward'))
    const right = padHold(pad('right'))
    fwd.onPointerDown(pointer(0.5))
    right.onPointerDown(pointer())
    vi.advanceTimersByTime(WALK_HOLD_MS)
    expect(moved(start)).toEqual([2, 0, -3])
    right.onPointerUp()
    fwd.onPointerUp()

    const back = padHold(pad('backward'))
    const left = padHold(pad('left'))
    const at = moved(start)
    back.onPointerDown(pointer())
    left.onPointerDown(pointer())
    const m = moved(start)
    expect([m[0] - at[0], m[2] - at[2]]).toEqual([-1, 2])
    back.onPointerUp()
    left.onPointerUp()
  })

  it('a held pad key walks from the press on, and pointerup, pointercancel or leave stops it', () => {
    walk()
    face(0)
    for (const end of ['onPointerUp', 'onPointerCancel', 'onPointerLeave', 'onLostPointerCapture'] as const) {
      const h = padHold(pad('forward'))
      const before = moved(start)[2]
      h.onPointerDown(pointer(0.5))
      expect(moved(start)[2]).toBe(before - 1)
      vi.advanceTimersByTime(WALK_HOLD_MS * 2)
      expect(moved(start)[2]).toBe(before - 3)
      h[end]()
      expect(holding()).toBe(false)
      vi.advanceTimersByTime(WALK_HOLD_MS * 5)
      expect(moved(start)[2]).toBe(before - 3)
    }
  })

  it('reads the thumb in thirds, and with nothing to measure, the middle', () => {
    const rect = { getBoundingClientRect: () => ({ left: 0, width: 90 }) }
    expect(padLean({ clientX: 10, currentTarget: rect })).toBe(-1)
    expect(padLean({ clientX: 45, currentTarget: rect })).toBe(0)
    expect(padLean({ clientX: 80, currentTarget: rect })).toBe(1)
    expect(padLean({ clientX: 500, currentTarget: rect })).toBe(1)
    expect(padLean({ clientX: 10 })).toBe(0)
  })
})

describe('in the air, the way you face', () => {
  it('under GRAVITY a press mid-fall at 45 degrees is a diagonal, and the same way again grows one hop', () => {
    useWalk.getState().setGravity(true)
    walk()
    face(45)
    // Nothing under you: the fall begins as WALK does.
    expect(fallState()).not.toBeNull()
    useWalk.getState().press('away')
    const a = moved(start)
    expect([a[0], a[2]]).toEqual([1, -1])
    useWalk.getState().press('away')
    const b = moved(start)
    expect([b[0], b[2]]).toEqual([2, -2])
    expect(fallState()?.waypoints).toHaveLength(1)
  })

  it('a held key walks in the air too, every beat', () => {
    useWalk.getState().setGravity(true)
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    vi.advanceTimersByTime(WALK_HOLD_MS * 3)
    expect(moved(start)[2]).toBe(-4)
    expect(fallState()?.waypoints).toHaveLength(1)
  })
})

describe('a hold publishes what the same taps publish', () => {
  /** Settle the walk and prove each hop it queues; the hops' ends, in order. */
  async function proveAll(): Promise<V3[]> {
    await vi.advanceTimersByTimeAsync(WALK_SETTLE_MS)
    const ends: V3[] = []
    for (let n = 0; n < 10; n++) {
      await vi.advanceTimersByTimeAsync(10)
      const req = posted[n]
      if (!req) break
      await useCyberspace.getState().applyProofMessage(done(req))
      ends.push(moved(start, req.to as Position))
    }
    return ends
  }

  async function run(act: () => void): Promise<{ ends: V3[]; events: number }> {
    posted.length = 0
    await useCyberspace.getState().respawn()
    useCyberspace.getState().cancel()
    start = { ...useCyberspace.getState().position }
    const before = useCyberspace.getState().events.length
    walk()
    face(0)
    act()
    const ends = await proveAll()
    const events = useCyberspace.getState().events.length - before
    useWalk.getState().exit()
    return { ends, events }
  }

  it('five beats of W held, five taps of W: one hop to the same place', async () => {
    const tapped = await run(() => { for (let k = 0; k < 5; k++) useWalk.getState().press('away') })
    const held = await run(() => {
      walkKeyDown(key('KeyW'))
      vi.advanceTimersByTime(WALK_HOLD_MS * 4)
      walkKeyUp('KeyW')
    })
    expect(tapped.ends).toEqual([[0, 0, -5]])
    expect(held).toEqual(tapped)
  })

  it('four beats of FORWARD with RIGHT held on the pad, four diagonal taps: one hop to the same place', async () => {
    const tapped = await run(() => { for (let k = 0; k < 4; k++) useWalk.getState().press('away', 1) })
    const held = await run(() => {
      const fwd = padHold(pad('forward'))
      fwd.onPointerDown(pointer(0.9))
      vi.advanceTimersByTime(WALK_HOLD_MS * 3)
      fwd.onPointerUp()
    })
    expect(tapped.ends).toEqual([[4, 0, -4]])
    expect(held).toEqual(tapped)
  })
})
