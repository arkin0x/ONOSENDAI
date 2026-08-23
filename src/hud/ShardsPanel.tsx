/**
 * ShardsPanel.tsx — your shards, and the door to the workshop.
 */

import { useWorkshop } from '../store/useWorkshop'

export function ShardsPanel(): JSX.Element {
  const shards = useWorkshop((s) => s.shards)

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

      <p className="legend__note">
        A shard is a small object of coloured vertices: triangles in SOLID
        mode, lights in POINTS mode, a polyline in LINES mode. Built on an
        integer grid and kept on this device until deployed.
      </p>
    </section>
  )
}
