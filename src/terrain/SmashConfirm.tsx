/**
 * SmashConfirm.tsx - the question a smash asks before wasting recipe
 * materials (lib/blueprint/smashConfirm.ts has the rules): "This won't
 * compile. It breaks 5 blocks, including placed Glowcore." under "Smash
 * anyway?", with SMASH and CANCEL and a "Don't ask again" box, OFF each time
 * it opens. CANCEL, Esc, the ✕ or a tap outside spend nothing.
 */

import { useState } from 'react'
import { ConfirmModal } from '../hud/ConfirmModal'
import { Checkbox } from '../hud/ui/Checkbox'
import { answerSmash, useSmashConfirm, type SmashAsk } from '../lib/blueprint/smashConfirm'

/** The confirm's title; the question's last words, so the body does not repeat them. */
export const SMASH_ASK_TITLE = 'Smash anyway?'
/** The box under the question. */
export const DONT_ASK_LABEL = "Don't ask again"

export function SmashConfirm(): JSX.Element | null {
  const ask = useSmashConfirm((s) => s.ask)
  if (!ask) return null
  // Keyed by the question: a new one starts with its own box OFF, never a tick left from the last (review of #969).
  return <SmashAskModal key={ask.id} ask={ask} />
}

function SmashAskModal({ ask }: { ask: SmashAsk }): JSX.Element {
  const [dontAsk, setDontAsk] = useState(false)
  const body = ask.words.replace(/\s*Smash anyway\?$/, '')
  return (
    <ConfirmModal
      title={SMASH_ASK_TITLE}
      body={(
        <>
          <p className="smash-ask__words">{body}</p>
          <span className="smash-ask__dont">
            <Checkbox id="smash-ask-dont" checked={dontAsk} onCheckedChange={(v) => setDontAsk(v === true)} />
            <label htmlFor="smash-ask-dont">{DONT_ASK_LABEL}</label>
          </span>
        </>
      )}
      confirmLabel="SMASH"
      onConfirm={() => answerSmash(true, dontAsk)}
      onCancel={() => answerSmash(false)}
    />
  )
}
