/**
 * opacityStep.ts - the workshop's OPACITY slider and stepper (DECK-0003 §1.11).
 *
 * An object's opacity is a whole percent; the stepper moves it in fives from
 * 0 to 100, which is solid and is stored as no opacity at all. There is no
 * floor (owner, 2026-11-15): at 0 an object draws nothing of its own, and its
 * glow still shows. A value off the fives (a published object written by
 * another tool, say 33) steps to the next five in the direction asked, so the
 * first press never lands somewhere surprising.
 */

import type { ShardModel } from 'sno-core/shards'

/** The least opacity the slider reaches, in percent: 0, the object drawing nothing of its own. */
export const OPACITY_MIN = 0

/** The stepper's step, in percent. */
export const OPACITY_STEP = 5

/**
 * The percent a model is drawn at, as the stepper shows it: 100 when it has
 * none, and never under 0.
 */
export function opacityPercent(opacity: number | undefined): number {
  return Math.max(OPACITY_MIN, opacity ?? 100)
}

/** The next value from `current` one step in `dir` (-1 more see-through, +1 more solid), between 0 and 100. */
export function stepOpacity(current: number | undefined, dir: -1 | 1): number {
  const at = opacityPercent(current)
  const next = dir > 0 ? Math.floor(at / OPACITY_STEP) * OPACITY_STEP + OPACITY_STEP : Math.ceil(at / OPACITY_STEP) * OPACITY_STEP - OPACITY_STEP
  return Math.min(100, Math.max(OPACITY_MIN, next))
}

/**
 * A percent typed or slid to, as a whole percent between 0 and 100
 * (the SHARD panel's slider and its #, arkinox 2026-10-23). Anything that is
 * not a number is null, so a cleared field writes nothing.
 */
export function clampOpacity(percent: number): number | null {
  if (!Number.isFinite(percent)) return null
  return Math.min(100, Math.max(OPACITY_MIN, Math.round(percent)))
}

/** The whole percent at `t` along the slider, 0 at 0 and 1 at 100. */
export function opacityAt(t: number): number {
  const along = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  return Math.round(OPACITY_MIN + along * (100 - OPACITY_MIN))
}

/** Where `percent` sits along the slider: 0 at 0, 1 at 100. */
export function opacityFraction(percent: number): number {
  return Math.min(1, Math.max(0, (percent - OPACITY_MIN) / (100 - OPACITY_MIN)))
}

/**
 * The undo history after a slider drag, as one edit would have left it: the
 * history from before the drag with the shard from before the drag on top.
 * Every whole percent the drag passed was an edit of its own (useWorkshop
 * edit), so `now` is that history with one entry per step, at most the
 * store's cap long; this keeps the cap, so a drag at a full history drops the
 * oldest entry, as one edit does.
 */
export function dragHistory<T>(before: readonly T[], shard: T, now: readonly T[]): T[] {
  const past = [...before, shard]
  if (past.length > Math.max(now.length, before.length)) past.shift()
  return past
}

/**
 * `s` with its opacity set to `percent`: 100 (or anything that is not a
 * number) is solid and is stored as no opacity at all, the wire's canonical
 * form; anything else is kept between 0 and 99. An `opacity` an older
 * sno-core carried in `extra` (as a field it did not know) goes too, and
 * `extra` with it if nothing else is left there, so a value set here is the
 * only one: the carried copy can never come back at the next load.
 */
export function withOpacity<T extends ShardModel>(s: T, percent: number): T {
  const { opacity: _old, extra, ...rest } = s
  const carried = extra ? Object.entries(extra).filter(([k]) => k !== 'opacity') : []
  const base = (carried.length ? { ...rest, extra: Object.fromEntries(carried) } : rest) as T
  const p = Math.round(percent)
  return Number.isFinite(p) && p < 100 ? { ...base, opacity: Math.max(OPACITY_MIN, p) } : base
}
