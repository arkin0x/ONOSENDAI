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

/** One-shot query: everything the relay has for the filter, then close. */
export function query(filter: Filter): Promise<NostrEvent[]> {
  return getPool().querySync([CYBERSPACE_RELAY], filter, { maxWait: MAX_WAIT_MS })
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
