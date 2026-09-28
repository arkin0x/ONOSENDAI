/**
 * useNotifications: reactions and comments that tag you, newest first
 * (arkinox, 2026-09-28).
 *
 * Read from this app's relays and your own NIP-65 read relays, where other
 * clients deliver them (lib/inbox.ts). The first page loads when an identity
 * becomes active, new ones are polled for, and older ones load a page at a
 * time as the history is scrolled. "Seen" is the newest time you have looked,
 * kept per identity on this device; everything after it is unread, which is
 * what lights the dot on NOTIFICATIONS and raises the toast under XOR BITS.
 *
 * A comment sealed to one of your own bags is opened with that bag's region
 * key, which this device can derive because it hid the bag.
 */

import { create } from 'zustand'
import { COMMENT_KIND } from '../lib/comments'
import { relaysFor } from '../lib/inbox'
import { mergeNotifications, toNotification, unreadCount, type Notification } from '../lib/notifications'
import { queryAny } from '../lib/relay'
import { decryptForRegion, regionKeyAt } from '../lib/shardCrypto'
import { REACTION_KIND } from '../lib/social'
import { MAX_COMPUTE_HEIGHT } from './useCyberspace'
import { positionOf, useShards } from './useShards'

/** Notifications per page, first and older. */
export const PAGE = 30
/** How often new ones are asked for while the app is open. */
export const POLL_MS = 60_000

const SEEN_KEY = (me: string): string => `onosendai:notif-seen:${me}`

function loadSeen(me: string): number {
  try { return Number(localStorage.getItem(SEEN_KEY(me))) || 0 } catch { return 0 }
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
  open: boolean
  unread: () => number
  start: (me: string) => Promise<void>
  poll: () => Promise<void>
  loadMore: () => Promise<void>
  setOpen: (open: boolean) => void
  markSeen: () => void
}

async function fetchPage(me: string, bounds: { until?: number; since?: number }): Promise<Notification[]> {
  const relays = await relaysFor([me])
  const found = await queryAny(relays, { kinds: [REACTION_KIND, COMMENT_KIND], '#p': [me], limit: PAGE, ...bounds })
  return found.map((ev) => toNotification(ev, me)).filter((n): n is Notification => n !== null)
}

/** The words of sealed comments on your own bags, by notification id. */
async function openSealed(list: Notification[], me: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const mine = useShards.getState().mine
  await Promise.all(list.map(async (n) => {
    if (!n.ciphertext || !n.bag) return
    const [, author, lookupId] = n.bag.split(':')
    if (author !== me) return
    const dep = mine.find((d) => d.lookupId === lookupId)
    if (!dep) return
    const words = await decryptForRegion(regionKeyAt(positionOf(dep), dep.height, MAX_COMPUTE_HEIGHT).key, n.ciphertext)
    if (words?.trim()) out[n.id] = words.trim()
  }))
  return out
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
    open: false,
    unread: () => unreadCount(get().items, get().lastSeen),

    start: async (me) => {
      if (get().me === me) return
      set({ me, items: [], opened: {}, lastSeen: loadSeen(me), loading: true, done: false })
      try {
        const page = await fetchPage(me, {})
        await take(me, page)
        if (get().me === me) set({ done: page.length === 0 })
      } catch { /* offline: the next poll tries again */ } finally {
        if (get().me === me) set({ loading: false })
      }
    },

    poll: async () => {
      const { me, items } = get()
      if (!me) return
      try { await take(me, await fetchPage(me, items.length ? { since: items[0].createdAt } : {})) } catch { /* next time */ }
    },

    loadMore: async () => {
      const { me, items, loading, done } = get()
      if (!me || loading || done) return
      set({ loading: true })
      try {
        // Inclusive, so events sharing the oldest second are not skipped; the
        // merge drops the ones already held, and a page that adds nothing is the end.
        const until = items.length ? items[items.length - 1].createdAt : undefined
        const added = await take(me, await fetchPage(me, until === undefined ? {} : { until }))
        if (get().me === me && added === 0) set({ done: true })
      } catch { /* leave `done` alone: scrolling again retries */ } finally {
        if (get().me === me) set({ loading: false })
      }
    },

    setOpen: (open) => {
      set({ open })
      if (open) get().markSeen()
    },

    markSeen: () => {
      const { me, items } = get()
      if (!me || items.length === 0) return
      const lastSeen = Math.max(get().lastSeen, items[0].createdAt)
      set({ lastSeen })
      try { localStorage.setItem(SEEN_KEY(me), String(lastSeen)) } catch { /* private mode */ }
    },
  }
})
