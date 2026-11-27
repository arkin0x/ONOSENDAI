/**
 * HeldCompiler.tsx - the Compiler in your hand, bottom right, while it is the
 * chosen slot in TERRAIN (owner, 2026-11-27: "the held Compiler shows as the
 * held item in the bottom right"), drawn from its own model (the Breaker,
 * lib/blueprint/compilerModel.ts) on a small canvas of its own under every
 * control, as the carried block is (TerrainView.tsx HeldBlock): it never
 * clips into the world and never takes a tap.
 *
 * The smash, first person (design page 4.3): across the hold the hammer
 * rises and draws back while its striking face charges, flaring in the last
 * half second; at the end it swings down in a fast arc with a comet of flame
 * behind the head, white-hot at the core and orange at the edge, then kicks
 * and settles. With reduced motion it only charges and dips, with no trail.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AdditiveBlending, Color, DoubleSide, Float32BufferAttribute, RingGeometry, type Group, type Mesh, type MeshBasicMaterial, type PointLight } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { ShardMesh } from '../scene/ShardMesh'
import { ShardLights } from '../scene/shardLight'
import { frameOf, framedDistance, type ThumbFrame } from '../scene/ThumbStage'
import { compilerModel } from '../lib/blueprint/compilerModel'
import { useSmashHold } from './smashHold'
import { useReducedMotion } from '../hooks/useReducedMotion'

const FOV = 30
/** The swing, then the settle back to rest, in ms. */
const SWING_MS = 180
const SETTLE_MS = 520
/** The trail fades this long after the swing. */
const TRAIL_MS = 320

const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

/** The hammer's pose at a moment: how far drawn back (0 rest, 1 fully), the swing past rest, the charge 0 to 1. */
export function heldPose(now: number, hold: { since: number | null; ms: number; swingAt: number | null }): { back: number; swing: number; charge: number; trail: number } {
  if (hold.since !== null) {
    const p = Math.min(1, (now - hold.since) / Math.max(1, hold.ms))
    const last = Math.max(0, 1 - (hold.ms - (now - hold.since)) / 500)
    return { back: ease(p), swing: 0, charge: Math.min(1, 0.25 * p + 0.75 * last * last), trail: 0 }
  }
  if (hold.swingAt !== null) {
    const t = now - hold.swingAt
    if (t < SWING_MS) {
      const q = t / SWING_MS
      return { back: 1 - q, swing: q * q, charge: 1, trail: q }
    }
    if (t < SWING_MS + SETTLE_MS) {
      const r = (t - SWING_MS) / SETTLE_MS
      return { back: 0, swing: 1 - ease(r), charge: Math.max(0, 1 - r * 2), trail: Math.max(0, 1 - (t - SWING_MS) / TRAIL_MS) }
    }
  }
  return { back: 0, swing: 0, charge: 0, trail: 0 }
}

function Held({ shard, calm }: { shard: ShardModel; calm: boolean }): JSX.Element | null {
  const { camera, invalidate } = useThree()
  const pivot = useRef<Group>(null)
  const light = useRef<PointLight>(null)
  const trail = useRef<Mesh>(null)
  const [frame, setFrame] = useState<ThumbFrame | null>(null)
  useEffect(() => {
    let live = true
    void frameOf(shard).then((f) => { if (live) setFrame(f) })
    return () => { live = false }
  }, [shard])
  useEffect(() => {
    if (!frame) return
    const d = framedDistance(frame.reach, FOV)
    camera.position.set(0, 0, d * 1.05)
    camera.lookAt(0, 0, 0)
    camera.near = d / 50
    camera.far = d * 4
    camera.updateProjectionMatrix()
    invalidate()
  }, [frame, camera, invalidate])
  // The comet: an arc of the head's path, white at the core and orange at the edge.
  const ring = useMemo(() => {
    const g = new RingGeometry(0.62, 1.02, 40, 3, Math.PI * 0.18, Math.PI * 0.62)
    const colors: number[] = []
    const pos = g.attributes.position
    const hot = new Color('#ffffff'), edge = new Color('#ff7a1a')
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i))
      const c = edge.clone().lerp(hot, Math.max(0, 1 - Math.abs(r - 0.86) / 0.2))
      colors.push(c.r, c.g, c.b)
    }
    g.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return g
  }, [])
  useEffect(() => () => ring.dispose(), [ring])
  useFrame(() => {
    const p = pivot.current
    if (!p || !frame) return
    const pose = heldPose(performance.now(), useSmashHold.getState())
    const back = calm ? pose.back * 0.25 : pose.back
    const swing = calm ? pose.swing * 0.2 : pose.swing
    // At rest: head up and to the left, in the right hand, as the concept's held picture.
    p.rotation.set(0.15 - 0.95 * back + 1.25 * swing, -0.55, 0.62 + 0.25 * back)
    p.position.set(0, 0.12 * frame.reach * back - 0.18 * frame.reach * swing, 0)
    if (light.current) light.current.intensity = 6 * pose.charge
    const t = trail.current
    if (t) {
      const show = !calm && pose.trail > 0
      t.visible = show
      if (show) (t.material as MeshBasicMaterial).opacity = Math.min(1, pose.trail * 1.4)
    }
  })
  if (!frame) return null
  const r = frame.reach
  return (
    <group ref={pivot} position={[0, 0, 0]}>
      <group position={[-frame.centre[0], -frame.centre[1], -frame.centre[2]]}>
        <ShardMesh shard={shard} lit />
      </group>
      <pointLight ref={light} position={[0, r * 0.75, r * 0.3]} color="#ffb070" distance={r * 2} intensity={0} />
      <mesh ref={trail} geometry={ring} scale={r * 1.05} rotation={[0, Math.PI / 2, Math.PI / 2]} visible={false}>
        <meshBasicMaterial vertexColors transparent opacity={0} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} />
      </mesh>
    </group>
  )
}

/**
 * Asks the canvas for frames only while something moves: a hold, a swing and
 * its settle, or the hand coming into view. Otherwise it draws nothing, so an
 * idle Compiler costs no GPU time while the scene itself sleeps.
 */
function Pacer({ shown }: { shown: boolean }): null {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const h = useSmashHold.getState()
      const now = performance.now()
      const moving = h.since !== null || (h.swingAt !== null && now - h.swingAt < SWING_MS + SETTLE_MS + 50)
      invalidate()
      if (moving) raf = requestAnimationFrame(tick)
      else raf = 0
    }
    invalidate()
    const stop = useSmashHold.subscribe(() => { if (!raf) raf = requestAnimationFrame(tick) })
    return () => { stop(); cancelAnimationFrame(raf) }
  }, [invalidate])
  useEffect(() => { if (shown) invalidate() }, [shown, invalidate])
  return null
}

/**
 * The held Compiler's canvas, bottom right. Kept mounted while you own the
 * Compiler in TERRAIN and only hidden when another slot is chosen, so its
 * WebGL context is made once per visit, not on every change of slot.
 */
export function HeldCompiler({ shown = true }: { shown?: boolean }): JSX.Element | null {
  const [shard, setShard] = useState<ShardModel | null>(null)
  const calm = useReducedMotion()
  const holding = useSmashHold((s) => s.since !== null)
  useEffect(() => {
    let live = true
    void compilerModel().then((m) => { if (live) setShard(m) })
    return () => { live = false }
  }, [])
  if (!shard) return null
  return (
    <div className={`terrain-compiler${holding ? ' is-holding' : ''}`} aria-hidden style={shown ? undefined : { visibility: 'hidden' }}>
      <Canvas dpr={[1, 2]} frameloop="demand" gl={{ alpha: true, antialias: true }} camera={{ fov: FOV, near: 0.01, far: 1000 }} style={{ pointerEvents: 'none' }}>
        <Pacer shown={shown} />
        <ShardLights />
        <Held shard={shard} calm={calm} />
      </Canvas>
    </div>
  )
}
