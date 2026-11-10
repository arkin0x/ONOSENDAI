/**
 * useWalk.ts: WALK, the pad's third mode (arkinox, 2026-10-13).
 *
 * HOP plans a move and commits it; VIEW looks around without moving; WALK
 * moves on every press. A direction in WALK commits one step of the zoom
 * (2^scaleExp gibsons) that way at once, and the view goes there before the
 * proof does: the cursor, which the camera and your avatar follow in WALK, is
 * set to where the step will land, so the press feels like a step and not
 * like a wait.
 *
 * Presses in one direction make one move, not one each (arkinox,
 * 2026-10-13). While you keep walking the same way, each press extends one
 * open segment and the view goes to its new end at once; the segment closes,
 * and is queued to be proved, when you turn, when you have been still for
 * WALK_SETTLE_MS, or when one more step would make it cost more than about
 * WALK_SEGMENT_BUDGET_MS of this machine's compute (segmentAffordable). A
 * hop's cost is path-independent (the per-axis LCA of its two ends), so the
 * one straight hop is never dearer than the steps it replaces, and a long
 * straight walk is a few hops instead of a proof per press.
 *
 * Closed segments queue. Each is proved from where the one before it landed,
 * in order, through the store's own commit (walkTo), so a WALK move is
 * checked, signed and published exactly like a COMMIT. One past this
 * machine's ceiling runs as its route (hops to the wall, the sidestep, hops
 * on), still as one move.
 *
 * The walk stops, all of it, the moment a step does not land: refused,
 * infeasible, a signature declined, a step only HOSAKA could sell (a walk
 * never pays on its own), or STOP. What is queued is dropped and the cursor
 * comes back to where you really stand, so the view eases back with it.
 * Steps already signed stay on the chain: they are real moves.
 *
 * A shard can hold the walk (DECK-0003 §1.12, store/walkWalls.ts): a press
 * whose step would cross a face of a shard set to constrain WALK stops short
 * of the face (one gibson short at a fine zoom, at least the measure's error
 * at a coarse one), or, with no room left, does not step at all. Only a press asks; HOP, VIEW and BUILD never do, and nothing about
 * a move that is proved or signed changes.
 *
 * Standing on such a shard, a level press climbs a riser of up to 2
 * gibsons and settles onto a floor up to 2 below (store/walkStep.ts, arkinox
 * 2026-10-23), so a stair is one press per gibson forward. The segment is
 * then one heading that rises and falls, still published as one straight
 * hop: a flight of stairs is one event instead of one per turn, at the same
 * work per axis (spec §4.8). Off a floor, nothing changes: this is not gravity.
 *
 * Forward and backward go the way you face, snapped to 8 directions
 * (arkinox, RULED 2026-11-03; lib/walkSlide.ts, where the whole decision
 * is): near 45 degrees a press is one diagonal step, both axes in one hop,
 * allowed only when both side cells are open; blocked ahead while angled to
 * a side, it slides one step along the wall to that side. Each piece is a
 * walkStep, so stairs, walls and gravity hold exactly as for a straight step.
 * A diagonal heading is one segment like any other: a run of diagonal steps
 * is one hop, and a run of slides along one wall is one hop.
 *
 * GRAVITY (arkinox, rulings of 2026-10-24; store/walkGravity.ts): off by
 * default and kept on this device, switched by Z, the pad's GRAVITY chip or
 * the View panel. With it on, down is cyberspace -Y:
 *
 * | What happens | What the chain gets |
 * |---|---|
 * | a press walks you off a floor (higher than a step-down) | that press's segment closes where you step off, a normal hop, proved now; the fall starts there |
 * | the fall | nothing: an animation on this device at WALK_GRAVITY, with the geometry the walls knew when it began |
 * | (A) it lands on a floor that holds you | one hop, from where it left off to the landing |
 * | (B) a press moves you in mid-air | one hop to that mid-air point; the fall goes on from there |
 * | (C) it reaches the last gibson a hop can afford | one hop there, and you hover |
 * | (D) gravity goes off mid-fall | one hop to where you are, and you float |
 * | Up (Space, R, the pad's up) standing | a jump of 3: back where it left, nothing; anywhere else, as a fall |
 * | Down, or Up off a floor | nothing: no flying |
 * | (E) a landing on a face with `bounce` (EXPERIMENTAL, lib/walkBounce.ts) | the landing's hop, as (A), only when it is somewhere new; the launch is the next arc of the same fall, so bouncing in place makes nothing |
 * | (E) a step up onto a fixed-height bounce pad | the step's segment closes there, a normal hop, and the launch is a jump from it: bouncing back onto the pad makes nothing more. A "reflect" pad does nothing on a step up: it fell from nowhere |
 *
 * The hops a fall makes are queued only when it resolves (A, C or D) or
 * bounces somewhere new (E), so none is proved or published while you are
 * still falling, and a reload or a STOP mid-fall leaves you where the chain
 * is, the step-off point once its hop has landed. Gravity off, a press is exactly what it was.
 *
 * Under gravity a floor in your own plane holds you: a HOP, a VIEW, a BUILD
 * or a floor deployed at your height can leave you exactly on one, and a fall
 * can come to rest on one at the height it is passing (a WALK stop never
 * ends there). You stand on it instead of falling through it when the space
 * just above you is open: a single-plane floor or the top of a solid, never
 * the underside of a solid, from under which you fall away (arkinox,
 * 2026-10-25: floors only). It is how the walls are asked (store/walkWalls.ts
 * stepLimit, `stand`): nothing moves and nothing is published for it.
 *
 * `behind` is the walk's lag: the closed segments not yet proven, the one
 * computing included, and never the open one, which is still being walked.
 * It is what the LOSING SYNC warning counts, so the warning comes up only for
 * turns made faster than they can be proved. Leaving WALK or STOP drops the
 * open segment with the queue.
 */

import { create } from 'zustand'
import { estimateHopCost } from 'cyberspace-core'
import { HOP_AXIS_BUDGET_MS, projectCantorMs, recommendedHopHeight, useCalibration } from '../lib/calibration'
import { moveDirection, type MoveName } from '../lib/moves'
import { clampAxis, levelQuaternion, stepFor, type AxisDirection, type AxisName, type Position } from '../lib/space'
import { keepWalkLook } from '../lib/walkLook'
import { MAX_COMPUTE_HEIGHT, samePosition, useCyberspace } from './useCyberspace'
import { BRIEF_TOAST_MS, useToast } from './useToast'
import { standing, walkStep, type WalkStep } from './walkStep'
import { planWalkMove, walkHeading } from '../lib/walkSlide'
import { floorBounce, stepLimit, takeWallWait, wallItemsAt, wallsBuilt, warmWalls, type WallItem } from './walkWalls'
import { JUMP_HEIGHT, JUMP_SPEED, WALK_GRAVITY, arcApex, arcHeight, arcPeak, arcSpeed, fallLimit, jumpRise, launchSpeed, loadGravity, reachedHeight, saveGravity } from './walkGravity'
import { launchHeight } from '../lib/walkBounce'
import { walkFacing, walkFall } from '../lib/walkEye'

/** What the LOSING SYNC warning waits for: this many moves not yet proven. */
export const SYNC_WARN_AT = 3

/** Still this long, in ms, and the open segment closes and goes to be proved. */
export const WALK_SETTLE_MS = 600

/**
 * The most one segment may cost to prove, in ms of this machine's compute: a
 * fifth of the budget the hop ceiling is measured against (lib/calibration.ts
 * HOP_AXIS_BUDGET_MS), about a second. Past it the segment closes and the
 * next press starts another, so a long straight walk at a large scale never
 * waits on one huge proof.
 */
export const WALK_SEGMENT_BUDGET_MS = HOP_AXIS_BUDGET_MS / 5

/** The open segment: still being walked, not yet queued. */
export interface WalkSegment {
  /** Its heading. A level heading may rise and fall as it climbs or settles (store/walkStep.ts). */
  axis: AxisName
  dir: 1 | -1
  /** A diagonal heading's second axis (lib/walkSlide.ts): each step changes both, and the segment is still one hop. */
  side?: AxisDirection
  /** Where it starts: the end of the move before it, or your head. */
  from: Position
  /** Where it ends now: the view is here. */
  end: Position
}

/**
 * Whether a straight hop from `from` to `to` costs no more than
 * WALK_SEGMENT_BUDGET_MS here. A proof computes a Cantor tree for every axis
 * the hop changes, at that axis's LCA of the two ends, so the cost is their
 * sum: one tree for a level step, two for a diagonal (review of #594), and
 * the rise's too on a stair. Measured times project each tree when
 * calibration has run, and before that each height is taken to double the
 * time of the one under it from the conservative hop ceiling.
 */
export function segmentAffordable(from: Position, to: Position, plane: number): boolean {
  const est = estimateHopCost(from.x, from.y, from.z, to.x, to.y, to.z, plane as 0 | 1, MAX_COMPUTE_HEIGHT)
  const lca: Record<AxisName, number> = { x: est.lcaX, y: est.lcaY, z: est.lcaZ }
  const heights = (['x', 'y', 'z'] as const).filter((a) => from[a] !== to[a]).map((a) => lca[a])
  if (heights.length === 0) return true
  const measured = useCalibration.getState().cantorMsByHeight
  if (measured && Object.keys(measured).length > 0) {
    const ms = heights.reduce((sum, h) => sum + projectCantorMs(measured, h), 0)
    if (Number.isFinite(ms)) return ms <= WALK_SEGMENT_BUDGET_MS
  }
  return Math.log2(heights.reduce((sum, h) => sum + 2 ** h, 0)) <= recommendedHopHeight() - Math.log2(HOP_AXIS_BUDGET_MS / WALK_SEGMENT_BUDGET_MS)
}

/**
 * Whether a step keeps to the open segment's heading: the same axis the same
 * way, and for a diagonal the same two axes, in either order (review of
 * #594: facing 50 and then 40 is one diagonal, and one hop).
 */
function sameHeading(open: WalkSegment, along: AxisDirection, side: AxisDirection | null): boolean {
  const same = (a: AxisDirection, b: AxisDirection): boolean => a.axis === b.axis && a.dir === b.dir
  const was = { axis: open.axis, dir: open.dir }
  if (!open.side || !side) return !open.side && !side && same(was, along)
  return (same(was, along) && same(open.side, side)) || (same(was, side) && same(open.side, along))
}

/** The stillness timer that closes the open segment. */
let settleTimer: ReturnType<typeof setTimeout> | null = null
function clearSettle(): void {
  if (settleTimer !== null) clearTimeout(settleTimer)
  settleTimer = null
}

interface WalkState {
  /** Closed segments not yet landed, by their ends, oldest first. The first is the one in flight. */
  queue: Position[]
  /** The segment still being walked, or null. */
  open: WalkSegment | null
  /** The step handed to the store, until it lands or the walk stops. */
  running: Position | null
  /** Closed segments not yet proven, the one in flight included. */
  behind: number
  /** GRAVITY in WALK, kept on this device (store/walkGravity.ts). Off by default. */
  gravity: boolean
  /** A fall or a jump is in the air: its hops are made when it resolves. */
  falling: boolean
  /** GRAVITY on or off. Off mid-fall ends the fall where it is (one hop there). */
  setGravity: (on: boolean) => void
  /** Turn WALK on. Only at your own head; a VIEW in progress ends first. */
  enter: () => void
  /** Stop the walk and go back to HOP. */
  exit: () => void
  /** Stop the walk where the chain is now, and stay in WALK. */
  stop: (message?: string | null) => void
  /**
   * A direction press: one step that way, shown at once, added to the open
   * segment or starting one. Forward and backward go the way you face,
   * diagonally or sliding along a wall (lib/walkSlide.ts); `strafe` is a
   * side key held with them (+1 right, -1 left).
   */
  press: (name: MoveName, strafe?: -1 | 0 | 1) => void
  /** Close the open segment and queue it to be proved (stillness, a turn, the cost cap). */
  settle: () => void
}

/** Something of the store's is still working on a move: a proof, a route, a cloud job. */
function moveBusy(): boolean {
  const s = useCyberspace.getState()
  return s.proof.status === 'computing' || s.plan?.status === 'running' || s.cloud.status !== 'idle'
}

export const useWalk = create<WalkState>((set, get) => ({
  queue: [],
  open: null,
  running: null,
  behind: 0,
  gravity: loadGravity(),
  falling: false,

  setGravity: (on) => {
    if (get().gravity === on) return
    saveGravity(on)
    set({ gravity: on })
    if (!useCyberspace.getState().walking) return
    useToast.getState().show({ label: 'GRAVITY', meta: on ? 'ON' : 'OFF', mark: 'walk', ms: BRIEF_TOAST_MS })
    // (D): the fall ends where it is, one hop there.
    if (!on) { if (fall) endFall(reachedPoint(fall, nowMs())); return }
    levelView()
    fallIfAirborne()
  },

  enter: () => {
    const cs = useCyberspace.getState()
    if (cs.walking) return
    forgetWaitingMove()
    // VIEW is a focus, and WALK is taken from your head: the view ends first,
    // which brings the cursor home. The zoom stays as it is (arkinox,
    // 2026-11-02: entering WALK must not reset the zoom to 2^0); without
    // keepScale it went back to the one VIEW began at.
    if (cs.viewing()) cs.clearFocus(true)
    if (!useCyberspace.getState().atHead()) return
    const { position } = useCyberspace.getState()
    useCyberspace.setState({ walking: true, cursor: { ...position } })
    // The shards' walls, and the objects they place, ready before the first step.
    warmWalls(useCyberspace.getState().plane, useCyberspace.getState().position)
    clearSettle()
    dropFall()
    set({ queue: [], open: null, running: null, behind: 0 })
    if (get().gravity) { levelView(); fallIfAirborne() }
  },

  exit: () => {
    if (!useCyberspace.getState().walking) return
    forgetWaitingMove()
    get().stop()
    useCyberspace.setState({ walking: false })
  },

  stop: (message = null) => {
    const cs = useCyberspace.getState()
    clearSettle()
    // A fall not yet resolved has made nothing: it goes with the queue.
    dropFall()
    set({ queue: [], open: null, running: null, behind: 0 })
    // Whatever is in flight goes too: a proof is killed, a route abandoned,
    // a cloud flow ended the way X ends it (cancel). What was signed stays.
    if (moveBusy() || cs.plan) cs.cancel()
    const now = useCyberspace.getState()
    useCyberspace.setState({
      cursor: { ...now.position },
      pendingTarget: null,
      ...(message ? { proof: { ...now.proof, status: 'infeasible' as const, message } } : {}),
    })
    // The reason on screen, not only in the menu's proof panel: on a phone
    // that panel is behind the menu, and a walk that stops for no visible
    // reason reads as the pad breaking. A STOP of your own has no message
    // and needs no word.
    if (message) useToast.getState().show({ label: 'WALK STOPPED', meta: message, mark: 'walk', ms: BRIEF_TOAST_MS * 2 })
  },

  press: (name, strafe = 0) => {
    const cs = useCyberspace.getState()
    if (!cs.walking || !cs.atHead()) return
    // A press waiting for walls on their way (waitedForWalls) goes first; a
    // held key's repeats meanwhile are not stacked behind it.
    if (againWhenBuilt) return
    const axes = cs.screenAxes ?? cs.axes()
    const dir = moveDirection(axes, name)
    const gravity = get().gravity
    // In the air: a level press is a move in mid-air (B); up and down do
    // nothing, except that Up just before landing on a bounce adds a jump (E).
    if (fall) {
      if (dir.axis !== 'y') airPress(fall, dir.axis, dir.dir > 0 ? 1 : -1)
      else if (dir.dir > 0) upInAirAt = nowMs()
      return
    }
    const { queue, open } = get()
    const from = open?.end ?? queue[queue.length - 1] ?? cs.position
    // Under gravity Up is a jump, and Down does nothing: no flying.
    if (gravity && dir.axis === 'y') { if (dir.dir > 0) jump(from); return }
    // Forward and backward go the way you face, snapped to 8 directions: a
    // diagonal, or a slide along a wall you are angled into (lib/walkSlide.ts).
    // With no facing to go by, the screen's axis, as always.
    const heading = walkFacing.valid && (name === 'away' || name === 'toward')
      ? walkHeading(walkFacing.forward, walkFacing.right, axes.up.axis, name === 'away' ? 1 : -1, strafe)
      : null
    const length = stepFor(cs.scaleExp)
    const items = wallItemsAt(cs.plane, from)
    // A shard that constrains WALK (DECK-0003 §1.12, store/walkWalls.ts):
    // the step stops short of its face (a gibson short at a fine zoom), or does not go.
    // Standing on such a shard, a level step also climbs what is in its way
    // (2 gibsons at most) and settles onto a floor up to 2 below (store/walkStep.ts).
    // Against the axis wall: nowhere to step.
    const stepAlong = (at: Position, axis: AxisName, sign: 1 | -1, want: bigint): WalkStep => {
      const edge = clampAxis(at[axis] + want * BigInt(sign))
      const n = sign > 0 ? edge - at[axis] : at[axis] - edge
      return n === 0n ? { to: at, by: null } : walkStep(at, axis, sign, n, items, gravity)
    }
    takeWallWait()
    // Under gravity a diagonal also needs both side cells to hold you (lib/walkSlide.ts).
    const stands = gravity ? (at: Position): boolean => standing(at, items, true) : undefined
    const move = planWalkMove(from, heading ?? { main: dir, side: null, lean: null }, length, stepAlong, { stands })
    if (waitedForWalls(() => get().press(name, strafe))) return
    if (move.by) wallChip(move.by)
    if (!move.along || samePosition(move.to, from)) return
    const next: Position = { ...move.to }
    const sign = move.along.dir
    const side = move.side
    // A segment is one heading: a step up or down a stair keeps it open, so
    // a flight is one hop (the same work per axis as its steps, in fewer
    // events). A diagonal heading is two axes, still one hop; a slide along a
    // wall is a heading of its own, so a long slide is one hop too.
    if (open && sameHeading(open, move.along, side) && segmentAffordable(open.from, next, cs.plane)) {
      // On the same way: the open segment grows.
      set({ open: { ...open, end: next } })
    } else {
      // A turn, or one step more than a segment may cost: the open one goes to
      // be proved and this step starts the next.
      if (open) closeOpen()
      set({ open: { axis: move.along.axis, dir: sign, ...(side ? { side } : {}), from, end: next } })
      if (open) pump()
    }
    // The view and the avatar go now; the proof catches up.
    useCyberspace.setState({ cursor: { ...next } })
    clearSettle()
    settleTimer = setTimeout(() => { settleTimer = null; get().settle() }, WALK_SETTLE_MS)
    // Off a floor under gravity: this segment ends here, and the fall begins.
    if (gravity) fallIfAirborne()
    // Stepped up onto a fixed bounce pad: launched as if it had landed there (E).
    if (gravity && !fall && next.y > from.y) stepLaunch(next)
  },

  settle: () => {
    clearSettle()
    if (!get().open) return
    closeOpen()
    pump()
  },
}))

/**
 * A move that met a shard whose walls are on their way (store/walkWalls.ts
 * stepLimit: a step that could enter a shard still waiting for its first
 * build waits for it), made again as soon as they are built, which is within
 * the task for what a shard carries. One at a time.
 */
let againWhenBuilt: (() => void) | null = null
/** Let go of a move waiting for walls: WALK ends or begins, and an old press is never made in a new WALK. */
function forgetWaitingMove(): void {
  againWhenBuilt = null
}
function waitedForWalls(again: () => void): boolean {
  if (!takeWallWait()) return false
  if (!againWhenBuilt) {
    againWhenBuilt = again
    // Only this wait's own move: one let go (forgetWaitingMove) and replaced by a newer is not this one's to make.
    const mine = again
    void wallsBuilt().then(() => {
      if (againWhenBuilt !== mine) return
      againWhenBuilt = null
      if (useCyberspace.getState().walking) mine()
    })
  }
  return true
}

/** The open segment onto the queue. */
function closeOpen(): void {
  const { open, queue } = useWalk.getState()
  if (!open) return
  const next = [...queue, open.end]
  useWalk.setState({ open: null, queue: next, behind: next.length })
}

/** The WALL chip, one per wall: a held key's repeats do not churn the one toast slot. */
function wallChip(by: WallItem): void {
  const shown = useToast.getState().toast
  if (!(shown?.label === 'WALL' && shown.meta === by.shard.name)) useToast.getState().show({ label: 'WALL', meta: by.shard.name, mark: 'walk', ms: BRIEF_TOAST_MS })
}

// ---------------------------------------------------------------------------
// GRAVITY: the fall (store/walkGravity.ts).

/**
 * A fall, or a jump, in the air. Module state, like the walls: it is read
 * every frame, and only its start and its end are the store's (`falling`).
 * Heights are whole gibsons from y0, where the arc started.
 */
interface Fall {
  /** Where the hop being fallen starts: the step-off point, the jump's floor, or the last mid-air move. */
  anchor: Position
  /** Mid-air moves so far (B), in order: one hop each, made when the fall resolves. */
  waypoints: Position[]
  /** The arc: from y0 at t0 (ms), upward at v0 gibsons/s, down at WALK_GRAVITY. */
  y0: bigint
  t0: number
  v0: number
  /** Its ceiling, and where it comes to rest: a floor (lands) or the last gibson a hop can afford. */
  top: bigint
  bottom: bigint
  lands: boolean
  /** The highest whole gibson it rises to. */
  peak: number
  /** top, bottom, and the anchor's height above y0, as numbers: what a frame reads, so it does no bigint arithmetic. */
  topN: number
  bottomN: number
  base: number
  /** Seconds into the arc when `top` was set: a ceiling is met no earlier than that. */
  topSince: number
  /** The last mid-air press's heading and where its hop starts: a press the same way after it grows that hop. */
  air: { axis: AxisName; dir: 1 | -1; from: Position } | null
  /** The walls known when it began: the only geometry it meets. */
  items: WallItem[]
  plane: number
}

/** Keep a fall's numbers in step with its bigints. */
function syncFall(f: Fall): void {
  f.topN = Number(f.top)
  f.bottomN = Number(f.bottom)
  f.base = Number(f.anchor.y - f.y0)
}

let fall: Fall | null = null

const nowMs = (): number => performance.now()

/** When Up was last pressed in the air (ms), or null: within BOUNCE_BOOST_MS of a bounce's landing it adds JUMP_HEIGHT. */
let upInAirAt: number | null = null

/**
 * How long before a bounce's landing an Up press in the air still counts as
 * jumping off it, in ms. The pad has no held state for Up (only WASD keyups
 * are tracked), so "holding jump as you land" is read as a press just before
 * it; a held key's repeats keep it fresh.
 */
export const BOUNCE_BOOST_MS = 250

/** The walk's segment budget in `plane`, as the fall asks it. */
function affordIn(plane: number): (from: Position, to: Position) => boolean {
  return (from, to) => segmentAffordable(from, to, plane)
}

/** The fall in the air, for tests and the DEV handle: read only. */
export function fallState(): Readonly<Fall> | null {
  return fall
}

/**
 * Start a fall or a jump from `from`. The segment that brought you here
 * closes where the fall begins: a normal hop, proved now, like any other.
 */
function beginFall(from: Position, v0: number, top: bigint, bottom: bigint, lands: boolean, items: WallItem[], plane: number): void {
  clearSettle()
  const hadOpen = useWalk.getState().open !== null
  if (hadOpen) closeOpen()
  fall = { anchor: { ...from }, waypoints: [], y0: from.y, t0: nowMs(), v0, top, bottom, lands, peak: arcPeak(v0, Number(top)), topN: 0, bottomN: 0, base: 0, topSince: 0, air: null, items, plane }
  syncFall(fall)
  walkFall.active = true
  walkFall.offset = 0
  useWalk.setState({ falling: true })
  useCyberspace.setState({ cursor: { ...from } })
  if (hadOpen) pump()
}

/** Under gravity, off a floor with somewhere to fall: the fall begins from the walk's end. */
function fallIfAirborne(): void {
  const cs = useCyberspace.getState()
  const walk = useWalk.getState()
  if (!cs.walking || fall || !walk.gravity) return
  const from = walk.open?.end ?? walk.queue[walk.queue.length - 1] ?? cs.position
  const items = wallItemsAt(cs.plane, from)
  takeWallWait()
  const stands = standing(from, items, true)
  const limit = stands ? null : fallLimit(from, items, affordIn(cs.plane))
  // A floor on its way: no fall through it; asked again once it is built.
  if (waitedForWalls(fallIfAirborne)) return
  if (stands || !limit) return
  // Hovering already: over a floor no hop from here can afford to reach.
  if (limit.drop === 0n) return
  beginFall(from, 0, 0n, -limit.drop, limit.lands, items, cs.plane)
}

/** Up under gravity: a jump of JUMP_HEIGHT from the floor you stand on, under any ceiling. Off a floor, nothing. */
function jump(from: Position): void {
  const cs = useCyberspace.getState()
  const items = wallItemsAt(cs.plane, from)
  takeWallWait()
  const stands = standing(from, items, true)
  if (waitedForWalls(() => jump(from))) return
  if (!stands) return
  const afford = affordIn(cs.plane)
  const { rise, by } = jumpRise(from, items, afford)
  if (rise === 0n) { if (by) wallChip(by); return }
  const limit = fallLimit(from, items, afford)
  if (waitedForWalls(() => jump(from))) return
  beginFall(from, JUMP_SPEED, rise, -limit.drop, limit.lands, items, cs.plane)
}

/**
 * (E) A press that stepped up onto `at` (the stair step-up, store/walkStep.ts)
 * and stands on a bounce pad there: launched as if it had landed on it
 * (ruling of 2026-11-10). A fixed height launches; "reflect" reflects a fall
 * of 0, which is no launch. The launch is a jump of that height from `at`, so
 * the segment that brought you here closes as a normal hop (beginFall) and
 * every bounce after it, back onto the same pad, makes nothing.
 */
function stepLaunch(at: Position): void {
  const cs = useCyberspace.getState()
  const items = wallItemsAt(cs.plane, at)
  takeWallWait()
  const h = launchHeight(floorBounce(at, items), 0, false, JUMP_HEIGHT)
  if (takeWallWait() || h === 0) return
  const afford = affordIn(cs.plane)
  const { rise } = jumpRise(at, items, afford, h)
  const limit = fallLimit(at, items, afford)
  if (takeWallWait() || rise === 0n) return
  beginFall(at, launchSpeed(h), rise, -limit.drop, limit.lands, items, cs.plane)
}

/**
 * A ceiling the arc has met by `now`: from the moment it met it, the arc
 * starts again there, at rest. Worked out from the arc itself, not from the
 * frames, so a long gap between frames never carries it past the ceiling.
 */
function meetCeiling(f: Fall, now: number): void {
  if (f.v0 <= 0 || arcApex(f.v0) <= f.topN) return
  // When the rise reaches the ceiling (v0 t - g t^2 / 2 = top), and never
  // before the ceiling was there: one met over a new column is met now.
  const hit = Math.max(f.topSince, (f.v0 - Math.sqrt(Math.max(0, f.v0 * f.v0 - 2 * WALK_GRAVITY * f.topN))) / WALK_GRAVITY)
  if ((now - f.t0) / 1000 < hit) return
  f.y0 += f.top
  f.bottom -= f.top
  f.top = 0n
  f.t0 += hit * 1000
  f.v0 = 0
  f.peak = 0
  f.topSince = 0
  syncFall(f)
}

/** The arc's height `now`, held between its ceiling and its rest, and whether it is still rising. */
function arcAt(f: Fall, now: number): { r: number; rising: boolean } {
  const t = Math.max(0, (now - f.t0) / 1000)
  const rising = arcSpeed(f.v0, t) > 0
  const r = arcHeight(f.v0, t)
  if (rising) return { r: Math.min(r, f.topN), rising }
  return { r: Math.max(r, f.bottomN), rising }
}

/** The whole gibson the fall has actually been at, `now`: never one it is yet to reach. */
function reachedPoint(f: Fall, now: number): Position {
  meetCeiling(f, now)
  const { r, rising } = arcAt(f, now)
  let y = f.y0 + BigInt(reachedHeight(r, rising, f.peak))
  if (y < f.y0 + f.bottom) y = f.y0 + f.bottom
  if (y > f.y0 + f.top) y = f.y0 + f.top
  return { ...f.anchor, y }
}

/**
 * One frame of the fall: where the eye is (walkFall.offset), a ceiling met,
 * and the landing or the last affordable gibson reached, which resolves it.
 * Called by the rig before it reads the cursor. Arithmetic only, so a frame
 * of a fall allocates nothing; it touches the store only when it resolves.
 * True while there was a fall to draw.
 */
export function tickFall(now: number = nowMs()): boolean {
  const f = fall
  if (!f) return false
  meetCeiling(f, now)
  const t = Math.max(0, (now - f.t0) / 1000)
  const r = Math.min(arcHeight(f.v0, t), f.topN)
  if (t > 0 && arcSpeed(f.v0, t) <= 0 && r <= f.bottomN) {
    // (E) on a floor that bounces: the fall goes on, launched.
    if (f.lands && bounceOff(f, now)) return true
    // (A) on the floor, or (C) at the last gibson a hop can afford.
    endFall({ ...f.anchor, y: f.y0 + f.bottom }, !f.lands)
    return true
  }
  walkFall.offset = r - f.base
  return true
}

/**
 * (E) BOUNCE, EXPERIMENTAL (lib/walkBounce.ts): the fall has come down on a
 * floor whose face has `bounce`. The landing is published exactly as (A)
 * would publish it, the hops of the fall so far, each only when it goes
 * somewhere, and then, instead of ending, the fall starts its next arc from
 * the landing, upward at launchSpeed of the launch height, under any ceiling
 * and no higher than a hop can afford, with the walls it already knew. A
 * bounce in place therefore lands where its arc left and makes nothing, like
 * a jump in place, however many times it bounces; leaving the pad in the air
 * (B) or switching gravity off (D) makes the hops, as for any fall.
 *
 * The arc restarts at the moment it reached the floor, worked out from the
 * arc and not the frame, so a frame's lateness never shortens the bounce.
 * False, and the fall lands as (A), when the face has no bounce, the launch
 * is under BOUNCE_MIN, a ceiling leaves no room, or a wall is still on its way.
 */
function bounceOff(f: Fall, now: number): boolean {
  const final: Position = { ...f.anchor, y: f.y0 + f.bottom }
  takeWallWait()
  const b = floorBounce(final, f.items)
  // How far the fall came down: its arc's top, under any ceiling, above the landing.
  const fell = Math.min(arcApex(f.v0), f.topN) - f.bottomN
  const boost = upInAirAt !== null && now - upInAirAt <= BOUNCE_BOOST_MS
  const h = launchHeight(b, fell, boost, JUMP_HEIGHT)
  if (h === 0) { takeWallWait(); return false }
  const afford = affordIn(f.plane)
  const { rise } = jumpRise(final, f.items, afford, h)
  const limit = fallLimit(final, f.items, afford)
  if (takeWallWait() || rise === 0n) return false
  upInAirAt = null
  // The hops so far, as (A) makes them: none when it came back to where its arc left.
  const hops = f.waypoints.slice()
  if (!samePosition(final, f.anchor)) hops.push({ ...final })
  // When the arc reached the floor: the descending root of v0 t - g t^2 / 2 = bottom.
  const v0 = launchSpeed(h)
  let t0 = f.t0 + ((f.v0 + Math.sqrt(f.v0 * f.v0 - 2 * WALK_GRAVITY * f.bottomN)) / WALK_GRAVITY) * 1000
  // A gap longer than the whole bounce (a hidden tab): it leaves now instead.
  if (!(now - t0 <= (2 * v0 / WALK_GRAVITY) * 1000)) t0 = now
  f.anchor = final
  f.waypoints = []
  f.y0 = final.y
  f.t0 = t0
  f.v0 = v0
  f.top = rise
  f.bottom = -limit.drop
  f.lands = limit.lands
  f.peak = arcPeak(v0, Number(rise))
  f.topSince = 0
  f.air = null
  syncFall(f)
  walkFall.offset = Math.min(arcHeight(v0, Math.max(0, (now - t0) / 1000)), f.topN) - f.base
  // In place the cursor is already here: a bounce in place touches no store.
  if (!samePosition(useCyberspace.getState().cursor, final)) useCyberspace.setState({ cursor: { ...final } })
  if (hops.length > 0) {
    const next = [...useWalk.getState().queue, ...hops]
    useWalk.setState({ queue: next, behind: next.length })
    pump()
  }
  return true
}

/**
 * (B) A level press in the air: one step from the whole gibson you have
 * been at, held by the walls as any step is. That point is a hop of its own
 * when the fall resolves, and the fall goes on from it as it was going.
 * Presses the same way, one after another, make one hop, as they do on the
 * ground (a held key's repeats are one move, not one each), while that hop
 * stays within the walk's budget.
 */
function airPress(f: Fall, axis: AxisName, sign: 1 | -1): void {
  const scaleExp = useCyberspace.getState().scaleExp
  const now = nowMs()
  const at = reachedPoint(f, now)
  const to = clampAxis(at[axis] + stepFor(scaleExp) * BigInt(sign))
  if (to === at[axis]) return
  takeWallWait()
  const step = walkStep(at, axis, sign, sign > 0 ? to - at[axis] : at[axis] - to, f.items, true)
  if (waitedForWalls(() => { if (fall) airPress(fall, axis, sign) })) return
  if (step.by) wallChip(step.by)
  if (samePosition(step.to, at)) return
  const p = { ...step.to }
  const afford = affordIn(f.plane)
  const rel = p.y - f.y0
  const limit = fallLimit(p, f.items, afford)
  const { r, rising } = arcAt(f, now)
  if (rising) {
    // What is left of the rise, under any ceiling over the new column.
    const left = Math.ceil(arcApex(f.v0) - Number(rel) - 1e-6)
    const up = left > 0 ? stepLimit(p, 'y', 1, BigInt(left), f.items).reach : 0n
    f.top = rel + (up > 0n ? affordableRise(p, up, afford) : 0n)
    f.topSince = Math.max(0, (now - f.t0) / 1000)
    f.peak = arcPeak(f.v0, Number(f.top))
  } else {
    // Past the top: in this column you have been at this point and below it
    // only. The arc goes on falling as it was; its ceiling no longer matters.
    f.peak = Number(rel)
  }
  f.bottom = rel - limit.drop
  f.lands = limit.lands
  const air = f.air
  if (air && air.axis === axis && air.dir === sign && f.waypoints.length > 0 && segmentAffordable(air.from, p, f.plane)) {
    // The same way again: the hop from where the last one started grows to here.
    f.waypoints[f.waypoints.length - 1] = p
  } else {
    f.air = { axis, dir: sign, from: f.anchor }
    f.waypoints.push(p)
  }
  f.anchor = p
  syncFall(f)
  // The eye stays where the arc is: its offset now counts from the new point, with the cursor.
  walkFall.offset = r - f.base
  useCyberspace.setState({ cursor: { ...p } })
}

/** How much of a rise of `up` from `p` a hop can afford. */
function affordableRise(p: Position, up: bigint, afford: (from: Position, to: Position) => boolean): bigint {
  let n = up
  while (n > 0n && !afford(p, { ...p, y: p.y + n })) n--
  return n
}

/**
 * The fall resolves at `final`: its hops, each from where the one before it
 * left off, go to be proved now, in order, after anything already queued. A
 * jump that came back to where it left makes none.
 */
function endFall(final: Position, hovering = false): void {
  const f = fall
  if (!f) return
  fall = null
  upInAirAt = null
  walkFall.active = false
  walkFall.offset = 0
  const hops = f.waypoints.slice()
  if (!samePosition(final, f.anchor)) hops.push({ ...final })
  const next = [...useWalk.getState().queue, ...hops]
  useWalk.setState({ falling: false, queue: next, behind: next.length })
  useCyberspace.setState({ cursor: { ...final } })
  if (hovering && !standing(final, f.items, true)) useToast.getState().show({ label: 'HOVERING', meta: 'a hop past here is over the walk budget', mark: 'walk', ms: BRIEF_TOAST_MS * 2 })
  pump()
}

/** Forget a fall not yet resolved: it has made nothing. */
function dropFall(): void {
  fall = null
  upInAirAt = null
  walkFall.active = false
  walkFall.offset = 0
  if (useWalk.getState().falling) useWalk.setState({ falling: false })
}

/**
 * Under gravity the view is level: cyberspace +Y up on screen. A view
 * turned any other way is turned to the level one nearest it, and the
 * walker keeps looking the same way in cyberspace (lib/walkLook.ts).
 */
function levelView(): void {
  const cs = useCyberspace.getState()
  const level = levelQuaternion(cs.view)
  if (!level) return
  keepWalkLook()
  useCyberspace.setState({ view: level })
}

/**
 * A walkTo that has not returned: its checks are still waiting on the relays
 * or the signer. Module state rather than walk state because a STOP does not
 * end it: the call runs on until its own checks refuse it (stillAimed), and
 * a second step started beside it would race it for the same proof slot.
 */
let walkInFlight = false

/**
 * Move the walk along: start the next step when nothing is in flight, and
 * when the one in flight has finished, either take it off the queue (it
 * landed) or stop the walk (it did not). Runs on every store change while
 * walking, so it needs no timer and cannot miss a landing.
 */
function pump(): void {
  const walk = useWalk.getState()
  const cs = useCyberspace.getState()
  if (!cs.walking) return
  if (walkInFlight || moveBusy()) return

  if (walk.running) {
    const ran = walk.running
    if (samePosition(cs.position, ran)) {
      const rest = walk.queue.slice(1)
      useWalk.setState({ queue: rest, running: null, behind: rest.length })
      pump()
      return
    }
    // It ended without landing. A route paused on a declined signature, or
    // failed, keeps its own words; everything else left them on the proof.
    const message = cs.plan?.message ?? cs.proof.message ?? 'WALK stopped: that step did not land.'
    walk.stop(message)
    return
  }

  const target = walk.queue[0]
  if (!target) return
  // Already there: nothing to prove (a step that undid the one before it lands on your head).
  if (samePosition(cs.position, target)) {
    const rest = walk.queue.slice(1)
    useWalk.setState({ queue: rest, behind: rest.length })
    pump()
    return
  }
  useWalk.setState({ running: target })
  walkInFlight = true
  const stillAimed = (): boolean => {
    const w = useWalk.getState()
    return useCyberspace.getState().walking && w.running === target && w.queue[0] === target
  }
  void cs.walkTo(target, stillAimed).finally(() => {
    walkInFlight = false
    pump()
  })
}

// The walk follows the store: a landing, a failure, or leaving your head
// (a spectation, a respawn, an identity switch, history) all arrive here.
useCyberspace.subscribe((s, prev) => {
  if (!s.walking) return
  if (!s.atHead()) {
    // Off first, so nothing below comes back through here. The queue goes
    // and a step in flight is cancelled, but the cursor is left alone: it
    // belongs to whatever took the scene (a VIEW, a spectation, BUILD).
    useCyberspace.setState({ walking: false })
    clearSettle()
    dropFall()
    useWalk.setState({ queue: [], open: null, running: null, behind: 0 })
    if (moveBusy() || useCyberspace.getState().plan) useCyberspace.getState().cancelPlan()
    return
  }
  // An identity switch or a respawn is a different chain: nothing queued
  // belongs to it. A first move's spawn is not: it starts the chain the walk
  // is taking its first step on.
  if (s.identity.pubkey !== prev.identity.pubkey || (prev.events.length > 0 && s.genesisId !== prev.genesisId)) {
    useWalk.getState().stop()
    return
  }
  // Under gravity the view stays level, whatever turned it.
  if (s.view !== prev.view && useWalk.getState().gravity) levelView()
  const w = useWalk.getState()
  // Your head moved mid-fall with none of the walk's own hops in flight:
  // another device's move, or a chain cut short. The fall's hops would start
  // from a place you never were, so it goes, with the walk, back to the head.
  if (fall !== null && w.running === null && !samePosition(s.position, prev.position)) {
    w.stop()
    return
  }
  // Your head moved with nothing of the walk's queued: another device's move
  // folded in (the fold leaves a walk's cursor alone). The eye goes to it.
  if (s.position !== prev.position && fall === null && w.queue.length === 0 && w.open === null && w.running === null && !samePosition(s.cursor, s.position)) {
    useCyberspace.setState({ cursor: { ...s.position } })
    return
  }
  pump()
})

/** Whether the walk is far enough behind for the LOSING SYNC warning. */
export function losingSync(behind: number): boolean {
  return behind >= SYNC_WARN_AT
}

// DEV window handle, the house pattern (__store): how far behind the walk
// is, for the headless measurement of WALK (scene/WalkProbe.tsx).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __walkBehind?: () => number; __walk?: unknown }).__walkBehind = () => useWalk.getState().behind
  ;(window as unknown as { __walk?: unknown }).__walk = useWalk
  ;(window as unknown as { __walkFall?: unknown }).__walkFall = fallState
}
