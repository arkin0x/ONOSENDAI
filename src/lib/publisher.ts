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

import { publish } from './relay'
import { askChainEvents } from './chains'
import { mergeAnswers } from './relayOutcome'
import { chainFacts, gateAfter, maySend } from './release'
import { useCyberspace } from '../store/useCyberspace'

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
 * A single fresh action needs no look: the commit that signed it looked
 * a moment ago (useCyberspace freshHead).
 *
 * The look counts only when a relay really answered (relayOutcome.ts). A
 * look taken while the relays were unreachable proves nothing, and a send
 * retried a moment later, once they are back, would go out into a fork
 * nobody checked for. So with no answer nothing is sent, and the publisher
 * tries again on its usual backoff, looking again first. Resolves to whether
 * a relay answered.
 */
async function preflight(): Promise<boolean> {
  const pubkey = useCyberspace.getState().identity.pubkey
  let answered = false
  try {
    const answers = await askChainEvents(pubkey)
    answered = answers.some((a) => a.outcome === 'answered')
    const events = mergeAnswers(answers)
    const now = useCyberspace.getState()
    if (now.identity.pubkey === pubkey && events.length > 0) now.adoptChain(events)
  } catch { /* the query reports rather than throws; nothing answered */ }
  return answered
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

/** Idempotent. Subscribes once for the life of the page. */
export function startPublisher(): void {
  if (started) return
  started = true

  useCyberspace.subscribe((s, prev) => {
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
