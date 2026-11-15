/**
 * glowHalos.ts - the halos round a POINTS object's points (DECK-0003 §1.16
 * Glow), and its points drawn at a POINT SIZE (§1.15), both as camera-facing
 * squares, one instance per point.
 *
 * Why squares and not GL points: a GPU caps gl_PointSize, and Apple's cap is
 * 64 device pixels, about 21 CSS px at a device ratio of 3. A point or halo
 * sized in ticks can need far more. So whenever an object says a point size
 * its points are billboards (today's GL points stay for every object that
 * does not), and every halo is one.
 *
 * Both read the same instanced geometry, made once per points geometry
 * (billboardsOf): a unit square, and per instance the point's position and
 * colour (the very arrays the shard's own points read, so a decode or a paint
 * reaches them: syncBillboards) and a seed. The seed places each halo in a
 * low-discrepancy order, so drawing a share of an object's halos (the budget,
 * scene/glowBudget.ts) leaves out an even spread.
 *
 * Sizes are in model units and scale with everything above them: the
 * shader reads the scale out of the model-view matrix, so a unit, a
 * placement's scale step and a motion all carry it as they carry the
 * vertices.
 *
 * The halo: GLOW STRENGTH at the centre, fading to nothing at the radius
 * (a gaussian renormalised to reach zero at the rim), with a slow texture
 * drift inside it (two taps of a tiling noise texture, rotated per halo; the
 * halo itself never moves off its point, so `anim` carries it exactly).
 * Reduced motion freezes the drift. It fades out as the camera comes inside
 * it, under SMALLEST px on screen, into the scene's fog, and at the edge of
 * the budget's share. A halo larger on screen than the largest allowed is
 * drawn at that size.
 *
 * Blending, premultiplied: LIGHT adds its colour (ONE, ONE), FOG lays it over
 * (ONE, ONE_MINUS_SRC_ALPHA). In the world the alpha under a halo is kept
 * (alpha factors ZERO, ONE, as ClipWalls' OVER_FACES), so the bloom's tag
 * (Scene.tsx WorldBloom) is never touched: a halo over the empty background
 * reads as a face, not light, and a pale fog does not bloom into glare. Off
 * the world (bench, games, pictures) there is no bloom and the alpha
 * accumulates, so a picture saved with transparency keeps the glow.
 *
 * Depth: tested against what writes depth (opaque faces), never written. No
 * soft edge against geometry: the composer does not resolve depth
 * (Scene.tsx resolveColourOnly), and reading it would cost every frame on
 * Windows; a halo meeting a wall is cut where it meets it.
 */

import {
  AddEquation,
  BufferGeometry,
  CustomBlending,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RepeatWrapping,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  ZeroFactor,
  type BufferAttribute,
  type Material,
} from 'three'
import type { GlowStyle } from 'sno-core/glow'
import { HEADLAMP_DISTANCE_GLSL, HEADLAMP_NEVER, headlampUniforms } from './headlamp'

// ---- the instanced geometry --------------------------------------------------

/** The golden ratio's fraction: seeds i * PHI mod 1 spread evenly at every share. */
const PHI = 0.6180339887498949

/** Seeds for `n` halos: low-discrepancy, so the first share of them by seed is an even spread. */
export function haloSeeds(n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = ((i + 1) * PHI) % 1
  return out
}

interface Mirror { src: BufferAttribute; dst: InstancedBufferAttribute; seen: number }
const made = new WeakMap<BufferGeometry, InstancedBufferGeometry>()

/**
 * The billboards for a points geometry (one carrying `position` and
 * `color`): made once and let go with it. The per-instance position and
 * colour share the geometry's own arrays; syncBillboards uploads them again
 * after the points' attributes change.
 */
export function billboardsOf(plain: BufferGeometry): InstancedBufferGeometry {
  const kept = made.get(plain)
  if (kept) return kept
  const pos = plain.getAttribute('position') as BufferAttribute
  const col = plain.getAttribute('color') as BufferAttribute
  const g = new InstancedBufferGeometry()
  // Its own square: a geometry's dispose deletes the GL buffer of every attribute it holds, so none is shared.
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  const offset = new InstancedBufferAttribute(pos.array as Float32Array, 3)
  const color = new InstancedBufferAttribute(col.array as Float32Array, 3)
  g.setAttribute('aOffset', offset)
  g.setAttribute('aColor', color)
  g.setAttribute('aSeed', new InstancedBufferAttribute(haloSeeds(pos.count), 1))
  g.instanceCount = pos.count
  // Bounds of the points themselves, not of the unit square at the origin: what a tap target measures (TapTarget setFromObject).
  if (!plain.boundingBox) plain.computeBoundingBox()
  if (!plain.boundingSphere) plain.computeBoundingSphere()
  g.boundingBox = plain.boundingBox!.clone()
  g.boundingSphere = plain.boundingSphere!.clone()
  const mirrors: Mirror[] = [{ src: pos, dst: offset, seen: pos.version }, { src: col, dst: color, seen: col.version }]
  g.userData.mirrors = mirrors
  plain.addEventListener('dispose', () => { made.delete(plain); g.dispose() })
  made.set(plain, g)
  return g
}

/** Upload the billboards' positions and colours again when the points' own were changed (a decode, a paint). */
export function syncBillboards(g: InstancedBufferGeometry): void {
  for (const m of g.userData.mirrors as Mirror[]) {
    if (m.src.version === m.seen) continue
    m.seen = m.src.version
    m.dst.needsUpdate = true
  }
}

/** Ray tests never hit a billboard's square (its corners are not where it draws). */
export function noRaycast(): void {}

// ---- shared uniforms -------------------------------------------------------------

/**
 * The drift, shared by every halo: two offsets into the noise texture,
 * already wrapped into 0..1 (the texture repeats), so a phone's float
 * precision never runs out however long the page is open.
 */
export const haloFlow = { a: { value: new Vector2() }, b: { value: new Vector2() } }

let flowAt = -1
/** Move the drift on to `seconds` (once a frame is enough; more is harmless). Reduced motion: not called, so it holds. */
export function flowHalos(seconds: number): void {
  if (seconds === flowAt) return
  flowAt = seconds
  haloFlow.a.value.set((seconds * 0.013) % 1, (seconds * 0.007) % 1)
  haloFlow.b.value.set((seconds * 0.0221) % 1, (seconds * 0.0119) % 1)
}

let noise: DataTexture | null = null
/** A tiling value-noise texture, three octaves, made once for the page. A texture tap is cheaper than noise math on a phone. */
export function haloNoise(): DataTexture {
  if (noise) return noise
  const size = 128
  const rand = (x: number, y: number, s: number): number => {
    const h = Math.sin((x % s) * 127.1 + (y % s) * 311.7 + s * 74.7) * 43758.5453
    return h - Math.floor(h)
  }
  const data = new Uint8Array(size * size * 4)
  const octaves: Array<[number, number]> = [[8, 0.55], [16, 0.3], [32, 0.15]]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0
    for (const [cells, w] of octaves) {
      const fx = (x / size) * cells, fy = (y / size) * cells
      const ix = Math.floor(fx), iy = Math.floor(fy)
      const tx = fx - ix, ty = fy - iy
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const a = rand(ix, iy, cells), b = rand(ix + 1, iy, cells)
      const c = rand(ix, iy + 1, cells), d = rand(ix + 1, iy + 1, cells)
      v += w * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy)
    }
    const i = (y * size + x) * 4
    data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255)
    data[i + 3] = 255
  }
  const t = new DataTexture(data, size, size)
  t.wrapS = t.wrapT = RepeatWrapping
  t.magFilter = LinearFilter
  t.minFilter = LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  noise = t
  return t
}

// ---- the halo ----------------------------------------------------------------------

/** How much the noise shapes a halo: 0 a plain glow, 1 all cloud. Subtle. */
export const HALO_NOISE = 0.45
/** The gaussian's steepness: the share of GLOW STRENGTH left halfway out is about (e^-0.75k - e^-k) / (1 - e^-k). */
export const HALO_FALLOFF = 3

const haloVertex = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec3 aColor;
  attribute float aSeed;

  uniform float uRadius;
  uniform float uCore;
  uniform float uCoreMinPx;
  uniform float uCoreMaxPx;
  uniform float uKeep;
  uniform float uMinPx;
  uniform float uMaxPx;
  uniform float uDpr;
  uniform float uBufferHeight;
  #ifdef USE_FOG
    uniform float fogNear;
    uniform float fogFar;
    #ifdef FOG_EXP2
      uniform float fogDensity;
    #endif
  #endif

  varying vec3 vColor;
  varying vec2 vUv;
  varying vec4 vTurn;
  varying float vFade;
  varying float vHole;

  #include <clipping_planes_pars_vertex>

  float fogShare(float depth) {
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        return 1.0 - exp(-fogDensity * fogDensity * depth * depth);
      #else
        return smoothstep(fogNear, fogFar, depth);
      #endif
    #else
      return 0.0;
    #endif
  }

  void main() {
    vColor = aColor;
    vUv = position.xy;
    float a0 = aSeed * 6.2831853;
    vTurn = vec4(cos(a0), sin(a0), aSeed * 7.13, aSeed * 3.71);

    vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
    // The scale of everything above it (unit, placement steps, motion): the view matrix is rigid.
    float k = length(modelViewMatrix[0].xyz);
    float r = uRadius * k;
    float depth = max(-mv.z, 0.0001);
    // Drawing-buffer px per view unit at this depth, as pointDisc's attenuation.
    float att = uBufferHeight * projectionMatrix[1][1] * 0.5 / depth;
    float px = r * att;

    // Inside the budget's share, faded at its edge so a share that moves does not pop.
    float keep = uKeep >= 1.0 ? 1.0 : clamp((uKeep - aSeed) * 25.0, 0.0, 1.0);
    // The radius drawn: capped on screen. The camera-inside fade reads it too, so zooming never changes the strength.
    float shown = min(px, uMaxPx) / att;
    float fade = keep
      * smoothstep(uMinPx * uDpr, 1.5 * uMinPx * uDpr, px)
      * smoothstep(0.5 * shown, shown, length(mv.xyz))
      * (1.0 - fogShare(depth));
    vFade = fade;
    // The point's own disc, as a share of the halo drawn: the halo leaves it clear, so the point shows on top of its own glow.
    float corePx = uCore > 0.0 ? clamp(uCore * k * att, uCoreMinPx * uDpr, uCoreMaxPx * uDpr) * 0.5 : 0.0;
    vHole = corePx / max(min(px, uMaxPx), 0.0001);

    mv.xy += position.xy * shown;
    vec4 mvPosition = mv;
    #include <clipping_planes_vertex>
    gl_Position = fade <= 0.001 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  }
`

const haloFragment = /* glsl */ `
  uniform float uStrength;
  uniform float uOpacity;
  uniform float uNoise;
  uniform vec2 uFlowA;
  uniform vec2 uFlowB;
  uniform sampler2D uNoiseTex;

  varying vec3 vColor;
  varying vec2 vUv;
  varying vec4 vTurn;
  varying float vFade;
  varying float vHole;

  #include <clipping_planes_pars_fragment>

  void main() {
    #include <clipping_planes_fragment>
    float d2 = dot(vUv, vUv);
    if (d2 >= 1.0) discard;
    float fall = (exp(-${HALO_FALLOFF.toFixed(1)} * d2) - exp(-${HALO_FALLOFF.toFixed(1)})) / (1.0 - exp(-${HALO_FALLOFF.toFixed(1)}));
    vec2 q = mat2(vTurn.x, -vTurn.y, vTurn.y, vTurn.x) * vUv;
    float n1 = texture2D(uNoiseTex, q * 0.42 + vTurn.zw + uFlowA).r;
    float n2 = texture2D(uNoiseTex, q * 0.97 - vTurn.wz - uFlowB).r;
    float n = n1 * 0.65 + n2 * 0.35;
    float density = fall * mix(1.0, smoothstep(0.18, 0.82, n) * 1.7, uNoise);
    float a = clamp(density * uStrength * uOpacity * vFade, 0.0, 1.0);
    if (vHole > 0.0) a *= smoothstep(vHole * 0.85, vHole * 1.05, sqrt(d2));
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, a);
  }
`

/** The blend of a halo: premultiplied, LIGHT adds, FOG lays over; in the world the alpha under it (the bloom's tag) is kept. */
export interface HaloBlend {
  blending: typeof CustomBlending
  blendEquation: typeof AddEquation
  blendSrc: typeof OneFactor
  blendDst: typeof OneFactor | typeof OneMinusSrcAlphaFactor
  blendSrcAlpha: typeof ZeroFactor | typeof OneFactor
  blendDstAlpha: typeof OneFactor | typeof OneMinusSrcAlphaFactor
}
export function haloBlend(style: GlowStyle, world: boolean): HaloBlend {
  return {
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: style === 'light' ? OneFactor : OneMinusSrcAlphaFactor,
    blendSrcAlpha: world ? ZeroFactor : OneFactor,
    blendDstAlpha: world ? OneFactor : OneMinusSrcAlphaFactor,
  }
}

/**
 * One object's halo material. Uniforms of its own: `uRadius` (model units),
 * `uCore` (its points' diameter at a POINT SIZE, model units, 0 for none: the
 * halo leaves the point's own disc clear, so a point shows on top of its glow),
 * `uStrength` (GLOW STRENGTH, 0..1), `uKeep` (the budget's share), the size
 * limits, and `uOpacity`, the client's own fade of the whole object (a
 * ghost, `dim`, a decode, EDIT's breath, TV's look: the traversals that fade
 * a shard find it by that name). `uOpacity` is never the object's opacity.
 */
export function createHaloMaterial(style: GlowStyle, world: boolean): ShaderMaterial {
  const m = new ShaderMaterial({
    vertexShader: haloVertex,
    fragmentShader: haloFragment,
    uniforms: UniformsUtils.merge([UniformsLib.fog, {
      uRadius: { value: 1 },
      uCore: { value: 0 },
      uCoreMinPx: { value: 1.5 },
      uCoreMaxPx: { value: 64 },
      uStrength: { value: 1 },
      uOpacity: { value: 1 },
      uKeep: { value: 1 },
      uMinPx: { value: 2 },
      uMaxPx: { value: 1e6 },
      uDpr: { value: 1 },
      uBufferHeight: { value: 1000 },
      uNoise: { value: HALO_NOISE },
      uNoiseTex: { value: null },
    }]),
    // Faces the camera, so one side would do, but a mirrored placement turns its winding: DoubleSide, in one pass (forceSinglePass).
    side: DoubleSide,
    transparent: true,
    forceSinglePass: true,
    depthTest: true,
    depthWrite: false,
    fog: true,
    clipping: true,
    ...haloBlend(style, world),
  })
  // Shared, by reference: one write a frame reaches every halo.
  m.uniforms.uFlowA = haloFlow.a
  m.uniforms.uFlowB = haloFlow.b
  m.uniforms.uNoiseTex.value = haloNoise()
  m.userData.haloBlend = haloBlend(style, world)
  return m
}

/**
 * Put a halo's blend back if something rewrote it: TV's look (TvFinds
 * lookOne) sets its own blend on everything it fades, which would square a
 * premultiplied halo's alpha. Blending is read at each draw, so restoring it
 * just before costs nothing.
 */
export function keepHaloBlend(m: Material): void {
  const want = m.userData.haloBlend as ReturnType<typeof haloBlend> | undefined
  if (want && m.blendSrc !== want.blendSrc) Object.assign(m, want)
  if (want && m.blendSrcAlpha !== want.blendSrcAlpha) Object.assign(m, want)
}

// ---- points at a POINT SIZE -----------------------------------------------------

const coreVertex = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec3 aColor;

  uniform float uSize;
  uniform float uMinPx;
  uniform float uMaxPx;
  uniform float uDpr;
  uniform float uBufferHeight;

  varying vec3 vColor;
  varying vec2 vUv;
  varying float vPx;
  varying float vHeadlampDistance;

  #include <clipping_planes_pars_vertex>

  void main() {
    vColor = aColor;
    vUv = position.xy;
    vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
    float k = length(modelViewMatrix[0].xyz);
    float att = uBufferHeight * projectionMatrix[1][1] * 0.5 / max(-mv.z, 0.0001);
    // Kept in perspective between a floor (a far point stays dust) and a cap, in CSS px times the device ratio.
    vPx = clamp(uSize * k * att, uMinPx * uDpr, uMaxPx * uDpr);
    mv.xy += position.xy * (0.5 * vPx / att);
    vec4 mvPosition = mv;
    #include <clipping_planes_vertex>
    gl_Position = projectionMatrix * mv;
    vHeadlampDistance = length(mv.xyz);
  }
`

const coreFragment = /* glsl */ `
  uniform float uGlow;
  uniform float uOpacity;
  uniform float uHard;

  varying vec3 vColor;
  varying vec2 vUv;
  varying float vPx;
  varying float vHeadlampDistance;
${HEADLAMP_DISTANCE_GLSL}
  #include <clipping_planes_pars_fragment>

  void main() {
    #include <clipping_planes_fragment>
    float d = length(vUv);
    float edge = clamp(2.0 / max(vPx, 1.0), 0.04, 0.5);
    float alpha = (1.0 - smoothstep(1.0 - edge, 1.0, d)) * uOpacity;
    // Opaque: a hard rim, written to depth, so large points in one draw cover each other nearest first.
    if (uHard > 0.5 && uOpacity >= 0.999) { if (alpha < 0.5) discard; alpha = 1.0; }
    if (alpha < 0.02) discard;
    vec3 color = vColor * (1.0 + uGlow * (1.0 - smoothstep(0.0, 0.8, d)));
    if (uHeadlamp > 0.5) color *= headlampDistance(vHeadlampDistance);
    gl_FragColor = vec4(color, alpha);
  }
`

/**
 * The material for points drawn at a POINT SIZE: the disc of pointDisc.ts
 * (same feather, same bright core for the bloom, same headlamp), on a
 * billboard. `size` is the diameter in model units; `opacity` the object's
 * own, as its GL points take it. At opacity 1 the disc is cut hard at its
 * rim and writes depth: the billboards of one object are one draw, unsorted,
 * and large points would otherwise paint over each other in vertex order.
 * See-through, it blends and writes no depth, as the GL points do.
 */
export function createCoreMaterial(size: number, glow: number, opacity: number, headlamp: boolean): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: coreVertex,
    fragmentShader: coreFragment,
    uniforms: {
      uSize: { value: size },
      uMinPx: { value: 1.5 },
      uMaxPx: { value: 64 },
      uGlow: { value: glow },
      uOpacity: { value: opacity },
      uHard: { value: opacity >= 1 ? 1 : 0 },
      uDpr: { value: 1 },
      uBufferHeight: { value: 1000 },
      uHeadlamp: headlamp ? headlampUniforms.uHeadlamp : HEADLAMP_NEVER,
      uHeadlampReach: headlampUniforms.uHeadlampReach,
    },
    side: DoubleSide,
    transparent: true,
    forceSinglePass: true,
    depthWrite: opacity >= 1,
    clipping: true,
  })
}
