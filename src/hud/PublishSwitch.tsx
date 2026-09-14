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

import { useShards } from '../store/useShards'

export function PublishSwitch({ lookupId, published }: { lookupId: string; published: boolean }): JSX.Element {
  const busy = useShards((s) => s.broadcasting === lookupId)
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
        onClick={() => { if (!published) void useShards.getState().broadcast(lookupId) }}
      >{busy ? 'SENDING' : 'LIVE'}</button>
    </div>
  )
}
