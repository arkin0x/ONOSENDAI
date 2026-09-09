/**
 * useLoot.ts — the relay's bags, fetched once and kept for the session.
 *
 * One backfill query for every kind:33330 envelope and one live subscription
 * for new or rewritten ones, merged by bag key so a republished bag replaces
 * its older self instead of appearing twice.
 *
 * The list lives outside React. It used to live in the panel's own state, so
 * closing the menu threw it away and opening it again showed LOADING, then an
 * empty list, then everything at once: the panel jumped every time. Now the
 * fetch runs once per relay set, the subscription stays open for the session,
 * and reopening the panel shows what is already known. A relay added in the
 * Relays panel starts a fresh backfill, and the rows already on screen stay
 * there while it runs.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { HIDDEN_KIND } from '../lib/hidden'
import { mergeLoot, summarizeBag, type LootItem } from '../lib/loot'
import { query, subscribe } from '../lib/relay'
import { useRelays } from '../store/useRelays'

export interface Loot {
  items: LootItem[]
  status: 'loading' | 'ready' | 'error'
}

/** The relay holds a few dozen bags today; this leaves room without paging. */
export const LOOT_BACKFILL = 500

interface LootState extends Loot {
  /** The relay set the current subscription and backfill belong to. */
  source: string
}

const CACHE_KEY = 'onosendai:loot'
/** How many rows are kept for the next visit. The panel shows a handful. */
const CACHE_MAX = 120

/**
 * The last list, kept for the next visit.
 *
 * Holding it outside React stopped the panel blinking when the menu closed,
 * but a reload still opened on LOADING and an empty list and then dropped two
 * dozen rows in at once, moving everything under them. The rows are small and
 * they do not spoil: a bag that has been rewritten comes back in the same
 * backfill and replaces itself.
 */
function readCache(): LootItem[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? (list as LootItem[]).filter((i) => i && typeof i.key === 'string') : []
  } catch {
    return []
  }
}

function writeCache(items: LootItem[]): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(items.slice(0, CACHE_MAX))) } catch { /* private mode */ }
}

const cached = readCache()

export const useLootStore = create<LootState>(() => ({
  items: cached,
  // Rows already on screen are not a loading state, whatever the relay is doing.
  status: cached.length > 0 ? 'ready' : 'loading',
  source: '',
}))

let close: (() => void) | null = null

/** Start (or restart, for a new relay set) the backfill and the subscription. */
export function ensureLoot(relays: string[]): void {
  const source = relays.join(',')
  if (useLootStore.getState().source === source) return
  close?.()

  const known = useLootStore.getState().items
  // Anything already known stays on screen while the new relays are read, so
  // the panel never blinks back to nothing.
  useLootStore.setState({ source, status: known.length > 0 ? 'ready' : 'loading' })

  const since = Math.floor(Date.now() / 1000) - 60
  close = subscribe({ kinds: [HIDDEN_KIND], since }, (ev) => {
    const item = summarizeBag(ev)
    if (item && useLootStore.getState().source === source) {
      useLootStore.setState((s) => {
        const items = mergeLoot(s.items, [item])
        writeCache(items)
        return { items }
      })
    }
  })

  query({ kinds: [HIDDEN_KIND], limit: LOOT_BACKFILL }).then(
    (events) => {
      if (useLootStore.getState().source !== source) return
      const found = events.map(summarizeBag).filter((x): x is LootItem => x !== null)
      useLootStore.setState((s) => {
        const items = mergeLoot(s.items, found)
        writeCache(items)
        return { items, status: 'ready' }
      })
    },
    () => {
      if (useLootStore.getState().source !== source) return
      // A failed read leaves whatever is already known standing.
      useLootStore.setState((s) => ({ status: s.items.length > 0 ? 'ready' : 'error' }))
    },
  )
}

export function useLoot(): Loot {
  const relays = useRelays((s) => s.relays)
  const items = useLootStore((s) => s.items)
  const status = useLootStore((s) => s.status)
  useEffect(() => { ensureLoot(relays) }, [relays])
  return { items, status }
}
