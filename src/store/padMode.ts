/**
 * padMode.ts - the pad's modes, and the one ring the mode button turns.
 *
 * HOP plans a move and COMMIT sends it; VIEW is a free look from your head;
 * WALK is first person, every press a step (store/useWalk.ts); BUILD places
 * things at a build cursor and never moves you (store/useBuilder.ts).
 *
 * The mode button in the commit slot goes HOP, VIEW, BUILD and back to HOP
 * (arkinox, 2026-11-11). WALK left the ring: at rest in HOP (the cursor on
 * your avatar, no move planned or under way) RECALL's slot is a WALK button
 * (TouchControls), and in WALK both RECALL and the mode button go back to
 * HOP. BUILD starts where VIEW was looking (useBuilder `enter` keeps a
 * driven view's cursor). RECALL still goes back to HOP from VIEW and BUILD.
 * B, the Stash panel's BUILD, a DEPLOY, EXIT and Esc go in and out of BUILD
 * as they always have.
 */

import { useCyberspace } from './useCyberspace'
import { useBuilder } from './useBuilder'
import { copyLinedUp, useShards } from './useShards'
import { useWalk } from './useWalk'

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
 * Escape's) to end (useBuilder `exit`), so the ring and RECALL wait for it.
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

/** The mode button: one step round the ring. */
export function cycleMode(): void {
  switch (currentPadMode()) {
    case 'hop': useCyberspace.getState().viewHere(); return
    case 'view': useBuilder.getState().enter('build'); return
    // Out of the ring: the walk ends as leaving WALK always has (steps not
    // yet proved are dropped, what was signed stays), back to HOP.
    case 'walk': useWalk.getState().exit(); return
    case 'build': buildToHop(); return
  }
}
