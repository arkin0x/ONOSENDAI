/**
 * ceremony.ts: the OPEN ceremony's timeline, as pure numbers (arkinox,
 * 2026-10-30, design L "Treasure", onosendai/chest-open-ceremony-options.md).
 *
 * "when you open the chest the modal goes away and the in-world animation
 * plays." Every time is from the moment the decrypt returns, never the tap:
 * a signer can take seconds, and nothing moves for a chest that is not open
 * yet. Then, on the chest where it stands:
 *
 *   0 to 700 ms   the lid turns up and back on its hinge, ease-out;
 *   700 ms        the open look swaps in under the glints (hollow, gold);
 *   700 to 3200   gold glints twinkle at the heap, seen by the bloom;
 *   700 to 1900   glyphs of the wordmark's katakana rise from the mouth,
 *                 resolve, and fade (12 on a phone, 24 wider);
 *   420 on        the loot rises out of the mouth, one object after
 *                 another, and hovers above the chest; a chime as the last
 *                 one lands (scene/ChestLoot.tsx).
 *
 * The calm path, for a person who asked their system for less motion: the
 * closed look fades into the open one over 300 ms; no lid turning, no
 * glints, no rain. It ends in the same state: the open look.
 *
 * Plays once per chest, per identity, per device: only an OPEN that opened
 * a chest not opened by hand before (store/useOpenedChests openedByHand). A
 * reload restores an opened chest silently, open. The camera never moves.
 * Cyberspace TV opens nothing, so it never plays there.
 */

import { easeOutCubic } from './decode'

/** How long the lid takes to turn open. */
export const LID_MS = 700
/** How long the gold glints at the heap last, from the swap. */
export const GLINT_MS = 2500
/** How long each rising glyph takes, from its own start. */
export const RAIN_MS = 1200
/** The latest a rising glyph starts after the swap. */
export const RAIN_SPREAD_MS = 450
/** The calm path's crossfade. */
export const CALM_FADE_MS = 300
/** Glyphs in the rain: fewer on a narrow screen, as labels shrink there (WorldLabel labelShrink). */
export function rainCount(widthPx: number): number {
  return widthPx < 700 ? 12 : 24
}

/** How long one loot object takes to rise out of the mouth, and how long after the one before it it starts. */
export const RISE_MS = 900
export const RISE_STAGGER_MS = 130
/** At most this many stagger steps: a full chest is not a queue. */
const STAGGER_CAP = 6

/** When loot object `i` starts rising, ms from the start: as the lid nears the top, one after another. */
export function riseStart(i: number): number {
  return LID_MS * 0.6 + Math.min(i, STAGGER_CAP) * RISE_STAGGER_MS
}

/** How far loot object `i` has risen at `elapsed` ms, 0 (in the mouth) to 1 (hovering). */
export function riseShare(i: number, elapsed: number): number {
  return easeOutCubic((elapsed - riseStart(i)) / RISE_MS)
}

/** When the last of `n` loot objects lands, ms from the start: when the chime sounds (lib/ceremonySound). */
export function landedAt(n: number): number {
  return n === 0 ? 0 : riseStart(n - 1) + RISE_MS
}

/** Which ceremony a look plays. */
export type CeremonyKind = 'chest' | 'door'

/**
 * A door (arkinox, 2026-10-30, door A): its slab decodes away upward with
 * the house static over DOOR_DISSOLVE_MS, as if slid up into the lintel,
 * and the open look (the slab's bottom rail) fades in from DOOR_OPEN_AT
 * over DOOR_RAIL_FADE_MS. No glints, no rain, no loot:
 * a room is not treasure. WALK passes the door from the start, before any
 * of this has been drawn (store/walkWalls.ts).
 */
export const DOOR_DISSOLVE_MS = 900
export const DOOR_OPEN_AT = 540
export const DOOR_RAIL_FADE_MS = 360

/** How far the slab has decoded away at `elapsed` ms, 0 to 1. */
export function dissolveShare(elapsed: number): number {
  return Math.min(1, Math.max(0, elapsed / DOOR_DISSOLVE_MS))
}

/** How long a ceremony lasts before the chest or door is simply open. */
export function ceremonyLength(kind: CeremonyKind, calm: boolean): number {
  if (calm) return CALM_FADE_MS
  return kind === 'door' ? Math.max(DOOR_DISSOLVE_MS, DOOR_OPEN_AT + DOOR_RAIL_FADE_MS) + 100 : LID_MS + GLINT_MS
}

/** How far the lid has turned at `elapsed` ms, toward `angle` (radians); the calm path never turns it. */
export function lidTurn(elapsed: number, angle: number, calm = false): number {
  if (calm) return 0
  return easeOutCubic(elapsed / LID_MS) * angle
}

/** Whether the open look has swapped in at `elapsed` ms. */
export function swapped(elapsed: number, calm = false): boolean {
  return elapsed >= (calm ? CALM_FADE_MS : LID_MS)
}

/** The open look's share of the calm path's crossfade at `elapsed` ms, 0 to 1. */
export function calmShare(elapsed: number): number {
  return Math.min(1, Math.max(0, elapsed / CALM_FADE_MS))
}

/**
 * How bright the glints are at `elapsed` ms from the start: none until the
 * lid is nearly up, at full in 150 ms, then fading out by the end; none at
 * all on the calm path.
 */
export function glintLevel(elapsed: number, calm = false): number {
  if (calm) return 0
  const t = elapsed - LID_MS * 0.85
  if (t <= 0) return 0
  const end = LID_MS + GLINT_MS - LID_MS * 0.85
  if (t >= end) return 0
  return Math.min(1, t / 150) * (1 - (t / end) ** 2)
}

/** What OPEN does once the decrypt has returned. */
export interface AfterOpen {
  /** The card (and any list it was in) closes, so the chest is seen. */
  yieldCards: boolean
  /** The in-world ceremony plays on the chest. */
  ceremony: boolean
  /** The sound and the buzz are offered (each still gated, lib/ceremonySound). */
  feedback: boolean
}

/**
 * What an OPEN that worked does next. `first`: this identity had not opened
 * the chest by hand on this device before (once per chest). `drawn`: the
 * chest stands in the world as its look right now, on screen to be seen. A
 * chest opened somewhere it is not drawn (a chest in ITEMS, one inside
 * another chest, one past the zoom chests are drawn at) keeps its card open
 * and lists what is inside, with the sound alone.
 */
export function afterOpen(first: boolean, drawn: boolean): AfterOpen {
  if (!first) return { yieldCards: false, ceremony: false, feedback: false }
  return { yieldCards: drawn, ceremony: drawn, feedback: true }
}
