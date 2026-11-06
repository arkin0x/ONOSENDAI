/**
 * worldMarks.ts - which hidden messages are drawn in the world at a zoom.
 *
 * A message is one of three marks. A coin is a message holding a Cashu token
 * the mint has not called redeemed: it is money, so it is drawn at every zoom.
 * A spent coin is a token the mint says has been redeemed: it stays where it
 * was left as a still gray diamond, but only up close. A note is any other
 * message. Notes and spent coins vanish past 2^1, because at a wide view a
 * field of notes is a field of clutter that says nothing legible (arkinox,
 * 2026-10-09); the words were always one tap away, and the tap needs the zoom.
 */

import type { CashuState } from './cashu'

/** The widest zoom (scaleExp) at which notes and spent coins are drawn. */
export const MESSAGE_SCALE_MAX = 1

export type MarkKind = 'coin' | 'spent' | 'note'

/** What a mint may have said about a coin, as useCashu reports it. */
export type CoinState = CashuState | 'checking' | 'unreadable'

/**
 * The mark a coin gets. Only the mint's word makes it spent: a token that is
 * still being checked, that cannot be read, or whose mint cannot be reached
 * is drawn as a coin, because nobody has said it is gone.
 */
export function coinKind(state: CoinState): 'coin' | 'spent' {
  return state === 'redeemed' ? 'spent' : 'coin'
}

/** Whether a mark of this kind is drawn at this zoom. */
export function markShown(kind: MarkKind, scaleExp: number): boolean {
  return kind === 'coin' || scaleExp <= MESSAGE_SCALE_MAX
}

/**
 * How the world draws an item: as itself, or held, by the hand that made it
 * ('own') or taken from someone else ('taken').
 */
export type ItemDraw = 'item' | 'own' | 'taken'

/** How strongly a held item is drawn: its model at half, and the box round your own at half (arkinox, 2026-11-06). */
export const HELD_OPACITY = 0.5

/**
 * Holding an item draws it at half (arkinox, 2026-11-06, which replaces the
 * solid blue box of 2026-11-01 that hid the model): its model at
 * HELD_OPACITY, in motion as ever. An item you made yourself (`own`: its
 * event is the signed-in identity's, however it came to be held) stands in
 * its blue box at half; one taken from someone else has no box. A local
 * reading; nothing is published and nobody else's world changes. Until ITEMS
 * is read it is drawn as held, so a reload never shows a held item whole for
 * a moment.
 */
export function itemDrawAs(held: boolean, itemsRead: boolean, own: boolean): ItemDraw {
  if (held || !itemsRead) return own ? 'own' : 'taken'
  return 'item'
}

/** Whether the signed-in identity (`me`) made an item: its event is theirs. Nobody signed in made nothing. */
export function madeBy(author: string | null | undefined, me: string): boolean {
  return !!me && author === me
}
