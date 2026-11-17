/**
 * assist.ts - aim assist for touch screens: a square box around the
 * reticle; while a drone is inside it, the gun in hand fires at it by itself
 * and every such shot is aimed so that it hits, unless the simulation's
 * assist roll says miss.
 *
 * - The roll is the simulation's, not the view's (sim/weapons.ts): each
 *   aimed pull draws from the run's own assist stream, and a roll at or
 *   above the gun's `assistHit` (0.85 for the base PULSE RIFLE) sends the
 *   pull visibly wide, clearing the drone by `assistMissBy`. So which shots
 *   miss follows from the seed and the input log, and a replay misses the
 *   same shots. Nothing here knows or decides which.
 *
 * - Which guns: only one whose def says `assist: "auto"` (the variant's data;
 *   the base variant gives it to the PULSE RIFLE alone), and only a hitscan
 *   gun whose mode is auto: a semi gun would latch on the held trigger, and a
 *   charge gun never lets go while held (createRun rejects assist on either;
 *   applyAssist checks again). Others stay manual.
 * - When: only while the HUD has drawn the box (setAssistBox with its half
 *   side in CSS px). The HUD draws it only on a touch screen whose last
 *   pointer was a finger, with such a gun in hand, no card up and the game
 *   not exiting, so with a mouse or a trackpad the assist is off and aiming
 *   stays the player's. While a card is up the run is paused, so no step
 *   asks the assist anything either.
 * - One source for the box: the drone is projected the way the simulation
 *   will shoot, never through the drawn camera. The view is built from the
 *   eye after this step's move and the look this step's input gives (yaw,
 *   and pitch held inside the body's limit, as stepPlayer holds it); only
 *   the lens (the camera's projection matrix) and the canvas's size come
 *   from the canvas (setAssistView). So the drawn frame's interpolation and
 *   head bob never decide a pick, and the box, the range and the shot all
 *   agree.
 * - The target (pickAssistTarget): a live drone whose centre projects inside
 *   the box, in front of the eye, within the gun's range, and that an exact
 *   replay of the shot (sim castHitscan, from the eye the shot will leave,
 *   along the aim the simulation will rebuild) hits first: a solid in the
 *   way, or another drone in front, rules it out. So nothing is fired
 *   through a wall or a hedge. Of those, the most central (the smallest
 *   distance on screen from the reticle) wins; a tie goes to the nearest.
 * - Timing: within a step the simulation moves the body first, then fires
 *   the guns from the moved eye at the drones where the last step left them,
 *   then moves the drones (sim/run.ts). So the aim is worked out from the
 *   eye after this step's move (the body stepped on a copy with the same
 *   input, which the simulation repeats exactly) at the drones' current
 *   places: the shot lands exactly where it was aimed.
 * - Cost: the copy of the body's step is a full collision step, so it runs
 *   only when a cheap first pass, from the eye before the move with the box
 *   widened by as far as the eye can go in a step, finds a drone near the
 *   box. A drone that pass misses is only missed for that step; the final
 *   pick is always the exact one above.
 * - What it does to the input (applyAssist, once a fixed step, from the
 *   runner): sets `fire` and `aim` (RunInput.aim). The look is untouched.
 *   Manual FIRE still works as before; an overheated gun still refuses (the
 *   simulation decides), and the auto-fire heats the gun like any trigger,
 *   so a long fight can overheat it. The aim is in the input log, so a
 *   replay is exact.
 *
 * Nothing here is drawn; the HUD reads `assistState.target` to brighten its
 * brackets while a drone is locked.
 */

import { Euler, Matrix4, Vector3, type Camera } from 'three'
import {
  STEP_S, castHitscan, eyeOf, lookDir, stepPlayer,
  type Body, type RunInput, type RunState, type Solids, type Target, type Vec3,
} from '../../lib/games/droneRun/sim'
import { PITCH_LIMIT } from '../../lib/games/droneRun/sim/player'
import { cameraYaw, lookAtScreen, toRender } from './frame'

/** What the assist is doing, for the HUD: the drone it is firing at this step, or null. */
export const assistState: { target: number | null } = { target: null }

/** The box's half side in CSS px while the HUD draws it, or null (assist off). */
let boxHalfPx: number | null = null

/** The camera's lens and the canvas's size, CSS px (Canvas3D keeps it current). One object, written in place each frame. */
export interface AssistLens {
  /** The camera's projection matrix (three.js, render frame). */
  projection: Pick<Matrix4, 'elements'>
  width: number
  height: number
}
const lens: AssistLens & { on: boolean; projection: Matrix4 } = { on: false, projection: new Matrix4(), width: 0, height: 0 }

/** The HUD: half the drawn square's side in CSS px while it shows the box, or null when it does not. */
export function setAssistBox(halfPx: number | null): void {
  boxHalfPx = halfPx !== null && Number.isFinite(halfPx) && halfPx > 0 ? halfPx : null
  if (boxHalfPx === null) assistState.target = null
}

/** The canvas: its camera's lens (only the projection matrix is read) and the canvas's size in CSS px. null when the canvas goes away. */
export function setAssistView(camera: Pick<Camera, 'projectionMatrix'> | null, width = 0, height = 0): void {
  if (camera && width > 0 && height > 0) {
    lens.projection.copy(camera.projectionMatrix)
    lens.width = width
    lens.height = height
    lens.on = true
  } else lens.on = false
}

/** What pickAssistTarget needs. */
export interface AssistQuery extends AssistLens {
  /** Half the box's side, CSS px. The reticle is the canvas's centre. */
  halfPx: number
  /** Where the shot leaves from: the eye after this step's move, region-local. */
  eye: Readonly<Vec3>
  /** The look the view is built from, in the simulation's terms (the step's input, pitch held inside the body's limit). */
  yaw: number
  pitch: number
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

/* Scratch, reused every step. */
const world = new Matrix4()
const inv = new Matrix4()
const euler = new Euler(0, 0, 0, 'YXZ')
const v = new Vector3()
const rp = { x: 0, y: 0, z: 0 }
const at = { sx: 0, sy: 0, z: 0 }
interface Cand { tg: Target; screenPx: number; dist: number }
const pool: Cand[] = []
const cands: Cand[] = []
const shot = { stop: 0, along: [] as Array<{ t: number; id: number }> }
const byCentre = (a: Cand, b: Cand): number => a.screenPx - b.screenPx || a.dist - b.dist || a.tg.id - b.tg.id

/** The view (inverse camera) matrix for an eye and a look, into `inv`: the camera Canvas3D would place there, without its bob. */
function viewFrom(eye: Readonly<Vec3>, yaw: number, pitch: number): void {
  world.makeRotationFromEuler(euler.set(pitch, cameraYaw(yaw), 0, 'YXZ'))
  toRender(eye, rp)
  world.setPosition(rp.x, rp.y, rp.z)
  inv.copy(world).invert()
}

/** A region-local point through `inv` and the lens into `at`: CSS px from the reticle (sx right, sy up) and depth (z below 0 is in front). */
function project(p: Readonly<Vec3>, l: AssistLens): void {
  toRender(p, rp)
  v.set(rp.x, rp.y, rp.z).applyMatrix4(inv)
  at.z = v.z
  if (v.z >= -1e-6) { at.sx = Infinity; at.sy = Infinity; return }
  v.applyMatrix4(l.projection as Matrix4)
  at.sx = (v.x * l.width) / 2
  at.sy = (v.y * l.height) / 2
}

/**
 * The drone the assist fires at, or null (see the file header): centre in
 * the box and in front of the eye, within range, hit first by the exact
 * shot; the most central, then the nearest.
 */
export function pickAssistTarget(q: AssistQuery): AssistPick | null {
  if (!(q.halfPx > 0) || !(q.width > 0) || !(q.height > 0)) return null
  viewFrom(q.eye, q.yaw, q.pitch)
  cands.length = 0
  for (const tg of q.drones) {
    if (tg.hp <= 0) continue
    const dist = Math.hypot(tg.pos[0] - q.eye[0], tg.pos[1] - q.eye[1], tg.pos[2] - q.eye[2])
    if (dist > q.range || dist < 1e-6) continue
    project(tg.pos, q)
    if (Math.abs(at.sx) > q.halfPx || Math.abs(at.sy) > q.halfPx) continue
    const c = pool[cands.length] ?? (pool[cands.length] = { tg, screenPx: 0, dist: 0 })
    c.tg = tg; c.screenPx = Math.hypot(at.sx, at.sy); c.dist = dist
    cands.push(c)
  }
  if (cands.length > 1) cands.sort(byCentre)
  for (const c of cands) {
    const aim = lookAtScreen(q.eye, c.tg.pos)
    // The shot as the simulation will fire it: its direction rebuilt from the aim, from this eye.
    castHitscan(q.solids, q.drones, q.eye as Vec3, lookDir(aim.yaw, aim.pitch), q.range, shot)
    if (shot.along.length && shot.along[0].id === c.tg.id) return { target: c.tg.id, aim, screenPx: c.screenPx, dist: c.dist }
  }
  return null
}

/**
 * The cheap first pass: whether any live drone could be in the box once the
 * eye has moved up to `reach` gibsons from `eye` (the box widened by what
 * that move can shift a drone on screen, the range by `reach`).
 */
export function anyNearBox(q: Omit<AssistQuery, 'solids'>, reach: number): boolean {
  if (!(q.halfPx > 0) || !(q.width > 0) || !(q.height > 0)) return false
  viewFrom(q.eye, q.yaw, q.pitch)
  const e = q.projection.elements
  const focalPx = Math.max(Math.abs(e[0]) * q.width, Math.abs(e[5]) * q.height) / 2
  for (const tg of q.drones) {
    if (tg.hp <= 0) continue
    const dist = Math.hypot(tg.pos[0] - q.eye[0], tg.pos[1] - q.eye[1], tg.pos[2] - q.eye[2])
    if (dist > q.range + reach) continue
    // So close that a step's move could swing it anywhere on screen.
    if (dist <= reach * 2 + 0.05) return true
    project(tg.pos, q)
    if (at.z >= -1e-6) continue
    const slack = (focalPx * reach) / (dist - reach)
    if (Math.abs(at.sx) <= q.halfPx + slack && Math.abs(at.sy) <= q.halfPx + slack) return true
  }
  return false
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

/** The look after this step's move, as stepPlayer sets it: the input's yaw and its pitch held inside PITCH_LIMIT (the body's when not finite). */
const look = { yaw: 0, pitch: 0 }
function lookThisStep(b: Body, input: RunInput): typeof look {
  look.yaw = Number.isFinite(input.yaw) ? input.yaw : b.yaw
  look.pitch = Number.isFinite(input.pitch) ? Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, input.pitch)) : b.pitch
  return look
}

/** How far the eye may go in one step, for the first pass: the body's speed over a step, and some room for a jump or a stair. */
function reachOf(b: Body): number {
  return Math.hypot(b.vel[0], b.vel[1], b.vel[2]) * STEP_S + 0.5
}

/** applyAssist's query, one object filled in place each step (its drones let go after). */
const NO_DRONES: readonly Target[] = []
const query: AssistQuery = { projection: lens.projection, width: 0, height: 0, halfPx: 0, eye: [0, 0, 0], yaw: 0, pitch: 0, drones: NO_DRONES, range: 0, solids: null as unknown as Solids }

/** A test's stand-in for the HUD's box and the canvas's lens. */
export interface AssistAt extends AssistLens {
  halfPx: number | null
}

/**
 * One fixed step's assist, on the input about to be stepped (mutated): with
 * the box shown, the gun in hand an auto hitscan assist gun and a target
 * found, fire at it with an aim that hits (unless the simulation's assist
 * roll sends the pull wide). `given` overrides the module's
 * box and lens (tests).
 */
export function applyAssist(st: RunState, input: RunInput, given?: AssistAt | null): AssistPick | null {
  const halfPx = given ? given.halfPx : boxHalfPx
  const l: AssistLens | null = given ?? (lens.on ? lens : null)
  assistState.target = null
  if (halfPx === null || !l || st.phase !== 'wave' || !st.drones.length) return null
  const def = st.world.variant.spec.weapons[gunThisStep(st, input)]
  if (def.assist !== 'auto' || def.fire !== 'hitscan' || def.mode !== 'auto') return null
  const { yaw, pitch } = lookThisStep(st.body, input)
  const q = query
  q.projection = l.projection; q.width = l.width; q.height = l.height; q.halfPx = halfPx
  q.yaw = yaw; q.pitch = pitch; q.drones = st.drones; q.range = def.range; q.solids = st.world.solids
  q.eye = eyeOf(st.body, st.world.variant.spec.player)
  if (!anyNearBox(q, reachOf(st.body))) return null
  q.eye = eyeAfterStep(st, input)
  const pick = pickAssistTarget(q)
  q.drones = NO_DRONES
  if (!pick) return null
  input.fire = true
  input.aim = { yaw: pick.aim.yaw, pitch: pick.aim.pitch }
  assistState.target = pick.target
  return pick
}
