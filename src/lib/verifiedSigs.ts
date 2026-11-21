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
 * spectating on the smoke seed). A repeat is still held to its id: its
 * fields are compared with those that hashed to it (bodies, below) or, with
 * none kept, its id is recomputed, so only a signature already checked
 * against that exact id and pubkey is taken on trust. Only a string id and
 * sig are ever looked up or kept: an event with no signature must not match
 * an id that was never checked (review of #405).
 */
const VERIFIED_KEPT = 10_000
const verifiedSigs = new Set<string>()

/**
 * The fields of an event this page verified, as they were when it verified
 * them, by `id:sig`: what a repeat is compared with instead of hashed again
 * (owner's phone walk of 2026-11-21, build #847). A WALK step on eight relays
 * brought about a hundred copies of the same few chain events (the head
 * confirmation's answer from every relay, and each relay pushing the step
 * back to every subscription it matches), and recomputing each copy's id,
 * a SHA-256 over about 9 KB, was most of every socket message's 100 to 230 ms
 * on his phone. A copy whose pubkey, created_at, kind, tags and content are
 * each equal to those of a copy that hashed to this id hashes to it too, so
 * comparing them is the same check, without the hash. Kept up to
 * BODIES_KEPT_CHARS of content and tags, oldest out; a repeat with no body
 * kept is hashed, as before.
 */
interface Body { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; chars: number }
const BODIES_KEPT_CHARS = 8_000_000
/** Larger than this, a body is not kept: a few such would push out hundreds of chain events. */
const BODY_MAX_CHARS = 200_000
const bodies = new Map<string, Body>()
let bodyChars = 0

function bodyOf(ev: NostrEvent): Body | null {
  if (typeof ev.pubkey !== 'string' || typeof ev.created_at !== 'number' || typeof ev.kind !== 'number' || typeof ev.content !== 'string' || !Array.isArray(ev.tags)) return null
  // Each tag and each value counts at least one, so a body of many empty tags is not free.
  let chars = ev.content.length + ev.pubkey.length
  const tags: string[][] = []
  for (const t of ev.tags) {
    if (!Array.isArray(t)) return null
    chars += 1
    const copy: string[] = []
    for (const v of t) { if (typeof v !== 'string') return null; copy.push(v); chars += v.length + 1 }
    tags.push(copy)
  }
  // A copy of the tags: a caller changing the event it was handed cannot change what is remembered.
  return { pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags, content: ev.content, chars }
}

/** Whether `ev` has exactly the fields `b` remembers, every value the same type and value. */
function sameBody(b: Body, ev: NostrEvent): boolean {
  if (ev.pubkey !== b.pubkey || ev.created_at !== b.created_at || ev.kind !== b.kind || ev.content !== b.content) return false
  const tags = ev.tags as unknown
  if (!Array.isArray(tags) || tags.length !== b.tags.length) return false
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i] as unknown
    const k = b.tags[i]
    if (!Array.isArray(t) || t.length !== k.length) return false
    for (let j = 0; j < t.length; j++) if (t[j] !== k[j]) return false
  }
  return true
}

function keepBody(key: string, ev: NostrEvent): void {
  if (bodies.has(key)) return
  const b = bodyOf(ev)
  if (!b || b.chars > BODY_MAX_CHARS) return
  bodies.set(key, b)
  bodyChars += b.chars
  // Oldest first out: a map keeps insertion order.
  for (const [k, old] of bodies) {
    if (bodyChars <= BODIES_KEPT_CHARS) break
    bodies.delete(k)
    bodyChars -= old.chars
  }
}

function forgetBody(key: string): void {
  const b = bodies.get(key)
  if (!b) return
  bodies.delete(key)
  bodyChars -= b.chars
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
  const key = keyOf(ev)
  if (key !== null && verifiedSigs.has(key)) {
    let same = false
    const body = bodies.get(key)
    if (body) same = sameBody(body, ev)
    if (!same) {
      try { same = getEventHash(ev) === ev.id } catch { same = false }
      // Hashed to its id just now: its fields are remembered, so the next copy is compared.
      if (same) keepBody(key, ev)
    }
    if (same) {
      // Marked as verifyEvent marks it, so a later verifyEvent on this object answers at once.
      ;(ev as unknown as Record<symbol, boolean>)[verifiedSymbol] = true
      return true
    }
  }
  // verifyEvent trusts a verdict already marked on the object: only fields it hashed itself are remembered.
  const marked = (ev as unknown as Record<symbol, unknown>)[verifiedSymbol] === true
  const ok = verifyEvent(ev as unknown as VerifiedEvent)
  if (ok && key !== null) { remember(key); if (!marked) keepBody(key, ev) }
  return ok
}

function keyOf(ev: NostrEvent): string | null {
  return typeof ev.id === 'string' && typeof ev.sig === 'string' ? `${ev.id}:${ev.sig}` : null
}

function remember(key: string): void {
  if (verifiedSigs.has(key)) return
  // Oldest first out: a set keeps insertion order.
  if (verifiedSigs.size >= VERIFIED_KEPT) {
    const oldest = verifiedSigs.values().next().value as string
    verifiedSigs.delete(oldest)
    forgetBody(oldest)
  }
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

/**
 * An event this page just signed, or a remote signer's answer this page just
 * checked in full (useCyberspace signEvent, checkedAnswer): remembered with
 * its fields, so the copies the relays push back (one per relay for every
 * subscription it matches, a WALK step's own event above all) are compared
 * with it rather than checked again from scratch: a Schnorr check each on
 * the main thread (owner's phone walk, 2026-11-21). `ev` must be the object
 * that was signed or checked, unchanged.
 */
export function signedHere(ev: NostrEvent): void {
  const key = keyOf(ev)
  if (key === null) return
  remember(key)
  keepBody(key, ev)
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
 * by whoever asked (relay.ts query with offThread). Only that subscription says so, only
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

/** For tests: how many bodies are kept, and their counted size. */
export function keptBodies(): { count: number; chars: number } {
  return { count: bodies.size, chars: bodyChars }
}
