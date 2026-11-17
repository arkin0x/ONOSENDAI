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
 *
 * Your sector first (owner, 2026-11-14). The newest LOOT_BACKFILL bags from
 * anywhere can leave out every bag hidden where you stand, so a second read
 * asks for the bags whose hint names your sector: a hinted bag carries the
 * sector tags of its hint (`S` "sx-sy-sz", spec §7.7, §10), and a bag
 * without a hint carries none. Its answer joins the same list (one row per
 * bag), and the panel shows the bags of your sector first. It is read again
 * whenever your sector changes, and with every backfill, so the same
 * trouble, retries and AUTH answer it as the newest bags.
 */

import { useEffect } from 'react'
import { create } from 'zustand'
import { xyzToSectorId } from 'cyberspace-core'
import { HIDDEN_KIND } from '../lib/hidden'
import { afterBackfill, mergeLoot, summarizeBag, type LootItem } from '../lib/loot'
import { onCanonicalSignIn, onResume, queryChecked, subscribe, type ReadTrouble } from '../lib/relay'
import { useRelays } from '../store/useRelays'
import { useShards } from '../store/useShards'
import { useCyberspace } from '../store/useCyberspace'
import { readCached, takeLocal, writeCachedSoon } from '../lib/deviceCache'
import type { Position } from '../lib/space'

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
  /**
   * The sector your chain head stands in, "sx-sy-sz" as a hint's sector is
   * written (LootItem sector). Null only in the store before any panel has
   * read it; the hook always has one (before the saved chain is in, the
   * place known then, as everything else that follows the head).
   */
  sector: string | null
}

/** The sector a position is in, as the `S` tag and LootItem.sector write it. */
export function sectorOf(p: Position): string {
  const s = xyzToSectorId(p.x, p.y, p.z)
  return `${s.sx}-${s.sy}-${s.sz}`
}

/**
 * A list with your sector's bags first (owner, 2026-11-14): those whose hint
 * names `sector`, then every other bag, each group newest first as the list
 * already is. A bag without a hint is never in your sector's group.
 */
export function sectorFirst(items: LootItem[], sector: string | null): { here: LootItem[]; elsewhere: LootItem[] } {
  if (sector === null) return { here: [], elsewhere: items }
  const here: LootItem[] = []
  const elsewhere: LootItem[] = []
  for (const it of items) (it.sector === sector ? here : elsewhere).push(it)
  return { here, elsewhere }
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
/** The device cache's record for the list. */
export const LOOT_CACHE_KEY = 'loot'

/**
 * The last list, kept for the next visit.
 *
 * Holding it outside React stopped the panel blinking when the menu closed,
 * but a reload still opened on LOADING and an empty list and then dropped two
 * dozen rows in at once, moving everything under them. The rows are small and
 * they do not spoil: a bag that has been rewritten comes back in the same
 * backfill and replaces itself.
 */
function keptItems(list: unknown): LootItem[] {
  return Array.isArray(list) ? (list as LootItem[]).filter((i) => i && typeof i.key === 'string' && typeof i.createdAt === 'number') : []
}

/** What an older build left in localStorage, moved to the device cache once (lib/deviceCache.ts takeLocal). */
function readCache(): LootItem[] {
  return keptItems(takeLocal(CACHE_KEY, LOOT_CACHE_KEY))
}

/** Kept on the device in IndexedDB (lib/deviceCache.ts), never localStorage (arkinox, 2026-11-17). */
function writeCache(items: LootItem[]): void {
  writeCachedSoon(LOOT_CACHE_KEY, items.slice(0, CACHE_MAX))
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
  sector: null,
}))

/** Set once a backfill has answered this visit. */
let backfilled = false

/**
 * The list kept on the device, merged in once at start (mergeLoot: the newest
 * copy of each bag wins), a moment after the first frame. Rows already on
 * screen stay; the status turns ready if this is the first the list has.
 */
export const lootHydrated: Promise<void> = readCached(LOOT_CACHE_KEY).then((data) => {
  const kept = standing(keptItems(data))
  // A backfill already in says what is gone: the kept list would only bring it back.
  if (kept.length === 0 || backfilled) return
  useLootStore.setState((s) => ({ items: standing(mergeLoot(kept, s.items)), status: s.status === 'loading' ? 'ready' : s.status }))
}, () => undefined)

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

/** The bags whose hint names `sector`: a hinted bag carries its hint's sector tags (spec §7.7), an unhinted one none. */
function sectorFilter(sector: string): { kinds: number[]; '#S': string[]; limit: number } {
  return { kinds: [HIDDEN_KIND], '#S': [sector], limit: LOOT_BACKFILL }
}

const summarize = (events: Parameters<typeof summarizeBag>[0][]): LootItem[] => events.map(summarizeBag).filter((x): x is LootItem => x !== null)

/**
 * Read every bag from the relays, and your sector's (sectorFilter), once at
 * a time. The newest bags decide what is gone and what the trouble is; your
 * sector's are added to them, and a read of them the canonical relay did not
 * answer is trouble too, asked again like any.
 */
function backfill(source: string): void {
  if (reading) { again = true; return }
  reading = true
  const done = (): void => {
    reading = false
    if (again) { again = false; backfill(useLootStore.getState().source) }
  }
  const sector = useLootStore.getState().sector
  const none = Promise.resolve({ events: [], trouble: null })
  Promise.all([queryChecked({ kinds: [HIDDEN_KIND], limit: LOOT_BACKFILL }), sector ? queryChecked(sectorFilter(sector)) : none]).then(
    ([{ events, trouble: newest }, near]) => {
      if (useLootStore.getState().source !== source) return
      const found = summarize(events)
      if (sector !== null) noteSectorRead(sector, near.trouble)
      // The newest bags' trouble, else your sector's: a backfill that began
      // before you were known to be where you are now did not ask about it,
      // so a refusal setLootSector heard meanwhile stands, and so does its retry.
      const trouble = newest ?? sectorTroubleNow()
      useLootStore.setState((s) => {
        // Your sector's bags: this read's, when it asked for the sector you
        // are in now; else the ones already known there (setLootSector reads
        // them on its own), which an answer about the newest bags never drops.
        const here = sector !== null && sector === s.sector && !near.trouble ? summarize(near.events) : s.items.filter((it) => s.sector !== null && it.sector === s.sector)
        // Without the canonical relay's answer nothing is known to be gone: keep every row, add what came.
        const items = standing(mergeLoot(newest ? mergeLoot(s.items, found) : afterBackfill(s.items, found, LOOT_BACKFILL), here))
        writeCache(items)
        backfilled = true
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

/** The last read of a sector's bags that the canonical relay did not answer, until one of that sector is answered. */
let sectorRefusal: { sector: string; trouble: ReadTrouble } | null = null

function noteSectorRead(sector: string, trouble: ReadTrouble | null): void {
  // Only about where you are now: a late answer for a sector already left says nothing.
  if (useLootStore.getState().sector !== sector) return
  if (trouble) sectorRefusal = { sector, trouble }
  else if (sectorRefusal?.sector === sector) sectorRefusal = null
}

/** The trouble of your current sector's read, if its last read was not answered. */
function sectorTroubleNow(): ReadTrouble | null {
  return sectorRefusal !== null && sectorRefusal.sector === useLootStore.getState().sector ? sectorRefusal.trouble : null
}

/**
 * Your sector is `sector` now: its bags are read at once (and with every
 * backfill after). What they bring joins the list; a read the canonical relay
 * did not answer is trouble, asked again (scheduleRetry) by a whole backfill,
 * unless you have left that sector by the time it comes back.
 */
export function setLootSector(sector: string | null): void {
  const { source, sector: was } = useLootStore.getState()
  if (sector === was) return
  useLootStore.setState({ sector })
  if (!source || !sector) return
  queryChecked(sectorFilter(sector)).then(
    ({ events, trouble: refused }) => {
      if (useLootStore.getState().source !== source) return
      noteSectorRead(sector, refused)
      // A late answer for a sector already left: its bags still join, its refusal is no one's trouble now.
      const trouble = sectorTroubleNow()
      const here = summarize(events)
      useLootStore.setState((s) => {
        const items = standing(mergeLoot(s.items, here))
        writeCache(items)
        // An answer here says nothing about the newest bags' trouble; a refusal is trouble of its own.
        return { items, ...(trouble && !s.trouble ? { trouble } : {}), ...(items.length > 0 && s.status !== 'ready' ? { status: 'ready' as const } : {}) }
      })
      if (trouble) scheduleRetry(true)
    },
    () => {
      if (useLootStore.getState().source !== source) return
      noteSectorRead(sector, 'unreachable')
      if (!sectorTroubleNow()) return
      if (!useLootStore.getState().trouble) useLootStore.setState({ trouble: 'unreachable' })
      scheduleRetry(true)
    },
  )
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
  // Where you stand: your chain head's sector, read again as it changes.
  const sector = useCyberspace((s) => sectorOf(s.position))
  useEffect(() => { ensureLoot(relays) }, [relays])
  useEffect(() => { setLootSector(sector) }, [sector])
  return { items, status, trouble, sector }
}
