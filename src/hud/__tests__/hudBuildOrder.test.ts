/**
 * hudBuildOrder.test.ts - in BUILD mode the View panel is the first panel in
 * the menu, on a phone and a desktop alike, and it goes back to its own
 * place when the mode ends. It was the Position panel (arkinox, 2026-10-08:
 * "Position panel gets promoted to top/first panel while active"), for its
 * VIEW, RECENT and starred places, which moved to the View panel
 * (2026-11-02); Position now stays in its place.
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

import { Hud, ViewAtPanel, useViewDraft } from '../Hud'
import { PanelSlot } from '../PanelSlot'
import { ChainPanel } from '../ChainPanel'
import { useChainUi } from '../../store/useChainUi'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { defaultOrder, moveBefore, usePanelLayout } from '../../store/usePanelLayout'
import { useMyAgentsAnswer } from '../../hooks/useMyAgents'

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

describe('the View panel in BUILD mode', () => {
  it('is in its own place, in the right column under Position, while the mode is off', () => {
    const { left, right } = columns()
    expect(left).not.toContain('ViewAtPanel')
    expect(right.slice(1, 3)).toEqual(['PositionPanel', 'ViewAtPanel'])
  })

  it('is the first panel, under the brand, while the mode is on, and only there; Position stays put', () => {
    useBuilder.getState().enter('build')
    const { left, right } = columns()
    expect(left.slice(0, 2)).toEqual(['Brand', 'ViewAtPanel'])
    expect(right).not.toContain('ViewAtPanel')
    expect(left).not.toContain('PositionPanel')
    expect(right).toContain('PositionPanel')
  })

  it('outranks a move under way, which otherwise leads the menu', () => {
    useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'computing' } })
    try {
      expect(columns().left.slice(0, 2)).toEqual(['Brand', 'ProofPanel'])
      useBuilder.getState().enter('build')
      expect(columns().left.slice(0, 3)).toEqual(['Brand', 'ViewAtPanel', 'ProofPanel'])
    } finally {
      useCyberspace.setState({ proof: { ...useCyberspace.getState().proof, status: 'idle' } })
    }
  })

  it('goes back to its own place on exit', () => {
    useBuilder.getState().enter('build')
    useBuilder.getState().exit()
    useCyberspace.getState().clearFocus()
    const { left, right } = columns()
    expect(left).not.toContain('ViewAtPanel')
    expect(right).toContain('ViewAtPanel')
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
function actionsTag(): ReactElement<{ onClick: () => void; 'aria-pressed': boolean; disabled: boolean }> {
  let tree: ReactNode = null
  renderToString(createElement(() => { tree = ChainPanel(); return null }))
  const tag = findIn(tree, (p) => p.className === 'tag tag--tap' && 'aria-pressed' in p)
  if (!tag) throw new Error('no ACTIONS tag')
  return tag as unknown as ReactElement<{ onClick: () => void; 'aria-pressed': boolean; disabled: boolean }>
}

describe('the Chain panel ACTIONS tag in BUILD mode (review of #584)', () => {
  afterEach(() => { useBuilder.getState().exit(); useChainUi.getState().setExplorerOpen(false) })

  // The CHAIN chip, which draws the explorer, is hidden while building: a
  // tag that toggled the explorer there lit up, opened nothing, and left it
  // to spring open when the mode ended.
  it('stands down: disabled, opens nothing, leaves the build cursor, and nothing springs open on exit', () => {
    useChainUi.getState().setExplorerOpen(false)
    useBuilder.getState().enter('build')
    useCyberspace.getState().moveCursor({ axis: 'x', dir: 1 })
    const aim = { ...useCyberspace.getState().cursor }
    const tag = actionsTag()
    expect(tag.props.disabled).toBe(true)
    expect(tag.props['aria-pressed']).toBe(false)
    // A press that gets through anyway does nothing.
    tag.props.onClick()
    tag.props.onClick()
    tag.props.onClick()
    expect(useChainUi.getState().explorerOpen).toBe(false)
    expect(actionsTag().props['aria-pressed']).toBe(false)
    expect(useCyberspace.getState().cursor).toEqual(aim)
    expect(useBuilder.getState().scrub).toBeNull()
    useBuilder.getState().exit()
    expect(useChainUi.getState().explorerOpen).toBe(false)
  })

  it('works again once BUILD ends', () => {
    expect(useBuilder.getState().active).toBe(false)
    expect(actionsTag().props.disabled).toBe(false)
  })
})

describe('review of #235, NIT 6: the View panel keeps a half-typed VIEW across BUILD', () => {
  afterEach(() => useViewDraft.getState().setText(''))

  it('the text typed survives the panel moving to the top and back', () => {
    useViewDraft.getState().setText('12, 34')
    const typed = (): boolean => renderToString(createElement(ViewAtPanel)).includes('value="12, 34"')
    expect(typed()).toBe(true)
    // DEPLOY turning BUILD on moves the panel, which mounts it afresh.
    useBuilder.getState().enter('deploy')
    expect(columns().left).toContain('ViewAtPanel')
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
    expect(left).toEqual(['Brand', 'RelaysPanel', 'IdentityPanel', 'AgentsPanel', 'AvatarsPanel', 'InventoryPanel', 'ShardsPanel', 'DiscoveredPanel', 'TargetsPanel', 'LinksPanel'])
    // TUTORIAL is drawn for everyone since the tutorial went on by default (2026-11-13).
    expect(right).toEqual(['ScalePanel', 'PositionPanel', 'ViewAtPanel', 'ProofPanel', 'CloudPanel', 'ChainPanel', 'HyperspacePanel', 'ViewPanel', 'Legend', 'Controls', 'DerezzPanel', 'TutorialPanel', 'HiddenPanel'])
  })

  it('TUTORIAL is drawn with the tutorial switched off too: its switch lives in it (owner, 2026-11-13)', async () => {
    const { useTutorialSwitch } = await import('../../tutorial/gate')
    try {
      for (const value of [false, true, null]) {
        useTutorialSwitch.setState({ value })
        expect(columns().right).toContain('TutorialPanel')
      }
    } finally {
      useTutorialSwitch.setState({ value: null })
    }
  })

  it('AGENTS is drawn for everyone, with no agent, in its saved place (arkinox, 2026-10-13)', () => {
    useMyAgentsAnswer.setState({ me: useCyberspace.getState().identity.pubkey, agents: [], status: 'ready' })
    try {
      expect(columns().left.slice(0, 4)).toEqual(['Brand', 'IdentityPanel', 'AgentsPanel', 'AvatarsPanel'])
      usePanelLayout.setState({ order: moveBefore(defaultOrder(), 'agents', null, 'right') })
      expect(columns().left).not.toContain('AgentsPanel')
      expect(columns().right.at(-1)).toBe('AgentsPanel')
    } finally {
      useMyAgentsAnswer.setState({ me: '', agents: [], status: 'loading' })
    }
  })

  it('a priority state draws its panel first without writing to the saved order, which applies again when it ends', () => {
    const order = moveBefore(defaultOrder(), 'viewat', 'relays', 'right')
    usePanelLayout.setState({ order })
    useBuilder.getState().enter('build')
    expect(columns().left.slice(0, 2)).toEqual(['Brand', 'ViewAtPanel'])
    expect(columns().right).not.toContain('ViewAtPanel')
    expect(usePanelLayout.getState().order).toBe(order)
    useBuilder.getState().exit()
    useCyberspace.getState().clearFocus()
    const { right } = columns()
    // TUTORIAL stays the last panel of all (usePanelLayout), drawn for everyone since 2026-11-13.
    expect(right.slice(-3)).toEqual(['ViewAtPanel', 'RelaysPanel', 'TutorialPanel'])
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
    // Pinned to the top it opens, its saved fold untouched (arkinox, 2026-10-14).
    expect(slot('hidden', true)).toContain('class="slot"')
    expect(slot('hidden', true)).not.toContain('slot__grip')
    expect(usePanelLayout.getState().collapsed.hidden).toBe(true)
    expect(slot('position')).toContain('class="slot"')
    usePanelLayout.getState().toggle('hidden')
    expect(slot('hidden')).toContain('class="slot"')
  })
})
