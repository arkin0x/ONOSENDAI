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

import type { Object3D } from 'three'
import type { LabelAnchor } from './avatarLabel'
import type { Position } from './space'

export interface CyberTarget {
  id: string
  label: string
  color: string
  /** Absolute cyberspace coordinate. */
  at: Position
  /** Drawn as a ring of this many gibsons, when it has a real extent. */
  radius?: bigint
  /** Someone in the sector you have not targeted: the same marker, dimmer. */
  presence?: boolean
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
  /**
   * The avatar as drawn, when it is drawn: the middle of its bounds and their
   * lowest point on screen, so the name and picture sit under the avatar
   * itself rather than at its cell's corner (lib/avatarLabel; arkinox,
   * 2026-10-11). Absent while no avatar is drawn for the target.
   */
  avatar?: LabelAnchor
}

/** Written per frame inside the Canvas, read per frame by the HUD. */
export const targetScreens: Record<string, TargetScreen> = {}

/**
 * Where the camera's line of sight crosses the screen, in normalised device
 * coordinates, written with targetScreens: (0, 0) unless BUILD has shifted
 * the picture to frame the cursor past the HUD (lib/coverBand.ts). A marker
 * off screen points from here, the middle of the picture, not from the
 * middle of the window.
 */
export const viewAxis = { x: 0, y: 0 }

/**
 * The avatars of other people drawn in the scene right now, by pubkey: the
 * group that holds the shape, so the projector can measure what is actually
 * drawn (arkinox, 2026-10-11). Put here by the scene while one is mounted and
 * taken out when it unmounts.
 */
export const drawnAvatars: Record<string, Object3D> = {}

/**
 * A color for a pubkey, from its own bits, so a target keeps its color
 * across sessions and devices and two targets rarely share one. Hue only;
 * saturation and lightness are fixed so every one of them reads against the
 * dark field and none collides with Earth's blue or the avatar's red by being
 * a wash of either.
 */
export function targetColor(pubkey: string): string {
  const hue = (parseInt(pubkey.slice(0, 4), 16) / 0xffff) * 360
  return `hsl(${hue.toFixed(0)} 90% 62%)`
}
