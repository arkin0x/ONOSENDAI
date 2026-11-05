/**
 * viewFlyFollowups.test.ts - the review of #592 (VIEW's fly), its low findings:
 *
 * 1. The rig is wired: Scene.tsx's rig runs the fly's frame (rigViewFly) and
 *    feeds it the scene's touches (useFlyTouches), and each does its job.
 * 2. A fly writes the cursor to the store at most 20 times a second, not
 *    every frame, and still covers the same ground.
 * 3. The view window (and the terrain's new data) catches up during a fly,
 *    every FLY_REFRESH_MS, instead of waiting for a rest that never comes.
 * 4. After a fly the camera goes back to its own follow: still following the
 *    cursor if it was, standing where an orbit left it if not.
 * 5. A lift never starts a fly, and a lost lift resets the finger count.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { flyFollow, flyGesture, installFlyTouches, rigViewFly, tickViewFly, type FlyRig } from '../ViewFly'
import { FlyFollow, FlyGesture, FLY_CELLS_PER_SECOND, FLY_HOLD_MS, renderToCyber, useViewFly } from '../../lib/viewFly'
import { CURSOR_SETTLE_MS, FLY_REFRESH_MS, settleWait, watchCursorSettle } from '../../hooks/useViewWindow'
import { useCyberspace } from '../../store/useCyberspace'
import type { Position } from '../../lib/space'

const cs = () => useCyberspace.getState()
const eye = new Vector3(0, 0, 10)
const target = new Vector3(0, 0, 0)
const moved = (from: Position): number => {
  const c = cs().cursor
  return Math.max(...[c.x - from.x, c.y - from.y, c.z - from.z].map((k) => Math.abs(Number(k))))
}
const ahead = (): [number, number, number] => { const a = renderToCyber([0, 0, -1], cs().axes()); return [a.x, a.y, a.z] }

/** A rig's refs, as Scene.tsx's Rig holds them. */
const rig = (locked = true): FlyRig => ({ locked: { current: locked }, glideLeft: { current: 0 } })

beforeEach(() => {
  useCyberspace.setState({ scaleExp: 0 })
  useViewFly.setState({ button: 0, touch: 0 })
  flyGesture.clear()
  tickViewFly(eye, target, 0, 0)
})
afterEach(() => {
  useViewFly.setState({ button: 0, touch: 0 })
  flyGesture.clear()
  tickViewFly(eye, target, 0, 0)
  cs().clearFocus()
})

describe('1. the rig is wired', () => {
  /** The body of Scene.tsx's Rig, up to the next top-level function. */
  const rigBody = (): string => {
    const src = readFileSync('src/scene/Scene.tsx', 'utf8')
    const at = src.indexOf('\nfunction Rig(')
    const end = src.indexOf('\nfunction ', at + 1)
    return src.slice(at, end)
  }

  it("Scene.tsx's Rig feeds the scene's touches to the fly and runs its frame inside useFrame, before it frames the cursor", () => {
    const body = rigBody()
    expect(body).toMatch(/useFlyTouches\(surface\)/)
    const frame = body.slice(body.indexOf('useFrame((state, dt) =>'))
    expect(frame).toMatch(/rigViewFly\(flyRig, c\.object\.position, c\.target, dt\)/)
    // The fly moves the cursor before the frame reads it.
    expect(frame.indexOf('rigViewFly(')).toBeLessThan(frame.indexOf('s.cursorOffset()'))
    // The refs the fly drives are the rig's own lock and glide.
    expect(body).toMatch(/useMemo<FlyRig>\(\(\) => \(\{ locked, glideLeft \}\)/)
  })

  it('rigViewFly locks the camera to the cursor and cancels the glide while it flies, and moves the cursor', () => {
    cs().viewHere()
    const from = { ...cs().cursor }
    const r = rig(false)
    r.glideLeft.current = 1.6
    useViewFly.getState().setButton(1)
    expect(rigViewFly(r, eye, target, 0.1, 0)).toBe(true)
    expect(r.locked.current).toBe(true)
    expect(r.glideLeft.current).toBe(0)
    expect(moved(from)).toBeGreaterThan(0)
  })

  it('installFlyTouches feeds touches from the scene to the gesture, and nothing else', () => {
    const surface = new EventTarget()
    const doc = new EventTarget()
    const win = new EventTarget()
    const off = installFlyTouches(surface, doc, win, () => 0)
    const ev = (type: string, init: Record<string, unknown>): Event => Object.assign(new Event(type), init)
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', pointerId: 1, isPrimary: true, clientX: 0, clientY: 0 }))
    expect(flyGesture.count).toBe(0)
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: true, clientX: 100, clientY: 0 }))
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 3, isPrimary: false, clientX: 300, clientY: 0 }))
    expect(flyGesture.count).toBe(2)
    expect(flyGesture.dir(FLY_HOLD_MS)).toBe(1)
    // A pinch heard on the document stops it.
    doc.dispatchEvent(ev('pointermove', { pointerType: 'touch', pointerId: 3, clientX: 360, clientY: 0 }))
    expect(flyGesture.dir(FLY_HOLD_MS + 10)).toBe(0)
    doc.dispatchEvent(ev('pointerup', { pointerType: 'touch', pointerId: 3 }))
    expect(flyGesture.count).toBe(1)
    // The page says no finger is left: the count agrees.
    doc.dispatchEvent(ev('touchend', { touches: [] }))
    expect(flyGesture.count).toBe(0)
    // A touch that lands off the scene (on the document, not the surface) is not the scene's.
    doc.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 4, isPrimary: true, clientX: 0, clientY: 0 }))
    expect(flyGesture.count).toBe(0)
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 5, isPrimary: true, clientX: 0, clientY: 0 }))
    win.dispatchEvent(new Event('blur'))
    expect(flyGesture.count).toBe(0)
    off()
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 6, isPrimary: true, clientX: 0, clientY: 0 }))
    expect(flyGesture.count).toBe(0)
  })
})

describe('2. the cursor is written at most 20 times a second', () => {
  for (const scale of [0, 3, 20, 60]) {
    it(`one second at 60 fps at 2^${scale}: no more than 21 writes, and the full 8 cells`, () => {
      cs().viewHere()
      useCyberspace.setState({ scaleExp: scale })
      const from = { ...cs().cursor }
      let writes = 0
      const off = useCyberspace.subscribe((s, p) => { if (s.cursor !== p.cursor) writes++ })
      useViewFly.getState().setButton(1)
      for (let i = 0; i < 60; i++) tickViewFly(eye, target, 1 / 60, (i * 1000) / 60)
      useViewFly.getState().setButton(0)
      tickViewFly(eye, target, 1 / 60, 1000)
      off()
      // 20 a second (FLY_WRITE_MS), and the one on release.
      expect(writes).toBeLessThanOrEqual(21)
      expect(moved(from) / 2 ** scale).toBeCloseTo(FLY_CELLS_PER_SECOND, 0)
    })
  }

  it('a pad press during a fly is not undone: the fly goes on from where the press put the cursor', () => {
    cs().viewHere()
    useViewFly.getState().setButton(1)
    tickViewFly(eye, target, 0.05, 0)
    tickViewFly(eye, target, 0.05, 10)
    cs().moveCursor({ axis: 'x', dir: 1 })
    const pressed = cs().cursor.x
    for (let i = 1; i <= 4; i++) tickViewFly(eye, target, 0.05, 10 + 60 * i)
    expect(cs().cursor.x).toBe(pressed)
  })

  it('RETURN mid-fly: the cursor comes home and the fly does not write it back out', () => {
    cs().viewHere()
    useViewFly.getState().setButton(1)
    tickViewFly(eye, target, 0.05, 0)
    tickViewFly(eye, target, 0.05, 10)
    cs().clearFocus()
    const home = { ...cs().cursor }
    tickViewFly(eye, target, 0.05, 100)
    expect(cs().cursor).toEqual(home)
  })
})

describe('3. the view window catches up during a fly', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('settleWait: rest as before when not flying; while flying, never longer than FLY_REFRESH_MS since the last catch-up', () => {
    expect(settleWait(0, 0, false)).toBe(CURSOR_SETTLE_MS)
    expect(settleWait(100, 1e9, false)).toBe(CURSOR_SETTLE_MS - 100)
    expect(settleWait(0, 0, true)).toBe(CURSOR_SETTLE_MS)
    expect(settleWait(0, FLY_REFRESH_MS - 40, true)).toBe(40)
    expect(settleWait(0, FLY_REFRESH_MS + 5, true)).toBe(0)
    expect(settleWait(0, Infinity, true)).toBe(0)
  })

  it('a two-second fly moves the window several times; the same moves without a fly, none until rest', () => {
    cs().viewHere()
    let t = 0
    const clock = (): number => t
    const run = (flying: boolean): number => {
      let fires = 0
      const off = watchCursorSettle(() => { fires++ }, clock)
      vi.advanceTimersByTime(CURSOR_SETTLE_MS + 1)
      t += CURSOR_SETTLE_MS + 1
      fires = 0
      useViewFly.getState().setButton(flying ? 1 : 0)
      // The cursor moves every 50 ms for two seconds, as a fly writes it.
      for (let i = 0; i < 40; i++) {
        cs().moveCursor({ axis: 'z', dir: 1 })
        vi.advanceTimersByTime(50)
        t += 50
      }
      const during = fires
      useViewFly.getState().setButton(0)
      off()
      return during
    }
    expect(run(false)).toBe(0)
    expect(run(true)).toBeGreaterThanOrEqual(3)
  })
})

describe('4. after a fly the camera goes back to its own follow', () => {
  it('a camera that was following goes on following', () => {
    const f = new FlyFollow()
    expect(f.frame(true, false, false)).toBe(true)
    expect(f.frame(true, true, false)).toBe(true)
    expect(f.frame(true, false, false)).toBe(true)
  })

  it('a camera an orbit had left standing is left standing again: the lock was the fly\'s', () => {
    const f = new FlyFollow()
    expect(f.frame(false, false, false)).toBe(false)
    expect(f.frame(false, true, false)).toBe(true)
    expect(f.frame(true, true, false)).toBe(true)
    expect(f.frame(true, false, false)).toBe(false)
  })

  it('a two-finger fly hands back the follow from before the fingers landed, not the unlock their landing made', () => {
    const f = new FlyFollow()
    f.frame(true, false, false)
    // The fingers land: OrbitControls' onStart unlocks the camera.
    expect(f.frame(false, false, true)).toBe(false)
    expect(f.frame(false, true, true)).toBe(true)
    // One finger lifts: the fly ends, the camera follows again as it did.
    expect(f.frame(true, false, true)).toBe(true)
    expect(f.frame(true, false, false)).toBe(true)
  })

  it('through the rig: an orbited camera flies locked, then stands again', () => {
    cs().viewHere()
    const r = rig(true)
    rigViewFly(r, eye, target, 0.05, 0)
    r.locked.current = false // an orbit
    rigViewFly(r, eye, target, 0.05, 10)
    useViewFly.getState().setButton(1)
    rigViewFly(r, eye, target, 0.05, 20)
    expect(r.locked.current).toBe(true)
    useViewFly.getState().setButton(0)
    rigViewFly(r, eye, target, 0.05, 80)
    expect(r.locked.current).toBe(false)
    expect(flyFollow).toBeDefined()
  })

  it('RETURN while a fly button is held: the camera follows the cursor after, as RETURN framed it', () => {
    cs().viewHere()
    const r = rig(true)
    rigViewFly(r, eye, target, 0.05, 0)
    r.locked.current = false // an orbit
    rigViewFly(r, eye, target, 0.05, 10)
    useViewFly.getState().setButton(1)
    rigViewFly(r, eye, target, 0.05, 20)
    expect(r.locked.current).toBe(true)
    // RETURN: the view ends and its framing locks the camera, with the button still held.
    cs().clearFocus()
    r.locked.current = true
    rigViewFly(r, eye, target, 0.05, 80)
    expect(r.locked.current).toBe(true)
    rigViewFly(r, eye, target, 0.05, 100)
    expect(r.locked.current).toBe(true)
  })

  it('an orbit then a fly in one touch: after the fly the camera stands, as the orbit left it', () => {
    const f = new FlyFollow()
    f.frame(true, false, false)
    // One finger lands (onStart unlocks) and orbits; a second lands and flies.
    expect(f.frame(false, false, true, true)).toBe(false)
    expect(f.frame(false, true, true, true)).toBe(true)
    expect(f.frame(true, false, true, true)).toBe(false)
    expect(f.frame(false, false, false)).toBe(false)
  })

  it('the gesture: a lone finger that drags orbited; one that only lands, or a second finger moving, did not', () => {
    const g = new FlyGesture()
    g.down(1, 100, 100, 0); g.move(1, 103, 100)
    expect(g.orbited).toBe(false)
    g.down(2, 300, 100, 0); g.move(2, 340, 100); g.move(1, 160, 100)
    expect(g.orbited).toBe(false)
    g.clear()
    g.down(1, 100, 100, 0); g.move(1, 160, 100)
    expect(g.orbited).toBe(true)
    g.down(2, 300, 100, 10)
    expect(g.orbited).toBe(true)
    // A new touch starts again.
    g.up(1, 20); g.up(2, 20)
    g.down(3, 0, 0, 30)
    expect(g.orbited).toBe(false)
  })

  it('through the rig: one finger orbits, a second lands and flies, a lift ends it: the camera stands as the orbit left it', () => {
    cs().viewHere()
    const r = rig(true)
    rigViewFly(r, eye, target, 0.05, 0)
    flyGesture.down(1, 100, 100, 10)
    r.locked.current = false // OrbitControls onStart
    flyGesture.move(1, 160, 100) // the orbit
    rigViewFly(r, eye, target, 0.05, 20)
    flyGesture.down(2, 300, 100, 30)
    rigViewFly(r, eye, target, 0.05, 30 + FLY_HOLD_MS)
    expect(r.locked.current).toBe(true)
    flyGesture.up(2, 400)
    rigViewFly(r, eye, target, 0.05, 400)
    expect(r.locked.current).toBe(false)
  })

  it('through the rig: an orbit whose touch has ended is not the next fly\'s: a cursor step re-locks, a button fly hands back the follow', () => {
    cs().viewHere()
    const r = rig(true)
    rigViewFly(r, eye, target, 0.05, 0)
    // One finger orbits, and lifts.
    flyGesture.down(1, 100, 100, 10)
    r.locked.current = false // OrbitControls onStart
    flyGesture.move(1, 160, 100)
    rigViewFly(r, eye, target, 0.05, 20)
    flyGesture.up(1, 30)
    rigViewFly(r, eye, target, 0.05, 40)
    expect(flyGesture.orbited).toBe(false)
    // A cursor step: its glide locks the camera to follow again (Scene.tsx).
    r.locked.current = true
    rigViewFly(r, eye, target, 0.05, 60)
    // The HUD's fly button, held and let go.
    useViewFly.getState().setButton(1)
    rigViewFly(r, eye, target, 0.05, 80)
    expect(r.locked.current).toBe(true)
    useViewFly.getState().setButton(0)
    rigViewFly(r, eye, target, 0.05, 160)
    expect(r.locked.current).toBe(true)
  })

  it('through the rig: a two-finger fly with no orbit still follows after, as before the touch', () => {
    cs().viewHere()
    const r = rig(true)
    rigViewFly(r, eye, target, 0.05, 0)
    flyGesture.down(1, 100, 100, 10)
    r.locked.current = false // OrbitControls onStart, no drag
    flyGesture.down(2, 300, 100, 12)
    rigViewFly(r, eye, target, 0.05, 12 + FLY_HOLD_MS)
    expect(r.locked.current).toBe(true)
    flyGesture.up(2, 400)
    rigViewFly(r, eye, target, 0.05, 400)
    expect(r.locked.current).toBe(true)
  })
})

describe('5. lifts and lost lifts (review F3)', () => {
  it('three fingers, one lift lost and one heard: two counted, but a lift never starts a fly', () => {
    const g = new FlyGesture()
    g.down(1, 100, 100, 0); g.down(2, 200, 100, 0); g.down(3, 300, 100, 0)
    g.up(2, 10)
    expect(g.count).toBe(2)
    expect(g.dir(10 + FLY_HOLD_MS + 1)).toBe(0)
    expect(g.dir(10_000)).toBe(0)
  })

  it('the page saying fewer fingers are down than counted resets the count', () => {
    const g = new FlyGesture()
    g.down(1, 100, 100, 0); g.down(2, 200, 100, 0); g.down(3, 300, 100, 0)
    g.up(2, 10)
    g.touchesLeft(1)
    expect(g.count).toBe(0)
    // A new two-finger touch then flies forward as it should.
    g.down(7, 100, 100, 20); g.down(8, 300, 100, 20)
    expect(g.dir(20 + FLY_HOLD_MS)).toBe(1)
  })

  it('the page agreeing with the count leaves it alone', () => {
    const g = new FlyGesture()
    g.down(1, 100, 100, 0); g.down(2, 300, 100, 0)
    g.touchesLeft(2)
    expect(g.dir(FLY_HOLD_MS)).toBe(1)
  })

  it('a finger landing again on a held one flies: only a lift does not', () => {
    const g = new FlyGesture()
    g.down(1, 100, 100, 0); g.down(2, 300, 100, 0); g.down(3, 200, 300, 0)
    g.up(3, 10)
    expect(g.dir(1000)).toBe(0)
    g.down(4, 200, 300, 1000)
    expect(g.dir(1000 + FLY_HOLD_MS)).toBe(-1)
  })

  it('the rig: a lost three-finger lift does not fly the view forward', () => {
    cs().viewHere()
    const from = { ...cs().cursor }
    flyGesture.down(1, 100, 100, 0); flyGesture.down(2, 200, 100, 0); flyGesture.down(3, 300, 100, 0)
    for (let i = 0; i < 6; i++) tickViewFly(eye, target, 0.05, FLY_HOLD_MS + 50 * i)
    const back = { ...cs().cursor }
    expect(moved(from)).toBeGreaterThan(0)
    flyGesture.up(2, FLY_HOLD_MS + 400)
    for (let i = 0; i < 10; i++) tickViewFly(eye, target, 0.05, FLY_HOLD_MS + 500 + 60 * i)
    expect(cs().cursor).toEqual(back)
    expect(ahead().some((k) => k !== 0)).toBe(true)
  })
})
