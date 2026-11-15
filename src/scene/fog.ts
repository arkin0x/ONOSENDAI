/**
 * fog.ts: the scene fog's distances (Scene.tsx SceneFog), kept apart so they
 * can be reasoned about, and tested, without the scene.
 *
 * The fog follows the zoom (arkinox, 2026-11-15, of a HOP zoom by block 101's
 * castle: "The fog gets closer and farther and closer as you zoom. its
 * awkward and doesnt make sense. it should just be consistent with the
 * zoom. At this point i like it better how it was before we changed it. can
 * you improve toward what I asked for with the larger visible distance?").
 *
 * Its start and its end are each a fixed distance plus a share of the
 * camera's distance from what it looks at (the orbit's target: your avatar,
 * the cursor, a TV shot's subject), and nothing else: zoom out a little and
 * the fog goes out a little, never back in. Before, its end was "as far as
 * the layers' reach allows", that reach less the camera's distance from the
 * render origin, and the reach doubled in steps as the orbit pulled back, so
 * between steps the fog came in as the camera went out (HOP from 26 to 64
 * cells: black at 166, then 128) and at each step leapt out (319 at 65); the
 * castle went into the black at a middle zoom and came back further out.
 * Now the layers' reach is set from the fog (buildZoom.ts nextReach): it
 * still steps, for what it costs to draw, but always beyond the fog's end,
 * so a step is never seen.
 *
 * The fade is long, as it was before 2026-11-15 (a start at 0.225 of the
 * end): colour falls off gently over most of what the camera can see rather
 * than at a thin band at the edge (0.85 of the end, #769). And it reaches
 * further than that one did: at the usual orbit (26 cells) full colour to 79
 * cells, black at 251, where it was 37 to 166; at HOP's 96-cell limit 184 to
 * 496, where it was 22 to 96. Darkness up close was the headlamp's, and its
 * floors stay as #769 set them (headlamp.ts).
 */

import { CAMERA_FAR } from './camera'
import { GRID_RADIUS } from '../lib/space'

/** Where the fog is black in Cyberspace TV and WALK, in render cells, for a camera close to what it looks at: the end they were tuned with. */
export const FOG_FAR = GRID_RADIUS * 4
/**
 * Where it begins in TV and WALK, for a camera close to what it looks at:
 * half its end, a long fade (it was 21.6, then 81.6, a thin band, in #769).
 */
export const FOG_NEAR = FOG_FAR / 2

/** In the third-person views (HOP, VIEW, BUILD, spectating), where the fog begins with the camera on its target, in render cells. */
export const VIEW_FOG_NEAR = 40
/** ... and how much further it begins for each cell the camera stands back from its target. */
export const VIEW_FOG_NEAR_SHARE = 1.5
/** In the third-person views, where the fog is black with the camera on its target, in render cells. */
export const VIEW_FOG_FAR = 160
/** ... and how much further it is black for each cell the camera stands back. */
export const VIEW_FOG_FAR_SHARE = 3.5

/**
 * The fog is never black further off than this, in render cells: well inside
 * the camera's far plane (CAMERA_FAR), so nothing is clipped while it still
 * shows. BUILD's 1280-cell pull-back asks for 4640.
 */
export const FOG_FAR_MAX = CAMERA_FAR * 0.8

/**
 * The least reach of the scene's culled layers (WorldShards, StopField,
 * Avatar, StopCubes, SecretRegions, Earth ...: GRID_RADIUS * 8), in render
 * cells from the render origin. Past the reach a thing is simply not drawn,
 * so the fog must be black before the camera can see that far, or things pop
 * at the line (review of #635, S2): the reach doubles from this as far as
 * the fog's end needs (buildZoom.ts nextReach).
 */
export const CULL_REACH = GRID_RADIUS * 8

/** A camera `distance` from its target, as a number the fog can use: 0 if it is not one. */
const cells = (distance: number): number => (Number.isFinite(distance) ? Math.max(0, distance) : 0)

/**
 * Where the fog begins, in render cells straight out from the camera, for a
 * camera `distance` from what it looks at, in TV or WALK (`base`) or a
 * third-person view. Always further than the target, so the fog never darkens
 * it nor the ground about it (arkinox, 2026-11-15, in HOP near the 96-cell
 * limit: "the darkness is obscuring my avatar at near the maximum zoom-out"):
 * at least 1.5 times as far, and 40 cells more. In BUILD at 2^0 a 3 by 3 of
 * 128 tiles about the cursor is all clear from 480 cells out.
 *
 * TV's shots stand 24 out at most and WALK's eye sits on the avatar, so in
 * both it is FOG_NEAR; a shot further back takes it out to twice its distance.
 */
export function fogNear(base: boolean, distance: number): number {
  const d = cells(distance)
  if (base) return Math.max(FOG_NEAR, d * 2)
  return Math.min(VIEW_FOG_NEAR + d * VIEW_FOG_NEAR_SHARE, fogFar(false, d))
}

/**
 * Where the fog is black, in render cells straight out from the camera, for a
 * camera `distance` from what it looks at, in TV or WALK (`base`) or a
 * third-person view. Two to four times as far as where it begins,
 * so the fade between is long and soft. FOG_FAR in TV and WALK, four times a
 * shot's distance should one stand further back.
 */
export function fogFar(base: boolean, distance: number): number {
  const d = cells(distance)
  if (base) return Math.min(FOG_FAR_MAX, Math.max(FOG_FAR, d * 4))
  return Math.min(FOG_FAR_MAX, VIEW_FOG_FAR + d * VIEW_FOG_FAR_SHARE)
}

/**
 * How quickly the distance the fog is set from follows the camera's, in
 * seconds (an exponential time constant). A zoom is already smooth (the
 * controls damp it) and the fog keeps up with it; a jump in the camera's
 * distance within a view (a VIEW fly stopping with the view's centre close
 * ahead, a landing) glides instead of stepping.
 */
export const FOG_TAU = 0.25

/**
 * The least share of the camera's distance the fog is set from while it
 * glides: a pull-back faster than FOG_TAU (a wheel held out in BUILD) leaves
 * the fog behind, and at this share its start is still past the target
 * (40 + 1.2 times its distance).
 */
export const FOG_LAG_FLOOR = 0.8

/** `current` one frame of `dt` seconds closer to `target`, the same at any frame rate. */
export function easeFog(current: number, target: number, dt: number): number {
  return target + (current - target) * Math.exp(-Math.max(0, dt) / FOG_TAU)
}

/**
 * The distance the fog is set from (fogNear, fogFar) one frame of `dt`
 * seconds on, for a camera `distance` from its target in TV or WALK (`base`)
 * or not, the fog now set from `current` and the previous frame's mode `was`
 * (null before the first frame). Within a mode it glides after the camera's
 * (easeFog), never under FOG_LAG_FLOOR of it; the first frame and a change of
 * mode (TV or WALK on or off) take the camera's at once: the fog belongs to
 * the view, and the 24/7 broadcast page must not settle from the Fog's first
 * distances (review of #635, N10). Moving toward the camera's distance, never
 * past it, so while a zoom goes one way the fog goes the same way.
 */
export function fogDistanceStep(current: number, was: boolean | null, base: boolean, distance: number, dt: number): number {
  const d = cells(distance)
  if (was !== base || !Number.isFinite(current)) return d
  return Math.max(easeFog(current, d, dt), d * FOG_LAG_FLOOR)
}
