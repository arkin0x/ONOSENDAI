/**
 * GoalChip.tsx - the trip GOAL planned, in the instrument stack's status
 * group while a goal is set: what the trip is (lib/goalRoute.ts goalSummary),
 * SET to set the destination or line up the next leg, and CLEAR. Nothing here signs or pays.
 */

import { Goal, X } from 'lucide-react'
import { goalSummary } from '../lib/goalRoute'
import { useGoal } from '../store/useGoal'

export function GoalChip(): JSX.Element | null {
  const goal = useGoal((s) => s.goal)
  if (!goal) return null
  return (
    <div className="hyperbar goalbar" role="status">
      <Goal className="toast__build" size={16} strokeWidth={2.25} aria-hidden />
      <span className="hyperbar__text">
        <span className="hyperbar__label">GOAL · {goal.label}</span>
        <span className="hyperbar__meta">{goalSummary(goal.plan)}</span>
      </span>
      <button className="hyperbar__end goalbar__aim" onClick={() => useGoal.getState().aim()} title={goal.plan.kind === 'ride' ? 'Set the ride\'s destination, or line up the last mile once you stand on the stop' : 'Line up the walk from where you stand'}>SET</button>
      <button className="hyperbar__end goalbar__clear" onClick={() => useGoal.getState().clear()} aria-label="Clear the goal" title="Clear the goal"><X size={12} strokeWidth={2.5} aria-hidden /></button>
    </div>
  )
}
