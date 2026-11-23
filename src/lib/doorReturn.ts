/**
 * doorReturn.ts: a row of a door's HERE list flies to the thing, and RETURN
 * brings the door's card back (arkinox, 2026-11-09: "it needs to let me tap
 * on a shard to fly to it; returning must put me back in the door modal and
 * preserve the scroll position").
 *
 * The fly is the item VIEW every card already uses (useCyberspace focusItem),
 * and RETURN is that view's own: the focus ends. Before it looks away, the
 * tap keeps which door's card it left and how far its list and the card were
 * scrolled; when the focus ends, the card opens on the same door. The list
 * comes back where it was by its own memory (hooks/useScrollMemory, per door),
 * and the card around it by takeDoorScroll as it mounts. As
 * lib/nearbyReturn.ts does for the Nearby list, started from the app.
 */

import type { Plane } from 'cyberspace-core'
import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import type { Position } from './space'

/** The card a HERE row left: whose door, which, and how far its list and the card itself were scrolled. */
export interface DoorReturn {
  owner: string
  doorId: string
  listTop: number
  cardTop: number
}

/** The card to reopen when the view ends; null when none waits. */
let waiting: DoorReturn | null = null
/** The scrolls the reopened card's list takes as it mounts, once. */
let scroll: DoorReturn | null = null

/** VIEW from a door's HERE list: remember the card, close it, and fly to the thing. */
export function viewFromDoor(back: Omit<DoorReturn, 'owner'>, at: Position, plane: Plane, label: string, scaleExp: number): void {
  waiting = { ...back, owner: useCyberspace.getState().identity.pubkey }
  useShards.getState().selectSecret(null)
  useCyberspace.getState().viewAt(at, plane, label, scaleExp, { item: true })
}

/** The scrolls a door's list should take as it mounts, once: what RETURN brought back for this door, or null. */
export function takeDoorScroll(doorId: string): DoorReturn | null {
  if (scroll?.doorId !== doorId) return null
  const s = scroll
  scroll = null
  return s
}

/** What waits, for the test. */
export function doorReturnWaiting(): DoorReturn | null {
  return waiting
}

/**
 * Put the card back. Exported for the test; the watch below calls it. Only for
 * the identity that left it, and only while the door is still among its own
 * rows (deleted or moved since, there is no card to come back to).
 */
export function restoreDoorReturn(r: DoorReturn): void {
  if (useCyberspace.getState().identity.pubkey !== r.owner) return
  if (!useShards.getState().mine.some((d) => d.eventId === r.doorId)) return
  scroll = r
  // The door's card, and nothing over it: a Nearby list a VIEW before this one would bring back stays shut.
  useShards.getState().setNearbyOpen(false)
  useShards.getState().selectSecret(r.doorId)
}

export function watchDoorReturn(): () => void {
  return useCyberspace.subscribe((state, previous) => {
    // Another identity signed in: what the last one left waits for nobody.
    if (state.identity.pubkey !== previous.identity.pubkey) { waiting = null; scroll = null }
    if (previous.focus === null || state.focus !== null) return
    const r = waiting
    if (!r) return
    waiting = null
    restoreDoorReturn(r)
  })
}

/** For the tests: nothing waiting. */
export function resetDoorReturn(): void {
  waiting = null
  scroll = null
}
