/**
 * ShardsPanel.tsx — your shards, and the door to the workshop.
 */

import { useWorkshop } from '../store/useWorkshop'
import { useShards } from '../store/useShards'
import { formatCellSize } from '../lib/scale'

export function ShardsPanel(): JSX.Element {
  const shards = useWorkshop((s) => s.shards)
  const mine = useShards((s) => s.mine)

  return (
    <section className="panel panel--shards">
      <header className="panel__head">
        <h2>Shards</h2>
        <span className="tag">{shards.length} BUILT</span>
      </header>

      <ul className="avatars__list shards__list">
        {shards.map((s) => (
          <li key={s.id} className="shards__row">
            <button className="shards__open" onClick={() => useWorkshop.getState().openWorkshop(s.id)} title="Open in the workshop">
              <span className="avatars__who">{s.name}</span>
              <span className="shards__meta">{s.vertices.length} v · {s.faces.length} f · {s.mode.toUpperCase()} · 2^{s.unit}</span>
            </button>
          </li>
        ))}
        {shards.length === 0 && <li className="avatars__empty">Nothing built yet.</li>}
      </ul>

      <div className="shards__actions">
        <button className="avatars__go" onClick={() => useWorkshop.getState().openWorkshop()}>OPEN WORKSHOP</button>
        <button className="avatars__go" onClick={() => { useWorkshop.getState().create(); useWorkshop.getState().openWorkshop() }}>NEW SHARD</button>
      </div>

      {mine.length > 0 && (
        <div className="shards__deployed">
          <span className="legend__label">Deployed</span>
          <ul className="avatars__list">
            {mine.map((d) => (
              <li key={d.eventId} className="shards__row shards__row--deployed">
                <span className="avatars__who" title={`hidden at height ${d.height}`}>{d.shard.name}</span>
                <span className="shards__meta">{d.height === 0 ? 'exact' : formatCellSize(d.height)} · {d.published ? 'LIVE' : 'LOCAL'}</span>
                <button className="targets__remove" onClick={() => useShards.getState().undeploy(d.eventId)} aria-label="Remove from this device" title="Remove from this device">✕</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="legend__note">
        A shard is a small object of coloured vertices: triangles in SOLID
        mode, lights in POINTS mode, a polyline in LINES mode. Built on an
        integer grid, and deployed hidden at a location: found only by someone
        who computes the region key for where it sits (spec section 7).
      </p>
    </section>
  )
}
