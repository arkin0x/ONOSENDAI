/**
 * fx.ts - two pools the game's effects draw through, one draw call each:
 *
 * - GlowPool: glowing points (LIGHT, DECK-0003 §1.16 as ONOSENDAI draws it:
 *   a halo falling off as glowHalos.ts's does, (e^(-3 d^2) - e^-3) / (1 -
 *   e^-3), added onto what is behind it), each with its own place, colour
 *   and radius, filled afresh every frame. Every drone's eye, a sniper's
 *   charge, a bolt in flight, a muzzle flash, a spark and a burst is points
 *   here. With GLOW off (Settings), the halos go and a small hard core is
 *   left, so a bolt you must dodge is still seen. Never smaller than
 *   MIN_PX on screen; faded by the scene's fog as world halos are.
 * - RibbonPool: straight streaks between two points that face the camera
 *   (tracers, the scatter's pellets, the rail's beam, a bolt's trail), a
 *   width in gibsons (never under MIN_PX), a soft edge, added on. Drawn
 *   whatever the GLOW setting: they are lines, not glow.
 *
 * Fill a pool with push() after begin(), then end() uploads what changed.
 * Nothing allocates per frame. Ledger class (c): the look of effects.
 */

import {
  AdditiveBlending, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial,
  UniformsLib, UniformsUtils,
} from 'three'

/** The smallest a glow core or a streak is drawn, CSS px. */
export const MIN_PX = 1.6

const FALLOFF = 3.0

const glowVertex = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec3 aColor;
  attribute float aRadius;
  uniform float uGlow;
  uniform float uMinPx;
  uniform float uDpr;
  uniform float uBufferHeight;
  #ifdef USE_FOG
    uniform float fogNear;
    uniform float fogFar;
  #endif
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vHard;
  void main() {
    vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
    float dist = length(mv.xyz);
    float depth = max(-mv.z, 0.0001);
    float att = uBufferHeight * projectionMatrix[1][1] * 0.5 / depth;
    // GLOW off: a hard core a quarter of the halo's size.
    float r = uGlow > 0.5 ? aRadius : aRadius * 0.28;
    float px = max(r * att, uMinPx * uDpr);
    px = min(px, uBufferHeight * 0.12);
    float fade = 1.0;
    #ifdef USE_FOG
      fade = 1.0 - smoothstep(fogNear, fogFar, dist);
    #endif
    vColor = aColor * fade;
    vUv = position.xy;
    vHard = uGlow > 0.5 ? 0.0 : 1.0;
    mv.xy += position.xy * (px / att);
    gl_Position = (fade <= 0.001 || aRadius <= 0.0) ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  }
`

const glowFragment = /* glsl */ `
  varying vec3 vColor;
  varying vec2 vUv;
  varying float vHard;
  void main() {
    float d2 = dot(vUv, vUv);
    if (d2 >= 1.0) discard;
    float halo = (exp(-${FALLOFF.toFixed(1)} * d2) - exp(-${FALLOFF.toFixed(1)})) / (1.0 - exp(-${FALLOFF.toFixed(1)}));
    // A bright middle, so a point reads as a light and not a smudge.
    float core = exp(-d2 * 18.0);
    float a = vHard > 0.5 ? smoothstep(1.0, 0.6, d2) : halo + core * 0.8;
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`

function quad(g: InstancedBufferGeometry): void {
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
}

function dynamic(arr: Float32Array, size: number): InstancedBufferAttribute {
  const a = new InstancedBufferAttribute(arr, size)
  a.setUsage(DynamicDrawUsage)
  return a
}

function upload(a: InstancedBufferAttribute, count: number): void {
  a.clearUpdateRanges()
  a.addUpdateRange(0, Math.max(1, count * a.itemSize))
  a.needsUpdate = true
}

/** Per-frame uniforms both pools take from the canvas. */
export interface ScreenFacts {
  dpr: number
  bufferHeight: number
  glow: boolean
}

export class GlowPool {
  readonly capacity: number
  count = 0
  readonly mesh: Mesh
  private readonly offset: Float32Array
  private readonly color: Float32Array
  private readonly radius: Float32Array
  private readonly geometry = new InstancedBufferGeometry()
  private readonly material: ShaderMaterial
  private readonly attrs: InstancedBufferAttribute[]

  constructor(capacity = 2048, fog = true) {
    this.capacity = capacity
    this.offset = new Float32Array(capacity * 3)
    this.color = new Float32Array(capacity * 3)
    this.radius = new Float32Array(capacity)
    quad(this.geometry)
    this.attrs = [dynamic(this.offset, 3), dynamic(this.color, 3), dynamic(this.radius, 1)]
    this.geometry.setAttribute('aOffset', this.attrs[0])
    this.geometry.setAttribute('aColor', this.attrs[1])
    this.geometry.setAttribute('aRadius', this.attrs[2])
    this.geometry.instanceCount = 0
    this.material = new ShaderMaterial({
      vertexShader: glowVertex,
      fragmentShader: glowFragment,
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uGlow: { value: 1 }, uMinPx: { value: MIN_PX }, uDpr: { value: 1 }, uBufferHeight: { value: 1000 } }]),
      fog,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      toneMapped: false,
    })
    this.mesh = new Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 20
    this.mesh.raycast = () => {}
  }

  begin(): void {
    this.count = 0
  }

  /** One point: where (render frame), its colour times its strength, its halo radius (gibsons). */
  push(x: number, y: number, z: number, r: number, g: number, b: number, radius: number): void {
    if (this.count >= this.capacity) return
    const i = this.count++
    this.offset[i * 3] = x; this.offset[i * 3 + 1] = y; this.offset[i * 3 + 2] = z
    this.color[i * 3] = r; this.color[i * 3 + 1] = g; this.color[i * 3 + 2] = b
    this.radius[i] = radius
  }

  end(facts: ScreenFacts): void {
    this.geometry.instanceCount = this.count
    for (const a of this.attrs) upload(a, this.count)
    const u = this.material.uniforms
    u.uGlow.value = facts.glow ? 1 : 0
    u.uDpr.value = facts.dpr
    u.uBufferHeight.value = facts.bufferHeight
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}

const ribbonVertex = /* glsl */ `
  attribute vec3 aA;
  attribute vec3 aB;
  attribute vec4 aC;
  attribute float aW;
  uniform float uMinPx;
  uniform float uDpr;
  uniform float uBufferHeight;
  #ifdef USE_FOG
    uniform float fogNear;
    uniform float fogFar;
  #endif
  varying vec4 vC;
  varying float vSide;
  void main() {
    vec3 a = (modelViewMatrix * vec4(aA, 1.0)).xyz;
    vec3 b = (modelViewMatrix * vec4(aB, 1.0)).xyz;
    // Cut at the near plane, so a streak that starts behind the eye still draws its front part.
    float nearZ = -0.06;
    if (a.z > nearZ && b.z < nearZ) a = mix(a, b, (a.z - nearZ) / (a.z - b.z));
    if (b.z > nearZ && a.z < nearZ) b = mix(b, a, (b.z - nearZ) / (b.z - a.z));
    vec3 ab = b - a;
    float len = length(ab);
    vec3 p = mix(a, b, position.x);
    vec3 side = cross(ab / max(len, 1e-6), normalize(p));
    float sl = length(side);
    float depth = max(-p.z, 0.0001);
    float att = uBufferHeight * projectionMatrix[1][1] * 0.5 / depth;
    float w = max(aW, uMinPx * uDpr / att);
    p += (side / max(sl, 1e-6)) * position.y * w * 0.5;
    float fade = 1.0;
    #ifdef USE_FOG
      fade = 1.0 - smoothstep(fogNear, fogFar, length(p));
    #endif
    vC = vec4(aC.rgb, aC.a * fade);
    vSide = position.y;
    bool gone = len < 1e-5 || sl < 1e-6 || aC.a <= 0.0 || (a.z > nearZ && b.z > nearZ);
    gl_Position = gone ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(p, 1.0);
  }
`

const ribbonFragment = /* glsl */ `
  varying vec4 vC;
  varying float vSide;
  void main() {
    float soft = 1.0 - vSide * vSide;
    float hot = exp(-vSide * vSide * 9.0);
    gl_FragColor = vec4(vC.rgb * vC.a * (soft * 0.6 + hot * 0.7), 1.0);
  }
`

export class RibbonPool {
  readonly capacity: number
  count = 0
  readonly mesh: Mesh
  private readonly a: Float32Array
  private readonly b: Float32Array
  private readonly c: Float32Array
  private readonly w: Float32Array
  private readonly geometry = new InstancedBufferGeometry()
  private readonly material: ShaderMaterial
  private readonly attrs: InstancedBufferAttribute[]

  constructor(capacity = 512) {
    this.capacity = capacity
    this.a = new Float32Array(capacity * 3)
    this.b = new Float32Array(capacity * 3)
    this.c = new Float32Array(capacity * 4)
    this.w = new Float32Array(capacity)
    this.geometry.setIndex([0, 1, 2, 0, 2, 3])
    // x along the streak 0..1, y across it -1..1.
    this.geometry.setAttribute('position', new Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3))
    this.attrs = [dynamic(this.a, 3), dynamic(this.b, 3), dynamic(this.c, 4), dynamic(this.w, 1)]
    this.geometry.setAttribute('aA', this.attrs[0])
    this.geometry.setAttribute('aB', this.attrs[1])
    this.geometry.setAttribute('aC', this.attrs[2])
    this.geometry.setAttribute('aW', this.attrs[3])
    this.geometry.instanceCount = 0
    this.material = new ShaderMaterial({
      vertexShader: ribbonVertex,
      fragmentShader: ribbonFragment,
      uniforms: UniformsUtils.merge([UniformsLib.fog, { uMinPx: { value: MIN_PX }, uDpr: { value: 1 }, uBufferHeight: { value: 1000 } }]),
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      toneMapped: false,
    })
    this.mesh = new Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 19
    this.mesh.raycast = () => {}
  }

  begin(): void {
    this.count = 0
  }

  /** A streak from a to b (render frame), `width` gibsons, colour (times brightness) and alpha. */
  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, r: number, g: number, b: number, alpha: number): void {
    if (this.count >= this.capacity) return
    const i = this.count++
    this.a[i * 3] = ax; this.a[i * 3 + 1] = ay; this.a[i * 3 + 2] = az
    this.b[i * 3] = bx; this.b[i * 3 + 1] = by; this.b[i * 3 + 2] = bz
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = alpha
    this.w[i] = width
  }

  end(facts: ScreenFacts): void {
    this.geometry.instanceCount = this.count
    for (const a of this.attrs) upload(a, this.count)
    const u = this.material.uniforms
    u.uDpr.value = facts.dpr
    u.uBufferHeight.value = facts.bufferHeight
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
