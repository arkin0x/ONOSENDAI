/**
 * walkHold.test.ts - WALK's controls after the owner's play test of
 * 2026-11-10 (store/walkHold.ts, store/useWalk.ts, hud/TouchControls.tsx):
 *
 * - a held key or pad key walks from the press on, one press every
 *   WALK_HOLD_MS, with no pause first; the keyboard's own repeats add
 *   nothing; letting go stops it;
 * - two directions held are one diagonal, on the keyboard and on the pad
 *   (FORWARD and a side arrow held); FORWARD alone is plain forward wherever
 *   the thumb is on it (its diagonal end zones went after the next play
 *   test, the same day);
 * - the sides go along the facing's right, and a press in the air goes the
 *   way you face, a diagonal included (it went along the screen's axis);
 * - a hold publishes what the same taps publish: the same hops, as many;
 * - under GRAVITY the pad's DOWN is on, and held through a bounce's fall it
 *   absorbs the landing, where one early tap does not (review of #649);
 *
 * Review of #651: a lost keyup (Cmd on macOS), a hidden page, a STOP, the
 * menu, a modal or the workshop let go of every hold; JUMP with FORWARD held
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
import { STICK_SOURCE, WALK_HOLD_MS, heldLevel, heldNow, holding, stickHold } from '../walkHold'
import { StickTracker, stickPeriod } from '../../lib/walkStick'
import { walkHeldDir } from '../../lib/walkKeys'
import type { MoveName } from '../../lib/moves'
import { useShards } from '../useShards'
import { clearWalls } from '../walkWalls'
import { useCalibration } from '../../lib/calibration'
import { walkFacing } from '../../lib/walkEye'
import { setMenuCovering, walkKeyDown, walkKeyUp, walkKeysReleased, walkMetaRelease } from '../../hooks/useKeyboard'
import { registerEscape } from '../../hooks/useEscape'
import { useWorkshop } from '../useWorkshop'
import { padHold, walkPad, type PadKey } from '../../hud/TouchControls'
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

/**
 * The level directions' pad keys, as FORWARD, BACK and the side keys were
 * before the stick took their place (owner, 2026-11-28): any `pad:` source
 * holding a direction, which is what the rules about pad holds are about.
 */
const LEVEL: Record<string, MoveName> = { forward: 'away', backward: 'toward', left: 'left', right: 'right' }
const levelKey = (cell: string): PadKey | null => (LEVEL[cell] ? { cell, glyph: null, title: cell, act: () => {}, hold: walkHeldDir(LEVEL[cell]) } : null)

/** The WALK pad's key for `cell` (JUMP, DOWN), or a level direction's (levelKey), and a pointer on it `across` of the way from its left (0 to 1). */
const pad = (cell: string): PadKey => {
  const k = levelKey(cell) ?? walkPad(false, () => () => {}).find((b) => b.cell === cell)
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
  useWalk.getState().setHardGravity(false)
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

describe('a pad hold', () => {
  it('walks from the press on, and pointerup, pointercancel or leave stops it', () => {
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
})

describe('the stick (hud/WalkStick.tsx; owner, 2026-11-28)', () => {
  const R = 48
  /** A finger on the stick: lands at (x, y), then each drag goes to stickHold as the zone sends it. */
  function finger(x = 40, y = 600) {
    const t = new StickTracker(() => R)
    t.down(7, x, y)
    stickHold({ fwd: 0, strafe: 0, mag: 0 }, null)
    return {
      to: (dx: number, dy: number) => { const s = t.move(7, x + dx, y + dy)!; stickHold(s.vec, s.dir); return s },
      lift: () => { t.up(7); stickHold({ fwd: 0, strafe: 0, mag: 0 }, null) },
    }
  }
  beforeEach(() => {
    // The beat's pace is brought forward by the clock too.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  })

  it('landing walks nothing, wherever the finger lands; a drag past the dead zone steps at once', () => {
    walk()
    face(0)
    const f = finger(2, 700)
    expect(holding()).toBe(false)
    f.to(0, -4)
    expect(holding()).toBe(false)
    vi.advanceTimersByTime(WALK_HOLD_MS * 5)
    expect(moved(start)).toEqual([0, 0, 0])
    f.to(0, -R)
    expect(moved(start)).toEqual([0, 0, -1])
    f.lift()
  })

  it('a full push steps at the keys\' pace, a light push slower', () => {
    walk()
    face(0)
    const f = finger()
    f.to(0, -R)
    vi.advanceTimersByTime(WALK_HOLD_MS * 4)
    expect(moved(start)).toEqual([0, 0, -5])
    f.lift()
    // Past the slowest beat since the last step, so the next push is a fresh one.
    vi.advanceTimersByTime(400)
    const at = moved(start)[2]
    const g = finger()
    const s = g.to(0, -(0.12 * R + 0.25 * (R - 0.12 * R)))
    expect(s.vec.mag).toBeCloseTo(0.25, 6)
    const slow = stickPeriod(0.25, WALK_HOLD_MS)
    expect(slow).toBeGreaterThan(WALK_HOLD_MS * 1.5)
    expect(moved(start)[2]).toBe(at - 1)
    vi.advanceTimersByTime(Math.ceil(slow) * 3)
    expect(moved(start)[2]).toBe(at - 4)
    // Pushed all the way: the next beat comes at the keys' pace from the last one, not the slow one.
    g.to(0, -R)
    vi.advanceTimersByTime(WALK_HOLD_MS)
    expect(moved(start)[2]).toBe(at - 5)
    g.lift()
  })

  it('the nearest of 8 ways, the way you face: up-right is the diagonal, as W and D held', () => {
    walk()
    face(0)
    const f = finger()
    f.to(R, -R)
    expect(moved(start)).toEqual([1, 0, -1])
    vi.advanceTimersByTime(WALK_HOLD_MS)
    expect(moved(start)).toEqual([2, 0, -2])
    // Straight down the screen: back.
    f.to(0, R)
    vi.advanceTimersByTime(WALK_HOLD_MS)
    expect(moved(start)).toEqual([2, 0, -1])
    f.lift()
    vi.advanceTimersByTime(400)
    // Facing 90 degrees right (+X), up the screen is +X.
    face(90)
    const at = moved(start)
    const g = finger()
    g.to(0, -R)
    expect(moved(start)[0] - at[0]).toBe(1)
    g.lift()
  })

  it('a thumb wobbling on the dead zone\'s edge takes one step, not a burst (review of #974: 6.5 and 5px, 20 moves in 160ms, took 10)', () => {
    walk()
    face(0)
    const f = finger()
    for (let k = 0; k < 20; k++) { f.to(0, k % 2 === 0 ? -6.5 : -5); vi.advanceTimersByTime(8) }
    expect(Math.abs(moved(start)[2])).toBeLessThanOrEqual(2)
    expect(Math.abs(moved(start)[2])).toBeGreaterThanOrEqual(1)
    f.lift()
  })

  it('in and out across the whole dead zone faster than a beat: still no faster than holding', () => {
    walk()
    face(0)
    const f = finger()
    for (let k = 0; k < 20; k++) { f.to(0, k % 2 === 0 ? -6.5 : -2); vi.advanceTimersByTime(8) }
    expect(Math.abs(moved(start)[2])).toBeLessThanOrEqual(2)
    f.lift()
    // A fresh push a beat later steps at once again.
    vi.advanceTimersByTime(WALK_HOLD_MS * 4)
    const at = moved(start)[2]
    const g = finger()
    g.to(0, -48)
    expect(moved(start)[2]).toBe(at - 1)
    g.lift()
  })

  it('let go, or back inside the dead zone: the walk stops at once', () => {
    walk()
    face(0)
    const f = finger()
    f.to(0, -R)
    vi.advanceTimersByTime(WALK_HOLD_MS)
    f.to(0, -2)
    expect(holding()).toBe(false)
    vi.advanceTimersByTime(WALK_HOLD_MS * 5)
    expect(moved(start)).toEqual([0, 0, -2])
    f.to(0, -R)
    f.lift()
    expect(holding()).toBe(false)
    vi.advanceTimersByTime(WALK_HOLD_MS * 5)
    expect(moved(start)).toEqual([0, 0, -3])
  })

  it('level only: whatever way it is pushed, it holds nothing up or down', () => {
    walk()
    face(0)
    const f = finger()
    for (let a = 0; a < 360; a += 30) {
      const r = (a * Math.PI) / 180
      f.to(R * Math.cos(r), R * Math.sin(r))
      expect(heldNow().vert).toBe(0)
    }
    vi.advanceTimersByTime(WALK_HOLD_MS * 6)
    expect(moved(start)[1]).toBe(0)
    f.lift()
  })

  it('JUMP held with the stick: both walk, each its own finger, and lifting JUMP never stops the stick', () => {
    walk()
    face(0)
    const f = finger()
    f.to(0, -R)
    const jump = padHold(pad('jump'))
    jump.onPointerDown(pointer())
    expect(heldNow().vert).toBe(1)
    expect(heldNow().fwd).toBe(1)
    jump.onPointerUp()
    expect(holding()).toBe(true)
    const at = moved(start)[2]
    vi.advanceTimersByTime(WALK_HOLD_MS * 2)
    expect(moved(start)[2]).toBe(at - 2)
    f.lift()
    expect(holding()).toBe(false)
  })

  it('WASD unchanged: the keys alone give heldLevel what heldNow gives, and the stick\'s source is a pad one', () => {
    walk()
    face(0)
    walkKeyDown(key('KeyW'))
    walkKeyDown(key('KeyD'))
    expect(heldLevel()).toEqual({ fwd: 1, strafe: 1 })
    expect(moved(start)).toEqual([1, 0, -2])
    vi.advanceTimersByTime(WALK_HOLD_MS)
    expect(moved(start)).toEqual([2, 0, -3])
    walkKeysReleased()
    expect(STICK_SOURCE.startsWith('pad:')).toBe(true)
  })

  it('the menu covering the scene: the stick holds nothing, and a hold under it is let go at the next beat', () => {
    walk()
    face(0)
    setMenuCovering(true)
    const f = finger()
    f.to(0, -R)
    expect(holding()).toBe(false)
    expect(moved(start)).toEqual([0, 0, 0])
    f.lift()
    setMenuCovering(false)
    const g = finger()
    g.to(0, -R)
    expect(moved(start)).toEqual([0, 0, -1])
    setMenuCovering(true)
    vi.advanceTimersByTime(WALK_HOLD_MS * 5)
    expect(holding()).toBe(false)
    expect(moved(start)).toEqual([0, 0, -1])
    g.lift()
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
    // Over nothing at all: Hard Mode Gravity keeps the fall (walkGravityVoid.test.ts).
    useWalk.getState().setHardGravity(true)
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
    // Over nothing at all: Hard Mode Gravity keeps the fall (walkGravityVoid.test.ts).
    useWalk.getState().setHardGravity(true)
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

  it('FORWARD held, then RIGHT held with it on the pad for three beats: the same hops as a forward tap and four diagonal taps', async () => {
    const tapped = await run(() => {
      useWalk.getState().press('away')
      for (let k = 0; k < 4; k++) useWalk.getState().press('away', 1)
    })
    const held = await run(() => {
      const fwd = padHold(pad('forward'))
      const right = padHold(pad('right'))
      fwd.onPointerDown(pointer())
      right.onPointerDown(pointer())
      vi.advanceTimersByTime(WALK_HOLD_MS * 3)
      right.onPointerUp()
      fwd.onPointerUp()
    })
    expect(tapped.ends).toEqual([[0, 0, -1], [4, 0, -5]])
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
    const k = levelKey(cell) ?? walkPad(true, () => () => {}).find((b) => b.cell === cell)
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
    // The jump reaches the pad at about 775 ms; DOWN goes down at 100, far before the window.
    frames(100)
    const h = padHold(down())
    h.onPointerDown(pointer())
    frames(800)
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
    frames(800)
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
    const k = levelKey(cell) ?? walkPad(true, () => () => {}).find((b) => b.cell === cell)
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
    // Its own press, fresh in the air, is the double jump; held, it counts at the landing: 8 plus the jump's 5.
    expect(fallState()!.doubled).toBe(true)
    for (let t = 0; t < 3000 && fallState() && fallState()!.v0 <= JUMP_SPEED + 1e-9; t += 16) fallFrames(16)
    expect(fallState()!.v0).toBeCloseTo(Math.sqrt(2 * WALK_GRAVITY * 13), 6)
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
