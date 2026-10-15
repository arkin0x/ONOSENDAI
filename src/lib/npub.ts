/**
 * npub.ts: a pubkey as an npub, without taking a render down.
 *
 * Not every pubkey the HUD is handed encodes: a landmark id like "earth", a
 * truncated key from a bad tag, a test fixture. A profile view, a row or a
 * label is never worth a thrown error, so every caller encodes through here
 * and falls back: to null where the caller wants to know, to the pubkey as
 * written where it only wants something to show.
 */

import { nip19 } from 'nostr-tools'

/** The npub, or null when the pubkey does not encode. */
export function npubOf(pubkey: string): string | null {
  try { return nip19.npubEncode(pubkey) } catch { return null }
}

/** The npub, or the pubkey as written when it does not encode. */
export function safeNpub(pubkey: string): string {
  return npubOf(pubkey) ?? pubkey
}
