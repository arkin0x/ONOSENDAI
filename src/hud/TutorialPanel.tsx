/**
 * TutorialPanel.tsx: a way back into the first-arrival tutorial from the menu
 * (feedback 2026-11-11, item 17). The tutorial starts the menu closed on
 * arrival (item 16) and ends by pointing here (item 10), so this panel is how
 * a player opens it again.
 *
 * Drawn wherever the tutorial switch is on, the default since 2026-11-13
 * (Hud.tsx filters it out when switched off, so no empty slot shows).
 */

import { useTutorial } from '../store/useTutorial'
import { useTutorialSwitch } from '../tutorial/gate'
import { useDemo } from '../store/useDemo'
import { useTv } from '../store/useTv'
import { Explanation } from './Explanation'

export function TutorialPanel(): JSX.Element | null {
  const on = useTutorialSwitch((s) => s.value)
  const running = useTutorial((s) => s.active)
  // Cannot start over the tour or TV, which would put it away again at once.
  const touring = useDemo((s) => s.active)
  const tvOn = useTv((s) => s.on)
  if (on !== true) return null
  const blocked = touring || tvOn
  return (
    <section className="panel panel--tutorial">
      <header className="panel__head"><h2>Tutorial</h2></header>
      <Explanation>Your first few minutes again, from the welcome.</Explanation>
      <button
        className="avatars__go"
        onClick={() => useTutorial.getState().start({ restart: true })}
        disabled={running || blocked}
      >
        {running ? 'TUTORIAL RUNNING' : 'START TUTORIAL'}
      </button>
    </section>
  )
}
