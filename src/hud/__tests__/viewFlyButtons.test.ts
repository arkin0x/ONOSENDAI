/**
 * viewFlyButtons.test.ts - VIEW's forward and back buttons (arkinox,
 * 2026-11-02): only in a free view, each wearing the shared 3D arrow, held
 * to fly and let go to stop.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'

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

// As in hudBuildOrder.test.ts: store hooks read the live state in a server render.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { ViewFlyButtons } from '../ViewFlyButtons'
import { ForwardArrow3D, ReverseArrow3D } from '../ui/FlyArrows'
import { useViewFly } from '../../lib/viewFly'
import { useCyberspace } from '../../store/useCyberspace'
import { useBuilder } from '../../store/useBuilder'

type Handlers = Record<string, (e?: unknown) => void>

/** The buttons as rendered now, with their props. */
function buttons(): Array<ReactElement<Handlers & { className: string; 'aria-label': string; children: ReactNode }>> {
  let tree: ReactNode = null
  renderToString(createElement(() => { tree = ViewFlyButtons(); return null }))
  if (!isValidElement(tree)) return []
  const kids = (tree as ReactElement<{ children: ReactNode[] }>).props.children
  return (Array.isArray(kids) ? kids : [kids]).filter(isValidElement) as never
}

const press = { pointerType: 'touch', button: 0, pointerId: 7, preventDefault: () => {}, stopPropagation: () => {}, currentTarget: { setPointerCapture: () => {} } }

afterEach(() => {
  useViewFly.setState({ button: 0, touch: 0 })
  useBuilder.getState().exit()
  useCyberspace.getState().clearFocus()
})

describe('the fly buttons', () => {
  it('are not there at your head', () => {
    expect(renderToString(createElement(ViewFlyButtons))).toBe('')
  })

  it('are there in VIEW: forward over back, each with its 3D arrow', () => {
    useCyberspace.getState().viewHere()
    const [fwd, back] = buttons()
    expect(fwd.props['aria-label']).toBe('Fly forward')
    expect(back.props['aria-label']).toBe('Fly back')
    expect((fwd.props.children as ReactElement).type).toBe(ForwardArrow3D)
    expect((back.props.children as ReactElement).type).toBe(ReverseArrow3D)
    const html = renderToString(createElement(ViewFlyButtons))
    expect(html).toContain('class="flyorbs"')
    expect(html.match(/<svg/g)).toHaveLength(2)
  })

  it('fly while held and stop when let go', () => {
    useCyberspace.getState().viewHere()
    const [fwd, back] = buttons()
    fwd.props.onPointerDown(press)
    expect(useViewFly.getState().button).toBe(1)
    fwd.props.onPointerUp()
    expect(useViewFly.getState().button).toBe(0)
    back.props.onPointerDown(press)
    expect(useViewFly.getState().button).toBe(-1)
    back.props.onPointerCancel()
    expect(useViewFly.getState().button).toBe(0)
    back.props.onPointerDown(press)
    back.props.onLostPointerCapture()
    expect(useViewFly.getState().button).toBe(0)
  })

  it("a lift on one does not stop the other's fly", () => {
    useCyberspace.getState().viewHere()
    const [fwd, back] = buttons()
    back.props.onPointerDown(press)
    fwd.props.onPointerUp()
    expect(useViewFly.getState().button).toBe(-1)
  })

  it('a right click does not fly', () => {
    useCyberspace.getState().viewHere()
    const [fwd] = buttons()
    fwd.props.onPointerDown({ ...press, pointerType: 'mouse', button: 2 })
    expect(useViewFly.getState().button).toBe(0)
  })

  it('are not there in BUILD, which moves by its own pad', () => {
    useBuilder.getState().enter('build')
    expect(renderToString(createElement(ViewFlyButtons))).toBe('')
  })
})
