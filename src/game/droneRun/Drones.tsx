/**
 * Drones.tsx - the run's drones, each kind one instanced draw for its body
 * and one for each spinning part (rotors, fans), however many fly.
 *
 * - Where: the simulation's position, drawn between the last two steps
 *   (runner.between), in the render frame (frame.ts toRender).
 * - Facing: the way it flies; while it sees you, or winds up a shot, it
 *   turns to face you. Turned smoothly (TURN_PER_S), banked a little into
 *   its turns, and bobbing gently in the air.
 * - Rotors: the payload's published motion is drawn still and the parts are
 *   spun here, each about its own +Y at rig.json's spinRevPerS (a part
 *   placed upside down turns the other way, as rig.json says).
 * - Eyes and the sniper's charge light: the payloads' glowing points, into
 *   the world's glow pool at the drone's place.
 * - A windup (a sniper's or a heavy's telegraph) grows a light on each
 *   muzzle from nothing to full over windupS: the warning to move.
 * - A hit flashes the drone white for HIT_FLASH_S.
 * - Far away, past where the fog starts to take the drone (the sky is black
 *   and so is the fog), a faint speck of its eyes' colour stays at its
 *   middle, drawn through the fog (the view's beacons pool), so a drone 30 to
 *   50 gibsons off is still a point you can find. It comes in from SPECK_FROM
 *   to SPECK_FULL gibsons and goes again past SPECK_GONE. With GLOW off the
 *   pool still draws a small hard core.
 *
 * Ledger class (c): the look. The drone's position, its sphere and its
 * windup time are the simulation's (class b), and the telegraph is drawn
 * exactly as long as the simulation's windup.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, DoubleSide, Euler, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three'
import type { Drone, Vec3 } from '../../lib/games/droneRun/sim'
import { onDroneRunEvent } from './runner'
import { toRender } from './frame'
import type { DroneModel } from './models'
import { PRIORITY, type DroneRunView } from './view'
import { SHARD_FACES_TONE_MAPPED } from '../../scene/shardLight'

/** The most drones of one kind drawn at once. */
export const MAX_PER_KIND = 48
/** How long a hit flashes, seconds. */
export const HIT_FLASH_S = 0.09
/** How fast a drone turns to face where it is going, radians a second. */
const TURN_PER_S = 6

const WHITE = new Color(1, 1, 1)
const FLASH = new Color(3.2, 3.2, 3.2)

/** One material for every drone: lit as the world's lit shards are, both sides, at the payload's own colours. */
export const DRONE_MATERIAL = new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide, toneMapped: SHARD_FACES_TONE_MAPPED })

/** The far speck (see the header): from, full and gone, gibsons from the eye; its light and size (gibsons). */
export const SPECK_FROM = 18
export const SPECK_FULL = 34
export const SPECK_GONE = 110
export const SPECK_LIGHT = 0.75
export const SPECK_RADIUS = 0.4

const smooth = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** How much of the far speck shows for a drone `dist` gibsons from the eye: none close, full from SPECK_FULL, fading out toward SPECK_GONE. */
export function speckShare(dist: number): number {
  return smooth(SPECK_FROM, SPECK_FULL, dist) * (1 - smooth(SPECK_GONE * 0.8, SPECK_GONE, dist))
}

/** The mean colour of a drone's glowing points (its eyes), or white. */
function eyeColor(model: DroneModel): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0
  for (const gl of model.glows) for (let k = 0; k < gl.colors.length; k += 3) { r += gl.colors[k]; g += gl.colors[k + 1]; b += gl.colors[k + 2]; n++ }
  if (!n) return [1, 1, 1]
  // Brought up to full brightness: a speck is a light, whatever its eyes' strength.
  const m = Math.max(r, g, b) / n || 1
  return [r / n / m, g / n / m, b / n / m]
}

interface Pose { yaw: number; frame: number }

const SNIPER_TINT = [1, 0.32, 0.62] as const
const HEAVY_TINT = [1, 0.62, 0.22] as const

/** The yaw that turns +Z toward (dx, dz), render frame. */
function yawToward(dx: number, dz: number): number {
  return Math.atan2(dx, dz)
}

/** Shortest turn from a toward b, at most `max`. */
function turnToward(a: number, b: number, max: number): number {
  let d = b - a
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return a + Math.max(-max, Math.min(max, d))
}

function DroneKind({ view, kind, model }: { view: DroneRunView; kind: string; model: DroneModel }): JSX.Element {
  const body = useMemo(() => {
    if (!model.body) return null
    const m = new InstancedMesh(model.body, DRONE_MATERIAL, MAX_PER_KIND)
    m.frustumCulled = false
    m.count = 0
    return m
  }, [model])
  const parts = useMemo(() => model.spin.map((part) => {
    const m = new InstancedMesh(part.geometry, DRONE_MATERIAL, MAX_PER_KIND)
    m.frustumCulled = false
    m.count = 0
    return m
  }), [model])
  const muzzles = useMemo(() => (model.muzzles.length ? model.muzzles : [[0, 0, model.across * 0.5] as [number, number, number]]), [model])
  const tint = kind === 'sniper' ? SNIPER_TINT : HEAVY_TINT
  const speck = useMemo(() => eyeColor(model), [model])
  useEffect(() => () => { body?.dispose(); for (const p of parts) p.dispose() }, [body, parts])

  const poses = useRef(new Map<number, Pose>())
  const flashUntil = useRef(new Map<number, number>())
  const clock = useRef(0)
  const frameNo = useRef(0)
  useEffect(() => onDroneRunEvent((ev) => {
    if (ev.type === 'hit') flashUntil.current.set(ev.drone, clock.current + HIT_FLASH_S)
  }), [])

  const tmp = useMemo(() => ({
    at: [0, 0, 0] as Vec3, pos: new Vector3(), q: new Quaternion(), e: new Euler(0, 0, 0, 'YXZ'), one: new Vector3(1, 1, 1),
    m: new Matrix4(), pm: new Matrix4(), spin: new Matrix4(), v: new Vector3(), eye: new Vector3(),
  }), [])

  useFrame(({ camera }, frameDt) => {
    const dt = frameDt * view.runner.timeScale
    const t = view.time
    clock.current = t
    const { runner, glow, beacons } = view
    const st = runner.state
    const defs = st.world.variant.spec.enemies
    const player = st.body.pos
    let n = 0
    const frame = ++frameNo.current
    for (const d of st.drones as Drone[]) {
      if (d.enemy !== kind || n >= MAX_PER_KIND) continue
      runner.between('drones', d.id, d.pos, tmp.at)
      toRender(tmp.at, tmp.pos)
      const def = defs[d.def]
      // Facing: at the player while it sees them or winds up, else along its flight.
      let pose = poses.current.get(d.id)
      const vx = d.vel[0], vz = -d.vel[2]
      const want = d.sees || d.windup >= 0
        ? yawToward(player[0] - tmp.at[0], -(player[2] - tmp.at[2]))
        : Math.hypot(vx, vz) > 0.3 ? yawToward(vx, vz) : pose?.yaw ?? 0
      if (!pose) { pose = { yaw: want, frame }; poses.current.set(d.id, pose) }
      pose.frame = frame
      const before = pose.yaw
      pose.yaw = turnToward(pose.yaw, want, TURN_PER_S * dt)
      const yawRate = dt > 0 ? (pose.yaw - before) / dt : 0
      const bob = view.reducedMotion ? 0 : Math.sin(t * 2.3 + d.id * 1.7) * 0.05 * model.across
      tmp.pos.y += bob
      // Banked into its turns, nosed down a touch with speed.
      const speed = Math.hypot(d.vel[0], d.vel[1], d.vel[2])
      tmp.e.set(Math.min(0.25, speed * 0.012), pose.yaw, Math.max(-0.35, Math.min(0.35, -yawRate * 0.12)))
      tmp.q.setFromEuler(tmp.e)
      tmp.m.compose(tmp.pos, tmp.q, tmp.one)
      const flashing = (flashUntil.current.get(d.id) ?? -1) > t
      if (body) {
        body.setMatrixAt(n, tmp.m)
        body.setColorAt(n, flashing ? FLASH : WHITE)
      }
      for (let i = 0; i < model.spin.length; i++) {
        const part = model.spin[i]
        const turn = view.reducedMotion ? 0 : t * part.revPerS * Math.PI * 2 + d.id
        tmp.spin.makeRotationY(turn)
        tmp.pm.multiplyMatrices(tmp.m, part.matrix).multiply(tmp.spin)
        parts[i].setMatrixAt(n, tmp.pm)
        parts[i].setColorAt(n, flashing ? FLASH : WHITE)
      }
      // Eyes and lights.
      for (const g of model.glows) {
        const p = g.positions, c = g.colors
        const bright = g.strength * 2
        for (let k = 0; k < p.length; k += 3) {
          tmp.v.set(p[k], p[k + 1], p[k + 2]).applyMatrix4(tmp.m)
          glow.push(tmp.v.x, tmp.v.y, tmp.v.z, c[k] * bright, c[k + 1] * bright, c[k + 2] * bright, g.radius)
        }
      }
      // The far speck.
      const far = speckShare(camera.position.distanceTo(tmp.pos)) * SPECK_LIGHT
      // With GLOW off the pool keeps a hard core a quarter of the radius: twice the radius there, so the speck stays a few pixels.
      const speckR = SPECK_RADIUS * Math.max(1, Math.sqrt(model.across)) * (view.glowOn ? 1 : 2)
      if (far > 0.01) beacons.push(tmp.pos.x, tmp.pos.y, tmp.pos.z, speck[0] * far, speck[1] * far, speck[2] * far, speckR)
      // The telegraph: a light on each muzzle, growing over the windup.
      const shot = def.attack.shot
      if (d.windup >= 0 && shot) {
        const share = Math.max(0, Math.min(1, 1 - d.windup / Math.max(1e-6, shot.windupS)))
        const flicker = view.reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(t * 40 + d.id)
        const radius = (0.12 + shot.radius * 2.2 * share) * flicker
        const k = 0.6 + 2.2 * share
        const r = tint[0], g = tint[1], b = tint[2]
        for (const mz of muzzles) {
          tmp.v.set(mz[0], mz[1], mz[2]).applyMatrix4(tmp.m)
          glow.push(tmp.v.x, tmp.v.y, tmp.v.z, r * k, g * k, b * k, radius)
        }
      }
      n++
    }
    if (body) {
      body.count = n
      body.instanceMatrix.needsUpdate = true
      if (body.instanceColor) body.instanceColor.needsUpdate = true
    }
    for (const p of parts) {
      p.count = n
      p.instanceMatrix.needsUpdate = true
      if (p.instanceColor) p.instanceColor.needsUpdate = true
    }
    // Forget drones gone (a few times a second is plenty).
    if (poses.current.size > n + 8) for (const [id, p] of poses.current) if (p.frame !== frame) { poses.current.delete(id); flashUntil.current.delete(id) }
  }, PRIORITY.fill)

  return (
    <>
      {body && <primitive object={body} />}
      {parts.map((p, i) => <primitive key={i} object={p} />)}
    </>
  )
}

export function Drones({ view }: { view: DroneRunView }): JSX.Element {
  const kinds = useMemo(() => view.runner.state.world.variant.spec.enemies.map((e) => e.id).filter((id) => view.models.drones[id]), [view])
  return (
    <>
      {kinds.map((k) => <DroneKind key={k} view={view} kind={k} model={view.models.drones[k]} />)}
      <primitive object={view.beacons.mesh} />
    </>
  )
}
