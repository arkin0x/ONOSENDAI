/**
 * holdProgress.ts - how far along a press-and-hold is, as numbers, for the
 * ring at the cross (terrain/HoldRing.tsx). The owner, 2026-11-27: "on the
 * buttons you have to hold, we should show the progress somewhere else
 * because my thumb covers the bar". So every hold in TERRAIN (SMASH, SURVEY)
 * shows its progress where the player is looking: a thin ring round the
 * cross, filling clockwise from the top, in the action's colour, its name
 * and the seconds left under it.
 *
 * Every hold is listed in HOLD_ACTIONS; a new hold adds itself there and to
 * the ring's list of stores (HoldRing.tsx HOLDS), so it gets the same ring.
 * Nothing here draws or keeps state.
 */

/** A press-and-hold action, as the ring shows it. */
export interface HoldAction {
  /** Which hold. */
  id: 'smash' | 'survey'
  /** The word under the ring. */
  label: string
  /** The ring's colour. */
  colour: string
}

/** Every hold in TERRAIN: SMASH in the Compiler's orange, SURVEY in TERRAIN's mint. */
export const HOLD_ACTIONS: Readonly<Record<HoldAction['id'], HoldAction>> = {
  smash: { id: 'smash', label: 'SMASH', colour: '#ff9a3c' },
  survey: { id: 'survey', label: 'SURVEY', colour: '#7cffc4' },
}

/** The ring's radius and the length of its circle, in the ring's own units (a 48 unit box). */
export const RING_R = 20
export const RING_C = 2 * Math.PI * RING_R

/** How far through a hold of `ms` begun at `since` it is at `now`: 0 to 1, and 0 when nothing is held. */
export function holdFraction(since: number | null, ms: number, now: number): number {
  if (since === null || !(ms > 0)) return 0
  return Math.min(1, Math.max(0, (now - since) / ms))
}

/** The whole seconds left of a hold of `ms` begun at `since`, at `now` (4 at the start of a 4 second hold, 1 in its last second). */
export function holdSecondsLeft(since: number | null, ms: number, now: number): number {
  if (since === null || !(ms > 0)) return 0
  return Math.max(0, Math.ceil((ms - Math.max(0, now - since)) / 1000))
}

/** How much of the ring's circle is still to fill at `fraction`: the whole circle at 0, none at 1. */
export function ringOffset(fraction: number, circumference: number = RING_C): number {
  return circumference * (1 - Math.min(1, Math.max(0, fraction)))
}
