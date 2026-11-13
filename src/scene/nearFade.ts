/**
 * nearFade.ts: what fades out as the camera comes right up to it.
 *
 * After the tutorial's first hop the camera eases in over the avatar's
 * shoulder, a few cells from where it spawned, and the spawn marker's shells
 * (scene/SpawnMarker.tsx, open tubes six gibsons wide, glowing under bloom)
 * passed beside the lens as wide magenta, purple, red and white bars across
 * the frame (owner, 2026-11-13). Found by hiding the scene a kind at a time in
 * a headless re-shot: with every line hidden the bars stayed; with every mesh
 * hidden they went; the rays through them hit the marker. So anything drawn
 * here gets an alpha that ramps from 0 at `from` to its own at `to`, by the
 * distance of each fragment from the eye (render cells), and the eye passes
 * through it instead of into a wall of light. Further off nothing changes.
 *
 * | Wears it | From, to | Why there |
 * |---|---|---|
 * | the spawn marker | one and three of its ring radii (3 and 9 cells at 2^0, scaled with it) | the bars, at 2.4 to 5 cells in the re-shot |
 * | the world's shard lines (the tutorial's lime box among them) and the rooms' outlines | 1 and 3 cells | the edges a close camera crosses; off in WALK, where the eye is on the avatar and 1 to 3 cells is how far anything is |
 *
 * Cost: a varying and a few lines of fragment math on materials that already
 * compile their own program. No pass, draw call or per-vertex work on the CPU.
 * The ranges are uniforms, one shared object per kind, so a zoom changes a
 * number, never a program; the line gate is one shared uniform that
 * scene/Scene.tsx HeadlampRig writes once a frame.
 */

import { Vector2, type WebGLProgramParametersWithUniforms } from 'three'

/** The lines' ramp, in render cells: invisible within LINE_FADE_FROM, whole from LINE_FADE_TO. */
export const LINE_FADE_FROM = 1
export const LINE_FADE_TO = 3

/** The spawn marker's ramp, in its own ring radii (a model unit). */
export const MARKER_FADE_FROM_RADII = 1
export const MARKER_FADE_TO_RADII = 3

/** One range a material reads: `value.x` from, `value.y` to, render cells. */
export type NearFadeRange = { value: Vector2 }

/** The lines' range and gate, shared by every line that wears it. `uNearFadeOn` is 0 in WALK. */
export const lineFade = {
  range: { value: new Vector2(LINE_FADE_FROM, LINE_FADE_TO) } as NearFadeRange,
  on: { value: 1 },
}

/** Always on: what the spawn marker reads as its gate. */
const ALWAYS = { value: 1 }

/** The share of its alpha a fragment `d` cells from the eye keeps. Mirrors the shader (GLSL smoothstep). */
export function nearFadeShare(d: number, from: number, to: number): number {
  if (!(to > from)) return d >= to ? 1 : 0
  const t = Math.min(1, Math.max(0, (d - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

const MARK = '// near fade'
const VARYING = 'varying vec3 vNearFade;'
let warned = false

/**
 * Patches a three shader (basic or standard: both have these includes once)
 * so its alpha keeps nearFadeShare of itself, by `range`, while `on` is 1, and
 * a fragment faded to nothing is dropped, depth and all. Applied once; if
 * three's includes are not the expected ones, the shader is left as it was.
 */
export function patchNearFade(shader: Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader' | 'uniforms'>, range: NearFadeRange, on: { value: number } = ALWAYS): boolean {
  if (shader.fragmentShader.includes(MARK)) return true
  const once = (src: string, anchor: string): boolean => src.split(anchor).length === 2
  if (!(once(shader.vertexShader, '#include <common>') && once(shader.vertexShader, '#include <project_vertex>') && once(shader.fragmentShader, '#include <common>') && once(shader.fragmentShader, '#include <opaque_fragment>'))) {
    if (!warned) console.warn('[nearFade] three\'s shader is not the one expected; nothing fades near the camera')
    warned = true
    return false
  }
  shader.uniforms.uNearFade = range
  shader.uniforms.uNearFadeOn = on
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VARYING}`)
    .replace('#include <project_vertex>', '#include <project_vertex>\n\tvNearFade = mvPosition.xyz;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${MARK}\n${VARYING}\nuniform vec2 uNearFade;\nuniform float uNearFadeOn;`)
    .replace('#include <opaque_fragment>', `#include <opaque_fragment>
\tif (uNearFadeOn > 0.5) {
\t\tgl_FragColor.a *= smoothstep(uNearFade.x, uNearFade.y, length(vNearFade));
\t\tif (gl_FragColor.a <= 0.0) discard;
\t}`)
  return true
}

/** The compile hook and program key for a line material outside the headlamp (the rooms' outlines), as props. */
export const NEAR_FADE_LINES = {
  onBeforeCompile: (shader: WebGLProgramParametersWithUniforms) => { patchNearFade(shader, lineFade.range, lineFade.on) },
  customProgramCacheKey: () => 'near-fade-lines-1',
} as const
