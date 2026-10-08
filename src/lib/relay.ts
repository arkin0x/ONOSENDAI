/**
 * relay.ts — the relays this client talks to, and how.
 *
 * The set is user-configurable (see the relays store); the canonical relay
 * (useRelays DEFAULT_RELAY) is the default and is always in it. A single pool, created on first use so a
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

/** The canonical relay, always present: useRelays DEFAULT_RELAY itself, re-exported so the network code and the panels can name it. */
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
/**
 * Relays whose NIP-42 AUTH is waiting on the signer right now (normalized
 * URL to how many are). A remote signer can take seconds over that, and a
 * socket dropped meanwhile throws the AUTH away: the next socket brings a
 * new challenge and a second prompt (verification of #236, finding 4).
 */
const authSigning = new Map<string, number>()

/** Whether an AUTH for this relay is waiting on the signer. */
export function authPending(url: string): boolean {
  return authSigning.has(normalizeURL(url))
}

/** Every NIP-42 AUTH this client sends is signed here, so authPending knows what is in flight. */
function authSign(template: EventTemplate): Promise<VerifiedEvent> {
  const relayTag = template.tags.find((t) => t[0] === 'relay')?.[1]
  const key = relayTag ? normalizeURL(relayTag) : null
  if (key) authSigning.set(key, (authSigning.get(key) ?? 0) + 1)
  const signed = useCyberspace.getState().signEvent(template) as unknown as Promise<VerifiedEvent>
  return signed.finally(() => {
    if (!key) return
    const left = (authSigning.get(key) ?? 1) - 1
    if (left > 0) authSigning.set(key, left)
    else authSigning.delete(key)
  })
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

/** `accepted`, when known: the relays that took the event (normalized URLs). */
export type PublishResult = { ok: true; accepted?: string[] } | { ok: false; reason: string }

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

/** What nostr-tools resolves a publish with when the relay could not be reached. */
const CONNECTION_FAILURE = 'connection failure'

async function publishOnce(relays: string[], event: NostrEvent): Promise<PublishResult> {
  // Protected events (the `-` tag) are only accepted from an authenticated
  // author, and the relay does not challenge on the EVENT itself, so we must
  // already be authed before publishing.
  await authAll(relays)
  const results = await Promise.allSettled(getPool().publish(relays, event, { maxWait: MAX_WAIT_MS, onauth: authSign }))
  // nostr-tools does not reject when it cannot connect: that relay's promise
  // RESOLVES with the string "connection failure: ...". Counted as fulfilled,
  // an event sent while offline was marked published and never sent again,
  // and a LIVE chain read as on the relay when no relay had it.
  const failed = (r: PromiseSettledResult<string>): string | null =>
    r.status === 'rejected'
      ? String(r.reason?.message ?? r.reason)
      : String(r.value).startsWith(CONNECTION_FAILURE) ? String(r.value) : null
  const accepted = relays.filter((_, i) => results[i] !== undefined && failed(results[i]) === null).map((r) => normalizeURL(r))
  if (accepted.length > 0) return { ok: true, accepted }
  const reason = results.map(failed).find(Boolean)
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

/** How askOne times a question; without any, the answer is due by its deadline. */
interface AskOptions {
  /** The answer is due this long after the REQ is written, not by the deadline (verification of #236, finding 6). */
  answerMs?: number
  /** Called once the REQ is written. */
  onSent?: () => void
  /** Ends the question at once, as no answer in time, with whatever events came. */
  stop?: AbortSignal
  /** Handed every event the moment it lands, before the relay has finished answering. */
  onEvent?: (ev: NostrEvent) => void
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
async function askOne(url: string, filter: Filter, deadline: number, opts: AskOptions = {}): Promise<RelayAnswer> {
  const { answerMs, onSent, stop, onEvent } = opts
  const remaining = (): number => Math.max(0, deadline - Date.now())
  const late = (events: NostrEvent[] = []): RelayAnswer => ({ url, outcome: 'unreachable', reason: 'no answer in time', events })
  if (stop?.aborted) return late()
  let relay: AbstractRelay
  try {
    // With `answerMs` (a question timed from its REQ), a connect never gets
    // less than a second, however late a busy main thread let it start.
    relay = await getPool().ensureRelay(url, { connectionTimeout: Math.max(answerMs === undefined ? 1 : 1_000, remaining()) })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err ?? '')
    return { url, outcome: 'unreachable', reason: reason || 'connection failed', events: [] }
  }
  if (stop?.aborted) return late()
  return new Promise((resolve) => {
    const events = new Map<string, NostrEvent>()
    const got = (): NostrEvent[] => [...events.values()]
    let settled = false
    let sub: OpenSub | null = null
    let authTried = false
    const onStop = (): void => finish(late(got()))
    stop?.addEventListener('abort', onStop, { once: true })
    const finish = (answer: RelayAnswer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stop?.removeEventListener('abort', onStop)
      if (sub) {
        // close() does not clear nostr-tools' own EOSE timer; left running it
        // would hold this closure for the full ten minutes.
        clearTimeout(sub.eoseTimeoutHandle)
        try { sub.close() } catch { /* already closed */ }
      }
      resolve(answer)
    }
    // How long the relay has to answer. With `answerMs` it counts from the
    // moment the REQ is written, not from when the question was asked: a
    // main thread busy for seconds after a long chain loads (the tab drawing
    // it, the signatures checked) used to spend the whole budget before the
    // request had even gone out (verification of #236, finding 6).
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = (ms: number): void => { clearTimeout(timer); timer = setTimeout(() => finish(late(got())), ms) }
    if (answerMs === undefined) arm(remaining())
    const open = (): void => {
      try {
        sub = relay.subscribe([filter], {
          onevent: (e) => {
            if (settled || events.has(e.id)) return
            events.set(e.id, e as NostrEvent)
            onEvent?.(e as NostrEvent)
          },
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
        if (answerMs !== undefined && timer === undefined) arm(answerMs)
        onSent?.()
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

/**
 * The same, for an explicit set of relays: each asked and answered on its
 * own. For a read that must hear from one particular relay, such as the
 * canonical relay confirming a chain's head before a move is signed.
 */
export function queryEachAt(relays: string[], filter: Filter, maxWait = MAX_WAIT_MS): Promise<RelayAnswer[]> {
  return queryRelays(relays, filter, maxWait)
}

/**
 * Open one relay for a read that asks each relay on its own (sno-core/feed
 * `readEach`, the Shard Feed). False when it cannot be reached. Unlike
 * `queryRelays`, nothing waits on any other relay: one hung socket used to
 * hold every relay's question until it gave up (snocrash #22). The reader
 * bounds the wait (`connectMs`).
 */
export async function connectRelay(url: string): Promise<boolean> {
  try { await getPool().ensureRelay(url); return true } catch { return false }
}

/**
 * Answer an open relay's auth challenge for such a read, on the reader's own
 * auth allowance (`authMs`), not the connect's: an extension or a bunker may
 * be a person approving it, and the cyberspace relay gates reads.
 */
export function authForRead(url: string): Promise<void> {
  return authRelay(url)
}

/**
 * Subscribe to one relay for a feed read (sno-core/feed `Subscribe`). Events
 * are handed over as they land; EOSE and a close are reported as they come.
 * A CLOSED with auth-required: is answered with NIP-42 auth and asked once
 * more, as `askOne` does. nostr-tools' own EOSE timer is pushed far past any
 * deadline of ours (NOSTR_TOOLS_EOSE_MS), so "finished" always means the relay
 * said so.
 */
export function subscribeOne(url: string, filter: Filter, handlers: { onevent: (ev: NostrEvent) => void; oneose: () => void; onclose: (reason?: string) => void }): { close: () => void } {
  let closed = false
  let sub: OpenSub | null = null
  let authTried = false
  const open = (relay: AbstractRelay): void => {
    if (closed) return
    sub = relay.subscribe([filter], {
      onevent: (e) => { if (!closed) handlers.onevent(e as NostrEvent) },
      oneose: () => { if (!closed) handlers.oneose() },
      onclose: (reason) => {
        if (closed) return
        if (/^auth-required:/i.test(reason) && !authTried) {
          authTried = true
          relay.auth(authSign).then(() => open(relay), () => handlers.onclose(reason))
          return
        }
        handlers.onclose(reason)
      },
      eoseTimeout: NOSTR_TOOLS_EOSE_MS,
    }) as unknown as OpenSub
  }
  getPool().ensureRelay(url).then(open, () => { if (!closed) handlers.onclose('unreachable') })
  return {
    close: () => {
      if (closed) return
      closed = true
      if (sub) {
        clearTimeout(sub.eoseTimeoutHandle)
        try { sub.close() } catch { /* already closed */ }
      }
    },
  }
}

/**
 * Ask several relays at once, each on its own (its own connection, its own
 * auth, its own deadline), and settle as soon as the answers that matter are
 * in: when `primary` has answered and every relay of `waitFor` has answered
 * or given up, or `maxWait` after this question's first REQ went out with
 * `primary` answered, or when every relay has answered, or at `stop`,
 * whichever comes first. So once `primary` has answered, a relay of
 * `waitFor` costs at most `maxWait` from when the requests went out, however
 * slow its connection. The others are asked, and what they sent by then
 * counts, but nothing waits for them. A relay that has not answered by the
 * time this settles reads as unreachable ("no answer in time"). The others'
 * questions are left to end on their own timers, and an answer that comes
 * after is handed to `onLate`, so what it holds is not lost on the next
 * question; the questions of `waitFor` are closed.
 *
 * With `primary` not answering, every relay is waited for on its own timers,
 * as before: then nobody knows yet which answer will count. Without `stop`,
 * an outer backstop still ends the wait.
 */
export function queryEachSettled(
  relays: string[],
  filter: Filter,
  maxWait: number,
  primary: string,
  waitFor: string[],
  opts: { onSent?: () => void; stop?: AbortSignal; onLate?: (answer: RelayAnswer) => void } = {},
): Promise<RelayAnswer[]> {
  const urls = [...new Set(relays.map((r) => normalizeURL(r)))]
  const main = normalizeURL(primary)
  const held = new Set(waitFor.map((r) => normalizeURL(r)).filter((url) => urls.includes(url) && url !== main))
  const unanswered = (url: string): RelayAnswer => ({ url, outcome: 'unreachable', reason: 'no answer in time', events: [] })
  if (opts.stop?.aborted) return Promise.resolve(urls.map(unanswered))
  // `maxWait` to connect and authenticate, then `maxWait` from the moment
  // the REQ goes out (askOne answerMs).
  const deadline = Date.now() + maxWait
  const answers = new Map<string, RelayAnswer>()
  // Closes the questions of `waitFor` still open once this has settled.
  const done = new AbortController()
  let primaryAnswered = false
  // When this question's first REQ went out: the relays of `waitFor` are
  // waited for until `maxWait` after it, once `primary` has answered.
  let firstSent: number | undefined
  const onSent = (): void => { firstSent ??= Date.now(); opts.onSent?.() }
  let cap: ReturnType<typeof setTimeout> | undefined
  return new Promise((resolve) => {
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      clearTimeout(backstop)
      clearTimeout(cap)
      opts.stop?.removeEventListener('abort', settle)
      done.abort()
      resolve(urls.map((url) => answers.get(url) ?? unanswered(url)))
    }
    opts.stop?.addEventListener('abort', settle, { once: true })
    // Only an outer bound: every relay ends on its own timers (its connect,
    // then its answer, timed from its REQ), and a busy main thread before the
    // REQ must not spend this.
    const backstop = setTimeout(settle, 4 * maxWait + 50)
    const enough = (): boolean => answers.size === urls.length || (primaryAnswered && [...held].every((url) => answers.has(url)))
    for (const url of urls) {
      const left = (): number => Math.max(0, deadline - Date.now())
      const ask: AskOptions = held.has(url) ? { answerMs: maxWait, onSent, stop: done.signal } : { answerMs: maxWait, onSent }
      // Each relay authenticates inside its own time, so one that is slow to
      // connect or whose signer is slow to answer holds nobody else.
      void Promise.race([authRelay(url), new Promise<void>((r) => setTimeout(r, left()))])
        .then(() => askOne(url, filter, deadline, ask))
        .then((answer) => {
          if (settled) { opts.onLate?.(answer); return }
          answers.set(url, answer)
          if (url === main && answer.outcome === 'answered') {
            primaryAnswered = true
            cap = setTimeout(settle, Math.max(0, (firstSent ?? Date.now()) + maxWait - Date.now()))
          }
          if (enough()) settle()
        })
    }
  })
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

/**
 * Ask one relay on its own, handing over each event the moment it lands.
 * Its connection and its NIP-42 auth happen inside its own time, so a relay
 * that is slow to connect, or whose signer is slow to answer the challenge,
 * holds back no other relay: `query` authenticates every relay before asking
 * any of them, and resolves only when the slowest has answered, which is
 * what kept the Avatars list empty until the slowest relay's EOSE. `maxWait`
 * bounds the connect and auth, and then the answer, timed from the REQ
 * (askOne answerMs). With `skipDead`, a relay that refused a connection is
 * left alone for DEAD_MS, as queryAny does for the general relays.
 */
export async function askRelay(
  url: string,
  filter: Filter,
  onEvent: (ev: NostrEvent) => void,
  opts: { maxWait?: number; skipDead?: boolean } = {},
): Promise<RelayAnswer> {
  const maxWait = opts.maxWait ?? MAX_WAIT_MS
  const norm = normalizeURL(url)
  const deadline = Date.now() + maxWait
  const left = (): number => Math.max(0, deadline - Date.now())
  if (opts.skipDead) {
    if ((deadUntil.get(norm) ?? 0) > Date.now()) return { url: norm, outcome: 'unreachable', reason: 'recently unreachable', events: [] }
    try {
      await getPool().ensureRelay(norm, { connectionTimeout: Math.max(1_000, left()) })
    } catch (err) {
      deadUntil.set(norm, Date.now() + DEAD_MS)
      return { url: norm, outcome: 'unreachable', reason: err instanceof Error ? err.message : 'connection failed', events: [] }
    }
  }
  await Promise.race([authRelay(norm), new Promise<void>((r) => setTimeout(r, left()))])
  return askOne(norm, filter, deadline, { answerMs: maxWait, onEvent })
}

/** askRelay across a set, every relay at once and on its own; resolves when each has answered or given up. */
export function askEach(
  relays: string[],
  filter: Filter,
  onEvent: (ev: NostrEvent) => void,
  opts: { maxWait?: number; skipDead?: boolean } = {},
): Promise<RelayAnswer[]> {
  const urls = [...new Set(relays.map((r) => normalizeURL(r)))]
  return Promise.all(urls.map((url) => askRelay(url, filter, onEvent, opts)))
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
