/**
 * bloomReach.ts - how far a DNA's bloom reaches where it would land: the
 * measure SEED hands plant.ts seedHideFor, for any caller that lines a seed
 * up (SEED, the tutorial).
 *
 * The bloom is grown in the seeds worker at its DNA's last day (plant.ts
 * previewLastDay: its generations cap plus one, fully grown; owner ruling
 * "A", 2026-11-12) at the landing point's terroir, and its reach is
 * its farthest vertex with the margin (plant.ts bloomReachGibsons). Its own
 * module rather than plant.ts: it reads the Bitcoin line's tip (useHyperspace),
 * and plant.ts stays free of stores because a store (useShards) reads it.
 */

import type { Plane } from 'cyberspace-core'
import type { Caps } from 'sno-core/seeds'
import { positionHex } from '../events'
import type { Position } from '../space'
import { getStopByHeight, useHyperspace } from '../../store/useHyperspace'
import { bloomReachGibsons, previewLastDay, previewRequest } from './plant'
import { growInWorker } from './growClient'
import { headerBook, trustedTip } from './seedSources'

/** Where the tip is unknown yet, a recent height: only the preview's weather depends on it. */
const TIP_FALLBACK = 975_300

/**
 * The measure for seedHideFor: given a landing point, the reach in gibsons of
 * this DNA's bloom at its last day grown there, or undefined when the worker could not
 * grow it. Each point is grown once by seedHideFor.
 */
export function bloomReachAt(text: string, caps: Caps, plane: Plane, scale: number): (p: Position) => Promise<number | undefined> {
  const tip = trustedTip() ?? useHyperspace.getState().tipHeight ?? TIP_FALLBACK
  return async (p) => {
    const req = previewRequest({ text, caps, coord: positionHex(p, plane), scale, tip, day: previewLastDay(caps), hashOf: (h) => headerBook.hash(h) ?? getStopByHeight(h)?.blockHash })
    const answer = await growInWorker({ ...req, key: 'preview-reach' })
    return answer.type === 'bloom' ? bloomReachGibsons(answer.buffers.positions, scale) : undefined
  }
}
