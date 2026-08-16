/**
 * targets.ts — things worth pointing at, wherever they are.
 *
 * A target is anything in cyberspace you should be able to find from anywhere:
 * Earth today, the black sun once it exists, and other avatars once there is
 * anyone else here. They all pose the same problem, which is that the space is
 * 2^85 across and the view is about fifty cells, so the overwhelmingly likely
 * state of any given landmark is "not on screen and very far away".
 *
 * One mechanism covers both cases rather than two that have to agree. In frame,
 * a target is a reticle on the thing itself. Out of frame, the same target is a
 * chevron on the edge nearest it. Either way the label and the distance are the
 * same, so it reads as one object that happens to be visible or not.
 *
 * The projection is written here per frame by a component inside the Canvas and
 * read by a DOM overlay outside it. A module-level record rather than store
 * state for the usual reason: it changes every frame and nothing should re-render
 * because of it. React only sees the target LIST, which changes when the world
 * does.
 */

import type { Position } from './space'

export interface CyberTarget {
  id: string
  label: string
  color: string
  /** Absolute cyberspace coordinate. */
  at: Position
  /** Drawn as a ring of this many gibsons, when it has a real extent. */
  radius?: bigint
}

export interface TargetScreen {
  /** Normalised device coordinates, before the edge clamp. */
  x: number
  y: number
  /** False when behind the camera or outside the frustum. */
  onScreen: boolean
  /** Distance from the avatar, in gibsons. */
  distance: bigint
  /** On-screen radius in pixels, 0 when the target has no extent to show. */
  px: number
}

/** Written per frame inside the Canvas, read per frame by the HUD. */
export const targetScreens: Record<string, TargetScreen> = {}
