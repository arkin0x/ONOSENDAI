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

import { AbstractSimplePool } from 'nostr-tools/abstract-pool'
import type { AbstractRelay } from 'nostr-tools/abstract-relay'
import { verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import type { NostrEvent } from './events'
import { currentRelays, DEFAULT_RELAY } from '../store/useRelays'
import { LiveRegistry, type Transport } from './liveSub'
import { classifyClose, mergeAnswers, type RelayAnswer } from './relayOutcome'
import { normalizeURL } from 'nostr-tools/utils'
import { useCyberspace } from '../store/useCyberspace'

/** The default relay, always present; kept here so panels can name it. */
export const CYBERSPACE_RELAY = DEFAULT_RELAY

/** How long a publish or a one-shot query waits before giving up. */
const MAX_WAIT_MS = 8000

let pool: AbstractSimplePool | null = null

/**
 * Sign a relay's NIP-42 challenge with this identity's key, so a relay that
 * auth-gates can be told who we are. Needed to publish NIP-70 protected events
 * (our hidden content carries the `-` tag): only the authenticated author may
 * write them.
 */
function authSign(template: EventTemplate): Promise<VerifiedEvent> {
  return useCyberspace.getState().signEvent(template) as unknown as Promise<VerifiedEvent>
}

export function getPool(): AbstractSimplePool {
  if (!pool) {
    // Signature checks run synchronously per arriving event, on the main
    // thread, inside the pool. For the kind-321 anchor backfill that is a
    // million schnorr verifications sprayed through the session as ~1 ms
    // tasks: precisely the grain that makes an idle page judder (input
    // gestures defer timer work, which is why dragging looked smooth).
    // 321 has no publisher allowlist yet, so the signature proves nothing an
    // attacker could not sign themselves; skip it there, verify everything
    // else as before. (A publisher allowlist for anchors is the follow-up
    // that would make relay-sourced stops authenticated at all.)
    pool = new AbstractSimplePool({
      verifyEvent: (ev) => (ev.kind === 321 ? true : verifyEvent(ev)),
      // SimplePool's own default (3e3), restated because the abstract
      // constructor requires the field.
      maxWaitForConnection: 3000,
      // A ping every 29 seconds, and a socket that misses its pong for 20 is
      // declared dead. Without it a socket a NAT or a suspended phone has
      // forgotten stays "open" forever, delivering nothing: the "already in
      // CLOSING or CLOSED state" lines in the console were writes to exactly
      // that. A declared death closes the subscriptions on it, and the live
      // registry below reopens them.
      enablePing: true,
      // Not the pool's own reconnect: it refires REQs the instant the socket
      // opens, before the relay's fresh NIP-42 challenge is answered, and the
      // relay auth-gates reads. The registry authenticates first, then asks.
      enableReconnect: false,
    })
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

/** A relay's own refusal (NIP-01 OK false prefixes): asking again would get the same answer. */
const REFUSED = /^(blocked|invalid|duplicate|pow|rate-limited|restricted|error)\b/i

/**
 * Drop the sockets to these relays so the next operation opens fresh ones.
 * A phone that was in another app (a wallet, a signer) comes back with its
 * sockets half-open: nothing arrives on them and a publish waits its whole
 * maxWait for an OK that never comes. Also forgets their auth, since a new
 * connection brings a new challenge.
 */
export function dropRelays(relays: string[]): void {
  try { getPool().close(relays) } catch { /* nothing open */ }
  for (const url of relays) authedFor.delete(url)
}

async function publishOnce(relays: string[], event: NostrEvent): Promise<PublishResult> {
  // Protected events (the `-` tag) are only accepted from an authenticated
  // author, and the relay does not challenge on the EVENT itself, so we must
  // already be authed before publishing.
  await authAll(relays)
  const results = await Promise.allSettled(getPool().publish(relays, event, { maxWait: MAX_WAIT_MS, onauth: authSign }))
  if (results.some((r) => r.status === 'fulfilled')) return { ok: true }
  const reason = results.map((r) => (r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : '')).find(Boolean)
  return { ok: false, reason: reason || 'no relay accepted it' }
}

/**
 * Send to a set of relays; ok if any accepts, the last refusal otherwise. When
 * every relay failed for a reason that is not a refusal (a timeout, a closed
 * socket), the sockets are presumed dead: they are dropped and the event is
 * sent once more over fresh ones.
 */
export async function publishMany(relays: string[], event: NostrEvent): Promise<PublishResult> {
  if (relays.length === 0) return { ok: false, reason: 'no relays configured' }
  const first = await publishOnce(relays, event)
  if (first.ok || REFUSED.test(first.reason)) return first
  dropRelays(relays)
  return publishOnce(relays, event)
}

/** Send one event to every configured relay. */
export function publish(event: NostrEvent): Promise<PublishResult> {
  return publishMany(relaySet(), event)
}

/**
 * What nostr-tools is told to wait for an EOSE: far longer than any deadline
 * of ours. Its own EOSE timer calls the same handler a real EOSE does, so if
 * it could fire inside our deadline a relay that never answered would read
 * as a relay that answered "nothing" (relayOutcome.ts). With this it never
 * fires while we are listening, and our own timer decides "no answer".
 */
const NOSTR_TOOLS_EOSE_MS = 10 * 60_000

/** The fields of a nostr-tools Subscription this file touches; the timer is private in its types. */
interface OpenSub {
  close(reason?: string): void
  eoseTimeoutHandle?: ReturnType<typeof setTimeout>
}

/**
 * Ask one relay, and say which of the three things happened (relayOutcome.ts).
 *
 * Straight on the relay rather than through the pool's subscribe, because the
 * pool merges every relay into one EOSE and one close, and the whole point is
 * to know what each relay said. The pool's one kindness is kept: a CLOSED
 * with auth-required: is answered with NIP-42 auth and asked once more, since
 * the relay auth-gates reads and a fresh socket's first REQ can beat the
 * challenge.
 */
async function askOne(url: string, filter: Filter, deadline: number): Promise<RelayAnswer> {
  const remaining = (): number => Math.max(0, deadline - Date.now())
  let relay: AbstractRelay
  try {
    relay = await getPool().ensureRelay(url, { connectionTimeout: Math.max(1, remaining()) })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err ?? '')
    return { url, outcome: 'unreachable', reason: reason || 'connection failed', events: [] }
  }
  return new Promise((resolve) => {
    const events = new Map<string, NostrEvent>()
    const got = (): NostrEvent[] => [...events.values()]
    let settled = false
    let sub: OpenSub | null = null
    let authTried = false
    const finish = (answer: RelayAnswer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (sub) {
        // close() does not clear nostr-tools' own EOSE timer; left running it
        // would hold this closure for the full ten minutes.
        clearTimeout(sub.eoseTimeoutHandle)
        try { sub.close() } catch { /* already closed */ }
      }
      resolve(answer)
    }
    const timer = setTimeout(() => finish({ url, outcome: 'unreachable', reason: 'no answer in time', events: got() }), remaining())
    const open = (): void => {
      try {
        sub = relay.subscribe([filter], {
          onevent: (e) => { events.set(e.id, e as NostrEvent) },
          oneose: () => finish({ url, outcome: 'answered', events: got() }),
          onclose: (reason) => {
            if (settled) return
            if (/^auth-required:/i.test(reason) && !authTried) {
              authTried = true
              relay.auth(authSign).then(
                () => { if (!settled) open() },
                (err) => finish({ url, outcome: 'refused', reason: `auth-required: ${err instanceof Error ? err.message : String(err)}`, events: got() }),
              )
              return
            }
            finish(classifyClose(url, reason, got()))
          },
          eoseTimeout: NOSTR_TOOLS_EOSE_MS,
        }) as unknown as OpenSub
      } catch (err) {
        finish({ url, outcome: 'unreachable', reason: err instanceof Error ? err.message : String(err), events: got() })
      }
    }
    open()
  })
}

/**
 * One-shot query, each relay asked and answered on its own, then closed.
 *
 * Authenticates first, as every read here does: the relay requires NIP-42
 * auth for reads, and an unauthed REQ is closed before it is answered. The
 * deadline is ours and is the only timer that ends a wait (see
 * NOSTR_TOOLS_EOSE_MS).
 */
async function queryRelays(relays: string[], filter: Filter, maxWait = MAX_WAIT_MS): Promise<RelayAnswer[]> {
  const urls = [...new Set(relays.map((r) => normalizeURL(r)))]
  await authAll(urls)
  const deadline = Date.now() + maxWait
  return Promise.all(urls.map((url) => askOne(url, filter, deadline)))
}

/**
 * One-shot query, merged across relays. The callers want the events and treat
 * an empty list as "nothing found", as before; what changed underneath is
 * only that a relay that never answered is no longer told apart from one that
 * did by a timer inside nostr-tools, but by our deadline. The events a slow
 * relay sent before the deadline still count.
 */
async function collect(relays: string[], filter: Filter, maxWait = MAX_WAIT_MS): Promise<NostrEvent[]> {
  return mergeAnswers(await queryRelays(relays, filter, maxWait))
}

/** Query the configured relays. */
export function query(filter: Filter): Promise<NostrEvent[]> {
  return collect(relaySet(), filter)
}

/**
 * Query the configured relays and keep each relay's answer: answered, refused
 * or unreachable (relayOutcome.ts). For the reads where "nothing" and "no
 * answer" lead to different actions.
 */
export function queryEach(filter: Filter, maxWait = MAX_WAIT_MS): Promise<RelayAnswer[]> {
  return queryRelays(relaySet(), filter, maxWait)
}

/** How long a general relay that refused a connection is left alone. */
const DEAD_MS = 5 * 60_000
const deadUntil = new Map<string, number>()

/**
 * The relays in `relays` that will take a connection now. One that refuses is
 * skipped for DEAD_MS: every profile and contact lookup used to knock on it
 * again, and a relay that is down turned each lookup into a failed socket in
 * the console and a 3 s wait for nothing.
 */
async function reachable(relays: string[]): Promise<string[]> {
  const now = Date.now()
  const out: string[] = []
  await Promise.all(relays.map(async (url) => {
    if ((deadUntil.get(url) ?? 0) > now) return
    try { await getPool().ensureRelay(url); out.push(url) } catch { deadUntil.set(url, now + DEAD_MS) }
  }))
  return out
}

/** Query an explicit set, for the few things that live elsewhere (profiles, contact lists). */
export async function queryAny(relays: string[], filter: Filter, maxWait?: number): Promise<NostrEvent[]> {
  const up = await reachable(relays)
  return up.length ? collect(up, filter, maxWait) : []
}

/** A live subscription across the configured relays; the returned function closes it. */
/**
 * The transport under the live registry: authenticate, then ask, and report
 * the relay ending the subscription so the registry can ask again.
 */
const liveTransport: Transport = {
  open: async (filter, handlers, onClose) => {
    const relays = relaySet()
    // Authenticate first; a live subscription opened on an unauthed socket is
    // closed by the relay before it delivers anything.
    await authAll(relays)
    const sub = getPool().subscribe(relays, filter, {
      onevent: handlers.onEvent,
      oneose: handlers.onEose,
      onauth: authSign,
      // Fires once every relay in the set has ended it: for the one relay we
      // run on, once, and that is the socket dying under us.
      onclose: (reasons) => onClose(reasons.map((r) => r.reason).join('; ')),
    })
    return () => sub.close()
  },
}

const live = new LiveRegistry(liveTransport)

/**
 * A live subscription that stays open for the life of its closer: reissued
 * after any close the relay makes, and on demand when the tab comes back.
 */
export function subscribe(
  filter: Filter,
  onEvent: (ev: NostrEvent) => void,
  onEose?: () => void,
): () => void {
  return live.subscribe(filter, { onEvent, onEose })
}

/**
 * Back from the background: every socket may be half-open, which looks
 * connected and delivers nothing. Drop them and reissue every live
 * subscription over fresh ones. Cheap, and only worth it after a real absence:
 * an alt-tab on a desktop is not an absence, so the caller says how long.
 */
export function resumeLive(): void {
  live.resumeAll(() => dropRelays(relaySet()))
  for (const fn of resumeListeners) {
    try { fn() } catch { /* one listener's failure is not the others' */ }
  }
}

const resumeListeners = new Set<() => void>()

/**
 * Be told whenever the connection is reissued: the network came back, the
 * tab returned from a real absence, or a probe found the socket dead. Self
 * sync uses it to ask again whether this identity has a chain, when the last
 * answer was "could not tell". Returns the unsubscribe.
 */
export function onResume(fn: () => void): () => void {
  resumeListeners.add(fn)
  return () => { resumeListeners.delete(fn) }
}

/** How long the tab must have been hidden before its return reissues the feeds. */
export const RESUME_AFTER_HIDDEN_MS = 15_000
/** How often the connection is asked whether it is really there. */
export const PROBE_EVERY_MS = 20_000
/** How long a probe waits for the relay's answer before calling the socket dead. */
export const PROBE_TIMEOUT_MS = 8_000
/** An id no event has: the probe wants only the relay's EOSE, never an event. */
const NO_SUCH_ID = '0'.repeat(64)

let hiddenAt: number | null = null
let probing = false

/**
 * Ask the relay for nothing and see whether it says so.
 *
 * A half-open socket is the case nothing else catches: the pool believes it
 * is connected, the browser's WebSocket reports open, and every write goes
 * into the void. The pool's own ping notices that and calls close(), but a
 * close on a half-open socket waits for a close handshake that never comes,
 * so the pool never learns the socket is dead and never ends the
 * subscriptions on it. This does not wait for the socket to admit anything:
 * a probe the relay does not answer in time is a dead connection, and the
 * feeds are reissued over fresh sockets. Only run while the pool thinks it
 * is connected; a connection the pool already knows is down is the registry's
 * own backoff path, and probing it would only reset that backoff.
 */
export async function probeLiveness(): Promise<'alive' | 'dead' | 'skipped'> {
  if (probing || live.list().length === 0 || !connected()) return 'skipped'
  probing = true
  try {
    const relays = relaySet()
    const answered = await new Promise<boolean>((resolve) => {
      let settled = false
      const done = (ok: boolean): void => { if (!settled) { settled = true; resolve(ok) } }
      const timer = setTimeout(() => done(false), PROBE_TIMEOUT_MS)
      const sub = getPool().subscribe(relays, { ids: [NO_SUCH_ID] }, {
        onevent: () => {},
        oneose: () => { clearTimeout(timer); done(true); sub.close() },
        onclose: () => { clearTimeout(timer); done(false) },
        onauth: authSign,
        maxWait: PROBE_TIMEOUT_MS,
      })
    })
    if (answered) return 'alive'
    resumeLive()
    return 'dead'
  } finally {
    probing = false
  }
}

/**
 * Watch the tab's visibility and the network, and keep asking the connection
 * whether it is there; resume the feeds when any of them says it is not.
 */
export function watchConnectivity(): () => void {
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
    if (hiddenAt !== null && Date.now() - hiddenAt >= RESUME_AFTER_HIDDEN_MS) resumeLive()
    hiddenAt = null
  }
  const onOnline = (): void => resumeLive()
  // Not while hidden: a background tab's timers are throttled anyway, and the
  // return is handled above.
  const tick = (): void => { if (document.visibilityState === 'visible') void probeLiveness() }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('online', onOnline)
  const interval = setInterval(tick, PROBE_EVERY_MS)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    clearInterval(interval)
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __live: LiveRegistry; __pool: () => AbstractSimplePool; __resumeLive: () => void }).__live = live
  ;(window as unknown as { __pool: () => AbstractSimplePool }).__pool = getPool
  ;(window as unknown as { __resumeLive: () => void }).__resumeLive = resumeLive
  ;(window as unknown as { __probeLiveness: () => Promise<string> }).__probeLiveness = probeLiveness
}

/**
 * Whether any configured relay is currently connected, as far as the pool
 * knows. The pool files relays under normalized URLs (a trailing slash on a
 * bare host), so the lookup normalizes too; compared raw, this was never true.
 */
export function connected(): boolean {
  const status = pool?.listConnectionStatus()
  if (!status) return false
  return relaySet().some((r) => status.get(normalizeURL(r)))
}
