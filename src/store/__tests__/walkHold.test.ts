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
 * - a hold publishes what the same taps publish: the same hops, as many;
 * - under GRAVITY the pad's DOWN is on, and held through a bounce's fall it
 *   absorbs the landing, where one early tap does not (review of #649);
 *
 * Review of #651: a lost keyup (Cmd on macOS), a hidden page, a STOP, the
 * menu, a modal or the workshop let go of every hold; a thumb resting on a
 * zone line of FORWARD makes one hop, not one a beat; JUMP with FORWARD held
 * is a running jump that walks on; a bounce reads Up and Down as held.
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
import { WALK_SETTLE_MS, fallState, tickFall, useWalk } from '../useWalk'
import { WALK_HOLD_MS, holding } from '../walkHold'
import { useShards } from '../useShards'
import { clearWalls } from '../walkWalls'
import { useCalibration } from '../../lib/calibration'
import { walkFacing } from '../../lib/walkEye'
import { setMenuCovering, walkKeyDown, walkKeyUp, walkKeysReleased, walkMetaRelease } from '../../hooks/useKeyboard'
import { registerEscape } from '../../hooks/useEscape'
import { useWorkshop } from '../useWorkshop'
import { LEAN_SLOP_PX, LEAN_ZONE, padHold, padLean, walkPad, type PadKey } from '../../hud/TouchControls'
import type { Position, ViewAxes } from '../../lib/space'
import { newShard, type ShardModel } from 'sno-core/shards'
import { withConstrain } from '../../lib/walkConstrain'
import { JUMP_SPEED, WALK_GRAVITY } from '../walkGravity'
import type { WorldItem } from '../useShards'

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
const pointer = (across = 0.5, px = 0) => ({
  preventDefault: () => {},
  stopPropagation: () => {},
  clientX: 100 + across * 120 + px,
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
  setMenuCovering(false)
  useWorkshop.setState({ open: false })
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
  it('FORWARD pressed in its right end goes forward and right, in its left end forward and left', () => {
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

  it('reads the thumb in zones of 22%, 56% and 22%, and with nothing to measure, the middle', () => {
    const rect = { getBoundingClientRect: () => ({ left: 0, width: 100 }) }
    expect(LEAN_ZONE).toBeCloseTo(0.22, 6)
    expect(padLean({ clientX: 21, currentTarget: rect })).toBe(-1)
    expect(padLean({ clientX: 23, currentTarget: rect })).toBe(0)
    expect(padLean({ clientX: 77, currentTarget: rect })).toBe(0)
    expect(padLean({ clientX: 79, currentTarget: rect })).toBe(1)
    expect(padLean({ clientX: 500, currentTarget: rect })).toBe(1)
    expect(padLean({ clientX: 10 })).toBe(0)
  })

  it('a sliding thumb changes the lean only LEAN_SLOP_PX past a line', () => {
    const rect = { getBoundingClientRect: () => ({ left: 0, width: 100 }) }
    const at = (x: number, was: -1 | 0 | 1) => padLean({ clientX: x, currentTarget: rect }, was)
    expect(at(22 + LEAN_SLOP_PX - 1, -1)).toBe(-1)
    expect(at(22 + LEAN_SLOP_PX, -1)).toBe(0)
    expect(at(22 - LEAN_SLOP_PX + 1, 0)).toBe(0)
    expect(at(22 - LEAN_SLOP_PX, 0)).toBe(-1)
    expect(at(78 + LEAN_SLOP_PX - 1, 0)).toBe(0)
    expect(at(78 + LEAN_SLOP_PX, 0)).toBe(1)
    expect(at(78 - LEAN_SLOP_PX + 1, 1)).toBe(1)
  })
})

describe('every hold is let go when no release can come (review of #651)', () => {
  it('a lost keyup: Meta down or up, or a key with Meta held, lets go of every hold', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    vi.advanceTimersByTime(WALK_HOLD_MS)
    // Cmd goes down; macOS will send no keyup for W.
    expect(walkMetaRelease({ code: 'MetaLeft', metaKey: true, key: 'Meta' })).toBe(true)
    expect(holding()).toBe(false)
    vi.advanceTimersByTime(WALK_HOLD_MS * 20)
    expect(moved(start)).toEqual([0, 0, -2])

    padHold(pad('forward')).onPointerDown(pointer())
    walkKeyDown(key('KeyD'))
    expect(walkMetaRelease({ code: 'KeyD', metaKey: true })).toBe(true)
    expect(holding()).toBe(false)
    walkKeyDown(key('KeyW'))
    expect(walkMetaRelease({ code: 'MetaRight', metaKey: false, key: 'Meta' })).toBe(true)
    expect(holding()).toBe(false)
    expect(walkMetaRelease({ code: 'KeyW', metaKey: false, key: 'w' })).toBe(false)
  })

  it('losing focus or the page hidden lets go of the pad\'s holds too', () => {
    walk()
    face(0)
    padHold(pad('forward')).onPointerDown(pointer())
    walkKeysReleased()
    expect(holding()).toBe(false)
    vi.advanceTimersByTime(WALK_HOLD_MS * 5)
    expect(moved(start)).toEqual([0, 0, -1])
  })

  it('STOP mid-hold: the hold goes with the walk, and nothing more is walked', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    vi.advanceTimersByTime(WALK_HOLD_MS * 2)
    useWalk.getState().stop('refused')
    expect(holding()).toBe(false)
    const at = moved(start)
    vi.advanceTimersByTime(WALK_HOLD_MS * 5)
    expect(moved(start)).toEqual(at)

    padHold(pad('forward')).onPointerDown(pointer())
    useWalk.getState().stop()
    expect(holding()).toBe(false)
  })

  it('the menu covering the scene: nothing is held, and a hold under it is let go at the next beat', () => {
    walk()
    face(0)
    setMenuCovering(true)
    walkKeyDown(key('KeyW'))
    padHold(pad('forward')).onPointerDown(pointer())
    expect(holding()).toBe(false)
    expect(moved(start)).toEqual([0, 0, 0])
    setMenuCovering(false)
    padHold(pad('forward')).onPointerDown(pointer())
    expect(moved(start)).toEqual([0, 0, -1])
    setMenuCovering(true)
    vi.advanceTimersByTime(WALK_HOLD_MS * 5)
    expect(holding()).toBe(false)
    expect(moved(start)).toEqual([0, 0, -1])
  })

  it('a text field focused (the chat line after typing) closes the keyboard only: the pad walks on (re-review of #651)', () => {
    walk()
    face(0)
    vi.stubGlobal('document', { activeElement: { tagName: 'INPUT', isContentEditable: false } })
    try {
      walkKeyDown(key('KeyW'))
      expect(holding()).toBe(false)
      expect(moved(start)).toEqual([0, 0, 0])
      // The pad's press is never typing: it walks, and keeps walking.
      const fwd = padHold(pad('forward'))
      fwd.onPointerDown(pointer())
      expect(moved(start)).toEqual([0, 0, -1])
      vi.advanceTimersByTime(WALK_HOLD_MS * 2)
      expect(moved(start)).toEqual([0, 0, -3])
      fwd.onPointerUp()
      // A key held as focus goes into a field is let go at the next beat; a pad key held with it walks on.
      vi.stubGlobal('document', { activeElement: null })
      walkKeyDown(key('KeyD'))
      fwd.onPointerDown(pointer())
      vi.stubGlobal('document', { activeElement: { tagName: 'TEXTAREA', isContentEditable: false } })
      const before = moved(start)
      vi.advanceTimersByTime(WALK_HOLD_MS)
      const after = moved(start)
      // That beat was FORWARD alone: straight on, with D let go.
      expect([after[0] - before[0], after[2] - before[2]]).toEqual([0, -1])
      expect(holding()).toBe(true)
      fwd.onPointerUp()
      expect(holding()).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a modal or the workshop: the same', () => {
    walk()
    face(0)
    const off = registerEscape('modal', () => {})
    padHold(pad('forward')).onPointerDown(pointer())
    walkKeyDown(key('KeyW'))
    expect(holding()).toBe(false)
    off()
    walkKeyDown(key('KeyW'))
    expect(moved(start)).toEqual([0, 0, -1])
    const off2 = registerEscape('modal', () => {})
    vi.advanceTimersByTime(WALK_HOLD_MS * 3)
    expect(holding()).toBe(false)
    expect(moved(start)).toEqual([0, 0, -1])
    off2()

    useWorkshop.setState({ open: true })
    padHold(pad('forward')).onPointerDown(pointer())
    expect(walkKeyDown(key('KeyW'))).toBe(false)
    expect(holding()).toBe(false)
    expect(moved(start)).toEqual([0, 0, -1])
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

  it('a thumb jittering 3 px either side of a zone line for 10 beats: one hop, not one a beat', async () => {
    const tapped = await run(() => { for (let k = 0; k < 10; k++) useWalk.getState().press('away', -1) })
    const jittered = await run(() => {
      const fwd = padHold(pad('forward'))
      fwd.onPointerDown(pointer(LEAN_ZONE, -3))
      for (let k = 0; k < 9; k++) {
        fwd.onPointerMove?.(pointer(LEAN_ZONE, k % 2 ? -3 : 3))
        vi.advanceTimersByTime(WALK_HOLD_MS)
      }
      fwd.onPointerUp()
    })
    expect(tapped.ends).toEqual([[-10, 0, -10]])
    expect(jittered).toEqual(tapped)
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

describe('the pad\'s DOWN under GRAVITY absorbs a bounce (review of #649)', () => {
  /** A floor whose top is 1 under the walker, 40 gibsons square, its payload bouncing to `bounce` (as walkBounce.test.ts builds it). */
  function bouncePad(bounce: number | null = 8): void {
    const vertices: ShardModel['vertices'] = []
    const faces: Array<[number, number, number]> = []
    for (const x of [-20, 20]) for (const y of [-1, 0]) for (const z of [-20, 20]) vertices.push({ p: [x, y, z], c: [1, 1, 1] })
    for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) faces.push([a, b, c], [a, c, d])
    const model = withConstrain({ ...newShard('Pad'), mode: 'solid', vertices, faces }, 'all')
    const shard = bounce === null ? model : { ...model, extra: { ...model.extra, bounce } }
    const plane = useCyberspace.getState().plane as WorldItem['plane']
    const items: WorldItem[] = [{ key: 'pad', type: 'shard', at: { ...start, y: start.y - 1n }, plane, height: 84, mine: false, shard }]
    useShards.setState({ worldItems: () => items })
  }

  let clock = 1_000_000
  /** `ms` of 16 ms frames: the clock, the hold's timers and the fall, together. */
  function frames(ms: number): void {
    for (let t = 0; t < ms; t += 16) { clock += 16; vi.advanceTimersByTime(16); tickFall() }
  }
  const gpad = (cell: string): PadKey => {
    const k = walkPad(true, () => () => {}).find((b) => b.cell === cell)
    if (!k) throw new Error(`no ${cell}`)
    return k
  }
  const down = (): PadKey => gpad('down')

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    bouncePad()
    useWalk.getState().setGravity(true)
    walk()
  })
  afterEach(() => {
    vi.mocked(performance.now).mockRestore()
  })

  it('DOWN is on under gravity', () => {
    expect(down().disabled).toBeFalsy()
  })

  it('DOWN held from early in the jump registers at the landing: it lands and stands, and nothing is made', () => {
    useWalk.getState().press('up')
    // The jump reaches the pad at about 600 ms; DOWN goes down at 100, far before the window.
    frames(100)
    const h = padHold(down())
    h.onPointerDown(pointer())
    frames(600)
    expect(fallState()).toBeNull()
    expect(useWalk.getState().falling).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(start)
    expect(useWalk.getState()).toMatchObject({ queue: [], open: null, behind: 0 })
    h.onPointerUp()
    expect(posted).toHaveLength(0)
  })

  it('one early tap of DOWN does not: the landing bounces', () => {
    useWalk.getState().press('up')
    frames(100)
    const h = padHold(down())
    h.onPointerDown(pointer())
    h.onPointerUp()
    frames(600)
    expect(fallState()).not.toBeNull()
    expect(fallState()!.v0).toBeGreaterThan(0)
  })
})

describe('GRAVITY with holds (review of #651)', () => {
  function floorWith(bounce: number | null): void {
    const vertices: ShardModel['vertices'] = []
    const faces: Array<[number, number, number]> = []
    for (const x of [-20, 20]) for (const y of [-1, 0]) for (const z of [-20, 20]) vertices.push({ p: [x, y, z], c: [1, 1, 1] })
    for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) faces.push([a, b, c], [a, c, d])
    const model = withConstrain({ ...newShard('Floor'), mode: 'solid', vertices, faces }, 'all')
    const shard = bounce === null ? model : { ...model, extra: { ...model.extra, bounce } }
    const plane = useCyberspace.getState().plane as WorldItem['plane']
    useShards.setState({ worldItems: () => [{ key: 'floor', type: 'shard', at: { ...start, y: start.y - 1n }, plane, height: 84, mine: false, shard }] })
  }

  let clock = 2_000_000
  function frames(ms: number): void {
    for (let t = 0; t < ms; t += 16) { clock += 16; vi.advanceTimersByTime(16); tickFall() }
  }
  function fallFrames(ms: number): void {
    for (let t = 0; t < ms; t += 16) { clock += 16; tickFall() }
  }
  const gpad = (cell: string): PadKey => {
    const k = walkPad(true, () => () => {}).find((b) => b.cell === cell)
    if (!k) throw new Error(`no ${cell}`)
    return k
  }

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  afterEach(() => {
    vi.mocked(performance.now).mockRestore()
  })

  function begin(bounce: number | null): void {
    floorWith(bounce)
    useWalk.getState().setGravity(true)
    walk()
  }

  it('a running jump on the pad: JUMP pressed with FORWARD held jumps, and FORWARD walks on through the air and after', () => {
    begin(null)
    face(0)
    const fwd = padHold(gpad('forward'))
    const jump = padHold(gpad('jump'))
    fwd.onPointerDown(pointer())
    frames(WALK_HOLD_MS)
    jump.onPointerDown(pointer())
    expect(fallState()).not.toBeNull()
    jump.onPointerUp()
    // FORWARD is still held: the walk goes on in the air.
    expect(holding()).toBe(true)
    const inAir = moved(start)[2]
    frames(WALK_HOLD_MS * 3)
    expect(fallState()).not.toBeNull()
    expect(moved(start)[2]).toBeLessThan(inAir)
    // Landed, and still walking.
    frames(1500)
    expect(fallState()).toBeNull()
    const landed = moved(start)
    expect(landed[1]).toBe(0)
    frames(WALK_HOLD_MS * 2)
    expect(moved(start)[2]).toBe(landed[2] - 2)
    fwd.onPointerUp()
  })

  it('a held diagonal while bouncing: W and D held steer 45 degrees every beat, and the bounce goes on', () => {
    begin(8)
    face(0)
    useWalk.getState().press('up')
    frames(100)
    walkKeyDown(key('KeyW'))
    walkKeyDown(key('KeyD'))
    // From here (W's first step was straight, before D went down) every beat is a diagonal.
    const base = moved(start)
    const off = (): [number, number] => { const p = moved(start); return [p[0] - base[0], p[2] - base[2]] }
    frames(WALK_HOLD_MS * 4)
    const m = off()
    expect(m[0]).toBeGreaterThanOrEqual(4)
    expect(m[0]).toBe(-m[1])
    frames(1000)
    const n = off()
    expect(n[0]).toBeGreaterThan(m[0])
    expect(n[0]).toBe(-n[1])
    // Still in the air: landings bounced.
    expect(fallState()).not.toBeNull()
  })

  it('a held Down absorbs every landing while held, read from the hold itself (no beats)', () => {
    begin(8)
    useWalk.getState().press('up')
    fallFrames(100)
    padHold(gpad('down')).onPointerDown(pointer())
    fallFrames(700)
    expect(fallState()).toBeNull()
    expect(useCyberspace.getState().cursor).toEqual(start)
    // Down still held: the next jump's landing is absorbed too.
    useWalk.getState().press('up')
    expect(fallState()).not.toBeNull()
    fallFrames(800)
    expect(fallState()).toBeNull()
    expect(useCyberspace.getState().cursor).toEqual(start)
  })

  it('a held Down let go: the next landing bounces again', () => {
    begin(8)
    useWalk.getState().press('up')
    fallFrames(100)
    const down = padHold(gpad('down'))
    down.onPointerDown(pointer())
    fallFrames(700)
    expect(fallState()).toBeNull()
    down.onPointerUp()
    expect(holding()).toBe(false)
    useWalk.getState().press('up')
    for (let t = 0; t < 2000 && fallState() && fallState()!.v0 <= JUMP_SPEED + 1e-9; t += 16) fallFrames(16)
    expect(fallState()).not.toBeNull()
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 8), 6)
  })

  it('Up held adds its jump to a bounce, read from the hold itself', () => {
    begin(8)
    useWalk.getState().press('up')
    fallFrames(100)
    padHold(gpad('jump')).onPointerDown(pointer())
    // Its own press was far too early to count; held, it counts at the landing: 8 plus the jump's 3.
    for (let t = 0; t < 2000 && fallState() && fallState()!.v0 <= JUMP_SPEED + 1e-9; t += 16) fallFrames(16)
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 11), 6)
  })

  it('JUMP pressed while DOWN is held: the two cancel, and nothing jumps', () => {
    begin(null)
    const down = padHold(gpad('down'))
    down.onPointerDown(pointer())
    padHold(gpad('jump')).onPointerDown(pointer())
    expect(fallState()).toBeNull()
    down.onPointerUp()
  })
})
