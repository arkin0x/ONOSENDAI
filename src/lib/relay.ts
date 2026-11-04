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
import { deferCheck, verifyOnce, verifyUnlessDeferred } from './verifiedSigs'
import { answerChecks } from './sigCheck'
import type { Filter } from 'nostr-tools/filter'
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import type { NostrEvent } from './events'
import { currentRelays, DEFAULT_RELAY, isRetiredRelay } from '../store/useRelays'
import { LiveRegistry, type Transport } from './liveSub'
import { classifyClose, mergeAnswers, type RelayAnswer } from './relayOutcome'
import { normalizeURL } from 'nostr-tools/utils'
import { useCyberspace } from '../store/useCyberspace'
import { onSignerAnswered } from './signWithin'

/** The canonical relay, always present: useRelays DEFAULT_RELAY itself, re-exported so the network code and the panels can name it. */
export const CYBERSPACE_RELAY = DEFAULT_RELAY

/** How long a publish or a one-shot query waits before giving up. */
const MAX_WAIT_MS = 8000

/**
 * How long a connection to a player's relay may take when its caller names no
 * time of its own. nostr-tools sets no timer on a connect without a timeout,
 * and every caller on a socket shares the first caller's connect, so one untimed
 * connect to a relay that accepts and never answers took the time limit from
 * all of them: a publish or a read then waited as long as the socket did. The
 * canonical relay gets MAX_WAIT_MS, because it has taken 4.6 s to connect.
 */
const CONNECT_MS = 5000
/** How many full timeouts in a row, with no answer between them, make a relay hung. */
const HUNG_AFTER = 2
/** How long a hung relay is left alone by the paths that skip it. */
const HUNG_MS = 5 * 60_000
const HUNG_REASON = 'relay hung, left alone for now'
/** Relays that hung (normalized URL to when they may be asked again). */
const hungUntil = new Map<string, number>()
/** Full timeouts in a row, per relay. */
const timeoutsInARow = new Map<string, number>()
/** When each relay's last full timeout was counted. */
const lastTimeoutAt = new Map<string, number>()

/** A full wait ran out. One says little, since a slow relay misses an OK now and then; two in a row is a relay that hung. */
function noteTimeout(url: string): void {
  const norm = normalizeURL(url)
  // Never the canonical relay: it is where everyone meets, so it is always asked.
  if (norm === normalizeURL(CYBERSPACE_RELAY)) return
  // Callers sharing one connect or one AUTH all hear the same rejection: that is one wait.
  const now = Date.now()
  if (now - (lastTimeoutAt.get(norm) ?? -Infinity) < 1000) return
  lastTimeoutAt.set(norm, now)
  const count = (timeoutsInARow.get(norm) ?? 0) + 1
  timeoutsInARow.set(norm, count)
  if (count >= HUNG_AFTER) hungUntil.set(norm, now + HUNG_MS)
}

/** The relay answered: it is not hung, whatever it did before. */
function noteAnswered(url: string): void {
  const norm = normalizeURL(url)
  timeoutsInARow.delete(norm)
  hungUntil.delete(norm)
}

/** What timed out may have been this device, not the relay. */
function forgetHung(): void {
  hungUntil.clear()
  timeoutsInARow.clear()
  lastTimeoutAt.clear()
}

function isHung(url: string): boolean {
  try { return (hungUntil.get(normalizeURL(url)) ?? 0) > Date.now() } catch { return false }
}

/**
 * These relays, without the hung ones: for publishing and for reads that can do
 * without a relay. Never for reading a chain. A relay that hung can come back
 * holding another device's newer move, and a head confirmed without it signs a
 * fork, so chain reads ask it anyway (evenHung, and queryEachSettled) and a hung
 * holder costs a move at most HEAD_CONFIRM_MS (arkinox's ruling of 2026-10-08).
 */
function skipHung(urls: string[]): string[] {
  return urls.filter((url) => !isHung(url))
}

const pingsCounted = new WeakSet<object>()

/**
 * nostr-tools (2.24.1) does not count its keep-alive ping's subscription as
 * an ongoing operation when it opens, but takes one away when it closes. So
 * every ping, each 29 s, took the count of a real subscription, and once the
 * count reached zero the pool closed the socket as idle 20 s later, with live
 * subscriptions on it. On the canonical relay every new socket is a new
 * NIP-42 AUTH, one more request to a bunker; on a bunker's relay the
 * subscription its answers arrive on was gone, so an answer slower than about
 * 50 s was lost (found reproducing the HIDDEN BAGS report, 2026-11-04).
 * Counting the ping as it opens balances its close.
 */
function countPings(relay: AbstractRelay): void {
  if (pingsCounted.has(relay)) return
  pingsCounted.add(relay)
  const r = relay as unknown as { subscribe: AbstractRelay['subscribe']; ongoingOperations: number }
  const subscribe = r.subscribe.bind(relay)
  r.subscribe = (filters, params) => {
    if (params.label === '<forced-ping>') r.ongoingOperations++
    return subscribe(filters, params)
  }
}

/** Every connection comes through ensureRelay, publishing and live subscriptions included. */
class Pool extends AbstractSimplePool {
  override async ensureRelay(...[url, params]: Parameters<AbstractSimplePool['ensureRelay']>): ReturnType<AbstractSimplePool['ensureRelay']> {
    if (isRetiredRelay(url)) throw new Error('retired relay, not dialed')
    const norm = normalizeURL(url)
    const started = Date.now()
    const pending = super.ensureRelay(url, { ...params, connectionTimeout: params?.connectionTimeout ?? (norm === normalizeURL(CYBERSPACE_RELAY) ? MAX_WAIT_MS : CONNECT_MS) })
    // Registered before the connect's first await, and gone from the pool by the time it fails.
    const relay = this.relays?.get(norm)
    if (relay) countPings(relay)
    try {
      return await pending
    } catch (err) {
      if (/timed out/.test(String(err))) {
        // nostr-tools detaches its handlers from a socket that timed out and never closes it.
        try { (relay as unknown as { ws?: WebSocket } | undefined)?.ws?.close() } catch { /* already gone */ }
        // Only a full wait counts: a caller's short question may run out on a healthy relay.
        if (Date.now() - started >= CONNECT_MS) noteTimeout(url)
      }
      throw err
    }
  }
}

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

/**
 * Waiters on an AUTH being signed, by relay and challenge: told when its
 * signature fails. nostr-tools logs a failed signature and never settles the
 * AUTH's promise, which it keeps for the socket's life, so without this every
 * read waiting on it waited for good, and every later AUTH on that socket was
 * the same dead promise (verification of the HIDDEN BAGS report, 2026-11-04).
 */
const signFailed = new Map<string, Set<(err: unknown) => void>>()
/** The challenge whose AUTH failed, per socket (unsigned, refused, or no OK): its promise is dead and is not waited on again. */
const deadAuth = new WeakMap<object, string>()
/**
 * Why each relay's last AUTH failed (normalized URL), and whether the signer
 * was the cause (it refused, or did not answer). Gone once one succeeds.
 */
const authFailed = new Map<string, { reason: string; bySigner: boolean }>()

/** The challenge each relay's socket was last signed in with (normalized URL). */
const authedFor = new Map<string, string>()
/** Relays that sent no challenge in time on their first socket: not waited for again. */
const noChallenge = new Set<string>()

/**
 * Keep a socket open while its AUTH is signed. Every REQ on it was closed
 * with auth-required, so nothing is in flight, and the pool closes a socket
 * idle for 20 s: a bunker slower than that signed an AUTH there was then no
 * socket to send on, and the next socket asked it again. Counted as one of
 * nostr-tools' ongoing operations, so its own idle close picks up after.
 */
function holdOpen(relay: AuthRelay | undefined): () => void {
  const r = relay as unknown as { ongoingOperations?: number; clearIdleTimeout?: () => void; scheduleIdleClose?: () => void } | undefined
  if (!r || typeof r.ongoingOperations !== 'number') return () => {}
  r.ongoingOperations++
  r.clearIdleTimeout?.()
  let held = true
  return () => {
    if (!held) return
    held = false
    r.ongoingOperations = Math.max(0, (r.ongoingOperations ?? 1) - 1)
    if (r.ongoingOperations === 0) r.scheduleIdleClose?.()
  }
}

/** How long a socket is kept open after its AUTH gave up on the signer, for a late answer to sign in with. */
const LATE_AUTH_HOLD_MS = 5 * 60_000

/** The pool's socket to this relay (normalized URL), if it has one. */
function socketOf(url: string): AuthRelay | undefined {
  return (pool as unknown as { relays?: Map<string, AuthRelay> } | null)?.relays?.get(url)
}

const authKey = (url: string, challenge: string): string => `${url} ${challenge}`
const tagOf = (template: EventTemplate, name: string): string | undefined => template.tags.find((t) => t[0] === name)?.[1]

/**
 * Every NIP-42 AUTH this client sends is signed here, so authPending knows
 * what is in flight. A remote signer's answer that comes after the store's
 * time limit is still taken (the owner's rule for handshakes, 2026-11-01:
 * the limit is on each wait, not on the signer): sooner, if this AUTH is
 * still waiting, or else by signing in with it then (signInLate).
 */
function authSign(template: EventTemplate): Promise<VerifiedEvent> {
  const relayTag = tagOf(template, 'relay')
  const key = relayTag ? normalizeURL(relayTag) : null
  const challenge = tagOf(template, 'challenge') ?? ''
  if (key) authSigning.set(key, (authSigning.get(key) ?? 0) + 1)
  const release = key ? holdOpen(socketOf(key)) : () => {}
  let settled = false
  const signed = new Promise<VerifiedEvent>((resolve, reject) => {
    const late = (ev: NostrEvent): void => {
      if (!settled) { settled = true; resolve(ev as unknown as VerifiedEvent); return }
      if (key) void signInLate(key, challenge, ev).finally(release)
    }
    useCyberspace.getState().signEvent(template, undefined, late).then(
      (ev) => { if (!settled) { settled = true; resolve(ev as unknown as VerifiedEvent) } },
      (err: unknown) => { if (!settled) { settled = true; reject(err) } },
    )
  })
  let settledInTime = false
  return signed.then((ev) => { settledInTime = true; return ev }, (err: unknown) => {
    if (key) {
      const relay = socketOf(key)
      if (relay && relay.challenge === challenge) deadAuth.set(relay, challenge)
      // A socket since replaced has its own AUTH: this one's failure is not the relay's state.
      if (!relay || relay.challenge === challenge) noteAuth(key, false, err, true)
      for (const fail of [...(signFailed.get(authKey(key, challenge)) ?? [])]) fail(err)
    }
    throw err
  }).finally(() => {
    // Given up on, the socket stays held a while longer for the answer to sign in with (signInLate).
    if (settledInTime) release()
    else setTimeout(release, LATE_AUTH_HOLD_MS)
    if (!key) return
    const left = (authSigning.get(key) ?? 1) - 1
    if (left > 0) authSigning.set(key, left)
    else authSigning.delete(key)
  })
}

const authListeners = new Set<(url: string, ok: boolean) => void>()

/**
 * Be told when a relay's NIP-42 AUTH succeeds or fails (normalized URL). A
 * list whose last read the canonical relay refused for want of AUTH reads
 * again once it signs in. Returns the unsubscribe.
 */
export function onAuthChange(fn: (url: string, ok: boolean) => void): () => void {
  authListeners.add(fn)
  return () => { authListeners.delete(fn) }
}

function noteAuth(url: string, ok: boolean, err?: unknown, bySigner = false): void {
  if (ok) authFailed.delete(url)
  else authFailed.set(url, { reason: err instanceof Error ? err.message : String(err ?? 'failed'), bySigner })
  for (const fn of [...authListeners]) {
    try { fn(url, ok) } catch { /* one listener's failure is not the others' */ }
  }
}

/** Why this relay's last AUTH failed, or null when it did not (or none was tried). */
export function authFailure(url: string): string | null {
  return authFailed.get(normalizeURL(url))?.reason ?? null
}

/**
 * Answer this socket's challenge, once. A challenge already answered costs
 * nothing; one whose signature failed is not asked of the signer again
 * unless `retry` (a RETRY, the tab coming back, the signer answering
 * something else), so a read never stacks a second prompt on a signer that
 * is away. Rejects when the signature fails, instead of hanging as
 * nostr-tools' own auth() does.
 */
function authOn(relay: AuthRelay, url: string, retry = false): Promise<void> {
  const key = normalizeURL(url)
  const challenge = relay.challenge
  if (!challenge) return Promise.reject(new Error("can't perform auth, no challenge was received"))
  if (authedFor.get(key) === challenge) return Promise.resolve()
  if (deadAuth.get(relay) === challenge) {
    if (!retry) return Promise.reject(new Error(`auth failed: ${authFailed.get(key)?.reason ?? 'the signer did not answer'}`))
    deadAuth.delete(relay)
    relay.authPromise = undefined
  }
  return settleAuth(relay, key, challenge, relay.auth(authSign))
}

/** How often a wait on an AUTH looks whether its socket is still there. */
const AUTH_SOCKET_CHECK_MS = 500

/**
 * Wait on nostr-tools' AUTH promise `lib`, which settles only when the relay
 * answers: also give up when its signature fails (signFailed) or its socket
 * closes, since the AUTH can then never be sent and nostr-tools never says so.
 */
function settleAuth(relay: AuthRelay, key: string, challenge: string, lib: Promise<unknown>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const k = authKey(key, challenge)
    const waiters = signFailed.get(k) ?? new Set<(err: unknown) => void>()
    signFailed.set(k, waiters)
    const watch = setInterval(() => { if (relay.connected === false) fail(new Error('relay connection closed')) }, AUTH_SOCKET_CHECK_MS)
    const done = (): void => {
      clearInterval(watch)
      waiters.delete(fail)
      if (waiters.size === 0 && signFailed.get(k) === waiters) signFailed.delete(k)
    }
    const fail = (err: unknown): void => { done(); reject(err) }
    waiters.add(fail)
    lib.then(() => {
      done()
      if (authedFor.get(key) !== challenge) {
        authedFor.set(key, challenge)
        noteAuth(key, true)
      }
      resolve()
    }, (err: unknown) => {
      // The relay said no, or never said OK: the signer was not at fault, but
      // the socket is not signed in, and nostr-tools keeps that answer for it.
      if (relay.challenge === challenge && authedFor.get(key) !== challenge) {
        deadAuth.set(relay, challenge)
        noteAuth(key, false, err)
      }
      fail(err)
    })
  })
}

/** A signature that came after its AUTH gave up: sign in with it, if its socket is still open on that challenge. */
async function signInLate(url: string, challenge: string, ev: NostrEvent): Promise<void> {
  const relay = socketOf(url)
  if (!relay || relay.connected === false || relay.challenge !== challenge || authedFor.get(url) === challenge) return
  // A fresh attempt still signing has its own answer coming; this one is the same sign-in.
  if (deadAuth.get(relay) !== challenge && relay.authPromise) return
  deadAuth.delete(relay)
  relay.authPromise = undefined
  await settleAuth(relay, url, challenge, relay.auth(async () => ev as unknown as VerifiedEvent)).catch(() => { /* said by noteAuth */ })
}

/**
 * Sign in again where the last AUTH failed: the signer is back (the tab
 * returned, or it answered something else), or RETRY was pressed for `only`.
 * Without `only`, only where the signer was the cause: a relay that turned
 * the AUTH down would turn it down again, and each try is one more request to
 * a bunker. A relay whose socket has gone is dialled again, and its new
 * challenge answered.
 */
export function retryFailedAuth(only?: string): void {
  for (const [url, why] of [...authFailed]) {
    if (only ? normalizeURL(only) !== url : !why.bySigner) continue
    if (authPending(url)) continue
    const relay = socketOf(url)
    if (relay?.connected && relay.challenge) void authOn(relay, url, true).catch(() => { /* said by noteAuth */ })
    else void authRelay(url)
  }
}

// Any answer from the signer is the signer being back.
onSignerAnswered(() => { if (authFailed.size > 0) retryFailedAuth() })

/** verifyEvent, skipping the Schnorr check for a signature this page already checked (lib/verifiedSigs.ts). */
export const verifyRelayEvent = verifyOnce

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
    pool = new Pool({
      verifyEvent: (ev) => (ev.kind === 321 ? true : verifyUnlessDeferred(ev)),
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
  /** nostr-tools' AUTH for the current challenge, kept for the socket's life. */
  authPromise?: Promise<unknown>
  /** Whether the socket is open (nostr-tools' AbstractRelay). */
  readonly connected?: boolean
  auth(sign: typeof authSign): Promise<unknown>
}

/** This socket's challenge, waiting up to `ms` for one to come. */
async function challengeOf(relay: AuthRelay, ms: number): Promise<string | undefined> {
  for (let waited = 0; !relay.challenge && waited < ms; waited += 40) await new Promise((r) => setTimeout(r, 40))
  return relay.challenge
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
async function authRelay(url: string): Promise<void> {
  const started = Date.now()
  try {
    const relay = (await getPool().ensureRelay(url)) as unknown as AuthRelay
    // A relay that never challenged before is not waited for, but one whose
    // challenge came late (a phone's busy first seconds) is still answered:
    // remembered as never challenging, it was never signed in to again, and
    // every read of it came back refused (HIDDEN BAGS, 2026-11-04).
    const challenge = noChallenge.has(url) ? relay.challenge : await challengeOf(relay, 400)
    if (challenge) {
      noChallenge.delete(url)
      await authOn(relay, url)
    } else {
      noChallenge.add(url)
    }
  } catch (err) {
    // Relay down, or does not require auth; or it took the socket and never answered its AUTH.
    // nostr-tools hands back the same rejection at once afterwards, which is not another wait.
    if (/auth timed out/.test(String(err)) && Date.now() - started >= 1000) noteTimeout(url)
  }
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
  for (const url of relays) authedFor.delete(normalizeURL(url))
}

/** What nostr-tools resolves a publish with when the relay could not be reached. */
const CONNECTION_FAILURE = 'connection failure'

async function publishOnce(listed: string[], event: NostrEvent): Promise<PublishResult> {
  const relays = skipHung(listed)
  if (relays.length === 0) return { ok: false, reason: HUNG_REASON }
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
  results.forEach((r, i) => {
    if (r.status === 'rejected' && /publish timed out/.test(String(r.reason))) noteTimeout(relays[i])
    else if (failed(r) === null) noteAnswered(relays[i])
  })
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

/**
 * Send something that does not matter if it is lost: one try, to the
 * canonical relay only, over a socket that is already open and not waiting
 * on an AUTH. Never drops a socket, never retries, never asks the signer to
 * AUTH, so it cannot disturb the feeds (review of #396: a ping in flight as
 * the tab came back, through publishMany, dropped the sockets resumeLive had
 * just opened, and every feed reconnected and signed in again). Only the
 * canonical relay: every set listens there, it is always configured, and a
 * relay of the viewer's own has no use for it. Cyberspace TV's watching ping
 * (store/useTvWatching) is the one caller. Whether it was sent.
 */
export async function publishLight(event: NostrEvent): Promise<boolean> {
  const url = normalizeURL(CYBERSPACE_RELAY)
  if (!pool?.listConnectionStatus().get(url) || authPending(url)) return false
  const [result] = await Promise.allSettled(getPool().publish([url], event, { maxWait: MAX_WAIT_MS }))
  return result?.status === 'fulfilled' && !String(result.value).startsWith(CONNECTION_FAILURE)
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
  /** Whoever asked checks the signatures of what comes back (query with offThread, through sigCheck.ts answerChecks): none are checked as they land. */
  deferChecks?: boolean
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
const NO_ANSWER = 'no answer in time'

/**
 * `evenHung`: ask a hung relay too. Reading a chain needs it (skipHung).
 * `offThread`: check the signatures of what comes back in a worker (query).
 */
export interface ReadOptions { evenHung?: boolean; offThread?: boolean }

async function askOne(url: string, filter: Filter, deadline: number, opts: AskOptions = {}): Promise<RelayAnswer> {
  const { answerMs, onSent, stop, onEvent, deferChecks } = opts
  const remaining = (): number => Math.max(0, deadline - Date.now())
  const late = (events: NostrEvent[] = []): RelayAnswer => ({ url, outcome: 'unreachable', reason: NO_ANSWER, events })
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
    // Out of time while signing in: the relay refused this question until we
    // do, and that is not the relay having nothing (HIDDEN BAGS, 2026-11-04).
    let signingIn = false
    const outOfTime = (): void => finish(signingIn
      ? { url, outcome: 'refused', reason: 'auth-required: still waiting for the signer', events: got() }
      : late(got()))
    const arm = (ms: number): void => { clearTimeout(timer); timer = setTimeout(outOfTime, ms) }
    if (answerMs === undefined) arm(remaining())
    const open = (): void => {
      try {
        sub = relay.subscribe([filter], {
          ...(deferChecks ? { alreadyHaveEvent: deferCheck } : {}),
          onevent: (e) => {
            if (settled || events.has(e.id)) return
            events.set(e.id, e as NostrEvent)
            onEvent?.(e as NostrEvent)
          },
          oneose: () => { noteAnswered(url); finish({ url, outcome: 'answered', events: got() }) },
          onclose: (reason) => {
            if (settled) return
            if (/^auth-required:/i.test(reason) && !authTried) {
              authTried = true
              signingIn = true
              // A REQ can beat the socket's challenge: wait for it, inside this question's time.
              void challengeOf(relay as unknown as AuthRelay, remaining())
                .then(() => authOn(relay as unknown as AuthRelay, url))
                .then(
                  () => { signingIn = false; if (!settled) open() },
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

/** For queryRelays alone: `onAnswer` hears each relay's answer the moment it is in. */
interface AskAll extends ReadOptions, Pick<AskOptions, 'deferChecks'> { onAnswer?: (a: RelayAnswer) => void }

/**
 * One-shot query, each relay asked and answered on its own, then closed.
 *
 * Authenticates first, as every read here does: the relay requires NIP-42
 * auth for reads, and an unauthed REQ is closed before it is answered. The
 * deadline is ours and is the only timer that ends a wait (see
 * NOSTR_TOOLS_EOSE_MS).
 */
async function queryRelays(relays: string[], filter: Filter, maxWait = MAX_WAIT_MS, opts: AskAll = {}): Promise<RelayAnswer[]> {
  const urls = [...new Set(relays.map((r) => normalizeURL(r)))]
  const asked = opts.evenHung ? urls : skipHung(urls)
  await authAll(asked)
  const deadline = Date.now() + maxWait
  const answers = await Promise.all(urls.map((url): Promise<RelayAnswer> => asked.includes(url)
    ? askOne(url, filter, deadline, { deferChecks: opts.deferChecks }).then((a) => { opts.onAnswer?.(a); return a })
    : Promise.resolve({ url, outcome: 'unreachable', reason: HUNG_REASON, events: [] })))
  // Silent for a whole full-length question, with nothing sent: it hung. A short question says nothing.
  if (maxWait >= CONNECT_MS) for (const a of answers) if (a.outcome === 'unreachable' && a.reason === NO_ANSWER && a.events.length === 0) noteTimeout(a.url)
  return answers
}

/**
 * One-shot query, merged across relays. The callers want the events and treat
 * an empty list as "nothing found", as before; what changed underneath is
 * only that a relay that never answered is no longer told apart from one that
 * did by a timer inside nostr-tools, but by our deadline. The events a slow
 * relay sent before the deadline still count.
 */
async function collect(relays: string[], filter: Filter, maxWait = MAX_WAIT_MS, opts: ReadOptions = {}): Promise<NostrEvent[]> {
  return mergeAnswers(await queryRelays(relays, filter, maxWait, opts))
}

/**
 * Query the configured relays. With `offThread`, for a read that may bring back
 * thousands of events (a whole chain): the signatures are checked in a worker, and
 * only what verifies comes back, so nothing is decided on an unchecked event. As
 * they land, a Schnorr check apiece took about 2 s of main thread for one long chain.
 * `evenHung` asks a hung relay too, either way.
 */
export async function query(filter: Filter, opts: ReadOptions = {}): Promise<NostrEvent[]> {
  if (!opts.offThread) return collect(relaySet(), filter, MAX_WAIT_MS, opts)
  // Each relay's answer is checked the moment it is in, not after the slowest one.
  const checks = answerChecks<RelayAnswer>()
  return mergeAnswers(await checks.kept(await queryRelays(relaySet(), filter, MAX_WAIT_MS, { evenHung: opts.evenHung, deferChecks: true, onAnswer: checks.onAnswer })))
}

/**
 * Query the configured relays and keep each relay's answer: answered, refused
 * or unreachable (relayOutcome.ts). For the reads where "nothing" and "no
 * answer" lead to different actions.
 */
export function queryEach(filter: Filter, maxWait = MAX_WAIT_MS, opts: ReadOptions = {}): Promise<RelayAnswer[]> {
  return queryRelays(relaySet(), filter, maxWait, opts)
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
 * Why the canonical relay gave a list nothing: it would not answer until this
 * visit signs in (`auth`), or it was not heard from at all (`unreachable`,
 * which also covers its other refusals). Null when it answered, or was not
 * asked. A list shows this instead of "nothing", since the bags, comments
 * and listings everyone reads live there (HIDDEN BAGS, 2026-11-04).
 */
export type ReadTrouble = 'auth' | 'unreachable'

export function troubleOf(answers: RelayAnswer[]): ReadTrouble | null {
  const canon = answers.find((a) => a.url === normalizeURL(CYBERSPACE_RELAY))
  if (!canon || canon.outcome === 'answered') return null
  return canon.outcome === 'refused' && /^auth-required:/i.test(canon.reason) ? 'auth' : 'unreachable'
}

/** What a list read came to: every relay's events, and the canonical relay's trouble, if any. */
export interface CheckedRead { events: NostrEvent[]; trouble: ReadTrouble | null }

/** `query`, for a list that must not call a refusal "nothing". */
export async function queryChecked(filter: Filter): Promise<CheckedRead> {
  const answers = await queryEach(filter)
  return { events: mergeAnswers(answers), trouble: troubleOf(answers) }
}

/** `queryAny`, the same way. */
export async function queryAnyChecked(relays: string[], filter: Filter, maxWait?: number): Promise<CheckedRead> {
  const urls = [...new Set(relays.map((r) => normalizeURL(r)))]
  const up = await reachable(urls)
  const down: RelayAnswer[] = urls.filter((u) => !up.includes(u)).map((url) => ({ url, outcome: 'unreachable', reason: 'connection failed', events: [] }))
  const answers = up.length ? await queryRelays(up, filter, maxWait) : []
  return { events: mergeAnswers(answers), trouble: troubleOf([...answers, ...down]) }
}

/**
 * Be told each time the canonical relay signs this visit in: a list whose
 * last read it refused reads again. Returns the unsubscribe.
 */
export function onCanonicalSignIn(fn: () => void): () => void {
  const canon = normalizeURL(CYBERSPACE_RELAY)
  return onAuthChange((url, ok) => { if (ok && url === canon) fn() })
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
          void challengeOf(relay as unknown as AuthRelay, MAX_WAIT_MS)
            .then(() => authOn(relay as unknown as AuthRelay, url))
            .then(() => open(relay), () => { if (!closed) handlers.onclose(reason) })
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
  await Promise.all(skipHung(relays).map(async (url) => {
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
    await authAll(skipHung(relays))
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
  // A snapshot, not the live set (arkinox, 2026-10-11): a Set's iteration
  // visits what is added during it, and a listener that restarts its work by
  // unsubscribing and subscribing again (the agent DM reading does) would be
  // run again in this same pass, forever. That froze the tab on return from
  // the background and ended in Aw, Snap. One removed by an earlier listener
  // in this pass is still skipped, as the live set would skip it.
  for (const fn of [...resumeListeners]) {
    if (!resumeListeners.has(fn)) continue
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
    const relays = skipHung(relaySet())
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
    if (hiddenAt !== null && Date.now() - hiddenAt >= RESUME_AFTER_HIDDEN_MS) {
      // A device coming back has half-open sockets, so what timed out was not the relay's doing.
      forgetHung()
      resumeLive()
    }
    hiddenAt = null
  }
  const onOnline = (): void => { forgetHung(); resumeLive() }
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
