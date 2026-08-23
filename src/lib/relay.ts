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
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import type { NostrEvent } from './events'
import { currentRelays, DEFAULT_RELAY } from '../store/useRelays'
import { useCyberspace } from '../store/useCyberspace'

/** The default relay, always present; kept here so panels can name it. */
export const CYBERSPACE_RELAY = DEFAULT_RELAY

/** How long a publish or a one-shot query waits before giving up. */
const MAX_WAIT_MS = 8000

let pool: SimplePool | null = null

/**
 * Sign a relay's NIP-42 challenge with this identity's key, so a relay that
 * auth-gates can be told who we are. Needed to publish NIP-70 protected events
 * (our hidden content carries the `-` tag): only the authenticated author may
 * write them.
 */
function authSign(template: EventTemplate): Promise<VerifiedEvent> {
  return Promise.resolve(useCyberspace.getState().sign(template) as unknown as VerifiedEvent)
}

export function getPool(): SimplePool {
  if (!pool) {
    pool = new SimplePool()
    // Not in SimplePool's constructor options, but the abstract pool honours it:
    // when a relay proactively sends an AUTH challenge, authenticate with it.
    ;(pool as unknown as { automaticallyAuth?: () => typeof authSign }).automaticallyAuth = () => authSign
  }
  return pool
}

interface AuthRelay {
  challenge?: string
  auth(sign: typeof authSign): Promise<unknown>
}

/**
 * Make sure the connection is authenticated before a read or write.
 *
 * The relay now requires NIP-42 auth for everything, and answers an unauthed
 * REQ by closing it — the pool's read path does not retry that, so a query on
 * an unauthed socket comes back empty. So we open the relay, wait for its
 * challenge, and answer it up front. relay.auth caches its own promise per
 * challenge, so calling this before every operation costs nothing once done,
 * and re-auths on its own when a reconnect brings a fresh challenge.
 */
const authedFor = new Map<string, string>()
const noChallenge = new Set<string>()
async function authRelay(url: string): Promise<void> {
  // A relay that never challenged before will not now: skip the wait.
  if (noChallenge.has(url)) return
  try {
    const relay = (await getPool().ensureRelay(url)) as unknown as AuthRelay
    for (let i = 0; i < 10 && !relay.challenge; i++) await new Promise((r) => setTimeout(r, 40))
    if (relay.challenge) {
      if (authedFor.get(url) !== relay.challenge) {
        await relay.auth(authSign)
        authedFor.set(url, relay.challenge)
      }
    } else {
      noChallenge.add(url)
    }
  } catch { /* relay down, or does not require auth */ }
}

async function authAll(relays: string[]): Promise<void> {
  await Promise.allSettled(relays.map(authRelay))
}

/** The relays every cyberspace read and write fans out across, right now. */
export function relaySet(): string[] {
  return currentRelays()
}

export type PublishResult = { ok: true } | { ok: false; reason: string }

/** Send to a set of relays; ok if any accepts, the last refusal otherwise. */
export async function publishMany(relays: string[], event: NostrEvent): Promise<PublishResult> {
  if (relays.length === 0) return { ok: false, reason: 'no relays configured' }
  // Protected events (the `-` tag) are only accepted from an authenticated
  // author, and the relay does not challenge on the EVENT itself, so we must
  // already be authed before publishing.
  await authAll(relays)
  const results = await Promise.allSettled(getPool().publish(relays, event, { maxWait: MAX_WAIT_MS, onauth: authSign }))
  if (results.some((r) => r.status === 'fulfilled')) return { ok: true }
  const reason = results.map((r) => (r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : '')).find(Boolean)
  return { ok: false, reason: reason || 'no relay accepted it' }
}

/** Send one event to every configured relay. */
export function publish(event: NostrEvent): Promise<PublishResult> {
  return publishMany(relaySet(), event)
}

/**
 * One-shot query, merged across relays, then close.
 *
 * Via subscribeEose rather than querySync because only the former takes an
 * `onauth`: the relay now requires NIP-42 auth for reads, so a query has to be
 * able to answer the challenge and retry, or it comes back empty.
 */
async function collect(relays: string[], filter: Filter, maxWait = MAX_WAIT_MS): Promise<NostrEvent[]> {
  await authAll(relays)
  return new Promise((resolve) => {
    const events = new Map<string, NostrEvent>()
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { sub.close() } catch { /* already closed */ }
      resolve([...events.values()])
    }
    const timer = setTimeout(done, maxWait + 500)
    const sub = getPool().subscribeEose(relays, filter, {
      onevent: (e) => events.set(e.id, e),
      onclose: done,
      onauth: authSign,
      maxWait,
    })
  })
}

/** Query the configured relays. */
export function query(filter: Filter): Promise<NostrEvent[]> {
  return collect(relaySet(), filter)
}

/** Query an explicit set, for the few things that live elsewhere (contact lists). */
export function queryAny(relays: string[], filter: Filter, maxWait?: number): Promise<NostrEvent[]> {
  return collect(relays, filter, maxWait)
}

/** A live subscription across the configured relays; the returned function closes it. */
export function subscribe(
  filter: Filter,
  onEvent: (ev: NostrEvent) => void,
  onEose?: () => void,
): () => void {
  const relays = relaySet()
  let closed = false
  let sub: { close: () => void } | null = null
  // Authenticate first; a live subscription opened on an unauthed socket is
  // closed by the relay before it delivers anything.
  void authAll(relays).then(() => {
    if (closed) return
    sub = getPool().subscribe(relays, filter, { onevent: onEvent, oneose: onEose, onauth: authSign })
  })
  return () => { closed = true; sub?.close() }
}

/** Whether any configured relay is currently connected. */
export function connected(): boolean {
  const status = pool?.listConnectionStatus()
  if (!status) return false
  return relaySet().some((r) => status.get(r))
}
