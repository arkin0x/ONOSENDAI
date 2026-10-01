/**
 * useEscape.ts - one Escape press closes one thing, in a fixed order.
 *
 * arkinox, 2026-10-01: "ESC should exit modals, then exit menu, then close ui
 * overlay chips." The things Escape can close each keep their own open state,
 * some in a store and some in a component, so the keyboard hook cannot know
 * them all without reaching into dozens of places. Instead each one says so
 * itself while it is on screen: it registers a closer with a layer, and the
 * keyboard hook calls the closer on top.
 *
 * The order is the layer first (a modal over the menu over a chip), then the
 * most recently opened within the layer. Recency is what makes a confirmation
 * layered over a modal close before the modal under it: the confirmation was
 * opened later. Only what is on screen is registered, so Escape never closes
 * something hidden behind the menu or folded away by another view.
 *
 * Recency is taken when a thing opens, during its render, not when its effect
 * runs. React runs a child's effects before its parent's, so effect order
 * would put a dialog that mounts together with its own confirmation (or a
 * chip that mounts open) in the wrong order; render order is parent first.
 */

import { useEffect, useRef } from 'react'

/** Where a closer sits in the order: a modal before the menu before a chip. */
export type EscapeLayer = 'modal' | 'menu' | 'chip'

const RANK: Record<EscapeLayer, number> = { chip: 0, menu: 1, modal: 2 }

interface Entry {
  layer: EscapeLayer
  /** When it opened: higher is more recent. */
  order: number
  close: () => void
}

const entries = new Set<Entry>()
let opened = 0

/** The next opening's place in time. */
export function nextEscapeOrder(): number {
  opened += 1
  return opened
}

/**
 * Put a closer on the stack until the returned function takes it off. The
 * order defaults to now; useEscape passes the one it took at render.
 */
export function registerEscape(layer: EscapeLayer, close: () => void, order: number = nextEscapeOrder()): () => void {
  const entry: Entry = { layer, order, close }
  entries.add(entry)
  return () => { entries.delete(entry) }
}

/** The highest layer's most recent entry. */
function top(): Entry | null {
  let best: Entry | null = null
  for (const e of entries) {
    if (best === null || RANK[e.layer] > RANK[best.layer] || (RANK[e.layer] === RANK[best.layer] && e.order > best.order)) best = e
  }
  return best
}

/** The layer and recency of what Escape would close now, or null when nothing is open. */
export function topEscape(): { layer: EscapeLayer; order: number } | null {
  const t = top()
  return t === null ? null : { layer: t.layer, order: t.order }
}

/**
 * Close the one thing on top. True when something was there to close, false
 * when nothing is open (Escape then does nothing at all: the old "reset to
 * top down" fallback is gone, arkinox 2026-10-01).
 */
export function escapeTop(): boolean {
  const t = top()
  if (t === null) return false
  t.close()
  return true
}

/**
 * Register `close` on the Escape stack while `active`. Call it above any early
 * return, as with every hook. The closer may change every render (it usually
 * closes over local state); the latest one is what Escape calls, and a new
 * closer never moves the entry's place in the order.
 */
export function useEscape(layer: EscapeLayer, active: boolean, close: () => void): void {
  const latest = useRef(close)
  latest.current = close
  // Taken in render, on the render that opens it: see the header for why.
  const order = useRef<number | null>(null)
  if (!active) order.current = null
  else if (order.current === null) order.current = nextEscapeOrder()
  useEffect(() => {
    if (!active || order.current === null) return
    return registerEscape(layer, () => latest.current(), order.current)
  }, [active, layer])
}
