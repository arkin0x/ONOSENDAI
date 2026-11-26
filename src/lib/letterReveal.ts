/**
 * letterReveal.ts: how a hidden message opens (owner, 2026-11-26: "decode
 * effect for the message itself. love the broken seal for read").
 *
 * The seal cracks, the page unfolds, then the words resolve out of glyphs
 * (decode.ts decodeText), every time the card opens: slowly the first time,
 * quickly after, and not at all for someone who asked their system for less
 * motion. A tap anywhere on the page skips to the words.
 *
 * Also the small facts the letter is drawn from: whether a message is short
 * enough for large type, and the initial its seal bears.
 *
 * Pure: no store, no DOM, no clock.
 */

/** The decode the first time a message opens, ms (direction 1: "1.1 s on the first open"). */
export const DECODE_FIRST_MS = 1100
/** The decode on every later opening, ms ("0.3 s after"). */
export const DECODE_AGAIN_MS = 300

/** The seal's crack and the page's unfold before the words decode, ms: the first time, and after. */
export const UNFOLD_FIRST_MS = 650
export const UNFOLD_AGAIN_MS = 240

/** A message this long or shorter is set in large type with no scroll ("Up to 80 letters"). */
export const SHORT_MAX = 80

/** How the card opens a message: the unfold, then the decode, in ms. Both 0 with reduced motion. */
export interface RevealPlan { unfoldMs: number; decodeMs: number }

/** The plan for a message read before or not, and whether motion is reduced. */
export function revealPlan(readBefore: boolean, reduced: boolean): RevealPlan {
  if (reduced) return { unfoldMs: 0, decodeMs: 0 }
  return readBefore ? { unfoldMs: UNFOLD_AGAIN_MS, decodeMs: DECODE_AGAIN_MS } : { unfoldMs: UNFOLD_FIRST_MS, decodeMs: DECODE_FIRST_MS }
}

/**
 * How far the decode is, 0 to 1, `elapsed` ms after the card opened: 0
 * through the unfold, then up to 1 over the decode. Skipped (a tap), or with
 * nothing to wait for, it is done.
 */
export function revealProgress(plan: RevealPlan, elapsed: number, skipped: boolean): number {
  if (skipped || plan.decodeMs <= 0) return 1
  const t = (elapsed - plan.unfoldMs) / plan.decodeMs
  return Math.min(1, Math.max(0, t))
}

/** Whether a message is short: large type, centred, no scroll. Counted in characters as written, spaces trimmed. */
export function isShortMessage(text: string): boolean {
  return [...text.trim()].length <= SHORT_MAX
}

/** The letters a seal's initial may be in the world: the glyph atlas draws these (scene/glyphAtlas.ts). */
export const SEAL_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/**
 * The initial on an author's seal: the first letter or digit of their name,
 * upper case, when it is one the world can draw (SEAL_INITIALS); otherwise
 * the first letter of their npub after "npub1", which always is.
 */
export function sealInitial(name: string | null | undefined, npub: string): string {
  for (const ch of (name ?? '').trim()) {
    const up = ch.toUpperCase()
    if (SEAL_INITIALS.includes(up)) return up
    // The first character decides: a name that starts with something else falls back to the key.
    break
  }
  const body = npub.startsWith('npub1') ? npub.slice(5) : npub
  const up = (body[0] ?? '?').toUpperCase()
  return SEAL_INITIALS.includes(up) ? up : '?'
}
