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
import { askEach, publishMany, queryAny, relaySet, type PublishResult } from './relay'

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

/**
 * NIP-17's DM inbox: kind 10050, `["relay", <url>]` tags naming where a
 * person reads their private messages (arkinox, 2026-10-10, operator and
 * agent DMs). A gift wrap goes to the recipient's 10050 relays and the
 * sender's self-copy to the sender's own. A person who publishes none has
 * no DM inbox, and nothing is sent to them: the read relays above are not a
 * stand-in, since NIP-17 says to send only where the recipient asked.
 */
export const DM_RELAYS_KIND = 10050

/** The relays a kind 10050 names, secure sockets only, normalized and deduplicated, in the order listed. */
export function dmRelaysOf(ev: Pick<NostrEvent, 'tags'> | null | undefined): string[] {
  if (!ev) return []
  const out: string[] = []
  for (const t of ev.tags) {
    if (t[0] !== 'relay' || !t[1]) continue
    const url = t[1].trim().replace(/\/+$/, '')
    if (/^wss:\/\/[^\s/]+/.test(url) && !out.includes(url)) out.push(url)
  }
  return out.slice(0, MAX_INBOX)
}

/**
 * Someone's DM inbox as found: the relays, or none, or unknown. `answered`
 * is false when no relay answered at all, so "no DM inbox" is said only
 * when a relay said so, never because every relay was down.
 */
export interface DmInbox { relays: string[]; answered: boolean }

/** How long a 10050 lookup waits; profiles and lists answer in this on the general relays. */
const DM_INBOX_WAIT_MS = 5000

/**
 * A person's kind 10050, newest by created_at, asked of the general relays,
 * the configured ones, and any `extra` (the operator's own DM relays, where
 * an agent that copies them may have published too). Not cached: an inbox
 * published during the session should be seen when the conversation opens
 * again.
 */
export async function dmInboxOf(pubkey: string, extra: readonly string[] = []): Promise<DmInbox> {
  const heard: NostrEvent[] = []
  const relays = [...new Set([...GENERAL_RELAYS, ...relaySet(), ...extra])]
  const answers = await askEach(relays, { kinds: [DM_RELAYS_KIND], authors: [pubkey], limit: 1 }, (ev) => { heard.push(ev) }, { maxWait: DM_INBOX_WAIT_MS, skipDead: true })
  const newest = heard
    .filter((ev) => ev.kind === DM_RELAYS_KIND && ev.pubkey === pubkey)
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0]
  return { relays: dmRelaysOf(newest), answered: answers.some((a) => a.outcome === 'answered') }
}
