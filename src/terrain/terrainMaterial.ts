/**
 * terrainMaterial.ts - how TERRAIN's blocks look: the previews' 16 by 16
 * tiles (lib/terrain/tiles.ts), one per block across a merged rectangle,
 * picked by the tile attribute and laid out from the position (tops and
 * bottoms by x and z, sides by their own across and cyberspace y, so a skin's
 * fringe hangs from the top). Lit by which way a face looks and by a lamp at
 * your eye that fades with distance, glowing where the tile's alpha says,
 * and fogged into the scene's black.
 *
 * Block shading (Settings, Effects; on by default): each chunk's light
 * (lib/terrain/light.ts), a 34 cube 3D texture, read half a block out from
 * every face and filtered between the four cells round the point, so caves
 * darken with depth, creases and corners darken where blocks close in, and
 * glowing blocks light what is round them in their colour. The greedy mesh
 * is unchanged: the light is per pixel, from the texture. Off, every chunk
 * draws as it did before, fully lit.
 *
 * One material for every chunk (`material`), and one for each chunk's light
 * (`forChunk`): the same program, the same shared uniforms, its own texture.
 */

import { ClampToEdgeWrapping, Color, CustomBlending, Data3DTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, NearestFilter, OneFactor, OneMinusSrcAlphaFactor, RGBAFormat, ShaderMaterial, SrcAlphaFactor, UnsignedByteType, ZeroFactor } from 'three'
import { BG } from '../lib/palette'
import { ATLAS, CELL, PER_ROW, buildAtlas } from '../lib/terrain/tiles'
import { BRIGHT_MAX, LIGHT_SIDE } from '../lib/terrain/light'
import { SHADE } from '../lib/terrain/mesh'

/** Where the fog starts and is whole, in blocks from the eye. The box is 96 blocks across. */
export const FOG_NEAR = 24
export const FOG_FAR = 60

/**
 * Block shading's look. The texture holds each cell's brightness
 * (lib/terrain/light.ts BRIGHT_SKY, BRIGHT_BLOCK): open light steep, so a
 * space sealed off from the open is dark, and block light gentle and a
 * little brighter than full open light, so a glowing block lights a room.
 * Never darker than LIGHT_FLOOR, a faint read of the walls. The lamp at your
 * eye lights the nearest blocks, fading to nothing by its reach: a real lamp
 * with Headlamp on in Settings (EYE_LAMP), only a glimmer with it off
 * (EYE_GLIMMER). Then the corners: where the open cells round a point fall
 * to none, the face darkens to AO_DARK of its light (a crease, half open, to
 * halfway).
 */
export const LIGHT_FLOOR = 0.02
export const EYE_LAMP = { light: 0.25, reach: 7 } as const
export const EYE_GLIMMER = { light: 0.06, reach: 3 } as const
export const AO_DARK = 0.15

const vertex = /* glsl */ `
attribute float tile;
attribute float face;
varying vec3 vLocal;
varying float vTile;
varying float vShade;
varying float vDist;
varying vec3 vNormal;
void main() {
  vLocal = position;
  vTile = tile;
  // Which way the face looks: -x, +x, -y, +y, -z, +z (lib/terrain/mesh.ts), its light by that, and its normal.
  int f = int(face + 0.5);
  float shades[6] = float[6](${SHADE.map((v) => v.toFixed(3)).join(', ')});
  vShade = shades[f];
  vec3 normals[6] = vec3[6](vec3(-1.0, 0.0, 0.0), vec3(1.0, 0.0, 0.0), vec3(0.0, -1.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, -1.0), vec3(0.0, 0.0, 1.0));
  vNormal = normals[f];
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`

const fragment = /* glsl */ `
precision highp sampler3D;
uniform sampler2D atlas;
/** The chunk's light (lib/terrain/light.ts): the light's red, green and blue and 1 in an open cell, 0 in all four in a solid one, over the chunk and one cell round it. */
uniform sampler3D light;
/** Block shading in Settings: 1 reads the light, 0 draws fully lit as before. */
uniform float shading;
/** The lamp at your eye: its light, and the blocks it reaches (Headlamp in Settings). */
uniform float eyeLight;
uniform float eyeReach;
uniform vec3 bg;
uniform float fogNear;
uniform float fogFar;
/** Render units per gibson: 1 at a gibson's zoom, smaller as you zoom out. */
uniform float unit;
/** GLOW in Settings: 1 lets the glowing texels feed the world bloom. */
uniform float glow;
/** 1 for the see-through pass: drawn part clear, never blooming. */
uniform float seeThrough;
varying vec3 vLocal;
varying float vTile;
varying float vShade;
varying float vDist;
varying vec3 vNormal;
void main() {
  vec3 n = abs(normalize(cross(dFdx(vLocal), dFdy(vLocal))));
  float t = floor(vTile + 0.5);
  // The two coordinates across the face: x and z on a top or bottom, the horizontal and -y on a side.
  vec2 c;
  if (n.y > 0.5) c = vec2(vLocal.x, vLocal.z);
  else if (n.x > 0.5) c = vec2(vLocal.z, -vLocal.y);
  else c = vec2(vLocal.x, -vLocal.y);
  vec2 cell = vec2(mod(t, ${PER_ROW.toFixed(1)}), floor(t / ${PER_ROW.toFixed(1)})) * ${CELL.toFixed(1)};
  vec2 uv = (cell + 8.0 + fract(c) * 16.0) / ${ATLAS.toFixed(1)};
  vec2 g = vec2(16.0 / ${ATLAS.toFixed(1)});
  vec4 tex = textureGrad(atlas, uv, dFdx(c) * g, dFdy(c) * g);
  float em = 1.0 - tex.a;
  float gib = vDist / unit;
  float lamp = 0.5 + 0.5 * clamp(1.0 - gib / 30.0, 0.0, 1.0);
  vec3 shine = vec3(1.0);
  if (shading > 0.5) {
    // Half a block out from the face, in the open cell in front of it: the texture filters between the four cells round the point.
    vec3 p = (vLocal + 0.5 * vNormal + 1.0) / ${LIGHT_SIDE.toFixed(1)};
    vec4 l = texture(light, vec3(p.x, p.z, p.y));
    // The open cells' brightness alone: the filtered colour over the filtered share of open cells (solid cells hold 0), so no light leaks through a wall; stored as a square root.
    vec3 lv = l.rgb / max(l.a, 1.0 / 255.0);
    shine = lv * lv * ${BRIGHT_MAX.toFixed(2)};
    float near = clamp(1.0 - gib / eyeReach, 0.0, 1.0);
    shine = max(shine, vec3(max(${LIGHT_FLOOR.toFixed(3)}, eyeLight * near * near)));
    shine *= mix(${AO_DARK.toFixed(3)}, 1.0, l.a);
  }
  vec3 col = tex.rgb * vShade * lamp * shine * (1.0 - em) + tex.rgb * em * 1.15;
  float fog = smoothstep(fogNear, fogFar, gib);
  col = mix(col, bg, fog);
  // Rock writes the world's untagged colour (alpha 0): the world bloom passes it by, as it passes a shard's face.
  // A glowing texel writes alpha 1 while GLOW is on, and blooms.
  float lit = step(0.35, em) * glow * (1.0 - fog);
  gl_FragColor = seeThrough > 0.5 ? vec4(col, 0.55) : vec4(col, lit);
}
`

/** A CSS hex as raw 0..1 channels: the shader writes them as they are, with no colour-space step, as the tiles are. */
export function rawColor(hex: string): Color {
  const n = parseInt(hex.slice(1), 16)
  return new Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export interface TerrainMaterial {
  material: ShaderMaterial
  /** The see-through pass: blended over what is behind, keeping its bloom tag (alpha) as it was, so water never blooms. */
  clearMaterial: ShaderMaterial
  /** The zoom (render units per gibson), GLOW, Block shading and Headlamp, each frame. */
  setView: (unit: number, glow: boolean, shading?: boolean, headlamp?: boolean) => void
  /** A chunk's two materials (solid and see-through) reading its own light; dispose them with the chunk. The texture is the caller's. */
  forChunk: (light: Data3DTexture) => { material: ShaderMaterial; clearMaterial: ShaderMaterial }
  dispose: () => void
}

/** A chunk's light as a 3D texture (lib/terrain/light.ts computeLight's bytes), filtered between cells. */
export function lightTexture(bytes: Uint8Array<ArrayBuffer>): Data3DTexture {
  const t = new Data3DTexture(bytes, LIGHT_SIDE, LIGHT_SIDE, LIGHT_SIDE)
  t.format = RGBAFormat
  t.type = UnsignedByteType
  t.minFilter = LinearFilter
  t.magFilter = LinearFilter
  t.wrapS = t.wrapT = t.wrapR = ClampToEdgeWrapping
  t.unpackAlignment = 1
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

/** Full light everywhere: what a chunk reads before its own light is worked out. */
function fullLight(): Data3DTexture {
  const t = new Data3DTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1)
  t.format = RGBAFormat
  t.type = UnsignedByteType
  t.unpackAlignment = 1
  t.needsUpdate = true
  return t
}

export function makeTerrainMaterial(): TerrainMaterial {
  const atlas = new DataTexture(buildAtlas(), ATLAS, ATLAS, RGBAFormat)
  atlas.magFilter = NearestFilter
  atlas.minFilter = LinearMipmapLinearFilter
  atlas.generateMipmaps = true
  atlas.needsUpdate = true
  const full = fullLight()
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      atlas: { value: atlas },
      bg: { value: rawColor(BG) },
      fogNear: { value: FOG_NEAR },
      fogFar: { value: FOG_FAR },
      unit: { value: 1 },
      glow: { value: 1 },
      shading: { value: 1 },
      eyeLight: { value: EYE_LAMP.light },
      eyeReach: { value: EYE_LAMP.reach },
    },
  })
  material.uniforms.seeThrough = { value: 0 }
  material.uniforms.light = { value: full }
  // A clone shares the program; its uniforms are put back to the shared ones (a clone copies the atlas texture, which would upload again).
  const see = (m: ShaderMaterial, light: Data3DTexture): ShaderMaterial => {
    const c = m.clone()
    c.uniforms = { ...material.uniforms, seeThrough: { value: 1 }, light: { value: light } }
    c.transparent = true
    c.depthWrite = false
    c.blending = CustomBlending
    c.blendSrc = SrcAlphaFactor
    c.blendDst = OneMinusSrcAlphaFactor
    c.blendSrcAlpha = ZeroFactor
    c.blendDstAlpha = OneFactor
    return c
  }
  const clearMaterial = see(material, full)
  return {
    material,
    clearMaterial,
    setView: (unit, glow, shading = true, headlamp = true) => {
      const u = material.uniforms
      u.unit.value = unit; u.glow.value = glow ? 1 : 0; u.shading.value = shading ? 1 : 0
      const eye = headlamp ? EYE_LAMP : EYE_GLIMMER
      u.eyeLight.value = eye.light; u.eyeReach.value = eye.reach
    },
    forChunk: (light) => {
      const solid = material.clone()
      solid.uniforms = { ...material.uniforms, light: { value: light } }
      return { material: solid, clearMaterial: see(material, light) }
    },
    dispose: () => { material.dispose(); clearMaterial.dispose(); atlas.dispose(); full.dispose() },
  }
}
