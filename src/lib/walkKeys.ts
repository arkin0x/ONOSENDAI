/**
 * walkKeys.ts: WALK's keyboard, first-person-shooter style (arkinox,
 * 2026-10-13).
 *
 * In WALK the camera is your eye, so the keys are the ones every first
 * person game has taught: W forward, S back, A and D sideways, with the
 * vertical on two pairs, Space and C as games have it, and R and F, which
 * sit above and below the left hand's home row. HOP and VIEW keep their own
 * keys (W up, S down, R far, F near, Space commit); this map is only read
 * while walking.
 *
 * | Key | Step | The WALK pad's key (hud/TouchControls.tsx walkPad) |
 * |---|---|---|
 * | W | forward | FORWARD |
 * | S | back | BACKWARD |
 * | A / D | left / right | the side arrows |
 * | Space | up one cell, the view's up | JUMP |
 * | C | down one cell, the view's down | DOWN |
 * | R / F | up / down one cell along the camera's own up, as WASD go by the camera | (none) |
 * | W or S with A or D held | 45 degrees to that side of the way you face | FORWARD or BACK held with a side arrow |
 *
 * Forward and back go the way you face, snapped to 8 directions: a diagonal
 * when the facing is 22.5 to 45 degrees off the nearest axis, one step on
 * both axes, and a slide along a wall you are angled into
 * (lib/walkSlide.ts); A and D go along the facing's right the same way. The
 * pad's keys do the same. A held key walks from the press on, its own
 * repeats ignored (store/walkHold.ts, walkHeldDir below).
 *
 * Under GRAVITY (store/useWalk.ts) up is a jump and down does nothing; Z,
 * answered by the keyboard itself, turns gravity on and off.
 *
 * Space and C, and the pad's JUMP and DOWN, always go up and down as you
 * see the world; R and F stay relative to where you look, like WASD
 * (arkinox, 2026-11-24: "in walk and terrain modes, jump (space) should
 * always go up relative to the view, and down (c) should always go down.
 * but R/F should continue to be relative, like the WASD"). The view's up
 * is the compass view's up (store/useCyberspace.ts `view`), snapped to the
 * grid: the up gravity goes by (lib/walkDown.ts), never tipped by LOOK.
 * Gravity off, R and F go along the camera's own up, snapped: looking up or
 * down past 45 degrees tips them toward behind or ahead, as it tips W. Under
 * GRAVITY both pairs are the jump and Down they always were, so nothing
 * changes there (see verticalAlong).
 *
 * There is no Ctrl: Ctrl+W closes the browser tab and no page can prevent
 * it, so "down, then forward" would cost the tab.
 */

import { moveDirection, type MoveName } from './moves'
import { upOf } from './walkDown'
import type { AxisDirection, ViewAxes } from './space'

/**
 * A held WALK direction (store/walkHold.ts): forward +1 or back -1, right +1
 * or left -1, up +1 or down -1. `view` marks a vertical from Space, C or the
 * pad's JUMP and DOWN, which go along the view's up; without it, a vertical
 * is R or F, along the camera's own up.
 */
export interface HeldDir {
  fwd: -1 | 0 | 1
  strafe: -1 | 0 | 1
  vert: -1 | 0 | 1
  view?: boolean
}

/**
 * The one switch for what Space, C and the pad's JUMP and DOWN go along with
 * gravity off: true, the view's up (the up gravity uses, never tipped by
 * LOOK); false, the camera's own up, snapped, as R and F (WALK before
 * 2026-11-24).
 */
export const JUMP_FOLLOWS_VIEW = true

/** The keys whose vertical is the view's (Space and C); R and F are the camera's. */
const VIEW_VERTICAL_KEYS: ReadonlySet<string> = new Set(['Space', 'KeyC'])

/** Whether the WALK key `code` moves along the view's up (Space, C) rather than the camera's (R, F). */
export function viewVerticalKey(code: string): boolean {
  return VIEW_VERTICAL_KEYS.has(code)
}

/**
 * The axis direction a WALK up or down step goes with gravity off: along
 * the view's up (against `down`, the walk's gravity axis as the view sets
 * it, lib/walkDown.ts) for Space, C and the pad (`view`), or along the
 * camera's own snapped up (`axes`, the screen's axes) for R and F. Under
 * GRAVITY no up or down step is taken: the walk jumps against `down`.
 */
export function verticalAlong(name: 'up' | 'down', view: boolean, axes: ViewAxes, down: AxisDirection): AxisDirection {
  if (!(view && JUMP_FOLLOWS_VIEW)) return moveDirection(axes, name)
  return name === 'up' ? upOf(down) : { axis: down.axis, dir: down.dir }
}

export const WALK_KEYS: Readonly<Record<string, MoveName>> = {
  KeyW: 'away',
  KeyS: 'toward',
  KeyA: 'left',
  KeyD: 'right',
  Space: 'up',
  KeyR: 'up',
  KeyC: 'down',
  KeyF: 'down',
}

/** The parts of a keydown the map reads. */
export interface WalkKeyEvent {
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** The step a keydown asks for in WALK, or null when it is not a WALK key. */
export function walkMove(e: WalkKeyEvent): MoveName | null {
  // A modifier makes it something else: a browser shortcut, or Shift's turn of the view.
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null
  return WALK_KEYS[e.code] ?? null
}

/**
 * The direction a WALK key holds (store/walkHold.ts), which combines with
 * the others held: W with D held is forward and right, whichever of the
 * two went down last; W with S, or A with D, cancel.
 */
export function walkHeldDir(move: MoveName, view = false): HeldDir {
  switch (move) {
    case 'away': return { fwd: 1, strafe: 0, vert: 0 }
    case 'toward': return { fwd: -1, strafe: 0, vert: 0 }
    case 'right': return { fwd: 0, strafe: 1, vert: 0 }
    case 'left': return { fwd: 0, strafe: -1, vert: 0 }
    case 'up': return view ? { fwd: 0, strafe: 0, vert: 1, view } : { fwd: 0, strafe: 0, vert: 1 }
    case 'down': return view ? { fwd: 0, strafe: 0, vert: -1, view } : { fwd: 0, strafe: 0, vert: -1 }
  }
}
