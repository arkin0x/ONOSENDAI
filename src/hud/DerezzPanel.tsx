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

export function DerezzPanel(): JSX.Element {
  const [armed, setArmed] = useState(false)
  const chain = useCyberspace((s) => s.chain)
  const live = useCyberspace((s) => s.live)
  const actions = chain.hops + chain.sidesteps

  const derezz = (): void => {
    useCyberspace.getState().respawn()
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
          <p className="legend__note">
            Abandon this chain and spawn again at your pubkey. A new spawn event
            {live ? ' is published and ' : ' '}retires every action before it
            (spec section 3.2). Your identity and the relay's copy of the old
            chain are untouched.
          </p>
          <button className="derezz__arm" onClick={() => setArmed(true)}>DEREZZ</button>
        </>
      )}
    </section>
  )
}
