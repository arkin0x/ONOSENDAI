/**
 * hammerClock.ts - the smash animation's clock, kept from the hold
 * (terrain/smashHold.ts): when the hold began, when its swing began, and,
 * which the hold itself forgets, when it was let go early and how far in.
 * The held Compiler, the camera's kick and the sounds read this one object
 * (lib/blueprint/hammerAnim.ts has the phases and the poses).
 */

import { IDLE_CLOCK, nextClock, type HammerClock } from '../lib/blueprint/hammerAnim'
import { useSmashHold } from './smashHold'

let clock: HammerClock = { ...IDLE_CLOCK, ...pick(useSmashHold.getState()) }

function pick(h: { since: number | null; ms: number; swingAt: number | null }): { since: number | null; ms: number; swingAt: number | null } {
  return { since: h.since, ms: h.ms, swingAt: h.swingAt }
}

useSmashHold.subscribe((h) => { clock = nextClock(clock, pick(h), performance.now()) })

/** The clock now. The same object until the hold changes: nothing is made per frame. */
export function hammerClock(): HammerClock {
  return clock
}
