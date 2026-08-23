/**
 * ShardsPanel.tsx — your shards, in two kinds.
 *
 * A MODEL is a named design that lives on this device: you open it in the
 * workshop, edit it, and deploy copies of it. A DEPLOYED instance is one such
 * copy placed at a coordinate and published to the relay; one model can have
 * many. Deleting a model and deleting an instance are different acts, so they
 * live in different sections and warn about different things: a model delete
 * is local and forever, an instance delete reaches the relay but leaves the
 * model be. Tapping a deployment flies the scene to it and opens its record.
 */

import { useState } from 'react'
import { formatCellSize } from '../lib/scale'
import { ConfirmModal } from './ConfirmModal'
import { useCyberspace } from '../store/useCyberspace'
import { useShards, type MyDeployment } from '../store/useShards'
import { useWorkshop } from '../store/useWorkshop'

/** The coordinate a deployment sits at, from its stored strings. */
function positionOf(d: MyDeployment): { x: bigint; y: bigint; z: bigint } {
  return { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }
}

export function ShardsPanel(): JSX.Element {
  const models = useWorkshop((s) => s.shards)
  const mine = useShards((s) => s.mine)
  const inspecting = useShards((s) => s.inspecting)
  const [deleteModel, setDeleteModel] = useState<string | null>(null)

  const target = models.find((m) => m.id === deleteModel)
  const deployedCount = (id: string): number => mine.filter((d) => d.shard.id === id).length

  const goTo = (d: MyDeployment): void => {
    useShards.getState().inspect(d.eventId)
    useCyberspace.getState().focusOn(positionOf(d), d.plane, d.shard.name, d.shard.unit)
  }

  return (
    <section className="panel panel--shards">
      <header className="panel__head">
        <h2>Shards</h2>
        <span className="tag">{models.length} MODEL{models.length === 1 ? '' : 'S'}</span>
      </header>

      <div className="shards__section">
        <span className="legend__label">Models — designs on this device</span>
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

      {mine.length > 0 && (
        <div className="shards__section">
          <span className="legend__label">Deployed — instances in cyberspace</span>
          <ul className="avatars__list">
            {mine.map((d) => (
              <li key={d.eventId} className={`shards__row shards__row--deployed ${inspecting === d.eventId ? 'is-viewing' : ''}`}>
                <button className="shards__goto" onClick={() => goTo(d)} title="Fly to it and see its wire record">
                  <span className="avatars__who">{d.shard.name}</span>
                  <span className="shards__meta">
                    {d.height === 0 ? 'exact gibson' : formatCellSize(d.height)} · {d.published ? 'LIVE' : 'LOCAL'}
                    {d.plane === 1 ? ' · ideaspace' : ''}
                  </span>
                </button>
                <span className="shards__goto-hint" aria-hidden="true">▸</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="legend__note">
        A shard is coloured vertices: triangles in SOLID, lights in POINTS, a
        polyline in LINES. Models stay here; a deployed instance is hidden at a
        location and found only by someone who computes its region key (spec
        section 7). Tap a deployment to fly to it.
      </p>

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
