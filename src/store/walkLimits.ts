/**
 * walkLimits.ts: whether WALK's sync limit is on (store/useLayers.ts
 * walkLimits, the Settings row Optimize chain, once "Pause fluid walk when
 * your chain falls behind"), and the parked slowdown and LOSING SYNC warning.
 *
 * Since 2026-11-22 (arkinox: "lets turn off the slowdown and LOSING SYNC
 * features for now and just see how this iteration feels") the one limit is
 * the fluid pause (lib/fluidWalk.ts FLUID_PAUSE_AT, store/fluidSwitch.ts
 * fluidPauseCheck): fluid WALK switches itself off 21 events ahead of your
 * chain, and back on at 15 or fewer if it was on. The Settings switch turns
 * only that on or off.
 *
 * | Limit | 15 to 20 events ahead | 21 or more | LOSING SYNC |
 * |---|---|---|---|
 * | on (the default) | full speed | fluid WALK pauses; the step WALK goes on | never shown (parked) |
 * | off | full speed | full speed, fluid stays on | never shown |
 *
 * The slowdown (15 to 20) and the LOSING SYNC warning are kept, not
 * deleted, behind SYNC_SLOWDOWN_ON: set it true and, with the limit on, the
 * walk slows from 15 and the warning fades in again, as they did from
 * 2026-11-17 (the stop at 20 is gone either way: the pause at 21 took its
 * place). The CHAIN chip's edge bar (hud/ChainAhead.tsx) shows how far
 * ahead you are in every case.
 */

import { syncSpeedFactor, syncWarnOpacity } from '../lib/fluidWalk'
import { useLayers } from './useLayers'

/**
 * The parked slowdown and LOSING SYNC warning: false since 2026-11-22. True
 * brings both back, together, under the Settings switch.
 */
export const SYNC_SLOWDOWN_ON = false

/**
 * Whether the parked slowdown and warning are on: SYNC_SLOWDOWN_ON, unless a
 * test asked otherwise (globalThis.__ONOSENDAI_SYNC_SLOWDOWN__, as
 * src/test/fluidWalkOff.ts does for fluid WALK), so the parked code stays
 * tested.
 */
export function syncSlowdownOn(): boolean {
  const seam = (globalThis as { __ONOSENDAI_SYNC_SLOWDOWN__?: boolean }).__ONOSENDAI_SYNC_SLOWDOWN__
  return typeof seam === 'boolean' ? seam : SYNC_SLOWDOWN_ON
}

/** Whether the sync limit is on now: the fluid pause (and, if switched back on, the slowdown and the warning). */
export function walkLimitsOn(): boolean {
  return useLayers.getState().walkLimits
}

/** The share of the walking speed allowed `ahead` events ahead: syncSpeedFactor with the limit and the parked slowdown on, else 1. */
export function walkSpeedFactor(ahead: number, limits: boolean = walkLimitsOn()): number {
  return limits && syncSlowdownOn() ? syncSpeedFactor(ahead) : 1
}

/** How shown the LOSING SYNC warning is `ahead` events ahead: syncWarnOpacity with the limit and the parked warning on, else 0. */
export function walkWarnOpacity(ahead: number, limits: boolean = walkLimitsOn()): number {
  return limits && syncSlowdownOn() ? syncWarnOpacity(ahead) : 0
}
