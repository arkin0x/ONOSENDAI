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
import { clampAxis, stepFor, type AxisName, type Position } from '../lib/space'
import { MAX_COMPUTE_HEIGHT, samePosition, useCyberspace } from './useCyberspace'
import { BRIEF_TOAST_MS, useToast } from './useToast'
import { stepLimit, wallItems, warmWalls } from './walkWalls'

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
  axis: AxisName
  dir: 1 | -1
  /** Where it starts: the end of the move before it, or your head. */
  from: Position
  /** Where it ends now: the view is here. */
  end: Position
}

/**
 * Whether a straight hop from `from` to `to` costs no more than
 * WALK_SEGMENT_BUDGET_MS here. The cost is set by the highest per-axis LCA of
 * the two ends, the Cantor tree a proof has to compute; measured times
 * project it when calibration has run, and before that each height is taken
 * to double the time of the one under it from the conservative hop ceiling.
 */
export function segmentAffordable(from: Position, to: Position, plane: number): boolean {
  const est = estimateHopCost(from.x, from.y, from.z, to.x, to.y, to.z, plane as 0 | 1, MAX_COMPUTE_HEIGHT)
  const h = Math.max(est.lcaX, est.lcaY, est.lcaZ)
  const measured = useCalibration.getState().cantorMsByHeight
  if (measured && Object.keys(measured).length > 0) {
    const ms = projectCantorMs(measured, h)
    if (Number.isFinite(ms)) return ms <= WALK_SEGMENT_BUDGET_MS
  }
  return h <= recommendedHopHeight() - Math.log2(HOP_AXIS_BUDGET_MS / WALK_SEGMENT_BUDGET_MS)
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
  /** Turn WALK on. Only at your own head; a VIEW in progress ends first. */
  enter: () => void
  /** Stop the walk and go back to HOP. */
  exit: () => void
  /** Stop the walk where the chain is now, and stay in WALK. */
  stop: (message?: string | null) => void
  /** A direction press: one step that way, shown at once, added to the open segment or starting one. */
  press: (name: MoveName) => void
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

  enter: () => {
    const cs = useCyberspace.getState()
    if (cs.walking) return
    // VIEW is a focus, and WALK is taken from your head: the view ends first,
    // which brings the cursor and the zoom home.
    if (cs.viewing()) cs.clearFocus()
    if (!useCyberspace.getState().atHead()) return
    const { position } = useCyberspace.getState()
    useCyberspace.setState({ walking: true, cursor: { ...position } })
    // The shards' walls, and the objects they place, ready before the first step.
    warmWalls(useCyberspace.getState().plane)
    clearSettle()
    set({ queue: [], open: null, running: null, behind: 0 })
  },

  exit: () => {
    if (!useCyberspace.getState().walking) return
    get().stop()
    useCyberspace.setState({ walking: false })
  },

  stop: (message = null) => {
    const cs = useCyberspace.getState()
    clearSettle()
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

  press: (name) => {
    const cs = useCyberspace.getState()
    if (!cs.walking || !cs.atHead()) return
    const dir = moveDirection(cs.screenAxes ?? cs.axes(), name)
    const { queue, open } = get()
    const from = open?.end ?? queue[queue.length - 1] ?? cs.position
    const next: Position = { ...from }
    next[dir.axis] = clampAxis(from[dir.axis] + stepFor(cs.scaleExp) * BigInt(dir.dir))
    // Against the axis wall: nowhere to step.
    if (next[dir.axis] === from[dir.axis]) return
    const sign = dir.dir > 0 ? 1 : -1
    // A shard that constrains WALK (DECK-0003 §1.12, store/walkWalls.ts):
    // the step stops short of its face (a gibson short at a fine zoom), or does not go.
    const length = sign > 0 ? next[dir.axis] - from[dir.axis] : from[dir.axis] - next[dir.axis]
    const wall = stepLimit(from, dir.axis, sign, length, wallItems(cs.plane))
    // One chip per wall: a held key's repeats do not churn the one toast slot.
    const shown = useToast.getState().toast
    if (wall.by && !(shown?.label === 'WALL' && shown.meta === wall.by.shard.name)) useToast.getState().show({ label: 'WALL', meta: wall.by.shard.name, mark: 'walk', ms: BRIEF_TOAST_MS })
    if (wall.reach === 0n) return
    next[dir.axis] = from[dir.axis] + wall.reach * BigInt(sign)
    if (open && open.axis === dir.axis && open.dir === sign && segmentAffordable(open.from, next, cs.plane)) {
      // On the same way: the open segment grows.
      set({ open: { ...open, end: next } })
    } else {
      // A turn, or one step more than a segment may cost: the open one goes to
      // be proved and this step starts the next.
      if (open) closeOpen()
      set({ open: { axis: dir.axis, dir: sign, from, end: next } })
      if (open) pump()
    }
    // The view and the avatar go now; the proof catches up.
    useCyberspace.setState({ cursor: { ...next } })
    clearSettle()
    settleTimer = setTimeout(() => { settleTimer = null; get().settle() }, WALK_SETTLE_MS)
  },

  settle: () => {
    clearSettle()
    if (!get().open) return
    closeOpen()
    pump()
  },
}))

/** The open segment onto the queue. */
function closeOpen(): void {
  const { open, queue } = useWalk.getState()
  if (!open) return
  const next = [...queue, open.end]
  useWalk.setState({ open: null, queue: next, behind: next.length })
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
  // Your head moved with nothing of the walk's queued: another device's move
  // folded in (the fold leaves a walk's cursor alone). The eye goes to it.
  const w = useWalk.getState()
  if (s.position !== prev.position && w.queue.length === 0 && w.open === null && w.running === null && !samePosition(s.cursor, s.position)) {
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
}
