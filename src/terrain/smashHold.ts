/**
 * smashHold.ts - SMASH is a hold, like SURVEY (terrain/surveyHold.ts), so it
 * is never done by accident: COMPILER_HOLD_MS with the Compiler in hand,
 * BARE_HOLD_MS with a bare hand (lib/blueprint/smash.ts; the owner tunes them). The bar fills as SURVEY's does; letting go,
 * a finger sliding off, or F coming up before the end cancels with nothing
 * spent. The block hit is fixed when the hold starts. When the hold completes
 * `done` runs once, and the swing begins (`swingAt`) unless `done` says false:
 * a smash that asks first (lib/blueprint/smashConfirm.ts) swings only on its
 * SMASH, through `startSwing`.
 */

import { create } from 'zustand'

export interface SmashHoldState {
  /** When the hold began (performance.now), or null when nothing is held. */
  since: number | null
  /** How long this hold lasts. */
  ms: number
  /** The block the hold aims at, in the field's cs offsets. */
  target: readonly [number, number, number] | null
  /** With a bare hand (not the Compiler). */
  bare: boolean
  /** When the last swing began (performance.now): the held Compiler's swing, the comet trail. */
  swingAt: number | null
}

export const useSmashHold = create<SmashHoldState>(() => ({ since: null, ms: 0, target: null, bare: false, swingAt: null }))

let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Start holding at a block; a hold already under way goes on. `done` runs when it completes; the swing starts then,
 * unless `done` returns false (it asks first, and starts the swing itself with `startSwing`).
 */
export function startSmashHold(target: readonly [number, number, number], ms: number, bare: boolean, done: (target: readonly [number, number, number], bare: boolean) => boolean | void, now: number = performance.now()): void {
  if (useSmashHold.getState().since !== null) return
  useSmashHold.setState({ since: now, ms, target, bare })
  timer = setTimeout(() => {
    timer = null
    // The hold ends and the swing begins in one change, so the hammer's clock never reads it as a let-go (hammerClock.ts).
    let swing = true
    try { swing = done(target, bare) !== false } finally {
      useSmashHold.setState(swing ? { since: null, swingAt: performance.now() } : { since: null })
    }
  }, ms)
}

/** The swing begins now: the held Compiler's swing and its comet trail. */
export function startSwing(now: number = performance.now()): void {
  useSmashHold.setState({ swingAt: now })
}

/** Let go before the end: the bar empties and nothing is smashed. */
export function cancelSmashHold(): void {
  if (timer !== null) { clearTimeout(timer); timer = null }
  if (useSmashHold.getState().since !== null) useSmashHold.setState({ since: null, target: null })
}
