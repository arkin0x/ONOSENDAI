/**
 * assist.ts - aim assist for touch screens: a square box around the
 * reticle; while a drone is inside it, the gun in hand fires at it by itself
 * and every such shot is aimed so that it hits.
 *
 * - Which guns: only one whose def says `assist: "auto"` (the variant's data;
 *   the base variant gives it to the PULSE RIFLE alone). Others stay manual.
 * - When: only while the HUD has drawn the box (setAssistBox with its half
 *   side in CSS px). The HUD draws it on touch screens only, so with a mouse
 *   the assist is off and aiming stays the player's.
 * - The target (pickAssistTarget): a live drone whose centre projects inside
 *   the box, in front of the camera, within the gun's range, and that an
 *   exact replay of the shot (sim castHitscan, from the eye the shot will
 *   leave, along the aim the simulation will rebuild) hits first: a solid in
 *   the way, or another drone in front, rules it out. So nothing is fired
 *   through a wall or a hedge. Of those, the most central (the smallest
 *   distance on screen from the reticle) wins; a tie goes to the nearest.
 * - Timing: within a step the simulation moves the body first, then fires
 *   the guns from the moved eye at the drones where the last step left them,
 *   then moves the drones (sim/run.ts). So the aim is worked out from the
 *   eye after this step's move (the body stepped on a copy with the same
 *   input, which the simulation repeats exactly) at the drones' current
 *   places: the shot lands exactly where it was aimed.
 * - What it does to the input (applyAssist, once a fixed step, from the
 *   runner): sets `fire` and `aim` (RunInput.aim). The look is untouched.
 *   Manual FIRE still works as before; an overheated gun still refuses (the
 *   simulation decides). The aim is in the input log, so a replay is exact.
 *
 * Nothing here is drawn; the HUD reads `assistState.target` to brighten its
 * brackets while a drone is locked.
 */

import { Matrix4, Vector3, type Camera } from 'three'
import {
  STEP_S, castHitscan, eyeOf, lookDir, stepPlayer,
  type Body, type RunInput, type RunState, type Solids, type Target, type Vec3,
} from '../../lib/games/droneRun/sim'
import { lookAtScreen, toRender } from './frame'

/** What the assist is doing, for the HUD: the drone it is firing at this step, or null. */
export const assistState: { target: number | null } = { target: null }

/** The box's half side in CSS px while the HUD draws it, or null (assist off). */
let boxHalfPx: number | null = null

/** The camera the player sees through and the canvas's size in CSS px (Canvas3D keeps it current). */
let view: { camera: Camera; width: number; height: number } | null = null

/** The HUD: half the drawn square's side in CSS px while it shows the box (touch screens), or null when it does not. */
export function setAssistBox(halfPx: number | null): void {
  boxHalfPx = halfPx !== null && Number.isFinite(halfPx) && halfPx > 0 ? halfPx : null
  if (boxHalfPx === null) assistState.target = null
}

/** The canvas: the camera after it was placed this frame, and the canvas's size in CSS px. null when the canvas goes away. */
export function setAssistView(camera: Camera | null, width = 0, height = 0): void {
  view = camera && width > 0 && height > 0 ? { camera, width, height } : null
}

/** What pickAssistTarget needs. */
export interface AssistQuery {
  /** The camera (its matrixWorld and projectionMatrix are read), in the canvas's render frame (frame.ts toRender). */
  camera: Pick<Camera, 'matrixWorld' | 'projectionMatrix'>
  /** The canvas's size, CSS px. The reticle is its centre. */
  width: number
  height: number
  /** Half the box's side, CSS px. */
  halfPx: number
  /** Where the shot leaves from: the eye after this step's move, region-local. */
  eye: Readonly<Vec3>
  /** The drones as the shot will meet them. */
  drones: readonly Target[]
  /** The gun's range, gibsons. */
  range: number
  solids: Solids
}

/** The drone to fire at and the aim that hits it, in the simulation's terms (RunInput.aim). */
export interface AssistPick {
  target: number
  aim: { yaw: number; pitch: number }
  /** Distance on screen from the reticle, CSS px, and from the eye, gibsons. */
  screenPx: number
  dist: number
}

const inv = new Matrix4()
const v = new Vector3()
const rp = { x: 0, y: 0, z: 0 }

/**
 * The drone the assist fires at, or null (see the file header): centre in
 * the box and in front of the camera, within range, hit first by the exact
 * shot; the most central, then the nearest.
 */
export function pickAssistTarget(q: AssistQuery): AssistPick | null {
  if (!(q.halfPx > 0) || !(q.width > 0) || !(q.height > 0)) return null
  inv.copy(q.camera.matrixWorld).invert()
  const cands: Array<{ tg: Target; screenPx: number; dist: number }> = []
  for (const tg of q.drones) {
    if (tg.hp <= 0) continue
    const dist = Math.hypot(tg.pos[0] - q.eye[0], tg.pos[1] - q.eye[1], tg.pos[2] - q.eye[2])
    if (dist > q.range || dist < 1e-6) continue
    toRender(tg.pos, rp)
    v.set(rp.x, rp.y, rp.z).applyMatrix4(inv)
    // Behind the camera, or level with it: ignored.
    if (v.z >= -1e-6) continue
    v.applyMatrix4(q.camera.projectionMatrix)
    const sx = (v.x * q.width) / 2, sy = (v.y * q.height) / 2
    if (Math.abs(sx) > q.halfPx || Math.abs(sy) > q.halfPx) continue
    cands.push({ tg, screenPx: Math.hypot(sx, sy), dist })
  }
  cands.sort((a, b) => a.screenPx - b.screenPx || a.dist - b.dist || a.tg.id - b.tg.id)
  for (const c of cands) {
    const aim = lookAtScreen(q.eye, c.tg.pos)
    // The shot as the simulation will fire it: its direction rebuilt from the aim, from this eye.
    const { along } = castHitscan(q.solids, q.drones, q.eye as Vec3, lookDir(aim.yaw, aim.pitch), q.range)
    if (along.length && along[0].id === c.tg.id) return { target: c.tg.id, aim, screenPx: c.screenPx, dist: c.dist }
  }
  return null
}

/** The eye after this step's move: the body stepped on a copy with `input`, exactly as stepRun will step it. */
export function eyeAfterStep(st: RunState, input: RunInput): Vec3 {
  const b = st.body
  const copy: Body = { ...b, pos: [b.pos[0], b.pos[1], b.pos[2]], vel: [b.vel[0], b.vel[1], b.vel[2]] }
  const p = st.world.variant.spec.player
  stepPlayer(copy, p, st.world.solids, st.world.bounds, input, STEP_S)
  return eyeOf(copy, p)
}

/** The gun in hand when this step's guns fire: a valid `select` switches first. */
function gunThisStep(st: RunState, input: RunInput): number {
  const n = st.world.variant.spec.weapons.length
  const s = input.select
  return s !== null && Number.isInteger(s) && s >= 0 && s < n ? s : st.arsenal.current
}

/**
 * One fixed step's assist, on the input about to be stepped (mutated): with
 * the box shown, the gun in hand an assist gun and a target found, fire at
 * it with an aim that hits. `at` overrides the module's box and camera (tests).
 */
export function applyAssist(st: RunState, input: RunInput, at?: { halfPx: number | null; camera: Camera; width: number; height: number } | null): AssistPick | null {
  const halfPx = at ? at.halfPx : boxHalfPx
  const cam = at ?? view
  assistState.target = null
  if (halfPx === null || !cam || st.phase !== 'wave' || !st.drones.length) return null
  const def = st.world.variant.spec.weapons[gunThisStep(st, input)]
  if (def.assist !== 'auto' || def.fire !== 'hitscan') return null
  const pick = pickAssistTarget({
    camera: cam.camera, width: cam.width, height: cam.height, halfPx,
    eye: eyeAfterStep(st, input), drones: st.drones, range: def.range, solids: st.world.solids,
  })
  if (!pick) return null
  input.fire = true
  input.aim = { yaw: pick.aim.yaw, pitch: pick.aim.pitch }
  assistState.target = pick.target
  return pick
}
