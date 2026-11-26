/**
 * glyphRing.ts: the ring of glyphs that orbits a hidden message's letter in
 * the world (owner, 2026-11-26: "letter with glyph ring from concept 1. make
 * the glyph ring's glyphs randomly change to different characters. keep the
 * ring spin effect").
 *
 * The glyphs are capital letters, digits and katakana, with now and then one
 * of the block textures ░ ▒ ▓, as direction 1's mockup drew them (owner,
 * 2026-11-27: "the glyphs around the outside should include numbers, capital
 * english alphabet characters and occasional unicode texture blocks like in
 * the mockup"). A glyph is its index in RING_CHARS, which is its cell in the
 * glyph atlas (scene/glyphAtlas). A few change each frame, at random: a steady
 * rate per ring, not per frame, so a slow phone and a fast screen look the
 * same, and a cap on the whole scene's changes in one frame, so a hall of
 * letters never writes more than a handful of numbers to the GPU per frame.
 *
 * Far off the ring thins out (ringShown): the letter's size on screen picks
 * how many of its glyphs are drawn, and below a fingertip none are. Every
 * third glyph has the lowest ranks, so the thinned ring is still evenly
 * spread round the letter.
 *
 * Every random choice comes from a seeded generator (mulberry32), so a test
 * can pin the ring down, and the scene seeds it from the clock.
 *
 * Pure: no store, no DOM, no three.
 */

import { seedOf } from './decode'

/** The ring's katakana: the wordmark's and the syllabary's, as decode.ts's cipher has them. */
export const RING_KATAKANA = 'オノセンダイアウエカキクケコサシスタチツテトナニヌネハヒフヘホマミムメモヤユヨラリルレロワヲン'
/** Capital letters and digits. */
export const RING_LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
/** The block textures, drawn now and then. */
export const RING_BLOCKS = '░▒▓'
/** Every glyph the ring can show, blocks last: a glyph is its index here. */
export const RING_CHARS = RING_KATAKANA + RING_LATIN + RING_BLOCKS
/** How many glyphs are not blocks: the first RING_PLAIN of RING_CHARS. */
export const RING_PLAIN = RING_KATAKANA.length + RING_LATIN.length
/** How often a glyph is a block texture: now and then. */
export const BLOCK_SHARE = 0.06

/** How many glyphs orbit one letter. */
export const RING_GLYPHS = 24

/** How many of them are drawn when the letter is small on screen: every third. */
export const RING_GLYPHS_FAR = 8

/** Below this many CSS pixels across, a letter's ring is not drawn at all. */
export const RING_HIDE_PX = 10
/** Below this many, the ring is thinned to RING_GLYPHS_FAR. */
export const RING_THIN_PX = 26

/** One full turn of the ring, seconds (direction 1's 18 s). */
export const RING_TURN_S = 18

/** How many of one ring's glyphs change each second. */
export const CHANGES_PER_RING_S = 14

/** The most glyphs changed across the whole scene in one frame. */
export const MAX_CHANGES_PER_FRAME = 48

/** A random source in [0, 1). */
export type Rng = () => number

/** mulberry32: a small, fast seeded generator. The same seed gives the same sequence. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A glyph index in [0, RING_CHARS.length): a block one time in about sixteen (BLOCK_SHARE), otherwise a letter, a digit or katakana, each as likely. */
export function randomGlyph(rng: Rng): number {
  if (rng() < BLOCK_SHARE) return RING_PLAIN + Math.min(RING_BLOCKS.length - 1, Math.floor(rng() * RING_BLOCKS.length))
  return Math.min(RING_PLAIN - 1, Math.floor(rng() * RING_PLAIN))
}

/** A ring's first glyphs, from its message's key: the same key, the same ring. */
export function ringStart(key: string): number[] {
  const rng = mulberry32(seedOf(key))
  return Array.from({ length: RING_GLYPHS }, () => randomGlyph(rng))
}

/** Where glyph `i` sits round the ring, radians, counterclockwise from the right. */
export function ringAngle(i: number): number {
  return (i / RING_GLYPHS) * Math.PI * 2
}

/**
 * The order glyphs are dropped as the ring thins: every third glyph first
 * (ranks 0 to 7), so a thinned ring of RING_GLYPHS_FAR is still even, then
 * the rest.
 */
export function ringRank(i: number): number {
  return i % 3 === 0 ? i / 3 : RING_GLYPHS_FAR + (i - Math.ceil((i + 1) / 3))
}

/** How many of a ring's glyphs are drawn for a letter `px` CSS pixels across. */
export function ringShown(px: number): number {
  if (!(px >= RING_HIDE_PX)) return 0
  return px < RING_THIN_PX ? RING_GLYPHS_FAR : RING_GLYPHS
}

/**
 * How many glyphs change this frame across `rings` rings, `dt` seconds after
 * the last frame, with `carry` the fraction left over from before: a steady
 * rate per ring, capped per frame. Returns the count and the new carry.
 */
export function changeBudget(rings: number, dt: number, carry: number): { count: number; carry: number } {
  if (rings <= 0 || !(dt > 0)) return { count: 0, carry: 0 }
  // A long pause (a hidden tab) is not made up for in one frame.
  const want = carry + rings * CHANGES_PER_RING_S * Math.min(dt, 0.25)
  const count = Math.min(MAX_CHANGES_PER_FRAME, Math.floor(want))
  return { count, carry: count === MAX_CHANGES_PER_FRAME ? 0 : want - count }
}

/** One change: glyph `slot` (across every ring) now shows glyph `glyph`. */
export interface GlyphChange { slot: number; glyph: number }

/**
 * `count` changes among `slots` glyphs: which slot and which glyph, each at
 * random from `rng`. Never more than MAX_CHANGES_PER_FRAME, every slot in
 * [0, slots) and every glyph in [0, RING_CHARS.length).
 */
export function glyphChanges(rng: Rng, slots: number, count: number): GlyphChange[] {
  const n = slots > 0 ? Math.max(0, Math.min(count, MAX_CHANGES_PER_FRAME)) : 0
  const out: GlyphChange[] = []
  for (let k = 0; k < n; k++) out.push({ slot: Math.min(slots - 1, Math.floor(rng() * slots)), glyph: randomGlyph(rng) })
  return out
}
