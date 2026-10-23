/**
 * walkLookSphere.test.ts - the orbit ball shared by the workshop and WALK
 * (hud/ui/OrbitSphere.tsx), and WALK's look sphere (hud/WalkLookSphere.tsx).
 *
 * The ball splits a press into a drag (every move to onTurn, in pixels) or a
 * tap (no move: onTap once), and a lost capture ends a drag with no tap. The
 * look sphere is up only while walking with its View switch on, and turns
 * through walkLookBy, the sink a drag on the scene uses.
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
import { walkLookBy } from '../../lib/walkLook'
import { useCyberspace } from '../../store/useCyberspace'
import { useLayers } from '../../store/useLayers'

type Handlers = Record<'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture', (e: unknown) => void> & { className: string }

/** What a component returns, its hooks run inside a render. */
function rendered<P>(fn: (p: P) => JSX.Element | null, props: P): JSX.Element | null {
  let out: JSX.Element | null = null
  renderToString(createElement(() => { out = fn(props); return null }))
  return out
}

function ball(props: Parameters<typeof OrbitSphere>[0]): Handlers {
  const el = rendered(OrbitSphere, props)
  if (!isValidElement(el)) throw new Error('no ball')
  return (el as ReactElement<Handlers>).props
}

const ev = (x: number, y: number, primary = true): unknown => ({
  isPrimary: primary, pointerId: 1, clientX: x, clientY: y,
  preventDefault: () => {}, currentTarget: { setPointerCapture: () => {} },
})

describe('the orbit ball', () => {
  const make = () => {
    const turns: Array<[number, number]> = []
    let taps = 0
    const h = ball({ onTurn: (dx, dy) => { turns.push([dx, dy]) }, onTap: () => { taps++ }, label: 'X', title: 't', ariaLabel: 'a' })
    return { h, turns, taps: () => taps }
  }

  it('a press with no move is one tap and no turn', () => {
    const { h, turns, taps } = make()
    h.onPointerDown(ev(50, 50)); h.onPointerUp(ev(50, 50))
    expect(taps()).toBe(1)
    expect(turns).toEqual([])
  })

  it('a drag turns by each move in pixels and is no tap', () => {
    const { h, turns, taps } = make()
    h.onPointerDown(ev(50, 50)); h.onPointerMove(ev(60, 47)); h.onPointerMove(ev(60, 47)); h.onPointerMove(ev(55, 52)); h.onPointerUp(ev(55, 52))
    expect(turns).toEqual([[10, -3], [-5, 5]])
    expect(taps()).toBe(0)
  })

  it('ignores a second finger, a move with nothing pressed, and ends a drag whose capture is lost', () => {
    const { h, turns, taps } = make()
    h.onPointerDown(ev(0, 0, false))
    h.onPointerMove(ev(9, 9))
    expect(turns).toEqual([])
    h.onPointerDown(ev(0, 0)); h.onPointerMove(ev(4, 0)); h.onLostPointerCapture(ev(4, 0))
    h.onPointerMove(ev(30, 0)); h.onPointerUp(ev(30, 0))
    expect(turns).toEqual([[4, 0]])
    expect(taps()).toBe(0)
  })

  it('is a plain benchorb unless told where it stands', () => {
    expect(make().h.className).toBe('benchorb')
    expect(ball({ onTurn: () => {}, label: 'X', title: 't', ariaLabel: 'a', className: 'benchorb--walk' }).className).toBe('benchorb benchorb--walk')
  })
})

describe('WALK\'s look sphere', () => {
  it('is up only while walking with its View switch on, and turns through walkLookBy', () => {
    useCyberspace.setState({ walking: false })
    useLayers.getState().setLayer('walkLookSphere', true)
    expect(rendered(WalkLookSphere, {})).toBeNull()

    useCyberspace.setState({ walking: true })
    const el = rendered(WalkLookSphere, {}) as ReactElement<Parameters<typeof OrbitSphere>[0]> | null
    expect(el?.type).toBe(OrbitSphere)
    expect(el?.props.onTurn).toBe(walkLookBy)
    expect(el?.props.onTap).toBeUndefined()
    expect(el?.props.className).toBe('benchorb--walk')
    expect(el?.props.label).toBe('LOOK')

    useLayers.getState().setLayer('walkLookSphere', false)
    expect(rendered(WalkLookSphere, {})).toBeNull()
    useLayers.getState().setLayer('walkLookSphere', true)
    useCyberspace.setState({ walking: false })
  })
})
