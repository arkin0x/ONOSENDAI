/**
 * walkFluid.ts: fluid WALK's frame (arkinox, 2026-11-16; the numbers and the
 * math are lib/fluidWalk.ts, the switch store/fluidSwitch.ts).
 *
 * The walker is a smooth position, `frac` steps from the middle of its
 * anchor gibson (the walk's cursor), moving at `v` steps a second. Each
 * frame (scene/Scene.tsx Rig, before the fall's frame):
 *
 * | Part | What happens |
 * |---|---|
 * | input | what is held (store/walkHold.ts heldNow), or a tap's short nudge, is the way to go: forward and the sides along the way you face, laid flat across gravity; with gravity off, JUMP and DOWN push up and down |
 * | speed | it picks up toward FLUID_MAX_SPEED, and slows to a stop when let go; the cap eases as the walk falls behind its proofs (syncSpeedFactor), and holds at the edge of the gibson one under the LOSING SYNC warning |
 * | the anchor | when the smooth position passes half a step from its gibson's middle, the walk takes one legal step there (store/useWalk.ts fluidCross): a straight step, or a diagonal near a corner; the step goes to the chain as a press's would, so the chain only ever sees whole gibsons |
 * | walls | a step a wall holds keeps the smooth position in its gibson, FLUID_WALL_REACH from the middle at most (and FLUID_FACE_GAP short of a nearer face), and stops its speed that way only: the rest goes on, which is sliding along the wall |
 * | floors, stairs, gravity | the step does what a press does (stair step-up and step-down, the fall off a ledge, the bounce pads); a stair's rise is eased into the eye, not jumped; jumps, double jumps and falls are the walk's own arcs (store/useWalk.ts), unchanged |
 * | the eye | the camera and your avatar are drawn at the anchor plus `frac` (lib/walkEye.ts walkGlide), every frame, never snapped to the grid while in WALK |
 * | leaving WALK, a STOP, a step that did not land | the anchor moves without the smooth position: the eye glides from where it was to the new anchor (GLIDE_TAU_S) and the speed is dropped |
 *
 * Module state, as the fall's is: it is read every frame and nothing should
 * re-render for it.
 */

import { type AxisDirection, type AxisName, type Position, stepFor } from '../lib/space'
import {
  AXES, FLUID_ACCEL, FLUID_AIR_ACCEL, FLUID_AIR_DECEL, FLUID_DECEL, FLUID_EDGE_REACH, FLUID_FACE_GAP, FLUID_MAX_SPEED,
  FLUID_WALL_REACH, accelerate, dueCrossing, len, syncSpeedFactor, wishOf, zero, type Vec,
} from '../lib/fluidWalk'
import { moveDirection } from '../lib/moves'
import { walkFacing, walkGlide } from '../lib/walkEye'
import { WORLD_DOWN } from '../lib/walkDown'
import { useCyberspace } from './useCyberspace'
import { fluidCross, fallState, useWalk, walkDown } from './useWalk'
import { fluidNudge, fluidOn } from './fluidSwitch'
import { heldNow } from './walkHold'
import { walkInputOpen } from './walkInput'
import { faceDistance, wallItemsAt } from './walkWalls'

/** How long the eye takes to glide onto a new anchor, in seconds (the time constant): about a third of a second to settle. */
export const GLIDE_TAU_S = 0.09

/** Past this many steps the anchor jumped too far to glide (a respawn, a hyperjump): the eye cuts. */
const GLIDE_MAX = 64

/** The longest frame stepped at once, in seconds; a longer gap (a hidden tab) is cut to it. */
const MAX_DT = 0.05

/** A held face is asked again this often while you push on it, in ms (a door opens, a wall arrives). */
const RECHECK_MS = 1000

/** Under GRAVITY a crossing is a drift, never taken off a ledge, when the way you push leans less than this off its axis: sin(22.5 degrees), the 8-direction walk's snap. */
const DRIFT = Math.sin((22.5 * Math.PI) / 180)

/** A face or an edge that held a crossing: how far the smooth position may go that way, in steps, when it was asked, and whether it was the edge safety. */
interface Held { limit: number; at: number; edge: boolean }

const st = {
  /** Velocity, steps per second, by cyberspace axis. */
  v: zero(),
  /** The smooth position, in steps from the anchor's middle. */
  frac: zero(),
  /** The eye's glide onto a new anchor (and a stair's rise), in steps: decays to nothing. */
  glide: zero(),
  /** The anchor as the last frame left it, or null when fluid WALK is not running. */
  anchor: null as Position | null,
  /** The zoom the steps were measured at. */
  scaleExp: 0,
  /** The last frame, ms. */
  last: null as number | null,
  /** A fall was in the air at the last frame: its landing's change of height is the fall's, not a jump of the anchor. */
  wasFalling: false,
  /** Faces and edges that held a crossing from this anchor, by `axis` and sign. */
  held: new Map<string, Held>(),
}

const key = (axis: AxisName, dir: number): string => `${axis}${dir > 0 ? '+' : '-'}`

/** Fluid WALK's state, for tests and the DEV handle: read only. */
export function fluidState(): Readonly<typeof st> {
  return st
}

/** Forget everything: the next frame starts at the anchor's middle, at rest. */
export function resetFluid(): void {
  st.v = zero()
  st.frac = zero()
  st.glide = zero()
  st.anchor = null
  st.last = null
  st.wasFalling = false
  st.held.clear()
  writeEye(false)
}

/** Whether fluid WALK is running now: walking, at your own head, with the switch on. */
export function fluidWalking(): boolean {
  const cs = useCyberspace.getState()
  return cs.walking && fluidOn() && cs.atHead()
}

/** The eye's offset from the anchor (lib/walkEye.ts walkGlide), and whether the rig follows it exactly (`exact`, while fluid WALK runs). */
function writeEye(exact: boolean): void {
  walkGlide.x = st.frac.x + st.glide.x
  walkGlide.y = st.frac.y + st.glide.y
  walkGlide.z = st.frac.z + st.glide.z
  walkGlide.exact = exact
  walkGlide.active = exact || Math.abs(walkGlide.x) + Math.abs(walkGlide.y) + Math.abs(walkGlide.z) > 1e-4
}

/** The anchor moved without the smooth position (`delta` steps, old minus new): the eye glides onto it from where it was, at rest. */
function glideOnto(delta: Vec): void {
  if (AXES.some((a) => !(Math.abs(delta[a] + st.frac[a] + st.glide[a]) < GLIDE_MAX))) {
    st.glide = zero()
  } else {
    for (const a of AXES) st.glide[a] += delta[a] + st.frac[a]
  }
  st.frac = zero()
  st.v = zero()
  st.held.clear()
}

/** `a` minus `b`, in steps of `length` gibsons. */
function stepsBetween(a: Position, b: Position, length: bigint): Vec {
  const n = Number(length)
  return { x: Number(a.x - b.x) / n, y: Number(a.y - b.y) / n, z: Number(a.z - b.z) / n }
}

/**
 * One frame of fluid WALK at `now` (ms). Called by the rig before the fall's
 * frame (tickFall), so a crossing that walks off a ledge starts its fall in
 * the same frame. True while it is running.
 */
export function tickFluid(now: number = performance.now()): boolean {
  const cs = useCyberspace.getState()
  const dt = st.last === null ? 0 : Math.min(MAX_DT, Math.max(0, (now - st.last) / 1000))
  st.last = now
  if (!fluidWalking()) {
    // Just left (leaving WALK, the switch, a VIEW taking the head): the
    // smooth position glides onto wherever the anchor is now.
    if (st.anchor !== null) {
      if (cs.scaleExp === st.scaleExp) glideOnto(stepsBetween(st.anchor, cs.cursor, stepFor(cs.scaleExp)))
      else st.glide = zero()
      st.anchor = null
      st.frac = zero()
    }
    decay(dt)
    writeEye(false)
    return false
  }
  const length = stepFor(cs.scaleExp)
  const gravity = useWalk.getState().gravity
  const g: AxisDirection = gravity ? walkDown() : WORLD_DOWN
  const falling = fallState() !== null
  // The anchor moved without a crossing: a STOP, a step that did not land, a
  // move from another device, a fall's height. A fall's own change of
  // height (an arc, a landing, a bounce) is the fall's eye, not a glide.
  if (st.anchor === null || st.scaleExp !== cs.scaleExp) {
    st.frac = zero()
    st.v = zero()
    st.glide = zero()
    st.held.clear()
  } else if (!same(st.anchor, cs.cursor)) {
    const delta = stepsBetween(st.anchor, cs.cursor, length)
    if (falling || st.wasFalling) delta[g.axis] = 0
    if (AXES.some((a) => delta[a] !== 0)) glideOnto(delta)
    st.held.clear()
  }
  st.anchor = { ...cs.cursor }
  st.scaleExp = cs.scaleExp
  // Under gravity, up and down are the fall's: nothing smooth along it.
  if (gravity) {
    st.glide[g.axis] += st.frac[g.axis]
    st.frac[g.axis] = 0
    st.v[g.axis] = 0
  }

  const wish = wishNow(now, gravity, g)
  const behind = useWalk.getState().behind
  const factor = syncSpeedFactor(behind)
  const max = FLUID_MAX_SPEED * Math.max(factor, 0.25)
  if (falling) accelerate(st.v, wish, max, FLUID_AIR_ACCEL, FLUID_AIR_DECEL, dt)
  else accelerate(st.v, wish, max, FLUID_ACCEL, FLUID_DECEL, dt)
  if (gravity) st.v[g.axis] = 0
  for (const a of AXES) st.frac[a] += st.v[a] * dt

  // Faces and edges already known to hold: the smooth position stays inside, and the speed into them stops.
  for (const a of AXES) {
    if (st.frac[a] === 0) continue
    const dir: 1 | -1 = st.frac[a] > 0 ? 1 : -1
    const h = st.held.get(key(a, dir))
    if (!h || Math.abs(st.frac[a]) <= h.limit) continue
    // Pushing on it a while: asked again where it stands (a door opened, a
    // wall went), so the eye never drifts off the face and back.
    if (now - h.at >= RECHECK_MS && st.v[a] * dir > 0) {
      const res = fluidCross({ axis: a, dir }, null, h.edge)
      if (res.kind === 'moved') { moved(res, { axis: a, dir }, null, length); continue }
      h.at = now
    }
    st.frac[a] = dir * h.limit
    if (st.v[a] * dir > 0) st.v[a] = 0
  }

  // The crossings due, a few a frame at most.
  const level = AXES.filter((a) => !gravity || a !== g.axis)
  for (let n = 0; n < 4; n++) {
    const due = dueCrossing(st.frac, st.v, level)
    if (!due) break
    const { main, side } = due
    // One under the LOSING SYNC warning: no new gibson until the chain catches up.
    if (factor === 0) { holdEdges(); break }
    const known = st.held.get(key(main.axis, main.dir))
    if (known) { holdAt(main, known.limit, known.at, known.edge); continue }
    // A drift off the way you push (under 22.5 degrees of it) never walks off a ledge.
    const w = len(wish)
    const edgeSafe = gravity && !falling && w > 1e-9 && Math.abs(wish[main.axis]) < DRIFT * w
    const res = fluidCross(main, side, edgeSafe)
    if (res.kind === 'moved') { moved(res, main, side, length); continue }
    if (res.kind === 'wait') { holdEdges(); break }
    // Held: by a wall, measured to its face; by the edge safety, near the edge.
    holdAt(main, res.by ? wallLimit(main, length) : FLUID_EDGE_REACH, now, !res.by)
  }

  decay(dt)
  st.wasFalling = fallState() !== null
  writeEye(true)
  return true
}

/** What is held now (or a tap's nudge), as the way to go. */
function wishNow(now: number, gravity: boolean, g: AxisDirection): Vec {
  if (!walkInputOpen()) return zero()
  let d = heldNow()
  const pushes = (x: { fwd: number; strafe: number; vert: number }): boolean => x.fwd !== 0 || x.strafe !== 0 || (!gravity && x.vert !== 0)
  if (!pushes(d) && now < fluidNudge.until) d = { fwd: sgn(fluidNudge.fwd), strafe: sgn(fluidNudge.strafe), vert: sgn(fluidNudge.vert) }
  if (!pushes(d)) return zero()
  const cs = useCyberspace.getState()
  const axes = cs.screenAxes ?? cs.axes()
  const up: AxisName = gravity ? g.axis : axes.up.axis
  const vertical = gravity ? null : moveDirection(axes, 'up')
  // With no facing to go by (the first frame), the screen's axes, as a press took.
  const forward: Vec = walkFacing.valid ? walkFacing.forward : axisVec(moveDirection(axes, 'away'))
  const right: Vec = walkFacing.valid ? walkFacing.right : axisVec(moveDirection(axes, 'right'))
  return wishOf(forward, right, up, d.fwd, d.strafe, vertical, gravity ? 0 : d.vert)
}

const sgn = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0)

function axisVec(d: AxisDirection): Vec {
  const v = zero()
  v[d.axis] = d.dir
  return v
}

/** How far toward a wall along `d` the smooth position may go, in steps: FLUID_WALL_REACH, or FLUID_FACE_GAP short of a nearer face. */
function wallLimit(d: AxisDirection, length: bigint): number {
  const cs = useCyberspace.getState()
  const fall = fallState()
  const items = fall ? fall.items : wallItemsAt(cs.plane, cs.cursor)
  const face = faceDistance(cs.cursor, d.axis, d.dir, items, length)
  const n = Number(length)
  // The face is measured from the anchor, where the eye is at the middle.
  if (face === null) return FLUID_WALL_REACH
  return Math.max(0, Math.min(FLUID_WALL_REACH, (face - FLUID_FACE_GAP) / n))
}

/** Waiting (walls on their way, or the chain to catch up): the smooth position stays in its gibson, at its edge, and the speed out of it stops. */
function holdEdges(): void {
  for (const a of AXES) {
    // Past the edge and still going out (a diagonal's second axis, already crossed, is coming back in: left alone).
    if (Math.abs(st.frac[a]) <= 0.5 || st.frac[a] * st.v[a] < 0) continue
    const dir = st.frac[a] > 0 ? 1 : -1
    st.frac[a] = dir * (0.5 - 1e-3)
    if (st.v[a] * dir > 0) st.v[a] = 0
  }
}

/**
 * The anchor took a step (`res`), crossing along `main` (and `side`): along
 * the way it crossed, the smooth position is now that much nearer the new
 * middle; across it (a stair's rise, a settle), the eye stays where it was
 * and glides up or down onto it.
 */
function moved(res: { from: Position; to: Position }, main: AxisDirection, side: AxisDirection | null, length: bigint): void {
  const d = stepsBetween(res.to, res.from, length)
  for (const a of AXES) {
    if (d[a] === 0) continue
    if (a === main.axis || (side && a === side.axis)) st.frac[a] -= d[a]
    else st.glide[a] -= d[a]
  }
  st.anchor = { ...useCyberspace.getState().cursor }
  st.held.clear()
}

/** Keep the smooth position within `limit` steps of the middle along `d`, stop the speed that way, and remember it for this anchor (`edge`: the edge safety held it, not a wall). */
function holdAt(d: AxisDirection, limit: number, now: number, edge: boolean): void {
  const a = d.axis
  if (st.frac[a] * d.dir > limit) st.frac[a] = d.dir * limit
  if (st.v[a] * d.dir > 0) st.v[a] = 0
  st.held.set(key(a, d.dir), { limit, at: now, edge })
}

/** The glide fades toward nothing (GLIDE_TAU_S), whatever the frame rate. */
function decay(dt: number): void {
  if (dt <= 0) return
  const k = Math.exp(-dt / GLIDE_TAU_S)
  for (const a of AXES) st.glide[a] = Math.abs(st.glide[a] * k) < 1e-4 ? 0 : st.glide[a] * k
}

function same(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

// DEV window handle, the house pattern: fluid WALK's state for the headless recording.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __fluid?: unknown }).__fluid = fluidState
}
