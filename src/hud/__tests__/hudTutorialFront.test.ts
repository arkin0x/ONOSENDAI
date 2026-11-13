/**
 * hudTutorialFront.test.ts - the tutorial's Earth route puts the HYPERSPACE
 * panel first in the menu while it teaches BOARD and RIDE (owner,
 * 2026-11-13: "the hyperspace panel should already be there at the top"),
 * above every priority state, and never writes the player's saved order:
 * clearing it puts the panel back where they keep it.
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

// A server render reads a zustand store's server snapshot, which is its
// initial state. Here every store's hook reads the live state instead, so a
// render shows what the store holds now; everything else about the stores
// is the real thing.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { Hud } from '../Hud'
import { PanelSlot } from '../PanelSlot'
import { useCyberspace } from '../../store/useCyberspace'
import { useHyperspace } from '../../store/useHyperspace'
import { PANEL_LAYOUT_KEY, usePanelLayout } from '../../store/usePanelLayout'

/** The name of the component at `k`: a panel's own, seen through the PanelSlot every panel sits in. */
function nameOf(k: ReactElement): string {
  const inner = k.type === PanelSlot ? (k as ReactElement<{ children: ReactElement }>).props.children : k
  return (inner.type as { name: string }).name
}

/** The names of the components in each column, in order, as Hud lays them out. */
function columns(): { left: string[]; right: string[] } {
  let tree: ReactElement | null = null
  // Hud's hooks need a render to run in; its returned tree is what is read.
  renderToString(createElement(() => { tree = Hud({}); return null }))
  const names = (col: ReactNode): string[] => {
    const kids = (col as ReactElement<{ children: ReactNode[] }>).props.children
    // The panels come as one array from the layout's map, beside the brand or the license.
    return (Array.isArray(kids) ? kids.flat() : [kids])
      .filter((k): k is ReactElement => isValidElement(k) && typeof k.type === 'function')
      .map(nameOf)
  }
  const [left, right] = (tree! as ReactElement<{ children: ReactNode[] }>).props.children
  return { left: names(left), right: names(right) }
}

afterEach(() => {
  usePanelLayout.getState().setFront(null)
  useHyperspace.setState({ destination: null })
  useCyberspace.getState().clearFocus()
})

describe('the tutorial\'s front panel', () => {
  it('puts HYPERSPACE first in the menu, out of its own column, and nowhere else', () => {
    const before = columns()
    expect(before.right).toContain('HyperspacePanel')
    usePanelLayout.getState().setFront('hyperspace')
    const { left, right } = columns()
    expect(left.slice(0, 2)).toEqual(['Brand', 'HyperspacePanel'])
    expect(right).not.toContain('HyperspacePanel')
    expect(left.filter((n) => n === 'HyperspacePanel')).toHaveLength(1)
  })

  it('outranks a free view and a move under way, and is not doubled by a destination set', () => {
    useCyberspace.getState().viewAt({ x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }, 0, 'EARTH', 52, { fit: true })
    useHyperspace.setState({ destination: 840000 })
    useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'computing' } })
    try {
      // Without it, the free view leads and the ride falls in behind.
      expect(columns().left.slice(0, 4)).toEqual(['Brand', 'ViewAtPanel', 'ProofPanel', 'HyperspacePanel'])
      usePanelLayout.getState().setFront('hyperspace')
      const { left } = columns()
      expect(left.slice(0, 4)).toEqual(['Brand', 'HyperspacePanel', 'ViewAtPanel', 'ProofPanel'])
      expect(left.filter((n) => n === 'HyperspacePanel')).toHaveLength(1)
    } finally {
      useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'idle' } })
    }
  })

  it('writes nothing: the saved order stays the player\'s, and clearing it puts the panel back', () => {
    const saved = localStorage.getItem(PANEL_LAYOUT_KEY)
    const order = usePanelLayout.getState().order
    usePanelLayout.getState().setFront('hyperspace')
    expect(localStorage.getItem(PANEL_LAYOUT_KEY)).toBe(saved)
    expect(usePanelLayout.getState().order).toBe(order)
    usePanelLayout.getState().setFront(null)
    const { left, right } = columns()
    expect(left).not.toContain('HyperspacePanel')
    expect(right).toContain('HyperspacePanel')
    expect(usePanelLayout.getState().order).toEqual(order)
    // A fold or a move made meanwhile is saved without the front panel in it.
    usePanelLayout.getState().setFront('hyperspace')
    usePanelLayout.getState().toggle('scale')
    const written = JSON.parse(localStorage.getItem(PANEL_LAYOUT_KEY) ?? '{}') as Record<string, unknown>
    expect(Object.keys(written).sort()).toEqual(['collapsed', 'order'])
    usePanelLayout.getState().toggle('scale')
  })
})
