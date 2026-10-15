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
