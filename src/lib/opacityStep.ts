/**
 * opacityStep.ts - the workshop's OPACITY stepper (DECK-0003 §1.11).
 *
 * An object's opacity is a whole percent; the stepper moves it in fives from
 * the floor (10, sno-core OPACITY_FLOOR) to 100, which is solid and is stored
 * as no opacity at all. A value off the fives (a published object written by
 * another tool, say 33) steps to the next five in the direction asked, so the
 * first press never lands somewhere surprising.
 */

import { OPACITY_FLOOR, type ShardModel } from 'sno-core/shards'

/** The stepper's step, in percent. */
export const OPACITY_STEP = 5

/**
 * The percent a model is drawn at, as the stepper shows it: 100 when it has
 * none, and never under the floor, so a stored 5 reads as the 10% it draws at.
 */
export function opacityPercent(opacity: number | undefined): number {
  return Math.max(OPACITY_FLOOR, opacity ?? 100)
}

/** The next value from `current` one step in `dir` (-1 more see-through, +1 more solid), between the floor and 100. */
export function stepOpacity(current: number | undefined, dir: -1 | 1): number {
  const at = opacityPercent(current)
  const next = dir > 0 ? Math.floor(at / OPACITY_STEP) * OPACITY_STEP + OPACITY_STEP : Math.ceil(at / OPACITY_STEP) * OPACITY_STEP - OPACITY_STEP
  return Math.min(100, Math.max(OPACITY_FLOOR, next))
}

/**
 * `s` with its opacity set to `percent`: 100 (or anything that is not a
 * number) is solid and is stored as no opacity at all, the wire's canonical
 * form; anything else is kept between the floor and 99. An `opacity` an older
 * sno-core carried in `extra` (as a field it did not know) goes too, and
 * `extra` with it if nothing else is left there, so a value set here is the
 * only one: the carried copy can never come back at the next load.
 */
export function withOpacity<T extends ShardModel>(s: T, percent: number): T {
  const { opacity: _old, extra, ...rest } = s
  const carried = extra ? Object.entries(extra).filter(([k]) => k !== 'opacity') : []
  const base = (carried.length ? { ...rest, extra: Object.fromEntries(carried) } : rest) as T
  const p = Math.round(percent)
  return Number.isFinite(p) && p < 100 ? { ...base, opacity: Math.max(OPACITY_FLOOR, p) } : base
}
