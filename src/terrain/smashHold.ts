/**
 * smashHold.ts - SMASH is a hold, like SURVEY (terrain/surveyHold.ts), so it
 * is never done by accident: 3 seconds with the Compiler in hand, 20 with a
 * bare hand (owner, 2026-11-26). The bar fills as SURVEY's does; letting go,
 * a finger sliding off, or F coming up before the end cancels with nothing
 * spent. The block hit is fixed when the hold starts. When the hold completes
 * the swing begins (`swingAt`), and `done` runs once.
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

/** Start holding at a block; a hold already under way goes on. `done` runs when it completes. */
export function startSmashHold(target: readonly [number, number, number], ms: number, bare: boolean, done: (target: readonly [number, number, number], bare: boolean) => void, now: number = performance.now()): void {
  if (useSmashHold.getState().since !== null) return
  useSmashHold.setState({ since: now, ms, target, bare })
  timer = setTimeout(() => {
    timer = null
    useSmashHold.setState({ since: null, swingAt: performance.now() })
    done(target, bare)
  }, ms)
}

/** Let go before the end: the bar empties and nothing is smashed. */
export function cancelSmashHold(): void {
  if (timer !== null) { clearTimeout(timer); timer = null }
  if (useSmashHold.getState().since !== null) useSmashHold.setState({ since: null, target: null })
}
