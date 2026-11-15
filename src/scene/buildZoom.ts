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
 * BUILD now pulls back to BUILD_MAX_GIBSONS (1280 at 2^0), the layers'
 * reach (the sphere about the render origin past which nothing is drawn)
 * doubles as far as the orbit needs, one step at a time, and the fog's end
 * goes out with the reach (fog.ts fogFar), at least BUILD_FOG_SHARE times
 * the orbit's distance. The camera's near plane steps back with the orbit
 * past 96 cells, so faces a cell apart still sort 1280 cells off.
 * Every other view keeps the 96-cell orbit, the 192-cell reach, its fog and
 * its near plane.
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
 * The controls' maxDistance for this frame: the `limit` when the camera,
 * `distance` from its target, is inside it; when the limit has just come in
 * under it (leaving BUILD far out, a zoom step to a coarser scale) the camera
 * eases in rather than jumping, the limit following it down.
 */
export function stepOrbitLimit(distance: number, limit: number, dt: number): number {
  if (!(distance > limit)) return limit
  return Math.max(limit, distance + (limit - distance) * (1 - Math.exp(-Math.max(0, dt) / ORBIT_LIMIT_TAU)))
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

/** The reach doubles from CULL_REACH: 192, 384, 768, 1536, 3072, 6144. The least step at or past `need`. */
export function reachStep(need: number): number {
  let r = CULL_REACH
  while (r < need && r < CULL_REACH * 2 ** 10) r *= 2
  return r
}

/** A smaller reach is aimed at only once the need is this share of it or less, so a zoom held near a step does not flip it. */
export const SHRINK_SLACK = 0.8

/**
 * The reach the fog is aimed inside: up at once to the step `need` asks for;
 * down only to a step the need is well inside (SHRINK_SLACK).
 */
export function nextAim(aim: number, need: number): number {
  const up = reachStep(need)
  if (up >= aim) return up
  const down = reachStep(need / SHRINK_SLACK)
  return down < aim ? down : aim
}

/**
 * How far past the layers' reach the fog may be left while it eases in, in
 * render cells: a re-anchor moves the camera up to a field's half-width
 * (GRID_RADIUS) in each axis in one frame, and the fog eases after it (fog.ts
 * FOG_TAU) as it always has. Inside this slack BUILD leaves the reach be,
 * as every view does, so a re-anchor never mounts and drops a ring of shards.
 */
export const LAG_SLACK = 48

/**
 * The reach the layers draw to, from the `reach` now, the `aim` and how far
 * from the render origin the fog now reaches (`fogReach`: its end plus the
 * camera's distance from the origin). Up to the aim at once (the fog eases
 * out after it, so nothing is seen before it is drawn). In BUILD also up far
 * enough to cover a fog still easing in behind a fast pull-back, beyond
 * LAG_SLACK: a wheel zoom 1000 cells out moves the camera 50 cells in a
 * frame. Down only once the fog is black inside the smaller reach (to a cell),
 * so nothing seen is dropped.
 */
export function nextReach(reach: number, aim: number, fogReach: number, build = false): number {
  const want = build ? Math.max(aim, reachStep(fogReach - LAG_SLACK)) : aim
  if (want >= reach) return want
  return fogReach <= want + 1 ? want : reach
}

/**
 * The least the fog's end is in BUILD, as a multiple of the camera's distance
 * from what it looks at: its start is then at least 1.7 times that distance,
 * so what the camera looks at keeps its colour, and from about 400 cells out
 * so does a 3 by 3 of 128 tiles about it. Most of the time it is further, as
 * far as the reach's step allows (fog.ts fogFar). At the 1280-cell limit the
 * reach is 6144 and the fog ends about 4840 out, inside the camera's far
 * plane (CAMERA_FAR).
 */
export const BUILD_FOG_SHARE = 2

/**
 * How far from the render origin the layers must draw in BUILD for a camera
 * `distance` from its target and `fromOrigin` from the origin: the fog's
 * least end (BUILD_FOG_SHARE) plus the camera's own distance out. Zero
 * outside BUILD, where the reach stays CULL_REACH.
 */
export function reachNeed(build: boolean, distance: number, fromOrigin: number): number {
  return build ? distance * BUILD_FOG_SHARE + fromOrigin : 0
}

/**
 * The reach every culled layer draws to this frame (WorldShards, WorldMessages,
 * the avatars, the seeds, the chests ...), in render cells from the render
 * origin. CULL_REACH except while BUILD is pulled back; set by the scene's fog
 * (Scene.tsx SceneFog), which is black inside it.
 */
export const useDrawReach = create<{ reach: number }>(() => ({ reach: CULL_REACH }))
