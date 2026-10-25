/**
 * walkEye.ts: where the WALK camera's eye is, in render space.
 *
 * In WALK the camera is inside your avatar, so the avatar has to be drawn
 * exactly where the eye is on every frame, not where the store says you
 * stand: the eye runs ahead of the chain (store/useWalk.ts), and an avatar
 * drawn one ease behind the eye would put the camera in its wall. The rig
 * (Scene.tsx Rig) writes this each frame, before anything else in the scene
 * runs its frame, and the avatar reads it.
 *
 * A module-level mutable vector for the same reason travelOffset is one: it
 * changes every frame, and nothing should re-render because of it.
 */

import { Vector3 } from 'three'

/** The eye's target in render cells: the predicted head the walk is easing toward. */
export const walkEye = new Vector3()

/**
 * A fall in WALK (store/useWalk.ts), as the rig draws it: while `active`,
 * the eye is `offset` gibsons along cyberspace +Y from the cursor (negative
 * below it), and follows that height exactly instead of easing to it. Written
 * once a frame by the fall (tickFall), read once a frame by the rig: two
 * numbers, so a fall allocates nothing per frame.
 */
export const walkFall = { active: false, offset: 0 }
