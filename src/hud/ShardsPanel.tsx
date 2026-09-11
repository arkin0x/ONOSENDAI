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
import { formatCellSize } from '../lib/scale'
import { cashuLabel } from '../lib/cashu'
import { cashuStateLabel, composeVerdict, SETTLE_MS, useCashu } from './useCashu'
import { useSettled } from './useSettled'
import { messagePreview, MAX_MESSAGE_LENGTH } from '../lib/hidden'
import { useCyberspace } from '../store/useCyberspace'
import { useShards, type MyDeployment } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'
import { Explanation } from './Explanation'

function positionOf(d: MyDeployment): { x: bigint; y: bigint; z: bigint } {
  return { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }
}

function depName(d: MyDeployment): string {
  return d.type === 'message' ? messagePreview(d.text ?? '', 24) : d.shard?.name ?? 'shard'
}

/**
 * One hidden thing in the STASH. A message carrying a Cashu token shows the
 * coin instead of the pen, what it holds, and whether anyone has taken it:
 * the mint says which proofs are spent (useCashu), so REDEEMED means found.
 * The coin is decided by the token being there, not by its being readable:
 * one this client cannot decode still shows the mark, reads "cashu token",
 * and says UNREADABLE, the same rule the world and the loot list follow.
 */
function DeployedRow({ d, viewing, onGo }: { d: MyDeployment; viewing: boolean; onGo: () => void }): JSX.Element {
  const cashu = useCashu(d.type === 'message' ? d.text : null)
  const coin = cashu.found
  const live = useCyberspace((s) => s.live)
  const broadcasting = useShards((s) => s.broadcasting) === d.lookupId
  return (
    <li className={`shards__row shards__row--deployed ${viewing ? 'is-viewing' : ''}`}>
      <button className="shards__goto" onClick={onGo} title="Fly to it and see its wire record">
        <span className="avatars__who">
          <span className={`shards__type shards__type--${coin ? 'cashu' : d.type}`}>{coin ? '₿' : d.type === 'message' ? '✎' : '◇'}</span>
          {coin ? (cashu.token ? cashuLabel(cashu.token) : 'cashu token') : depName(d)}
        </span>
        <span className="shards__meta">
          {d.height === 0 ? 'exact gibson' : formatCellSize(d.height)} · {d.published ? 'LIVE' : 'LOCAL'}{d.plane === 1 ? ' · ideaspace' : ''}
          {coin && <> · <span className={`shards__cashu shards__cashu--${cashu.state}`}>{cashuStateLabel(cashu.state)}</span></>}
        </span>
      </button>
      {/* Deployed while LOCAL: signed and kept, never sent. This sends it. */}
      {!d.published && live && (
        <button
          className="shards__broadcast"
          disabled={broadcasting}
          onClick={() => { void useShards.getState().broadcast(d.lookupId) }}
          title="Send this region's bag to the relays now"
        >{broadcasting ? 'SENDING' : 'BROADCAST'}</button>
      )}
      <span className="shards__goto-hint" aria-hidden="true">▸</span>
    </li>
  )
}

export function ShardsPanel(): JSX.Element {
  const mine = useShards((s) => s.mine)
  const inspecting = useShards((s) => s.inspecting)
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

  const goTo = (d: MyDeployment): void => {
    useShards.getState().inspect(d.eventId)
    const unit = d.type === 'shard' ? d.shard?.unit ?? 0 : 0
    useCyberspace.getState().focusOn(positionOf(d), d.plane, depName(d), unit)
  }

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
        <div className="shards__actions">
          <button className="avatars__go" onClick={() => useWorkshop.getState().openWorkshop()}>OPEN WORKSHOP</button>
          <button className="avatars__go" onClick={() => { useWorkshop.getState().create(); useWorkshop.getState().openWorkshop() }}>NEW MODEL</button>
        </div>
      </div>

      <div className="shards__section">
        <span className="legend__label">Leave a hidden message</span>
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
            {mine.map((d) => (
              <DeployedRow key={d.eventId} d={d} viewing={inspecting === d.eventId} onGo={() => goTo(d)} />
            ))}
          </ul>
        </div>
      )}

      <Explanation>
        Build 3D objects (shards), messages, and encrypt them at a location in
        cyberspace for others to find.
      </Explanation>
    </section>
  )
}
