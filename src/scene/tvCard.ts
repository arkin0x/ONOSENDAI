/**
 * tvCard.ts: where a cut's LATER or MEANWHILE card goes on the tube
 * (arkinox, 2026-10-23: "move the '>> X hours and Y minutes later' banner
 * to the top center of the screen between the cyberspace minimap and the
 * logo. I don't like it appearing over the chiron").
 *
 * Top centre, in the gap between the minimap (top left) and the logo's
 * column (the logo, the clock under it and, on the stream, its address; top
 * right), its top on the margin the logo and the minimap hang from. Centred
 * on the frame when it fits there, else as near the centre as the gap lets
 * it. Where the gap is too narrow for it (a phone held upright, the stream's
 * largest text) its type shrinks, down to CARD_LEAST of its size; then
 * LATER keeps only its largest unit ("23 HOURS LATER"); and if even that
 * does not fit, the card sits just under the top row, centred on the frame,
 * at its own size. It never meets the minimap or the logo's column, and,
 * being at the top, never the chiron or NOW PLAYING.
 *
 * A segment's panel (a comment, an object, a sealed bag) is placed for the
 * whole shot under the card when it still shows all it would without it (a
 * smaller model is fine; fewer or smaller words are not). Otherwise it keeps
 * its own room and moves down in it as far as that lets it, and the card
 * gives way (fitAbove): it rises into the top margin to end above the panel
 * or, where the panel fills its room (the stream's larger text, a phone on
 * its side), on the panel's top border, never over what the panel shows;
 * and only then shrinks.
 */

/** The card's padding each side of its words, its height, and its clearance from what is round it, CSS px. */
export const CARD_PAD_PX = 14
export const CARD_H_PX = 32
export const CARD_CLEAR_PX = 12
/** How far the type may shrink to stay in the gap, as a share of its size: past that, fewer words. */
export const CARD_LEAST = 0.75
/** The sizes tried in the gap, as shares of the type's own, largest first. */
const STEPS = [1, 0.95, 0.9, 0.85, 0.8, CARD_LEAST]

/**
 * How far the minimap's drawing reaches from its square's centre, as a share
 * of the square's side, every way: the black sun swings out to about 0.67 as
 * the map turns, and its glow past that.
 */
export const MAP_REACH = 0.7

/** What the card has round it, canvas px. */
export interface CardFrame {
  /** The frame's width. */
  width: number
  /** The gap's left edge: the minimap's reach, or the left margin where no minimap is drawn. */
  left: number
  /** The gap's right edge: the left of the logo's column. */
  right: number
  /** The top margin, the logo's and the minimap's. */
  top: number
  /** The top row's bottom: the lower of the minimap's reach and the logo's column. */
  rowBottom: number
  /** The side margins, which bound a card under the top row. */
  margin: number
  /** Canvas px per CSS px for the card's padding and height. */
  s: number
  /** The card's type size, canvas px. */
  px: number
}

/** Where the card goes and what it says, canvas px. */
export interface CardPlace {
  /** The words, and their type size. */
  words: string
  px: number
  /** The words' centre and baseline. */
  cx: number
  baseline: number
  /** The card's ground, and its padding each side of the words. */
  x: number
  y: number
  w: number
  h: number
  pad: number
  /** In the gap between the minimap and the logo's column; false when under the top row. */
  inRow: boolean
  /** The widest the words may be (under the top row, where they may still need cutting). */
  maxWords: number
}

/** The least a card shrinks to, as a share of its size, to keep off a segment's panel. */
export const CARD_FLOOR = 0.4
/** How high a card in the gap may rise into the top margin to keep off a panel: its top no higher than this share of that margin. */
export const CARD_RISE = 0.4

/**
 * The card `c`, kept off a segment's panel that could not move down far
 * enough to clear it (tvPainter): with the stream's larger text, and on a
 * phone on its side, a panel can fill its whole room. `limits` are the ys it
 * should end above, best first (the panel's top and a clearance; then where
 * what the panel shows begins, under its top border). For each in turn the
 * card rises, its top no higher than `minTop`; where none can be met so, it
 * stands at `minTop` and shrinks (its type, padding and height together) to
 * end above the last, never below CARD_FLOOR of its size. Its centre stays.
 */
export function fitAbove(c: CardPlace, limits: number[], minTop: number): CardPlace {
  const at = (y: number, k: number): CardPlace => {
    const px = c.px * k
    const pad = c.pad * k
    const h = c.h * k
    const w = (c.w - 2 * c.pad) * k + 2 * pad
    return { ...c, px, pad, h, w, x: c.cx - w / 2, y, baseline: y + h / 2 + 0.35 * px }
  }
  if (limits.length === 0 || c.y + c.h <= limits[0]) return c
  for (const limit of limits) if (limit - c.h >= minTop) return at(Math.min(c.y, limit - c.h), 1)
  const top = Math.min(c.y, minTop)
  return at(top, Math.max(CARD_FLOOR, Math.min(1, (limits[limits.length - 1] - top) / c.h)))
}

/**
 * Place a card saying `full`, or `short` where `full` does not fit, in
 * `f`. `measure` gives a text's width at a type size, canvas px.
 */
export function placeCard(full: string, short: string, f: CardFrame, measure: (text: string, px: number) => number): CardPlace {
  const pad = CARD_PAD_PX * f.s
  const h = CARD_H_PX * f.s
  const clear = CARD_CLEAR_PX * f.s
  const lo = f.left + clear
  const hi = f.right - clear
  const at = (words: string, px: number, tw: number, top: number, cx: number, inRow: boolean, maxWords: number): CardPlace => {
    const w = tw + 2 * pad
    // The words sit in the middle of the ground, as they did at its own size.
    return { words, px, cx, baseline: top + h / 2 + 0.35 * px, x: cx - w / 2, y: top, w, h, pad, inRow, maxWords }
  }
  for (const words of full === short ? [full] : [full, short]) {
    for (const k of STEPS) {
      const px = f.px * k
      const tw = measure(words, px)
      const w = tw + 2 * pad
      if (w > hi - lo) continue
      // The frame's centre, unless that puts it past either side of the gap.
      const cx = Math.min(Math.max(f.width / 2, lo + w / 2), hi - w / 2)
      return at(words, px, tw, f.top, cx, true, hi - lo - 2 * pad)
    }
  }
  // Under the top row, centred, as wide as the margins let it be.
  const maxWords = f.width - 2 * f.margin - 2 * pad
  const words = measure(full, f.px) <= maxWords ? full : short
  return at(words, f.px, Math.min(measure(words, f.px), maxWords), f.rowBottom + clear, f.width / 2, false, maxWords)
}
