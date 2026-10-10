/**
 * DerezzPanel.tsx - abandon the chain and rez again at the pubkey.
 *
 * Spec §3.2: a keypair may respawn at any time by publishing a new spawn
 * event, which by being newer retires every prior action. The old events stay
 * on relays; they just no longer lead anywhere. So this is the one control in
 * the HUD that throws away work, and it is buried at the bottom of the panels,
 * behind a warning, in red, the way v1 buried it behind DEREZZ.
 *
 * The copy is v1's, because v1 had the tone right: a respawn is a small death,
 * and a machine that asks you to remove your neuroactive interfaces first is
 * not joking about the part that matters.
 */

import { useState } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { firstBreak } from '../lib/events'
import { confirmRespawn, respawnFailed } from './BrokenChain'
import { Explanation } from './Explanation'

/**
 * DEREZZ NOW: a respawn. On a broken chain it is the broken-chain notice's
 * respawn (BrokenChain confirmRespawn), so the End of Chain entry goes into
 * RECENT first (review of #227). Either way it waits for the respawn and
 * resolves to what to say if it failed, null when it did not.
 */
export async function derezzNow(): Promise<string | null> {
  const s = useCyberspace.getState()
  const broken = firstBreak(s.actions())
  if (broken) return confirmRespawn(s.identity.pubkey, (broken.lastValid ?? broken.action).id)
  try {
    await s.respawn()
    return null
  } catch (err) {
    return respawnFailed(err)
  }
}

export function DerezzPanel(): JSX.Element {
  const [armed, setArmed] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const live = useCyberspace((s) => s.live)
  // The chain a derezz retires: its events, the same count the Chain panel
  // wears. It used to add the lifetime hop and sidestep statistics (every
  // chain this device ever moved), which is not what a derezz discards
  // (arkinox, 2026-10-10: "derezz shows the wrong count of actions").
  const actions = useCyberspace((s) => s.events.length)

  // A broken chain respawns the way the broken-chain notice does, so the
  // End of Chain entry goes into RECENT first (store respawnFromBrokenChain).
  const derezz = (): void => {
    setFailed(null)
    void derezzNow().then(setFailed)
    setArmed(false)
  }

  return (
    <section className={`panel panel--derezz ${armed ? 'is-armed' : ''}`}>
      <header className="panel__head">
        <h2>Derezz</h2>
        <span className="tag tag--danger">{actions} ACTION{actions === 1 ? '' : 'S'}</span>
      </header>

      {armed ? (
        <>
          <p className="derezz__warning">
            DISCARD CURRENT PROOF CHAIN OF {actions} ACTION{actions === 1 ? '' : 'S'} AND
            REZ AT PUBKEY COORDINATE? (THIS CANNOT BE UNDONE)
          </p>
          <p className="derezz__fine">
            TO AVOID INJURY OR BRAIN DEATH, PLEASE REMOVE NEUROACTIVE INTERFACES
            BEFORE CONTINUING
          </p>
          <div className="derezz__row">
            <button className="derezz__cancel" onClick={() => setArmed(false)}>CANCEL</button>
            <button className="derezz__now" onClick={derezz}>DEREZZ NOW</button>
          </div>
        </>
      ) : (
        <>
          <Explanation>
            Abandon this chain and spawn again at your pubkey. A new spawn event
            {live ? ' is published and ' : ' '}retires every action before it
            (spec section 3.2). Your identity and the relay's copy of the old
            chain are untouched.
          </Explanation>
          <button className="derezz__arm" onClick={() => setArmed(true)}>DEREZZ</button>
          {failed && <p className="notice" role="alert">{failed}</p>}
        </>
      )}
    </section>
  )
}
