/**
 * contacts.ts — a pubkey's follows, from wherever kind 3 lives.
 *
 * The cyberspace relay holds movement; contact lists live on the general
 * relays, so those are asked too and the newest list wins. Pure parsing is
 * separate from the fetch so it can be tested without a socket.
 */

import { queryAny, relaySet } from './relay'
import type { NostrEvent } from './events'

/** Where kind 3 is most likely to be found. */
export const GENERAL_RELAYS = ['wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nos.lol']

export interface Contact {
  pubkey: string
  /** The petname from the p tag, when the list carries one. */
  name: string | null
}

/** NIP-02: `["p", <pubkey>, <relay>, <petname>]`, deduplicated, order kept. */
export function parseContacts(ev: NostrEvent): Contact[] {
  const seen = new Set<string>()
  const out: Contact[] = []
  for (const t of ev.tags) {
    if (t[0] !== 'p' || !/^[0-9a-f]{64}$/.test(t[1] ?? '') || seen.has(t[1])) continue
    seen.add(t[1])
    out.push({ pubkey: t[1], name: t[3]?.trim() ? t[3].trim() : null })
  }
  return out
}

/** The newest kind 3 for a pubkey across the general relays and ours. */
export async function fetchContacts(pubkey: string): Promise<Contact[]> {
  // The general relays and every configured one: the cyberspace relay and any you added.
  const events = await queryAny([...new Set([...GENERAL_RELAYS, ...relaySet()])], { kinds: [3], authors: [pubkey] })
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
  return newest ? parseContacts(newest) : []
}

/** Each pubkey's follows, read once per session (WALK's walls, store/walkWalls.ts). */
const followsRead = new Map<string, Promise<string[]>>()

/**
 * The pubkeys `pubkey` follows, from its newest kind 3, read once per session;
 * a read that failed is not kept, so the next asks again.
 */
export function followsOf(pubkey: string): Promise<string[]> {
  let got = followsRead.get(pubkey)
  if (!got) {
    got = fetchContacts(pubkey).then((list) => list.map((c) => c.pubkey))
    followsRead.set(pubkey, got)
    void got.catch(() => { if (followsRead.get(pubkey) === got) followsRead.delete(pubkey) })
  }
  return got
}
