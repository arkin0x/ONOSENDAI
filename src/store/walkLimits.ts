/**
 * walkLimits.ts: whether WALK's sync limit is on (store/useLayers.ts
 * walkLimits; arkinox, 2026-11-18: "maybe sync loss warning should be a
 * setting. you can turn it off but then you risk losing actions if your
 * chain gets long and then something happens to interrupt it").
 *
 * | Limit | 15 to 19 events ahead | 20 or more | LOSING SYNC |
 * |---|---|---|---|
 * | on (the default) | the walk slows | the walk stops | fades in from 15, full at 20 |
 * | off | full speed | full speed | never shown |
 *
 * The warning and the stop go together: turning the warning off but still
 * stopping at 20 would leave the stop with no word for it. The CHAIN chip's
 * edge bar (hud/ChainAhead.tsx) shows how far ahead you are either way.
 */

import { syncSpeedFactor, syncWarnOpacity } from '../lib/fluidWalk'
import { useLayers } from './useLayers'

/** Whether the sync limit is on now. */
export function walkLimitsOn(): boolean {
  return useLayers.getState().walkLimits
}

/** The share of the walking speed allowed `ahead` events ahead: syncSpeedFactor with the limit on, always 1 with it off. */
export function walkSpeedFactor(ahead: number, limits: boolean = walkLimitsOn()): number {
  return limits ? syncSpeedFactor(ahead) : 1
}

/** How shown the LOSING SYNC warning is `ahead` events ahead: syncWarnOpacity with the limit on, 0 with it off. */
export function walkWarnOpacity(ahead: number, limits: boolean = walkLimitsOn()): number {
  return limits ? syncWarnOpacity(ahead) : 0
}
