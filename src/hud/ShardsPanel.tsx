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
import { composeVerdict, SETTLE_MS, useCashu } from './useCashu'
import { useSettled } from './useSettled'
import { MAX_MESSAGE_LENGTH } from '../lib/hidden'
import { useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'
import { Explanation } from './Explanation'
import { bagsOf, useStash } from './stash'
import { BagRow } from './StashModals'

/** How many bags the panel shows before VIEW ALL. */
const RECENT_BAGS = 3

export function ShardsPanel(): JSX.Element {
  const mine = useShards((s) => s.mine)
  const scanning = useShards((s) => s.scanning)
  const [composing, setComposing] = useState(false)
  const [message, setMessage] = useState('')
  // The token is read, and its mint asked, only once the text has held
  // still for SETTLE_MS: not on every keystroke through a token thousands
  // of characters long. Until then PLACE MESSAGE waits.
  const settled = useSettled(message, SETTLE_MS) === message
  const cashu = useCashu(settled ? message : null)
  const verdict = composeVerdict(settled, cashu)

  const hiddenCount = mine.length
  const live = useCyberspace((s) => s.live)
  const broadcastError = useShards((s) => s.broadcastError)
  const localCount = mine.filter((d) => !d.published).length
  const bags = bagsOf(mine)

  const placeMessage = (): void => {
    const t = message.trim()
    if (!t) return
    useShards.getState().startDeployMessage(t)
    setComposing(false)
    setMessage('')
  }

  return (
    <section className="panel panel--shards">
      <header className="panel__head">
        <h2>Stash</h2>
        <span className={`tag ${scanning ? 'tag--scan' : ''}`}>{scanning ? 'SCANNING' : hiddenCount === 0 ? 'NOTHING HIDDEN' : `${hiddenCount} HIDDEN`}</span>
      </header>

      {/* The models themselves live in the workshop, which is where they are
          made, named and deleted. Listing them here grew a second scrolling
          box inside a scrolling panel, and the panel could not be scrolled
          past it. What the stash is for is what is hidden. */}
      <div className="shards__section">
        <div>
          <button className="avatars__go shards__compose-open" onClick={() => useWorkshop.getState().openWorkshop()}>OPEN WORKSHOP</button>
        </div>
      </div>

      <div className="shards__section">
        <span className="legend__label">Place a hidden object</span>
        <div>
          <button className="avatars__go shards__compose-open" onClick={() => useStash.getState().openModels()}>◇ DEPLOY AN OBJECT</button>
        </div>
      </div>

      <div className="shards__section">
        <span className="legend__label">Place a hidden message</span>
        {composing ? (
          <div className="shards__compose">
            <textarea
              className="shards__textarea"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              placeholder="A message left in cyberspace, readable only from where you place it…"
              rows={3}
              autoFocus
            />
            {verdict.note && <span className={`shards__compose-note shards__compose-note--${verdict.tone}`} role="status">{verdict.note}</span>}
            <div className="shards__actions">
              <button className="avatars__go" onClick={() => { setComposing(false); setMessage('') }}>CANCEL</button>
              <button className="avatars__go" disabled={!message.trim() || !verdict.ready} onClick={placeMessage}>PLACE MESSAGE ▸</button>
            </div>
          </div>
        ) : (
          <button className="avatars__go shards__compose-open" onClick={() => setComposing(true)}>✎ WRITE A MESSAGE</button>
        )}
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
