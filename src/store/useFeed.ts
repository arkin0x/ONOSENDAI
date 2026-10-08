/**
 * useFeed.ts - the Shard Feed: everyone's published SNO objects, newest first.
 *
 * The read itself is sno-core's (sno-core/feed), shared with snocrash so the
 * two clients show the same feed and a fix reaches both: kind 33331, never a
 * tag filter (the cyberspace relay refuses more than three), each relay read
 * on its own so one hung relay cannot starve the rest, the newest event per
 * address, a page at a time. This store only supplies ONOSENDAI's side: which
 * relays (yours plus the general relays objects are published to) and how to
 * subscribe to one (lib/relay.ts, with NIP-42 auth).
 *
 * One feed for the app, read when it is first shown and kept while the app
 * runs, so moving between the PLACE OBJECT picker and the SHARD FEED window
 * does not read the relays again. REFRESH starts it over.
 */

import { create } from 'zustand'
import { FEED_RELAYS, createFeed, type Feed, type FeedObject } from 'sno-core/feed'
import { prepareRelay, relaySet, subscribeOne } from '../lib/relay'

export interface FeedStore {
  objects: FeedObject[]
  loading: boolean
  /** Every relay has been read to its end. */
  exhausted: boolean
  /** The first page has been asked for. */
  started: boolean
  /** Read the first page, once. */
  start: () => void
  /** The next page, when the list is scrolled to its end. */
  more: () => void
  /** Start over from the newest. */
  refresh: () => void
}

/** Your relays first, then the ones objects are published to; each once. */
export function feedRelays(): string[] {
  return [...new Set([...relaySet(), ...FEED_RELAYS])]
}

let feed: Feed | null = null

export const useFeed = create<FeedStore>((set, get) => ({
  objects: [],
  loading: false,
  exhausted: false,
  started: false,

  start: () => {
    if (get().started) return
    set({ started: true })
    feed = createFeed({
      relays: feedRelays(),
      // A FeedFilter is a nostr Filter with no tag keys, which is the point.
      subscribe: (url, filter, handlers) => subscribeOne(url, { ...filter }, handlers),
      read: { prepare: prepareRelay },
      onChange: (s) => set({ objects: s.objects, loading: s.loading, exhausted: s.exhausted }),
    })
    void feed.more()
  },

  more: () => { void feed?.more() },

  refresh: () => {
    feed?.close()
    feed = null
    set({ objects: [], loading: false, exhausted: false, started: false })
    get().start()
  },
}))
