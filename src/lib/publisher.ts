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
 * A module singleton rather than an effect, because React's dev double-mount
 * would otherwise start two drains, and because a publish that is already in
 * flight when the component goes away should still land and be recorded. The
 * store is the queue: an event's status is the only state, so there is nothing
 * here to get out of sync with it.
 */

import { normalizeURL } from 'nostr-tools/utils'
import { CYBERSPACE_RELAY, publish, publishMany } from './relay'
import { confirmChainEvents } from './chains'
import type { NostrEvent } from './events'
import { chainFacts, gateAfter, maySend } from './release'
import { newestEventOnRelays, useCyberspace } from '../store/useCyberspace'

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
 * counts when the canonical relay answered, or, the canonical relay silent,
 * when another relay answered holding the newest event already on the
 * relays. A look nobody answered proves nothing, and a send retried a moment
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
  let s = useCyberspace.getState()
  if (!maySend(s, released)) return
  if (!s.events.some((e) => s.published[e.id] !== 'ok')) { backlogChecked = false; return }

  const waiting = s.events.filter((e) => s.published[e.id] !== 'ok').length
  if (!backlogChecked && (waiting > 1 || lastFailed)) {
    inFlight = true
    const answered = await preflight()
    inFlight = false
    s = useCyberspace.getState()
    if (!maySend(s, released)) return
    if (!answered) { retryLater(); return }
    backlogChecked = true
  }
  const next = s.events.find((e) => s.published[e.id] !== 'ok')
  if (!next) { backlogChecked = false; return }

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

/** Events another relay took and the canonical relay has not, with when they were first sent. */
const notOnCanonical = new Map<string, { event: NostrEvent; since: number }>()
let canonicalHandle: ReturnType<typeof setTimeout> | null = null
let canonicalBackoff = CANONICAL_RETRY_MS

/**
 * Where that set is kept for an identity, beside its saved chain: a reload
 * used to forget it, and the canonical relay never got those events
 * (verification of #236, finding 3). Event ids and when each was first sent;
 * the events themselves are in the saved chain.
 */
const pendingKeyFor = (pubkey: string): string => `onosendai:canonical-pending:${pubkey}`

function savePending(pubkey: string): void {
  const entries: Record<string, number> = {}
  for (const [id, { event, since }] of notOnCanonical) if (event.pubkey === pubkey) entries[id] = since
  try {
    if (Object.keys(entries).length === 0) localStorage.removeItem(pendingKeyFor(pubkey))
    else localStorage.setItem(pendingKeyFor(pubkey), JSON.stringify(entries))
  } catch { /* private mode: the retry still runs for this page */ }
}

/** Take up the set saved for the current identity: what a reload or a switch back left waiting. */
function restorePending(): void {
  const s = useCyberspace.getState()
  let saved: Record<string, number> = {}
  try { saved = JSON.parse(localStorage.getItem(pendingKeyFor(s.identity.pubkey)) ?? '{}') as Record<string, number> } catch { saved = {} }
  const byId = new Map(s.events.map((e) => [e.id, e]))
  for (const [id, since] of Object.entries(saved)) {
    const event = byId.get(id)
    if (event && !notOnCanonical.has(id)) notOnCanonical.set(id, { event, since })
  }
  reportCanonicalLate()
  scheduleCanonical()
}

/** How many of them have waited past CANONICAL_LATE_MS, for the status strip. */
function reportCanonicalLate(): void {
  const now = Date.now()
  // Only what is on the chain in hand counts: another identity's set waits
  // in its own storage until that identity is back (restorePending).
  const onChain = new Set(useCyberspace.getState().events.map((e) => e.id))
  let late = 0
  let nextLate = Infinity
  for (const [id, { since }] of notOnCanonical) {
    if (!onChain.has(id)) continue
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
  if (canonicalHandle === null && notOnCanonical.size > 0) canonicalHandle = setTimeout(retryCanonical, canonicalBackoff)
}

/** Keep asking the canonical relay to take `event` until it does. */
function awaitCanonical(event: NostrEvent): void {
  if (!notOnCanonical.has(event.id)) notOnCanonical.set(event.id, { event, since: Date.now() })
  savePending(event.pubkey)
  reportCanonicalLate()
  scheduleCanonical()
}

/**
 * Published events the canonical relay was found not to hold (the startup
 * self-check, lib/selfSync.ts): asked again in the background like any
 * other, whatever this page remembers.
 */
export function requeueForCanonical(events: NostrEvent[]): void {
  for (const e of events) awaitCanonical(e)
}

async function retryCanonical(): Promise<void> {
  canonicalHandle = null
  const s = useCyberspace.getState()
  const ids = new Set(s.events.map((e) => e.id))
  for (const [id, { event }] of [...notOnCanonical]) {
    // An event no longer on this device's chain (a respawn, another chain
    // kept) is not worth sending; another identity's is still in its own
    // storage, for when that identity is back.
    if (!ids.has(id)) { notOnCanonical.delete(id); continue }
    const result = await publishMany([CANONICAL], event)
    if (result.ok) notOnCanonical.delete(id)
  }
  savePending(s.identity.pubkey)
  reportCanonicalLate()
  if (notOnCanonical.size === 0) { canonicalBackoff = CANONICAL_RETRY_MS; return }
  canonicalBackoff = Math.min(canonicalBackoff * 2, RETRY_MAX_MS)
  canonicalHandle = setTimeout(retryCanonical, canonicalBackoff)
}

/** Idempotent. Subscribes once for the life of the page. */
export function startPublisher(): void {
  if (started) return
  started = true
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

  // No pump on startup. The gate starts shut, so a reload with Live
  // remembered sends nothing until the next action is taken.
}
