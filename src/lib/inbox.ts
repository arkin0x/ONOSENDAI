/**
 * inbox.ts: where to reach a person, by their NIP-65 relay list.
 *
 * A reaction or comment is for its recipient, and a recipient on another
 * client reads their notifications from the relays they list for reading
 * (kind 10002 `r` tags marked `read`, or unmarked). So social events go to
 * this app's relays AND the recipient's read relays (arkinox, 2026-09-28, R4),
 * and reactions to someone's action are read back from the same union, which
 * is where other clients will have sent theirs.
 */

import { GENERAL_RELAYS } from './contacts'
import type { NostrEvent } from './events'
import { publishMany, queryAny, relaySet, type PublishResult } from './relay'

export const RELAY_LIST_KIND = 10002
/** How many of someone's relays are used: enough to reach them, not a fan-out to everything they list. */
const MAX_INBOX = 4

/** The read relays a kind 10002 names, secure sockets only, in the order listed. */
export function readRelaysOf(ev: Pick<NostrEvent, 'tags'> | null | undefined): string[] {
  if (!ev) return []
  const out: string[] = []
  for (const t of ev.tags) {
    if (t[0] !== 'r' || !t[1] || (t[2] && t[2] !== 'read')) continue
    const url = t[1].trim().replace(/\/+$/, '')
    if (/^wss:\/\/[^\s/]+/.test(url) && !out.includes(url)) out.push(url)
  }
  return out.slice(0, MAX_INBOX)
}

const cache = new Map<string, Promise<string[]>>()

/** A person's read relays, looked up once per session. None when they publish no list. */
export function inboxOf(pubkey: string): Promise<string[]> {
  let found = cache.get(pubkey)
  if (!found) {
    found = queryAny([...new Set([...GENERAL_RELAYS, ...relaySet()])], { kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 1 })
      .then((evs) => readRelaysOf(evs.sort((a, b) => b.created_at - a.created_at)[0]))
      .catch(() => [])
    cache.set(pubkey, found)
  }
  return found
}

/** This app's relays plus every recipient's read relays. */
export async function relaysFor(recipients: string[]): Promise<string[]> {
  const inboxes = await Promise.all([...new Set(recipients)].map(inboxOf))
  return [...new Set([...relaySet(), ...inboxes.flat()])]
}

/** Publish a social event where its recipients will see it. */
export async function publishTo(event: NostrEvent, recipients: string[]): Promise<PublishResult> {
  return publishMany(await relaysFor(recipients), event)
}
