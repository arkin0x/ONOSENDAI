/**
 * goal.test.tsx - GOAL beside the star (arkinox, 2026-10-14): shown only while
 * the spot on screen is not your avatar, grouped with the star, and the plan
 * it makes is kept until cleared without moving or signing anything.
 */
import { describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { renderToStaticMarkup } from 'react-dom/server'
const { useCyberspace } = await import('../useCyberspace')
const { useGoal } = await import('../useGoal')
const { useHyperspace } = await import('../useHyperspace')
const { goalButtonState, StarGoalGroup } = await import('../../hud/GoalButton')

describe('GOAL beside the star', () => {
  it('is hidden while the spot on screen is your avatar, and shown once it is not', () => {
    const s = useCyberspace.getState()
    useCyberspace.setState({ cursor: { ...s.position } })
    expect(goalButtonState(useCyberspace.getState(), null)).toBeNull()
    useCyberspace.setState({ cursor: { ...s.position, x: s.position.x + 3n } })
    expect(goalButtonState(useCyberspace.getState(), null)).toEqual({ label: expect.any(String), set: false })
    useCyberspace.setState({ cursor: { ...s.position } })
  })

  it('stands right of the star, the two as one centered group', () => {
    const html = renderToStaticMarkup(<StarGoalGroup Star={() => <i className="star" />} GoalB={() => <i className="goal" />} />)
    expect(html).toBe('<div class="chatdock__chip goalgroup"><i class="star"></i><i class="goal"></i></div>')
  })

  it('plans without moving or signing, keeps the plan, and CLEAR forgets it', () => {
    const s = useCyberspace.getState()
    const events = s.events.length
    useCyberspace.setState({ cursor: { ...s.position, x: s.position.x + 3n } })
    useGoal.getState().plan()
    const goal = useGoal.getState().goal
    expect(goal).not.toBeNull()
    // The line has not synced in a test: the plan says so rather than name a stop.
    expect(goal!.plan.kind).toBe('loading')
    expect(useCyberspace.getState().position).toEqual(s.position)
    expect(useCyberspace.getState().events.length).toBe(events)
    expect(useHyperspace.getState().destination).toBeNull()
    // Lit while the spot on screen is the goal.
    expect(goalButtonState(useCyberspace.getState(), goal)?.set).toBe(true)
    useGoal.getState().clear()
    expect(useGoal.getState().goal).toBeNull()
    useCyberspace.setState({ cursor: { ...s.position } })
  })
})
