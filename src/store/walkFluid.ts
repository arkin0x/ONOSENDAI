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
 * | speed | it picks up toward FLUID_MAX_SPEED, and slows to a stop when let go; the parked slowdown (store/walkLimits.ts SYNC_SLOWDOWN_ON, off since 2026-11-22) would ease the cap from 15 events ahead of the chain (store/walkAhead.ts eventsAhead, lib/fluidWalk.ts syncSpeedFactor) |
 * | the fluid pause | 21 events ahead of the chain fluid WALK switches itself off and the walk goes on as the step WALK; at 15 or fewer it comes back on (store/fluidSwitch.ts fluidPauseCheck, checked here whenever the count can change) |
 * | the anchor | when the smooth position passes half a step from its gibson's middle, the walk takes one legal step there (store/useWalk.ts fluidCross): a straight step, or a diagonal near a corner; the step goes to the chain as a press's would, so the chain only ever sees whole gibsons |
 * | walls | a step a wall holds keeps the smooth position in its gibson, FLUID_WALL_REACH from the middle at most (and FLUID_FACE_GAP short of a nearer face), and stops its speed that way only: the rest goes on, which is sliding along the wall |
 * | floors, stairs, gravity | the step does what a press does (stair step-up and step-down, the fall off a ledge, the bounce pads); the anchor's change of height is eased into the eye, and the ground (below) stands the drawn walker on the surface itself; jumps, double jumps and falls are the walk's own arcs (store/useWalk.ts), unchanged |
 * | the eye | the camera and your avatar are drawn at the anchor plus `frac` (lib/walkEye.ts walkGlide), every frame, never snapped to the grid while in WALK |
 * | the ground | after the fall's frame (groundFluid), the drawn walker's height is the surface under it, wherever it is between gibsons (store/walkWalls.ts groundUnder), never the gibson's: it stands on the geometry, and its feet are never drawn below it |
 * | leaving WALK, a STOP, a step that did not land | the anchor moves without the smooth position: the eye glides from where it was to the new anchor (GLIDE_TAU_S) and the speed is dropped |
 *
 * Module state, as the fall's is: it is read every frame and nothing should
 * re-render for it.
 */

import { type AxisDirection, type AxisName, type Position, stepFor } from '../lib/space'
import {
  AXES, FLUID_ACCEL, FLUID_AIR_ACCEL, FLUID_AIR_DECEL, FLUID_DECEL, FLUID_EDGE_REACH, FLUID_FACE_GAP, FLUID_MAX_SPEED,
  FLUID_WALL_REACH, accelerate, dueCrossing, len, wishOf, zero, type Vec,
} from '../lib/fluidWalk'
import { moveDirection } from '../lib/moves'
import { verticalAlong } from '../lib/walkKeys'
import { walkFacing, walkFall, walkFallUp, walkGlide, walkRise } from '../lib/walkEye'
import { WORLD_DOWN, heightOf, raised, upOf } from '../lib/walkDown'
import { useCyberspace } from './useCyberspace'
import { fluidCross, fallState, setWalkerMoving, useWalk, walkDown } from './useWalk'
import { clearFluidPause, fluidNudge, fluidOn, fluidPauseCheck, useFluidWalk } from './fluidSwitch'
import { heldNow } from './walkHold'
import { aheadOfState, eventsAhead } from './walkAhead'
import { walkLimitsOn, walkSpeedFactor } from './walkLimits'
import { useLayers } from './useLayers'
import { walkInputOpen } from './walkInput'
import { FOOT_SLOPE, REST_FLOOR, clearShare, faceDistance, footGround, groundUnder, restDrop, steepGround, wallItemsAt, type WallItem } from './walkWalls'
import { STEP_DOWN_MAX, STEP_UP_MAX } from './walkStep'
import { WALK_GRAVITY } from './walkGravity'

/** How long the eye takes to glide onto a new anchor, in seconds (the time constant): about a third of a second to settle. */
export const GLIDE_TAU_S = 0.09

/** Past this many steps the anchor jumped too far to glide (a respawn, a hyperjump): the eye cuts. */
const GLIDE_MAX = 64

/** The longest frame walked, in seconds; a longer gap (a hidden tab) is cut to it. */
const MAX_DT = 0.25

/** A frame is walked in steps of at most this, in seconds. */
const SUB_DT = 1 / 60

/** In the air a held face is asked again this often, in ms: the arc's height changes under it (a held key pressed every 110 ms). */
const AIR_RECHECK_MS = 100

/** How far from the middle, in steps, the smooth position asks whether the next gibson its way can be entered. */
const PROBE_FROM = 0.05

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
  /** Ways out of this anchor already asked and found open, by `axis` and sign. */
  open: new Set<string>(),
  /** The gravity the asking was done under ('' with it off). */
  down: '',
}

/**
 * A walker whose last frame is older than this, in ms, is not moving, whatever
 * speed that frame left it: the frames have stopped (a hidden tab), and the
 * open segment closes as it would at rest. A slow device's frames, about a
 * second apart at worst, are well inside it.
 */
const MOVING_FRAME_MS = 2500

// The open segment's stillness timer (store/useWalk.ts armSettle) waits while
// the walker moves: a held walk is not still, however far apart its frames.
setWalkerMoving(() => st.anchor !== null && st.last !== null && performance.now() - st.last <= MOVING_FRAME_MS && len(st.v) > 0 && fluidWalking())

/** How the crossings went, for the headless recording and tests: plain counters. */
export const fluidCounts = { moved: 0, held: 0, wait: 0 }

const key = (axis: AxisName, dir: number): string => `${axis}${dir > 0 ? '+' : '-'}`

/**
 * Fluid WALK's movement, the stable surface for features built on it (a
 * game riding the walk, a probe): where the walker is (its anchor gibson,
 * which the chain holds or will, plus `offset` steps from that gibson's
 * middle, by cyberspace axis, the glide onto a new anchor included), how
 * fast it goes (`velocity`, steps per second), and how many gibsons a step
 * is (2^zoom). `anchor` is null while fluid WALK is not running. Plain
 * copies: changing them changes nothing. The look direction is
 * walkLookDirection; the input is store/walkHold.ts (holdStart, holdEnd,
 * heldNow), the same for the keys and the pad.
 */
export interface FluidMotion { anchor: Position | null; offset: Vec; velocity: Vec; stepGibsons: number }
export function fluidMotion(): FluidMotion {
  return {
    anchor: st.anchor ? { ...st.anchor } : null,
    offset: { x: st.frac.x + st.glide.x, y: st.frac.y + st.glide.y, z: st.frac.z + st.glide.z },
    velocity: { ...st.v },
    stepGibsons: 2 ** st.scaleExp,
  }
}

/** Which way the WALK camera looks, in cyberspace axes (unit vectors): `valid` false until the scene has written it this WALK. A copy. */
export function walkLookDirection(): { valid: boolean; forward: Vec; right: Vec } {
  return { valid: walkFacing.valid, forward: { ...walkFacing.forward }, right: { ...walkFacing.right } }
}

/** Fluid WALK's state, for tests and the DEV handle: read only. */
export function fluidState(): Readonly<typeof st> {
  return st
}

/** Forget everything: the next frame starts at the anchor's middle, at rest. */
export function resetFluid(): void {
  resetFoot()
  walkRise.offset = 0
  st.v = zero()
  st.frac = zero()
  st.glide = zero()
  st.anchor = null
  st.last = null
  st.wasFalling = false
  clearAsked()
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
  clearAsked()
}

/** `a` minus `b`, in steps of `length` gibsons. */
function stepsBetween(a: Position, b: Position, length: bigint): Vec {
  const n = Number(length)
  return { x: Number(a.x - b.x) / n, y: Number(a.y - b.y) / n, z: Number(a.z - b.z) / n }
}

/**
 * One frame of fluid WALK at `now` (ms). Called by the rig before the fall's
 * frame (tickFall), so a crossing that walks off a ledge starts its fall in
 * the same frame. A long frame is walked in steps of at most SUB_DT, so the
 * walk keeps real time on a slow device, as the fall does. True while it is
 * running.
 */
export function tickFluid(now: number = performance.now()): boolean {
  const cs = useCyberspace.getState()
  const dt = st.last === null ? 0 : Math.min(MAX_DT, Math.max(0, (now - st.last) / 1000))
  st.last = now
  // The fluid pause, every frame too: a fall's mid-air hops are module
  // state, which no store change reports.
  fluidPauseCheck(eventsAhead(), walkLimitsOn(), now, cs.walking)
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
  // Gravity switched, or turned with the view: what was asked was asked of another down.
  const down = gravity ? `${g.axis}${g.dir}` : ''
  if (down !== st.down) { st.down = down; clearAsked() }
  // The anchor moved without a crossing: a STOP, a step that did not land, a
  // move from another device, a fall's height. A fall's own change of
  // height (an arc, a landing, a bounce) is the fall's eye, not a glide.
  if (st.anchor === null || st.scaleExp !== cs.scaleExp) {
    st.frac = zero()
    st.v = zero()
    st.glide = zero()
    clearAsked()
  } else if (!same(st.anchor, cs.cursor)) {
    const delta = stepsBetween(st.anchor, cs.cursor, length)
    if (falling || st.wasFalling) delta[g.axis] = 0
    if (AXES.some((a) => delta[a] !== 0)) glideOnto(delta)
    clearAsked()
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
  const level = gravity ? LEVEL[g.axis] : AXES
  // A crossing that pauses fluid (FLUID_PAUSE_AT) ends the frame's walking there: the next frame glides onto the anchor.
  for (let left = dt; left > 1e-9 && fluidOn(); left -= SUB_DT) substep(Math.min(SUB_DT, left), now, wish, gravity, g, level, length)
  if (dt === 0) substep(0, now, wish, gravity, g, level, length)
  decay(dt)
  st.wasFalling = fallState() !== null
  writeEye(true)
  return true
}

/**
 * How fast the drawn feet may come down onto a lower surface, in steps a
 * second: a tenth faster than walking down the steepest slope the stair
 * step-up climbs (STEP_UP_MAX a step at FLUID_MAX_SPEED: 25 at 12.5 steps a
 * second, so 27.5), so a slope is followed exactly and only a ledge's drop is
 * eased, over a few frames. It was 20 at the old 9.09 steps a second.
 */
export const FOOT_DROP_SPEED = Number(STEP_UP_MAX) * FLUID_MAX_SPEED * 1.1

/**
 * Under GRAVITY, the most the ground may drop away under the feet and still
 * be stepped down onto, in steps: half a gibson, a usual stair's riser,
 * eased down at FOOT_DROP_SPEED as before; or more, when a walkable slope (FOOT_SLOPE)
 * drops more than that over the frame's way across. Ground dropping away
 * further than that (a ledge, a riser of a gibson, a dip) is fallen to at
 * WALK_GRAVITY, from rest, while the walk's level speed carries the walker
 * on (arkinox, 2026-11-24: "Can we make it so if you fall, it falls with
 * gravity speed? Right now, if I walk over a 1 block dip, my avatar sticks
 * to the bottom of the dip almost instantly and it feels unnatural"): a dip
 * a gibson across at walking speed is crossed with little or no drop.
 */
export const FOOT_SNAP = 0.5

/**
 * The most a walkable slope's drop over one frame may stretch FOOT_SNAP to,
 * in steps: under a gibson, so a dip or a ledge a gibson deep is always
 * fallen to, at 24 fps or through a long frame alike (review of the fall).
 */
export const FOOT_FOLLOW_MAX = 0.75

/**
 * How fast the drawn feet may rise with the camera following them exactly,
 * in steps a second: a rise faster than this in a frame is a riser, and the
 * camera climbs the rest of it over GLIDE_TAU_S (lib/walkEye.ts walkRise).
 * It is about the camera, not the walk, so it stays 20 (what FOOT_DROP_SPEED
 * was at 9.09 steps a second) whatever FLUID_MAX_SPEED is: a riser never
 * lifts the camera more than a third of a gibson in a 60 fps frame. The
 * steepest slope walked at full speed (25 a second at 12.5) eases by its
 * last fifth, never below the feet (scene/Scene.tsx keeps EYE_ROOM).
 */
export const RISE_FOLLOW_SPEED = 20

/** How long the walls under the walker are kept before they are listed again, in ms (as scene/walkEyeRig.ts keeps the eye's). */
const FOOT_ITEMS_MS = 300

/** A face under the walker's own gibson nearer than this, in gibsons, is one it stands on (store/walkStep.ts standing: less than a gibson below). */
const STAND_REACH = 1 + 1e-9

/**
 * The drawn walker's feet (groundFluid). `h` is their height along up, in
 * gibsons from the anchor's middle, kept where it is in the world when the
 * anchor moves; null while fluid WALK is not running.
 */
const foot = {
  h: null as number | null,
  anchor: null as Position | null,
  scaleExp: 0,
  down: '',
  last: null as number | null,
  /** A fall was being drawn at the last frame. */
  falling: false,
  /** Under GRAVITY, the feet falling onto ground that dropped away (FOOT_SNAP): their speed down, gibsons a second, 0 when they stand. */
  vy: 0,
  dropping: false,
  /** How far under the fall's own point the feet were when it began: kept through the arc, so a jump leaves from the feet. */
  lift: 0,
  /** What the feet added to the drawn height at the last frame, gibsons along `upAxis` and `upDir`. */
  extra: 0,
  /** How far the drawn point was held back from a face at the feet's height at the last frame, cyberspace gibsons (clearShare). */
  pull: [0, 0, 0] as [number, number, number],
  upAxis: 'y' as AxisName,
  upDir: 1 as 1 | -1,
  /** The walls near the walker, listed every FOOT_ITEMS_MS or on a new gibson. */
  items: [] as WallItem[],
  itemsKey: '',
  itemsAt: -Infinity,
  /** The surface under the anchor's own middle, kept for this gibson and these walls. */
  under: null as number | null,
  underKey: '',
  /** The surface under the drawn point, kept for this gibson, these walls and this point (groundAt). */
  col: null as number | null,
  colKey: '',
  /** The ground under the footprint there, kept the same way (footAt). */
  print: 0,
  printKey: '',
  pending: { pending: false },
}

function resetFoot(): void {
  foot.h = null
  foot.anchor = null
  foot.last = null
  foot.falling = false
  foot.vy = 0
  foot.dropping = false
  foot.lift = 0
  foot.extra = 0
  foot.pull = [0, 0, 0]
  foot.items = []
  foot.itemsKey = ''
  foot.itemsAt = -Infinity
  foot.underKey = ''
  foot.colKey = ''
  foot.printKey = ''
}

/** The drawn feet's height along up, gibsons from the anchor's middle, or null while fluid WALK is not running: for tests and the DEV handle. */
export function footHeight(): number | null {
  return foot.h
}

/**
 * The ground's frame, after the fall's (scene/Scene.tsx Rig: tickFluid,
 * tickFall, then this): the drawn walker stands on the surface under it
 * (arkinox, 2026-11-17: "my avatar doesn't seem to stand on the geometry, it
 * stands on the nearest gibson"; "sometimes for a frame i'll dip under the
 * floor"). Display only: the anchor, the chain and every step are whole
 * gibsons as before, and walls and floors are still measured from the
 * walker's point at the middle of its gibson (DECK-0003 §1.12, §1.17).
 *
 * | Case | The drawn height |
 * |---|---|
 * | standing (a face less than a gibson under the anchor's middle) | the highest walkable ground under the footprint at the drawn point (store/walkWalls.ts groundUnder, then footGround), followed exactly up a slope and down one; a riser it passes over is stood on at once, and the camera follows it up over GLIDE_TAU_S (lib/walkEye.ts walkRise); under GRAVITY ground that drops away faster than a slope (a ledge, a riser, a dip) is fallen to at WALK_GRAVITY (dropTo, FOOT_SNAP), and with gravity off a drop is eased down at FOOT_DROP_SPEED at least |
 * | gravity off, rising off the floor | from the surface to the anchor's own height by the time the walker is half a step up, where it leaves the gibson, so the hand-over is seamless |
 * | in the air (a jump, a fall) | the fall's own arc, from where the feet were when it began, easing onto the arc's point (GLIDE_TAU_S) |
 * | a shard in reach still being built | where the feet were, until it is |
 * | not standing (gravity off, floating) | the anchor plus the glide, as before |
 * | a drawn point inside the foot of a wall, or up its side (a culvert's, a cliff's: the wall leans nearer the walker at the feet than at its middle, where fluid WALK keeps its gap) | drawn short of it, toward the anchor, on the floor before it (holdBack, offWallSide) |
 * | always | never under the highest walkable ground under the footprint at the drawn point |
 *
 * It adds to walkGlide along up only, so the rig draws it with no change.
 * Leaving fluid WALK, what it added glides off with the rest (GLIDE_TAU_S).
 */
export function groundFluid(now: number = performance.now()): void {
  const dt = foot.last === null ? 0 : Math.min(MAX_DT, Math.max(0, (now - foot.last) / 1000))
  foot.last = now
  const cs = useCyberspace.getState()
  if (!walkGlide.exact || !fluidWalking()) {
    // The step WALK (the switch off): the walker drawn with its origin on
    // the surface under its gibson's centre, else on its gibson's floor, as
    // every avatar out of WALK is (restDrop); the rig eases onto it as it
    // eases onto a step.
    const sg = cs.walking && useWalk.getState().gravity ? walkDown() : WORLD_DOWN
    const su = upOf(sg)
    const stepDrop = cs.walking ? stepWalkDrop(cs.cursor, cs.plane, cs.scaleExp, sg, now) : 0
    // Just left fluid WALK: the eye glides off the feet's height (and onto the step WALK's), as off the smooth position.
    if (foot.h !== null && cs.scaleExp === foot.scaleExp) {
      const stepG = 2 ** cs.scaleExp
      st.glide[foot.upAxis] += (foot.extra * foot.upDir) / stepG
      walkGlide[foot.upAxis] += (foot.extra * foot.upDir) / stepG
      for (const a of AXES) { st.glide[a] -= foot.pull[AXIS_INDEX[a]] / stepG; walkGlide[a] -= foot.pull[AXIS_INDEX[a]] / stepG }
      st.glide[su.axis] += (stepDrop * su.dir) / stepG
      walkGlide[su.axis] += (stepDrop * su.dir) / stepG
      walkGlide.active = true
    }
    resetFoot()
    if (stepDrop !== 0) {
      walkGlide[su.axis] -= (stepDrop * su.dir) / 2 ** cs.scaleExp
      walkGlide.active = true
    }
    // A stair's trail fades as it would have, so leaving WALK just after a riser never pops the camera.
    walkRise.offset = walkRise.offset > -1e-4 ? 0 : walkRise.offset * Math.exp(-dt / GLIDE_TAU_S)
    return
  }
  const gravity = useWalk.getState().gravity
  const g = gravity ? walkDown() : WORLD_DOWN
  const up = upOf(g)
  const ui = up.axis
  const stepG = 2 ** cs.scaleExp
  const downKey = `${g.axis}${g.dir}`
  const fall = fallState()
  const falling = fall !== null && walkFall.active
  // The height the rig would draw without the feet, gibsons along up from the anchor's middle.
  const fallH = falling && walkFallUp.axis === ui ? walkFall.offset * walkFallUp.dir * up.dir : 0
  const base = fallH + walkGlide[ui] * up.dir * stepG
  // A first frame (fluid WALK just began, or the anchor jumped too far to
  // follow): the feet go straight onto the ground, as they stood out of it.
  let fresh = false
  if (foot.h !== null && foot.anchor && foot.scaleExp === cs.scaleExp && foot.down === downKey) {
    // The anchor moved: the feet stay where they are in the world.
    foot.h -= Number(heightOf(cs.cursor, g) - heightOf(foot.anchor, g))
    if (!(Math.abs(foot.h - base) < GLIDE_MAX * stepG)) { foot.h = base; fresh = true }
  } else {
    fresh = true
    foot.h = base
    foot.falling = falling
    foot.lift = 0
    walkRise.offset = 0
  }
  foot.anchor = { ...cs.cursor }
  foot.scaleExp = cs.scaleExp
  foot.down = downKey
  const items = fall ? fall.items : itemsNear(cs.plane, cs.cursor, now)
  const lead: [number, number, number] = [walkGlide.x * stepG, walkGlide.y * stepG, walkGlide.z * stepG]
  const rise = Number(STEP_UP_MAX) * stepG
  const drop = Number(STEP_DOWN_MAX + 1n) * stepG
  const was = foot.h
  let h = was
  const decayK = Math.exp(-dt / GLIDE_TAU_S)
  const pull: [number, number, number] = [0, 0, 0]
  if (!falling) {
    lead[AXIS_INDEX[ui]] = 0
    foot.pending.pending = false
    const under = underAnchor(cs.cursor, items, g, rise, drop, downKey)
    const stood = under !== null && under > -STAND_REACH && !foot.pending.pending
    let col = groundAt(cs.cursor, lead, items, g, rise, drop, downKey)
    // No way to the drawn point at all, a riser's lift included: it is inside the foot of a wall. Drawn short of it (holdBack).
    if (stood && col === null && holdBack(cs.cursor, lead, under, items, g, pull)) col = groundAt(cs.cursor, lead, items, g, rise, drop, downKey)
    // Up the side of a wall the search's lifts climbed onto (higher than any walkable slope rises that far out): drawn nearer the anchor until it stands on ground.
    if (stood && col !== null && col > under + STEEP_RISE + FOOT_SLOPE * Math.hypot(lead[0], lead[1], lead[2])) col = offWallSide(cs.cursor, lead, col, under, items, g, rise, drop, pull)
    // A shard in reach still being built: the feet stay where they are until it is.
    if (!foot.pending.pending) {
      const standing = under !== null && under > -STAND_REACH
      // Not standing on anything: on the floor of the gibson it is drawn in.
      let target = base - REST_FLOOR * stepG
      if (standing) {
        // Past a rim with nothing near under the drawn point: still on the rim the anchor stands on. Else on the highest ground under the footprint (footAt).
        const s = col === null || col < under - stepG ? under : footAt(cs.cursor, lead, col, items, g, downKey)
        // Gravity off, pushing up off the floor: up to the next gibson's floor by half a step up, where it leaves this one.
        const r = gravity ? 0 : Math.max(0, st.frac[ui] * up.dir * stepG)
        const off = r - REST_FLOOR * stepG
        target = r > 0 ? s + (off - s) * Math.min(1, (2 * r) / stepG) : s
      }
      if (fresh) h = target
      else if (h < target) h = standing ? target : h + (target - h) * (1 - decayK)
      else if (h > target && gravity && standing) h = dropTo(h, target, stepG, dt)
      else if (h > target) h = Math.max(target, Math.min(h - FOOT_DROP_SPEED * stepG * dt, target + (h - target) * decayK))
      if (col !== null) {
        const floor = footAt(cs.cursor, lead, col, items, g, downKey)
        if (h < floor) h = floor
      }
      // On the ground: the feet's fall, if any, is over.
      if (h <= target + 1e-9 || !gravity || !standing) { foot.vy = 0; foot.dropping = false }
    }
    foot.falling = false
  } else {
    // A jump leaves from the feet, and the arc takes them over: how far
    // under the arc's point they were when it began fades (GLIDE_TAU_S), so
    // they land where the arc lands, on its whole gibson's standing height.
    // In the air the origin rides the arc on the floor of the gibson it is drawn in.
    const air = base - REST_FLOOR * stepG
    // The walk's own arc takes over from a drop of the feet.
    foot.vy = 0
    foot.dropping = false
    if (fresh) foot.lift = 0
    else if (!foot.falling) foot.lift = h - air
    else foot.lift *= decayK
    foot.falling = true
    h = air + foot.lift
    // The ground under the arc, searched from the arc's own point (never
    // from the gibson the fall left, which can be far above or below it), in open air: the drawn origin, half a gibson under it, may be inside a slope.
    // Or from where the feet were the frame before, when that is higher: the
    // frame a fall reaches a floor draws its arc a little past it, and a
    // search from there, under the floor, would miss the floor it went through.
    const from = Math.max(h, base, fresh ? -Infinity : was)
    lead[AXIS_INDEX[ui]] = from * up.dir
    let col = groundUnder(cs.cursor, lead, items, g, rise, drop)
    // Falling past the foot of a wall, inside it: drawn short of it at the search's height, as standing.
    if (col === null && holdBack(cs.cursor, lead, from, items, g, pull)) col = groundUnder(cs.cursor, lead, items, g, rise, drop)
    if (col !== null) {
      const floor = footGround(cs.cursor, lead, col, items, g)
      if (h < floor) h = floor
    }
  }
  // A riser stood on at once (a rise faster than RISE_FOLLOW_SPEED): the
  // feet are on it, and the camera follows them up over GLIDE_TAU_S (walkRise).
  const jump = h - was - RISE_FOLLOW_SPEED * stepG * dt
  walkRise.offset = walkRise.offset * decayK - (!falling && !fresh && jump > 0 ? jump : 0)
  if (walkRise.offset > -1e-4 * stepG) walkRise.offset = 0
  walkRise.up.axis = ui
  walkRise.up.dir = up.dir
  foot.h = h
  foot.extra = h - base
  foot.upAxis = ui
  foot.upDir = up.dir
  if (foot.extra !== 0) {
    walkGlide[ui] += (foot.extra * up.dir) / stepG
    walkGlide.active = true
  }
  foot.pull = pull
  if (pull[0] !== 0 || pull[1] !== 0 || pull[2] !== 0) {
    for (const a of AXES) walkGlide[a] -= pull[AXIS_INDEX[a]] / stepG
    walkGlide.active = true
  }
}

/**
 * Under GRAVITY, the feet at `h` over ground at `target` below them (gibsons
 * along up), one frame of `dt` on: stepping down onto it, eased at
 * FOOT_DROP_SPEED as before (a slope is followed exactly), when it dropped
 * away by no more than FOOT_SNAP, or than a walkable slope drops over the
 * way walked this frame; else falling onto it at WALK_GRAVITY from rest,
 * the walk going on across as it does (fluid WALK's speed is level under
 * gravity, so it carries the walker over a dip). Display only, as all of
 * groundFluid: the anchor still takes the step down, and the chain gets the
 * same steps.
 */
function dropTo(h: number, target: number, stepG: number, dt: number): number {
  const level = Math.hypot(st.v.x, st.v.y, st.v.z) * stepG
  // A slow frame walks further, but never so far that a gibson's drop reads as a slope: under FOOT_FOLLOW_MAX at any frame rate.
  const follow = Math.min(FOOT_FOLLOW_MAX, Math.max(FOOT_SNAP, (FOOT_SLOPE * level * dt) / stepG)) * stepG
  if (!foot.dropping && h - target <= follow + 1e-9) return Math.max(target, h - FOOT_DROP_SPEED * stepG * dt)
  foot.dropping = true
  // The arc itself over the frame, whatever the frame rate: v t + g t^2 / 2.
  const fell = foot.vy * dt + (WALK_GRAVITY * dt * dt) / 2
  foot.vy += WALK_GRAVITY * dt
  return Math.max(target, h - fell)
}

/** The step WALK's drop under the cursor (restDrop, along its gravity), in gibsons: kept for this gibson, asked again every FOOT_ITEMS_MS (walls arriving). */
let stepKept = { key: '', at: -Infinity, drop: REST_FLOOR }
function stepWalkDrop(at: Position, plane: number, scaleExp: number, g: AxisDirection, now: number): number {
  // Zoomed out past a gibson: the cell's floor, as everywhere (scene/useRestDrop.ts).
  if (scaleExp !== 0) return REST_FLOOR * 2 ** scaleExp
  const k = `${plane}|${at.x},${at.y},${at.z}|${g.axis}${g.dir}`
  if (k === stepKept.key && now - stepKept.at <= FOOT_ITEMS_MS) return stepKept.drop
  const r = restDrop(at, plane, g)
  stepKept = { key: k, at: now, drop: r.drop }
  return r.drop
}

/** The step WALK's floor under the eased walker point (stepFloor): the walls near it, and what it lifted the point by at the last frame. */
const stepKeep = { key: '', at: -Infinity, items: [] as WallItem[], lift: 0, last: null as number | null, floorKey: '', floor: null as number | null }

/**
 * The step WALK's walker point, as the rig eases it from one gibson to the
 * next (scene/Scene.tsx Rig): how far, in gibsons along up, to lift it onto
 * the ground under its footprint, 0 when it is already on or above it
 * (arkinox, 2026-11-23: "I am dipping under the floor"). The rig eases the
 * point along a straight line toward the next standing place, which on a
 * hill's crown or over a stair's nosing runs
 * under the ground; and a walker point even a hair under the ground holds
 * the camera at the feet (store/walkWalls.ts eyeReach: inside a solid), so
 * the whole view dropped into the hill for those frames. `lead` is the eased
 * point, cyberspace gibsons from the middle of the cursor's gibson. The
 * ground is found the way fluid WALK finds it (groundUnder from the
 * cursor's middle, then footGround), at a gibson's zoom only. In a fall
 * the height is the fall's, which the rig follows exactly, but the way
 * across still lags, so a fall off a slope is lifted out of the slope behind
 * it too. A lift that comes on faster than RISE_FOLLOW_SPEED (a stair's
 * nosing), out of a fall, is followed by the camera over GLIDE_TAU_S, as
 * fluid WALK's riser is (lib/walkEye.ts walkRise). Display only: nothing
 * moves and nothing is published.
 */
export function stepFloor(lead: readonly [number, number, number], now: number = performance.now()): number {
  const dt = stepKeep.last === null ? 0 : Math.min(MAX_DT, Math.max(0, (now - stepKeep.last) / 1000))
  stepKeep.last = now
  const cs = useCyberspace.getState()
  if (!cs.walking || walkGlide.exact || cs.scaleExp !== 0) { stepKeep.lift = 0; return 0 }
  // In a fall the height is the fall's own (the rig follows it exactly), and only the eased way across lags it.
  const falling = fallState() !== null || walkFall.active
  const g = useWalk.getState().gravity ? walkDown() : WORLD_DOWN
  const up = upOf(g)
  const ui = AXIS_INDEX[up.axis]
  const k = `${cs.plane}|${cs.cursor.x},${cs.cursor.y},${cs.cursor.z}`
  if (k !== stepKeep.key || now - stepKeep.at > FOOT_ITEMS_MS) {
    stepKeep.items = wallItemsAt(cs.plane, cs.cursor)
    stepKeep.key = k
    stepKeep.at = now
    stepKeep.floorKey = ''
  }
  const height = lead[ui] * up.dir
  // Kept while the point across (to GROUND_QUANT gibsons), the walls and their down stay put: a walker
  // at rest asks nothing. Its height matters only to a search that starts under the middle (below).
  const low = height + 1 < 0
  const q = (v: number): number => Math.round(v / GROUND_QUANT)
  const fk = `${k}|${g.axis}${g.dir}|${ui === 0 ? '' : q(lead[0])},${ui === 1 ? '' : q(lead[1])},${ui === 2 ? '' : q(lead[2])}|${low ? q(height) : ''}`
  if (fk !== stepKeep.floorKey) {
    // Searched from the cursor's middle, which is clear: the eased point may be under the ground.
    const flat: [number, number, number] = [lead[0], lead[1], lead[2]]
    flat[ui] = 0
    const pending = { pending: false }
    let col = groundUnder(cs.cursor, flat, stepKeep.items, g, Number(STEP_UP_MAX), Number(STEP_DOWN_MAX + 1n), pending)
    // Far under the middle (a fall's last frame, drawn a little past the floor it reaches): searched from a gibson over the point.
    if (col === null && low) {
      flat[ui] = (height + 1) * up.dir
      col = groundUnder(cs.cursor, flat, stepKeep.items, g, Number(STEP_UP_MAX), Number(STEP_DOWN_MAX + 1n), pending)
    }
    stepKeep.floor = col === null ? null : footGround(cs.cursor, flat, col, stepKeep.items, g, pending)
    // A shard still being built is asked about again next frame.
    stepKeep.floorKey = pending.pending ? '' : fk
  }
  const floor = stepKeep.floor
  const lift = floor === null ? 0 : Math.max(0, floor - height)
  // A nosing met at once: the camera trails it up (walkRise), as fluid WALK's riser. The rig keeps
  // each lift in the eased point, so `lift` is this frame's rise alone, measured as fluid WALK measures one.
  const jump = lift - RISE_FOLLOW_SPEED * dt
  if (jump > 0 && !falling) {
    walkRise.offset -= jump
    walkRise.up.axis = up.axis
    walkRise.up.dir = up.dir
  }
  stepKeep.lift = lift
  return lift
}

/** The ground under the drawn point (groundUnder), kept while the anchor, the walls and the drawn point (to GROUND_QUANT gibsons) stay put. */
function groundAt(at: Position, lead: readonly [number, number, number], items: readonly WallItem[], g: AxisDirection, rise: number, drop: number, downKey: string): number | null {
  const q = (v: number): number => Math.round(v / GROUND_QUANT)
  const k = `${foot.itemsKey}|${at.x},${at.y},${at.z}|${downKey}|${rise}|${q(lead[0])},${q(lead[1])},${q(lead[2])}`
  if (k === foot.colKey) return foot.col
  const out = { pending: false }
  foot.col = groundUnder(at, lead, items, g, rise, drop, out)
  if (out.pending) foot.pending.pending = true
  foot.colKey = out.pending ? '' : k
  return foot.col
}

/**
 * The drawn point `lead` (cyberspace gibsons from the anchor's middle), which
 * the ground search could not reach by any lift (groundUnder's null), held
 * back toward the anchor, level, HOLD_MARGIN short of the first face the
 * level line at the feet's height, `height` gibsons up from the middle,
 * meets on its way out to it (store/walkWalls.ts clearShare). Fluid WALK
 * holds the smooth position short of a wall at the walker's middle
 * (FLUID_FACE_GAP), but the feet stand lower, where a steep slope's foot (a
 * culvert's side, a cliff's toe) leans further toward the walker: drawn the
 * whole way out, they were inside it, and the camera with them. `lead` is
 * moved and `pull` says by how much, cyberspace gibsons. True when it moved.
 */
function holdBack(at: Position, lead: [number, number, number], height: number, items: readonly WallItem[], g: AxisDirection, pull: [number, number, number]): boolean {
  const f = clearShare(at, lead, height, items, g, HOLD_MARGIN)
  if (!(f < 1)) return false
  const ui = AXIS_INDEX[upOf(g).axis]
  for (let q = 0; q < 3; q++) {
    if (q === ui) continue
    pull[q] += lead[q] * (1 - f)
    lead[q] *= f
  }
  return true
}

/** How far above the anchor's floor, beyond what a walkable slope rises out to the drawn point (FOOT_SLOPE), its ground must be before offWallSide asks whether it is a wall's side, in gibsons. */
const STEEP_RISE = 1 / 16

/** How many halvings offWallSide makes to find where the ground stops being a wall's side: to a 64th of the way. */
const OFF_WALL_STEPS = 6

/**
 * The drawn point `lead` stood on `col`, `under` being the anchor's floor:
 * when `col` is the side of a wall (store/walkWalls.ts steepGround), which the
 * ground search's lifts climb onto beside a steep face, the point is drawn
 * nearer the anchor, as far out as it still stands on ground, found to a
 * 64th of the way (OFF_WALL_STEPS), so it slides along the wall's foot
 * rather than jumping (`lead` and `pull` updated); the ground there comes
 * back. The anchor's own middle (none of the way) always stands.
 */
function offWallSide(at: Position, lead: [number, number, number], col: number, under: number, items: readonly WallItem[], g: AxisDirection, rise: number, drop: number, pull: [number, number, number]): number | null {
  if (!steepGround(at, lead, col, items, g)) return col
  const ui = AXIS_INDEX[upOf(g).axis]
  const was: [number, number, number] = [lead[0], lead[1], lead[2]]
  const groundAtShare = (f: number): number | null => {
    for (let q = 0; q < 3; q++) if (q !== ui) lead[q] = was[q] * f
    return groundUnder(at, lead, items, g, rise, drop)
  }
  const stands = (gr: number | null): boolean => gr !== null && (gr <= under + STEEP_RISE || !steepGround(at, lead, gr, items, g))
  let lo = 0, hi = 1
  let ground = groundAtShare(0)
  for (let n = 0; n < OFF_WALL_STEPS; n++) {
    const mid = (lo + hi) / 2
    const gr = groundAtShare(mid)
    if (stands(gr)) { lo = mid; ground = gr } else hi = mid
  }
  groundAtShare(lo)
  // A side all but upright is edge-on to the ground search's line down, which finds the floor under its foot:
  // the point is held short of the side at the floor's height too (holdBack's line), and the ground found again.
  const f = clearShare(at, lead, under, items, g, HOLD_MARGIN)
  if (f < 1) ground = groundAtShare(lo * f)
  for (let q = 0; q < 3; q++) if (q !== ui) pull[q] += was[q] - lead[q]
  return ground
}

/** How far short of a face holdBack holds the drawn point, in gibsons. */
const HOLD_MARGIN = 1 / 32

/** The ground under the footprint at the drawn point (store/walkWalls.ts footGround), kept while the anchor, the walls, the drawn point and the ground under it stay put. */
function footAt(at: Position, lead: readonly [number, number, number], ground: number, items: readonly WallItem[], g: AxisDirection, downKey: string): number {
  const q = (v: number): number => Math.round(v / GROUND_QUANT)
  const k = `${foot.itemsKey}|${at.x},${at.y},${at.z}|${downKey}|${q(lead[0])},${q(lead[1])},${q(lead[2])}|${q(ground)}`
  if (k === foot.printKey) return foot.print
  const out = { pending: false }
  foot.print = footGround(at, lead, ground, items, g, out)
  // A shard still being built is asked about again next frame.
  foot.printKey = out.pending ? '' : k
  return foot.print
}

/** How finely groundAt's key tells one drawn point from another, in gibsons: far under a pixel. */
const GROUND_QUANT = 1 / 4096

const AXIS_INDEX: Record<AxisName, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

/** The walls near the walker at `at`, listed again every FOOT_ITEMS_MS or on a new gibson. */
function itemsNear(plane: number, at: Position, now: number): WallItem[] {
  const k = `${plane}|${at.x},${at.y},${at.z}`
  if (k !== foot.itemsKey || now - foot.itemsAt > FOOT_ITEMS_MS) {
    foot.items = wallItemsAt(plane, at)
    foot.itemsKey = k
    foot.itemsAt = now
    foot.underKey = ''
    foot.colKey = ''
    foot.printKey = ''
  }
  return foot.items
}

/** The surface under the anchor's own middle (groundUnder), kept until the anchor, its gravity or its walls change; never kept while a wall is on its way. */
function underAnchor(at: Position, items: readonly WallItem[], g: AxisDirection, rise: number, drop: number, downKey: string): number | null {
  const k = `${foot.itemsKey}|${at.x},${at.y},${at.z}|${downKey}|${rise}`
  if (k === foot.underKey) return foot.under
  foot.under = groundUnder(at, [0, 0, 0], items, g, rise, drop, foot.pending)
  foot.underKey = foot.pending.pending ? '' : k
  return foot.under
}

/** The axes across each gravity axis, and so the ones a diagonal may use: kept, so a frame allocates no list. */
const LEVEL: Record<AxisName, readonly AxisName[]> = { x: ['y', 'z'], y: ['x', 'z'], z: ['x', 'y'] }

/** One step of the walk's motion, `dt` seconds: the speed, the smooth position, what holds it, and the crossings due. */
function substep(dt: number, now: number, wish: Vec, gravity: boolean, g: AxisDirection, level: readonly AxisName[], length: bigint): void {
  const falling = fallState() !== null
  // Events ahead of the chain (store/walkAhead.ts): with the parked
  // slowdown on (store/walkLimits.ts SYNC_SLOWDOWN_ON) the speed eases from
  // FLUID_EASE_FROM to its slowest at FLUID_HOLD_AT; off (as now), and with
  // the sync limit off in Settings, it is 1.
  const factor = walkSpeedFactor(eventsAhead())
  const max = FLUID_MAX_SPEED * factor
  if (falling) accelerate(st.v, wish, max, FLUID_AIR_ACCEL, FLUID_AIR_DECEL, dt)
  else accelerate(st.v, wish, max, FLUID_ACCEL, FLUID_DECEL, dt)
  if (gravity) st.v[g.axis] = 0
  for (const a of AXES) st.frac[a] += st.v[a] * dt

  // A drift off the way you push (under 22.5 degrees of it), or a coast with
  // nothing held, never walks off a ledge.
  const w = len(wish)
  const edgeSafe = (a: AxisName): boolean => gravity && !falling && (w <= 1e-9 || Math.abs(wish[a]) < DRIFT * w)
  // In the air the height changes under a held face: asked again as often as a held key pressed.
  const recheck = falling ? AIR_RECHECK_MS : RECHECK_MS

  // Heading out of the middle along an axis not yet asked from this anchor:
  // ask now whether the next gibson that way can be entered, so a wall is
  // met at its face (the eye slows to it) instead of passed and put back. A
  // step a wall cuts short (a coarse zoom) is a wall too.
  for (const a of AXES) {
    if (Math.abs(st.frac[a]) < PROBE_FROM || st.frac[a] * st.v[a] <= 0) continue
    const dir: 1 | -1 = st.frac[a] > 0 ? 1 : -1
    const k = key(a, dir)
    if (st.held.has(k) || st.open.has(k)) continue
    const res = fluidCross({ axis: a, dir }, null, edgeSafe(a), true)
    if (res.kind === 'moved' && whole(res, a, length)) st.open.add(k)
    else if (res.kind === 'moved') holdAt({ axis: a, dir }, wallLimit({ axis: a, dir }, length), now, false)
    else if (res.kind === 'held') holdAt({ axis: a, dir }, res.by ? wallLimit({ axis: a, dir }, length) : FLUID_EDGE_REACH, now, !res.by)
  }

  // Faces and edges already known to hold: the smooth position stays inside, and the speed into them stops.
  for (const a of AXES) {
    if (st.frac[a] === 0) continue
    const dir: 1 | -1 = st.frac[a] > 0 ? 1 : -1
    const h = st.held.get(key(a, dir))
    if (!h) continue
    // An edge held only a drift: turned to walk that way on purpose, it lets go.
    if (h.edge && !edgeSafe(a)) { st.held.delete(key(a, dir)); continue }
    if (Math.abs(st.frac[a]) <= h.limit) continue
    // Pushing on it a while: asked again where it stands (a door opened, a
    // wall went, the arc rose over it), so the eye never drifts off the face
    // and back. Not while the walk waits for the chain.
    if (factor > 0 && now - h.at >= recheck && st.v[a] * dir > 0) {
      const res = fluidCross({ axis: a, dir }, null, edgeSafe(a))
      if (res.kind === 'moved') { moved(res, { axis: a, dir }, null, length, falling ? g.axis : null); continue }
      h.at = now
    }
    st.frac[a] = dir * h.limit
    if (st.v[a] * dir > 0) st.v[a] = 0
  }

  // The crossings due, a few at most.
  for (let n = 0; n < 4; n++) {
    const due = dueCrossing(st.frac, st.v, level)
    if (!due) break
    const { main, side } = due
    // Stopped: no new gibson. The slowdown never stops now (its slowest is
    // FLUID_SLOWEST, and the fluid pause at FLUID_PAUSE_AT took the stop's
    // place), so this holds only if a factor of 0 ever comes back.
    if (factor === 0) { holdEdges(); break }
    // Fluid paused itself on the last crossing (FLUID_PAUSE_AT): no more.
    if (!fluidOn()) break
    const known = st.held.get(key(main.axis, main.dir))
    if (known && now - known.at < recheck) { holdAt(main, known.limit, known.at, known.edge); continue }
    const res = fluidCross(main, side, edgeSafe(main.axis))
    fluidCounts[res.kind]++
    if (res.kind === 'moved') { moved(res, main, side, length, falling ? g.axis : null); continue }
    if (res.kind === 'wait') { holdEdges(); break }
    // Held: by a wall, measured to its face; by the edge safety, near the edge.
    holdAt(main, res.by ? wallLimit(main, length) : FLUID_EDGE_REACH, now, !res.by)
  }
}

/** Whether a step went its whole length along `a`. */
function whole(res: { from: Position; to: Position }, a: AxisName, length: bigint): boolean {
  const d = res.to[a] - res.from[a]
  return d === length || d === -length
}

/** What is held now (or a tap's nudge), as the way to go. */
function wishNow(now: number, gravity: boolean, g: AxisDirection): Vec {
  if (!walkInputOpen()) return zero()
  let d = heldNow()
  const pushes = (x: { fwd: number; strafe: number; vert: number }): boolean => x.fwd !== 0 || x.strafe !== 0 || (!gravity && x.vert !== 0)
  if (!pushes(d) && now < fluidNudge.until) d = { fwd: sgn(fluidNudge.fwd), strafe: sgn(fluidNudge.strafe), vert: sgn(fluidNudge.vert), view: fluidNudge.view }
  if (!pushes(d)) return zero()
  const cs = useCyberspace.getState()
  const axes = cs.screenAxes ?? cs.axes()
  const up: AxisName = gravity ? g.axis : axes.up.axis
  // Gravity off, Space and C push along the view's up (against walkDown,
  // which follows the view whether gravity is on or not), R and F the
  // camera's (lib/walkKeys.ts).
  const vertical = gravity ? null : verticalAlong('up', d.view === true, axes, walkDown())
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
  // In the air, measured at the height the eye is at, not where the hop began.
  const from = fall && walkFall.active ? raised(cs.cursor, fall.down, BigInt(Math.round(walkFall.offset))) : cs.cursor
  const face = faceDistance(from, d.axis, d.dir, items, length)
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
function moved(res: { from: Position; to: Position }, main: AxisDirection, side: AxisDirection | null, length: bigint, fallAxis: AxisName | null): void {
  const d = stepsBetween(res.to, res.from, length)
  for (const a of AXES) {
    // In the air the height is the fall's own eye (walkFall), never a glide.
    if (d[a] === 0 || a === fallAxis) continue
    if (a === main.axis || (side && a === side.axis)) st.frac[a] -= d[a]
    else st.glide[a] -= d[a]
  }
  st.anchor = { ...useCyberspace.getState().cursor }
  clearAsked()
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

/** Forget what was asked from the old anchor. */
function clearAsked(): void {
  st.held.clear()
  st.open.clear()
}

function same(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

// The switch turned while walking, by hand or by the fluid pause: the open
// segment closes (a step WALK press would grow it by heading, a fluid
// crossing by line, and the two must not share one), and the smooth
// position glides onto its anchor.
useFluidWalk.subscribe((s, prev) => {
  if ((s.on && !s.paused) !== (prev.on && !prev.paused) && useCyberspace.getState().walking) useWalk.getState().settle()
})

// The fluid pause (store/fluidSwitch.ts fluidPauseCheck) goes by the events
// ahead: asked whenever the walk's store changes (a move made, a proof
// landed, the queue dropped), whenever the sync limit is switched, and every
// frame in tickFluid. An identity switch forgets a pause: the walk stops
// with it, and the next identity's walk starts from the saved choice.
useWalk.subscribe((s) => { fluidPauseCheck(aheadOfState(s), walkLimitsOn(), performance.now(), useCyberspace.getState().walking) })
useLayers.subscribe((s, prev) => { if (s.walkLimits !== prev.walkLimits) fluidPauseCheck(eventsAhead(), s.walkLimits, performance.now(), useCyberspace.getState().walking) })
useCyberspace.subscribe((s, prev) => {
  if (s.identity.pubkey !== prev.identity.pubkey) clearFluidPause()
  // Into or out of WALK: a "back on" from the walk before is not this walk's
  // (leaving WALK drops the queue, which ends a pause before WALK is off).
  else if (s.walking !== prev.walking && useFluidWalk.getState().resumedAt !== 0) useFluidWalk.setState({ resumedAt: 0 })
})

// DEV window handle, the house pattern: fluid WALK's state for the headless recording.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __fluid?: unknown }).__fluid = fluidState
}
