/**
 * sig.worker.ts - checks the NIP-01 id and signature of a saved chain's
 * events off the main thread (spec §8.2, §8.7.3).
 *
 * A Schnorr check costs about 2 ms, and a saved chain can hold thousands of
 * events, so checking them on the main thread at boot held the first draw
 * for seconds. Here they are checked while the chain is already on screen;
 * lib/sigCheck.ts holds every chain action until the answer is in.
 */

import { getEventHash, verifyEvent, type VerifiedEvent } from 'nostr-tools/pure'
import type { NostrEvent } from '../lib/events'

export interface SigCheckRequest {
  events: NostrEvent[]
  /** `id:sig` of signatures this page already checked: only their ids are recomputed. */
  known?: readonly string[]
  /** Said back in the answer, by a worker kept for more than one request (lib/sigCheck.ts keepAuthentic). */
  seq?: number
}

export interface SigCheckResponse {
  /** The ids of the events whose id or signature does not verify. */
  bad: string[]
  seq?: number
}

/** How many proven signatures a kept worker holds before it starts again from none. */
export const PROVEN_KEPT = 50_000

/**
 * `id:sig` of every signature this worker has proven, so a kept worker checks
 * another relay's copy of an event by its id alone, whichever request held the
 * first copy. The id is still recomputed, so changed contents never pass.
 */
const proven = new Set<string>()

self.onmessage = (message: MessageEvent<SigCheckRequest>): void => {
  const { events, seq } = message.data
  const known = new Set(message.data.known ?? [])
  const bad: string[] = []
  for (const e of events) {
    const key = `${e.id}:${e.sig}`
    const holds = known.has(key) || proven.has(key) ? idHolds(e) : verifyEvent(e as unknown as VerifiedEvent)
    if (!holds) { bad.push(e.id); continue }
    if (!proven.has(key)) {
      if (proven.size >= PROVEN_KEPT) proven.clear()
      proven.add(key)
    }
  }
  const answer: SigCheckResponse = seq === undefined ? { bad } : { bad, seq }
  self.postMessage(answer)
}

function idHolds(e: NostrEvent): boolean {
  try { return getEventHash(e) === e.id } catch { return false }
}
