/**
 * fog.ts: the scene fog's distances (Scene.tsx SceneFog), kept apart so they
 * can be reasoned about, and tested, without the scene.
 */

import { GRID_RADIUS } from '../lib/space'

/** Where the scene's fog begins and where it is black, in render cells: TV's and WALK's. */
export const FOG_NEAR = GRID_RADIUS * 0.9
export const FOG_FAR = GRID_RADIUS * 4
/**
 * How far from the render origin the scene's layers draw anything: the REACH
 * every culled layer shares (WorldShards, StopField, Avatar, StopCubes,
 * SecretRegions, Earth ...: GRID_RADIUS * 8). Past it a thing is simply not
 * drawn, so the fog must be black before the camera can see that far, or
 * things pop at the line as the camera moves (review of #635, S2).
 */
export const CULL_REACH = GRID_RADIUS * 8
/**
 * How much further off the fog begins and ends in the third-person views
 * (HOP, VIEW, BUILD, spectating): arkinox, 2026-11-09: "can we also make the
 * default fog more distant? things turn black when they are still pretty
 * close." The camera orbits 26 cells out, so the fog began before the cursor
 * (21.6) and took more than a third of a shard 50 cells away; at twice the
 * distances it begins at 43.2 and is black at 192. The headlamp only dims,
 * to DISTANCE_FLOOR at worst (headlamp.ts); the black was the fog's.
 * Cyberspace TV's shots and WALK's eye keep the fog they were tuned with.
 *
 * The far end is also held inside the layers' reach: black by CULL_REACH
 * less the camera's distance from the render origin, so nothing at the cull
 * line is ever seen; the start keeps its share of the end. At the usual
 * orbit, 26 cells out over the cursor, that is 166; at the orbit's 96-cell
 * limit, about 96, as the fog always was there.
 */
export const VIEW_FOG_SCALE = 2

/** Where the fog starts, as a share of where it ends: 21.6 of 96, 43.2 of 192. */
export const FOG_START_SHARE = FOG_NEAR / FOG_FAR

/**
 * Where the fog is black: TV's and WALK's own end (`base`), or the
 * third-person views' VIEW_FOG_SCALE times further, but no further than
 * CULL_REACH less the camera's distance `fromOrigin` from the render origin,
 * and never nearer than the old end. The start is FOG_START_SHARE of it.
 */
export function fogFar(base: boolean, fromOrigin: number): number {
  if (base) return FOG_FAR
  return Math.max(FOG_FAR, Math.min(FOG_FAR * VIEW_FOG_SCALE, CULL_REACH - fromOrigin))
}

/**
 * How quickly the fog's distances follow their target, in seconds (an
 * exponential time constant): a re-anchor changes the camera's distance from
 * the render origin in one frame (a fly every field width, a landing), and the
 * fog eases there instead of stepping (review of #635, S2a).
 */
export const FOG_TAU = 0.4

/** The fog's `current` distance one frame of `dt` seconds closer to `target`, the same at any frame rate. */
export function easeFog(current: number, target: number, dt: number): number {
  return target + (current - target) * Math.exp(-Math.max(0, dt) / FOG_TAU)
}

/**
 * The fog's end one frame of `dt` seconds on, for a camera `fromOrigin` from
 * the render origin in a mode whose fog is TV's and WALK's own (`base`), the
 * end now `current` and the previous frame's mode `was` (null before the
 * first frame). Within a mode it eases (easeFog): a re-anchor moves the target
 * in one frame. The first frame and a change of mode (TV or WALK on or off)
 * jump straight to the target: the fog belongs to the view, and easing from
 * the third-person fog to TV's 96 took a second on entering, and the 24/7
 * broadcast page one or two to settle from the Fog's first distances
 * (review of #635, N10).
 */
export function fogFarStep(current: number, was: boolean | null, base: boolean, fromOrigin: number, dt: number): number {
  const target = fogFar(base, fromOrigin)
  return was === base ? easeFog(current, target, dt) : target
}
