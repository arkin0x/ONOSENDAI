/**
 * relay.ts — the relays this client talks to, and how.
 *
 * The set is user-configurable (see the relays store); cyberspace.nostr1.com is
 * the default and is always in it. A single pool, created on first use so a
 * page that never goes live never opens a socket, and shared by publishing,
 * lookups and subscriptions so they ride the same connections.
 *
 * Publishing reports a result rather than throwing, because the caller is a
 * queue that needs to know whether to move on or try again, and a relay that
 * is down is a normal condition, not an exception.
 */

import { SimplePool } from 'nostr-tools/pool'
import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from './events'
import { currentRelays, DEFAULT_RELAY } from '../store/useRelays'

/** The default relay, always present; kept here so panels can name it. */
export const CYBERSPACE_RELAY = DEFAULT_RELAY

/** How long a publish or a one-shot query waits before giving up. */
const MAX_WAIT_MS = 8000

let pool: SimplePool | null = null

export function getPool(): SimplePool {
  if (!pool) pool = new SimplePool()
  return pool
}

/** The relays every cyberspace read and write fans out across, right now. */
export function relaySet(): string[] {
  return currentRelays()
}

export type PublishResult = { ok: true } | { ok: false; reason: string }

/** Send to a set of relays; ok if any accepts, the last refusal otherwise. */
export async function publishMany(relays: string[], event: NostrEvent): Promise<PublishResult> {
  if (relays.length === 0) return { ok: false, reason: 'no relays configured' }
  const results = await Promise.allSettled(getPool().publish(relays, event, { maxWait: MAX_WAIT_MS }))
  if (results.some((r) => r.status === 'fulfilled')) return { ok: true }
  const reason = results.map((r) => (r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : '')).find(Boolean)
  return { ok: false, reason: reason || 'no relay accepted it' }
}

/** Send one event to every configured relay. */
export function publish(event: NostrEvent): Promise<PublishResult> {
  return publishMany(relaySet(), event)
}

/** One-shot query across the configured relays, merged, then close. */
export function query(filter: Filter): Promise<NostrEvent[]> {
  return getPool().querySync(relaySet(), filter, { maxWait: MAX_WAIT_MS })
}

/** The same against an explicit set, for the few things that live elsewhere
 * (contact lists). Results are the union; callers pick. */
export function queryAny(relays: string[], filter: Filter): Promise<NostrEvent[]> {
  return getPool().querySync(relays, filter, { maxWait: MAX_WAIT_MS })
}

/** A live subscription across the configured relays; the returned function closes it. */
export function subscribe(
  filter: Filter,
  onEvent: (ev: NostrEvent) => void,
  onEose?: () => void,
): () => void {
  const sub = getPool().subscribe(relaySet(), filter, {
    onevent: onEvent,
    oneose: onEose,
  })
  return () => sub.close()
}

/** Whether any configured relay is currently connected. */
export function connected(): boolean {
  const status = pool?.listConnectionStatus()
  if (!status) return false
  return relaySet().some((r) => status.get(r))
}
