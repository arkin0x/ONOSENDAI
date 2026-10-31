/**
 * verifiedSigs.ts: a signature checked once on this page is not checked
 * again. Moved out of lib/relay.ts (2026-10-30) so the bag reader shares it:
 * a scan gets the same bags back at every crossing of a cube, and every
 * entry inside them had its Schnorr check run again each time (lib/hidden.ts
 * innerAuthentic; arkinox, 2026-10-30, block 101's city).
 */

import { getEventHash, verifiedSymbol, verifyEvent } from 'nostr-tools/pure'
import type { VerifiedEvent } from 'nostr-tools/core'
import type { NostrEvent } from './events'

/**
 * The signatures this page has already checked, as `id:sig`, the store's own
 * form for its saved chain (useCyberspace verifiedSigs). The pool drops a
 * repeat only within one subscription, so the same event asked for again by a
 * later one (a chain fetched for the chain view, then for a spectation, then
 * by the presence sweep) had its Schnorr check run again each time, about a
 * millisecond apiece on the main thread: 408 of the 1,144 checks at one boot
 * were repeats (arkinox, 2026-10-20: the laptop "still isn't great"; counted
 * spectating on the smoke seed). A repeat still has its id recomputed, which
 * commits to the pubkey and every other field, so only a signature already
 * checked against that exact id and pubkey is taken on trust. Only a string
 * id and sig are ever looked up or kept: an event with no signature must not
 * match an id that was never checked (review of #405).
 */
const VERIFIED_KEPT = 10_000
const verifiedSigs = new Set<string>()

/**
 * verifyEvent, skipping the Schnorr check for a signature already checked
 * here (verifiedSigs). For events freshly parsed, as the pool hands them over
 * (lib/relay.ts verifyRelayEvent) and as a bag's entries come out of its
 * decryption (lib/hidden.ts innerAuthentic, fromReference): verifyEvent
 * trusts a verdict already marked on the object, and an object marked and
 * then changed would be remembered as it is.
 */
export function verifyOnce(ev: NostrEvent): boolean {
  const key = keyOf(ev)
  if (key !== null && verifiedSigs.has(key)) {
    let same = false
    try { same = getEventHash(ev) === ev.id } catch { same = false }
    if (same) {
      // Marked as verifyEvent marks it, so a later verifyEvent on this object answers at once.
      ;(ev as unknown as Record<symbol, boolean>)[verifiedSymbol] = true
      return true
    }
  }
  const ok = verifyEvent(ev as unknown as VerifiedEvent)
  if (ok && key !== null) remember(key)
  return ok
}

function keyOf(ev: NostrEvent): string | null {
  return typeof ev.id === 'string' && typeof ev.sig === 'string' ? `${ev.id}:${ev.sig}` : null
}

function remember(key: string): void {
  if (verifiedSigs.has(key)) return
  // Oldest first out: a set keeps insertion order.
  if (verifiedSigs.size >= VERIFIED_KEPT) verifiedSigs.delete(verifiedSigs.values().next().value as string)
  verifiedSigs.add(key)
}

/** Of these, the `id:sig` of each whose signature this page has already checked. Its id must still be recomputed. */
export function alreadyChecked(events: readonly NostrEvent[]): string[] {
  const known: string[] = []
  for (const ev of events) {
    const key = keyOf(ev)
    if (key !== null && verifiedSigs.has(key)) known.push(key)
  }
  return known
}

/** A check made elsewhere (a worker) came back good: remembered and marked, as verifyEvent would here. */
export function checkedElsewhere(ev: NostrEvent): void {
  const key = keyOf(ev)
  if (key === null) return
  remember(key)
  ;(ev as unknown as Record<symbol, boolean>)[verifiedSymbol] = true
}

/**
 * The event the socket is handing over right now, whose check is being made later
 * by whoever asked (relay.ts queryChecked). Only that subscription says so, only
 * for the one frame in hand: nostr-tools asks alreadyHaveEvent and then verifyEvent
 * in one stack, and the microtask clears this before any other frame can run. An
 * event read by any other subscription is checked as it arrives, as ever.
 */
let checkedLater: string | null = null

/** For a subscription's alreadyHaveEvent: this frame's event will be checked by the asker. Always false: it is not a repeat. */
export function deferCheck(id: string): false {
  checkedLater = id
  queueMicrotask(() => { checkedLater = null })
  return false
}

/** verifyOnce, unless this very event is one whose check was deferred (deferCheck). */
export function verifyUnlessDeferred(ev: NostrEvent): boolean {
  if (checkedLater !== null && ev.id === checkedLater) {
    checkedLater = null
    return true
  }
  return verifyOnce(ev)
}
