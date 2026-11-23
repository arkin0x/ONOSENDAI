/**
 * useNotifications: reactions and comments that tag you, newest first
 * (arkinox, 2026-09-28).
 *
 * Read from this app's relays and your own NIP-65 read relays, where other
 * clients deliver them (lib/inbox.ts). The first page loads when an identity
 * becomes active, new ones are polled for, and older ones load a page at a
 * time as the history is scrolled. "Seen" is the newest time you have looked,
 * kept per identity on this device; everything after it is unread, which is
 * what lights the dot on NOTIFICATIONS, raises the toast under XOR BITS, and
 * marks a row new in the modal. Looking is closing the modal: the rows that
 * were new keep their dots while it is open (setOpen).
 *
 * A comment sealed to one of your own bags is opened with the key this
 * device holds for that bag (the key it was sealed with: the region key, or
 * a room's key), never derived again here: a bag above height 20, hidden
 * through HOSAKA, has a key no client computes (2026-11-09). A comment that
 * does not open is left sealed; it never fails the rest of the page.
 *
 * Only Cyberspace things are kept (lib/notifications.ts classify): a like on
 * an ordinary note is not a notification here (arkinox, 2026-09-30; again
 * 2026-11-14, "I only want to see cyberspace-related notifications here").
 * The relays are asked only for what can be Cyberspace's
 * (notificationFilters); what cannot be told apart from the event alone is
 * settled by looking its target up, once per page, and dropped when the
 * target cannot be found.
 */

import { create } from 'zustand'
import { relaysFor } from '../lib/inbox'
import { classify, mergeNotifications, notificationFilters, resolve, unreadCount, type Candidate, type Known, type Notification, type Target } from '../lib/notifications'
import { GENERAL_RELAYS } from '../lib/contacts'
import { onCanonicalSignIn, queryAny, queryAnyChecked, type ReadTrouble } from '../lib/relay'
import { decryptForRegion } from '../lib/shardCrypto'
import { itemLineage } from '../lib/hidden'
import { hexToBytes, type NostrEvent } from '../lib/events'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'

/** Notifications per page, first and older. */
export const PAGE = 30
/** How often new ones are asked for while the app is open. */
export const POLL_MS = 60_000

const SEEN_KEY = (me: string): string => `onosendai:notif-seen:${me}`

function loadSeen(me: string): number {
  try { return Number(localStorage.getItem(SEEN_KEY(me))) || 0 } catch { return 0 }
}

/**
 * Chat lines that tagged you (arkinox, 2026-10-13). Chat is ephemeral and no
 * relay keeps it, so these are the one kind of notification made on this
 * device, and kept here per identity, newest MENTIONS_KEPT.
 */
const MENTIONS_KEY = (me: string): string => `onosendai:notif-mentions:${me}`
export const MENTIONS_KEPT = 100

function loadMentions(me: string): Notification[] {
  try {
    const list = JSON.parse(localStorage.getItem(MENTIONS_KEY(me)) ?? '[]') as unknown
    return Array.isArray(list) ? (list as Notification[]).filter((n) => n && n.what === 'mention' && typeof n.id === 'string') : []
  } catch {
    return []
  }
}

function saveMentions(me: string, items: readonly Notification[]): void {
  const kept = items.filter((n) => n.what === 'mention').slice(0, MENTIONS_KEPT)
  try { localStorage.setItem(MENTIONS_KEY(me), JSON.stringify(kept)) } catch { /* private mode: kept for this session */ }
}

interface NotificationsState {
  me: string | null
  items: Notification[]
  /** Opened sealed words, by notification id. */
  opened: Record<string, string>
  lastSeen: number
  loading: boolean
  /** No older page left. */
  done: boolean
  /**
   * Where each of notificationFilters reads its next older page (its
   * `until`): undefined, not read yet; null, nothing older. Each is paged on
   * its own, since they fill at very different rates.
   */
  cursors: Cursor[]
  /** The newest event any filter has returned, kept or dropped: where a poll reads from. */
  newest: number
  /** The oldest event the move, item and thread filters have returned: how far back likes on a kind 1 are read (fetchPage). */
  floor: number | null
  /** Why the canonical relay gave the last read nothing, if it did not answer (it is not "nothing yet"). */
  trouble: ReadTrouble | null
  open: boolean
  /**
   * What this opening of the modal showed: the newest row there when it
   * opened, for the identity then active. Closing reads up to this and no
   * further, so a row that arrives while a card VIEW opened sits over the
   * list is still new next time (review of the overhaul).
   */
  shown: { me: string; upTo: number } | null
  unread: () => number
  start: (me: string) => Promise<void>
  poll: () => Promise<void>
  loadMore: () => Promise<void>
  setOpen: (open: boolean) => void
  /** Read everything up to `upTo` (default: the newest row held). */
  markSeen: (upTo?: number) => void
  /** A chat line that tagged `me`, made on this device and kept with the rest. */
  addMention: (me: string, n: Notification) => void
}

/**
 * Your moves and your hidden items, as this device knows them: an item by the
 * row's id, the inner event's, and the lineage it keeps (lib/notifications
 * hiddenRowFor), since a reaction names the item itself (hud/SecretModal).
 */
function knownHere(): Known {
  const items = new Map<string, string | undefined>()
  for (const d of useShards.getState().mine) {
    // An item carried inline and moved by EDIT is named by its first version's id (itemLineage).
    const first = !d.ref && d.inner?.id !== undefined ? itemLineage(d.inner as { id: string; kind: number; tags: string[][] }) : undefined
    for (const id of [d.eventId, d.inner?.id, d.lineage, first]) if (id && !items.has(id)) items.set(id, d.lookupId)
  }
  return { actions: new Set(useCyberspace.getState().events.map((e) => e.id)), items }
}

/**
 * The most each of notificationFilters is asked for in one page. Reactions to
 * a kind 1 or 1063 are mostly likes on ordinary notes, all dropped, so that
 * filter is asked for more at a time.
 */
export const LIMITS = [PAGE, PAGE, 100] as const

/** Where one filter reads next: undefined, from the newest; a time, up to it; null, nothing older. */
export type Cursor = number | null | undefined
const FROM_THE_TOP: Cursor[] = LIMITS.map(() => undefined)

/**
 * Where a filter that returned `events` for a read up to `until` goes next:
 * null when it did not fill its page (nothing older), else its oldest event's
 * second, again, so events sharing it are not skipped (the merge drops the
 * ones already held). A page that ends where it began moves on by a second,
 * so it cannot repeat forever.
 */
export function nextUntil(events: readonly Pick<NostrEvent, 'created_at'>[], limit: number, until: number | undefined): number | null {
  if (events.length < limit) return null
  const oldest = Math.min(...events.map((e) => e.created_at))
  return until !== undefined && oldest >= until ? until - 1 : oldest
}

/** Events as notifications for `me`, their targets looked up where needed. `failed`: the lookup could not be made. */
async function keep(me: string, relays: string[], events: NostrEvent[]): Promise<{ kept: Notification[]; failed: boolean }> {
  const known = knownHere()
  const candidates = [...new Map(events.map((ev) => [ev.id, ev])).values()].map((ev) => classify(ev, me, known)).filter((c): c is Candidate => c !== null)
  // The targets that decide whether a notification is Cyberspace's, looked up
  // together where your notes live as well as where this app reads.
  const ids = [...new Set(candidates.flatMap((c) => (c.lookup ? [c.lookup.id] : [])))]
  const targets = new Map<string, Target>()
  let failed = false
  if (ids.length) {
    const found = await queryAny([...new Set([...relays, ...GENERAL_RELAYS])], { ids, limit: ids.length }).catch(() => { failed = true; return [] })
    for (const ev of found) targets.set(ev.id, { kind: ev.kind, tags: ev.tags })
  }
  return { kept: candidates.map((c) => resolve(c, targets)).filter((n): n is Notification => n !== null), failed }
}

/** One page: what was kept, why the canonical relay gave nothing (if it did not answer), each filter's next cursor, and the newest event seen. */
interface Page { page: Notification[]; trouble: ReadTrouble | null; cursors: Cursor[]; newest: number; floor: number | null }

/**
 * The next older page of every filter not yet read to its end. A page the
 * canonical relay did not answer, or whose lookups failed, moves no cursor:
 * it is read again (review of this change).
 *
 * Reactions to a kind 1 or 1063 are read back no further than the oldest
 * other notification, once the other filters have ended: a hidden message is
 * reacted to after its bag, and what tags you before any of your Cyberspace
 * traffic is years of likes on notes.
 */
async function fetchPage(me: string, cursors: readonly Cursor[], floorSoFar: number | null = null): Promise<Page> {
  const relays = await relaysFor([me])
  const filters = notificationFilters(me)
  const reads = await Promise.all(filters.map(async (f, i) => {
    const until = cursors[i]
    if (until === null) return null
    const r = await queryAnyChecked(relays, { ...f, limit: LIMITS[i], ...(until === undefined ? {} : { until }) })
    return { ...r, next: nextUntil(r.events, LIMITS[i], until) }
  }))
  const events = reads.flatMap((r) => r?.events ?? [])
  const { kept, failed } = await keep(me, relays, events)
  const trouble = reads.find((r) => r?.trouble)?.trouble ?? null
  const newest = Math.max(0, ...events.map((e) => e.created_at))
  const others = reads.slice(0, 2).flatMap((r) => r?.events ?? []).map((e) => e.created_at)
  const floor = others.length ? Math.min(...others, floorSoFar ?? Infinity) : floorSoFar
  if (trouble || failed) return { page: kept, trouble, cursors: [...cursors], newest: 0, floor: floorSoFar }
  const next: Cursor[] = reads.map((r, i) => (r ? r.next : cursors[i]))
  if (next[0] === null && next[1] === null && typeof next[2] === 'number' && (floor === null || next[2] < floor)) next[2] = null
  return { page: kept, trouble, cursors: next, newest, floor }
}

/**
 * Everything new since `since`, every filter: one that fills its page reads
 * back until it meets `since`, at most NEW_PAGES pages, so a tab asleep for a
 * while misses nothing between.
 */
async function fetchNew(me: string, since: number): Promise<{ page: Notification[]; trouble: ReadTrouble | null; newest: number }> {
  const relays = await relaysFor([me])
  const reads = await Promise.all(notificationFilters(me).map(async (f, i) => {
    const got: NostrEvent[] = []
    let until: number | undefined
    let trouble: ReadTrouble | null = null
    for (let n = 0; n < NEW_PAGES; n += 1) {
      const r = await queryAnyChecked(relays, { ...f, limit: LIMITS[i], since, ...(until === undefined ? {} : { until }) })
      got.push(...r.events)
      trouble = trouble ?? r.trouble
      const next = nextUntil(r.events, LIMITS[i], until)
      if (next === null || next < since) break
      until = next
    }
    return { events: got, trouble }
  }))
  const events = reads.flatMap((r) => r.events)
  const { kept, failed } = await keep(me, relays, events)
  const trouble = reads.find((r) => r.trouble)?.trouble ?? null
  // Not moved past what was not read whole: the next poll asks again.
  return { page: kept, trouble, newest: trouble || failed ? since : Math.max(since, ...events.map((e) => e.created_at)) }
}

/** How many pages one scroll to the end reads at most while they keep nothing (every row on them was someone else's traffic). */
export const EMPTY_PAGES = 4
/** How many pages a poll reads back at most, per filter. */
export const NEW_PAGES = 5

/** The words of sealed comments on your own bags, by notification id. */
async function openSealed(list: Notification[], me: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const mine = useShards.getState().mine
  await Promise.all(list.map(async (n) => {
    if (!n.ciphertext || !n.bag) return
    const [, author, lookupId] = n.bag.split(':')
    if (author !== me) return
    const dep = mine.find((d) => d.lookupId === lookupId && d.keyHex)
    if (!dep) return
    try {
      const words = await decryptForRegion(hexToBytes(dep.keyHex), n.ciphertext)
      if (words?.trim()) out[n.id] = words.trim()
    } catch { /* left sealed */ }
  }))
  return out
}

/** Refused for want of AUTH: read again once the relay signs this visit in. Set up on the first read. */
let watching = false
function watchSignIn(): void {
  if (watching) return
  watching = true
  onCanonicalSignIn(() => { if (useNotifications.getState().trouble) void useNotifications.getState().poll() })
}

export const useNotifications = create<NotificationsState>((set, get) => {
  /** Merge a page in, unless the identity changed while it was in flight. */
  const take = async (me: string, page: Notification[]): Promise<number> => {
    const opened = await openSealed(page, me)
    if (get().me !== me) return 0
    const before = get().items.length
    set((s) => ({ items: mergeNotifications(s.items, page), opened: { ...s.opened, ...opened } }))
    return get().items.length - before
  }

  return {
    me: null,
    items: [],
    opened: {},
    lastSeen: 0,
    loading: false,
    done: false,
    cursors: FROM_THE_TOP,
    newest: 0,
    floor: null,
    trouble: null,
    open: false,
    shown: null,
    unread: () => unreadCount(get().items, get().lastSeen),

    start: async (me) => {
      watchSignIn()
      if (get().me === me) return
      set({ me, items: mergeNotifications([], loadMentions(me)), opened: {}, lastSeen: loadSeen(me), loading: true, done: false, cursors: FROM_THE_TOP, newest: 0, floor: null, trouble: null })
      try {
        const { page, trouble, cursors, newest, floor } = await fetchPage(me, FROM_THE_TOP)
        await take(me, page)
        // A page the canonical relay did not answer is not the end of the list.
        if (get().me === me) set({ done: cursors.every((c) => c === null), cursors, newest: Math.max(get().newest, newest), floor, trouble })
      } catch { /* offline: the next poll tries again */ } finally {
        if (get().me === me) set({ loading: false })
      }
    },

    poll: async () => {
      const { me } = get()
      if (!me) return
      // From the newest event the relays gave, kept or not: a chat mention is
      // made here and says nothing of what they hold, and the newest row kept
      // can be days behind the likes on notes read and dropped since.
      // Nothing read whole yet (the first page was refused): read it again, as start does.
      const since = get().newest
      try {
        if (!since) {
          const { page, trouble, cursors, newest, floor } = await fetchPage(me, FROM_THE_TOP)
          await take(me, page)
          if (get().me === me && !get().newest) set({ trouble, cursors, newest, floor, done: cursors.every((c) => c === null) })
          return
        }
        const { page, trouble, newest } = await fetchNew(me, since)
        await take(me, page)
        if (get().me === me) set({ trouble, newest: Math.max(get().newest, newest) })
      } catch { /* next time */ }
    },

    loadMore: async () => {
      const { me, loading, done } = get()
      if (!me || loading || done) return
      set({ loading: true })
      try {
        // Pages that keep nothing (all someone else's traffic) are read past,
        // a few at a time; the modal asks again while its end is in view.
        for (let i = 0; i < EMPTY_PAGES; i += 1) {
          const { page, trouble, cursors, newest, floor } = await fetchPage(me, get().cursors, get().floor)
          const added = await take(me, page)
          if (get().me !== me) return
          const ended = cursors.every((c) => c === null)
          set({ trouble, cursors, newest: Math.max(get().newest, newest), floor, ...(ended ? { done: true } : {}) })
          if (added > 0 || ended || trouble) break
        }
      } catch { /* leave `done` alone: scrolling again retries */ } finally {
        if (get().me === me) set({ loading: false })
      }
    },

    // Read when the modal closes, not when it opens (arkinox, 2026-11-14:
    // "the new notifications should have the flashing red dot on them; read
    // notifications should not have the dot"): the ones new at opening keep
    // their dot while it is up, and whatever it showed is read once it is
    // closed, by ✕, a tap outside or Escape.
    setOpen: (open) => {
      const { open: was, me, items, lastSeen, shown } = get()
      if (open && !was) { set({ open, shown: me ? { me, upTo: Math.max(lastSeen, items[0]?.createdAt ?? 0) } : null }); return }
      set({ open, ...(open ? {} : { shown: null }) })
      // Read only what was there to see, and only for the identity it was shown to.
      if (was && !open && shown && shown.me === me) get().markSeen(shown.upTo)
    },

    markSeen: (upTo) => {
      const { me, items } = get()
      if (!me || (items.length === 0 && upTo === undefined)) return
      const lastSeen = Math.max(get().lastSeen, upTo ?? items[0].createdAt)
      set({ lastSeen })
      try { localStorage.setItem(SEEN_KEY(me), String(lastSeen)) } catch { /* private mode */ }
    },

    addMention: (me, n) => {
      // Not the identity on show (it switched while the line was opened): kept
      // for when that identity's list next loads.
      if (get().me !== me) { saveMentions(me, mergeNotifications(loadMentions(me), [n])); return }
      if (get().items.some((x) => x.id === n.id)) return
      const items = mergeNotifications(get().items, [n])
      set({ items })
      saveMentions(me, items)
    },
  }
})
