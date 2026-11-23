/**
 * viewFlyFollowups.test.ts - the review of #592 (VIEW's fly), its low
 * findings, as they stand after the fly became the camera's (2026-11-09):
 *
 * 1. The rig is wired: Scene.tsx's rig runs the offset's two halves
 *    (viewRig.before, viewRig.apply) and feeds it the scene's touches
 *    (useFlyTouches), and the feed does its job, the mouse's pan included.
 * 2. A fly writes the cursor once, when it lands, not 20 times a second.
 * 3. The view window (and the terrain's new data) catches up during a fly,
 *    every FLY_REFRESH_MS, and follows the view when it is flown or panned
 *    off the cursor.
 * 4. An orbit or a pinch unlocks the camera's follow; a pan never does.
 * 5. A lift never starts a fly, and a lost lift resets the finger count
 *    (the touch flies on, as they may be again).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'

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

import { flyGesture, installFlyTouches, panGesture, viewOffset, viewRig, type RigCamera } from '../ViewFly'
import { FlyGesture, FLY_HOLD_MS, useViewFly } from '../../lib/viewFly'
import { LAND_IDLE_MS, LAND_LERP_MS, useViewCentre } from '../../lib/viewCamera'
import { CURSOR_SETTLE_MS, FLY_REFRESH_MS, settleWait, watchCursorSettle } from '../../hooks/useViewWindow'
import { useCyberspace } from '../../store/useCyberspace'

const cs = () => useCyberspace.getState()
const cam: RigCamera = { position: new Vector3(0, 0, 10), target: new Vector3(), quaternion: new Quaternion(), fov: 55, heightPx: 800 }
const follow = new Vector3()
const aim = new Vector3()
/** One frame of the rig's offset, at a fixed render frame (no re-anchor in these runs). */
function frame(dt = 1 / 60): void {
  viewRig.before(cam, dt)
  const [x, y, z] = cs().cursorOffset()
  aim.set(x, y, z)
  viewRig.apply(aim, [0, 0, 0], cam.position, follow)
  cam.position.add(aim).sub(follow)
  follow.copy(aim)
  cam.target.copy(aim)
}

beforeEach(() => {
  useCyberspace.setState({ scaleExp: 0 })
  useViewFly.setState({ button: 0, pad: 0, key: 0, touch: 0 })
  flyGesture.clear()
  panGesture.clear()
  viewRig.reset()
  cam.position.set(0, 0, 10)
  cam.target.set(0, 0, 0)
  follow.set(0, 0, 0)
})
afterEach(() => {
  useViewFly.setState({ button: 0, pad: 0, key: 0, touch: 0 })
  flyGesture.clear()
  panGesture.clear()
  cs().clearFocus()
  viewRig.reset()
})

/** The body of Scene.tsx's Rig, up to the next top-level function. */
const rigBody = (): string => {
  const src = readFileSync('src/scene/Scene.tsx', 'utf8')
  const at = src.indexOf('\nfunction Rig(')
  const end = src.indexOf('\nfunction ', at + 1)
  return src.slice(at, end)
}

describe('1. the rig is wired', () => {
  it("Scene.tsx's Rig feeds the scene's touches in, runs the offset's frame before it reads the cursor, and applies it before the zoom", () => {
    const body = rigBody()
    expect(body).toMatch(/useFlyTouches\(surface\)/)
    const loop = body.slice(body.indexOf('useFrame((state, dt) =>'))
    expect(loop).toMatch(/viewRig\.before\(rigCam, dt\)/)
    // The landing moves the cursor before the frame reads it.
    expect(loop.indexOf('viewRig.before(')).toBeLessThan(loop.indexOf('s.cursorOffset()'))
    // Applied once the frame's shift is known, before the zoom's carry.
    expect(loop.indexOf('viewRig.apply(')).toBeGreaterThan(loop.indexOf('originShift('))
    expect(loop.indexOf('viewRig.apply(')).toBeLessThan(loop.indexOf('carryOrbit('))
    // Every re-frame of the camera in the rig's effect starts the offset afresh:
    // the two cuts that keep the orbit (a restore stands) and the re-frame straight on.
    expect(body.match(/viewRig\.reset\(true\)/g)?.length).toBe(2)
    expect(body.match(/viewRig\.reset\(\)/g)?.length).toBe(1)
  })

  it('installFlyTouches feeds touches from the scene to both gestures, and a right or Shift drag of the mouse to the pan', () => {
    const surface = new EventTarget()
    const doc = new EventTarget()
    const win = new EventTarget()
    const off = installFlyTouches(surface, doc, win, () => 0)
    const ev = (type: string, init: Record<string, unknown>): Event => Object.assign(new Event(type), init)
    // A plain left drag of the mouse is the orbit's.
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, clientX: 0, clientY: 0 }))
    expect(flyGesture.count).toBe(0)
    expect(panGesture.panning).toBe(false)
    doc.dispatchEvent(ev('pointerup', { pointerType: 'mouse', pointerId: 1 }))
    // Two fingers that drag together are a pan.
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: true, clientX: 100, clientY: 0 }))
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 3, isPrimary: false, clientX: 300, clientY: 0 }))
    expect(flyGesture.count).toBe(2)
    expect(panGesture.fingers).toBe(2)
    // With the touch flies off, two fingers at rest fly nowhere.
    expect(flyGesture.dir(FLY_HOLD_MS * 10)).toBe(0)
    doc.dispatchEvent(ev('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 40 }))
    doc.dispatchEvent(ev('pointermove', { pointerType: 'touch', pointerId: 3, clientX: 300, clientY: 40 }))
    expect(panGesture.panning).toBe(true)
    doc.dispatchEvent(ev('pointerup', { pointerType: 'touch', pointerId: 3 }))
    expect(flyGesture.count).toBe(1)
    expect(panGesture.panning).toBe(false)
    // The page says no finger is left: the counts agree.
    doc.dispatchEvent(ev('touchend', { touches: [] }))
    expect(flyGesture.count).toBe(0)
    expect(panGesture.fingers).toBe(0)
    // A touch that lands off the scene (on the document, not the surface) is not the scene's.
    doc.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 4, isPrimary: true, clientX: 0, clientY: 0 }))
    expect(flyGesture.count).toBe(0)
    // The right button drags a pan; so does Shift with the left.
    for (const press of [{ button: 2, shiftKey: false, buttons: 2 }, { button: 0, shiftKey: true, buttons: 1 }]) {
      surface.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', pointerId: 9, isPrimary: true, button: press.button, shiftKey: press.shiftKey, clientX: 50, clientY: 50 }))
      expect(panGesture.panning).toBe(true)
      doc.dispatchEvent(ev('pointermove', { pointerType: 'mouse', pointerId: 9, buttons: press.buttons, clientX: 70, clientY: 45 }))
      const got = { x: 0, y: 0 }
      expect(panGesture.take(got)).toBe(true)
      expect(got).toEqual({ x: 20, y: -5 })
      doc.dispatchEvent(ev('pointerup', { pointerType: 'mouse', pointerId: 9 }))
      expect(panGesture.panning).toBe(false)
    }
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 5, isPrimary: true, clientX: 0, clientY: 0 }))
    win.dispatchEvent(new Event('blur'))
    expect(flyGesture.count).toBe(0)
    expect(panGesture.fingers).toBe(0)
    off()
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'touch', pointerId: 6, isPrimary: true, clientX: 0, clientY: 0 }))
    expect(flyGesture.count).toBe(0)
  })
})

describe('2. the cursor is written once, when the fly lands', () => {
  for (const scale of [0, 3, 20, 60]) {
    it(`a one-second fly at 2^${scale}: no writes while flying or resting, one at the landing`, () => {
      cs().viewHere()
      useCyberspace.setState({ scaleExp: scale })
      frame()
      let writes = 0
      const off = useCyberspace.subscribe((s, p) => { if (s.cursor !== p.cursor) writes++ })
      useViewFly.getState().setButton(1)
      for (let i = 0; i < 60; i++) frame()
      useViewFly.getState().setButton(0)
      // The coast, then most of the rest after it.
      for (let i = 0; viewOffset.moving && i < 600; i++) frame()
      for (let i = 0; i < ((LAND_IDLE_MS - 100) / 1000) * 60; i++) frame()
      expect(writes).toBe(0)
      for (let i = 0; i < ((LAND_LERP_MS + 300) / 1000) * 60; i++) frame()
      off()
      expect(writes).toBe(1)
    })
  }

  it('RETURN mid-fly: the cursor comes home and the fly does not write it back out', () => {
    cs().viewHere()
    frame()
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 6; i++) frame()
    cs().clearFocus()
    const home = { ...cs().cursor }
    for (let i = 0; i < 200; i++) frame()
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

  it('the view centre: flown or panned off the cursor by a whole cell, the window is told', () => {
    vi.useRealTimers()
    cs().viewHere()
    frame()
    expect(useViewCentre.getState()).toEqual({ right: 0, up: 0, out: 0 })
    useViewFly.getState().setButton(1)
    for (let i = 0; i < 30; i++) frame()
    useViewFly.getState().setButton(0)
    // Flown down render -z by whole cells (the exact count is the eased flight's,
    // tripled cruise less its ease-in): the window is told whole cells off the
    // cursor, negative out, nothing on right or up.
    const centre = useViewCentre.getState()
    expect(centre.right).toBe(0)
    expect(centre.up).toBe(0)
    expect(centre.out).toBeLessThan(0)
    expect(Number.isInteger(centre.out)).toBe(true)
    viewRig.reset()
    expect(useViewCentre.getState()).toEqual({ right: 0, up: 0, out: 0 })
  })
})

describe('4. the follow: an orbit or a pinch unlocks it, a pan never does (review of #635, S1)', () => {
  it("the Rig's onStart only arms the unlock; the frame unlocks on a pinch or a real drag", () => {
    const body = rigBody()
    expect(body).toMatch(/onStart=\{\(\) => \{ if \(startLock\.start\(pressed\(\)\)\) locked\.current = false \}\}/)
    expect(body).toMatch(/if \(startLock\.frame\(panGesture\.pinching, flyGesture\.orbited \|\| sceneMouse\.dragged, pressed\(\)\)\) locked\.current = false/)
    // A pan's fingers drifting apart do not zoom.
    expect(body).toMatch(/c\.enableZoom = !s\.walking && !panGesture\.panning/)
  })

  it('the mouse: a plain left drag (or a middle one) past the slop counts as the hand moving the camera, a click does not, and the press is counted before OrbitControls hears it', async () => {
    const { sceneMouse } = await import('../ViewFly')
    const surface = new EventTarget(); const doc = new EventTarget(); const win = new EventTarget()
    const off = installFlyTouches(surface, doc, win, () => 0)
    const ev = (type: string, init: Record<string, unknown>): Event => Object.assign(new Event(type), init)
    // OrbitControls' own listener, added after ours, without capture: it must see the press counted.
    let countedAtStart = false
    surface.addEventListener('pointerdown', () => { countedAtStart = sceneMouse.down })
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', pointerId: 1, button: 0, clientX: 0, clientY: 0 }))
    expect(countedAtStart).toBe(true)
    doc.dispatchEvent(ev('pointermove', { pointerType: 'mouse', pointerId: 1, buttons: 1, clientX: 4, clientY: 0 }))
    expect(sceneMouse.dragged).toBe(false)
    doc.dispatchEvent(ev('pointermove', { pointerType: 'mouse', pointerId: 1, buttons: 1, clientX: 30, clientY: 0 }))
    expect(sceneMouse.dragged).toBe(true)
    doc.dispatchEvent(ev('pointerup', { pointerType: 'mouse', pointerId: 1 }))
    expect(sceneMouse.down).toBe(false)
    expect(sceneMouse.dragged).toBe(false)
    // The middle button dollies: dragged, it unlocks like the wheel or a pinch (review N7).
    surface.dispatchEvent(ev('pointerdown', { pointerType: 'mouse', pointerId: 2, button: 1, clientX: 0, clientY: 0 }))
    expect(sceneMouse.down).toBe(true)
    expect(panGesture.panning).toBe(false)
    doc.dispatchEvent(ev('pointermove', { pointerType: 'mouse', pointerId: 2, buttons: 4, clientX: 0, clientY: 30 }))
    expect(sceneMouse.dragged).toBe(true)
    doc.dispatchEvent(ev('pointerup', { pointerType: 'mouse', pointerId: 2 }))
    off()
  })
})

describe('5. lifts and lost lifts (review F3)', () => {
  it('three fingers, one lift lost and one heard: two counted, but a lift never starts a fly', () => {
    const g = new FlyGesture({ forward: true, reverse: true })
    g.down(1, 100, 100, 0); g.down(2, 200, 100, 0); g.down(3, 300, 100, 0)
    g.up(2, 10)
    expect(g.count).toBe(2)
    expect(g.dir(10 + FLY_HOLD_MS + 1)).toBe(0)
    expect(g.dir(10_000)).toBe(0)
  })

  it('the page saying fewer fingers are down than counted resets the count', () => {
    const g = new FlyGesture({ forward: true, reverse: true })
    g.down(1, 100, 100, 0); g.down(2, 200, 100, 0); g.down(3, 300, 100, 0)
    g.up(2, 10)
    g.touchesLeft(1)
    expect(g.count).toBe(0)
    // A new two-finger touch then flies forward as it should.
    g.down(7, 100, 100, 20); g.down(8, 300, 100, 20)
    expect(g.dir(20 + FLY_HOLD_MS)).toBe(1)
  })

  it('the page agreeing with the count leaves it alone', () => {
    const g = new FlyGesture({ forward: true, reverse: true })
    g.down(1, 100, 100, 0); g.down(2, 300, 100, 0)
    g.touchesLeft(2)
    expect(g.dir(FLY_HOLD_MS)).toBe(1)
  })

  it('a finger landing again on a held one flies: only a lift does not', () => {
    const g = new FlyGesture({ forward: true, reverse: true })
    g.down(1, 100, 100, 0); g.down(2, 300, 100, 0); g.down(3, 200, 300, 0)
    g.up(3, 10)
    expect(g.dir(1000)).toBe(0)
    g.down(4, 200, 300, 1000)
    expect(g.dir(1000 + FLY_HOLD_MS)).toBe(-1)
  })
})
