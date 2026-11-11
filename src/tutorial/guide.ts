/**
 * guide.ts: the tutorial's guide key, one per device (first-arrival tutorial
 * design, 2026-11-10, D1).
 *
 * A throwaway key, separate from the player's: it signs and seals the
 * tutorial's blue box, chests and course for real, and nothing it signs is
 * ever sent to a relay (tutorial/guideBags.ts). It is made the first time the
 * tutorial runs on this device and kept here, so a reload stages what the
 * same key signed. It holds nothing of value: losing it only means the next
 * run is staged again under a new one.
 */

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, hexToBytes } from '../lib/events'

export const GUIDE_KEY = 'onosendai:tutorial:guide'

const HEX_64 = /^[0-9a-f]{64}$/

/** This visit's, so storage that refuses writes still gives one key per visit. */
let made: string | null = null

/** This device's guide key, made and kept the first time it is asked for. */
export function guideKey(): { secret: Uint8Array; pubkey: string } {
  let hex: string | null = made
  try { hex = localStorage.getItem(GUIDE_KEY) ?? made } catch { /* private mode */ }
  if (!hex || !HEX_64.test(hex)) {
    hex = bytesToHex(generateSecretKey())
    try { localStorage.setItem(GUIDE_KEY, hex) } catch { /* private mode: this visit only */ }
  }
  made = hex
  const secret = hexToBytes(hex)
  return { secret, pubkey: getPublicKey(secret) }
}
