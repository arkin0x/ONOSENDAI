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
 * | Space or R | up one cell | JUMP |
 * | C or F | down one cell | DOWN |
 * | W or S with A or D held | 45 degrees to that side of the way you face | FORWARD or BACK held with a side arrow, or FORWARD pressed near either end |
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
 * There is no Ctrl: Ctrl+W closes the browser tab and no page can prevent
 * it, so "down, then forward" would cost the tab.
 */

import type { MoveName } from './moves'

/** A held WALK direction (store/walkHold.ts): forward +1 or back -1, right +1 or left -1, up +1 or down -1. */
export interface HeldDir {
  fwd: -1 | 0 | 1
  strafe: -1 | 0 | 1
  vert: -1 | 0 | 1
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
export function walkHeldDir(move: MoveName): HeldDir {
  switch (move) {
    case 'away': return { fwd: 1, strafe: 0, vert: 0 }
    case 'toward': return { fwd: -1, strafe: 0, vert: 0 }
    case 'right': return { fwd: 0, strafe: 1, vert: 0 }
    case 'left': return { fwd: 0, strafe: -1, vert: 0 }
    case 'up': return { fwd: 0, strafe: 0, vert: 1 }
    case 'down': return { fwd: 0, strafe: 0, vert: -1 }
  }
}
