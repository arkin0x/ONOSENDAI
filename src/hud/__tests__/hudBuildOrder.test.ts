/**
 * hudBuildOrder.test.ts - in BUILD mode the Position panel is the first
 * panel in the menu (arkinox, 2026-10-08: "Position panel gets promoted to
 * top/first panel while active"), on a phone and a desktop alike, and it
 * goes back to its own place when the mode ends.
 *
 * The left column comes first on both: side by side on a desktop, stacked
 * above the right column on a phone (styles.css, max-width 1100px). So
 * "first" is the first panel of the left column, right under the brand.
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

import { Hud, PositionPanel, useViewDraft } from '../Hud'
import { PanelSlot } from '../PanelSlot'
import { ChainPanel } from '../ChainPanel'
import { useChainUi } from '../../store/useChainUi'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { defaultOrder, moveBefore, usePanelLayout } from '../../store/usePanelLayout'

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
  useBuilder.getState().exit()
  useCyberspace.getState().clearFocus()
})

describe('the Position panel in BUILD mode', () => {
  it('is in its own place, in the right column, while the mode is off', () => {
    const { left, right } = columns()
    expect(left).not.toContain('PositionPanel')
    expect(right).toContain('PositionPanel')
  })

  it('is the first panel, under the brand, while the mode is on, and only there', () => {
    useBuilder.getState().enter('build')
    const { left, right } = columns()
    expect(left.slice(0, 2)).toEqual(['Brand', 'PositionPanel'])
    expect(right).not.toContain('PositionPanel')
  })

  it('outranks a move under way, which otherwise leads the menu', () => {
    useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'computing' } })
    try {
      expect(columns().left.slice(0, 2)).toEqual(['Brand', 'ProofPanel'])
      useBuilder.getState().enter('build')
      expect(columns().left.slice(0, 3)).toEqual(['Brand', 'PositionPanel', 'ProofPanel'])
    } finally {
      useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'idle' } })
    }
  })

  it('goes back to its own place on exit', () => {
    useBuilder.getState().enter('build')
    useBuilder.getState().exit()
    const { left, right } = columns()
    expect(left).not.toContain('PositionPanel')
    expect(right).toContain('PositionPanel')
  })
})

describe('the View panel in the menu (arkinox, 2026-10-09)', () => {
  /** The panel right after View in the right column. */
  const afterView = (): string | undefined => {
    const { right } = columns()
    return right[right.indexOf('ViewPanel') + 1]
  }

  it('is in the right column, once, immediately before the Legend', () => {
    const { left, right } = columns()
    expect(left).not.toContain('ViewPanel')
    expect(right.filter((n) => n === 'ViewPanel')).toHaveLength(1)
    expect(afterView()).toBe('Legend')
  })

  it('stays immediately before the Legend while BUILD mode or a move under way reorders the menu', () => {
    useBuilder.getState().enter('build')
    expect(afterView()).toBe('Legend')
    useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'computing' } })
    try {
      expect(afterView()).toBe('Legend')
    } finally {
      useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'idle' } })
    }
  })
})

/** Find the first element in a tree whose props pass the test. */
function findIn(node: ReactNode, test: (props: Record<string, unknown>) => boolean): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const n of node) { const hit = findIn(n, test); if (hit) return hit }
    return null
  }
  if (!isValidElement(node)) return null
  const props = node.props as Record<string, unknown>
  if (test(props)) return node as ReactElement<Record<string, unknown>>
  return findIn(props.children as ReactNode, test)
}

/** The Chain panel's ACTIONS tag, as the panel renders it now. */
function actionsTag(): ReactElement<{ onClick: () => void; 'aria-pressed': boolean }> {
  let tree: ReactNode = null
  renderToString(createElement(() => { tree = ChainPanel(); return null }))
  const tag = findIn(tree, (p) => p.className === 'tag tag--tap' && 'aria-pressed' in p)
  if (!tag) throw new Error('no ACTIONS tag')
  return tag as unknown as ReactElement<{ onClick: () => void; 'aria-pressed': boolean }>
}

describe('review of #235, SHOULD-FIX 2: the Chain panel ACTIONS tag in BUILD mode', () => {
  afterEach(() => useChainUi.getState().setExplorerOpen(false))

  it('opens and closes the explorer, and leaves the build cursor where it is', () => {
    useBuilder.getState().enter('build')
    useCyberspace.getState().moveCursor({ axis: 'x', dir: 1 })
    const aim = { ...useCyberspace.getState().cursor }
    expect(actionsTag().props['aria-pressed']).toBe(false)
    actionsTag().props.onClick()
    expect(useChainUi.getState().explorerOpen).toBe(true)
    expect(actionsTag().props['aria-pressed']).toBe(true)
    expect(useCyberspace.getState().cursor).toEqual(aim)
    expect(useBuilder.getState().scrub).toBeNull()
    actionsTag().props.onClick()
    expect(useChainUi.getState().explorerOpen).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(aim)
  })
})

describe('review of #235, NIT 6: the Position panel keeps a half-typed VIEW across BUILD', () => {
  afterEach(() => useViewDraft.getState().setText(''))

  it('the text typed survives the panel moving to the top and back', () => {
    useViewDraft.getState().setText('12, 34')
    const typed = (): boolean => renderToString(createElement(PositionPanel)).includes('value="12, 34"')
    expect(typed()).toBe(true)
    // DEPLOY turning BUILD on moves the panel, which mounts it afresh.
    useBuilder.getState().enter('deploy')
    expect(columns().left).toContain('PositionPanel')
    expect(typed()).toBe(true)
    useBuilder.getState().exit()
    expect(typed()).toBe(true)
  })
})

describe('the saved panel layout (arkinox, 2026-10-10)', () => {
  afterEach(() => usePanelLayout.setState({ order: defaultOrder(), collapsed: {} }))

  it('lays the columns out in the saved order, with the brand, the license and the build where they were', () => {
    usePanelLayout.setState({ order: moveBefore(moveBefore(defaultOrder(), 'relays', 'identity', 'left'), 'hidden', null, 'right') })
    const { left, right } = columns()
    expect(left).toEqual(['Brand', 'RelaysPanel', 'IdentityPanel', 'AgentsPanel', 'DiscoveredPanel', 'InventoryPanel', 'ShardsPanel', 'AvatarsPanel', 'TargetsPanel', 'LinksPanel'])
    expect(right).toEqual(['ScalePanel', 'PositionPanel', 'ProofPanel', 'CloudPanel', 'ChainPanel', 'HyperspacePanel', 'ViewPanel', 'Legend', 'Controls', 'DerezzPanel', 'HiddenPanel'])
  })

  it('a priority state draws its panel first without writing to the saved order, which applies again when it ends', () => {
    const order = moveBefore(defaultOrder(), 'position', 'relays', 'right')
    usePanelLayout.setState({ order })
    useBuilder.getState().enter('build')
    expect(columns().left.slice(0, 2)).toEqual(['Brand', 'PositionPanel'])
    expect(columns().right).not.toContain('PositionPanel')
    expect(usePanelLayout.getState().order).toBe(order)
    useBuilder.getState().exit()
    const { right } = columns()
    expect(right.slice(-2)).toEqual(['PositionPanel', 'RelaysPanel'])
    expect(usePanelLayout.getState().order).toBe(order)
  })

  it('a panel saved into the left column still leads while its state holds, and is not drawn twice', () => {
    usePanelLayout.setState({ order: moveBefore(defaultOrder(), 'proof', null, 'left') })
    useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'computing' } })
    try {
      const { left } = columns()
      expect(left.slice(0, 2)).toEqual(['Brand', 'ProofPanel'])
      expect(left.filter((n) => n === 'ProofPanel')).toHaveLength(1)
    } finally {
      useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'idle' } })
    }
    expect(columns().left.slice(-1)).toEqual(['ProofPanel'])
  })

  it('a slot is folded when saved so, and only a folded panel that is not leading has a grip', () => {
    const slot = (id: 'hidden' | 'position', lead = false): string =>
      renderToString(createElement(PanelSlot, {
        id, lead, lifting: false, onGrab: () => {},
        children: createElement('section', { className: 'panel' }, createElement('header', { className: 'panel__head' }, createElement('h2', null, 'Title'))),
      }))
    expect(slot('hidden')).toContain('class="slot"')
    expect(slot('hidden')).not.toContain('slot__grip')
    usePanelLayout.getState().toggle('hidden')
    expect(slot('hidden')).toContain('class="slot slot--collapsed"')
    expect(slot('hidden')).toContain('slot__grip')
    expect(slot('hidden')).toContain('lucide-grip-vertical')
    expect(slot('hidden', true)).toContain('class="slot slot--collapsed"')
    expect(slot('hidden', true)).not.toContain('slot__grip')
    expect(slot('position')).toContain('class="slot"')
    usePanelLayout.getState().toggle('hidden')
    expect(slot('hidden')).toContain('class="slot"')
  })
})
