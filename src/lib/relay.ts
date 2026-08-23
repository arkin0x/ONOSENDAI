/**
 * relay.ts — the one relay this client talks to, and how.
 *
 * cyberspace.nostr1.com is where the v2 chains live. A single pool, created on
 * first use so a page that never goes live never opens a socket, and shared by
 * publishing, chain lookups and subscriptions so they all ride one connection.
 *
 * Publishing reports a result rather than throwing, because the caller is a
 * queue that needs to know whether to move on or try again, and a relay that
 * is down is a normal condition, not an exception.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from './events'

export const CYBERSPACE_RELAY = 'wss://cyberspace.nostr1.com'

/**
 * Where encrypted shard content lives. The cyberspace relay only accepts the
 * movement kind, so location-encrypted kind:33330 events go to general relays
 * instead, which is spec-fine: §7.1 says the ciphertext is public and can sit
 * on any relay, since only the region key opens it. Several, so a deploy lands
 * even if one is unreachable, and a scan sees what any of them holds.
 */
export const SHARD_RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net']

/** How long a publish or a one-shot query waits before giving up. */
const MAX_WAIT_MS = 8000

let pool: SimplePool | null = null

export function getPool(): SimplePool {
  if (!pool) pool = new SimplePool()
  return pool
}

export type PublishResult = { ok: true } | { ok: false; reason: string }

/** Send one event and wait for the relay's OK, or its refusal. */
export async function publish(event: NostrEvent): Promise<PublishResult> {
  try {
    const [promise] = getPool().publish([CYBERSPACE_RELAY], event, { maxWait: MAX_WAIT_MS })
    await promise
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/** Send to several relays; ok if any accepts, the reason of the last refusal otherwise. */
export async function publishMany(relays: string[], event: NostrEvent): Promise<PublishResult> {
  const results = await Promise.allSettled(getPool().publish(relays, event, { maxWait: MAX_WAIT_MS }))
  if (results.some((r) => r.status === 'fulfilled')) return { ok: true }
  const reason = results.map((r) => (r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : '')).find(Boolean)
  return { ok: false, reason: reason || 'no relay accepted it' }
}

/** One-shot query: everything the relay has for the filter, then close. */
export function query(filter: Filter): Promise<NostrEvent[]> {
  return getPool().querySync([CYBERSPACE_RELAY], filter, { maxWait: MAX_WAIT_MS })
}

/**
 * The same against any set of relays, for the few things that do not live
 * here: contact lists, mostly. Results are the union; callers pick.
 */
export function queryAny(relays: string[], filter: Filter): Promise<NostrEvent[]> {
  return getPool().querySync(relays, filter, { maxWait: MAX_WAIT_MS })
}

/** A live subscription; the returned function closes it. */
export function subscribe(
  filter: Filter,
  onEvent: (ev: NostrEvent) => void,
  onEose?: () => void,
): () => void {
  const sub = getPool().subscribe([CYBERSPACE_RELAY], filter, {
    onevent: onEvent,
    oneose: onEose,
  })
  return () => sub.close()
}

/** Whether the socket to the relay is currently open. */
export function connected(): boolean {
  return pool?.listConnectionStatus().get(CYBERSPACE_RELAY) ?? false
}
