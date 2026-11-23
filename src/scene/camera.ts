/**
 * camera.ts: the scene camera's fixed optics, shared by the Canvas that
 * creates the camera and by anything that reasons about what it can show.
 */

/** The field of view the Canvas is created with, and what the sphere is framed against. */
export const FOV = 55

/**
 * The near clipping plane, in render cells: nothing closer to the camera than
 * this is drawn, which bounds how large anything can ever appear.
 */
export const CAMERA_NEAR = 0.05

/**
 * The far clipping plane, in render cells. The fog is black well inside it
 * (fog.ts FOG_FAR_MAX): 496 at HOP's and VIEW's 96-cell limit, 4640 at
 * BUILD's farthest pull-back (buildZoom.ts).
 */
export const CAMERA_FAR = 6000

/**
 * The orbit's closest approach outside WALK, in render cells (OrbitControls'
 * minDistance in Scene.tsx). Also how far ahead of the camera VIEW's flight
 * brings the view's centre, and so the cursor, when it stops (ViewFly.ts):
 * any nearer and the controls would push the camera back out to this.
 */
export const ORBIT_MIN_DISTANCE = 2

/**
 * The orbit's farthest pull-back outside BUILD, in render cells (OrbitControls'
 * maxDistance in Scene.tsx): HOP, VIEW, spectating and TV's shots. BUILD goes
 * further at fine zooms (buildZoom.ts orbitMaxDistance).
 */
export const ORBIT_MAX_DISTANCE = 96
