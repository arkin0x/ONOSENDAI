/**
 * nearbyReturn.ts — RETURN from a Nearby Loot view goes back to where you were.
 *
 * VIEW on a Nearby Loot row begins a focus, and a focus replaces whatever the
 * scene was doing: spectating a friend at some link of their chain, say. When
 * that focus ends, RETURN used to go home to your own avatar, and the list
 * was gone. So VIEW takes a snapshot first (who you were spectating, which
 * link, where the anchor stood), and when the focus ends the snapshot is put
 * back: the spectation resumes on the same chain at the same link, its live
 * watch re-armed, and the list reopens. Not spectating? Then only the list
 * comes back, over your own avatar, which is where RETURN goes anyway.
 *
 * Restoring the spectation calls the spectator, which resets to "loading"
 * and refetches; the saved chain and index are written straight back over
 * that, and when the fetch lands the store keeps the explored index because
 * the chain's ids match (setSpectateChain). Started from the app, since the
 * stores import each other.
 */

import type { Plane } from 'cyberspace-core'
import { useCyberspace, type SpectateState } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { spectate } from './spectator'
import type { Position } from './space'

export interface NearbyReturn {
  spectate: SpectateState | null
  exploreIndex: number | null
  anchor: Position
  anchorPlane: Plane
}

/** What VIEW remembers before it looks away. A snapshot already waiting is kept. */
export function rememberNearbyReturn(): void {
  if (useShards.getState().nearbyReturn) return
  const s = useCyberspace.getState()
  useShards.getState().setNearbyReturn({ spectate: s.spectate, exploreIndex: s.exploreIndex, anchor: s.anchor, anchorPlane: s.anchorPlane })
}

/** Put the snapshot back. Exported for the test; the watch below calls it. */
export function restoreNearbyReturn(r: NearbyReturn): void {
  if (r.spectate) {
    // Re-arms the live watch and refetches; then the saved chain and link go
    // back over the "loading" it just set, so nothing flickers to the spawn.
    void spectate(r.spectate.pubkey, r.spectate.events)
    useCyberspace.setState({ spectate: { ...useCyberspace.getState().spectate!, events: r.spectate.events, actions: r.spectate.actions, status: r.spectate.status }, exploreIndex: r.exploreIndex, anchor: r.anchor, anchorPlane: r.anchorPlane })
  }
  useShards.getState().setNearbyOpen(true)
}

export function watchNearbyReturn(): () => void {
  return useCyberspace.subscribe((state, previous) => {
    if (previous.focus === null || state.focus !== null) return
    const r = useShards.getState().nearbyReturn
    if (!r) return
    useShards.getState().setNearbyReturn(null)
    restoreNearbyReturn(r)
  })
}
