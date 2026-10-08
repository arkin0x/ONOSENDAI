/**
 * useRoster.ts - everyone who has moved, newest first: the Avatars list, kept
 * for the whole session and across reloads.
 *
 * The list used to live in the panel's own state. Closing the menu unmounts
 * the panel, so every open started from nothing: one query for the newest
 * 400 actions that authenticated with every relay before asking any, and
 * then waited for the slowest relay's EOSE (or eight seconds) before a single
 * row could show. Here the list lives in a store that the panel only reads:
 *
 * | When | What happens |
 * |---|---|
 * | the app starts | the snapshot kept on this device is read (lib/rosterCache.ts) and painted |
 * | the panel first mounts | a catch-up and a live subscription start, and run for the life of the page |
 * | a catch-up | each relay is asked on its own (relay.ts askRelay), from the newest created_at it last sent (inclusive), or for the newest CATCHUP_LIMIT when it never answered one; rows land as they arrive |
 * | live | every new placing action from anyone, from a minute before the start, reissued by the live registry when a socket dies |
 * | a reconnect, a relay added, the panel reopened after REFRESH_AFTER_MS | another catch-up |
 *
 * One action per pubkey, the newest (chains.ts isNewerAction, the order the
 * panel always had), so an older event, from the cache, a slow relay or a
 * late live delivery, never replaces a newer one. At most ROSTER_KEPT
 * pubkeys are kept, the most recently active; the rest drop off the end.
 *
 * The profiles of the first PROFILE_WATCH listed avatars are watched live as
 * well, so a name or picture changed while the app is open shows without a
 * reload. Profiles are cached by store/useProfiles.ts, which already keeps
 * them across reloads.
 */

import { create } from 'zustand'
import type { Filter } from 'nostr-tools/filter'
import { normalizeURL } from 'nostr-tools/utils'
import { PLACING_ACTIONS, byNewest, isNewerAction, watchRecent } from '../lib/chains'
import { ACTION_KIND, parseAction, type ActionEvent, type NostrEvent } from '../lib/events'
import { FUTURE_SKEW_S } from '../lib/neighborChains'
import { askRelay, onResume, relaySet, subscribe } from '../lib/relay'
import { readRoster, writeRoster } from '../lib/rosterCache'
import { useProfiles } from './useProfiles'
import { useRelays } from './useRelays'

/** The most pubkeys kept, in the store and on the device: the most recently active. */
export const ROSTER_KEPT = 500
/** How many of the newest actions a relay is asked for when catching up. */
export const CATCHUP_LIMIT = 400
/** How long one relay has to connect and authenticate, and then to answer once asked. */
export const CATCHUP_WAIT_MS = 10_000
/** Events that land together are applied together, this often, so a relay's 400 are a few renders and not 400. */
export const INGEST_MS = 50
/** How long after the last change the snapshot is written. */
export const SAVE_MS = 1_000
/** A panel opened this long after the last catch-up asks the relays again. */
export const REFRESH_AFTER_MS = 30_000
/** The longest the first catch-up waits for the device's snapshot before asking the relays without it. */
export const HYDRATE_WAIT_MS = 1_500
/** How many of the listed avatars have their profiles watched live. */
export const PROFILE_WATCH = 100
/** How long the list must hold still before the watched profiles are asked for again. */
export const PROFILE_WATCH_DEBOUNCE_MS = 5_000
/** How far back the live subscriptions start, so nothing lands between the catch-up and them. */
const LIVE_OVERLAP_S = 60

export interface RosterState {
  /** Each listed pubkey's newest placing action, as signed: what is kept on the device. */
  events: Record<string, NostrEvent>
  /** The same actions, parsed, newest first: what the panel lists. */
  list: ActionEvent[]
  /** Per relay (normalized URL), the newest created_at it sent in a finished catch-up: where its next one starts, inclusive. */
  cursors: Record<string, number>
  /** The device's snapshot has been read, or given up on. */
  hydrated: boolean
  /** Relays still answering the catch-up under way; 0 when none is. */
  asking: number
  /** Some relay has answered a catch-up this session. */
  answered: boolean
  /** The last catch-up ended with no relay answering. */
  failed: boolean
}

const EMPTY: RosterState = { events: {}, list: [], cursors: {}, hydrated: false, asking: 0, answered: false, failed: false }

export const useRoster = create<RosterState>(() => ({ ...EMPTY }))

/**
 * Fold `incoming` into the list: each one replaces its pubkey's row only
 * when it is a newer action (isNewerAction), anything that is not a
 * recognized placing action is dropped, and past `kept` pubkeys the least
 * recently active go. Null when nothing changed.
 */
export function foldRoster(
  events: Record<string, NostrEvent>,
  list: ActionEvent[],
  incoming: NostrEvent[],
  kept = ROSTER_KEPT,
): { events: Record<string, NostrEvent>; list: ActionEvent[] } | null {
  const byPubkey = new Map(list.map((a) => [a.pubkey, a]))
  let next: Record<string, NostrEvent> | null = null
  for (const ev of incoming) {
    const a = parseAction(ev)
    if (!a) continue
    const cur = byPubkey.get(a.pubkey)
    if (cur && !isNewerAction(a, cur)) continue
    byPubkey.set(a.pubkey, a)
    next ??= { ...events }
    next[a.pubkey] = ev
  }
  if (!next) return null
  let sorted = [...byPubkey.values()].sort(byNewest)
  if (sorted.length > kept) {
    for (const a of sorted.slice(kept)) delete next[a.pubkey]
    sorted = sorted.slice(0, kept)
  }
  return { events: next, list: sorted }
}

/**
 * Where a relay's next catch-up starts: the newest created_at among the
 * events it sent, inclusive, so an event of that same second still arrives
 * (deduplicated by the fold). One dated beyond this clock plus
 * FUTURE_SKEW_S never sets it, or a single bad clock would hide every move
 * after it. Undefined when there is none.
 */
export function cursorFor(events: NostrEvent[], now: number = Math.floor(Date.now() / 1000)): number | undefined {
  let newest: number | undefined
  for (const e of events) {
    if (e.created_at > now + FUTURE_SKEW_S) continue
    if (newest === undefined || e.created_at > newest) newest = e.created_at
  }
  return newest
}

/** What a relay is asked in a catch-up: from its cursor on, inclusive, or the newest CATCHUP_LIMIT. One tag filter, well under the relay's limit of three. */
export function catchUpFilter(cursor: number | undefined): Filter {
  return { kinds: [ACTION_KIND], '#A': PLACING_ACTIONS, limit: CATCHUP_LIMIT, ...(cursor !== undefined ? { since: cursor } : {}) }
}

/** The panel's state: loading until a relay answers or a row is in hand, an error only with nothing to show. */
export function rosterStatus(s: Pick<RosterState, 'list' | 'answered' | 'failed'>): 'loading' | 'ready' | 'error' {
  if (s.list.length > 0) return 'ready'
  if (s.failed) return 'error'
  return s.answered ? 'ready' : 'loading'
}

let queue: NostrEvent[] = []
let ingestTimer: ReturnType<typeof setTimeout> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let profileTimer: ReturnType<typeof setTimeout> | null = null
let started = false
let hydration: Promise<void> | null = null
/** The snapshot has been read (or could not be): only then may it be written, or a slow read would be overwritten by less. */
let readDone = false
let catching: Promise<void> | null = null
/** A reconnect or a relay change asked for a catch-up while one was running: run another when it ends. */
let again = false
let lastCatchUp = 0
let closeLive: (() => void) | null = null
let closeProfiles: (() => void) | null = null
let watchedAuthors = ''
let unsubscribers: Array<() => void> = []

/** Take one action event in; it is applied with the others that land within INGEST_MS. */
export function ingest(ev: NostrEvent): void {
  queue.push(ev)
  ingestTimer ??= setTimeout(flushIngest, INGEST_MS)
}

/** Apply every event waiting now. */
export function flushIngest(): void {
  if (ingestTimer !== null) { clearTimeout(ingestTimer); ingestTimer = null }
  if (queue.length === 0) return
  const batch = queue
  queue = []
  const s = useRoster.getState()
  const next = foldRoster(s.events, s.list, batch)
  if (!next) return
  useRoster.setState(next)
  saveSoon()
  watchProfilesSoon()
}

function saveSoon(): void {
  if (!readDone) return
  saveTimer ??= setTimeout(() => { void saveNow() }, SAVE_MS)
}

/** Write the snapshot now. */
export async function saveNow(): Promise<boolean> {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
  if (!readDone) return false
  const s = useRoster.getState()
  return writeRoster({ events: Object.values(s.events), cursors: s.cursors })
}

/**
 * Read the device's snapshot into the list, once. Whatever is already in
 * the list stays where it is newer; cursors keep the later of the two.
 * Resolves within HYDRATE_WAIT_MS even when the read has not, and a read
 * that comes back later is still folded in.
 */
export function hydrateRoster(): Promise<void> {
  hydration ??= (async () => {
    const read = readRoster().then((snap) => {
      readDone = true
      if (!snap) return
      flushIngest()
      const s = useRoster.getState()
      const next = foldRoster(s.events, s.list, snap.events)
      const cursors = { ...snap.cursors }
      for (const [url, at] of Object.entries(s.cursors)) cursors[url] = Math.max(cursors[url] ?? at, at)
      useRoster.setState({ ...(next ?? {}), cursors })
      watchProfilesSoon()
    }, () => { readDone = true })
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([read, new Promise<void>((r) => { timer = setTimeout(r, HYDRATE_WAIT_MS) })])
    clearTimeout(timer)
    useRoster.setState({ hydrated: true })
  })()
  return hydration
}

/**
 * Ask every relay for what is newer than what it last sent, each on its
 * own: rows from a fast relay show while a slow one is still connecting.
 * One catch-up at a time; a call during one joins it.
 */
export function catchUp(): Promise<void> {
  catching ??= (async () => {
    await hydrateRoster()
    const relays = [...new Set(relaySet().map((r) => normalizeURL(r)))]
    useRoster.setState({ asking: relays.length, failed: false })
    let anyAnswered = false
    await Promise.all(relays.map(async (url) => {
      try {
        const answer = await askRelay(url, catchUpFilter(useRoster.getState().cursors[url]), ingest, { maxWait: CATCHUP_WAIT_MS })
        flushIngest()
        if (answer.outcome !== 'answered') return
        anyAnswered = true
        // Only a whole answer moves the cursor: a relay cut off part way
        // sent its newest first, and the older rest is still owed.
        const at = cursorFor(answer.events)
        if (at !== undefined) useRoster.setState((s) => ({ cursors: { ...s.cursors, [url]: Math.max(s.cursors[url] ?? at, at) } }))
        useRoster.setState({ answered: true })
      } catch {
        /* this relay is down; the others still count */
      } finally {
        flushIngest()
        useRoster.setState((s) => ({ asking: Math.max(0, s.asking - 1) }))
      }
    }))
    useRoster.setState({ failed: !anyAnswered })
    lastCatchUp = Date.now()
    saveSoon()
  })().finally(() => {
    catching = null
    if (again) { again = false; void catchUp() }
  })
  return catching
}

/** A catch-up for something that changed (the connection came back, the relays changed): after the running one, if one is running, since that one may have asked the old relays or a dead socket. */
function catchUpAgain(): void {
  if (catching) again = true
  else void catchUp()
}

/** Every new placing action, from a minute back, for the life of the page (or until the relays change). */
function openLive(): void {
  closeLive?.()
  closeLive = watchRecent(Math.floor(Date.now() / 1000) - LIVE_OVERLAP_S, ingest)
}

function watchProfilesSoon(): void {
  if (!started) return
  profileTimer ??= setTimeout(watchProfiles, PROFILE_WATCH_DEBOUNCE_MS)
}

/**
 * Watch the profiles of the first PROFILE_WATCH listed avatars: one
 * subscription by author, asked again only when that set of people changes
 * (not when they only change places in it).
 */
export function watchProfiles(): void {
  if (profileTimer !== null) { clearTimeout(profileTimer); profileTimer = null }
  const authors = useRoster.getState().list.slice(0, PROFILE_WATCH).map((a) => a.pubkey).sort()
  const key = authors.join(',')
  if (key === watchedAuthors) return
  watchedAuthors = key
  closeProfiles?.()
  closeProfiles = null
  if (authors.length === 0) return
  const wanted = new Set(authors)
  closeProfiles = subscribe({ kinds: [0], authors, since: Math.floor(Date.now() / 1000) - LIVE_OVERLAP_S }, (ev) => {
    if (wanted.has(ev.pubkey)) useProfiles.getState().remember(ev)
  })
}

/**
 * Start keeping the list: the snapshot, a catch-up, the live feeds, and a
 * catch-up again whenever the connection is reissued or the relays change.
 * Idempotent, and never stopped by the panel: the list keeps up while the
 * menu is closed, so opening it shows what is current.
 */
export function startRoster(): void {
  if (started) return
  started = true
  openLive()
  void catchUp()
  unsubscribers.push(onResume(catchUpAgain))
  unsubscribers.push(useRelays.subscribe((s, prev) => {
    if (s.relays === prev.relays) return
    openLive()
    watchedAuthors = ''
    watchProfilesSoon()
    catchUpAgain()
  }))
  watchProfilesSoon()
}

/** The panel was opened: catch up if the last catch-up is older than REFRESH_AFTER_MS. */
export function refreshRoster(): void {
  if (!started || catching || Date.now() - lastCatchUp < REFRESH_AFTER_MS) return
  void catchUp()
}

/** For tests: stop everything and forget the list, as a reload does (the device's snapshot stays). */
export function stopRoster(): void {
  closeLive?.()
  closeProfiles?.()
  closeLive = null
  closeProfiles = null
  for (const off of unsubscribers) off()
  unsubscribers = []
  for (const t of [ingestTimer, saveTimer, profileTimer]) if (t !== null) clearTimeout(t)
  ingestTimer = saveTimer = profileTimer = null
  queue = []
  started = false
  hydration = null
  readDone = false
  catching = null
  again = false
  lastCatchUp = 0
  watchedAuthors = ''
  useRoster.setState({ ...EMPTY })
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __roster: typeof useRoster }).__roster = useRoster
}
