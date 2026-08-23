/**
 * publisher.ts — drains the chain onto the relay, in order, while Live.
 *
 * One event at a time, oldest unpublished first. Order matters: a hop names
 * its predecessor, and a relay that sees the hop before the spawn will still
 * store it, but anyone reassembling the chain in between sees a hop with no
 * genesis. Sending them in chain order means every prefix the relay holds is
 * itself a valid chain.
 *
 * A module singleton rather than an effect, because React's dev double-mount
 * would otherwise start two drains, and because a publish that is already in
 * flight when the component goes away should still land and be recorded. The
 * store is the queue: an event's status is the only state, so there is nothing
 * here to get out of sync with it.
 */

import { publish } from './relay'
import { useCyberspace } from '../store/useCyberspace'

/** First retry after a refusal or a dead socket; doubles up to the cap. */
const RETRY_MS = 4000
const RETRY_MAX_MS = 60_000

let started = false
let inFlight = false
let retryHandle: number | null = null
let backoff = RETRY_MS

async function pump(): Promise<void> {
  if (inFlight) return
  const s = useCyberspace.getState()
  if (!s.live) return
  const next = s.events.find((e) => s.published[e.id] !== 'ok')
  if (!next) return

  inFlight = true
  s.setPublishStatus(next.id, 'sending')
  const result = await publish(next)
  inFlight = false

  // Re-read: Live may have been switched off, or the chain respawned, while
  // the socket was waiting. A result for an event no longer in the chain is
  // dropped by setPublishStatus itself.
  const now = useCyberspace.getState()
  if (result.ok) {
    now.setPublishStatus(next.id, 'ok')
    backoff = RETRY_MS
    if (now.live) void pump()
    return
  }

  now.setPublishStatus(next.id, 'failed', result.reason)
  if (!now.live) return
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
    if (s.live === prev.live && s.events === prev.events) return
    if (!s.live) {
      // Switching off stops retrying. An in-flight send is allowed to finish.
      if (retryHandle !== null) { clearTimeout(retryHandle); retryHandle = null }
      return
    }
    // Switching on, or a new event: try now rather than waiting out a backoff.
    if (retryHandle !== null) { clearTimeout(retryHandle); retryHandle = null }
    backoff = RETRY_MS
    void pump()
  })

  void pump()
}
