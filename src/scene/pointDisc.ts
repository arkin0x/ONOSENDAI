/**
 * pointDisc.ts - the glowing disc the terrain field draws its gibsons with,
 * lent to anything else that draws points.
 *
 * ShaderPointField earns its look two ways: the disc is computed from
 * gl_PointCoord, solid to its rim with a couple of feathered pixels, so a dot
 * is exactly the size it asked for and never a square; and it is sized in
 * pixels, so it stays dust however near the camera comes. A shard's points
 * want the same disc, but they are objects in a place rather than a field, so
 * here the size keeps its perspective (near points larger, far ones smaller)
 * between a floor and a ceiling in pixels. The ceiling is the whole point: a
 * point a metre from the camera used to fill a tenth of the screen.
 *
 * The core is brightened above the colour it was given so the bloom pass has
 * something to catch, which is the glow around a gibson.
 */

import { ShaderMaterial, type BufferAttribute, type BufferGeometry } from 'three'

/** How a family of points looks. Sizes are diameters: world units, then CSS pixels. */
export interface DiscProfile {
  /** Diameter in world units at the distance perspective makes it exact. */
  size: number
  /** Never smaller than this on screen, so a distant shard is dust and not nothing. */
  minPx: number
  /** Never larger than this on screen, whatever the camera does. */
  maxPx: number
  /** How much brighter the core is than the colour given, for the bloom pass. */
  glow: number
}

/** A shard drawn as points: its vertices are the shape, so they carry the size. */
export const SHARD_POINTS: DiscProfile = { size: 0.3, minPx: 1.6, maxPx: 10, glow: 1.1 }

/** The same vertices under a solid or wireframe shard: a hint that they are there,
 * never a second shape competing with the faces. */
export const SHARD_DOTS: DiscProfile = { size: 0.07, minPx: 0.7, maxPx: 2.4, glow: 0.25 }

const vertexShader = /* glsl */ `
  attribute vec3 aColor;

  uniform float uSize;
  uniform float uMinPx;
  uniform float uMaxPx;
  uniform float uDpr;
  uniform float uBufferHeight;

  varying vec3 vColor;
  varying float vPx;

  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);

    // The perspective scale three's own attenuated points use, in drawing-buffer
    // pixels: half the buffer's height times the projection's vertical scale,
    // over the distance. Clamped at both ends, in CSS pixels times the device
    // ratio, since gl_PointSize is in drawing-buffer pixels.
    float attenuation = uBufferHeight * projectionMatrix[1][1] * 0.5 / max(-mv.z, 0.0001);
    vPx = clamp(uSize * attenuation, uMinPx * uDpr, uMaxPx * uDpr);

    gl_PointSize = vPx;
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uGlow;
  uniform float uOpacity;

  varying vec3 vColor;
  varying float vPx;

  void main() {
    // 0 at the centre, 1 at the sprite's rim.
    float d = length(gl_PointCoord - vec2(0.5)) * 2.0;

    // Feather a constant couple of pixels, whatever the dot's size, so a small
    // one is not all edge and a large one is not a hard-cut circle.
    float edge = clamp(2.0 / max(vPx, 1.0), 0.04, 0.5);
    float alpha = (1.0 - smoothstep(1.0 - edge, 1.0, d)) * uOpacity;
    if (alpha < 0.02) discard;

    // Brighter than the colour it was given, most at the centre: the bloom pass
    // keys off brightness, so this is where the glow comes from.
    vec3 color = vColor * (1.0 + uGlow * (1.0 - smoothstep(0.0, 0.8, d)));

    gl_FragColor = vec4(color, alpha);
  }
`

/**
 * A material for one family of points. The geometry must carry `aColor`;
 * `withDiscColors` puts it there beside the `color` every other material reads.
 */
export function createDiscMaterial(profile: DiscProfile, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uSize: { value: profile.size },
      uMinPx: { value: profile.minPx },
      uMaxPx: { value: profile.maxPx },
      uGlow: { value: profile.glow },
      uOpacity: { value: opacity },
      uDpr: { value: 1 },
      uBufferHeight: { value: 1000 },
    },
    transparent: true,
    depthWrite: false,
  })
}

/**
 * The colour attribute under the name the disc shader reads. The same
 * BufferAttribute as `color`, so one upload serves both and an animation that
 * writes the colours keeps writing to one place.
 */
export function withDiscColors(geometry: BufferGeometry, colors: BufferAttribute): BufferGeometry {
  geometry.setAttribute('aColor', colors)
  return geometry
}

/** The two uniforms that follow the canvas rather than the material. */
export function sizeDisc(material: ShaderMaterial, dpr: number, cssHeight: number): void {
  material.uniforms.uDpr.value = dpr
  material.uniforms.uBufferHeight.value = cssHeight * dpr
}
