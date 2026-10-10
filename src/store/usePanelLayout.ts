/**
 * usePanelLayout.ts - where each menu panel sits and whether it is folded to
 * its title line (arkinox, 2026-10-10: "tap the top of any menu panel and it
 * collapses so only the top line is shown. Tap again to expand. While
 * collapsed, put a drag handle on the right side of it and let the user
 * reorder them. The order and collapsed state should be written durably so
 * refreshing the page has no flash").
 *
 * The layout is read from localStorage as this module loads, synchronously,
 * so the first render already has it: nothing async, nothing to flash. Every
 * change is written back at once. A panel the saved layout does not know (one
 * added after the layout was saved) goes to its default column at its default
 * place; an id the app no longer has is dropped.
 *
 * The four priority states (BUILD, a move computing, a cloud job, a ride set)
 * are not written here: Hud.tsx lays the leading panel at the top of the left
 * column while the state holds and reads this order, untouched, when it ends.
 */

import { create } from 'zustand'

export const PANEL_LAYOUT_KEY = 'onosendai:panel-layout'

export type Column = 'left' | 'right'
export const COLUMNS: readonly Column[] = ['left', 'right']

/** The menu as Hud.tsx laid it out before the order could change, top to bottom. */
export const DEFAULT_ORDER = {
  left: ['identity', 'hidden', 'discovered', 'items', 'create', 'avatars', 'targets', 'links'],
  right: ['scale', 'position', 'proof', 'cloud', 'chain', 'hyperspace', 'view', 'legend', 'controls', 'derezz', 'relays'],
} as const satisfies Record<Column, readonly string[]>

export type PanelId = (typeof DEFAULT_ORDER)[Column][number]
export const PANEL_IDS: readonly PanelId[] = [...DEFAULT_ORDER.left, ...DEFAULT_ORDER.right]

export interface PanelOrder { left: PanelId[]; right: PanelId[] }
export interface PanelLayout {
  order: PanelOrder
  /** The panels folded to their title line; an unfolded panel has no entry. */
  collapsed: Partial<Record<PanelId, boolean>>
}

export function isPanelId(id: unknown): id is PanelId {
  return typeof id === 'string' && (PANEL_IDS as readonly string[]).includes(id)
}

export function defaultOrder(): PanelOrder {
  return { left: [...DEFAULT_ORDER.left], right: [...DEFAULT_ORDER.right] }
}

function same(a: readonly PanelId[], b: readonly PanelId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * A saved order against the defaults. Known ids keep their saved column and
 * place (the first mention of an id wins, should it appear twice). An id the
 * saved order lacks goes to its default column, right after the nearest panel
 * above it in the default order that still lives in that column, or to the
 * top when none does. An id the defaults do not know is dropped. Anything
 * that is not two arrays of strings is read as nothing saved.
 */
export function mergeOrder(saved: unknown, defaults: PanelOrder = defaultOrder()): PanelOrder {
  const known = new Set<PanelId>([...defaults.left, ...defaults.right])
  const seen = new Set<PanelId>()
  const column = (list: unknown): PanelId[] => {
    if (!Array.isArray(list)) return []
    const out: PanelId[] = []
    for (const id of list) {
      if (!isPanelId(id) || !known.has(id) || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  const out: PanelOrder = { left: column(s.left), right: column(s.right) }
  for (const col of COLUMNS) {
    const wanted = defaults[col]
    wanted.forEach((id, i) => {
      if (seen.has(id)) return
      let at = 0
      for (let j = i - 1; j >= 0; j--) {
        const k = out[col].indexOf(wanted[j])
        if (k >= 0) { at = k + 1; break }
      }
      out[col].splice(at, 0, id)
      seen.add(id)
    })
  }
  return out
}

/**
 * `id` moved into `column`, just before `before`; at the end of that column
 * when `before` is null or not in it. The same object comes back when nothing
 * would change, so a caller can tell a no-op without comparing arrays.
 */
export function moveBefore(order: PanelOrder, id: PanelId, before: PanelId | null, column: Column): PanelOrder {
  if (id === before) return order
  const next: PanelOrder = {
    left: order.left.filter((p) => p !== id),
    right: order.right.filter((p) => p !== id),
  }
  const list = next[column]
  const at = before === null ? -1 : list.indexOf(before)
  list.splice(at < 0 ? list.length : at, 0, id)
  return same(order.left, next.left) && same(order.right, next.right) ? order : next
}

/** The column `id` is in, or null when the order does not hold it. */
export function columnOf(order: PanelOrder, id: PanelId): Column | null {
  return order.left.includes(id) ? 'left' : order.right.includes(id) ? 'right' : null
}

/** `id` folded if it was open, open if it was folded. An open panel has no entry. */
export function toggleCollapsed(collapsed: PanelLayout['collapsed'], id: PanelId): PanelLayout['collapsed'] {
  const next = { ...collapsed }
  if (next[id]) delete next[id]
  else next[id] = true
  return next
}

/** Whatever was saved, made into a layout: the order merged with the defaults, the folds kept for known panels only. */
export function normalizeLayout(saved: unknown): PanelLayout {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  const collapsed: PanelLayout['collapsed'] = {}
  if (s.collapsed && typeof s.collapsed === 'object') {
    for (const [id, folded] of Object.entries(s.collapsed as Record<string, unknown>)) {
      if (isPanelId(id) && folded === true) collapsed[id] = true
    }
  }
  return { order: mergeOrder(s.order), collapsed }
}

/** The saved layout, read now. Storage that is missing, disabled or holding junk reads as the defaults. */
export function loadLayout(): PanelLayout {
  let saved: unknown = null
  try {
    const raw = localStorage.getItem(PANEL_LAYOUT_KEY)
    saved = raw ? JSON.parse(raw) : null
  } catch {
    saved = null
  }
  return normalizeLayout(saved)
}

export function saveLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify({ order: layout.order, collapsed: layout.collapsed }))
  } catch {
    /* private mode, or storage full: the layout lasts this page */
  }
}

interface PanelLayoutState extends PanelLayout {
  /** Fold `id` to its title line, or unfold it. */
  toggle: (id: PanelId) => void
  /** Put `id` in `column` before `before` (null: last). A move that changes nothing writes nothing. */
  move: (id: PanelId, before: PanelId | null, column: Column) => void
}

export const usePanelLayout = create<PanelLayoutState>((set, get) => ({
  ...loadLayout(),
  toggle: (id) => {
    set({ collapsed: toggleCollapsed(get().collapsed, id) })
    saveLayout(get())
  },
  move: (id, before, column) => {
    const order = moveBefore(get().order, id, before, column)
    if (order === get().order) return
    set({ order })
    saveLayout(get())
  },
}))
