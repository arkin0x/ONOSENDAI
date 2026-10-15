/**
 * useGoal.ts - GOAL, the trip to a place you are looking at (arkinox,
 * 2026-10-14). Pressing GOAL beside the star plans the trip (lib/goalRoute.ts)
 * and keeps it, like a set cursor, until it is cleared; nothing is signed or
 * paid by planning.
 *
 * A ride plan also chooses the exit stop as the HYPERSPACE destination, so the
 * panel's estimate, HOSAKA's quote and RIDE all describe the same trip. AIM
 * (on the GOAL chip) lines up the walking leg where you stand: the goal itself
 * on a direct trip, or the goal once you stand on the exit stop. Before that
 * it points you at the panel to board and ride.
 *
 * A plan made while the line was still syncing is made again when the sync
 * finishes, so the exit stop it names is never one a later stop would beat.
 */

import { create } from 'zustand'
import { coordToXyz, type Plane } from 'cyberspace-core'
import { planGoal, type GoalPlan } from '../lib/goalRoute'
import type { Position } from '../lib/movePlan'
import { starSpot } from '../lib/starred'
import { samePosition, useCyberspace } from './useCyberspace'
import { exitHyperspaceView, getStopIndex, useHyperspace } from './useHyperspace'
import { BRIEF_TOAST_MS, useToast } from './useToast'
import { useWalk } from './useWalk'

export interface Goal {
  target: Position
  plane: Plane
  label: string
  plan: GoalPlan
}

interface GoalState {
  goal: Goal | null
  /** Plan the trip to the spot on screen (the star's spot). */
  plan: () => void
  /** Line up the walking leg from where you stand, or point at the ride. */
  aim: () => void
  clear: () => void
}

function planFor(target: Position, plane: Plane): GoalPlan {
  const cs = useCyberspace.getState()
  const hs = useHyperspace.getState()
  return planGoal({
    here: cs.position,
    herePlane: cs.headPlane,
    target,
    targetPlane: plane,
    index: getStopIndex(),
    tip: hs.tipHeight,
    ready: hs.sync.status === 'ready',
  })
}

/** Whether you stand on the stop a ride plan exits at. */
function atExit(plan: GoalPlan): boolean {
  if (plan.kind !== 'ride') return false
  const cs = useCyberspace.getState()
  return (cs.headPlane === (plan.exit.kind === 'port' ? 1 : 0)) && samePosition(cs.position, positionOfCoord(plan.exit.coord))
}

function positionOfCoord(coord: bigint): Position {
  const { x, y, z } = coordToXyz(coord)
  return { x, y, z }
}

export const useGoal = create<GoalState>((set, get) => ({
  goal: null,

  plan: () => {
    const spot = starSpot(useCyberspace.getState())
    if (!spot) return
    const plan = planFor(spot.position, spot.plane)
    set({ goal: { target: { ...spot.position }, plane: spot.plane, label: spot.label, plan } })
    // The ride's exit is the panel's destination, so the panel, the quote and
    // RIDE all describe this trip.
    if (plan.kind === 'ride') useHyperspace.getState().setDestination(plan.exit.height)
  },

  aim: () => {
    const goal = get().goal
    if (!goal) return
    const { plan } = goal
    if (plan.kind === 'loading') {
      useToast.getState().show({ label: 'Still finding the nearest stop', meta: 'The line is syncing; GOAL plans again when it is done.', mark: 'goal', ms: BRIEF_TOAST_MS })
      return
    }
    if (plan.kind === 'ride' && !atExit(plan)) {
      useHyperspace.getState().setDestination(plan.exit.height)
      useToast.getState().show({ label: `Destination: block ${plan.exit.height}`, meta: 'Board and RIDE in the HYPERSPACE panel; AIM again at the stop for the last mile.', mark: 'goal', ms: BRIEF_TOAST_MS })
      return
    }
    // The walking leg, from where you stand: leave whatever view is up, then
    // line the cursor up on the goal so the route overlay lists the steps.
    if (useHyperspace.getState().viewOwned) exitHyperspaceView()
    const cs = useCyberspace.getState()
    if (cs.spectate !== null) cs.endSpectate()
    if (useCyberspace.getState().focus !== null) useCyberspace.getState().clearFocus()
    // WALK's cursor is its predicted head, never a plan's.
    if (useCyberspace.getState().walking) useWalk.getState().exit()
    if (!useCyberspace.getState().atHead()) {
      useToast.getState().show({ label: 'Back to your avatar first', meta: 'AIM lines the walk up from where you stand.', mark: 'goal', ms: BRIEF_TOAST_MS })
      return
    }
    useCyberspace.setState({ cursor: { ...goal.target }, plane: goal.plane, anchorPlane: goal.plane })
  },

  clear: () => {
    const goal = get().goal
    if (goal?.plan.kind === 'ride' && useHyperspace.getState().destination === goal.plan.exit.height) {
      useHyperspace.getState().setDestination(null)
    }
    set({ goal: null })
  },
}))

// A plan made before the line finished syncing is made again once it has.
useHyperspace.subscribe((s, prev) => {
  if (s.sync.status === prev.sync.status) return
  const goal = useGoal.getState().goal
  if (!goal || goal.plan.kind !== 'loading' || s.sync.status !== 'ready') return
  const plan = planFor(goal.target, goal.plane)
  useGoal.setState({ goal: { ...goal, plan } })
  if (plan.kind === 'ride') useHyperspace.getState().setDestination(plan.exit.height)
})
