/**
 * publisher.ts — drains the chain onto the relay, in order, while Live and
 * released.
 *
 * One event at a time, oldest unpublished first. Order matters: a hop names
 * its predecessor, and a relay that sees the hop before the spawn will still
 * store it, but anyone reassembling the chain in between sees a hop with no
 * genesis. Sending them in chain order means every prefix the relay holds is
 * itself a valid chain.
 *
 * Live is necessary and no longer sufficient. The release gate in release.ts
 * says whether the switch being on has yet been followed by an action taken
 * while it was on, and nothing drains until it has. The gate is consulted
 * here and nowhere else; it changes whether this file runs, never the order
 * in which it sends, so the prefix invariant above is untouched by it.
 *
 * A deploy that requires newer chain rules than this build's holds every
 * send (lib/versionGate.ts): each event here is a kind 3333, signed in the
 * format this build knows, and a stale tab must not go on publishing that
 * format after the rules change. What waits is kept, as for LOCAL, and the
 * reloaded build decides what becomes of it.
 *
 * A module singleton rather than an effect, because React's dev double-mount
 * would otherwise start two drains, and because a publish that is already in
 * flight when the component goes away should still land and be recorded. The
 * store is the queue: an event's status is the only state, so there is nothing
 * here to get out of sync with it.
 */

import { normalizeURL } from 'nostr-tools/utils'
import { getEventHash } from 'nostr-tools/pure'
import { CYBERSPACE_RELAY, askRelay, countRelay, publish, publishOnceTo } from './relay'
import { AUTH_STALLED } from './relayOutcome'
import { confirmChainEvents } from './chains'
import { noteChainHolders } from './chainHolders'
import { chainLanded, onReleased } from './chainStore'
import type { NostrEvent } from './events'
import { chainFacts, gateAfter, maySend } from './release'
import { newestEventOnRelays, noteStaleFormatStuck, retireStaleFormat, useCyberspace } from '../store/useCyberspace'
import { staleHopFormat } from './staleFormat'
import { movementBlocked, useVersionGate } from './versionGate'

/** First retry after a refusal or a dead socket; doubles up to the cap. */
const RETRY_MS = 4000
const RETRY_MAX_MS = 60_000

let started = false
let inFlight = false
/** The release gate (release.ts). Shut until an action is taken while Live. */
let released = false
let retryHandle: number | null = null
let backoff = RETRY_MS
/** The relays were looked at for this backlog already; reset when it drains, fails, or LIVE goes off. */
let backlogChecked = false
/** The last send failed, so the next one starts a fresh look at the relays. */
let lastFailed = false

/**
 * Look at the relays once before sending a backlog: more than one event
 * waiting (LIVE after a LOCAL stretch, or a reload) or a retry after a failed
 * send (back from offline). Another device signed in as you may have
 * published from the same point meanwhile, and these events would fork
 * against it; adoptChain finds that and raises the diverged-branch prompt
 * (lib/branchConflict.ts), which stops the drain before anything goes out.
 * A single fresh action needs no look: the action that signed it confirmed
 * the head a moment ago (useCyberspace confirmHead).
 *
 * The look is the same confirmation a move takes (chains.ts
 * confirmChainEvents, arkinox's ruling of 2026-10-08, option B): the
 * canonical relay and every configured relay are asked together, and it
 * counts when the canonical relay answered (every relay that holds this
 * chain then waited for up to 2.5 s), or, the canonical relay
 * silent, when another relay answered holding the newest event already on
 * the relays. A look nobody answered proves nothing, and a send retried a moment
 * later would go out into a fork nobody checked for. So with no answer
 * nothing is sent, and the publisher tries again on its usual backoff,
 * looking again first. Resolves to whether the look counted.
 */
async function preflight(): Promise<boolean> {
  const s = useCyberspace.getState()
  const pubkey = s.identity.pubkey
  const anchor = newestEventOnRelays(s.events, s.published)
  const events = await confirmChainEvents(pubkey, s.genesisId || undefined, s.events, { since: anchor?.created_at, anchorId: anchor?.id }).catch(() => null)
  if (events === null) return false
  const now = useCyberspace.getState()
  if (now.identity.pubkey === pubkey && events.length > 0) now.adoptChain(events)
  return true
}

/** Try again after the current backoff, doubling it for the time after. */
function retryLater(): void {
  if (retryHandle !== null) return
  retryHandle = window.setTimeout(() => {
    retryHandle = null
    backoff = Math.min(backoff * 2, RETRY_MAX_MS)
    void pump()
  }, backoff)
}

async function pump(): Promise<void> {
  if (inFlight) return
  // Held, not failed: nothing is retried until the hold lifts (startPublisher).
  if (movementBlocked()) return
  let s = useCyberspace.getState()
  if (!maySend(s, released)) return
  if (!s.events.some((e) => s.published[e.id] !== 'ok')) { backlogChecked = false; return }

  const waiting = s.events.filter((e) => s.published[e.id] !== 'ok').length
  if (!backlogChecked && (waiting > 1 || lastFailed)) {
    inFlight = true
    const answered = await preflight()
    inFlight = false
    s = useCyberspace.getState()
    if (!maySend(s, released) || movementBlocked()) return
    if (!answered) { retryLater(); return }
    backlogChecked = true
  }
  const next = s.events.find((e) => s.published[e.id] !== 'ok')
  if (!next) { backlogChecked = false; return }
  // Never a hop in the old proof format (hop proof version 2): the store
  // cuts it away as it lands, and this is the last place it could slip out.
  // Cut here too, and the drain goes on from the chain that is left.
  // A cut is declined when an event after it is already published: then it
  // is never sent, the player is told once, and this chain's queue waits
  // (nothing else does; other publishing goes out by its own paths).
  if (staleHopFormat(next)) { if (retireStaleFormat() === null) noteStaleFormatStuck(next); return }

  // An action goes out only once it has landed on this device, because that
  // is where two tabs that signed from one head find out which of them won.
  // The loser's action never leaves (lib/chainStore.ts), and the store update
  // that takes it back asks for the next drain. The microtask lets the save
  // that follows the store update which got us here be made first.
  inFlight = true
  await Promise.resolve()
  const landed = await chainLanded(next.pubkey, next.id)
  inFlight = false
  s = useCyberspace.getState()
  if (!landed || !maySend(s, released) || movementBlocked() || !s.events.some((e) => e.id === next.id)) return

  inFlight = true
  s.setPublishStatus(next.id, 'sending')
  const result = await publish(next)
  inFlight = false

  // Re-read: Live may have been switched off, which also shuts the gate, or
  // the chain respawned, while the socket was waiting. A result for an event
  // no longer in the chain is dropped by setPublishStatus itself.
  const now = useCyberspace.getState()
  if (result.ok) {
    // Published once any relay took it (arkinox's ruling of 2026-10-08,
    // option B). The canonical relay is where every other device looks, so
    // when it was not among them it is asked again in the background.
    if (result.accepted && !result.accepted.includes(CANONICAL)) awaitCanonical(next)
    // Every relay that took it now holds this chain, and a move's
    // confirmation waits for it from now on (chainHolders.ts).
    if (result.accepted) noteChainHolders(next.pubkey, result.accepted)
    now.setPublishStatus(next.id, 'ok')
    backoff = RETRY_MS
    lastFailed = false
    if (maySend(now, released)) void pump()
    return
  }

  now.setPublishStatus(next.id, 'failed', result.reason)
  lastFailed = true
  backlogChecked = false
  if (!maySend(now, released)) return
  retryLater()
}

/** The canonical relay, as publish results name relays. */
const CANONICAL = normalizeURL(CYBERSPACE_RELAY)
/** First wait before the canonical relay is asked again; doubles up to the cap. */
const CANONICAL_RETRY_MS = 5_000
/** After this long without the canonical relay, the status strip says so. */
export const CANONICAL_LATE_MS = 60_000
/**
 * Ids asked about in one COUNT or REQ, one filter each. relay.onosendai.tech
 * (grain) answers at most 500 events to a filter; half that leaves room, so
 * an answer cut short by a relay's cap is never read as ids it lacks.
 */
export const CANONICAL_CHECK_BATCH = 250
/** How long one COUNT or REQ of the check waits for the relay's answer. */
const CANONICAL_CHECK_MS = 8_000
/**
 * Passes in a row whose check of an entry went unanswered (a timeout, no
 * socket) before it is sent anyway: the relay's "duplicate:" clears what it
 * had, and what it lacked lands.
 */
export const CANONICAL_UNANSWERED_PASSES = 3
/**
 * The pause between two sends to the canonical relay. It takes 10 events a
 * second on one connection and 8 a second of kind 3333; one at a time, each
 * waiting for its OK and then this long, stays well under both.
 */
export const CANONICAL_SEND_GAP_MS = 250
/** During a long send, the strip and the saved set are brought up to date this often (in sends). */
const CANONICAL_REPORT_EVERY = 10
/**
 * A relay's refusal of this one event, whatever is sent after it (NIP-01
 * prefixes): the pass goes on to the next. rate-limited is not one of them:
 * the next would be refused too, so the pass ends there.
 */
const REFUSED_FOR_GOOD = /^(invalid|blocked|restricted|pow|error):/i

/**
 * One event another relay took and the canonical relay may not have. `since`
 * is when it was first sent. `missing` is what is known of it: true when the
 * canonical relay never said OK to this page's own send of it (awaitCanonical),
 * or a check by id was answered without it, or it refused it; false for a
 * suspect (the startup self-check did not see it in the relay's newest page)
 * or what a build before this one saved, which a check decides. A missing
 * entry is sent again on every pass, whatever the check says, unless the
 * check finds it there; only missing entries count on the status strip.
 * `unanswered`: passes in a row in which its check got no answer.
 */
interface Pending { event: NostrEvent; since: number; missing: boolean; unanswered: number }

/** Events another relay took and the canonical relay has not been seen to hold. */
const notOnCanonical = new Map<string, Pending>()
let canonicalHandle: ReturnType<typeof setTimeout> | null = null
let canonicalBackoff = CANONICAL_RETRY_MS
/** The check and re-send in progress, so a second call joins it rather than starting another. */
let reconciling: Promise<void> | null = null

/**
 * Where that set is kept for an identity, beside its saved chain: a reload
 * used to forget it, and the canonical relay never got those events
 * (verification of #236, finding 3). Per event id: when it was first sent,
 * as a number for an entry not known to be missing, or as [since, 1] for one
 * that is. A bare number is also what builds before this one saved, for
 * every entry: those lists are asked about again before anything is counted,
 * so a list the relay has since caught up on clears silently.
 */
const pendingKeyFor = (pubkey: string): string => `onosendai:canonical-pending:${pubkey}`

function savePending(pubkey: string): void {
  const entries: Record<string, number | [number, 1]> = {}
  for (const [id, { event, since, missing }] of notOnCanonical) if (event.pubkey === pubkey) entries[id] = missing ? [since, 1] : since
  try {
    if (Object.keys(entries).length === 0) localStorage.removeItem(pendingKeyFor(pubkey))
    else localStorage.setItem(pendingKeyFor(pubkey), JSON.stringify(entries))
  } catch { /* private mode: the retry still runs for this page */ }
}

/** Take up the set saved for the current identity: what a reload or a switch back left waiting. */
function restorePending(): void {
  const s = useCyberspace.getState()
  let saved: Record<string, unknown> = {}
  try { saved = JSON.parse(localStorage.getItem(pendingKeyFor(s.identity.pubkey)) ?? '{}') as Record<string, unknown> } catch { saved = {} }
  const byId = new Map(s.events.map((e) => [e.id, e]))
  for (const [id, value] of Object.entries(saved)) {
    const event = byId.get(id)
    if (!event || notOnCanonical.has(id)) continue
    const since = Array.isArray(value) ? Number(value[0]) : Number(value)
    if (!Number.isFinite(since)) continue
    notOnCanonical.set(id, { event, since, missing: Array.isArray(value) && value[1] === 1, unanswered: 0 })
  }
  reportCanonicalLate()
  scheduleCanonical()
}

/**
 * How many have waited past CANONICAL_LATE_MS, for the status strip. Only
 * missing entries count: a suspect, a list an older build saved, or an
 * entry whose check went unanswered never raises the warning on its own.
 */
function reportCanonicalLate(): void {
  const now = Date.now()
  // Only what is on the chain in hand counts: another identity's set waits
  // in its own storage until that identity is back (restorePending).
  const onChain = new Set(useCyberspace.getState().events.map((e) => e.id))
  let late = 0
  let nextLate = Infinity
  for (const [id, { since, missing }] of notOnCanonical) {
    if (!missing || !onChain.has(id)) continue
    if (now - since >= CANONICAL_LATE_MS) late++
    else nextLate = Math.min(nextLate, since + CANONICAL_LATE_MS)
  }
  if (useCyberspace.getState().canonicalLate !== late) useCyberspace.setState({ canonicalLate: late })
  // Said at the minute itself, not at the next retry after it.
  clearTimeout(lateHandle)
  if (nextLate !== Infinity) lateHandle = setTimeout(reportCanonicalLate, Math.max(0, nextLate - now))
}
let lateHandle: ReturnType<typeof setTimeout> | undefined

function scheduleCanonical(): void {
  if (canonicalHandle === null && reconciling === null && notOnCanonical.size > 0) canonicalHandle = setTimeout(() => { canonicalHandle = null; void reconcileCanonical() }, canonicalBackoff)
}

/**
 * Keep asking the canonical relay to take `event` until it holds it. The
 * relay never said OK to this send, so it is missing until a check finds it
 * there: sent again on the next pass, and counted on the strip after
 * CANONICAL_LATE_MS (a real outage of the canonical relay shows).
 */
function awaitCanonical(event: NostrEvent): void {
  const entry = notOnCanonical.get(event.id)
  if (entry) entry.missing = true
  else notOnCanonical.set(event.id, { event, since: Date.now(), missing: true, unanswered: 0 })
  savePending(event.pubkey)
  reportCanonicalLate()
  scheduleCanonical()
}

/**
 * Published events the canonical relay may not hold (the startup self-check,
 * lib/selfSync.ts): suspects, checked by id in the background, and sent
 * again only if the canonical relay does not have them.
 */
export function requeueForCanonical(events: NostrEvent[]): void {
  // Saved and counted once for the lot: per event, a long chain's suspects
  // rewrote the whole saved set once each, on every load.
  const now = Date.now()
  const pubkeys = new Set<string>()
  for (const e of events) {
    if (!notOnCanonical.has(e.id)) notOnCanonical.set(e.id, { event: e, since: now, missing: false, unanswered: 0 })
    pubkeys.add(e.pubkey)
  }
  for (const pk of pubkeys) savePending(pk)
  reportCanonicalLate()
  scheduleCanonical()
}

/** The event the relay sent back is the one asked for: its id is the hash of what came. */
function sameEvent(e: NostrEvent): boolean {
  try { return getEventHash(e) === e.id } catch { return false }
}

/** A REQ the relay refused for want of a sign-in this page could not give (the signer said no, or holds it up). */
function refusedForAuth(reason: string): boolean {
  return /^auth-required:/i.test(reason) || reason === AUTH_STALLED
}

/**
 * Bring the canonical relay up to this device's chain, and the pending set
 * down to what it truly lacks. Runs on the backoff while anything is pending;
 * exported so a test can run one pass and wait for it.
 *
 * The check, per batch of CANONICAL_CHECK_BATCH ids, one after another over
 * the one socket the pool keeps to the relay:
 *  - a COUNT first (NIP-45): a batch the relay holds whole is dropped on
 *    that alone, so a long list it caught up on costs a few small answers,
 *    not the events again;
 *  - otherwise a REQ by those ids: every event it sends back (checked
 *    against its own hash) is dropped, whatever else the answer was, and,
 *    when the relay answered, the rest of the batch is missing for certain;
 *  - a REQ refused for want of AUTH (the relay challenges every socket and
 *    an empty answer on one not signed in is taken for a gate; with the
 *    signer saying no, that is the answer) says nothing about the events,
 *    and a plain EVENT still lands where reads are open, so that batch is
 *    sent this pass;
 *  - a REQ that got no answer is unknown: nothing marked, the check of the
 *    rest waits for the next pass, and an entry unknown for
 *    CANONICAL_UNANSWERED_PASSES passes in a row is sent anyway.
 *
 * Then what is missing, or sent anyway, goes out in chain order, one event
 * at a time over the same socket (publishOnceTo: never a fresh socket per
 * event), CANONICAL_SEND_GAP_MS apart; the relay's OK true "duplicate:"
 * counts as held. A refusal of one event for good (invalid, blocked,
 * restricted) skips it; any other failure, rate-limited included, ends the
 * pass, and the backoff tries again. An event the relay truly never got is
 * sent again on every pass until it lands.
 *
 * A newer deploy's rules (versionGate) hold the sends, not the check: asking
 * is not publishing, so a stale list still clears while the hold stands.
 */
export function reconcileCanonical(): Promise<void> {
  if (canonicalHandle !== null) { clearTimeout(canonicalHandle); canonicalHandle = null }
  reconciling ??= (async () => {
    const pubkey = useCyberspace.getState().identity.pubkey
    try {
      await reconcileOnce(pubkey)
    } catch {
      // Whatever escaped is a pass that did not finish: tried again on the backoff.
    } finally {
      reconciling = null
      savePending(pubkey)
      reportCanonicalLate()
      if (notOnCanonical.size === 0) canonicalBackoff = CANONICAL_RETRY_MS
      else { canonicalBackoff = Math.min(canonicalBackoff * 2, RETRY_MAX_MS); scheduleCanonical() }
    }
  })()
  return reconciling
}

async function reconcileOnce(pubkey: string): Promise<void> {
  const switched = (): boolean => useCyberspace.getState().identity.pubkey !== pubkey
  // An event no longer on this device's chain (a respawn, another chain
  // kept) is not worth sending; another identity's is still in its own
  // storage, for when that identity is back.
  const onChain = new Set(useCyberspace.getState().events.map((e) => e.id))
  for (const id of [...notOnCanonical.keys()]) if (!onChain.has(id)) notOnCanonical.delete(id)

  /** Sent this pass although not known to be missing: refused for AUTH, or unanswered too long. */
  const anyway = new Set<string>()
  const unknown = (ids: string[]): void => {
    for (const id of ids) {
      const entry = notOnCanonical.get(id)
      if (entry && ++entry.unanswered >= CANONICAL_UNANSWERED_PASSES) anyway.add(id)
    }
  }
  const ids = [...notOnCanonical.keys()]
  for (let i = 0; i < ids.length; i += CANONICAL_CHECK_BATCH) {
    const batch = ids.slice(i, i + CANONICAL_CHECK_BATCH)
    const filter = { ids: batch, limit: batch.length }
    const counted = await countRelay(CANONICAL, filter, CANONICAL_CHECK_MS).catch(() => null)
    if (switched()) return
    // Exactly the batch: a relay that ignored the ids would count more, and is not believed.
    if (counted === batch.length) {
      for (const id of batch) notOnCanonical.delete(id)
      continue
    }
    const answer = await askRelay(CANONICAL, filter, () => {}, { maxWait: CANONICAL_CHECK_MS }).catch(() => null)
    if (switched()) return
    // What came back is held, however the answer ended.
    for (const e of answer?.events ?? []) if (notOnCanonical.has(e.id) && sameEvent(e)) notOnCanonical.delete(e.id)
    const rest = batch.filter((id) => notOnCanonical.has(id))
    if (answer?.outcome === 'answered') {
      for (const id of rest) { const entry = notOnCanonical.get(id)!; entry.missing = true; entry.unanswered = 0 }
      continue
    }
    if (answer?.outcome === 'refused' && refusedForAuth(answer.reason)) {
      for (const id of rest) { notOnCanonical.get(id)!.unanswered = 0; anyway.add(id) }
      continue
    }
    // Unknown, not missing: this batch and the ones not asked about yet.
    unknown([...rest, ...ids.slice(i + CANONICAL_CHECK_BATCH).filter((id) => notOnCanonical.has(id))])
    break
  }
  // The check's verdict is on the strip before the sends, which can take a while.
  savePending(pubkey)
  reportCanonicalLate()

  // Held while a newer deploy's rules stand: sent on a later pass.
  if (movementBlocked()) return
  const order = new Map(useCyberspace.getState().events.map((e, i) => [e.id, i]))
  const toSend = [...notOnCanonical.values()]
    .filter((p) => (p.missing || anyway.has(p.event.id)) && order.has(p.event.id))
    .sort((a, b) => order.get(a.event.id)! - order.get(b.event.id)!)
  for (let i = 0; i < toSend.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, CANONICAL_SEND_GAP_MS))
    if (switched() || movementBlocked()) return
    if (i > 0 && i % CANONICAL_REPORT_EVERY === 0) { savePending(pubkey); reportCanonicalLate() }
    const entry = toSend[i]
    if (!notOnCanonical.has(entry.event.id)) continue
    const result = await publishOnceTo(CANONICAL, entry.event).catch((err: unknown) => ({ ok: false as const, reason: String(err) }))
    if (switched()) return
    if (result.ok) { notOnCanonical.delete(entry.event.id); continue }
    if (!REFUSED_FOR_GOOD.test(result.reason)) return
    // Not on the relay, and it says it will not take it: counted, and the rest go on.
    entry.missing = true
  }
}

/** Idempotent. Subscribes once for the life of the page. */
export function startPublisher(): void {
  if (started) return
  started = true
  // Actions held back until a commit or the relays answered are free: the drain goes on, behind the same gate.
  onReleased(() => { if (maySend(useCyberspace.getState(), released)) void pump() })
  // What a reload left waiting for the canonical relay is asked for again.
  restorePending()

  useCyberspace.subscribe((s, prev) => {
    // Another identity: its own set, and its own count on the strip.
    if (s.identity.pubkey !== prev.identity.pubkey) restorePending()
    // Every change is offered to the gate first, because the thing that opens
    // it, a new head signed here, arrives as an ordinary store update.
    released = gateAfter(released, chainFacts(prev), chainFacts(s))
    if (s.live === prev.live && s.events === prev.events && s.held === prev.held && s.publishRequest === prev.publishRequest && s.chainConflict === prev.chainConflict) return
    if (!s.live) backlogChecked = false
    if (!maySend(s, released)) {
      // Local, Live with the gate still shut, or a held chain: stop retrying.
      // An in-flight send is allowed to finish.
      if (retryHandle !== null) { clearTimeout(retryHandle); retryHandle = null }
      return
    }
    // A new action, with the gate now open: try at once rather than waiting
    // out a backoff. Switching on no longer lands here, because the flip
    // leaves the gate shut.
    if (retryHandle !== null) { clearTimeout(retryHandle); retryHandle = null }
    backoff = RETRY_MS
    void pump()
  })

  // A hold for a newer deploy's chain rules lifted (a later answer with a
  // lower epoch, a revert): what waited goes out as it would have.
  useVersionGate.subscribe((v, prev) => {
    if (prev.verdict !== 'blocked' || v.verdict === 'blocked') return
    if (maySend(useCyberspace.getState(), released)) void pump()
  })

  // No pump on startup. The gate starts shut, so a reload with Live
  // remembered sends nothing until the next action is taken.
}
