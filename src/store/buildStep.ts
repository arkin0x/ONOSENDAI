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
 * STEP only ever moves the build cursor: it does nothing unless BUILD mode is
 * on and its free view can be driven, never at your head, where the cursor is
 * the one a COMMIT hops to, and never while a hide is running, which keeps
 * the box and the ghost on the place being hidden. BUILD mode can end during
 * a hide (a tap on Earth, a stop, a deployment) with the bar still up; STEP
 * is then refused, and cleared below.
 *
 * Lowering STEP first brings the build cursor to where the placement is now,
 * the center of the current snap cell, so the small box that marks the snap
 * cell shrinks where it stands instead of jumping to wherever the raw
 * coordinate happened to sit inside the cube (your avatar's, say). A run of
 * lowerings without a move in between keeps that point, so the box closes in
 * on it rather than drifting a quarter cell further toward one corner each
 * time. Raising needs nothing: the snap cell grows to the cell that holds it.
 * The re-centering is not a move of yours (useCyberspace `buildSettle`,
 * lib/buildCursor.ts placedCursor), and it is undone when STEP goes back to
 * following the zoom, so STEP alone never counts as leaving your avatar.
 *
 * A module of its own because it reads both stores (the deploy's height from
 * useShards, the cursor from useCyberspace), and so the deploy bar's buttons
 * and the keyboard share one definition.
 */

import { samePosition, useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { useBuilder } from './useBuilder'
import { buildStepOf } from '../lib/buildCursor'
import { deployPoint } from '../lib/space'

/** Whether STEP can be changed now: a deploy lined up, not hiding, in BUILD mode, with its free view's cursor to drive. */
export function stepOpen(): boolean {
  const sh = useShards.getState()
  const cs = useCyberspace.getState()
  return sh.pending !== null && sh.deployStatus !== 'working' && useBuilder.getState().active && cs.canDrive() && !cs.atHead()
}

/** STEP down (-1) or up (+1), between 2^0 and the zoom. Only while stepOpen. */
export function stepBuild(delta: 1 | -1): void {
  if (!stepOpen()) return
  const cs = useCyberspace.getState()
  const from = buildStepOf(cs)
  const to = Math.max(0, Math.min(cs.scaleExp, from + delta))
  if (to === from) return
  const settle = cs.buildSettle
  if (to < from && !(settle && samePosition(settle.at, cs.cursor))) {
    const at = deployPoint(cs.cursor, from, useShards.getState().deployHeight)
    useCyberspace.setState({ cursor: at, buildSettle: { at, from: { ...cs.cursor } } })
  }
  useCyberspace.getState().setBuildStep(to)
}

// BUILD mode ending takes STEP with it, whatever is still lined up: a hide
// running when the view moved away keeps its bar, and its STEP must not step
// the cursor at your head.
useBuilder.subscribe((s, prev) => {
  if (prev.active && !s.active) useCyberspace.getState().setBuildStep(null)
})
