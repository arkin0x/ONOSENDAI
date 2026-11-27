/**
 * SmashFx.tsx - the Compiler's smash in the scene, from the moment of impact
 * (block-uses §4.3; store/useSmashFx.ts holds the show). Drawn in the
 * TERRAIN field's frame (TerrainLayer fieldMatrix), as Marks is, so a cell is
 * one unit here at any zoom:
 *
 *   - the impact: a white flash at the build, and two shockwave rings
 *     spreading from it, a thin white-hot one and a slower cyan one behind;
 *   - the shatter: every block broken into triangles (lib/blueprint/
 *     shatter.ts), each starting in its block's colour and heating through
 *     deep red, orange and yellow to white while it spins, tumbles and flies
 *     out, then fading. One draw call: a single instanced triangle, its
 *     flight worked in the vertex shader and its heat in the fragment shader
 *     from one time uniform. Freed FREE_MS after impact;
 *   - while the compile is still working once the shatter ends, an ember at
 *     the centre (the HUD prints COMPILING over it);
 *   - the smoke: grey motes born inside the smashed blocks at the impact
 *     itself (lib/blueprint/shatter.ts buildSmoke), pushed out by the blow
 *     and sinking. It hangs while the compile works, settles away for a
 *     miss, and clears quickly for a match;
 *   - the ending: the smoke settling for a miss, a short bright burst for a
 *     match (the toy itself is drawn elsewhere).
 *
 * The glowing parts add their light and write alpha, so the world's bloom
 * takes them (worldBloom.tsx); the dust blends without touching alpha
 * (shardFaces.ts NO_BLOOM_BLEND), so it reads as dust and not as light.
 * Reduced motion: no streaks, a dimmer flash, a third of the triangles,
 * flying slower and gone sooner.
 *
 * A new show ends the old one first, so there is never more than one smash
 * on screen. The materials live as long as this does, so a smash never waits
 * on a shader being built again; each smash's triangles are its own.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AddEquation, BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, OneFactor,
  PerspectiveCamera, PlaneGeometry, Points, ShaderMaterial, Vector3,
} from 'three'
import { terrainSession } from '../store/useTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { useSmashFx } from '../store/useSmashFx'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { glowProfile } from './glowBudget'
import { NO_BLOOM_BLEND } from './shardFaces'
import { MAX_SCALE, drawnScale, fieldMatrix } from './TerrainLayer'
import type { ViewAxes } from '../lib/space'
import {
  BURST_MS, CALM_SHATTER_MS, EMBER_FADE_MS, FLASH_MS, FREE_MS, RING_MS, SHATTER_MS, SMOKE_MS, buildRadius, buildShatter, buildSmoke, endingFrom, linearRgb,
  shatterCap, smokeLevel,
} from '../lib/blueprint/shatter'

/** Light added, colour and alpha both: what the shader writes is what lands, and the alpha it writes lets the bloom see it. */
const GLOW_ADD = {
  blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor,
} as const

/** Motes of smoke. */
const DUST_COUNT = 320
const CALM_DUST_COUNT = 120

/** One triangle, side 1, centred on its middle, each corner marked for the rim. */
function triangle(): { position: Float32Array; bary: Float32Array } {
  const r = 1 / Math.sqrt(3)
  const position = new Float32Array(9)
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 3
    position[i * 3] = r * Math.cos(a)
    position[i * 3 + 1] = r * Math.sin(a)
  }
  return { position, bary: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) }
}
const TRIANGLE = triangle()

const SHARD_VERTEX = /* glsl */ `
  attribute vec3 bary;
  attribute vec4 aStart;
  attribute vec4 aMotion;
  attribute vec4 aSpin;
  attribute vec4 aLook;
  uniform float uT;
  uniform float uLife;
  uniform float uDrag;
  uniform float uFall;
  uniform float uStreak;
  varying vec3 vBase;
  varying vec3 vBary;
  varying float vHeat;
  varying float vAlpha;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  vec3 turn(vec3 v, vec3 k, float a) {
    float c = cos(a), s = sin(a);
    return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
  }
  void main() {
    float seed = hash(aSpin.xyz * 17.0 + aStart.xyz);
    float age = max(0.0, uT - aStart.w);
    float life = max(0.2, (uLife - aStart.w) * (0.78 + 0.22 * seed));
    float p = clamp(age / life, 0.0, 1.0);
    // A ragged shard: each corner pulled in or out on its own. It shrinks as it fades, and is gone at the end.
    vec3 corner = position * (0.65 + 0.7 * hash(position * 3.1 + aStart.xyz));
    float shrink = (1.0 - 0.55 * smoothstep(0.55, 1.0, p)) * step(p, 0.999);
    vec3 local = turn(corner * aLook.w * shrink, aSpin.xyz, aSpin.w * age + seed * 6.2832);
    // The flight: fast off the impact, slowed by drag, sinking a little.
    float flown = aMotion.w * (1.0 - exp(-uDrag * age)) / uDrag;
    vec3 at = aStart.xyz + aMotion.xyz * flown;
    at.y -= uFall * age * age;
    // The streak: the corner trailing the flight is drawn back along it, longer while it is fast.
    float speed = aMotion.w * exp(-uDrag * age) * step(0.0001, age);
    float behind = max(0.0, -dot(normalize(local + vec3(1e-5)), aMotion.xyz));
    local -= aMotion.xyz * behind * speed * uStreak;
    vBase = aLook.rgb;
    vBary = bary;
    // Its own colour for a moment after the flash, then the heat.
    vHeat = 1.0 - pow(1.0 - clamp((p - 0.05) / 0.6, 0.0, 1.0), 1.7);
    vAlpha = 1.0 - smoothstep(0.6, 1.0, p);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(at + local, 1.0);
  }
`

const SHARD_FRAGMENT = /* glsl */ `
  varying vec3 vBase;
  varying vec3 vBary;
  varying float vHeat;
  varying float vAlpha;
  void main() {
    // Block colour, deep red, orange, yellow, white: the heat ramp.
    float h = vHeat;
    vec3 c = mix(vBase * 1.3 + 0.015, vec3(0.45, 0.012, 0.0), smoothstep(0.0, 0.25, h));
    c = mix(c, vec3(1.0, 0.22, 0.01), smoothstep(0.22, 0.5, h));
    c = mix(c, vec3(1.0, 0.72, 0.08), smoothstep(0.48, 0.75, h));
    c = mix(c, vec3(1.0, 0.95, 0.88), smoothstep(0.72, 1.0, h));
    // A brighter rim: each shard reads as a cut edge of glass, not a flat chip.
    float e = min(vBary.x, min(vBary.y, vBary.z));
    float rim = 1.0 - smoothstep(0.0, 0.14, e);
    float a = vAlpha * (0.5 + 0.5 * rim);
    gl_FragColor = vec4(c * (0.55 + 1.3 * h) * (1.0 + 0.7 * rim) * a, a);
  }
`

/** A quad that faces the camera at uCentre, uSize cells to each side, drawn uPull cells toward the eye so the build round it does not cut it. */
const BILLBOARD_VERTEX = /* glsl */ `
  uniform vec3 uCentre;
  uniform float uSize;
  uniform float uPull;
  varying vec2 vUv;
  void main() {
    vUv = position.xy;
    float cell = length(modelViewMatrix[0].xyz);
    vec4 mv = modelViewMatrix * vec4(uCentre, 1.0);
    float far = length(mv.xyz);
    mv.xyz *= 1.0 - min(uPull * cell, far * 0.5) / max(far, 1e-4);
    mv.xy += position.xy * uSize * cell;
    gl_Position = projectionMatrix * mv;
  }
`

const RING_FRAGMENT = /* glsl */ `
  uniform float uT;
  uniform float uDur;
  uniform float uSize;
  uniform float uFrom;
  uniform float uLevel;
  varying vec2 vUv;
  float ring(float d, float r, float w) { float x = (d - r) / w; return exp(-x * x); }
  void main() {
    float d = length(vUv) * uSize;
    // The white-hot ring, fast and thin; the cyan one a beat behind, slower.
    float p = clamp(uT / uDur, 0.0, 1.0);
    float q = clamp((uT - 0.06) / (uDur * 1.35), 0.0, 1.0);
    float r1 = mix(uFrom, uSize * 0.92, 1.0 - pow(1.0 - p, 2.4));
    float r2 = mix(uFrom * 0.7, uSize * 0.7, 1.0 - pow(1.0 - q, 2.2));
    float w = 0.012 * uSize * (0.4 + 0.6 * p) + 0.02;
    vec3 hot = vec3(1.0, 0.93, 0.82) * ring(d, r1, w) * 2.6 + vec3(1.0, 0.35, 0.06) * ring(d, r1 - w * 2.0, w * 4.0) * 0.5;
    vec3 cool = vec3(0.1, 0.85, 1.0) * (ring(d, r2, w * 0.8) * 1.2 + ring(d, r2, w * 5.0) * 0.15);
    vec3 c = (hot * pow(1.0 - p, 1.6) + cool * pow(1.0 - q, 2.0) * step(0.06, uT)) * uLevel;
    float a = min(1.0, max(c.r, max(c.g, c.b)));
    if (a < 0.002) discard;
    gl_FragColor = vec4(c, a);
  }
`

/** A round glow: a tinted halo round a white-hot core. */
const GLOW_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLevel;
  varying vec2 vUv;
  void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 30.0);
    float s = (exp(-r2 * 9.0) * 0.5 + core * 0.9) * (1.0 - r2) * uLevel;
    gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.96, 0.88), core) * s, min(1.0, s));
  }
`

const DUST_VERTEX = /* glsl */ `
  attribute vec3 aDrift;
  uniform float uT;
  uniform float uDur;
  uniform float uPx;
  uniform float uSize;
  uniform float uLevel;
  varying float vA;
  void main() {
    float p = clamp(uT / uDur, 0.0, 1.0);
    float h = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    // Out of its block fast, slowing as it goes, and sinking all the while.
    vec3 at = position + aDrift * (1.0 - pow(1.0 - p, 2.4 + 1.2 * h));
    at.y -= 0.12 * uT * (0.5 + h);
    vec4 mv = modelViewMatrix * vec4(at, 1.0);
    vA = uLevel * (0.3 + 0.4 * h) * step(0.0, uT);
    // Each mote swells as it thins out.
    gl_PointSize = min(64.0, uSize * (0.6 + 0.8 * h) * (0.7 + 1.1 * p) * uPx * length(modelViewMatrix[0].xyz) / max(0.001, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`

const DUST_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(d, d);
    if (r2 > 1.0 || vA <= 0.0) discard;
    // Soft to its edge: a puff, not a disc.
    float soft = 1.0 - r2;
    gl_FragColor = vec4(uColor, vA * soft * soft * 1.5);
  }
`

/** A camera-facing quad, two units across: the rings and the glows. */
const QUAD = new PlaneGeometry(2, 2)

function glowMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: BILLBOARD_VERTEX, fragmentShader: GLOW_FRAGMENT,
    uniforms: { uCentre: { value: new Vector3() }, uSize: { value: 1 }, uPull: { value: 0 }, uColor: { value: new Vector3(...linearRgb(color)) }, uLevel: { value: 0 } },
    transparent: true, depthWrite: false, toneMapped: false, ...GLOW_ADD,
  })
}

/** 0 to 1 and back: in over `rise`, out over the rest of `dur`, eased. */
function pulse(t: number, rise: number, dur: number): number {
  if (t < 0 || t >= dur) return 0
  return t < rise ? t / rise : (1 - (t - rise) / (dur - rise)) ** 2
}

/** One smash's triangles on the GPU. */
interface Live { id: number; mesh: Mesh; geometry: InstancedBufferGeometry; calm: boolean; radius: number }

export function SmashFx({ axes }: { axes: ViewAxes }): JSX.Element {
  const show = useSmashFx((s) => s.show)
  const reduced = useReducedMotion()
  const calmNow = useRef(reduced)
  calmNow.current = reduced
  const frame = useRef<Group>(null)
  const ring = useRef<Mesh>(null)
  const flash = useRef<Mesh>(null)
  const ember = useRef<Mesh>(null)
  const burst = useRef<Mesh>(null)
  const dust = useRef<Points>(null)
  const live = useRef<Live | null>(null)
  const cap = useMemo(() => shatterCap(glowProfile(), typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency ?? 4), [])

  const mats = useMemo(() => ({
    shard: new ShaderMaterial({
      vertexShader: SHARD_VERTEX, fragmentShader: SHARD_FRAGMENT,
      uniforms: { uT: { value: 0 }, uLife: { value: SHATTER_MS / 1000 }, uDrag: { value: 1.6 }, uFall: { value: 0.35 }, uStreak: { value: 0.05 } },
      transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true, toneMapped: false, ...GLOW_ADD,
    }),
    ring: new ShaderMaterial({
      vertexShader: BILLBOARD_VERTEX, fragmentShader: RING_FRAGMENT,
      uniforms: { uCentre: { value: new Vector3() }, uSize: { value: 1 }, uPull: { value: 0 }, uT: { value: 0 }, uDur: { value: RING_MS / 1000 }, uFrom: { value: 0.5 }, uLevel: { value: 1 } },
      transparent: true, depthWrite: false, toneMapped: false, ...GLOW_ADD,
    }),
    flash: glowMaterial('#ffffff'),
    ember: glowMaterial('#ff5a10'),
    burst: glowMaterial('#ffd27d'),
    dust: new ShaderMaterial({
      vertexShader: DUST_VERTEX, fragmentShader: DUST_FRAGMENT,
      uniforms: { uT: { value: -1 }, uDur: { value: SMOKE_MS / 1000 }, uPx: { value: 800 }, uSize: { value: 0.16 }, uLevel: { value: 0 }, uColor: { value: new Vector3(...linearRgb('#9aa0a6')) } },
      transparent: true, depthWrite: false, ...NO_BLOOM_BLEND,
    }),
  }), [])
  useEffect(() => () => { for (const m of Object.values(mats)) m.dispose() }, [mats])

  // The smoke is made with the show, a few hundred points born inside its blocks.
  const dustGeometry = useMemo(() => {
    if (!show) return null
    const d = buildSmoke(show.blocks, show.centre, reduced ? CALM_DUST_COUNT : DUST_COUNT, show.id)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(d.at, 3))
    g.setAttribute('aDrift', new BufferAttribute(d.drift, 3))
    return g
    // Made once per show: its outcome changing later does not make it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.id])
  useEffect(() => () => dustGeometry?.dispose(), [dustGeometry])

  /** The triangles go: off the frame and out of memory. */
  const free = (): void => {
    const l = live.current
    if (!l) return
    l.mesh.removeFromParent()
    l.geometry.dispose()
    live.current = null
  }

  // A new show: the old smash ends, and this one's triangles are made, unless its shatter is already over.
  useEffect(() => {
    free()
    const g = frame.current
    if (!show || !g || performance.now() - show.struck >= FREE_MS || show.blocks.length === 0) return
    const calm = calmNow.current
    const s = buildShatter(show.blocks, show.centre, { cap, calm, seed: show.id })
    const geometry = new InstancedBufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(TRIANGLE.position, 3))
    geometry.setAttribute('bary', new BufferAttribute(TRIANGLE.bary, 3))
    geometry.setAttribute('aStart', new InstancedBufferAttribute(s.start, 4))
    geometry.setAttribute('aMotion', new InstancedBufferAttribute(s.motion, 4))
    geometry.setAttribute('aSpin', new InstancedBufferAttribute(s.spin, 4))
    geometry.setAttribute('aLook', new InstancedBufferAttribute(s.look, 4))
    geometry.instanceCount = s.count
    const mesh = new Mesh(geometry, mats.shard)
    // Its bounds are one triangle at the origin; where they fly is the shader's.
    mesh.frustumCulled = false
    mesh.renderOrder = 12
    mesh.name = 'smash-shatter'
    g.add(mesh)
    live.current = { id: show.id, mesh, geometry, calm, radius: s.radius }
    return free
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show?.id, cap, mats])

  // The radius for a show whose triangles were never made (struck long ago, or no blocks).
  const radius = useMemo(() => (show ? buildRadius(show.blocks, show.centre) : 1), [show])

  useFrame((state) => {
    const f = frame.current, rg = ring.current, fl = flash.current, em = ember.current, bu = burst.current, du = dust.current
    if (!f || !rg || !fl || !em || !bu) return
    const s = terrainSession
    const zoom = drawnScale()
    const on = !!show && !!s && s.plane === useCyberspace.getState().plane && zoom <= MAX_SCALE
    f.visible = on
    if (!show || !s || !on) return
    fieldMatrix(s, axes, zoom, f.matrix)
    f.matrixWorldNeedsUpdate = true
    const now = performance.now()
    const t = now - show.struck
    const calm = live.current?.calm ?? reduced
    const R = live.current?.radius ?? radius
    const [cx, cy, cz] = show.centre

    // The shatter, then its triangles freed.
    if (live.current && t >= FREE_MS) free()
    if (live.current) {
      const u = mats.shard.uniforms
      u.uT.value = t / 1000
      u.uLife.value = (calm ? CALM_SHATTER_MS : SHATTER_MS) / 1000
      u.uStreak.value = calm ? 0 : 0.05
      u.uFall.value = calm ? 0 : 0.35
    }

    // The impact: the flash, then the rings spreading.
    const flashLevel = pulse(t, 25, FLASH_MS) * (calm ? 1.2 : 3.2)
    fl.visible = flashLevel > 0
    if (fl.visible) {
      const u = mats.flash.uniforms
      u.uCentre.value.set(cx, cy, cz)
      u.uSize.value = (R * 1.5 + 1) * (0.75 + 0.25 * Math.min(1, t / FLASH_MS))
      u.uPull.value = R
      u.uLevel.value = flashLevel
    }
    rg.visible = t >= 0 && t < RING_MS * 1.4
    if (rg.visible) {
      const u = mats.ring.uniforms
      u.uCentre.value.set(cx, cy, cz)
      u.uSize.value = R * 2.2 + 1.5
      u.uFrom.value = R * 0.5
      u.uPull.value = R
      u.uT.value = t / 1000
      u.uLevel.value = calm ? 0.6 : 1
    }

    // The ember: once the shatter is over, while the compile still works, and a moment after it answers.
    const into = Math.min(1, Math.max(0, (t - (calm ? CALM_SHATTER_MS : SHATTER_MS) + EMBER_FADE_MS) / EMBER_FADE_MS))
    const out = show.resolvedAt === null ? 1 : Math.max(0, 1 - (now - show.resolvedAt) / EMBER_FADE_MS)
    const emberLevel = into * out
    em.visible = emberLevel > 0
    if (em.visible) {
      const sec = now / 1000
      // A slow breath with a little flicker: a coal, not a lamp.
      const breath = 0.82 + 0.18 * Math.sin(sec * 4.2) + 0.06 * Math.sin(sec * 17.3)
      const u = mats.ember.uniforms
      u.uCentre.value.set(cx, cy, cz)
      u.uSize.value = 0.55 * (0.92 + 0.12 * breath)
      u.uLevel.value = emberLevel * 1.6 * breath
    }

    // The ending, once the outcome is known and the shatter has thinned.
    const from = endingFrom(show)
    const e = from === null ? -1 : now - from
    const burstLevel = show.outcome === 'match' ? pulse(e, 60, BURST_MS) * (calm ? 1 : 2.2) : 0
    bu.visible = burstLevel > 0
    if (bu.visible) {
      const u = mats.burst.uniforms
      u.uCentre.value.set(cx, cy, cz)
      u.uSize.value = (R * 1.6 + 1) * (0.4 + 0.9 * (1 - (1 - e / BURST_MS) ** 3))
      u.uPull.value = R
      u.uLevel.value = burstLevel
    }
    // The smoke: from the impact, out of the blocks themselves.
    const smoke = smokeLevel(show, now)
    if (du) du.visible = smoke > 0
    if (du?.visible) {
      const u = mats.dust.uniforms
      u.uT.value = t / 1000
      u.uLevel.value = smoke
      const cam = state.camera as PerspectiveCamera
      const fov = cam.isPerspectiveCamera ? cam.fov : 60
      u.uPx.value = (state.size.height * state.viewport.dpr) / (2 * Math.tan((fov * Math.PI) / 360))
    }
  })

  return (
    <group ref={frame} name="smash-fx" visible={false} matrixAutoUpdate={false}>
      <mesh ref={ring} geometry={QUAD} material={mats.ring} frustumCulled={false} renderOrder={13} visible={false} />
      <mesh ref={flash} geometry={QUAD} material={mats.flash} frustumCulled={false} renderOrder={14} visible={false} />
      <mesh ref={ember} geometry={QUAD} material={mats.ember} frustumCulled={false} renderOrder={14} visible={false} />
      <mesh ref={burst} geometry={QUAD} material={mats.burst} frustumCulled={false} renderOrder={14} visible={false} />
      {dustGeometry && <points ref={dust} geometry={dustGeometry} material={mats.dust} frustumCulled={false} renderOrder={11} visible={false} />}
    </group>
  )
}
