/**
 * terrainMaterial.ts - how TERRAIN's blocks look: the previews' 16 by 16
 * tiles (lib/terrain/tiles.ts), one per block across a merged rectangle,
 * picked by the tile attribute and laid out from the position (tops and
 * bottoms by x and z, sides by their own across and cyberspace y, so a skin's
 * fringe hangs from the top). Lit by which way a face looks and by a lamp at
 * your eye that fades with distance, glowing where the tile's alpha says,
 * and fogged into the scene's black. One material for every chunk.
 */

import { Color, DataTexture, LinearMipmapLinearFilter, NearestFilter, RGBAFormat, ShaderMaterial } from 'three'
import { BG } from '../lib/palette'
import { ATLAS, CELL, buildAtlas } from '../lib/terrain/tiles'

/** Where the fog starts and is whole, in blocks from the eye. The box is 96 blocks across. */
export const FOG_NEAR = 24
export const FOG_FAR = 60

const vertex = /* glsl */ `
attribute float tile;
attribute float shade;
varying vec3 vLocal;
varying float vTile;
varying float vShade;
varying float vDist;
void main() {
  vLocal = position;
  vTile = tile;
  vShade = shade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`

const fragment = /* glsl */ `
uniform sampler2D atlas;
uniform vec3 bg;
uniform float fogNear;
uniform float fogFar;
varying vec3 vLocal;
varying float vTile;
varying float vShade;
varying float vDist;
void main() {
  vec3 n = abs(normalize(cross(dFdx(vLocal), dFdy(vLocal))));
  float t = floor(vTile + 0.5);
  // The two coordinates across the face: x and z on a top or bottom, the horizontal and -y on a side.
  vec2 c;
  if (n.y > 0.5) c = vec2(vLocal.x, vLocal.z);
  else if (n.x > 0.5) c = vec2(vLocal.z, -vLocal.y);
  else c = vec2(vLocal.x, -vLocal.y);
  vec2 cell = vec2(mod(t, 8.0), floor(t / 8.0)) * ${CELL.toFixed(1)};
  vec2 uv = (cell + 8.0 + fract(c) * 16.0) / ${ATLAS.toFixed(1)};
  vec2 g = vec2(16.0 / ${ATLAS.toFixed(1)});
  vec4 tex = textureGrad(atlas, uv, dFdx(c) * g, dFdy(c) * g);
  float em = 1.0 - tex.a;
  float lamp = 0.5 + 0.5 * clamp(1.0 - vDist / 30.0, 0.0, 1.0);
  vec3 col = tex.rgb * vShade * lamp * (1.0 - em) + tex.rgb * em * 1.6;
  float fog = smoothstep(fogNear, fogFar, vDist);
  gl_FragColor = vec4(mix(col, bg, fog), 1.0);
}
`

/** A CSS hex as raw 0..1 channels: the shader writes them as they are, with no colour-space step, as the tiles are. */
export function rawColor(hex: string): Color {
  const n = parseInt(hex.slice(1), 16)
  return new Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export function makeTerrainMaterial(): { material: ShaderMaterial; dispose: () => void } {
  const atlas = new DataTexture(buildAtlas(), ATLAS, ATLAS, RGBAFormat)
  atlas.magFilter = NearestFilter
  atlas.minFilter = LinearMipmapLinearFilter
  atlas.generateMipmaps = true
  atlas.needsUpdate = true
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      atlas: { value: atlas },
      bg: { value: rawColor(BG) },
      fogNear: { value: FOG_NEAR },
      fogFar: { value: FOG_FAR },
    },
  })
  return { material, dispose: () => { material.dispose(); atlas.dispose() } }
}
