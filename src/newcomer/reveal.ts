/**
 * reveal.ts: which tour step brings each part of the screen into the
 * newcomer view, in one table (new-user feedback, 2026-11-21: "The interface
 * was complex, with columns on both the left and right. Most elements didn't
 * resonate at first sight").
 *
 * While the tour runs for a newcomer, a part shows once the step named here
 * has come up (newcomer/useNewcomer.ts records the steps seen). Parts named
 * 'never' are not part of the newcomer view at all (movement proof terms,
 * the work behind a move); 'always' parts show from the start.
 *
 * Outside a run (paused, or the player picked "Newcomer view" in Settings),
 * the newcomer view shows everything the tour teaches, so nobody is left
 * without a control the tour would have given them. Outside the newcomer view
 * everything shows, as it always has.
 */

import type { PanelId } from '../store/usePanelLayout'

/** A part of the screen outside the menu that the newcomer view stages. */
export type ScreenPart =
  | 'pad.go' // COMMIT (GO), the slot right of RECALL
  | 'pad.arrows' // the six cursor keys, and WALK's four
  | 'pad.recall' // RECALL (BACK TO ME), and WALK in its slot
  | 'pad.gravity' // GRAVITY in WALK
  | 'pad.zoom' // + and - and the 2^ readout
  | 'pad.jumps' // the globe and the cube: one-press zooms
  | 'pad.modes' // the HOP / VIEW / BUILD / SCAN ring in the commit slot
  | 'pad.publish' // LOCAL / LIVE (ON THIS DEVICE / ONLINE)
  | 'route' // the ROUTE list over the menu button
  | 'compass' // the compass, top right
  | 'chat' // CHAT (and the star and GOAL in its place)
  | 'menu' // the menu button
  | 'proof-labels' // the cantor ops and hX labels in the scene

export type RevealId = ScreenPart | `panel.${PanelId}`

/** A step id from tutorial/script.ts, or always / never. */
export type RevealAt = string

export const REVEAL: Readonly<Record<RevealId, RevealAt>> = {
  // The green box: one button to press.
  'pad.go': 'box',
  // The course: the player moves the cursor themselves, and can bring it back.
  'pad.arrows': 'to-course',
  'pad.recall': 'to-course',
  compass: 'to-course',
  'pad.gravity': 'gravity',
  // Your items: the menu opens on ITEMS (with the tour's own panel and Settings, the way out).
  menu: 'inventory',
  'panel.items': 'inventory',
  'panel.tutorial': 'inventory',
  'panel.view': 'inventory',
  // The workshop: CREATE is where shards are made.
  'panel.create': 'workshop',
  // Where next?: the basics are done, so the everyday controls come in.
  'pad.zoom': 'choice',
  'pad.jumps': 'choice',
  'pad.publish': 'choice',
  chat: 'choice',
  'panel.identity': 'choice',
  'panel.games': 'choice',
  'panel.controls': 'choice',
  // Each route brings its own panel.
  'panel.hyperspace': 'earth-board',
  'panel.agents': 'agents',
  'panel.targets': 'friend',
  'panel.links': 'straylight',
  'pad.modes': 'build-place',
  // HOSAKA's price comes in with the short trips; a job bought then is kept, resumed or discarded in Cloud compute.
  'panel.cloud': 'earth-pick',
  // Not part of the newcomer view: movement proof terms and expert panels.
  route: 'never',
  'proof-labels': 'never',
  'panel.avatars': 'never',
  'panel.hidden': 'never',
  'panel.discovered': 'never',
  'panel.scale': 'never',
  'panel.position': 'never',
  'panel.viewat': 'never',
  'panel.proof': 'never',
  'panel.chain': 'never',
  'panel.legend': 'never',
  'panel.derezz': 'never',
  'panel.relays': 'never',
}

/** How the newcomer view stands for the identity on screen. */
export interface RevealState {
  /** The newcomer view is on (plain names, staged parts). */
  newcomer: boolean
  /** A tour run is staging the parts: only those whose step has come up show. */
  staged: boolean
  /** The step ids that have come up in this player's run. */
  seen: ReadonlySet<string>
}

export const SHOW_EVERYTHING: RevealState = { newcomer: false, staged: false, seen: new Set() }

/** Whether a part shows. */
export function revealed(id: RevealId, s: RevealState): boolean {
  if (!s.newcomer) return true
  const at = REVEAL[id]
  if (at === 'always') return true
  if (at === 'never') return false
  return !s.staged || s.seen.has(at)
}
