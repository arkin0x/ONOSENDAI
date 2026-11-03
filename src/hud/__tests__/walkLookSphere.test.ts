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
 * key is not the primary pointer, and it used to be ignored.
 *
 * The look sphere is up only while walking with its View switch on, takes
 * the press anywhere in the square around the ball, and turns through
 * walkLookBy, the sink a drag on the scene uses, WALK_LOOK_SPHERE_GAIN times
 * as far.
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
import { clearWalkLook, takeWalkLook, walkLookBy, walkLookSphereBy, WALK_LOOK_SPHERE_GAIN } from '../../lib/walkLook'
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
    getClientRects() { return this.shown ? [{}] : [] },
    setPointerCapture: (id: number) => { if (opts.refuseCapture) throw new Error('NotFoundError'); captured.push(id) },
  }
  const fire = (type: string, x: number, y: number, pointerId = 1): void => {
    for (const f of [...(listeners.get(type) ?? [])]) f({ type, pointerId, clientX: x, clientY: y })
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
    let taps = 0
    const h = ball({ onTurn: (dx, dy) => { turns.push([dx, dy]) }, onTap: () => { taps++ }, label: 'X', title: 't', ariaLabel: 'a' })
    return { h, turns, taps: () => taps }
  }

  it('a press with no move is one tap and no turn', () => {
    const { h, turns, taps } = make()
    const p = page()
    h.onPointerDown(p.down(50, 50)); p.fire('pointerup', 50, 50)
    expect(taps()).toBe(1)
    expect(turns).toEqual([])
    expect(p.listening()).toBe(0)
  })

  it('a drag turns by each move in pixels and is no tap', () => {
    const { h, turns, taps } = make()
    const p = page()
    h.onPointerDown(p.down(50, 50))
    expect(p.captured).toEqual([1])
    p.fire('pointermove', 60, 47); p.fire('pointermove', 60, 47); p.fire('pointermove', 55, 52); p.fire('pointerup', 55, 52)
    expect(turns).toEqual([[10, -3], [-5, 5]])
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

  it('is driven by one finger, whichever: a second is ignored, and a finger that is not primary still drives it', () => {
    const { h, turns } = make()
    const p = page()
    // A thumb already on a pad key makes this finger non-primary.
    h.onPointerDown(p.down(0, 0, { pointerId: 7, isPrimary: false }))
    p.fire('pointermove', 9, 0, 7)
    // A second finger down on the ball, and moving: not this drag's.
    h.onPointerDown(p.down(0, 0, { pointerId: 8 }))
    p.fire('pointermove', 50, 50, 8)
    p.fire('pointermove', 12, 1, 7)
    p.fire('pointerup', 12, 1, 7)
    expect(turns).toEqual([[9, 0], [3, 1]])
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
  it('is up only while walking with its View switch on, a square, and turns through the LOOK gain', () => {
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

  it('turns more than the same drag on the scene', () => {
    expect(WALK_LOOK_SPHERE_GAIN).toBeGreaterThan(1)
    const spent = (turn: (dx: number, dy: number) => void): [number, number] => {
      clearWalkLook()
      turn(10, -4)
      let x = 0, y = 0
      for (let i = 0; i < 200; i++) { const [a, b] = takeWalkLook(0.05); x += a; y += b }
      return [x, y]
    }
    const scene = spent(walkLookBy)
    const sphere = spent(walkLookSphereBy)
    expect(sphere[0]).toBeCloseTo(scene[0] * WALK_LOOK_SPHERE_GAIN, 6)
    expect(sphere[1]).toBeCloseTo(scene[1] * WALK_LOOK_SPHERE_GAIN, 6)
    expect(Math.abs(sphere[0])).toBeGreaterThan(Math.abs(scene[0]))
  })
})
