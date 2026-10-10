/**
 * ShardsPanel.tsx — the Stash: your shards and hidden messages, in kinds.
 *
 * A MODEL is a named shard design that lives on this device; you open it in the
 * workshop and deploy copies. A DEPLOYED instance is one such copy, or a hidden
 * message, placed at a coordinate and published. Deleting a model and deleting
 * an instance are different acts with different warnings, so they live in
 * different sections. Tapping a deployment flies the scene to it and opens its
 * record. Leaving a message is the same mechanics as a shard: type it, then aim
 * and place at a height that hides it.
 */

import { useState } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'
import { useBuilder } from '../store/useBuilder'
import { Explanation } from './Explanation'
import { MessageCompose } from './MessageCompose'
import { Diamond, KeyRound, PencilLine, Rss, Vault, Wrench } from 'lucide-react'
import { bagsOf, useStash } from './stash'
import { BagRow } from './StashModals'

/** How many bags the panel shows before VIEW ALL. */
const RECENT_BAGS = 3

export function ShardsPanel(): JSX.Element {
  const mine = useShards((s) => s.mine)
  const scanning = useShards((s) => s.scanning)
  const [composing, setComposing] = useState(false)
  const building = useBuilder((s) => s.active)
  // EXIT BUILD waits for a lined-up deploy to be hidden or canceled, as B
  // and the bar's EXIT do (useBuilder `exit`).
  const deploying = useShards((s) => s.pending !== null)

  const hiddenCount = mine.length
  const live = useCyberspace((s) => s.live)
  const broadcastError = useShards((s) => s.broadcastError)
  const localCount = mine.filter((d) => !d.published).length
  const bags = bagsOf(mine)

  return (
    <section className="panel panel--shards">
      <header className="panel__head">
        {/* CREATE (arkinox, 2026-10-10): the panel is where things are made and
            placed; the bags themselves are listed under VIEW ALL STASHED BAGS. */}
        <h2>Create</h2>
        <span className={`tag ${scanning ? 'tag--scan' : ''}`} title="What you have placed in cyberspace from this stash">{scanning ? 'SCANNING' : hiddenCount === 0 ? 'NOTHING PLACED' : `${hiddenCount} PLACED`}</span>
      </header>

      {/* The models themselves live in the workshop, which is where they are
          made, named and deleted. Listing them here grew a second scrolling
          box inside a scrolling panel, and the panel could not be scrolled
          past it. What the stash is for is what is hidden. */}
      <div className="shards__section">
        <div className="shards__modes">
          <button className="avatars__go shards__compose-open" onClick={() => useWorkshop.getState().openWorkshop()}>OPEN WORKSHOP</button>
          {/* Everyone's published objects, beside the workshop where yours are made (the Shard Feed). */}
          <button className="avatars__go shards__compose-open shards__feed" onClick={() => useStash.getState().openFeed()} title="Browse everyone's published objects: place one, or remix it as your own">
            <Rss className="shards__build-icon" size={13} strokeWidth={2.5} aria-hidden /> SHARD FEED
          </button>
          {/* BUILD mode, beside the workshop it is the other half of: the
              workshop makes objects, the Builder places them (useBuilder). */}
          <button
            className={`avatars__go shards__compose-open shards__build ${building ? 'is-on' : ''}`}
            aria-pressed={building}
            disabled={building && deploying}
            onClick={() => useBuilder.getState().toggle()}
            title={building && deploying ? 'Hide or cancel the deploy first; leaving build mode would cancel it' : building ? 'Leave build mode; the view stays where it is (B)' : 'Place objects and messages anywhere, without moving your avatar (B)'}
          >{building ? 'EXIT BUILD' : <><Wrench className="shards__build-icon" size={13} strokeWidth={2.5} aria-hidden /> BUILD</>}</button>
        </div>
      </div>

      <div className="shards__section">
        <span className="legend__label">Place a hidden object</span>
        <div>
          <button className="avatars__go shards__compose-open" onClick={() => useStash.getState().openModels()}><Diamond className="shards__build-icon" size={13} strokeWidth={2.5} aria-hidden /> DEPLOY AN OBJECT</button>
        </div>
      </div>

      <div className="shards__section">
        <span className="legend__label">Place a hidden message</span>
        {composing ? (
          <MessageCompose onDone={() => setComposing(false)} />
        ) : (
          <button className="avatars__go shards__compose-open" onClick={() => setComposing(true)}><PencilLine className="shards__build-icon" size={13} strokeWidth={2.5} aria-hidden /> WRITE A MESSAGE</button>
        )}
      </div>

      {/* Keys and chests (B1 §3.1): a key is a keypair hidden as an item, and
          a chest is contents sealed to a key or a person. Both compose in a
          modal (StashModals), since a chest's composer is taller than a panel row. */}
      <div className="shards__section">
        <span className="legend__label">Place a key or a chest</span>
        <div className="shards__modes">
          <button className="avatars__go shards__compose-open" onClick={() => useStash.getState().openKey()} title="Forge a keypair and hide it as an item; whoever reads it holds it"><KeyRound className="shards__build-icon" size={13} strokeWidth={2.5} aria-hidden /> FORGE A KEY</button>
          <button className="avatars__go shards__compose-open" onClick={() => useStash.getState().openChest()} title="Seal a message, a model or a key to a key or a person, and hide it"><Vault className="shards__build-icon" size={13} strokeWidth={2.5} aria-hidden /> SEAL A CHEST</button>
        </div>
      </div>

      {mine.length > 0 && (
        <div className="shards__section">
          <span className="legend__label">Deployed — hidden in cyberspace</span>
          {/* Anything deployed while LOCAL was signed and kept but never sent.
              It stays that way until it is broadcast, which needs LIVE. */}
          {localCount > 0 && (
            <span className="shards__note">
              {localCount === 1 ? 'One thing is' : `${localCount} things are`} on this device only.{' '}
              {live ? 'BROADCAST sends the region it is hidden in.' : 'Switch to LIVE to send them.'}
            </span>
          )}
          {broadcastError && <span className="shards__note shards__note--warn">{broadcastError}</span>}
          <ul className="avatars__list">
            {bags.slice(0, RECENT_BAGS).map((b) => (
              <BagRow key={b.lookupId} bag={b} onOpen={() => useStash.getState().openBag(b.lookupId)} />
            ))}
          </ul>
          <button className="avatars__go shards__compose-open" onClick={() => useStash.getState().openBags()}>VIEW ALL STASHED BAGS ({bags.length})</button>
        </div>
      )}

      <Explanation>
        Build 3D objects and messages, and encrypt them at a location in
        cyberspace for others to find. Everything you hide at one place travels
        together as one bag.
      </Explanation>
    </section>
  )
}
