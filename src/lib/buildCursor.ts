/**
 * buildCursor.ts - where the next placement lands: the build cursor.
 *
 * The Builder does not keep a second cursor or a second camera. It rides the
 * free view (useCyberspace `focus` with `drive`), which already carries a
 * cursor of its own, independent of the avatar and of the chain: the pad, the
 * keys and the Position panel move it, the zoom sets its step and its cell,
 * and nothing in it can commit a move, because a commit is only taken from
 * your own head (`atHead`). So the build cursor is the free view's `cursor`,
 * in the plane the view shows (`anchorPlane`).
 *
 * The plane is the one thing that needs saying. At your head the plane on
 * show and the plane lined up for the next move are the same (`plane`). In a
 * free view they are not: P flips the view's plane (`anchorPlane`) and leaves
 * the one lined up at your head alone. A placement belongs to the plane you
 * are looking at, so it reads the view's.
 *
 * Pure functions of the store's state, kept out of the stores themselves so
 * that useShards (which deploys) and useBuilder (which owns the mode) can
 * both read them without importing each other.
 */

import type { Plane } from 'cyberspace-core'
import type { Position } from './space'

/** The slice of the cyberspace store these read. */
export interface BuildCursorSource {
  cursor: Position
  plane: Plane
  anchorPlane: Plane
  focus: { drive?: boolean } | null
}

/** The plane a placement lands in: the free view's own plane while one is driven, else the lined-up plane. */
export function buildPlane(s: BuildCursorSource): Plane {
  return s.focus?.drive ? s.anchorPlane : s.plane
}

/** The build cursor: the coordinate and plane the next placement is aimed at. */
export function buildCursorOf(s: BuildCursorSource): { position: Position; plane: Plane } {
  return { position: s.cursor, plane: buildPlane(s) }
}

/**
 * A move committed before building is still going: a proof being computed,
 * or a route stepping. Not a paused or failed route, which waits on you and
 * moves nothing. The BuildBar warns, with a STOP, only for this.
 */
export function moveUnderWay(s: { proof: { status: string }; plan: { status: string } | null }): boolean {
  return s.proof.status === 'computing' || s.plan?.status === 'running'
}

/** The slice of the cyberspace store `avatarInBuild` reads. */
export interface AvatarSource {
  position: Position
  headPlane: Plane
  spectate: object | null
  focusChain: () => ReadonlyArray<{ position: Position; plane: Plane }>
}

/**
 * Where the avatar of the chain on show stands in BUILD mode, where the scene
 * rides the build cursor rather than an avatar.
 *
 * Your own avatar stands at your true head, always: the CHAIN chip's mark on
 * your own chain only aims the build cursor and splits the trail, because an
 * avatar drawn at a past action, beside a bar saying how far away your avatar
 * is, looks exactly like building moved you (review of #235). A spectated
 * avatar stands at the action the mark is on, or its head, as history shows
 * it outside the mode; null while their chain has not arrived.
 */
export function avatarInBuild(s: AvatarSource, scrub: number | null): { position: Position; plane: Plane } | null {
  if (!s.spectate) return { position: s.position, plane: s.headPlane }
  const chain = s.focusChain()
  return chain[scrub === null ? chain.length - 1 : Math.min(scrub, chain.length - 1)] ?? null
}

/** The slice of the cyberspace store `cubeAt` reads. */
export interface CubeSource {
  cursor: Position
  anchor: Position
  pendingTarget: Position | null
  canDrive: () => boolean
}

/**
 * Where the cursor cube is drawn. Where you can drive, the cell lined up for
 * the next move: a commit's pending target while it computes, else the
 * cursor. In BUILD mode the cube is the build cursor, so always the cursor:
 * a move committed before building, still computing, used to keep the white
 * cube on that move's target while the ghost and the deploy followed the
 * cursor (review of #235). Off your head, with nothing to drive, the anchor.
 */
export function cubeAt(s: CubeSource, building: boolean): Position {
  if (!s.canDrive()) return s.anchor
  return building ? s.cursor : (s.pendingTarget ?? s.cursor)
}
