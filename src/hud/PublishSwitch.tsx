/**
 * PublishSwitch.tsx - LOCAL or LIVE, for one hidden thing.
 *
 * The switch at the bottom of the screen decides what the whole identity
 * does: LOCAL signs your movement and keeps it here, LIVE drains the chain
 * onto the relay. That is the right grain for a chain, where every action
 * names the one before it, and the wrong grain for a bag. A bag is a
 * standalone envelope keyed to a region: sending one says nothing about
 * where you have been, so travelling in secret and publishing one shard is a
 * perfectly coherent thing to want, and it used to mean going LIVE,
 * publishing everything, and remembering to go back.
 *
 * This is that decision at the grain of one thing. It reads the way the big
 * switch reads, two words with the current one lit, so there is never any
 * doubt which state a thing is in. It only moves one way: a relay cannot
 * unsee a bag, and a switch that pretended otherwise would be a lie.
 */

import { useState } from 'react'
import { ConfirmModal } from './ConfirmModal'
import { useShards } from '../store/useShards'

export function PublishSwitch({ lookupId, published }: { lookupId: string; published: boolean }): JSX.Element {
  const busy = useShards((s) => s.broadcasting === lookupId)
  // Asked before it happens, because it cannot be asked afterwards: a relay
  // cannot unsee a bag, so this is the only moment the answer matters.
  const [asking, setAsking] = useState(false)
  return (
    <div className="pubswitch" role="group" aria-label="Where this is published">
      <span className={`pubswitch__opt ${published ? '' : 'is-on'}`} aria-current={!published}>LOCAL</span>
      <button
        className={`pubswitch__opt pubswitch__go ${published ? 'is-on' : ''}`}
        aria-pressed={published}
        disabled={published || busy}
        title={published
          ? 'Already on the relays. A relay cannot unsee it, so this cannot go back to LOCAL.'
          : 'Send this one bag to the relays now, and leave everything else where it is. It cannot be taken back.'}
        onClick={() => { if (!published) setAsking(true) }}
      >{busy ? 'SENDING' : 'LIVE'}</button>
      {asking && (
        <ConfirmModal
          title="Publish this to cyberspace?"
          body={<>
            This one hidden thing goes to the relays now. Everything else stays
            where it is: your movement chain and every other thing you have
            hidden are untouched, and LOCAL stays LOCAL.
            <br /><br />
            Anyone who computes the region it is hidden in can find it and open
            it. A relay cannot unsee a bag, so this cannot be taken back.
          </>}
          confirmLabel="PUBLISH"
          cancelLabel="KEEP IT LOCAL"
          danger={false}
          onConfirm={() => { setAsking(false); void useShards.getState().broadcast(lookupId) }}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  )
}
