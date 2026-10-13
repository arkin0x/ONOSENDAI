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
 * | Key | Step |
 * |---|---|
 * | W | forward (the pad's FAR) |
 * | S | back (NEAR) |
 * | A / D | left / right |
 * | Space or R | up one cell |
 * | C or F | down one cell |
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
