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
import { signerHeld } from './authOpen'
import { AUTH_STALLED, classifyClose, mergeAnswers, type RelayAnswer } from './relayOutcome'
import { normalizeURL } from 'nostr-tools/utils'
import { useCyberspace } from '../store/useCyberspace'
import { askAgain, onSignerAnswered, SignerTimeout } from './signWithin'

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
 *
 * And a ping the relay CLOSEd (auth-required, on a socket not signed in yet)
 * was closed a second time by its own EOSE timer 21 s later, since
 * nostr-tools' close does not clear it: one more off the count each ping,
 * until a late sign-in left the socket at zero with live subscriptions on it
 * and the pool closed it as idle (review of #600, round 2). Its close now
 * clears that timer.
 *
 * Whatever the count says, a socket with subscriptions open, or held for an
 * AUTH (holdOpen), is not idle, and the count never goes below zero.
 */
function countPings(relay: AbstractRelay): void {
  if (pingsCounted.has(relay)) return
  pingsCounted.add(relay)
  const r = relay as unknown as {
    subscribe: AbstractRelay['subscribe']
    ongoingOperations: number
    openSubs: Map<string, unknown>
    scheduleIdleClose: () => void
    clearIdleTimeout: () => void
  }
  const subscribe = r.subscribe.bind(relay)
  r.subscribe = (filters, params) => {
    if (params.label !== '<forced-ping>') return subscribe(filters, params)
    r.ongoingOperations++
    const sub = subscribe(filters, {
      ...params,
      onclose: (reason: string) => {
        clearTimeout((sub as unknown as OpenSub).eoseTimeoutHandle)
        params.onclose?.(reason)
      },
    })
    return sub
  }
  let ops = Math.max(0, r.ongoingOperations)
  Object.defineProperty(relay, 'ongoingOperations', { configurable: true, enumerable: true, get: () => ops, set: (v: number) => { ops = Math.max(0, v) } })
  const scheduleIdleClose = r.scheduleIdleClose.bind(relay)
  r.scheduleIdleClose = () => {
    // Each subscription's close, and each hold's release, schedules it again.
    if (r.openSubs.size > 0 || (holds.get(relay) ?? 0) > 0) { r.clearIdleTimeout(); return }
    scheduleIdleClose()
  }
}

const sendGuarded = new WeakSet<object>()

/**
 * nostr-tools (2.24.1) sends each frame once the connection promise settles,
 * on whatever socket is there by then. Closing a relay with subscriptions on
 * it (a bunker's relays dropped mid-sign, the canonical relay replaced)
 * queues their CLOSE frames first and closes the socket after, so each was
 * written to a socket already closing: "WebSocket is already in CLOSING or
 * CLOSED state", thrown where nobody catches it (the real-bunker run,
 * 2026-11-04). The same send, with that write caught: the frame was for a
 * socket that is gone, and whatever waited on its answer has its own end.
 */
function guardSend(relay: AbstractRelay): void {
  if (sendGuarded.has(relay)) return
  sendGuarded.add(relay)
  const r = relay as unknown as { send: (message: string) => Promise<void>; connectionPromise?: Promise<void>; ws?: WebSocket }
  const send = r.send.bind(relay)
  // Not async: its own promise would carry the refusal on, unhandled.
  r.send = (message) => {
    // No connection at all: nostr-tools' own refusal (SendingOnClosedConnection),
    // as before, to a caller that awaits it (publish, count). An AUTH signed
    // after its socket closed, a REQ or a CLOSE does not await it: marked
    // handled, so it is not an unhandled rejection (review of #603).
    if (!r.connectionPromise) {
      const refused = send(message)
      refused.catch(() => { /* said to whoever awaits it */ })
      return refused
    }
    r.connectionPromise.then(() => {
      try { r.ws?.send(message) } catch { /* the socket closed meanwhile */ }
    }, () => { /* the connect failed: said to whoever awaited it */ })
    return Promise.resolve()
  }
}

/** AUTHs holding each socket open (holdOpen), apart from nostr-tools' own count. */
const holds = new WeakMap<object, number>()

/** Every connection comes through ensureRelay, publishing and live subscriptions included. */
class Pool extends AbstractSimplePool {
  override async ensureRelay(...[url, params]: Parameters<AbstractSimplePool['ensureRelay']>): ReturnType<AbstractSimplePool['ensureRelay']> {
    if (isRetiredRelay(url)) throw new Error('retired relay, not dialed')
    const norm = normalizeURL(url)
    const started = Date.now()
    const pending = super.ensureRelay(url, { ...params, connectionTimeout: params?.connectionTimeout ?? (norm === normalizeURL(CYBERSPACE_RELAY) ? MAX_WAIT_MS : CONNECT_MS) })
    // Registered before the connect's first await, and gone from the pool by the time it fails.
    const relay = this.relays?.get(norm)
    if (relay) { countPings(relay); guardAuth(relay); guardSend(relay) }
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
 * Waiters on an AUTH being signed, by socket: told when its signature
 * fails. nostr-tools logs a failed signature and never settles the AUTH's
 * promise, which it keeps for the socket's life, so without this every read
 * waiting on it waited for good, and every later AUTH on that socket was the
 * same dead promise (verification of the HIDDEN BAGS report, 2026-11-04).
 * By socket, not by relay: an old socket's failed signature says nothing of
 * the AUTH a newer socket to the same relay is waiting on (review of #600).
 */
const signFailed = new WeakMap<object, Set<(err: unknown) => void>>()

/** What signFailed files a socket's waiters under: its WebSocket, which each connect replaces. */
function socketKey(relay: { ws?: unknown } | undefined): object | undefined {
  const ws = relay?.ws
  return typeof ws === 'object' && ws !== null ? ws : (relay as object | undefined)
}
/** The challenge whose AUTH failed, per socket (unsigned, refused, or no OK): its promise is dead and is not waited on again. */
const deadAuth = new WeakMap<object, Promise<unknown>>()

/**
 * Whether this socket's AUTH is dead: nostr-tools keeps one AUTH promise per
 * socket (not per challenge: a REQ before AUTH brings a fresh challenge, and
 * the promise stays), and this one's signature failed or the relay said no.
 */
function isDead(relay: AuthRelay): boolean {
  return relay.authPromise !== undefined && deadAuth.get(relay) === relay.authPromise
}

function markDead(relay: AuthRelay): void {
  if (relay.authPromise) deadAuth.set(relay, relay.authPromise)
}
/**
 * Why each relay's last AUTH failed (normalized URL), and whether the signer
 * was the cause (it refused, or did not answer). Gone once one succeeds.
 */
const authFailed = new Map<string, { reason: string; bySigner: 'timeout' | 'refused' | null }>()
/** AUTHs signing now, by relay: a late signature for that socket settles it. */
const inflight = new Map<string, (ev: NostrEvent) => void>()

/**
 * Whether the signer is what this relay's AUTH waits on: it is signing now,
 * or its last signature ran out of time or was refused. Such a relay was not
 * read signed in, so its silence or its empty answer says nothing about what
 * it holds (review of #570).
 */
function signerHolds(url: string): boolean {
  const key = normalizeURL(url)
  return authSigning.has(key) || !!authFailed.get(key)?.bySigner
}

/** Whether the relay itself turned this socket's AUTH down (or never said OK): the signer was not the cause. */
function relayTurnedDown(relay: AuthRelay, url: string): boolean {
  return isDead(relay) && !authSigning.has(normalizeURL(url)) && !authFailed.get(normalizeURL(url))?.bySigner
}

/** Keep authOpen.ts's list, which the store reads, in step with signerHolds. */
function syncHeld(url: string): void {
  const key = normalizeURL(url)
  if (signerHolds(key)) signerHeld.add(key)
  else signerHeld.delete(key)
}

/** The challenge each relay's socket was last signed in with (normalized URL). */
const authedFor = new Map<string, string>()
/**
 * Who each relay's socket is signed in as (normalized URL). A socket signed
 * in as one key stays signed in as it: a switch of identity signs in again
 * on a new socket (reauthAs), so the relay never takes this page for a key
 * that is not the identity on screen (the real-bunker run, 2026-11-04).
 */
const authedAs = new Map<string, string>()
/** Which key signed the AUTH sent on each WebSocket. */
const signedBy = new WeakMap<object, string>()

/** The identity on screen, or null where the store is not there (tests of this file alone). */
function identityNow(): string | null {
  try { return useCyberspace.getState().identity?.pubkey ?? null } catch { return null }
}

/**
 * Relays whose sockets were dropped on purpose (dropRelays: a move's second
 * look at its head, a real absence, a switch of identity): the new socket's
 * AUTH may ask the signer once, as it always did. Consumed by that ask.
 */
const mayAskFresh = new Set<string>()

/**
 * Whether a new AUTH at this relay must not ask the signer by itself: its
 * last AUTH failed because of the signer (refused, or ran out of time), and
 * nothing since dropped its socket on purpose. A socket the pool closed as
 * idle, or the relay closed, came back with a new challenge, and its AUTH
 * asked again: a prompt nobody asked for (#600's rule: a DENY stands until
 * the person acts). retryFailedAuth's deliberate asks are not held back.
 */
function heldBack(url: string): boolean {
  const key = normalizeURL(url)
  return !!authFailed.get(key)?.bySigner && !mayAskFresh.has(key)
}
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
  const r = relay as unknown as { ongoingOperations?: number; idleSince?: number; clearIdleTimeout?: () => void; scheduleIdleClose?: () => void } | undefined
  if (!r || typeof r.ongoingOperations !== 'number') return () => {}
  r.ongoingOperations++
  holds.set(r, (holds.get(r) ?? 0) + 1)
  r.clearIdleTimeout?.()
  let held = true
  return () => {
    if (!held) return
    held = false
    const left = (holds.get(r) ?? 1) - 1
    if (left > 0) holds.set(r, left)
    else holds.delete(r)
    r.ongoingOperations = Math.max(0, (r.ongoingOperations ?? 1) - 1)
    if (r.ongoingOperations === 0) { r.idleSince = Date.now(); r.scheduleIdleClose?.() }
  }
}

/** How long a socket is kept open after its AUTH gave up on the signer, for a late answer to sign in with. */
const LATE_AUTH_HOLD_MS = 5 * 60_000

/** The pool's socket to this relay (normalized URL), if it has one. */
function socketOf(url: string): AuthRelay | undefined {
  return (pool as unknown as { relays?: Map<string, AuthRelay> } | null)?.relays?.get(url)
}

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
  if (key) { mayAskFresh.delete(key); authSigning.set(key, (authSigning.get(key) ?? 0) + 1); syncHeld(key) }
  const socket = key ? socketOf(key) : undefined
  const release = holdOpen(socket)
  // The socket it is for: a late signature signs in on that one only.
  const ws = socket?.ws
  const k = key ?? ''
  const failKey = socketKey(socket)
  // Who asked: an answer, or a failure, for an identity no longer on screen is not this one's.
  const askedAs = identityNow()
  let settled = false
  const signed = new Promise<VerifiedEvent>((resolve, reject) => {
    const take = (ev: NostrEvent): void => {
      if (settled) return
      settled = true
      // Signed as a key that is no longer the identity on screen (a switch while it signed): never sent.
      const me = identityNow()
      if (me && ev.pubkey !== me) { reject(new StaleIdentity()); return }
      if (ws && typeof ws === 'object') signedBy.set(ws, ev.pubkey)
      resolve(ev as unknown as VerifiedEvent)
    }
    if (key) inflight.set(k, take)
    const late = (ev: NostrEvent): void => {
      if (!settled) { take(ev); return }
      if (key) void signInLate(key, ws, ev).finally(release)
    }
    useCyberspace.getState().signEvent(template, undefined, late).then(
      take,
      (err: unknown) => { if (!settled) { settled = true; reject(err) } },
    )
  })
  let heldForLate = false
  return signed.then((ev) => ev, (err: unknown) => {
    // Out of time, not refused: its answer may still come, and the socket is held for it (signInLate).
    heldForLate = err instanceof SignerTimeout
    // The identity changed while it signed: no failure of the signer on
    // screen, which never refused anything. Recorded as one, the new
    // identity was never signed in until RETRY (review of #603). The socket
    // is replaced instead, and the new one signs in as the identity on screen.
    const me = identityNow()
    if (key && (err instanceof StaleIdentity || (askedAs && me && askedAs !== me))) {
      replaceStale(key, ws)
      for (const fail of [...((failKey && signFailed.get(failKey)) ?? [])]) fail(err)
      throw err
    }
    if (key) {
      const relay = socketOf(key)
      // A socket since replaced has its own AUTH: this one's failure is not the relay's state.
      if (!relay || relay.ws === ws) {
        if (relay) markDead(relay)
        noteAuth(key, false, err, heldForLate ? 'timeout' : 'refused')
      }
      for (const fail of [...((failKey && signFailed.get(failKey)) ?? [])]) fail(err)
    }
    throw err
  }).finally(() => {
    if (key) inflight.delete(k)
    if (heldForLate) setTimeout(release, LATE_AUTH_HOLD_MS)
    else release()
    if (!key) return
    const left = (authSigning.get(key) ?? 1) - 1
    if (left > 0) authSigning.set(key, left)
    else authSigning.delete(key)
    syncHeld(key)
  })
}

/** An AUTH signed, or about to count, as an identity that is no longer the one on screen. */
class StaleIdentity extends Error {
  constructor() {
    super('signed as another identity than this one')
    this.name = 'StaleIdentity'
  }
}

/**
 * This relay's socket `ws` is for an identity no longer on screen: replace
 * it, and reissue the feeds over the new one, whose AUTH asks the signer of
 * the identity now (dropRelays lets it). Never left signed in as the old one.
 */
function replaceStale(url: string, ws: unknown): void {
  const relay = socketOf(url)
  if (relay && relay.ws !== ws) return
  live.resumeAll(() => dropRelays([url]))
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

function noteAuth(url: string, ok: boolean, err?: unknown, bySigner: 'timeout' | 'refused' | null = null): void {
  if (ok) { authFailed.delete(url); mayAskFresh.delete(url) }
  else authFailed.set(url, { reason: err instanceof Error ? err.message : String(err ?? 'failed'), bySigner })
  syncHeld(url)
  for (const fn of [...authListeners]) {
    try { fn(url, ok) } catch { /* one listener's failure is not the others' */ }
  }
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
  const failedWhy = (): Error => new Error(`auth failed: ${authFailed.get(key)?.reason ?? 'the signer did not answer'}`)
  if (isDead(relay)) {
    if (!retry) return Promise.reject(failedWhy())
    deadAuth.delete(relay)
    relay.authPromise = undefined
  }
  // A new AUTH that would ask the signer, after it refused or ran out of
  // time here: only a deliberate ask (retry) goes to it.
  if (!retry && !relay.authPromise && heldBack(key)) return Promise.reject(failedWhy())
  return settleAuth(relay, key, challenge, relay.auth(retry ? deliberateAuthSign : authSign))
}

/** How often a wait on an AUTH looks whether its socket is still there. */
const AUTH_SOCKET_CHECK_MS = 500

/**
 * Wait on nostr-tools' AUTH promise `lib`, which settles only when the relay
 * answers: also give up when its signature fails (signFailed) or its socket
 * closes, since the AUTH can then never be sent and nostr-tools never says so.
 */
function settleAuth(relay: AuthRelay, key: string, challenge: string, lib: Promise<unknown>): Promise<void> {
  return untilSettled(relay, lib).then(() => {
    const as = typeof relay.ws === 'object' && relay.ws !== null ? signedBy.get(relay.ws) : undefined
    // Signed in as the identity before a switch made while the relay's OK
    // was on its way: not counted, and the socket is replaced.
    const me = identityNow()
    if (as && me && as !== me) {
      replaceStale(key, relay.ws)
      throw new StaleIdentity()
    }
    if (as) authedAs.set(key, as)
    if (authedFor.get(key) !== challenge) {
      authedFor.set(key, challenge)
      noteAuth(key, true)
    }
  }, (err: unknown) => {
    // The relay said no, or never said OK: the signer was not at fault, but
    // the socket is not signed in, and nostr-tools keeps that answer for it.
    if (authedFor.get(key) !== relay.challenge && !isDead(relay) && relay.connected !== false) {
      markDead(relay)
      noteAuth(key, false, err)
    }
    throw err
  })
}

/** Longer than any signer is waited for (15 s, a reconnect of up to 60 s, 15 s): an AUTH no answer settles. */
const AUTH_SETTLE_CAP_MS = 120_000

/** `lib`, or a rejection once its signature fails, its socket closes, or AUTH_SETTLE_CAP_MS passes. */
function untilSettled(relay: AuthRelay, lib: Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const k = socketKey(relay) as object
    const waiters = signFailed.get(k) ?? new Set<(err: unknown) => void>()
    signFailed.set(k, waiters)
    const watch = setInterval(() => { if (relay.connected === false) fail(new Error('relay connection closed')) }, AUTH_SOCKET_CHECK_MS)
    const cap = setTimeout(() => fail(new Error('auth took too long')), AUTH_SETTLE_CAP_MS)
    const done = (): void => {
      clearInterval(watch)
      clearTimeout(cap)
      waiters.delete(fail)
      if (waiters.size === 0 && signFailed.get(k) === waiters) signFailed.delete(k)
    }
    const fail = (err: unknown): void => { done(); reject(err) }
    waiters.add(fail)
    lib.then((v) => { done(); resolve(v) }, fail)
  })
}

/**
 * The signer nostr-tools answers a challenge with on its own, the moment one
 * comes. A function of its own, so guardAuth knows that call: nobody awaits
 * it, and nostr-tools rethrows its failure, unhandled.
 */
const autoAuthSign = (template: EventTemplate): Promise<VerifiedEvent> => authSign(template)

/** The signer a deliberate ask answers with (authOn with retry): the one AUTH that goes to a signer that failed here. */
const deliberateAuthSign = (template: EventTemplate): Promise<VerifiedEvent> => authSign(template)

const authGuarded = new WeakSet<object>()

/**
 * nostr-tools' own paths wait on relay.auth() too: a publish answered
 * "auth-required:" and a pool subscription closed so (the live feeds, the
 * probe). On a challenge whose signature failed that was the dead promise,
 * and they waited for good: the move queue behind a protected publish, a
 * feed that never reopened. Guarded, they are refused at once, or when the
 * signature fails or the socket closes, and take their own failure paths.
 */
function guardAuth(relay: AbstractRelay): void {
  if (authGuarded.has(relay)) return
  authGuarded.add(relay)
  const r = relay as unknown as AuthRelay & { url: string }
  const auth = r.auth.bind(relay)
  r.auth = (sign) => {
    const challenge = r.challenge
    if (!challenge) return auth(sign)
    // A new AUTH that would ask a signer that refused or ran out of time
    // here (a new socket's challenge, a feed or a publish told auth-required):
    // not asked by itself. RETRY, a real absence or a new signer asks it.
    const unasked = !r.authPromise && sign !== deliberateAuthSign && (sign === authSign || sign === autoAuthSign) && heldBack(r.url)
    const guarded = isDead(r) || unasked
      ? Promise.reject(new Error('auth-required: the signer did not sign in'))
      : untilSettled(r, auth(sign))
    // Its failure is said by noteAuth; rethrown inside nostr-tools it is only an unhandled error.
    return sign === autoAuthSign ? guarded.catch(() => undefined) : guarded
  }
}

/** A signature that came after its AUTH gave up: sign in with it, if the socket it was for is still open. */
async function signInLate(url: string, ws: unknown, ev: NostrEvent): Promise<void> {
  const relay = socketOf(url)
  if (!relay || relay.ws !== ws || relay.connected === false || !relay.challenge || authedFor.get(url) === relay.challenge) return
  // Signed as an identity no longer on screen: never sent.
  const me = identityNow()
  if (me && ev.pubkey !== me) return
  // A fresh attempt is still asking the signer: this is its answer.
  const waiting = inflight.get(url)
  if (waiting) { waiting(ev); return }
  if (relay.authPromise && !isDead(relay)) return
  deadAuth.delete(relay)
  relay.authPromise = undefined
  if (typeof ws === 'object' && ws !== null) signedBy.set(ws, ev.pubkey)
  // A relay takes an AUTH for any challenge it sent this socket (probed 2026-11-04), so the old one serves.
  await settleAuth(relay, url, relay.challenge, relay.auth(async () => ev as unknown as VerifiedEvent)).catch(() => { /* said by noteAuth */ })
}

/**
 * Sign in again where the last AUTH failed. With `only` (RETRY), there,
 * whatever the cause. Otherwise only at the relays in use, and only where the
 * signer was the cause: after a real absence from the tab (`back`, see
 * watchTabReturn) or a sign-in or change of signer (`signer`), after it ran
 * out of time or refused; on the signer answering something else
 * (`answered`), only after it ran out of time, so a person who refused is not
 * asked again with every move. A relay that turned the AUTH down would turn
 * it down again, and each try is one more request to a bunker. A relay whose
 * socket has gone is dialled again, and its new challenge answered.
 */
export function retryFailedAuth(only?: string, when: 'back' | 'signer' | 'answered' = 'back'): void {
  const inUse = new Set(relaySet().map((r) => normalizeURL(r)))
  let asked = false
  for (const [url, why] of [...authFailed]) {
    const wanted = only
      ? normalizeURL(only) === url
      : inUse.has(url) && (why.bySigner === 'timeout' || (why.bySigner === 'refused' && when !== 'answered'))
    if (!wanted) continue
    // Only a deliberate tap (`only`) goes past an AUTH still waiting on the
    // signer: RETRY waited on a request lost in transit for a minute and
    // more, while the person tapped it again and again (the real-bunker run).
    if (!only && authPending(url)) continue
    // Once per tap, before asking: the store gives up a handshake or a
    // channel that never answered, so this request goes out fresh.
    if (only && !asked) { asked = true; askAgain() }
    const relay = socketOf(url)
    // An AUTH still waiting on this socket is joined, not replaced: nostr-tools
    // files an AUTH by its event's id, so two for one signature left one of
    // them, and the reads on it, waiting for good. RETRY's askAgain has
    // already given up the handshake or the sockets it waited on, so it goes
    // out fresh all the same (signers.ts deferredReconnect, the store's onAskAgain).
    if (relay?.connected && relay.challenge) void authOn(relay, url, true).catch(() => { /* said by noteAuth */ })
    else void authRelay(url, true)
  }
}

// Any answer from the signer is the signer being back.
onSignerAnswered(() => { if (authFailed.size > 0) retryFailedAuth(undefined, 'answered') })

let watchingSigner = false

/**
 * A switch of identity: every socket signed in as another key is replaced,
 * and the feeds on it reissued over the new one, which signs in as `pubkey`.
 * A relay signed in as the old key otherwise kept taking this page for it:
 * a login switch never signed in again, so the canonical relay saw only the
 * throwaway key a page starts with (the real-bunker run, 2026-11-04).
 */
function reauthAs(pubkey: string): void {
  const stale = [...authedAs].filter(([, as]) => as !== pubkey).map(([url]) => url)
  if (stale.length === 0) return
  live.resumeAll(() => dropRelays(stale))
}

/**
 * A sign-in or another signer: an AUTH the old one refused or let run out is
 * asked of this one. Tried on each getPool until the store can be subscribed
 * to: a pool asked for while the store module is still loading finds it not
 * there yet.
 */
function watchSigner(): void {
  try {
    useCyberspace.subscribe?.((now, before) => {
      if (now.identity.pubkey !== before.identity.pubkey) reauthAs(now.identity.pubkey)
      if (now.identity.pubkey !== before.identity.pubkey || now.signerKind !== before.signerKind) retryFailedAuth(undefined, 'signer')
    })
    watchingSigner = true
  } catch { /* the store is still loading: the next getPool tries again */ }
}

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
    ;(pool as unknown as { automaticallyAuth?: () => typeof authSign }).automaticallyAuth = () => autoAuthSign
  }
  if (!watchingSigner) watchSigner()
  return pool
}

interface AuthRelay {
  challenge?: string
  /** nostr-tools' AUTH for the current challenge, kept for the socket's life. */
  authPromise?: Promise<unknown>
  /** Whether the socket is open (nostr-tools' AbstractRelay). */
  readonly connected?: boolean
  /** The WebSocket under it, replaced on each connect. */
  readonly ws?: unknown
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
async function authRelay(url: string, retry = false): Promise<void> {
  const started = Date.now()
  // A relay that never challenged is not dialled for its AUTH alone: the read
  // or write that follows connects. One open with a challenge since is answered.
  if (noChallenge.has(url)) {
    const open = socketOf(normalizeURL(url))
    if (!open?.connected || !open.challenge) return
  }
  try {
    const relay = (await getPool().ensureRelay(url)) as unknown as AuthRelay
    // A relay that never challenged before is not waited for, but one whose
    // challenge came late (a phone's busy first seconds) is still answered:
    // remembered as never challenging, it was never signed in to again, and
    // every read of it came back refused (HIDDEN BAGS, 2026-11-04).
    const challenge = noChallenge.has(url) ? relay.challenge : await challengeOf(relay, 400)
    if (challenge) {
      noChallenge.delete(url)
      await authOn(relay, url, retry)
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
  await Promise.allSettled(relays.map((url) => authRelay(url)))
}

/** Whether this relay's socket in hand was signed in to by this page. */
export function signedIn(url: string): boolean {
  return authedFor.has(normalizeURL(url))
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
  for (const url of relays) {
    const key = normalizeURL(url)
    authedFor.delete(key)
    authedAs.delete(key)
    // Dropped on purpose: the new socket's AUTH may ask, even after the signer failed (heldBack).
    mayAskFresh.add(key)
  }
}

/** What nostr-tools resolves a publish with when the relay could not be reached. */
const CONNECTION_FAILURE = 'connection failure'

/**
 * NIP-01's "already have this event": the relay holds this exact id, so it
 * took it. strfry (cyberspace.nostr1.com) says so with OK true, grain
 * (relay.onosendai.tech) with OK false, which nostr-tools rejects. Taken for
 * a refusal, an event a relay had stored while its first OK was lost, or that
 * the history copy put there first, was asked of the canonical relay forever,
 * and the strip said it was not there.
 */
const DUPLICATE = /^duplicate:/i

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
  const failed = (r: PromiseSettledResult<string>): string | null => {
    if (r.status === 'fulfilled') return String(r.value).startsWith(CONNECTION_FAILURE) ? String(r.value) : null
    const why = String(r.reason?.message ?? r.reason)
    return DUPLICATE.test(why) ? null : why
  }
  results.forEach((r, i) => {
    if (r.status === 'rejected' && /publish timed out/.test(String(r.reason))) noteTimeout(relays[i])
    else if (failed(r) === null) noteAnswered(relays[i])
  })
  const accepted = relays.filter((_, i) => results[i] !== undefined && failed(results[i]) === null).map((r) => normalizeURL(r))
  if (accepted.length > 0) return { ok: true, accepted }
  // Turned away while the signer holds its AUTH up (a relay that challenges
  // only on the EVENT fails with the signer's own words): said so, so the
  // retry does not ask the signer again over a fresh socket (review of #570).
  const why = (r: PromiseSettledResult<string>, i: number): string | null => {
    const f = failed(r)
    // A socket that took the EVENT and never said OK is the socket, not the signer: retried as before.
    return f !== null && r.status === 'rejected' && !/publish timed out/.test(f) && signerHolds(relays[i]) ? AUTH_STALLED : f
  }
  const reason = results.map(why).find(Boolean)
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
  // Only the others are asked again, over fresh sockets, as on v2, a relay
  // that turned its AUTH down among them. A relay the signer holds up is not:
  // a fresh socket brings a fresh challenge and asks the signer again, which
  // only the RETRY paths may do (retryFailedAuth), and its socket is held for
  // a late answer (verification of #236, finding 4; review of #570).
  const again = relays.filter((url) => !signerHolds(url))
  if (again.length === 0) return first
  dropRelays(again)
  return publishOnce(again, event)
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
  /** While events keep coming, wait at least this long after each, up to `capAt` (ReadOptions.stream). */
  quietMs?: number
  capAt?: number
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
 * `stream`: a relay still sending is not cut off by the deadline: each event
 * buys `quietMs` more, up to `capMs` from the start. A list of everything
 * (HIDDEN BAGS) can take longer than the deadline on a busy socket or a busy
 * page, and its first events alone were taken for the whole answer: 29 bags
 * of 105, or none (the owner, 2026-11-04).
 */
export interface ReadOptions { evenHung?: boolean; offThread?: boolean; stream?: { quietMs: number; capMs: number } }

async function askOne(url: string, filter: Filter, deadline: number, opts: AskOptions = {}): Promise<RelayAnswer> {
  const { answerMs, onSent, stop, onEvent, deferChecks, quietMs, capAt } = opts
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
    const finish = (given: RelayAnswer): void => {
      if (settled) return
      settled = true
      // Refused for want of AUTH, with the signer the reason: said so, so a
      // chain decision does not take it for the relay's own word (review of #570).
      const answer: RelayAnswer = given.outcome === 'refused' && /^auth-required:/i.test(given.reason) && signerHolds(url)
        ? { ...given, reason: AUTH_STALLED }
        : given
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
    let endsAt = 0
    const arm = (ms: number): void => { clearTimeout(timer); endsAt = Date.now() + ms; timer = setTimeout(outOfTime, ms) }
    // Still sending: give it `quietMs` from this event, never past `capAt`.
    const stretch = (): void => {
      if (!quietMs || timer === undefined) return
      const want = Math.min(Date.now() + quietMs, capAt ?? Infinity)
      if (want > endsAt) arm(want - Date.now())
    }
    if (answerMs === undefined) arm(remaining())
    const open = (): void => {
      // False once this subscription is closed to sign in and ask again: its close is not the answer.
      let current = true
      try {
        sub = relay.subscribe([filter], {
          ...(deferChecks ? { alreadyHaveEvent: deferCheck } : {}),
          onevent: (e) => {
            if (settled || events.has(e.id)) return
            events.set(e.id, e as NostrEvent)
            stretch()
            onEvent?.(e as NostrEvent)
          },
          oneose: () => {
            // A challenge this read was not signed in with, and nothing sent:
            // a gated relay may answer a reader it does not know with an empty
            // EOSE rather than a CLOSED. Sign in and ask again, as for a
            // CLOSED, so "nothing" is never taken from it. Signed in since (the
            // pool answers a challenge on its own) it costs nothing; with the
            // signer the cause it is refused as AUTH_STALLED. A relay that
            // turned the AUTH down itself answers as on v2 (review of #570).
            const challenge = (relay as unknown as AuthRelay).challenge
            if (events.size === 0 && challenge && authedFor.get(url) !== challenge && !authTried && !relayTurnedDown(relay as unknown as AuthRelay, url)) {
              authTried = true
              signingIn = true
              current = false
              const old = sub
              sub = null
              if (old) clearTimeout(old.eoseTimeoutHandle)
              try { old?.close() } catch { /* already closed */ }
              void authOn(relay as unknown as AuthRelay, url).then(
                () => { signingIn = false; if (!settled) open() },
                (err) => finish({ url, outcome: 'refused', reason: `auth-required: ${err instanceof Error ? err.message : String(err)}`, events: got() }),
              )
              return
            }
            noteAnswered(url)
            finish({ url, outcome: 'answered', events: got() })
          },
          onclose: (reason) => {
            if (!current) return
            // Closed already (by the relay, or by us): closing it again would
            // take one more from nostr-tools' count of operations on the socket.
            if (sub) clearTimeout(sub.eoseTimeoutHandle)
            sub = null
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
    ? askOne(url, filter, deadline, { deferChecks: opts.deferChecks, ...(opts.stream ? { quietMs: opts.stream.quietMs, capAt: Date.now() + opts.stream.capMs } : {}) }).then((a) => { opts.onAnswer?.(a); return a })
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
/** How a list read waits for a relay still sending (ReadOptions.stream). */
const LIST_STREAM = { quietMs: 5_000, capMs: 60_000 }
/**
 * How long a list read waits for its first event or its EOSE: longer than a
 * lookup's 8 s, since the canonical socket is busiest at startup, when the
 * lists read, and nothing but the panel's LOADING waits on it.
 */
const LIST_WAIT_MS = 20_000

export async function queryChecked(filter: Filter): Promise<CheckedRead> {
  const answers = await queryEach(filter, LIST_WAIT_MS, { stream: LIST_STREAM })
  return { events: mergeAnswers(answers), trouble: troubleOf(answers) }
}

/** `queryAny`, the same way. */
export async function queryAnyChecked(relays: string[], filter: Filter, maxWait?: number): Promise<CheckedRead> {
  const urls = [...new Set(relays.map((r) => normalizeURL(r)))]
  const up = await reachable(urls)
  const down: RelayAnswer[] = urls.filter((u) => !up.includes(u)).map((url) => ({ url, outcome: 'unreachable', reason: 'connection failed', events: [] }))
  const answers = up.length ? await queryRelays(up, filter, maxWait ?? LIST_WAIT_MS, { stream: LIST_STREAM }) : []
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
        // Closed already: closing it again would take one more from the socket's count of operations.
        if (sub) clearTimeout(sub.eoseTimeoutHandle)
        sub = null
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
  // Not in by the end, with the signer holding its AUTH up: not read, rather than silent (review of #570).
  const unanswered = (url: string): RelayAnswer => signerHolds(url)
    ? { url, outcome: 'refused', reason: AUTH_STALLED, events: [] }
    : { url, outcome: 'unreachable', reason: 'no answer in time', events: [] }
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

// While the canonical relay's sign-in has failed, a feed it closed waits for
// the sign-in (onCanonicalSignIn, below) rather than asking again every 30 s.
const live = new LiveRegistry(liveTransport, () => authFailed.has(normalizeURL(CYBERSPACE_RELAY)))

// A feed the canonical relay closed for want of AUTH waits out a backoff of up
// to 30 s. Signed in late, the socket then sat empty, the pool closed it as
// idle, and the feed reopened on a new socket with a new AUTH, one more
// request to a bunker (review of #600, round 2). It reopens on the sign-in.
onCanonicalSignIn(() => live.retryWaiting())

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
  notifyResume()
}

/** Tell the resume listeners (catch-up reads after an absence). */
function notifyResume(): void {
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
  // Not while the canonical relay waits on the signer, or the signer refused
  // it or let it run out: an unanswered probe drops the sockets, and each new
  // socket asks the signer for AUTH again, a request to a bunker every probe.
  // An AUTH the relay itself failed (a slow OK) does not stop the probe: a
  // half-open socket would then go unnoticed for the visit (review of #600).
  const canon = normalizeURL(CYBERSPACE_RELAY)
  if (authPending(canon) || authFailed.get(canon)?.bySigner) return 'skipped'
  return probeNow(PROBE_TIMEOUT_MS)
}

/** Ask the relays in use for nothing; 'dead' (and the feeds reissued) when they do not say so within `ms`. */
async function probeNow(ms: number): Promise<'alive' | 'dead'> {
  probing = true
  try {
    const relays = skipHung(relaySet())
    const answered = await new Promise<boolean>((resolve) => {
      let settled = false
      const done = (ok: boolean): void => { if (!settled) { settled = true; resolve(ok) } }
      const timer = setTimeout(() => done(false), ms)
      const sub = getPool().subscribe(relays, { ids: [NO_SUCH_ID] }, {
        onevent: () => {},
        oneose: () => { clearTimeout(timer); done(true); sub.close() },
        onclose: () => { clearTimeout(timer); done(false) },
        onauth: authSign,
        maxWait: ms,
      })
    })
    if (answered) return 'alive'
    resumeLive()
    return 'dead'
  } finally {
    probing = false
  }
}

/** How long a tab's return gives the canonical socket in hand to answer before it is replaced. */
export const RETURN_PROBE_MS = 3_000

/**
 * Back from a real absence: the sockets in hand may be half-open, or fine.
 * Replaced unasked, every return of 15 s or more was a new canonical socket,
 * so a new AUTH and one more prompt on a bunker, with nothing wrong (the
 * real-bunker run, 2026-11-04). A canonical socket signed in now is asked
 * for nothing first and kept if it answers within RETURN_PROBE_MS; one that
 * does not is replaced as before, a few seconds later. One not signed in
 * (its AUTH failed or is waiting) is replaced at once, as before, so the
 * return can sign in afresh.
 */
export function resumeIfDead(): void {
  if (probing) return
  const canon = normalizeURL(CYBERSPACE_RELAY)
  const socket = socketOf(canon)
  const signedInNow = !!socket?.connected && !!socket.challenge && authedFor.get(canon) === socket.challenge
  if (!signedInNow || !connected() || authPending(canon) || authFailed.has(canon)) { resumeLive(); return }
  // Kept: the catch-up reads an absence calls for still run, over it.
  void probeNow(RETURN_PROBE_MS).then((r) => { if (r === 'alive') notifyResume() })
}

/**
 * Watch the tab's visibility and the network, and keep asking the connection
 * whether it is there; resume the feeds when any of them says it is not.
 */
export function watchConnectivity(on: TabEvents = { doc: document, win: window }): () => void {
  const onVisibility = (): void => {
    if (on.doc.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
    if (hiddenAt !== null && Date.now() - hiddenAt >= RESUME_AFTER_HIDDEN_MS) {
      // A device coming back may have half-open sockets, so what timed out was not the relay's doing.
      forgetHung()
      resumeIfDead()
    }
    hiddenAt = null
  }
  const onOnline = (): void => { forgetHung(); resumeLive() }
  // Not while hidden: a background tab's timers are throttled anyway, and the
  // return is handled above.
  const tick = (): void => { if (on.doc.visibilityState === 'visible') void probeLiveness() }
  on.doc.addEventListener('visibilitychange', onVisibility)
  on.win.addEventListener('online', onOnline)
  const interval = setInterval(tick, PROBE_EVERY_MS)
  return () => {
    on.doc.removeEventListener('visibilitychange', onVisibility)
    on.win.removeEventListener('online', onOnline)
    clearInterval(interval)
  }
}

/** What watchTabReturn listens to: the page's document and window, or a test's stand-ins. */
export interface TabEvents {
  doc: EventTarget & { readonly visibilityState: string }
  win: EventTarget
}

/**
 * The tab is back (visible again, shown from the back-forward cache, or
 * focused): `onBack` every time (App.tsx: the signer's sockets, the payment
 * check). A relay's AUTH that the signer refused or let run out is asked
 * again only after a real absence, the tab hidden RESUME_AFTER_HIDDEN_MS or
 * restored from the cache, and never on focus alone. An extension's popup
 * takes the focus and gives it back when DENY closes it, so asking again on
 * focus was the next popup at once: 426 in 20 s (review of #600, round 2). A
 * DENY stands for the visit until the person acts: RETRY, a sign-in, another
 * signer, or leaving the tab and coming back. Returns the unsubscribe.
 */
export function watchTabReturn(onBack: () => void, on: TabEvents = { doc: document, win: window }): () => void {
  let hiddenSince: number | null = on.doc.visibilityState === 'hidden' ? Date.now() : null
  const back = (e: Event): void => {
    if (on.doc.visibilityState === 'hidden') { hiddenSince ??= Date.now(); return }
    const away = (hiddenSince !== null && Date.now() - hiddenSince >= RESUME_AFTER_HIDDEN_MS)
      || (e.type === 'pageshow' && (e as Event & { persisted?: boolean }).persisted === true)
    hiddenSince = null
    onBack()
    // After onBack has dropped the signer's old sockets, so the request goes out over fresh ones.
    if (away) setTimeout(() => retryFailedAuth(undefined, 'back'), 0)
  }
  on.doc.addEventListener('visibilitychange', back)
  on.win.addEventListener('pageshow', back)
  on.win.addEventListener('focus', back)
  return () => {
    on.doc.removeEventListener('visibilitychange', back)
    on.win.removeEventListener('pageshow', back)
    on.win.removeEventListener('focus', back)
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
