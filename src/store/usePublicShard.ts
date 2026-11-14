/**
 * usePublicShard: the published shard whose card is open (arkinox,
 * 2026-11-14: "we should have a modal to view published SNO/shards and their
 * comments/reactions/metadata/author etc. It should basically be the same
 * modal as any shard you find hidden, but just have a PUBLIC tag").
 *
 * A published shard is a public kind 33331 object (lib/published.ts), seen in
 * the Shard Feed and in other apps' feeds; it is hidden nowhere, so it has no
 * place, no bag and no region. Its card is the hidden-thing card (SecretModal
 * ItemCard) given a world item made from the object (worldItemOfObject),
 * with the place-bound parts left out: no VIEW to fly to, no LOCAL / LIVE,
 * no DELETE, and its comments public (PublicComments), as the object is.
 */

import { create } from 'zustand'
import { FEED_RELAYS, SNO_KIND, objectFromEvent, type FeedObject } from 'sno-core/feed'
import type { Filter } from 'nostr-tools'
import type { WorldItem } from './useShards'
import { relaysFor } from '../lib/inbox'
import { queryAny } from '../lib/relay'
import { SHARD_NOT_FOUND, SHARD_SEALED, SHARD_UNREADABLE } from '../lib/notifications'

interface PublicShardState {
  object: FeedObject | null
  open: (object: FeedObject) => void
  close: () => void
}

export const usePublicShard = create<PublicShardState>((set) => ({
  object: null,
  open: (object) => set({ object }),
  close: () => set({ object: null }),
}))

/** The card's world item for a published object: a shard of no place, its target the public object (reactions answer it alone). */
export function worldItemOfObject(o: FeedObject, me: string): WorldItem {
  return {
    key: o.id,
    type: 'shard',
    at: { x: 0n, y: 0n, z: 0n },
    plane: 0,
    height: 0,
    mine: o.pubkey === me,
    author: o.pubkey,
    shard: o.shard,
    createdAt: o.createdAt,
    target: { kind: SNO_KIND, pubkey: o.pubkey, address: o.address, id: o.id, public: true },
    event: o.event as WorldItem['event'],
  }
}

/** The filter that asks for a published shard: the newest under its address, else the one id. */
export function shardFilter(at: { address?: string; id: string | null }): Filter | null {
  const parts = at.address?.split(':')
  if (parts && parts.length >= 3 && Number(parts[0]) === SNO_KIND) {
    return { kinds: [SNO_KIND], authors: [parts[1]], '#d': [parts.slice(2).join(':')], limit: 5 }
  }
  return at.id ? { ids: [at.id], limit: 1 } : null
}

/**
 * Read a published shard from the feed's relays, yours and its author's
 * inbox, and open its card. Resolves to why not, or null once it is open.
 */
export async function openPublishedShard(at: { address?: string; id: string | null }, me: string): Promise<string | null> {
  const filter = shardFilter(at)
  if (!filter) return SHARD_NOT_FOUND
  const author = at.address?.split(':')[1]
  let found: Awaited<ReturnType<typeof queryAny>> = []
  try {
    found = await queryAny([...new Set([...FEED_RELAYS, ...(await relaysFor([author || me]))])], filter)
  } catch { found = [] }
  const newest = [...found].filter((ev) => ev.kind === SNO_KIND).sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return SHARD_NOT_FOUND
  const object = objectFromEvent(newest)
  // Sealed to a place or for sale (an `encrypted` tag), or a payload this client cannot read.
  if (!object) return newest.tags.some((t) => t[0] === 'encrypted') ? SHARD_SEALED : SHARD_UNREADABLE
  usePublicShard.getState().open(object)
  return null
}
