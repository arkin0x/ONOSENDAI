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
 * | W or S with A or D held | 45 degrees to that side of the way you face | (none) |
 *
 * Forward and back go the way you face, snapped to 8 directions: a diagonal
 * near 45 degrees, and a slide along a wall you are angled into
 * (lib/walkSlide.ts). The pad's FORWARD and BACKWARD do the same.
 *
 * Under GRAVITY (store/useWalk.ts) up is a jump and down does nothing; Z,
 * answered by the keyboard itself, turns gravity on and off.
 *
 * There is no Ctrl: Ctrl+W closes the browser tab and no page can prevent
 * it, so "down, then forward" would cost the tab.
 */

import type { MoveName } from './moves'

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

/** A WALK press with the side key held with it: `strafe` +1 right, -1 left, 0 none (store/useWalk.ts press). */
export interface WalkPress { name: MoveName; strafe: -1 | 0 | 1 }

/**
 * The press a WALK key makes given the letters held with it (arkinox,
 * 2026-11-03): W or S with A or D held is a step 45 degrees to that side of
 * where you face, forward or back (lib/walkSlide.ts), whichever of the two
 * the keyboard repeats. A or D alone, or with both W and S held, is the side
 * step it always was. `held` is the WALK letters down now, this one included.
 */
export function walkPress(move: MoveName, code: string, held: ReadonlySet<string>): WalkPress {
  const strafe = ((held.has('KeyD') ? 1 : 0) - (held.has('KeyA') ? 1 : 0)) as -1 | 0 | 1
  if (code === 'KeyW' || code === 'KeyS') return { name: move, strafe }
  if (code === 'KeyA' || code === 'KeyD') {
    const w = held.has('KeyW')
    const s = held.has('KeyS')
    if (w !== s && strafe !== 0) return { name: w ? 'away' : 'toward', strafe }
  }
  return { name: move, strafe: 0 }
}
