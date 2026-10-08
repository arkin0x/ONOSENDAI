/**
 * buildStep.ts - the build STEP: placing finer than the zoom.
 *
 * arkinox, 2026-10-08: zoomed out to 2^15 to see a large object whole, he
 * could only put it at the center of a 2^15 cube, because the build cursor
 * steps and snaps by the zoom (space.ts deployPoint). Zooming in gave finer
 * steps but took the camera with it. STEP separates the two while a deploy is
 * lined up: the camera stays at the zoom, and the build cursor steps, and the
 * placement snaps, by 2^STEP (useCyberspace `buildStep`, read through
 * lib/buildCursor.ts buildStepOf).
 *
 * Lowering STEP first brings the build cursor to where the placement is now,
 * the center of the current snap cell, so the small box that marks the snap
 * cell shrinks where it stands instead of jumping to wherever the raw
 * coordinate happened to sit inside the cube (your avatar's, say). A run of
 * lowerings without a move in between keeps that point, so the box closes in
 * on it rather than drifting a quarter cell further toward one corner each
 * time. Raising needs nothing: the snap cell grows to the cell that holds it.
 *
 * A module of its own because it reads both stores (the deploy's height from
 * useShards, the cursor from useCyberspace), and so the deploy bar's buttons
 * and the keyboard share one definition.
 */

import { samePosition, useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { buildStepOf } from '../lib/buildCursor'
import { deployPoint, type Position } from '../lib/space'

/** The point the last lowering settled the build cursor on. */
let settled: Position | null = null

/** STEP down (-1) or up (+1), between 2^0 and the zoom. Only while a deploy is lined up. */
export function stepBuild(delta: 1 | -1): void {
  if (!useShards.getState().pending) return
  const cs = useCyberspace.getState()
  const from = buildStepOf(cs)
  const to = Math.max(0, Math.min(cs.scaleExp, from + delta))
  if (to === from) return
  if (to < from && !(settled && samePosition(settled, cs.cursor))) {
    settled = deployPoint(cs.cursor, from, useShards.getState().deployHeight)
    if (!samePosition(settled, cs.cursor)) useCyberspace.setState({ cursor: settled })
  }
  cs.setBuildStep(to)
}
