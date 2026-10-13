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
 * Steps queue. Each is proved from where the one before it landed, in the
 * order pressed, through the store's own commit (walkTo), so a WALK step is
 * checked, signed and published exactly like a COMMIT. A step past this
 * machine's ceiling runs as its route (hops to the wall, the sidestep, hops
 * on), still as one press.
 *
 * The walk stops, all of it, the moment a step does not land: refused,
 * infeasible, a signature declined, a step only HOSAKA could sell (a walk
 * never pays on its own), or STOP. What is queued is dropped and the cursor
 * comes back to where you really stand, so the view eases back with it.
 * Steps already signed stay on the chain: they are real moves.
 *
 * `behind` is the walk's lag, the steps pressed and not yet proven, the one
 * computing included. It is what the LOSING SYNC warning counts.
 */

import { create } from 'zustand'
import { moveDirection, type MoveName } from '../lib/moves'
import { clampAxis, stepFor, type Position } from '../lib/space'
import { samePosition, useCyberspace } from './useCyberspace'

/** What the LOSING SYNC warning waits for: this many steps not yet proven. */
export const SYNC_WARN_AT = 3

interface WalkState {
  /** Steps pressed and not yet landed, oldest first. The first is the one in flight. */
  queue: Position[]
  /** The step handed to the store, until it lands or the walk stops. */
  running: Position | null
  /** Steps not yet proven, the one in flight included. */
  behind: number
  /** Turn WALK on. Only at your own head; a VIEW in progress ends first. */
  enter: () => void
  /** Stop the walk and go back to HOP. */
  exit: () => void
  /** Stop the walk where the chain is now, and stay in WALK. */
  stop: (message?: string | null) => void
  /** A direction press: queue one step that way and show it at once. */
  press: (name: MoveName) => void
}

/** Something of the store's is still working on a move: a proof, a route, a cloud job. */
function moveBusy(): boolean {
  const s = useCyberspace.getState()
  return s.proof.status === 'computing' || s.plan?.status === 'running' || s.cloud.status !== 'idle'
}

export const useWalk = create<WalkState>((set, get) => ({
  queue: [],
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
    set({ queue: [], running: null, behind: 0 })
  },

  exit: () => {
    if (!useCyberspace.getState().walking) return
    get().stop()
    useCyberspace.setState({ walking: false })
  },

  stop: (message = null) => {
    const cs = useCyberspace.getState()
    set({ queue: [], running: null, behind: 0 })
    // Whatever is in flight goes too: a proof is killed, a route abandoned,
    // a cloud flow ended the way X ends it (cancel). What was signed stays.
    if (moveBusy() || cs.plan) cs.cancel()
    const now = useCyberspace.getState()
    useCyberspace.setState({
      cursor: { ...now.position },
      pendingTarget: null,
      ...(message ? { proof: { ...now.proof, status: 'infeasible' as const, message } } : {}),
    })
  },

  press: (name) => {
    const cs = useCyberspace.getState()
    if (!cs.walking || !cs.atHead()) return
    const dir = moveDirection(cs.screenAxes ?? cs.axes(), name)
    const { queue } = get()
    const from = queue[queue.length - 1] ?? cs.position
    const next: Position = { ...from }
    next[dir.axis] = clampAxis(from[dir.axis] + stepFor(cs.scaleExp) * BigInt(dir.dir))
    // Against the axis wall: nowhere to step.
    if (next[dir.axis] === from[dir.axis]) return
    set({ queue: [...queue, next], behind: queue.length + 1 })
    // The view and the avatar go now; the proof catches up.
    useCyberspace.setState({ cursor: { ...next } })
    pump()
  },
}))

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
    useWalk.setState({ queue: [], running: null, behind: 0 })
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
  pump()
})

/** Whether the walk is far enough behind for the LOSING SYNC warning. */
export function losingSync(behind: number): boolean {
  return behind >= SYNC_WARN_AT
}
