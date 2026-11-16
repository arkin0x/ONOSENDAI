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
 * avatar at near the maximum zoom-out"): the layers' reach (the sphere about
 * the render origin past which nothing is drawn) doubles as far as the orbit
 * needs, one step at a time, and the fog's end goes out with the reach
 * (fog.ts fogFar), at least TARGET_FOG_SHARE times the orbit's distance. At
 * the usual orbit (26 cells) nothing changes: reach 192, fog 141 to 166.
 */

import { create } from 'zustand'
import { CULL_REACH, TARGET_FOG_SHARE } from './fog'
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
 * FOG_TAU) as it always has. Inside this slack the reach is left be, so a
 * re-anchor never mounts and drops a ring of shards.
 */
export const LAG_SLACK = 48

/**
 * The reach the layers draw to, from the `reach` now, the `aim` and how far
 * from the render origin the fog now reaches (`fogReach`: its end plus the
 * camera's distance from the origin); `settled` when the fog has reached
 * where it is going. Up to the aim at once (the fog eases
 * out after it, so nothing is seen before it is drawn). Also up far enough
 * to cover a fog still easing in behind a fast pull-back, beyond
 * LAG_SLACK: a wheel zoom 1000 cells out moves the camera 50 cells in a
 * frame. Down only once the fog is black inside the smaller reach (to a cell),
 * so nothing seen is dropped, or once the fog has settled: held at its 96-cell
 * floor by a camera far from the origin it can never come inside, and the
 * reach would otherwise stay wide for good.
 */
export function nextReach(reach: number, aim: number, fogReach: number, settled = false): number {
  // A settled fog is where the aim put it: nothing easing to cover.
  const want = settled ? aim : Math.max(aim, reachStep(fogReach - LAG_SLACK))
  if (want >= reach) return want
  return fogReach <= want + 1 || settled ? want : reach
}

/**
 * How far from the render origin the layers must draw for a camera
 * `distance` from its target and `fromOrigin` from the origin: the fog's
 * least end (fog.ts TARGET_FOG_SHARE) plus the camera's own distance out.
 * At the usual orbit that is well inside CULL_REACH; HOP and VIEW pulled
 * back to 96 need 384, BUILD at its 1280-cell limit 6144.
 */
export function reachNeed(distance: number, fromOrigin: number): number {
  return (Number.isFinite(distance) ? distance : 0) * TARGET_FOG_SHARE + fromOrigin
}

/**
 * The reach every culled layer draws to this frame (WorldShards, WorldMessages,
 * the avatars, the seeds, the chests ...), in render cells from the render
 * origin. CULL_REACH at the usual orbit, further as the orbit pulls back; set
 * by the scene's fog (Scene.tsx SceneFog), which is black inside it.
 */
export const useDrawReach = create<{ reach: number }>(() => ({ reach: CULL_REACH }))
