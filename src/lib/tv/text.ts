/**
 * text.ts: words from other people, made safe to put on Cyberspace TV.
 *
 * A reaction, a comment and a profile name are written by anyone, and the
 * ticker joins them into one line: a right-to-left override in one of them
 * turned everything after it backwards, other people's lines included, and
 * a cut through the middle of an emoji left half of it on screen (review of
 * #373). So control and format characters are taken out (the zero-width
 * joiner stays, for emoji built of several), and a cut is by whole
 * characters.
 */

import { safeNpub } from '../npub'

/** Control and format characters, except the zero-width joiner. */
const UNSAFE = /(?!‍)[\p{Cc}\p{Cf}]/gu

/** `text` without control or format characters, cut to `max` whole characters (with an ellipsis) when given. */
export function cleanText(text: string, max?: number): string {
  const clean = text.replace(UNSAFE, '').trim()
  if (max === undefined) return clean
  const chars = Array.from(clean)
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : clean
}

/** How TV names someone: their profile name, cleaned and in capitals, else the head of their npub. */
export function tvName(pubkey: string, profileName: string | null | undefined): string {
  const name = profileName ? cleanText(profileName, 40) : ''
  if (name) return name.toUpperCase()
  const npub = safeNpub(pubkey)
  return npub ? `${npub.slice(0, 12)}…` : `${pubkey.slice(0, 8)}…`
}
