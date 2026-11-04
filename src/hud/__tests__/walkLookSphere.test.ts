/**
 * walkLookSphere.test.ts - the orbit ball shared by the workshop and WALK
 * (hud/ui/OrbitSphere.tsx), and WALK's look sphere (hud/WalkLookSphere.tsx).
 *
 * The ball splits a press into a drag (every move to onTurn, in pixels) or a
 * tap (no move: onTap once). It captures the pointer, and a drag that leaves
 * the ball keeps turning until the finger lifts (arkinox, 2026-11-02), since
 * it is followed on the document; a capture lost while the ball is still on
 * screen changes nothing, and the ball going away ends the drag with no tap.
 * One finger drives it, whichever: a finger on LOOK while a thumb holds a pad
 * key is not the primary pointer, and it used to be ignored. A new press
 * takes over from a drag whose release was never heard, and a mouse that
 * moves with no button held ends its drag (review of #588).
 *
 * The look sphere is up only while walking with its View switch on, takes
 * the press anywhere in the square around the ball, and turns a drag across
 * the ball WALK_LOOK_SPHERE_DEG_PER_BALL on every screen, more than the same
 * drag on the scene.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: () => {}, cancelProof: () => {} }))

// A server render reads a zustand store's initial state; here each hook reads
// the live state, as a mounted component does.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { OrbitSphere } from '../ui/OrbitSphere'
import { WalkLookSphere } from '../WalkLookSphere'
import { clearWalkLook, lookRadPerPx, sphereRadPerPx, takeWalkLook, takeWalkLookRad, walkLookBy, walkLookSphereBy, WALK_LOOK_SPHERE_DEG_PER_BALL } from '../../lib/walkLook'
import { useCyberspace } from '../../store/useCyberspace'
import { useLayers } from '../../store/useLayers'

type Handlers = Record<'onPointerDown' | 'onLostPointerCapture', (e: unknown) => void> & { className: string; children?: unknown }

/** What a component returns, its hooks run inside a render. */
function rendered<P>(fn: (p: P) => JSX.Element | null, props: P): JSX.Element | null {
  let out: JSX.Element | null = null
  renderToString(createElement(() => { out = fn(props); return null }))
  return out
}

function ballEl(props: Parameters<typeof OrbitSphere>[0]): ReactElement<Handlers> {
  const el = rendered(OrbitSphere, props)
  if (!isValidElement(el)) throw new Error('no ball')
  return el as ReactElement<Handlers>
}
const ball = (props: Parameters<typeof OrbitSphere>[0]): Handlers => ballEl(props).props

/**
 * A page for the ball to stand on: the document's capture-phase listeners,
 * and the ball's own capture, which a test can refuse or take away.
 */
function page(opts: { refuseCapture?: boolean } = {}) {
  const listeners = new Map<string, Set<(e: unknown) => void>>()
  const doc = {
    addEventListener: (t: string, f: (e: unknown) => void, capture?: boolean) => {
      expect(capture).toBe(true)
      if (!listeners.has(t)) listeners.set(t, new Set())
      listeners.get(t)!.add(f)
    },
    removeEventListener: (t: string, f: (e: unknown) => void) => { listeners.get(t)?.delete(f) },
  }
  const captured: number[] = []
  const el = {
    ownerDocument: doc,
    isConnected: true,
    shown: true,
    getBoundingClientRect: () => ({ width: 112, height: 112 }),
    getClientRects() { return this.shown ? [{}] : [] },
    setPointerCapture: (id: number) => { if (opts.refuseCapture) throw new Error('NotFoundError'); captured.push(id) },
  }
  const fire = (type: string, x: number, y: number, pointerId = 1, more: Record<string, unknown> = {}): void => {
    for (const f of [...(listeners.get(type) ?? [])]) f({ type, pointerId, pointerType: 'touch', buttons: 1, clientX: x, clientY: y, ...more })
  }
  const listening = (): number => [...listeners.values()].reduce((n, s) => n + s.size, 0)
  const down = (x: number, y: number, more: Record<string, unknown> = {}): unknown => ({
    pointerId: 1, pointerType: 'touch', button: 0, isPrimary: true, clientX: x, clientY: y,
    preventDefault: () => {}, currentTarget: el, ...more,
  })
  return { el, fire, listening, down, captured }
}

describe('the orbit ball', () => {
  const make = () => {
    const turns: Array<[number, number]> = []
    const sizes: number[] = []
    let taps = 0
    const h = ball({ onTurn: (dx, dy, size) => { turns.push([dx, dy]); sizes.push(size) }, onTap: () => { taps++ }, label: 'X', title: 't', ariaLabel: 'a' })
    return { h, turns, sizes, taps: () => taps }
  }

  it('a press with no move is one tap and no turn', () => {
    const { h, turns, taps } = make()
    const p = page()
    h.onPointerDown(p.down(50, 50)); p.fire('pointerup', 50, 50)
    expect(taps()).toBe(1)
    expect(turns).toEqual([])
    expect(p.listening()).toBe(0)
  })

  it('a drag turns by each move in pixels, on a ball as wide as it is drawn, and is no tap', () => {
    const { h, turns, sizes, taps } = make()
    const p = page()
    h.onPointerDown(p.down(50, 50))
    expect(p.captured).toEqual([1])
    p.fire('pointermove', 60, 47); p.fire('pointermove', 60, 47); p.fire('pointermove', 55, 52); p.fire('pointerup', 55, 52)
    expect(turns).toEqual([[10, -3], [-5, 5]])
    expect(sizes).toEqual([112, 112])
    expect(taps()).toBe(0)
  })

  it('keeps turning after the finger leaves the ball, until it lifts, even with the capture refused or lost', () => {
    for (const refuseCapture of [false, true]) {
      const { h, turns } = make()
      const p = page({ refuseCapture })
      h.onPointerDown(p.down(50, 50))
      // Far off the ball, over the scene and the pad.
      p.fire('pointermove', 300, 50); p.fire('pointermove', 600, -200)
      // The browser takes the capture back while the ball is on screen: the drag goes on.
      h.onLostPointerCapture({ currentTarget: p.el })
      p.fire('pointermove', 610, -200)
      p.fire('pointerup', 610, -200)
      p.fire('pointermove', 900, 0)
      expect(turns).toEqual([[250, 0], [300, -250], [10, 0]])
      expect(p.listening()).toBe(0)
    }
  })

  it('is driven by a finger that is not primary, and by one finger at a time', () => {
    const { h, turns } = make()
    const p = page()
    // A thumb already on a pad key makes this finger non-primary.
    h.onPointerDown(p.down(0, 0, { pointerId: 7, isPrimary: false }))
    p.fire('pointermove', 9, 0, 7)
    // Another finger, not on the ball: not this drag's.
    p.fire('pointermove', 50, 50, 8)
    p.fire('pointermove', 12, 1, 7)
    p.fire('pointerup', 12, 1, 7)
    expect(turns).toEqual([[9, 0], [3, 1]])
    expect(p.listening()).toBe(0)
  })

  it('a drag whose release was never heard gives way to the next press, which drives at once', () => {
    const { h, turns } = make()
    const p = page()
    h.onPointerDown(p.down(0, 0, { pointerId: 3 }))
    p.fire('pointermove', 5, 0, 3)
    // Finger 3 lifted where the page never heard it. The next press works first time.
    h.onPointerDown(p.down(100, 100, { pointerId: 4 }))
    p.fire('pointermove', 107, 100, 4)
    // Whatever finger 3 still sends is not a drag any more.
    p.fire('pointermove', 60, 0, 3)
    p.fire('pointerup', 107, 100, 4)
    expect(turns).toEqual([[5, 0], [7, 0]])
    expect(p.listening()).toBe(0)
  })

  it('a mouse that moves with no button held ends its drag, with no tap', () => {
    const { h, turns, taps } = make()
    const p = page()
    const mouse = { pointerType: 'mouse' }
    h.onPointerDown(p.down(0, 0, mouse))
    p.fire('pointermove', 4, 0, 1, mouse)
    // Released outside the window: the next move arrives with no button held.
    p.fire('pointermove', 40, 0, 1, { ...mouse, buttons: 0 })
    p.fire('pointermove', 80, 0, 1, mouse)
    p.fire('pointerup', 80, 0, 1, mouse)
    expect(turns).toEqual([[4, 0]])
    expect(taps()).toBe(0)
    expect(p.listening()).toBe(0)
  })

  it('ends a drag, with no tap, when the ball is hidden or a pointer is cancelled', () => {
    const { h, turns, taps } = make()
    const p = page()
    h.onPointerDown(p.down(0, 0)); p.fire('pointermove', 4, 0)
    p.el.shown = false
    h.onLostPointerCapture({ currentTarget: p.el })
    p.fire('pointermove', 30, 0); p.fire('pointerup', 30, 0)
    expect(turns).toEqual([[4, 0]])
    expect(p.listening()).toBe(0)
    p.el.shown = true
    h.onPointerDown(p.down(0, 0)); p.fire('pointercancel', 0, 0)
    expect(taps()).toBe(0)
    expect(p.listening()).toBe(0)
  })

  it('takes only the main mouse button', () => {
    const { h, turns } = make()
    const p = page()
    h.onPointerDown(p.down(0, 0, { pointerType: 'mouse', button: 2 }))
    p.fire('pointermove', 5, 5)
    expect(turns).toEqual([])
    expect(p.listening()).toBe(0)
  })

  it('is a plain benchorb unless told where it stands; square, the square is the button and the ball is inside it', () => {
    expect(make().h.className).toBe('benchorb')
    expect(ball({ onTurn: () => {}, label: 'X', title: 't', ariaLabel: 'a', className: 'workshop-x' }).className).toBe('benchorb workshop-x')
    const sq = ballEl({ onTurn: () => {}, label: 'X', title: 't', ariaLabel: 'a', className: 'walklook', square: true })
    expect(sq.type).toBe('button')
    expect(sq.props.className).toBe('orbsquare walklook')
    const inner = sq.props.children as ReactElement<{ className: string }>
    expect(inner.type).toBe('span')
    expect(inner.props.className).toBe('benchorb benchorb--inside')
  })
})

describe('WALK\'s look sphere', () => {
  it('is up only while walking with its View switch on, a square, and turns through walkLookSphereBy', () => {
    useCyberspace.setState({ walking: false })
    useLayers.getState().setLayer('walkLookSphere', true)
    expect(rendered(WalkLookSphere, {})).toBeNull()

    useCyberspace.setState({ walking: true })
    const el = rendered(WalkLookSphere, {}) as ReactElement<Parameters<typeof OrbitSphere>[0]> | null
    expect(el?.type).toBe(OrbitSphere)
    expect(el?.props.onTurn).toBe(walkLookSphereBy)
    expect(el?.props.onTap).toBeUndefined()
    expect(el?.props.className).toBe('walklook')
    expect(el?.props.square).toBe(true)
    expect(el?.props.label).toBe('LOOK')

    useLayers.getState().setLayer('walkLookSphere', false)
    expect(rendered(WalkLookSphere, {})).toBeNull()
    useLayers.getState().setLayer('walkLookSphere', true)
    useCyberspace.setState({ walking: false })
  })

  it('turns a drag across the ball the same on every screen, and more than the same drag on the scene', () => {
    const spent = (take: (dt: number) => [number, number]): [number, number] => {
      let x = 0, y = 0
      for (let i = 0; i < 400; i++) { const [a, b] = take(0.05); x += a; y += b }
      return [x, y]
    }
    for (const ball of [112, 88]) {
      clearWalkLook()
      // Across the ball in two moves, and a little down.
      walkLookSphereBy(ball / 2, 0, ball); walkLookSphereBy(ball / 2, -4, ball)
      const [rx, ry] = spent(takeWalkLookRad)
      expect(rx * 180 / Math.PI).toBeCloseTo(WALK_LOOK_SPHERE_DEG_PER_BALL, 6)
      expect(ry).toBeCloseTo(-4 * sphereRadPerPx(ball), 9)
      // Nothing went through the scene's channel.
      expect(spent(takeWalkLook)).toEqual([0, 0])
      // A phone upright and on its side, a tablet, a desktop: LOOK turns more per pixel.
      for (const width of [360, 412, 740, 860, 1400]) expect(sphereRadPerPx(ball)).toBeGreaterThan(lookRadPerPx(width))
    }
    // The scene's drag is unchanged: pixels, turned at the screen's width by the rig.
    clearWalkLook()
    walkLookBy(10, -4)
    expect(spent(takeWalkLook)[0]).toBeCloseTo(10, 6)
    expect(spent(takeWalkLookRad)).toEqual([0, 0])
    clearWalkLook()
  })
})
