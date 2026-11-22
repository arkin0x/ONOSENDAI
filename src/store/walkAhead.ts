/**
 * walkAhead.ts: how many events WALK is ahead of the chain, the one number
 * the fluid pause (store/fluidSwitch.ts fluidPauseCheck: off at 21, back on
 * at 15), the CHAIN chip's edge bar (hud/ChainAhead.tsx), and the parked
 * slowdown and LOSING SYNC warning (store/walkLimits.ts SYNC_SLOWDOWN_ON) go
 * by, and the number anything else showing how far ahead the walk is should
 * read.
 *
 * It is the moves made here that are not yet on your chain: what the walk
 * will have proved and put on the chain once everything in hand closes and
 * lands. A move counts until its proof lands on your chain head here
 * (store/useWalk.ts pump); sending it to the relay is a later, separate
 * drain (lib/publisher.ts) that this does not count.
 *
 * | Part | Events |
 * |---|---|
 * | `behind`: closed segments not yet proven onto your chain, the one in flight included | one each |
 * | the open segment, still being walked | one |
 * | a fall or jump in the air: its mid-air hops and its landing | one each |
 *
 * A long straight walk is one open segment, so it is one ahead however far
 * it goes; every turn faster than the proofs adds one.
 */

import { fallState, useWalk, type WalkState } from './useWalk'

/** The events ahead from the walk's parts (see the table above). */
export function aheadOf(behind: number, open: boolean, fallHops: number | null): number {
  return behind + (open ? 1 : 0) + (fallHops === null ? 0 : fallHops + 1)
}

/** How many events WALK is ahead of the chain now. */
export function eventsAhead(): number {
  return aheadOfState(useWalk.getState())
}

/**
 * Something picked from the events ahead, for a component: renders again
 * only when what `pick` returns changes, so a piece that shows the count only
 * some of the time (the LOSING SYNC warning from 15, the CHAIN chip's bar in
 * WALK) renders nothing for a count it does not show. A fall's mid-air hops
 * are module state, not the store's, so in the air this can lag the fluid
 * frame (which reads eventsAhead every frame) until the store next changes;
 * the landing is counted on time.
 */
export function useAheadSelect<T>(pick: (ahead: number) => T): T {
  return useWalk((s) => pick(aheadOfState(s)))
}

/** The events ahead from the walk store's state, for a selector: a number, so a store change that leaves it alone renders nothing. */
export function aheadOfState(s: Pick<WalkState, 'behind' | 'open'>): number {
  const f = fallState()
  return aheadOf(s.behind, s.open !== null, f ? f.waypoints.length : null)
}
