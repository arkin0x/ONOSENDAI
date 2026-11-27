/**
 * HeldCompiler.tsx - the Compiler in your hands while it is the chosen slot
 * in TERRAIN, drawn from its own model (the Breaker,
 * lib/blueprint/compilerModel.ts) on a canvas of its own, the whole screen
 * wide, under every control, as the carried block is (TerrainView.tsx
 * HeldBlock): it never clips into the world and never takes a tap.
 *
 * At rest it is a small item tucked in the bottom right corner, held across
 * the body in two hands: the shaft toward the lower left, the head up and to
 * the right (owner, 2026-11-27). It breathes, and bobs with a walk; that
 * motion is the page's own (styles.css), so an idle hammer draws no frames.
 *
 * The smash, first person (owner, 2026-11-27; lib/blueprint/hammerAnim.ts
 * has the phases and the poses): the hammer comes forward, large, in both
 * hands; its rings, then its edges, then its striking faces light while
 * sparks fly from them, more as the charge builds; it goes up and back over
 * the head; then it comes down onto the blocks at the cross, with a streak
 * behind the head, a flash and a burst of sparks where it lands, a moment's
 * hit-stop, a rebound, and the way back to the corner. Letting go early
 * carries it back with its light winding down. With reduced motion it comes
 * forward, charges and dips, with no streak and few sparks.
 *
 * Everything that glows is light added to the picture (it writes no alpha),
 * so it brightens the world behind it instead of covering it. The sparks are
 * one pool of points, moved in place: nothing is made per frame.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AddEquation, BoxGeometry, BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, DynamicDrawUsage, OneFactor, PlaneGeometry, ShaderMaterial, TorusGeometry,
  Vector3, type Group, type Mesh, type PerspectiveCamera, type PointLight, type Points,
} from 'three'
import type { ShardModel } from 'sno-core/shards'
import { ShardMesh } from '../scene/ShardMesh'
import { ShardLights } from '../scene/shardLight'
import { glowProfile } from '../scene/glowBudget'
import { compilerModel } from '../lib/blueprint/compilerModel'
import { SWING_MS } from '../lib/blueprint/smash'
import { hammerBusy, hammerPose, newPose, phaseAt, smooth, type HammerPhase } from '../lib/blueprint/hammerAnim'
import { linearRgb } from '../lib/blueprint/shatter'
import { preloadSmashSounds } from '../lib/blueprint/smashSound'
import { useSmashHold } from './smashHold'
import { hammerClock } from './hammerClock'
import { useWalk } from '../store/useWalk'
import { useReducedMotion } from '../hooks/useReducedMotion'

const FOV = 50
const HALF_TAN = Math.tan((FOV * Math.PI) / 360)
/** The model is about 15 units long; drawn at this scale, the grip to the middle of the head is one unit. */
const MODEL_SCALE = 1 / 8
/** Where the hammer turns, in the model's own units: the grip ring on the shaft. */
const GRIP_Y = -3
/** The middle of the head, in the model's units; its long axis is x, the striking faces at each end. */
const HEAD_Y = 5
const HEAD_HALF = 3.45
/** Where the two ember rings stand along the head, and their reach from its axis. */
const RING_X = 2.3
const RING_R = 1.42
/** On a wide screen the forward poses stay within this share of the height each side of the middle. */
const COLUMN = 1.15

/** How many sparks there can be at once, and how many a second a full charge throws. */
const SPARKS = { phone: { pool: 160, rate: 140, burst: 50 }, desktop: { pool: 260, rate: 200, burst: 80 } } as const
const SPARK_FALL = 3.4

/** Light added to the picture, writing no alpha: over the page it brightens what is behind it. */
const ADD = { blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: OneFactor, blendDstAlpha: OneFactor } as const

const BAR_VERTEX = /* glsl */ `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const BAR_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLevel;
  void main() { gl_FragColor = vec4(uColor * uLevel, 0.0); }
`
const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
/** A round glow with a white-hot core; uStar adds the four thin rays of a flash. */
const HALO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uLevel;
  uniform float uStar;
  varying vec2 vUv;
  void main() {
    float r2 = dot(vUv, vUv);
    if (r2 > 1.0) discard;
    float edge = 1.0 - r2;
    float core = exp(-r2 * 34.0);
    float rays = (exp(-abs(vUv.y) * 60.0) * exp(-abs(vUv.x) * 2.6) + exp(-abs(vUv.x) * 60.0) * exp(-abs(vUv.y) * 3.4)) * uStar;
    float s = (exp(-r2 * 7.0) * 0.55 + core * 1.1 + rays) * edge * uLevel;
    gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.97, 0.9), min(1.0, core + rays)) * s, 0.0);
  }
`
const SPARK_VERTEX = /* glsl */ `
  attribute float aFade;
  attribute float aSize;
  uniform float uPx;
  varying float vFade;
  void main() {
    vFade = aFade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aFade > 0.0 ? max(1.5, aSize * (0.45 + 0.55 * aFade) * uPx / max(0.05, -mv.z)) : 0.0;
    gl_Position = projectionMatrix * mv;
  }
`
const SPARK_FRAGMENT = /* glsl */ `
  varying float vFade;
  void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(d, d);
    if (r2 > 1.0 || vFade <= 0.0) discard;
    // White-hot when new, orange, then a dull red as it dies.
    vec3 c = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.55, 0.12), smoothstep(0.0, 0.5, vFade));
    c = mix(c, vec3(1.0, 0.96, 0.85), smoothstep(0.55, 1.0, vFade));
    float s = (exp(-r2 * 5.0) * 0.6 + exp(-r2 * 40.0)) * (1.0 - r2) * min(1.0, vFade * 3.0);
    gl_FragColor = vec4(c * s * 1.6, 0.0);
  }
`
const TRAIL_VERTEX = /* glsl */ `
  attribute float aFade;
  varying float vFade;
  varying float vSide;
  void main() { vFade = aFade; vSide = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const TRAIL_FRAGMENT = /* glsl */ `
  uniform float uLevel;
  varying float vFade;
  varying float vSide;
  void main() {
    // White-hot down the middle, orange at the edges.
    float mid = 1.0 - abs(vSide * 2.0 - 1.0);
    vec3 c = mix(vec3(1.0, 0.4, 0.06), vec3(1.0, 0.95, 0.85), smoothstep(0.35, 1.0, mid));
    gl_FragColor = vec4(c * smoothstep(0.0, 0.5, mid) * vFade * vFade * uLevel, 0.0);
  }
`

function addMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide, ...ADD })
}
const tint = (hex: string): Vector3 => new Vector3(...linearRgb(hex))

/** The streak's length, in frames of the head's path. */
const TRAIL_STEPS = 8

/** Everything the glow draws with, made once and freed with the canvas. */
function useGlowKit(pool: number): {
  torus: TorusGeometry; edges: BufferGeometry; face: PlaneGeometry; quad: PlaneGeometry; sparks: BufferGeometry; trail: BufferGeometry
  ring: ShaderMaterial; edge: ShaderMaterial; strike: ShaderMaterial; halo: ShaderMaterial; flash: ShaderMaterial; spark: ShaderMaterial; streak: ShaderMaterial
} {
  const kit = useMemo(() => {
    // The head's long edges and the rims of its two faces, as thin bars: a line would be one pixel on any screen.
    const bars: BoxGeometry[] = []
    const bar = (w: number, h: number, d: number, x: number, y: number, z: number): void => { const g = new BoxGeometry(w, h, d); g.translate(x, y, z); bars.push(g) }
    const T = 0.1, HY = 1.08, HZ = 0.88
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) bar(HEAD_HALF * 2, T, T, 0, sy * HY, sz * HZ)
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) bar(T, T, HZ * 2, sx * HEAD_HALF, sy * HY, 0)
      for (const sz of [-1, 1]) bar(T, HY * 2, T, sx * HEAD_HALF, 0, sz * HZ)
    }
    const count = bars.reduce((n, g) => n + g.attributes.position.count, 0)
    const position = new Float32Array(count * 3)
    const index: number[] = []
    let at = 0
    for (const g of bars) {
      position.set(g.attributes.position.array as Float32Array, at * 3)
      const ix = g.index!.array
      for (let i = 0; i < ix.length; i++) index.push(ix[i] + at)
      at += g.attributes.position.count
      g.dispose()
    }
    const edges = new BufferGeometry()
    edges.setAttribute('position', new BufferAttribute(position, 3))
    edges.setIndex(index)

    const sparks = new BufferGeometry()
    for (const [name, size] of [['position', 3], ['aFade', 1], ['aSize', 1]] as const) {
      const a = new BufferAttribute(new Float32Array(pool * size), size)
      a.setUsage(DynamicDrawUsage)
      sparks.setAttribute(name, a)
    }

    // The streak: a ribbon along the head's last few places, two corners a step.
    const trail = new BufferGeometry()
    const tp = new BufferAttribute(new Float32Array(TRAIL_STEPS * 2 * 3), 3)
    tp.setUsage(DynamicDrawUsage)
    const tf = new BufferAttribute(new Float32Array(TRAIL_STEPS * 2), 1)
    tf.setUsage(DynamicDrawUsage)
    const uv = new Float32Array(TRAIL_STEPS * 2 * 2)
    const ti: number[] = []
    for (let i = 0; i < TRAIL_STEPS; i++) {
      uv[i * 4] = 0; uv[i * 4 + 2] = 1
      if (i < TRAIL_STEPS - 1) ti.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    }
    trail.setAttribute('position', tp)
    trail.setAttribute('aFade', tf)
    trail.setAttribute('uv', new BufferAttribute(uv, 2))
    trail.setIndex(ti)

    return {
      torus: new TorusGeometry(RING_R, 0.11, 6, 8),
      edges,
      face: new PlaneGeometry(1, 1),
      quad: new PlaneGeometry(2, 2),
      sparks,
      trail,
      ring: addMaterial(BAR_VERTEX, BAR_FRAGMENT, { uColor: { value: tint('#ff7a1a') }, uLevel: { value: 0 } }),
      edge: addMaterial(BAR_VERTEX, BAR_FRAGMENT, { uColor: { value: tint('#7fe9ff') }, uLevel: { value: 0 } }),
      strike: addMaterial(BAR_VERTEX, BAR_FRAGMENT, { uColor: { value: tint('#bff4ff') }, uLevel: { value: 0 } }),
      halo: addMaterial(QUAD_VERTEX, HALO_FRAGMENT, { uColor: { value: tint('#ff8a2a') }, uLevel: { value: 0 }, uStar: { value: 0 } }),
      flash: addMaterial(QUAD_VERTEX, HALO_FRAGMENT, { uColor: { value: tint('#ffc070') }, uLevel: { value: 0 }, uStar: { value: 1 } }),
      spark: addMaterial(SPARK_VERTEX, SPARK_FRAGMENT, { uPx: { value: 800 } }),
      streak: addMaterial(TRAIL_VERTEX, TRAIL_FRAGMENT, { uLevel: { value: 0 } }),
    }
  }, [pool])
  useEffect(() => () => { for (const v of Object.values(kit)) v.dispose() }, [kit])
  return kit
}

/** Whether sparks are still in the air: the frames must keep coming until the last dies. */
let sparksAlive = false

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

/** One spark into the pool's next place (the oldest is written over): where, how fast, how long, how big. */
function throwSpark(sim: { vel: Float32Array; left: Float32Array; span: Float32Array; next: number }, P: Float32Array, Z: Float32Array, pool: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, big: number): void {
  const i = sim.next
  sim.next = (i + 1) % pool
  P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z
  sim.vel[i * 3] = vx; sim.vel[i * 3 + 1] = vy; sim.vel[i * 3 + 2] = vz
  sim.left[i] = life; sim.span[i] = life
  Z[i] = big
}

function Held({ shard, calm }: { shard: ShardModel; calm: boolean }): JSX.Element {
  const budget = useMemo(() => SPARKS[glowProfile()], [])
  const kit = useGlowKit(budget.pool)
  const pivot = useRef<Group>(null)
  const model = useRef<Group>(null)
  const light = useRef<PointLight>(null)
  const halo = useRef<Mesh>(null)
  const flash = useRef<Mesh>(null)
  const sparkPoints = useRef<Points>(null)
  const streak = useRef<Mesh>(null)
  // The pool: where each spark is, how it flies, how long it has left and had.
  const sim = useMemo(() => ({
    vel: new Float32Array(budget.pool * 3), left: new Float32Array(budget.pool), span: new Float32Array(budget.pool),
    next: 0, owed: 0, last: 0, phase: 'idle' as HammerPhase, steps: 0,
    pose: newPose(), head: new Vector3(), at: new Vector3(), dir: new Vector3(),
  }), [budget.pool])

  useFrame((state) => {
    const p = pivot.current, m = model.current
    if (!p || !m) return
    const w = import.meta.env.DEV ? (window as unknown as { __hammerAt?: number | null }) : null
    const now = w && typeof w.__hammerAt === 'number' ? w.__hammerAt : performance.now()
    const clock = hammerClock()
    const pose = hammerPose(now, clock, SWING_MS, calm, sim.pose)
    const { phase } = phaseAt(now, clock, SWING_MS)
    const dt = sim.last ? Math.min(0.05, Math.max(0, (now - sim.last) / 1000)) : 0
    sim.last = now
    const cam = state.camera as PerspectiveCamera
    const aspect = cam.aspect || 1
    const halfH = HALF_TAN * pose.depth
    // From the middle, within the upright middle of a wide screen; or, for the corner item, in from the right edge.
    const px = pose.x * halfH * Math.min(aspect, COLUMN) * (1 - pose.wide) + (aspect - pose.x) * halfH * pose.wide

    // The tremble: a fast shiver that grows with the charge.
    const s = now / 1000
    const shiver = pose.tremble * pose.tremble
    const jx = shiver * 0.012 * Math.sin(s * 61.3) + shiver * 0.006 * Math.sin(s * 147.1)
    const jy = shiver * 0.012 * Math.sin(s * 73.9 + 1.3)
    const jr = shiver * 0.014 * Math.sin(s * 53.7 + 0.4)
    p.position.set(px + jx, pose.y * halfH + jy, -pose.depth)
    p.rotation.set(-pose.pitch, pose.yaw, pose.roll + jr, 'ZXY')
    p.updateMatrixWorld(true)
    sim.head.set(0, HEAD_Y, 0).applyMatrix4(m.matrixWorld)

    // The light: the rings first, then the edges, then the striking faces, flickering a little as it fills.
    const flicker = 1 - 0.12 * pose.charge * (0.5 + 0.5 * Math.sin(s * 41.0) * Math.sin(s * 17.3))
    kit.ring.uniforms.uLevel.value = smooth(pose.charge / 0.3) * 1.9 * flicker
    kit.edge.uniforms.uLevel.value = smooth((pose.charge - 0.15) / 0.45) * 2.4 * flicker
    kit.strike.uniforms.uLevel.value = smooth((pose.charge - 0.4) / 0.5) * 1.0 * flicker
    if (light.current) {
      light.current.position.set(sim.head.x - 0.2, sim.head.y + 0.25, sim.head.z + 0.7)
      light.current.intensity = 2.4 * pose.charge * flicker
    }
    const h = halo.current
    if (h) {
      h.visible = pose.charge > 0.01
      h.position.copy(sim.head)
      h.scale.setScalar(0.8 + 0.9 * pose.charge)
      kit.halo.uniforms.uLevel.value = 1.5 * pose.charge * flicker
    }
    const f = flash.current
    if (f) {
      f.visible = pose.flash > 0.01
      f.position.copy(sim.head)
      f.position.z += 0.3
      f.scale.setScalar(calm ? 0.6 : 0.9 + 0.5 * (1 - pose.flash))
      kit.flash.uniforms.uLevel.value = pose.flash * (calm ? 0.7 : 1.6)
    }

    // Sparks: thrown from the lit rings and the head's rims while it charges, and a burst where the blow lands.
    const pos = kit.sparks.attributes.position as BufferAttribute
    const fade = kit.sparks.attributes.aFade as BufferAttribute
    const size = kit.sparks.attributes.aSize as BufferAttribute
    const P = pos.array as Float32Array, F = fade.array as Float32Array, Z = size.array as Float32Array
    const quiet = calm ? 0.25 : 1
    sim.owed += pose.sparks * budget.rate * quiet * dt
    while (sim.owed >= 1) {
      sim.owed -= 1
      // A place on one of the two rings, flying out from the head's axis and a little along it.
      const side = Math.random() < 0.5 ? -1 : 1
      const a = Math.random() * Math.PI * 2
      const onRim = Math.random() < 0.3
      sim.at.set(onRim ? side * HEAD_HALF : side * RING_X, HEAD_Y + Math.cos(a) * (onRim ? 1.0 : RING_R), Math.sin(a) * (onRim ? 0.85 : RING_R * 0.9)).applyMatrix4(m.matrixWorld)
      sim.dir.set(side * rand(0.1, 0.9), Math.cos(a), Math.sin(a)).transformDirection(m.matrixWorld)
      const v = rand(0.5, 1.9) * (0.6 + 0.6 * pose.charge)
      throwSpark(sim, P, Z, budget.pool, sim.at.x, sim.at.y, sim.at.z, sim.dir.x * v, sim.dir.y * v + rand(0.1, 0.7), sim.dir.z * v * 0.5, rand(0.3, 0.8), rand(0.05, 0.1))
    }
    // Once, as the blow lands (a slow frame may step straight over the hit-stop).
    if ((phase === 'impact' || phase === 'recover') && (sim.phase === 'swing' || sim.phase === 'windup')) {
      const n = calm ? Math.floor(budget.burst / 4) : budget.burst
      for (let k = 0; k < n; k++) {
        const a = Math.random() * Math.PI * 2
        const v = rand(1.2, 5.2)
        // Out across the screen from the head, mostly up and to the sides, some toward you.
        throwSpark(sim, P, Z, budget.pool, sim.head.x, sim.head.y, sim.head.z + 0.2, Math.cos(a) * v, Math.abs(Math.sin(a)) * v * 0.9 + rand(0, 1.2), rand(-0.3, 1.4), rand(0.3, 0.85), rand(0.05, 0.11))
      }
    }
    let alive = false
    for (let i = 0; i < budget.pool; i++) {
      if (sim.left[i] <= 0) { F[i] = 0; continue }
      sim.left[i] -= dt
      if (sim.left[i] <= 0) { F[i] = 0; continue }
      alive = true
      const drag = 1 - 1.6 * dt
      sim.vel[i * 3] *= drag; sim.vel[i * 3 + 1] = sim.vel[i * 3 + 1] * drag - SPARK_FALL * dt; sim.vel[i * 3 + 2] *= drag
      P[i * 3] += sim.vel[i * 3] * dt; P[i * 3 + 1] += sim.vel[i * 3 + 1] * dt; P[i * 3 + 2] += sim.vel[i * 3 + 2] * dt
      F[i] = sim.left[i] / sim.span[i]
    }
    pos.needsUpdate = true; fade.needsUpdate = true; size.needsUpdate = true
    sparksAlive = alive
    if (sparkPoints.current) sparkPoints.current.visible = alive
    kit.spark.uniforms.uPx.value = (state.size.height * state.viewport.dpr) / (2 * HALF_TAN)

    // The streak: the head's last few places, newest first, as a ribbon that thins to its tail.
    const st = streak.current
    if (st) {
      const tp = kit.trail.attributes.position as BufferAttribute, tf = kit.trail.attributes.aFade as BufferAttribute
      const TP = tp.array as Float32Array, TF = tf.array as Float32Array
      if (phase === 'swing' && sim.phase !== 'swing') sim.steps = 0
      if (phase === 'swing' || (phase === 'impact' && sim.phase === 'swing')) {
        TP.copyWithin(6, 0, (TRAIL_STEPS - 1) * 6)
        const half = 0.1
        TP[0] = sim.head.x - half; TP[1] = sim.head.y; TP[2] = sim.head.z
        TP[3] = sim.head.x + half; TP[4] = sim.head.y; TP[5] = sim.head.z
        sim.steps = Math.min(TRAIL_STEPS, sim.steps + 1)
        tp.needsUpdate = true
      }
      for (let i = 0; i < TRAIL_STEPS; i++) TF[i * 2] = TF[i * 2 + 1] = i < sim.steps ? 1 - i / Math.max(1, sim.steps) : 0
      tf.needsUpdate = true
      st.visible = pose.trail > 0.01 && sim.steps > 1
      kit.streak.uniforms.uLevel.value = Math.min(1, pose.trail * 1.5) * 0.5
    }
    sim.phase = phase
  })

  return (
    <>
      <group ref={pivot} position={[0, -10, -5]}>
        <group ref={model} scale={MODEL_SCALE} position={[0, -GRIP_Y * MODEL_SCALE, 0]}>
          <ShardMesh shard={shard} lit />
          {/* The glow: the two ember rings, the head's edges and its striking faces, each lit by the charge. */}
          {[-1, 1].map((side) => (
            <group key={side}>
              <mesh geometry={kit.torus} material={kit.ring} position={[side * RING_X, HEAD_Y, 0]} rotation={[Math.PI / 8, Math.PI / 2, 0, 'YXZ']} scale={[0.9, 1.04, 1]} />
              <mesh geometry={kit.face} material={kit.strike} position={[side * (HEAD_HALF + 0.06), HEAD_Y, 0]} rotation={[0, Math.PI / 2, 0]} scale={[1.7, 2.1, 1]} />
            </group>
          ))}
          <mesh geometry={kit.edges} material={kit.edge} position={[0, HEAD_Y, 0]} />
        </group>
      </group>
      <pointLight ref={light} color="#ffb070" distance={3} intensity={0} />
      <mesh ref={halo} geometry={kit.quad} material={kit.halo} visible={false} renderOrder={3} />
      <mesh ref={streak} geometry={kit.trail} material={kit.streak} visible={false} frustumCulled={false} renderOrder={4} />
      <points ref={sparkPoints} geometry={kit.sparks} material={kit.spark} visible={false} frustumCulled={false} renderOrder={5} />
      <mesh ref={flash} geometry={kit.quad} material={kit.flash} visible={false} renderOrder={6} />
    </>
  )
}

/**
 * Asks the canvas for frames only while something moves: a hold, the swing
 * and the way home, a let-go, or sparks still in the air. Otherwise it draws
 * nothing, so an idle Compiler costs no GPU time (its breathing is the
 * page's). A hammer that is not on screen draws nothing at all.
 */
function Pacer({ shown }: { shown: boolean }): null {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!shown) return
    let raf = 0
    const tick = (): void => {
      invalidate()
      // The browser harness can hold the clock at a moment (window.__hammerAt), to shoot one phase.
      const held = import.meta.env.DEV && typeof (window as unknown as { __hammerAt?: number | null }).__hammerAt === 'number'
      raf = held || hammerBusy(performance.now(), hammerClock(), SWING_MS) || sparksAlive ? requestAnimationFrame(tick) : 0
    }
    raf = requestAnimationFrame(tick)
    const stop = useSmashHold.subscribe(() => { if (!raf) raf = requestAnimationFrame(tick) })
    return () => { stop(); cancelAnimationFrame(raf) }
  }, [invalidate, shown])
  return null
}

/**
 * The held Compiler's canvas. Kept mounted while you own the Compiler in
 * TERRAIN and only hidden when another slot is chosen, so its WebGL context
 * is made once per visit, not on every change of slot.
 */
export function HeldCompiler({ shown = true }: { shown?: boolean }): JSX.Element | null {
  const [shard, setShard] = useState<ShardModel | null>(null)
  const calm = useReducedMotion()
  const holding = useSmashHold((s) => s.since !== null)
  const walking = useWalk((w) => w.behind > 0 || w.open !== null)
  useEffect(() => {
    let live = true
    void compilerModel().then((m) => { if (live) setShard(m) })
    return () => { live = false }
  }, [])
  // The smash's sounds are fetched the first time the Compiler is in hand, so the first swing has them.
  useEffect(() => { if (shown) preloadSmashSounds() }, [shown])
  if (!shard) return null
  return (
    <div className={`terrain-compiler${holding ? ' is-holding' : ''}${walking ? ' is-walking' : ''}`} aria-hidden style={shown ? undefined : { visibility: 'hidden' }}>
      <div className="terrain-compiler__sway">
        <Canvas dpr={[1, 2]} frameloop="demand" gl={{ alpha: true, antialias: true, premultipliedAlpha: true }} camera={{ fov: FOV, near: 0.05, far: 60, position: [0, 0, 0] }} style={{ pointerEvents: 'none' }}>
          <Pacer shown={shown} />
          <ShardLights />
          <Held shard={shard} calm={calm} />
        </Canvas>
      </div>
    </div>
  )
}
