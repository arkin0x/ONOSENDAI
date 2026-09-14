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
import { chainFacts, gateAfter } from './release'
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

async function pump(): Promise<void> {
  if (inFlight) return
  const s = useCyberspace.getState()
  if (!s.live || !released) return
  const next = s.events.find((e) => s.published[e.id] !== 'ok')
  if (!next) return

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
    if (now.live && released) void pump()
    return
  }

  now.setPublishStatus(next.id, 'failed', result.reason)
  if (!now.live || !released) return
  retryHandle = window.setTimeout(() => {
    retryHandle = null
    backoff = Math.min(backoff * 2, RETRY_MAX_MS)
    void pump()
  }, backoff)
}

/** Idempotent. Subscribes once for the life of the page. */
export function startPublisher(): void {
  if (started) return
  started = true

  useCyberspace.subscribe((s, prev) => {
    // Every change is offered to the gate first, because the thing that opens
    // it, a new head signed here, arrives as an ordinary store update.
    released = gateAfter(released, chainFacts(prev), chainFacts(s))
    if (s.live === prev.live && s.events === prev.events) return
    if (!s.live || !released) {
      // Local, or Live with the gate still shut: stop retrying. An in-flight
      // send is allowed to finish.
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
