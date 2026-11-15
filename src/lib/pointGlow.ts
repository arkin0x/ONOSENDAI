/**
 * pointGlow.ts - the workshop's POINT SIZE, RADIUS and GLOW STRENGTH rails
 * (DECK-0003 §1.15 and §1.16; owner rulings 2026-11-15).
 *
 * Both fields live in `extra` and are written only through sno-core's
 * withPointSize and withGlow, so nothing here can store a malformed value.
 * This file is the arithmetic the rows share: where a value sits on a rail,
 * the value at a place on the rail, the − and + steps, and the value shown in
 * gibsons at the object's own scale.
 *
 * The two distance rails are squared: the first half of the rail covers the
 * first quarter of the range, where small sizes need fine steps. − and + walk
 * a ladder of round values that carries on past the rail's end up to the
 * 7,680-tick cap, and # types any value up to the cap.
 */

import { GLOW_REACH, suggestGlowStyle, type GlowStyle } from 'sno-core/glow'
import { TICKS_PER_UNIT, type ShardModel } from 'sno-core/shards'
import { gibsonsLabel, ticksToGibsons } from './pointLook'

/** Ticks in one model unit (§1.2). */
const TICKS = TICKS_PER_UNIT

/** POINT SIZE's value for "the reader's own size": no `pointsize` at all. */
export const POINT_AUTO = -1

/** How much of the POINT SIZE rail, from its left end, reads AUTO. */
export const POINT_AUTO_SPAN = 0.1

/** The POINT SIZE rail's right end: 2 units. # and + go on to the cap. */
export const POINT_RAIL_MAX = 2 * TICKS

/** The RADIUS rail's ends: 1 tick to 8 units. # and + go on to the cap. */
export const RADIUS_MIN = 1
export const RADIUS_RAIL_MAX = 8 * TICKS

/** GLOW STRENGTH's range, a whole percent. */
export const STRENGTH_MIN = 1
export const STRENGTH_MAX = 100

/** The radius and strength a glow starts with the first time it is turned on in a session. */
export const GLOW_START = { radius: TICKS, strength: 40 } as const

/** − and + on POINT SIZE, in ticks (0, 0.05 units, 0.1 ... 64 units). AUTO is one step under 0. */
export const POINT_LADDER = [0, 6, 12, 18, 24, 30, 36, 48, 60, 72, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720, 960, 1200, 1440, 1920, 2400, 3600, 4800, 6000, GLOW_REACH] as const

/** − and + on RADIUS, in ticks (1 tick, 0.05 units ... 64 units). */
export const RADIUS_LADDER = [1, 6, 12, 24, 36, 48, 60, 90, 120, 180, 240, 360, 480, 720, 960, 1200, 1440, 1920, 2400, 3600, 4800, 6000, GLOW_REACH] as const

/** − and + on GLOW STRENGTH, in percent: 1, then fives. */
export const STRENGTH_LADDER = [1, ...Array.from({ length: 20 }, (_, i) => (i + 1) * 5)] as const

const clamp01 = (t: number): number => Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))

/** The next ladder value above `v` (dir 1) or below it (dir -1), held at the ladder's ends. A value off the ladder steps to the next one in the direction asked. */
export function stepLadder(ladder: readonly number[], v: number, dir: -1 | 1): number {
  if (dir > 0) return ladder.find((x) => x > v) ?? ladder[ladder.length - 1]
  for (let i = ladder.length - 1; i >= 0; i--) if (ladder[i] < v) return ladder[i]
  return ladder[0]
}

/** A squared rail from `lo` to `hi`: the whole value at `t`, and where `v` sits (held at the ends). */
function squaredAt(t: number, lo: number, hi: number): number {
  const u = clamp01(t)
  return Math.round(lo + (hi - lo) * u * u)
}
function squaredFraction(v: number, lo: number, hi: number): number {
  return Math.sqrt(clamp01((v - lo) / (hi - lo)))
}

// ---- POINT SIZE ----------------------------------------------------------------

/** The POINT SIZE value at `t` along the rail: AUTO in its first tenth, then 0 to 2 units. */
export function pointSizeAt(t: number): number {
  const at = clamp01(t)
  if (at < POINT_AUTO_SPAN) return POINT_AUTO
  return squaredAt((at - POINT_AUTO_SPAN) / (1 - POINT_AUTO_SPAN), 0, POINT_RAIL_MAX)
}

/** Where a POINT SIZE value sits along the rail: AUTO at the left end, 0 just past it. */
export function pointSizeFraction(v: number): number {
  if (v < 0) return 0
  return POINT_AUTO_SPAN + (1 - POINT_AUTO_SPAN) * squaredFraction(v, 0, POINT_RAIL_MAX)
}

/** − and + on POINT SIZE: AUTO, 0, then the ladder up to the cap. */
export function stepPointSize(v: number, dir: -1 | 1): number {
  if (v < 0) return dir > 0 ? 0 : POINT_AUTO
  if (dir < 0 && v <= 0) return POINT_AUTO
  return stepLadder(POINT_LADDER, v, dir)
}

// ---- RADIUS --------------------------------------------------------------------

/** The RADIUS at `t` along the rail, 1 tick to 8 units. */
export function radiusAt(t: number): number {
  return Math.max(RADIUS_MIN, squaredAt(t, 0, RADIUS_RAIL_MAX))
}

/** Where a RADIUS sits along the rail. */
export function radiusFraction(v: number): number {
  return squaredFraction(v, 0, RADIUS_RAIL_MAX)
}

/** − and + on RADIUS. */
export function stepRadius(v: number, dir: -1 | 1): number {
  return stepLadder(RADIUS_LADDER, v, dir)
}

// ---- GLOW STRENGTH -------------------------------------------------------------

/** The GLOW STRENGTH at `t` along the rail, 1 to 100. */
export function strengthAt(t: number): number {
  return Math.round(STRENGTH_MIN + clamp01(t) * (STRENGTH_MAX - STRENGTH_MIN))
}

/** Where a GLOW STRENGTH sits along the rail. */
export function strengthFraction(v: number): number {
  return clamp01((v - STRENGTH_MIN) / (STRENGTH_MAX - STRENGTH_MIN))
}

/** − and + on GLOW STRENGTH. */
export function stepStrength(v: number, dir: -1 | 1): number {
  return stepLadder(STRENGTH_LADDER, v, dir)
}

/** A typed GLOW STRENGTH, a whole percent from 1 to 100, or null when it is not a number. */
export function typedStrength(text: string): number | null {
  if (!/^\d+$/.test(text)) return null
  return Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, Number(text)))
}

// ---- gibsons -------------------------------------------------------------------

/**
 * A distance in ticks as the rows show it, in gibsons at the object's scale
 * (lib/pointLook gibsonsLabel, the renderer's own reading): the figure, and
 * the word under it.
 */
export function gibsonsText(ticks: number, unit: number): { figure: string; word: 'GIBSON' | 'GIBSONS' } {
  const label = gibsonsLabel(ticksToGibsons(ticks, unit))
  const cut = label.lastIndexOf(' ')
  return { figure: label.slice(0, cut), word: label.slice(cut + 1) === 'GIBSON' ? 'GIBSON' : 'GIBSONS' }
}

/**
 * A distance typed in gibsons, as whole ticks of an object of `unit`, held
 * between `min` and the 7,680-tick cap; null when it is not a number. A
 * figure above 0 that rounds under one tick is one tick, and 0 is `min`.
 */
export function typedTicks(text: string, unit: number, min: number): number | null {
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return null
  const n = Number(text)
  const ticks = Math.round((n / 2 ** unit) * TICKS)
  if (!Number.isFinite(ticks)) return null
  // Something typed is never nothing: a figure under one tick is one tick.
  return Math.min(GLOW_REACH, Math.max(min, n > 0 ? Math.max(1, ticks) : ticks))
}

/**
 * The most gibsons # takes at `unit`, as plain digits the field can hold
 * (64 units, the 7,680-tick cap), for its placeholder: "64" at unit 0,
 * "67108864" at unit 20.
 */
export function maxGibsonsTyped(unit: number): string {
  const u = Math.round(unit)
  return u >= 0 ? (64n << BigInt(u)).toString() : String(64 / 2 ** -u)
}

// ---- the style pre-pick --------------------------------------------------------

/**
 * The mean color of a shard's points, 0..1 per channel, or `fallback` (the
 * color in hand) when it has none. The glow takes each point's own color, so
 * the points are what decide whether it reads as light or as fog.
 */
export function meanPointColor(s: Pick<ShardModel, 'vertices'>, fallback: readonly [number, number, number]): [number, number, number] {
  const n = s.vertices.length
  if (n === 0) return [fallback[0], fallback[1], fallback[2]]
  const sum: [number, number, number] = [0, 0, 0]
  for (const v of s.vertices) for (let k = 0; k < 3; k++) sum[k] += v.c[k]
  return [sum[0] / n, sum[1] / n, sum[2] / n]
}

/** The style the GLOW row suggests for a shard: LIGHT when its points are bright, FOG when they are dark (sno-core suggestGlowStyle). */
export function suggestedGlowStyle(s: Pick<ShardModel, 'vertices'>, fallback: readonly [number, number, number]): GlowStyle {
  return suggestGlowStyle(meanPointColor(s, fallback))
}
