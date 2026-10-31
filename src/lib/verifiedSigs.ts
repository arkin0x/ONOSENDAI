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
 * A signature this device checked on an earlier page, as a stored row says
 * (lib/eventDb). So an event the relays send again after a reload is not
 * checked again either. A repeat still has its id recomputed (verifyOnce).
 */
export function rememberVerified(id: string, sig: string): void {
  if (verifiedSigs.size < VERIFIED_KEPT) verifiedSigs.add(`${id}:${sig}`)
}

/**
 * verifyEvent, skipping the Schnorr check for a signature already checked
 * here (verifiedSigs). For events freshly parsed, as the pool hands them over
 * (lib/relay.ts verifyRelayEvent) and as a bag's entries come out of its
 * decryption (lib/hidden.ts innerAuthentic, fromReference): verifyEvent
 * trusts a verdict already marked on the object, and an object marked and
 * then changed would be remembered as it is.
 */
export function verifyOnce(ev: NostrEvent): boolean {
  const key = typeof ev.id === 'string' && typeof ev.sig === 'string' ? `${ev.id}:${ev.sig}` : null
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
  if (ok && key !== null && !verifiedSigs.has(key)) {
    // Oldest first out: a set keeps insertion order.
    if (verifiedSigs.size >= VERIFIED_KEPT) verifiedSigs.delete(verifiedSigs.values().next().value as string)
    verifiedSigs.add(key)
  }
  return ok
}
