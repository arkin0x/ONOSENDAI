/**
 * nameLabel.ts: how a person is named over a thing in the world and in its
 * rows, the same way for a message, a sound and an item (owner, 2026-11-27:
 * "npub display not in line with other modes"): "you" for your own, their
 * display name when their profile has one, else a short npub in its own
 * lower case.
 *
 * A profile whose name is itself an npub (some clients fill one in, often
 * upper case: "NPUB1MMX8UN4…RZ2S" over a stranger's letter) names nobody,
 * so it is passed over for the short npub, which is the same and readable.
 *
 * Pure: no store, no profile lookup.
 */

import { nip19 } from 'nostr-tools'

/** Whether a name is only an npub, whole or cut short, in any case. */
export function looksLikeNpub(name: string): boolean {
  return /^npub1[0-9a-z]{3,}/i.test(name.trim())
}

/** A short npub: its first ten characters and its last four, lower case. A pubkey that is not one gives its first eight hex characters. */
export function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey)
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`
  } catch {
    return pubkey.slice(0, 8)
  }
}

/** The name over a person's thing: "you", their display name, or their short npub. */
export function nameLabel(pubkey: string, me: string, profileName?: string | null): string {
  if (pubkey && pubkey === me) return 'you'
  const name = profileName?.trim()
  if (name && !looksLikeNpub(name)) return name
  return pubkey ? shortNpub(pubkey) : 'someone'
}
