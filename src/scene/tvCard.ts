/**
 * tvCard.ts: where a cut's LATER or MEANWHILE card goes on the tube
 * (arkinox, 2026-10-23: "move the '>> X hours and Y minutes later' banner
 * to the top center of the screen between the cyberspace minimap and the
 * logo. I don't like it appearing over the chiron").
 *
 * placeCard: top centre, in the gap between the minimap (top left) and the
 * logo's column (the logo, the clock under it and, on the stream, its
 * address; top right), its top on the margin the logo and the minimap hang
 * from. Centred on the frame when it fits there, else as near the centre as
 * the gap lets it. Where the gap is too narrow its type shrinks, down to
 * CARD_LEAST of its size; then LATER keeps only its largest unit ("23 HOURS
 * LATER"); then the card sits just under the top row, centred, at its own
 * size (a phone held upright), if there it ends above the chiron and keeps
 * off NOW PLAYING; else it goes back to the gap on two lines (a small phone
 * on its side); else the gap at the least size its words fit.
 *
 * clearOfPanel: a segment's panel (a comment, an object, a sealed bag) is
 * never moved or made smaller for the card. The card keeps off it: where it
 * was placed, if that is clear; else risen into the top margin (from the
 * gap) to end above the panel; else on the panel's top border like a tab,
 * clear of what the panel shows and of its bursts (CASHU INSIDE! and the
 * like); else under the panel, above the chiron; else beside it, under the
 * logo's column (a small phone on its side); else smaller, at the top.
 *
 * The card never meets the minimap, the logo's column, the chiron or NOW
 * PLAYING, and never what a panel shows (tvCard.test sweeps the frames).
 */

/** The card's padding each side of its words, its height (one line), and its clearance from what is round it, CSS px. */
export const CARD_PAD_PX = 14
export const CARD_H_PX = 32
export const CARD_CLEAR_PX = 12
/** A second line's advance, in ems of the type. */
export const CARD_LINE_EM = 1.2
/** How far the type may shrink to stay in the gap, as a share of its size: past that, fewer words, or two lines. */
export const CARD_LEAST = 0.75
/** The least a card shrinks to, as a share of its size: to fit the gap at all, or to keep off a panel. */
export const CARD_FLOOR = 0.5
/** How high a card in the gap may rise into the top margin to keep off a panel: its top no higher than this share of that margin. */
export const CARD_RISE = 0.4
/** The sizes tried in the gap, as shares of the type's own, largest first. */
const STEPS = [1, 0.95, 0.9, 0.85, 0.8, CARD_LEAST]

/**
 * How far the minimap's drawing reaches from its square's centre, as a share
 * of the square's side, every way: the black sun swings out to about 0.67 as
 * the map turns, and its glow past that.
 */
export const MAP_REACH = 0.7

/** A box on the frame, canvas px. */
export interface Box { x0: number; y0: number; x1: number; y1: number }

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
  /** The lowest a card may end: the chiron's top (or the marquee's), less a clearance. */
  floor: number
  /** What a card out of the gap must not meet: the minimap's reach, the logo's column, NOW PLAYING. */
  blocks: Box[]
  /** The side margins, which bound a card under the top row. */
  margin: number
  /** Canvas px per CSS px for the card's padding, height and clearance. */
  s: number
  /** The card's type size, canvas px. */
  px: number
}

/** Where the card goes and what it says, canvas px. */
export interface CardPlace {
  /** Its words, a line each (one or two), and their type size. */
  lines: string[]
  px: number
  /** The words' centre, and the first line's baseline. */
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
  /** The widest its words may be (under the top row they may still need cutting). */
  maxWords: number
}

/** A segment's panel as clearOfPanel sees it: its ground, what it shows (under its top border), and its bursts at their largest. */
export interface PanelInk {
  panel: Box
  content: Box
  bursts: Box[]
}

const meets = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d })
const boxOf = (c: CardPlace): Box => ({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h })

/** The card's ground for `lines` at `px`, its top at `y`, centred on `cx`; `tw` its widest line. */
function make(lines: string[], px: number, tw: number, cx: number, y: number, f: CardFrame, inRow: boolean, maxWords: number): CardPlace {
  const pad = CARD_PAD_PX * f.s
  const extra = (lines.length - 1) * CARD_LINE_EM * px
  const h = CARD_H_PX * f.s + extra
  const w = tw + 2 * pad
  // The lines sit in the middle of the ground, as one line did at its own size.
  return { lines, px, cx, baseline: y + h / 2 + 0.35 * px - extra / 2, x: cx - w / 2, y, w, h, pad, inRow, maxWords }
}

/** `c` at `k` of its size (type, padding and height together), its top at `y`, centred on `cx`. */
function scaled(c: CardPlace, k: number, y: number, cx: number = c.cx): CardPlace {
  const px = c.px * k
  const pad = c.pad * k
  const h = c.h * k
  const w = (c.w - 2 * c.pad) * k + 2 * pad
  const extra = (c.lines.length - 1) * CARD_LINE_EM * px
  return { ...c, px, pad, h, w, cx, x: cx - w / 2, y, baseline: y + h / 2 + 0.35 * px - extra / 2 }
}

/** `text` on two lines as even as can be, never leaving the arrows alone on one; null for one word. */
function twoLines(text: string, width: (t: string) => number): [string, string] | null {
  const words = text.split(' ')
  let best: [string, string] | null = null
  let bestW = Infinity
  for (let i = 2; i < words.length; i++) {
    const pair: [string, string] = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    const w = Math.max(width(pair[0]), width(pair[1]))
    if (w < bestW) { best = pair; bestW = w }
  }
  return best
}

/**
 * Place a card saying `full`, or `short` where `full` does not fit, in
 * `f`. `measure` gives a text's width at a type size, canvas px.
 */
export function placeCard(full: string, short: string, f: CardFrame, measure: (text: string, px: number) => number): CardPlace {
  const pad = CARD_PAD_PX * f.s
  const clear = CARD_CLEAR_PX * f.s
  const lo = f.left + clear
  const hi = f.right - clear
  const room = Math.max(0, hi - lo - 2 * pad)
  const choices = full === short ? [full] : [full, short]
  // The frame's centre, unless that puts it past either side of the gap.
  const inGap = (lines: string[], px: number): CardPlace | null => {
    const tw = Math.max(...lines.map((l) => measure(l, px)))
    if (!(tw <= room)) return null
    const w = tw + 2 * pad
    return make(lines, px, tw, Math.min(Math.max(f.width / 2, lo + w / 2), hi - w / 2), f.top, f, true, room)
  }
  for (const words of choices) {
    for (const k of STEPS) {
      const c = inGap([words], f.px * k)
      if (c) return c
    }
  }
  // Under the top row, centred, as wide as the margins let it be: where it
  // ends above the chiron and keeps off NOW PLAYING.
  const maxWords = Math.max(0, f.width - 2 * f.margin - 2 * pad)
  const words = measure(full, f.px) <= maxWords ? full : short
  const under = make([words], f.px, Math.min(measure(words, f.px), maxWords), f.width / 2, f.rowBottom + clear, f, false, maxWords)
  if (under.y + under.h <= f.floor && !f.blocks.some((b) => meets(boxOf(under), b))) return under
  // Back in the gap, on two lines; then on one, at the least size.
  for (const words of choices) {
    const pair = twoLines(words, (t) => measure(t, f.px))
    if (!pair) continue
    for (const k of STEPS) {
      const c = inGap(pair, f.px * k)
      if (c) return c
    }
  }
  for (const words of choices) {
    for (let k = CARD_LEAST - 0.05; k >= CARD_FLOOR - 1e-9; k -= 0.05) {
      const c = inGap([words], f.px * k)
      if (c) return c
    }
  }
  return under
}

/**
 * The card `c` kept off a segment's panel `ink`, in `f`; `riseTop` is the
 * highest a card in the gap may stand (CARD_RISE of the top margin). The
 * panel is never moved for it: see the file's head for the order tried.
 */
export function clearOfPanel(c: CardPlace, ink: PanelInk, f: CardFrame, riseTop: number, measure: (text: string, px: number) => number): CardPlace {
  const clear = CARD_CLEAR_PX * f.s
  const strict = [ink.panel, ...ink.bursts].map((b) => grow(b, clear))
  const tab = [ink.content, ...ink.bursts].map((b) => grow(b, 2 * f.s))
  // In the frame, above the chiron, off `keep` and off the minimap, the logo's column and NOW PLAYING.
  const ok = (k: CardPlace, keep: Box[]): boolean => {
    const b = boxOf(k)
    return b.x0 >= -1e-6 && b.x1 <= f.width + 1e-6 && b.y0 >= -1e-6 && b.y1 <= f.floor + 1e-6 && !keep.some((o) => meets(b, o)) && !f.blocks.some((o) => meets(b, o))
  }
  if (ok(c, strict)) return c
  const top = c.inRow ? Math.min(c.y, riseTop) : c.y
  // The highest of `keep` across the card's width: the most it may end at.
  const ceiling = (k: CardPlace, keep: Box[]): number => Math.min(...keep.filter((o) => o.x0 < k.x + k.w && k.x < o.x1).map((o) => o.y0), Infinity)
  // Risen to end above the panel, then on its border: at its own size.
  for (const keep of [strict, tab]) {
    const y = Math.min(c.y, ceiling(c, keep) - c.h)
    if (y >= top - 1e-6) {
      const k = scaled(c, 1, y)
      if (ok(k, keep)) return k
    }
  }
  // Under the panel and its bursts, centred on the frame, above the chiron
  // and NOW PLAYING: at its own size, then smaller; its clearance from the
  // panel as much as the band leaves, never under half.
  const sizes = [1, ...STEPS.slice(1), CARD_FLOOR]
  const cx = f.width / 2
  const below = Math.max(ink.panel.y1, ...ink.bursts.map((b) => b.y1))
  const lowest = Math.min(f.floor, ...f.blocks.filter((b) => b.y0 >= below && b.x0 < cx + c.w / 2 && cx - c.w / 2 < b.x1).map((b) => b.y0))
  for (const k of sizes) {
    const free = lowest - below - c.h * k
    if (free < clear / 2) continue
    const under = scaled(c, k, below + Math.min(clear, free), cx)
    if (ok(under, strict.map((b) => grow(b, -clear / 2)))) return under
  }
  // Beside the panel, right then left (a small phone on its side, where a
  // panel takes the whole gap): the highest free place in that column, on
  // one line if it is wide enough for that.
  const panelBox = [ink.panel, ...ink.bursts].reduce((u, b) => ({ x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0), x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1) }))
  const sets = c.lines.length > 1 ? [[c.lines.join(' ')], c.lines] : [c.lines]
  for (const [x0, x1] of [[panelBox.x1 + clear, f.width - f.margin], [f.margin, panelBox.x0 - clear]]) {
    const kx = (x0 + x1) / 2
    for (const lines of sets) {
      const whole = make(lines, c.px, Math.max(...lines.map((l) => measure(l, c.px))), kx, 0, f, c.inRow, Math.max(0, x1 - x0 - 2 * c.pad))
      for (const k of sizes) {
        const probe = scaled(whole, k, 0, kx)
        if (probe.w > x1 - x0) continue
        // What stands in that column, top to bottom; the card goes in the
        // highest gap between them it fits, no higher than `riseTop`.
        const stands = [...f.blocks, ...strict].filter((b) => b.x0 < probe.x + probe.w && probe.x < b.x1).sort((a, b) => a.y0 - b.y0)
        let y = riseTop
        for (const b of [...stands, { x0: 0, y0: f.floor, x1: 0, y1: f.floor }]) {
          if (b.y0 - y >= probe.h) {
            const beside = scaled(whole, k, y, kx)
            if (ok(beside, strict)) return beside
          }
          y = Math.max(y, b.y1)
        }
      }
    }
  }
  // Smaller, where it stands, to end on the panel's border.
  const k = Math.min(1, (ceiling(c, tab) - top) / c.h)
  return scaled(c, Math.max(CARD_FLOOR, k), top)
}
