/**
 * ShardsPanel.tsx — your shards and hidden messages, in kinds.
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
import { messagePreview, MAX_MESSAGE_LENGTH } from '../lib/hidden'
import { ConfirmModal } from './ConfirmModal'
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

export function ShardsPanel(): JSX.Element {
  const models = useWorkshop((s) => s.shards)
  const mine = useShards((s) => s.mine)
  const inspecting = useShards((s) => s.inspecting)
  const scanning = useShards((s) => s.scanning)
  const discovered = useShards((s) => s.discovered)
  const [deleteModel, setDeleteModel] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [message, setMessage] = useState('')

  const target = models.find((m) => m.id === deleteModel)
  const deployedCount = (id: string): number => mine.filter((d) => d.type === 'shard' && d.shard?.id === id).length
  const foundCount = Object.keys(discovered).length

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
        <h2>Shards &amp; messages</h2>
        <span className={`tag ${scanning ? 'tag--scan' : ''}`}>{scanning ? 'SCANNING' : `${foundCount} FOUND`}</span>
      </header>

      <div className="shards__section">
        <span className="legend__label">Models — shard designs on this device</span>
        <ul className="avatars__list shards__list">
          {models.map((m) => {
            const n = deployedCount(m.id)
            return (
              <li key={m.id} className="shards__row">
                <button className="shards__open" onClick={() => useWorkshop.getState().openWorkshop(m.id)} title="Open in the workshop">
                  <span className="avatars__who">{m.name}</span>
                  <span className="shards__meta">{m.vertices.length} v · {m.faces.length} f · {m.mode.toUpperCase()} · 2^{m.unit}{n > 0 ? ` · ${n} deployed` : ''}</span>
                </button>
                <button className="targets__remove" onClick={() => setDeleteModel(m.id)} aria-label="Delete model" title="Delete this model">✕</button>
              </li>
            )
          })}
          {models.length === 0 && <li className="avatars__empty">Nothing built yet.</li>}
        </ul>
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
            <div className="shards__actions">
              <button className="avatars__go" onClick={() => { setComposing(false); setMessage('') }}>CANCEL</button>
              <button className="avatars__go" disabled={!message.trim()} onClick={placeMessage}>PLACE MESSAGE ▸</button>
            </div>
          </div>
        ) : (
          <button className="avatars__go shards__compose-open" onClick={() => setComposing(true)}>✎ WRITE A MESSAGE</button>
        )}
      </div>

      {mine.length > 0 && (
        <div className="shards__section">
          <span className="legend__label">Deployed — hidden in cyberspace</span>
          <ul className="avatars__list">
            {mine.map((d) => (
              <li key={d.eventId} className={`shards__row shards__row--deployed ${inspecting === d.eventId ? 'is-viewing' : ''}`}>
                <button className="shards__goto" onClick={() => goTo(d)} title="Fly to it and see its wire record">
                  <span className="avatars__who">
                    <span className={`shards__type shards__type--${d.type}`}>{d.type === 'message' ? '✎' : '◇'}</span>
                    {depName(d)}
                  </span>
                  <span className="shards__meta">
                    {d.height === 0 ? 'exact gibson' : formatCellSize(d.height)} · {d.published ? 'LIVE' : 'LOCAL'}{d.plane === 1 ? ' · ideaspace' : ''}
                  </span>
                </button>
                <span className="shards__goto-hint" aria-hidden="true">▸</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Explanation>
        A shard is coloured vertices (SOLID / POINTS / LINES); a message is text.
        Both are hidden at a location and found only by someone who computes its
        region key (spec section 7). Tap a deployment to fly to it and prove it
        with TEST DISCOVERY. FOUND counts the items your own scans have opened
        this session, at every place you have looked, not only where you stand
        now.
      </Explanation>

      {target && (
        <ConfirmModal
          title={`Delete the model "${target.name}"?`}
          body={`This removes the model and its ${target.vertices.length} vertices from this device for good — it is not the same as removing a deployed copy. ${deployedCount(target.id) > 0 ? `Its ${deployedCount(target.id)} deployed instance${deployedCount(target.id) === 1 ? ' stays' : 's stay'} in cyberspace; delete those from the Deployed list.` : 'It has no deployed instances.'}`}
          confirmLabel="DELETE MODEL"
          onConfirm={() => { useWorkshop.getState().remove(target.id); setDeleteModel(null) }}
          onCancel={() => setDeleteModel(null)}
        />
      )}
    </section>
  )
}
