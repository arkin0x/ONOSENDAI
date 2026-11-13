/**
 * TutorialPanel.tsx: the first-arrival tutorial in the menu (feedback
 * 2026-11-11, item 17). The tutorial starts the menu closed on arrival (item
 * 16) and ends by pointing here (item 10), so this panel is how a player opens
 * it again.
 *
 * Everything of the tutorial's is here, nothing in Settings (owner,
 * 2026-11-13: "Move all that into the tutorial panel"): the device switch
 * (tutorial/gate.ts), RESUME TUTORIAL, which picks this identity's run up
 * where it was (store/useTutorial.ts resumeTutorial), and RESTART TUTORIAL,
 * which begins again from the welcome where the player stands. The panel is
 * drawn for everyone, switched off too, so the switch can always be turned
 * back on; off, it shows only the switch.
 */

import { cannotStageHere, resumeStepFor, resumeTutorial, useTutorial } from '../store/useTutorial'
import { useCyberspace } from '../store/useCyberspace'
import { TUTORIAL_DEFAULT_ON, setTutorialSwitch, useTutorialSwitch } from '../tutorial/gate'
import { useDemo } from '../store/useDemo'
import { useTv } from '../store/useTv'
import { Field, Switch } from './ui/Switch'
import { Explanation } from './Explanation'

/** The switch: off also puts a running tutorial away (it resumes from here, or on a later load once on). */
function setOn(v: boolean): void {
  setTutorialSwitch(v)
  if (!v) useTutorial.getState().pause()
}

export function TutorialPanel(): JSX.Element {
  const on = useTutorialSwitch((s) => s.value) ?? TUTORIAL_DEFAULT_ON
  const running = useTutorial((s) => s.active)
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  // Neither button over the tour or TV, which would put the run away again at
  // once, nor where it cannot be laid out (the line, a game, a chain that
  // cannot move: store/useTutorial.ts cannotStageHere).
  const touring = useDemo((s) => s.active)
  const tvOn = useTv((s) => s.on)
  const away = useCyberspace(() => cannotStageHere())
  const blocked = running || touring || tvOn || away
  // Read on each draw, which a run starting or ending brings: progress changes only while one runs.
  const resumable = on && resumeStepFor(pubkey) !== null
  return (
    <section className="panel panel--tutorial">
      <header className="panel__head"><h2>Tutorial</h2></header>
      <Field id="tutorial-switch" label="Tutorial" hint="Guide a new identity on arrival.">
        <Switch id="tutorial-switch" checked={on} onCheckedChange={setOn} />
      </Field>
      {on && (
        <>
          <div className="tutorial-actions">
            {resumable && <button className="avatars__go" onClick={() => { resumeTutorial() }} disabled={blocked}>RESUME TUTORIAL</button>}
            <button className="avatars__go" onClick={() => useTutorial.getState().start({ restart: true })} disabled={blocked}>RESTART TUTORIAL</button>
          </div>
          <Explanation>Your first few minutes again, from the welcome.</Explanation>
        </>
      )}
    </section>
  )
}
