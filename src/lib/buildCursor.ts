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
