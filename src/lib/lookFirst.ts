/**
 * lookFirst.ts - an identity whose chain was moved without the relays
 * confirming its head, because the device was offline.
 *
 * A move is signed only from a head the relays have confirmed (arkinox's
 * ruling of 2026-10-08), and a device with no network cannot ask. Refusing
 * every move offline made the app useless on an airplane, so offline the
 * move is signed and kept here instead, and this mark says the relays have
 * not seen where it started. The publisher (publisher.ts) then always looks
 * at the relays before it sends anything for this identity, however short
 * the backlog: another device may have moved meanwhile, and the look turns
 * that into the choice between two versions of the chain (branchConflict.ts)
 * rather than a fork on the relays. The mark is cleared by the look that
 * answers, and survives a reload, because the backlog does too.
 */

const keyFor = (pubkey: string): string => `onosendai:look-first:${pubkey}`

/** For a browser that refuses storage: still right for the life of the page. Values are when the mark was set. */
const memory = new Map<string, number>()

/** Set (or move later) the mark: a move was just signed offline. */
export function markLookFirst(pubkey: string, now = Date.now()): void {
  memory.set(pubkey, now)
  try { localStorage.setItem(keyFor(pubkey), String(now)) } catch { /* private mode: memory holds it */ }
}

/** When the mark was set, or null when there is none. */
export function lookFirstSince(pubkey: string): number | null {
  try {
    const v = localStorage.getItem(keyFor(pubkey))
    if (v !== null) return Number(v) || 0
  } catch { /* storage refused: memory answers */ }
  return memory.get(pubkey) ?? null
}

export function needsLookFirst(pubkey: string): boolean {
  return lookFirstSince(pubkey) !== null
}

/**
 * Clear the mark after a look that began at `lookedAt` answered. A move
 * signed offline while the look was out set the mark later, and the look
 * cannot have checked it, so that mark stays.
 */
export function clearLookFirst(pubkey: string, lookedAt: number): void {
  const since = lookFirstSince(pubkey)
  if (since === null || since >= lookedAt) return
  memory.delete(pubkey)
  try { localStorage.removeItem(keyFor(pubkey)) } catch { /* nothing stored */ }
}

/** navigator.onLine where there is a navigator; a test or a worker is taken as online. */
export function deviceOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
