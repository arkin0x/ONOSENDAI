/**
 * padMode.ts - the pad's modes, the one ring the mode button turns, and the
 * WALK toggle beside it.
 *
 * HOP plans a move and COMMIT sends it; VIEW is a free look from your head;
 * WALK is first person, every press a step (store/useWalk.ts); BUILD places
 * things at a build cursor and never moves you (store/useBuilder.ts).
 *
 * The mode button in the commit slot goes HOP, VIEW, BUILD and back to HOP
 * (arkinox, 2026-11-11). BUILD starts where VIEW was looking (useBuilder
 * `enter` keeps a driven view's cursor). B, the Stash panel's BUILD, a
 * DEPLOY, EXIT and Esc go in and out of BUILD as they always have.
 *
 * WALK is not in the ring: it is a toggle in RECALL's slot (arkinox,
 * 2026-11-12). With the cursor on your avatar and nothing under way, in HOP,
 * VIEW or BUILD alike, that slot is WALK, dim, and the mode button is lit.
 * Pressing WALK lights it and dims the mode button, which keeps the mode
 * WALK was entered from (enterWalk). In WALK, the lit WALK or the dim mode
 * button goes back to that mode (leaveWalk), VIEW and BUILD at your avatar.
 * While steps wait on their proofs the slot is STOP, as before. With the
 * cursor off your avatar the slot is RECALL, which brings it home and stays
 * in the mode: VIEW (viewToAvatar), BUILD (useBuilder `toAvatar`), HOP
 * (useCyberspace `cancel`), and then WALK is back (`recall`).
 */

import { samePosition, useCyberspace, VIEW_FOCUS_LABEL } from './useCyberspace'
import { useBuilder } from './useBuilder'
import { copyLinedUp, useShards } from './useShards'
import { useWalk } from './useWalk'
import { useSecrets } from './useSecrets'
import { regionAtOriginalSize, useRegion } from './useRegion'
import { resetDoorReturn } from '../lib/doorReturn'
import { landFly } from '../lib/viewFly'

export type PadMode = 'hop' | 'view' | 'walk' | 'build'

/** The mode the pad is in. WALK and BUILD never stand together: BUILD's view takes you off your head, which ends WALK. */
export function padMode(walking: boolean, building: boolean, viewing: boolean): PadMode {
  if (walking) return 'walk'
  if (building) return 'build'
  if (viewing) return 'view'
  return 'hop'
}

/** The pad's mode now, read from the stores. */
export function currentPadMode(): PadMode {
  const cs = useCyberspace.getState()
  return padMode(cs.walking, useBuilder.getState().active, cs.viewing())
}

/**
 * A deploy lined up that leaving BUILD would cancel: that is CANCEL's (or
 * Escape's) to end (useBuilder `exit`), so the ring and WALK wait for it.
 * A copy lined up again after a placement is not one: leaving stands it down.
 */
export function buildHeld(shards = useShards.getState()): boolean {
  return shards.pending !== null && !copyLinedUp(shards)
}

/**
 * Out of BUILD and back to HOP: the mode ends, and the view it rode ends too,
 * at the zoom you are at, so the cursor and the camera are home at your head.
 * EXIT on the bar leaves the view where it is (R6); the ring goes all the way
 * round. Spectating, there is no HOP to go to: the scene goes back to
 * watching them, as EXIT does. Nothing while a deploy is lined up.
 */
export function buildToHop(): void {
  const b = useBuilder.getState()
  if (!b.active) return
  b.exit()
  if (useBuilder.getState().active) return
  const cs = useCyberspace.getState()
  if (cs.spectate === null && cs.focus?.drive) cs.clearFocus(true)
}

/**
 * VIEW left for a mode, not for a RETURN: a Nearby list, a door's card or
 * the Secrets list it came from stays shut (#675).
 */
function leaveViewForMode(): void {
  useShards.getState().setNearbyReturn(null)
  resetDoorReturn()
  useSecrets.getState().focus(null)
}

/** VIEW to BUILD: BUILD starts where the view is looking (useBuilder `enter` keeps a driven view's cursor). */
function viewToBuild(): void {
  leaveViewForMode()
  useBuilder.getState().enter('build')
}

/** The mode button: one step round the ring. In WALK, the dim mode button: back to the mode WALK came from. */
export function cycleMode(): void {
  switch (currentPadMode()) {
    case 'hop': useCyberspace.getState().viewHere(); return
    case 'view': viewToBuild(); return
    case 'walk': leaveWalk(); return
    case 'build': buildToHop(); return
  }
}

/**
 * WALK from the pad (arkinox, 2026-11-12), from HOP, VIEW or BUILD, kept as
 * the mode to go back to. WALK is first person at your head, so VIEW's view
 * ends (useWalk `enter`) and BUILD ends as the ring ends it (buildToHop).
 * Nothing while a deploy is lined up in BUILD, which is PLACE's or CANCEL's
 * to settle (buildHeld), nor off your own head (spectating, in history, in
 * hyperspace transit), where there is no head to walk from.
 */
export function enterWalk(): void {
  const from = currentPadMode()
  if (from === 'walk') return
  const cs = useCyberspace.getState()
  if (cs.spectate !== null || cs.exploreIndex !== null || cs.transit !== null) return
  if (from === 'build') {
    if (buildHeld()) return
    buildToHop()
    if (useBuilder.getState().active) return
  }
  if (from === 'view') leaveViewForMode()
  useWalk.getState().enter()
  if (useCyberspace.getState().walking) useWalk.setState({ from })
}

/**
 * Out of WALK, back to the mode it was entered from: the walk ends as leaving
 * WALK always has (steps not yet proved are dropped, what was signed stays),
 * then VIEW or BUILD comes back on at your avatar.
 */
export function leaveWalk(): void {
  const { from } = useWalk.getState()
  useWalk.getState().exit()
  if (useCyberspace.getState().walking) return
  if (from === 'view') useCyberspace.getState().viewHere()
  else if (from === 'build') useBuilder.getState().enter('build')
}

/**
 * RECALL in VIEW (arkinox, 2026-11-12): the cursor, and the view with it,
 * home to your avatar, still in VIEW and at the zoom you are at. BUILD's
 * is useBuilder `toAvatar`, the same move. A fly not yet landed lands
 * first, so it cannot carry the cursor off again. What the view was a look
 * at goes as the old RECALL's RETURN let it go: the pin, and the Nearby
 * list, door card or Secrets list a later RETURN would have reopened.
 */
export function viewToAvatar(): void {
  if (!useCyberspace.getState().viewing()) return
  landFly()
  leaveViewForMode()
  const cs = useCyberspace.getState()
  cs.clearPin()
  cs.focusOn(cs.position, cs.plane, VIEW_FOCUS_LABEL, undefined, true, false, { view: true })
}

/**
 * RECALL on the pad, outside WALK. A proof, a route or a cloud job is
 * stopped first (useCyberspace `cancel`), as the STOP on the button says.
 * A grown region is RESET (useRegion `resetSize`). Otherwise the cursor comes home and the mode stays: BUILD's
 * build cursor (`toAvatar`), VIEW's (viewToAvatar), HOP's (`cancel`). In
 * region mode, as X: the cursor back to where region mode started
 * (`collapseToEntry`); already there, region mode ends and the cursor comes
 * home, still in VIEW, so RECALL never stands on screen doing nothing.
 */
export function recall(): void {
  const cs = useCyberspace.getState()
  const region = useRegion.getState()
  if (cs.proof.status === 'computing' || cs.cloud.status !== 'idle' || cs.plan !== null) { cs.cancel(); return }
  if (region.active && !regionAtOriginalSize(region)) { region.resetSize(); return }
  if (useBuilder.getState().active) { useBuilder.getState().toAvatar(); return }
  if (cs.viewing()) {
    if (region.active && region.entry && !samePosition(cs.cursor, region.entry)) { region.collapseToEntry(); return }
    region.exit()
    viewToAvatar()
    return
  }
  cs.cancel()
}
