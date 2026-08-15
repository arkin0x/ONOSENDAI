/**
 * travel.ts — where the avatar is mid-hop, in render space.
 *
 * A commit used to teleport. `position` is the committed truth and it changes in
 * one step when the proof lands, so everything drawn from it jumped: you paid
 * for a crossing and then simply found yourself on the other side of it.
 *
 * The fix is not to animate `position`. That value is the chain, and smearing it
 * across frames would mean the store briefly holds coordinates no proof covers,
 * while every consumer of it (the terrain volume, the lattice, the sector) would
 * rebuild on every frame of the animation. Instead the store still moves in one
 * step and the avatar is DRAWN trailing behind, catching up over a few hundred
 * milliseconds.
 *
 * A module-level mutable vector rather than store state, for the same reason
 * cameraPose is one: this changes every frame, several components read it, and
 * none of them should re-render because of it.
 */

import { Vector3 } from 'three'

/**
 * Offset from the avatar's committed cell to where it is currently drawn, in
 * render cells. Zero whenever nothing is in flight.
 */
export const travelOffset = new Vector3()
