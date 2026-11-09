/**
 * bagSize.ts: how large a bag may grow before a rewrite is refused.
 *
 * The canonical relay refuses an event past 262,200 bytes (the H8 bag of
 * 2026-11-04). publishMany succeeds when any relay takes an event, so a bag
 * the canonical relay refuses can look sent while the bags it was written
 * beside (a source bag shrunk by a move) did go: what moved is then in
 * neither copy there. A rewrite that grows a bag is refused here, in words,
 * before anything is signed, with a margin under that limit.
 */

import type { EventTemplate } from './events'
import { attributed } from './client'

/** The canonical relay's limit on one event, in bytes. */
export const CANONICAL_EVENT_BYTES = 262_200

/** The most a bag may grow to here: under the canonical limit, with room for what this estimate does not see. */
export const BAG_SAFE_BYTES = 240_000

/**
 * A signed event's size from its template: the template with the client tag
 * every signer adds (lib/client.ts attributed), and its id, pubkey and
 * signature as they serialize.
 */
export function signedBytes(template: EventTemplate): number {
  const event = { ...attributed(template), id: '0'.repeat(64), pubkey: '0'.repeat(64), sig: '0'.repeat(128) }
  return new TextEncoder().encode(JSON.stringify(event)).length
}

/** Why a bag of this many bytes is not written, or null when it fits. */
export function bagSizeRefusal(bytes: number): string | null {
  if (bytes <= BAG_SAFE_BYTES) return null
  return `Too large for one bag: ${bytes.toLocaleString('en-US')} of ${BAG_SAFE_BYTES.toLocaleString('en-US')} bytes. Nothing was sent.`
}
