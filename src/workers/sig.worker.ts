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
}

export interface SigCheckResponse {
  /** The ids of the events whose id or signature does not verify. */
  bad: string[]
}

self.onmessage = (message: MessageEvent<SigCheckRequest>): void => {
  const known = new Set(message.data.known ?? [])
  const bad: string[] = []
  for (const e of message.data.events) {
    const holds = known.has(`${e.id}:${e.sig}`) ? idHolds(e) : verifyEvent(e as unknown as VerifiedEvent)
    if (!holds) bad.push(e.id)
  }
  const answer: SigCheckResponse = { bad }
  self.postMessage(answer)
}

function idHolds(e: NostrEvent): boolean {
  try { return getEventHash(e) === e.id } catch { return false }
}
