/**
 * GoalButton.tsx - GOAL, beside the star (arkinox, 2026-10-14): whenever the
 * spot at the center of the screen is not your avatar, pressing it plans the
 * trip there, the nearest port or landfall to leave the line at included
 * (store/useGoal.ts, lib/goalRoute.ts). The two stand as one centered group
 * where the folded CHAT chip sits. Lit while the spot on screen is the goal.
 */

import type { ComponentType } from 'react'
import { Goal } from 'lucide-react'
import { starSpot, type StarSource } from '../lib/starred'
import { samePosition, useCyberspace } from '../store/useCyberspace'
import { useGoal, type Goal as GoalT } from '../store/useGoal'
import { StarChip } from './StarChip'

/** What GOAL shows for the state on screen: nothing at your avatar, else the spot and whether it is already the goal. */
export function goalButtonState(s: StarSource, goal: GoalT | null): { label: string; set: boolean } | null {
  const spot = starSpot(s)
  if (!spot) return null
  return { label: spot.label, set: goal !== null && goal.plane === spot.plane && samePosition(goal.target, spot.position) }
}

/** The star and GOAL, one centered group where the folded CHAT chip sits. */
export function StarGoalGroup({ Star = StarChip, GoalB = GoalButton }: { Star?: ComponentType; GoalB?: ComponentType }): JSX.Element {
  return <div className="chatdock__chip goalgroup"><Star /><GoalB /></div>
}

export function GoalButton(): JSX.Element | null {
  const spotKey = useCyberspace((s) => { const sp = starSpot(s); return sp ? `${sp.plane}|${sp.input}` : '' })
  const goal = useGoal((s) => s.goal)
  if (!spotKey) return null
  const state = goalButtonState(useCyberspace.getState(), goal)
  if (!state) return null
  const { set } = state
  const spot = state
  return (
    <button
      className={`chip chatdock__chip goalchip ${set ? 'is-set' : ''}`}
      onClick={() => useGoal.getState().plan()}
      aria-pressed={set}
      aria-label={set ? `Plan the trip to ${spot.label} again` : `Plan a trip to ${spot.label}`}
      title={set ? 'This is your goal. Tap to plan the trip again' : 'Plan a trip here: walking, or riding hyperspace to the stop nearest it'}
    >
      <Goal className="starchip__glyph" size={13} strokeWidth={2.25} aria-hidden />
    </button>
  )
}
