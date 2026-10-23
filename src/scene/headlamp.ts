/**
 * headlamp.ts: the world's shards shaded as if a lamp sat on the camera
 * (arkinox, 2026-10-23: "Ship it, add the toggle to the View panel in the
 * menu").
 *
 * Out in the world a shard is drawn unlit: every face is exactly its colour
 * (ShardMesh `world`). Two faces of one colour at different angles or depths
 * then merge into one flat patch: the drain coil's grey walls ran into each
 * other, and XOR's town at block 101, all one tan, read as a tan mess. The
 * headlamp lights them from the eye, like a flashlight:
 *
 * - FACING. A face square to the view shows its full colour, and darkens as it
 *   turns away, down to FACE_FLOOR at edge on. The normal is the face's own,
 *   flat, taken from the screen-space derivatives of its position, and it is
 *   compared with the view axis rather than the ray to each pixel, so a flat
 *   face is one shade. Both sides shade alike (the world draws both).
 * - DISTANCE. Full colour out to NEAR_SHARE of the reach, then an easy fall
 *   toward DISTANCE_FLOOR. The reach is the camera's distance from what it
 *   orbits, held between REACH_MIN and REACH_MAX, so the falloff keeps its
 *   shape at every zoom (render coordinates are cells at the current 2^N) and
 *   every dolly, and WALK, whose eye sits on the avatar, gets REACH_MIN. It
 *   dims toward black, as the scene's fog already does further out.
 *
 * Lines and points have no face to turn, so they take the distance only.
 *
 * Cost: a few lines of fragment math. No pass, draw call or material is
 * added. Every world face material carries the same compile hook and the same
 * program key, so all of them share one program per variant they already
 * had, and every one of them reads the same two uniform objects, which one
 * component (HeadlampRig, Scene.tsx) writes once a frame. Off, the shader
 * skips the multiply on a uniform, so the picture is exactly the unlit one
 * and nothing compiles again when the switch is turned.
 *
 * The bloom does not see a face's colour at all (Scene.tsx WorldBloom reads a
 * tagged face as dark), so shading a face cannot make it flare or go dull
 * there; the points and lines it does see only ever get dimmer.
 */

import type { WebGLProgramParametersWithUniforms } from 'three'
import { GRID_RADIUS } from '../lib/space'

/** The share of its colour a face keeps edge on to the view: never black. */
export const FACE_FLOOR = 0.4
/** The share of its colour anything keeps far off, before the fog takes it. */
export const DISTANCE_FLOOR = 0.3
/** Full colour out to this share of the reach. */
export const NEAR_SHARE = 0.75
/** Past NEAR_SHARE, the colour's step toward DISTANCE_FLOOR falls by e every FALL_SHARE of the reach. */
export const FALL_SHARE = 1.6
/** The least reach, in render cells: WALK's eye is on the avatar, a reach of nothing. */
export const REACH_MIN = 8
/** The most reach: the orbit's own limit (Scene.tsx). */
export const REACH_MAX = GRID_RADIUS * 4

/**
 * The two uniforms every headlamp material shares, by reference: one write
 * reaches every program that reads them. `uHeadlamp` is 1 on, 0 off.
 */
export const headlampUniforms = {
  uHeadlamp: { value: 1 },
  uHeadlampReach: { value: 26 },
}

/** Off for whatever does not wear the headlamp: the bench's and thumbnails' point discs. */
export const HEADLAMP_NEVER = { value: 0 }

/** The reach for a camera `distance` cells from what it looks at. */
export function headlampReach(distance: number): number {
  return Math.min(REACH_MAX, Math.max(REACH_MIN, Number.isFinite(distance) ? distance : REACH_MIN))
}

/** The share of its colour a face keeps when its normal's view-space z (toward the camera) is `nz`. Mirrors the shader. */
export function facingShare(nz: number): number {
  return FACE_FLOOR + (1 - FACE_FLOOR) * Math.min(1, Math.abs(nz))
}

/** The share of its colour anything keeps `distance` cells from the camera at `reach`. Mirrors the shader. */
export function distanceShare(distance: number, reach: number): number {
  const past = Math.max(0, distance - reach * NEAR_SHARE) / (reach * FALL_SHARE)
  return DISTANCE_FLOOR + (1 - DISTANCE_FLOOR) * Math.exp(-past)
}

const f = (x: number): string => x.toFixed(4)

/** The two uniforms and the distance share, for any fragment shader (the point discs read this). */
export const HEADLAMP_DISTANCE_GLSL = /* glsl */ `
uniform float uHeadlamp;
uniform float uHeadlampReach;
float headlampDistance(float d) {
  float past = max(0.0, d - uHeadlampReach * ${f(NEAR_SHARE)}) / (uHeadlampReach * ${f(FALL_SHARE)});
  return ${f(DISTANCE_FLOOR)} + ${f(1 - DISTANCE_FLOOR)} * exp(-past);
}
`

/** The facing share, for a face's fragment shader. */
const HEADLAMP_FACING_GLSL = /* glsl */ `
float headlampFacing(vec3 viewPosition) {
  // The flat face's normal from how its position changes across the screen,
  // as three's flatShading takes it. Unscaled, so it holds at any distance;
  // a triangle too thin to have one counts as facing.
  vec3 n = cross(dFdx(viewPosition), dFdy(viewPosition));
  float l = length(n);
  float nz = l > 0.0 ? abs(n.z) / l : 1.0;
  return ${f(FACE_FLOOR)} + ${f(1 - FACE_FLOOR)} * min(nz, 1.0);
}
`

const MARK = '// headlamp'
const VARYING = 'varying vec3 vHeadlamp;'

/**
 * Patches a MeshBasicMaterial's or LineBasicMaterial's shader (three's
 * `basic`, which both compile from): the view-space position carried to the
 * fragment, and the colour scaled by the headlamp just before the fog, which
 * is where three has the final colour. With `facing` false (lines), distance
 * only. Each anchor is three's own include and must occur once; if three
 * changes them the shader is left as it was, and says so, rather than broken.
 * A shader already patched is left alone, so the patch is applied once.
 */
export function patchHeadlamp(shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader' | 'uniforms'>, facing: boolean): boolean {
  if (shader.fragmentShader.includes(MARK)) return true
  const once = (src: string, anchor: string): boolean => src.split(anchor).length === 2
  const anchors: Array<[string, string]> = [
    [shader.vertexShader, '#include <common>'],
    [shader.vertexShader, '#include <project_vertex>'],
    [shader.fragmentShader, '#include <common>'],
    [shader.fragmentShader, '#include <opaque_fragment>'],
  ]
  if (!anchors.every(([src, a]) => once(src, a))) {
    console.warn('[headlamp] three\'s basic shader is not the one expected; shards are drawn unshaded')
    return false
  }
  shader.uniforms.uHeadlamp = headlampUniforms.uHeadlamp
  shader.uniforms.uHeadlampReach = headlampUniforms.uHeadlampReach
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VARYING}`)
    .replace('#include <project_vertex>', '#include <project_vertex>\n\tvHeadlamp = mvPosition.xyz;')
  const shade = facing ? 'headlampFacing(vHeadlamp) * headlampDistance(length(vHeadlamp))' : 'headlampDistance(length(vHeadlamp))'
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${MARK}\n${VARYING}\n${HEADLAMP_DISTANCE_GLSL}${facing ? HEADLAMP_FACING_GLSL : ''}`)
    .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n\tif (uHeadlamp > 0.5) gl_FragColor.rgb *= ${shade};`)
  return true
}

/**
 * The compile hook and program key for a face material, as props: the same
 * two functions for every face, so every face shares one program for each
 * variant three already made (clipping, culling, fog), and the key is a
 * constant rather than three's default, the hook's source text.
 */
export const HEADLAMP_FACES = {
  onBeforeCompile: (shader: WebGLProgramParametersWithUniforms) => { patchHeadlamp(shader, true) },
  customProgramCacheKey: () => 'headlamp-faces-1',
} as const

/** The same for a line material: distance only. */
export const HEADLAMP_LINES = {
  onBeforeCompile: (shader: WebGLProgramParametersWithUniforms) => { patchHeadlamp(shader, false) },
  customProgramCacheKey: () => 'headlamp-lines-1',
} as const
