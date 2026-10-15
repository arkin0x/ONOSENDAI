/**
 * usePanelLayout.test.ts: the menu's saved layout (arkinox, 2026-10-10: fold
 * a panel to its title line, drag folded panels into a new order, and keep
 * both across a refresh with no flash).
 *
 * The pure parts first: the reorder arithmetic, merging a saved layout with
 * the defaults, the fold toggle. Then the store over a fake localStorage: a
 * page load is a fresh copy of the module over the same storage, so what
 * survives a refresh is checked by loading the module again.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ORDER, PANEL_IDS, PANEL_LAYOUT_KEY, columnOf, defaultOrder, mergeOrder, moveBefore, normalizeLayout, toggleCollapsed,
  type PanelId, type PanelOrder,
} from '../usePanelLayout'
import { CONTROL, foldsAt, type ElementLike } from '../../hud/PanelSlot'

const mem = new Map<string, string>()
const working = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}
const broken = {
  getItem: () => { throw new Error('SecurityError: storage is disabled') },
  setItem: () => { throw new Error('QuotaExceededError') },
  removeItem: () => { throw new Error('SecurityError') },
  clear: () => { throw new Error('SecurityError') },
}
const g = globalThis as { localStorage?: unknown }

type Mod = typeof import('../usePanelLayout')
async function load(): Promise<Mod['usePanelLayout']> {
  vi.resetModules()
  return (await import('../usePanelLayout')).usePanelLayout
}

/** A saved layout as the store writes it. */
function saved(order: PanelOrder, collapsed: Partial<Record<PanelId, boolean>> = {}): void {
  mem.set(PANEL_LAYOUT_KEY, JSON.stringify({ order, collapsed }))
}

describe('the default order', () => {
  it('is the menu as it was, every panel once, in one column', () => {
    expect(DEFAULT_ORDER.left).toEqual(['identity', 'agents', 'hidden', 'discovered', 'items', 'create', 'avatars', 'targets', 'links'])
    expect(DEFAULT_ORDER.right).toEqual(['scale', 'position', 'proof', 'cloud', 'chain', 'hyperspace', 'view', 'legend', 'controls', 'derezz', 'relays'])
    expect(new Set(PANEL_IDS).size).toBe(PANEL_IDS.length)
    expect(PANEL_IDS).toHaveLength(20)
  })

  it('comes as a fresh copy each time', () => {
    const a = defaultOrder()
    a.left.push('relays')
    expect(defaultOrder().left).not.toContain('relays')
  })
})

describe('moveBefore', () => {
  const order = (): PanelOrder => ({ left: ['identity', 'hidden', 'discovered'], right: ['scale', 'position', 'proof'] })

  it('moves a panel up its own column', () => {
    expect(moveBefore(order(), 'discovered', 'identity', 'left').left).toEqual(['discovered', 'identity', 'hidden'])
  })

  it('moves a panel down its own column, before a later one', () => {
    expect(moveBefore(order(), 'identity', 'discovered', 'left').left).toEqual(['hidden', 'identity', 'discovered'])
  })

  it('appends when before is null', () => {
    expect(moveBefore(order(), 'identity', null, 'left').left).toEqual(['hidden', 'discovered', 'identity'])
  })

  it('moves a panel to the other column, before the panel named or at its end', () => {
    const across = moveBefore(order(), 'hidden', 'position', 'right')
    expect(across).toEqual({ left: ['identity', 'discovered'], right: ['scale', 'hidden', 'position', 'proof'] })
    const last = moveBefore(order(), 'hidden', null, 'right')
    expect(last).toEqual({ left: ['identity', 'discovered'], right: ['scale', 'position', 'proof', 'hidden'] })
  })

  it('appends when the panel named is not in that column', () => {
    expect(moveBefore(order(), 'identity', 'position', 'left').left).toEqual(['hidden', 'discovered', 'identity'])
  })

  it('hands back the same object when nothing would change', () => {
    const o = order()
    expect(moveBefore(o, 'hidden', 'hidden', 'left')).toBe(o)
    expect(moveBefore(o, 'hidden', 'discovered', 'left')).toBe(o)
    expect(moveBefore(o, 'identity', 'hidden', 'left')).toBe(o)
    expect(moveBefore(o, 'discovered', null, 'left')).toBe(o)
    expect(moveBefore(o, 'proof', null, 'right')).toBe(o)
  })

  it('leaves the order it was given alone', () => {
    const o = order()
    moveBefore(o, 'discovered', 'identity', 'left')
    expect(o).toEqual(order())
  })

  it('columnOf says where a panel is', () => {
    expect(columnOf(order(), 'hidden')).toBe('left')
    expect(columnOf(order(), 'proof')).toBe('right')
    expect(columnOf(order(), 'relays')).toBeNull()
  })
})

describe('mergeOrder: a saved order against the defaults', () => {
  it('keeps a complete saved order as it is', () => {
    const o: PanelOrder = { left: ['links', 'identity', 'agents', 'hidden', 'discovered', 'items', 'create', 'avatars', 'targets', 'scale'], right: ['position', 'proof', 'cloud', 'chain', 'hyperspace', 'view', 'legend', 'controls', 'derezz', 'relays'] }
    expect(mergeOrder(o)).toEqual(o)
  })

  it('puts a panel the saved order lacks at its default place', () => {
    const o = defaultOrder()
    o.right = o.right.filter((id) => id !== 'view')
    expect(mergeOrder(o).right).toEqual(DEFAULT_ORDER.right)
    o.left = o.left.filter((id) => id !== 'identity')
    expect(mergeOrder(o).left).toEqual(DEFAULT_ORDER.left)
  })

  it('puts a missing panel after the nearest default neighbor above it that is still in its column', () => {
    // view is missing; its default neighbor hyperspace moved to the left, so it goes after chain.
    const o = defaultOrder()
    o.right = o.right.filter((id) => id !== 'view' && id !== 'hyperspace')
    o.left.push('hyperspace')
    expect(mergeOrder(o).right).toEqual(['scale', 'position', 'proof', 'cloud', 'chain', 'view', 'legend', 'controls', 'derezz', 'relays'])
  })

  it('puts a missing panel at the top of its column when nothing above it in the defaults is there', () => {
    const o = defaultOrder()
    o.right = o.right.filter((id) => id !== 'scale')
    o.right.reverse()
    expect(mergeOrder(o).right[0]).toBe('scale')
  })

  it('keeps two missing panels in their default order', () => {
    const o = defaultOrder()
    o.right = o.right.filter((id) => id !== 'view' && id !== 'legend')
    expect(mergeOrder(o).right).toEqual(DEFAULT_ORDER.right)
  })

  it('drops an id the app no longer has', () => {
    const o = defaultOrder() as unknown as { left: string[]; right: string[] }
    o.left.splice(2, 0, 'secrets')
    o.right.push('')
    expect(mergeOrder(o)).toEqual(defaultOrder())
  })

  it('keeps the first mention of an id that appears twice', () => {
    const o = defaultOrder()
    o.right.push('identity')
    expect(mergeOrder(o)).toEqual(defaultOrder())
    const o2 = defaultOrder()
    o2.left.unshift('relays')
    expect(mergeOrder(o2).left[0]).toBe('relays')
    expect(mergeOrder(o2).right).not.toContain('relays')
  })

  it('reads anything that is not two arrays as nothing saved', () => {
    expect(mergeOrder(null)).toEqual(defaultOrder())
    expect(mergeOrder(undefined)).toEqual(defaultOrder())
    expect(mergeOrder('left')).toEqual(defaultOrder())
    expect(mergeOrder({ left: 'identity', right: 7 })).toEqual(defaultOrder())
    expect(mergeOrder({ left: [{ id: 'identity' }], right: [null] })).toEqual(defaultOrder())
  })

  it('an empty saved order is the defaults', () => {
    expect(mergeOrder({ left: [], right: [] })).toEqual(defaultOrder())
  })
})

describe('toggleCollapsed', () => {
  it('folds an open panel and unfolds a folded one, keeping no entry for the open ones', () => {
    const folded = toggleCollapsed({}, 'hidden')
    expect(folded).toEqual({ hidden: true })
    expect(toggleCollapsed(folded, 'hidden')).toEqual({})
    expect(toggleCollapsed(folded, 'relays')).toEqual({ hidden: true, relays: true })
  })

  it('leaves the record it was given alone', () => {
    const c = { hidden: true }
    toggleCollapsed(c, 'hidden')
    expect(c).toEqual({ hidden: true })
  })
})

describe('normalizeLayout', () => {
  it('keeps folds for known panels only, and only true ones', () => {
    const l = normalizeLayout({ order: defaultOrder(), collapsed: { hidden: true, secrets: true, relays: false, view: 'yes' } })
    expect(l.collapsed).toEqual({ hidden: true })
  })

  it('reads junk as the defaults, open', () => {
    expect(normalizeLayout(null)).toEqual({ order: defaultOrder(), collapsed: {} })
    expect(normalizeLayout(42)).toEqual({ order: defaultOrder(), collapsed: {} })
    expect(normalizeLayout({ collapsed: [] })).toEqual({ order: defaultOrder(), collapsed: {} })
  })
})

describe('foldsAt: a tap on the title line', () => {
  /** A fake element: what it matches, and its parent. */
  const el = (matches: string[], parentElement: ElementLike | null = null): ElementLike => ({
    parentElement,
    matches: (sel: string) => sel === CONTROL && matches.includes('control'),
  })

  it('folds from the line, from the title and from a plain tag in it', () => {
    const head = el([])
    const h2 = el([], head)
    const tag = el([], head)
    const tagText = el([], tag)
    expect(foldsAt(head, head)).toBe(true)
    expect(foldsAt(h2, head)).toBe(true)
    expect(foldsAt(tag, head)).toBe(true)
    expect(foldsAt(tagText, head)).toBe(true)
  })

  it('does not fold from a control in the line, nor from inside one', () => {
    const head = el([])
    const button = el(['control'], head)
    const icon = el([], button)
    expect(foldsAt(button, head)).toBe(false)
    expect(foldsAt(icon, head)).toBe(false)
  })

  it('folds from the title although the title is a button to the keyboard (the first run in a browser missed this)', () => {
    const head = el([])
    const title = el(['control'], head)
    const titleText = el([], title)
    expect(foldsAt(title, head, title)).toBe(true)
    expect(foldsAt(titleText, head, title)).toBe(true)
    // Another control with the same role is still a control.
    const other = el(['control'], head)
    expect(foldsAt(other, head, title)).toBe(false)
  })

  it('does not fold from the body of the panel, or with no line to fold', () => {
    const section = el([])
    const head = el([], section)
    const body = el([], section)
    expect(foldsAt(body, head)).toBe(false)
    expect(foldsAt(section, head)).toBe(false)
    expect(foldsAt(head, null)).toBe(false)
    expect(foldsAt(null, head)).toBe(false)
  })

  it('names the controls a header can hold', () => {
    for (const c of ['button', 'a', 'input', 'label', 'select', 'textarea', '[role=switch]', '[role=button]', '[data-no-collapse]']) {
      expect(CONTROL.split(', ')).toContain(c)
    }
  })
})

describe('the store over localStorage', () => {
  beforeEach(() => { mem.clear(); g.localStorage = working })
  afterEach(() => { g.localStorage = working })

  it('starts as the defaults, open, with nothing saved', async () => {
    const S = await load()
    expect(S.getState().order).toEqual(defaultOrder())
    expect(S.getState().collapsed).toEqual({})
  })

  it('has the saved layout the moment the module loads', async () => {
    const order = moveBefore(defaultOrder(), 'relays', 'identity', 'left')
    saved(order, { hidden: true })
    const S = await load()
    expect(S.getState().order).toEqual(order)
    expect(S.getState().collapsed).toEqual({ hidden: true })
  })

  it('writes a fold at once, and the next load has it', async () => {
    const S = await load()
    S.getState().toggle('avatars')
    expect(JSON.parse(mem.get(PANEL_LAYOUT_KEY)!)).toEqual({ order: defaultOrder(), collapsed: { avatars: true } })
    expect((await load()).getState().collapsed).toEqual({ avatars: true })
    S.getState().toggle('avatars')
    expect(JSON.parse(mem.get(PANEL_LAYOUT_KEY)!).collapsed).toEqual({})
  })

  it('writes a move at once, and the next load has it', async () => {
    const S = await load()
    S.getState().move('legend', 'identity', 'left')
    const want = moveBefore(defaultOrder(), 'legend', 'identity', 'left')
    expect(S.getState().order).toEqual(want)
    expect(JSON.parse(mem.get(PANEL_LAYOUT_KEY)!).order).toEqual(want)
    expect((await load()).getState().order).toEqual(want)
  })

  it('a move that changes nothing writes nothing', async () => {
    const S = await load()
    const before = S.getState()
    S.getState().move('hidden', 'discovered', 'left')
    expect(S.getState()).toBe(before)
    expect(mem.has(PANEL_LAYOUT_KEY)).toBe(false)
  })

  it('a saved layout from before a panel existed gets the panel in its default place; one naming a panel that is gone drops it', async () => {
    const order = defaultOrder() as unknown as { left: string[]; right: string[] }
    order.right = order.right.filter((id) => id !== 'derezz')
    order.left.push('secrets')
    mem.set(PANEL_LAYOUT_KEY, JSON.stringify({ order, collapsed: { secrets: true, items: true } }))
    const S = await load()
    expect(S.getState().order).toEqual(defaultOrder())
    expect(S.getState().collapsed).toEqual({ items: true })
  })

  it('junk in storage reads as the defaults', async () => {
    mem.set(PANEL_LAYOUT_KEY, '{not json')
    expect((await load()).getState().order).toEqual(defaultOrder())
    mem.set(PANEL_LAYOUT_KEY, '"a string"')
    expect((await load()).getState().order).toEqual(defaultOrder())
  })

  it('storage that throws is the defaults, and a fold still works for the page', async () => {
    g.localStorage = broken
    const S = await load()
    expect(S.getState().order).toEqual(defaultOrder())
    expect(() => S.getState().toggle('hidden')).not.toThrow()
    expect(S.getState().collapsed).toEqual({ hidden: true })
    expect(() => S.getState().move('hidden', null, 'right')).not.toThrow()
    expect(S.getState().order.right).toContain('hidden')
  })

  it('no storage at all is the defaults', async () => {
    delete g.localStorage
    const S = await load()
    expect(S.getState().order).toEqual(defaultOrder())
    expect(() => S.getState().toggle('hidden')).not.toThrow()
  })
})
