/**
 * useBuilder.ts - BUILD mode: placing things anywhere in cyberspace without
 * going there.
 *
 * arkinox, 2026-10-07 (R5, R6): "deploying shards and messages should now use
 * the builder system instead [of piggybacking on the avatar position]. Deploy
 * will center the builder at the avatar's position but the position should be
 * easily changeable." and "you can exit build mode like you exit the
 * workshop; exiting leaves the view where it is (does not snap back to
 * avatar)."
 *
 * What the mode is made of:
 *
 * - The build cursor is the free view's cursor (lib/buildCursor.ts). Entering
 *   starts a free view, so the pad, W A S D, R and F, + and - and the Position
 *   panel's VIEW all move the build cursor with no new wiring, and the zoom
 *   sets its step and the cell a placement is centered in: zoom out to 2^6 and
 *   every step is 2^6 gibsons and a dropped shard is centered in a 2^6 cell.
 *   No second cursor, no second camera.
 * - Building never moves you and never signs a move. A free view is not your
 *   head (`atHead` is false), and every path to a movement action (COMMIT,
 *   the route overlay, the next-action button, the HOSAKA offer, the tether
 *   and its landing ghost) is taken only from your head. The keyboard's Space
 *   and X are routed here too (useKeyboard), so neither reaches the movement
 *   store while building.
 * - DEPLOY happens in BUILD mode. Any deploy that starts while the mode is off
 *   turns it on, centered on your avatar (the subscription at the bottom), and
 *   the deploy lands at the build cursor (useShards `deploy`). A deploy started
 *   while building leaves the cursor where you put it.
 * - Exiting leaves the view where it is: the free view stays, with its RETURN
 *   (FocusBar) to take you home. The one exception is a build cursor already
 *   on your avatar in your plane, where the view and your head are the same
 *   picture: exiting then simply ends the view, at the zoom you are at, so
 *   the movement controls come back without a RETURN that would change
 *   nothing on screen.
 * - Escape leaves the mode, like the workshop's close. The mode is a chip on
 *   the Escape stack (hooks/useEscape.ts), registered here when it turns on
 *   rather than by a component, because the mode outlives its bar: the bar
 *   steps aside while a deploy is lined up, and the mode does not. A deploy's
 *   bar, opened later, is the more recent chip and closes first; a modal or
 *   the menu closes before either.
 * - The mode ends by itself when the view it rides ends some other way
 *   (spectating, history, a plain focus on a deployment, an identity switch),
 *   because the build cursor is gone with it. A deploy still lined up then is
 *   canceled: a deploy happens only at a build cursor.
 *
 * Room for the next PRs. Build regions and drafts (PR 2, ruling B2: a cube
 * per room, one bag per region, one region key per region at COMMIT) belong
 * in this store beside `active`: a list of regions, each a cube at a chosen
 * height around a corner the build cursor picks, and a list of drafts, each a
 * placement inside one region. Both read the cursor and plane through
 * lib/buildCursor.ts, as a single deploy does now, and both are local until a
 * grouped COMMIT, which is why nothing here touches the chain.
 */

import { create } from 'zustand'
import { samePosition, useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { registerEscape } from '../hooks/useEscape'

/** How a session of BUILD mode began: the BUILD control (or B), or a DEPLOY. */
export type BuildEntry = 'build' | 'deploy'

/** The label the free view carries while it is the build cursor. */
export const BUILD_FOCUS_LABEL = 'BUILD'

export interface BuilderState {
  /** BUILD mode is on: the free view is the build cursor and placements land there. */
  active: boolean
  /** How this session began; null while the mode is off. */
  via: BuildEntry | null
  /**
   * Turn BUILD mode on. From the BUILD control the build cursor starts where
   * you are looking if that is already a free view (you went somewhere to
   * build there), and on your avatar otherwise. From a DEPLOY it always
   * starts on your avatar (R5). Already on, this changes nothing, so a deploy
   * started while building lands where the cursor already is.
   */
  enter: (via?: BuildEntry) => void
  /** Leave BUILD mode. The view stays where it is (R6); a pending deploy is canceled. */
  exit: () => void
  /** On, or off. The B key and the BUILD control. */
  toggle: () => void
  /** Bring the build cursor, and the view with it, back to your avatar. Still building. */
  toAvatar: () => void
}

/** The free view the build cursor rides is standing: driven, not spectating, not in history. */
function viewStands(s: ReturnType<typeof useCyberspace.getState>): boolean {
  return s.focus?.drive === true && s.spectate === null && s.exploreIndex === null
}

export const useBuilder = create<BuilderState>((set, get) => ({
  active: false,
  via: null,

  enter: (via = 'build') => {
    if (get().active) return
    const cs = useCyberspace.getState()
    // Building from a free view you already drove somewhere keeps that place.
    // Everything else starts on your avatar, in the plane your head shows.
    if (via === 'deploy' || !viewStands(cs)) cs.focusOn(cs.position, cs.plane, BUILD_FOCUS_LABEL, undefined, true)
    set({ active: true, via })
  },

  exit: () => {
    if (!get().active) return
    // Off first, so the view change below is not read as the view ending
    // under a live build mode.
    set({ active: false, via: null })
    if (useShards.getState().pending) useShards.getState().cancelDeploy()
    const cs = useCyberspace.getState()
    if (cs.focus?.drive && samePosition(cs.cursor, cs.position) && cs.anchorPlane === cs.plane) cs.clearFocus(true)
  },

  toggle: () => { if (get().active) get().exit(); else get().enter('build') },

  toAvatar: () => {
    if (!get().active) return
    const cs = useCyberspace.getState()
    cs.focusOn(cs.position, cs.plane, BUILD_FOCUS_LABEL, undefined, true)
  },
}))

// The view the build cursor rides ended some other way: the mode ends with
// it, and so does a deploy lined up at that cursor.
useCyberspace.subscribe((s) => {
  if (!useBuilder.getState().active || viewStands(s)) return
  useBuilder.setState({ active: false, via: null })
  if (useShards.getState().pending) useShards.getState().cancelDeploy()
})

// Every deploy happens in BUILD mode (R5): one that starts with the mode off
// turns it on, centered on your avatar, so the deploy lands at the build
// cursor and never at a cursor lined up for a move.
useShards.subscribe((s, prev) => {
  if (s.pending !== null && prev.pending === null && !useBuilder.getState().active) useBuilder.getState().enter('deploy')
})

// Escape leaves BUILD mode: on the stack from the moment the mode turns on
// until it turns off, however it turns off.
let offEscape: (() => void) | null = null
useBuilder.subscribe((s, prev) => {
  if (s.active === prev.active) return
  offEscape?.()
  offEscape = s.active ? registerEscape('chip', () => useBuilder.getState().exit()) : null
})
