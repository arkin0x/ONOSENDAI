/**
 * buildZoom.ts: how far the orbit can pull back, and how far the scene then
 * draws, kept apart from the scene so they can be reasoned about and tested.
 *
 * arkinox, 2026-11-15, placing Landscape Kit tiles in BUILD at 2^0: "when
 * building the landscape tiles i feel like i can't zoom out far enough". The
 * tiles are 64 and 128 gibsons across and a region is many of them (a 3 by 3
 * of 128s is 384 across), but the orbit stopped at 96 cells, and at that
 * distance what you were looking at sat at the fog's end, black.
 *
 * BUILD now pulls back to BUILD_MAX_GIBSONS (1280 at 2^0). The camera's
 * near plane steps back with the orbit past 96 cells, so faces a cell apart
 * still sort 1280 cells off. Every other view keeps its 96-cell orbit and
 * its near plane.
 *
 * And in every view the fog never darkens what the camera looks at (arkinox,
 * the same day, in HOP near its 96-cell limit: "the darkness is obscuring my
 * avatar at near the maximum zoom-out"): the fog's distances follow the
 * orbit's (fog.ts), and the layers' reach (the sphere about the render origin
 * past which nothing is drawn) doubles as far as the fog's end needs, one
 * step at a time, always beyond it (nextReach), so a step is never seen.
 */

import { create } from 'zustand'
import { CULL_REACH } from './fog'
import { CAMERA_NEAR, ORBIT_MAX_DISTANCE } from './camera'

/**
 * How far BUILD's orbit pulls back, in gibsons: at 2^0, 1280 cells. On a
 * phone held upright (FOV 55, 375 by 812) the view is then about 615 cells
 * across at the cursor, so a 3 by 3 of 128 tiles (384) fills three fifths of
 * the width square on, and its diagonal (543) still fits turned 45 degrees;
 * on a laptop it is a fifth of the width. At 1024 the turned square lost its
 * corners on a phone.
 */
export const BUILD_MAX_GIBSONS = 1280

/**
 * The orbit's limit in render cells: the usual ORBIT_MAX_DISTANCE (96), or in
 * BUILD BUILD_MAX_GIBSONS at this zoom (a render cell is 2^scaleExp
 * gibsons), never less than the usual one: 1280 at 2^0, 640 at 2^1, 320 at
 * 2^2, 160 at 2^3, and 96 from 2^4 up, where the zoom itself already shows
 * more ground than that.
 */
export function orbitMaxDistance(build: boolean, scaleExp: number): number {
  if (!build) return ORBIT_MAX_DISTANCE
  return Math.max(ORBIT_MAX_DISTANCE, BUILD_MAX_GIBSONS / 2 ** Math.max(0, scaleExp))
}

/** How quickly a camera left outside a lowered limit eases back in to it, in seconds (as the tutorial's zoom eases). */
export const ORBIT_LIMIT_TAU = 0.4

/**
 * The controls' maxDistance for this frame, from the camera's `distance` from
 * its target and last frame's maxDistance `was`: the `limit`, a hard clamp as
 * it always was. Only when the limit itself has come in under the camera
 * (leaving BUILD far out, a zoom step to a coarser scale: `was` above it) does
 * the camera ease in rather than jump, the limit following it down. A camera
 * merely outside its own limit (an unlocked orbit as the target pulls away)
 * is clamped at once, as before.
 */
export function stepOrbitLimit(distance: number, limit: number, dt: number, was: number): number {
  if (!(distance > limit) || !(was > limit)) return limit
  return Math.max(limit, Math.min(was, distance + (limit - distance) * (1 - Math.exp(-Math.max(0, dt) / ORBIT_LIMIT_TAU))))
}

/**
 * The camera's near plane for an orbit `distance` from its target: CAMERA_NEAR
 * out to the usual 96-cell limit, then stepping back in proportion (0.67 at
 * 1280). A depth buffer's resolution falls with the square of the distance
 * over the near plane: at 1280 cells with the usual 0.05 two faces two cells
 * apart could not be told apart, and the tiles' dots and seams would flicker.
 * Nothing is nearer the camera than that at such an orbit.
 */
export function cameraNear(distance: number): number {
  return CAMERA_NEAR * Math.max(1, (Number.isFinite(distance) ? distance : 0) / ORBIT_MAX_DISTANCE)
}

/**
 * The reach grows from CULL_REACH in half-doublings (each step the square root
 * of 2 further): 192, 272, 384, 544, 768, 1087, 1536 ... 6144. Every cell
 * drawn past the fog's end is in the black and wasted, and a whole doubling
 * drew up to eight times the volume the fog needed; a half-doubling at most
 * 2.8 times. The least step at or past `need`.
 */
export function reachStep(need: number): number {
  for (let k = 0; k < 20; k++) {
    const r = Math.ceil(CULL_REACH * 2 ** (k / 2) - 1e-9)
    if (r >= need) return r
  }
  return CULL_REACH * 2 ** 10
}

/** A smaller reach is taken only once the need is this share of it or less, so a zoom or a re-anchor held near a step does not flip it. */
export const SHRINK_SLACK = 0.8

/**
 * The reach the layers draw to, from the `reach` now and how far from the
 * render origin the fog's end now reaches (`need`: its end plus the camera's
 * distance from the origin; radial fog, radialFog.ts, so a thing on the cull
 * sphere is at least the reach less that distance from the camera). Up at
 * once to the step the need asks for, in the same frame, so nothing past the
 * old reach is seen before it is drawn; down only to a step the need is well
 * inside (SHRINK_SLACK), where the fog is already black. The fog never looks
 * at the reach, so a step changes only what is drawn in the black.
 */
export function nextReach(reach: number, need: number): number {
  const up = reachStep(need)
  if (up >= reach) return up
  const down = reachStep(need / SHRINK_SLACK)
  return down < reach ? down : reach
}

/**
 * The reach every culled layer draws to this frame (WorldShards, WorldMessages,
 * the avatars, the seeds, the chests ...), in render cells from the render
 * origin. Set by the scene's fog (Scene.tsx SceneFog) beyond its end:
 * 272 to 384 at the usual orbit, 768 at HOP's 96-cell limit, 6144 at
 * BUILD's 1280.
 */
export const useDrawReach = create<{ reach: number }>(() => ({ reach: CULL_REACH }))
