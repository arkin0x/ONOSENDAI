/**
 * zoomOrbit.ts - where the camera goes when the zoom changes.
 *
 * A zoom rescales every render coordinate, and the camera's target (what it
 * orbits: your avatar, or the cursor when it is away from you) can land
 * somewhere new in the rescaled frame. From 2^80 up it always does, since the
 * target is your true position and that is a different sub-cell offset at
 * every zoom; below that it does whenever the cursor is off the avatar,
 * because the cursor's offset in cells halves or doubles.
 *
 * The rule is arkinox's: zooming must not change the orbit (arkinox,
 * 2026-10-01: "why does 2^84 thru 2^79 appear to alter the camera orbit
 * distance? it shouldnt do that"). So the camera carries by exactly the
 * target's jump, keeping its offset from the target, which is both the orbit
 * distance and the viewing angle, to the last bit. It used to carry only
 * while the camera was locked to the target; once you had orbited, the
 * camera stayed where it was and turned to the new target, and the distance
 * changed by up to a cell on every step. Measured after an orbit drag, it
 * wandered between 25.73 and 26.17 across 2^80 to 2^84, and from 27.16 to
 * 26.55 between 2^78 and 2^79 with the cursor two cells out.
 */

export type V3 = [number, number, number]

/** The camera position that keeps the orbit when the target moves from `from` to `to`. */
export function carryOrbit(camera: V3, from: V3, to: V3): V3 {
  return [camera[0] + (to[0] - from[0]), camera[1] + (to[1] - from[1]), camera[2] + (to[2] - from[2])]
}
