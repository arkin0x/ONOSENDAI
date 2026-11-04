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
 *
 * Only an answer from the canonical relay can say what is there. One it
 * refused (it gates reads on NIP-42 AUTH, and a bunker away in another app
 * cannot sign in) or never gave read as an empty answer: the panel said
 * "Nothing hidden on the relay yet", the rows and their cache were replaced
 * by nothing, and no later read came for the rest of the visit (the owner's
 * phone, 2026-11-04, with 105 bags on the relay). Now that read only adds
 * what it brought, says why (`trouble`), and is asked again when the relay
 * signs this visit in, when the connection is reissued, and on RETRY.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { HIDDEN_KIND } from '../lib/hidden'
import { afterBackfill, mergeLoot, summarizeBag, type LootItem } from '../lib/loot'
import { onCanonicalSignIn, onResume, queryChecked, subscribe, type ReadTrouble } from '../lib/relay'
import { useRelays } from '../store/useRelays'
import { useShards } from '../store/useShards'

/** Bags taken down from this device, which no relay's answer can bring back. */
function standing(items: LootItem[]): LootItem[] {
  const gone = useShards.getState().deletedBags
  return items.some((it) => gone[it.key]) ? items.filter((it) => !gone[it.key]) : items
}

export interface Loot {
  items: LootItem[]
  status: 'loading' | 'ready' | 'error'
  /** Why the canonical relay gave the last backfill nothing, while it has not answered one since. */
  trouble: ReadTrouble | null
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

// Filtered on the way in: a bag taken down here must not come back from
// this device's own cache either.
const cached = standing(readCache())

export const useLootStore = create<LootState>(() => ({
  items: cached,
  // Rows already on screen are not a loading state, whatever the relay is doing.
  status: cached.length > 0 ? 'ready' : 'loading',
  trouble: null,
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
        const items = standing(mergeLoot(s.items, [item]))
        writeCache(items)
        return { items }
      })
    }
  })

  watchForAnswers()
  backfill(source)
}

/** A backfill is running, and whether another was asked for meanwhile. */
let reading = false
let again = false

/**
 * A backfill the canonical relay did not answer in full is asked again, on
 * its own, sooner first: a busy socket at startup, a signer still signing in.
 * The rows it did bring stay meanwhile. An answer ends the retries.
 */
const RETRY_AFTER_MS = [3_000, 10_000, 30_000, 60_000, 120_000]
let retries = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRetry(failed: boolean): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  if (!failed) { retries = 0; return }
  const wait = RETRY_AFTER_MS[Math.min(retries, RETRY_AFTER_MS.length - 1)]
  retries++
  retryTimer = setTimeout(() => { retryTimer = null; askAgainIfRefused() }, wait)
}

/** Read every bag from the relays, once at a time. */
function backfill(source: string): void {
  if (reading) { again = true; return }
  reading = true
  const done = (): void => {
    reading = false
    if (again) { again = false; backfill(useLootStore.getState().source) }
  }
  queryChecked({ kinds: [HIDDEN_KIND], limit: LOOT_BACKFILL }).then(
    ({ events, trouble }) => {
      if (useLootStore.getState().source !== source) return
      const found = events.map(summarizeBag).filter((x): x is LootItem => x !== null)
      useLootStore.setState((s) => {
        // Without the canonical relay's answer nothing is known to be gone: keep every row, add what came.
        const items = standing(trouble ? mergeLoot(s.items, found) : afterBackfill(s.items, found, LOOT_BACKFILL))
        writeCache(items)
        return { items, status: trouble && items.length === 0 ? 'error' : 'ready', trouble }
      })
      scheduleRetry(trouble !== null)
    },
    () => {
      if (useLootStore.getState().source !== source) return
      // A failed read leaves whatever is already known standing.
      useLootStore.setState((s) => ({ status: s.items.length > 0 ? 'ready' : 'error', trouble: 'unreachable' }))
      scheduleRetry(true)
    },
  ).finally(done)
}

/** Read the bags again (RETRY), keeping the rows on screen while it runs. */
export function refreshLoot(): void {
  const { source, items } = useLootStore.getState()
  if (!source) return
  if (items.length === 0) useLootStore.setState({ status: 'loading' })
  backfill(source)
}

/** Asked again once the relay could answer: it signed this visit in, or the connection came back. */
function askAgainIfRefused(): void {
  if (useLootStore.getState().trouble) refreshLoot()
}
let watching = false
function watchForAnswers(): void {
  if (watching) return
  watching = true
  onCanonicalSignIn(askAgainIfRefused)
  onResume(askAgainIfRefused)
}

export function useLoot(): Loot {
  const relays = useRelays((s) => s.relays)
  const items = useLootStore((s) => s.items)
  const status = useLootStore((s) => s.status)
  const trouble = useLootStore((s) => s.trouble)
  useEffect(() => { ensureLoot(relays) }, [relays])
  return { items, status, trouble }
}
