/**
 * Workshop.tsx — where shards are made.
 *
 * A full-screen bench over the world. The tools are few and exact: ADD
 * places a vertex where you tap the grid, at the current level; SELECT picks
 * one and the pad nudges it a unit along X, Y or Z; FACE joins three taps
 * into a triangle. Colour applies to the selection or to everything. The
 * mode, solid, points or lines, is part of the shard and previews live.
 *
 * v1's modeller wanted a mouse: drag handles for every axis, bars to drag for
 * every colour channel. This wants a thumb. Every action is a tap or a button,
 * every position an integer, and the keyboard is a shortcut, not a requirement.
 */

import { useState } from 'react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { GRID_HALF, MODES, hexToRgb, rgbToHex, type ShardMode } from '../lib/shards'
import { formatCellSize } from '../lib/scale'
import { useWorkshop, type Tool } from '../store/useWorkshop'
import { useShards } from '../store/useShards'
import { Bench } from './Bench'

const PALETTE = ['#00e5ff', '#ff2323', '#52e39f', '#ffb020', '#c07dff', '#f7931a', '#ffffff', '#2f81f7']

const TOOL_HELP: Record<Tool, string> = {
  add: 'Tap the grid to place a vertex at the current level.',
  select: 'Tap a vertex, then nudge it with the pad, colour it, or delete it.',
  face: 'Tap three vertices to make a triangle. Faces draw in SOLID mode.',
}

export function Workshop(): JSX.Element | null {
  const open = useWorkshop((s) => s.open)
  const shard = useWorkshop((s) => s.current())
  const shards = useWorkshop((s) => s.shards)
  const tool = useWorkshop((s) => s.tool)
  const selected = useWorkshop((s) => s.selected)
  const facePick = useWorkshop((s) => s.facePick)
  const level = useWorkshop((s) => s.level)
  const color = useWorkshop((s) => s.color)
  const [listOpen, setListOpen] = useState(false)
  const bind = useRepeatable()

  if (!open) return null
  const w = useWorkshop.getState

  const nudge = (axis: 0 | 1 | 2, d: number) => () => w().moveSelected(axis, d)
  const canNudge = selected !== null

  return (
    <div className="workshop" role="dialog" aria-label="Shard workshop">
      <header className="workshop__head">
        <button className="workshop__list-btn" onClick={() => setListOpen((v) => !v)} aria-expanded={listOpen}>
          SHARDS ({shards.length})
        </button>
        {shard && (
          <input
            className="workshop__name"
            value={shard.name}
            onChange={(e) => w().rename(shard.id, e.target.value)}
            aria-label="Shard name"
            spellCheck={false}
          />
        )}
        <div className="workshop__modes" role="group" aria-label="Render mode">
          {MODES.map((m: ShardMode) => (
            <button key={m} className={`workshop__mode ${shard?.mode === m ? 'is-on' : ''}`} aria-pressed={shard?.mode === m} onClick={() => w().setMode(m)}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          className="workshop__deploy"
          disabled={!shard || shard.vertices.length === 0}
          onClick={() => { if (shard) { useShards.getState().startDeployShard(shard.id); w().closeWorkshop() } }}
          title="Place this shard in the world"
        >DEPLOY ▸</button>
        <button className="workshop__close" onClick={() => w().closeWorkshop()}>CLOSE</button>
      </header>

      {listOpen && (
        <aside className="workshop__list">
          <button className="workshop__new" onClick={() => { w().create(); setListOpen(false) }}>+ NEW SHARD</button>
          <ul>
            {shards.map((s) => (
              <li key={s.id} className={s.id === shard?.id ? 'is-current' : ''}>
                <button className="workshop__pick" onClick={() => { w().select(s.id); setListOpen(false) }}>
                  <span className="workshop__pick-name">{s.name}</span>
                  <span className="workshop__pick-meta">{s.vertices.length} v · {s.faces.length} f · {s.mode}</span>
                </button>
                <button className="workshop__mini" title="Duplicate" onClick={() => w().duplicate(s.id)}>⧉</button>
                <button className="workshop__mini workshop__mini--danger" title="Delete" onClick={() => { if (window.confirm(`Delete "${s.name}"? This cannot be undone.`)) w().remove(s.id) }}>✕</button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="workshop__bench">
        <Bench />
        {shard && (
          <div className="workshop__stats">
            {shard.vertices.length} vertices · {shard.faces.length} faces · unit 2^{shard.unit} = {formatCellSize(shard.unit)}
            {selected !== null && shard.vertices[selected] && (
              <> · selected #{selected} at ({shard.vertices[selected].p.join(', ')})</>
            )}
            {tool === 'face' && facePick.length > 0 && <> · face {facePick.length}/3</>}
          </div>
        )}
      </div>

      <div className="workshop__tools">
        <div className="workshop__row" role="group" aria-label="Tool">
          {(['add', 'select', 'face'] as Tool[]).map((t, i) => (
            <button key={t} className={`workshop__tool ${tool === t ? 'is-on' : ''}`} aria-pressed={tool === t} onClick={() => w().setTool(t)} title={`${t} (${i + 1})`}>
              {t.toUpperCase()}
            </button>
          ))}
          <span className="workshop__help">{TOOL_HELP[tool]}</span>
        </div>

        <div className="workshop__row">
          <span className="workshop__label">LEVEL Y</span>
          <button className="workshop__btn" {...bind(() => w().setLevel(w().level - 1))} disabled={level <= -GRID_HALF} aria-label="Level down">−</button>
          <span className="workshop__value">{level}</span>
          <button className="workshop__btn" {...bind(() => w().setLevel(w().level + 1))} disabled={level >= GRID_HALF} aria-label="Level up">+</button>

          <span className="workshop__label workshop__label--gap">UNIT 2^</span>
          <button className="workshop__btn" {...bind(() => w().setUnit((shard?.unit ?? 0) - 1))} disabled={!shard || shard.unit <= 0} aria-label="Smaller unit">−</button>
          <span className="workshop__value">{shard?.unit ?? 0}</span>
          <button className="workshop__btn" {...bind(() => w().setUnit((shard?.unit ?? 0) + 1))} disabled={!shard || shard.unit >= 84} aria-label="Larger unit">+</button>
        </div>

        <div className="workshop__row">
          <span className="workshop__label">NUDGE</span>
          <div className="workshop__pad" role="group" aria-label="Move selected vertex">
            <button className="workshop__btn workshop__btn--x" disabled={!canNudge} {...bind(nudge(0, -1))} title="−X (A)">−X</button>
            <button className="workshop__btn workshop__btn--x" disabled={!canNudge} {...bind(nudge(0, 1))} title="+X (D)">+X</button>
            <button className="workshop__btn workshop__btn--y" disabled={!canNudge} {...bind(nudge(1, -1))} title="−Y (F)">−Y</button>
            <button className="workshop__btn workshop__btn--y" disabled={!canNudge} {...bind(nudge(1, 1))} title="+Y (R)">+Y</button>
            <button className="workshop__btn workshop__btn--z" disabled={!canNudge} {...bind(nudge(2, -1))} title="−Z (W)">−Z</button>
            <button className="workshop__btn workshop__btn--z" disabled={!canNudge} {...bind(nudge(2, 1))} title="+Z (S)">+Z</button>
          </div>
          <button className="workshop__btn workshop__btn--danger" disabled={!canNudge} onClick={() => w().deleteSelected()} title="Delete vertex (Del)">DELETE</button>
        </div>

        <div className="workshop__row">
          <span className="workshop__label">COLOUR</span>
          <input
            type="color"
            className="workshop__color"
            value={rgbToHex(color)}
            onChange={(e) => w().colorSelected(hexToRgb(e.target.value))}
            aria-label="Vertex colour"
            {...noCallout}
          />
          <div className="workshop__swatches">
            {PALETTE.map((hex) => (
              <button key={hex} className="workshop__swatch" style={{ background: hex }} aria-label={`Colour ${hex}`} onClick={() => w().colorSelected(hexToRgb(hex))} />
            ))}
          </div>
          <button className="workshop__btn" disabled={!shard || shard.vertices.length === 0} onClick={() => w().colorAll(w().color)} title="Apply the colour to every vertex">ALL</button>
        </div>

        <div className="workshop__row">
          <span className="workshop__label">FACES</span>
          <span className="workshop__value">{shard?.faces.length ?? 0}</span>
          <button className="workshop__btn" disabled={!shard || shard.faces.length === 0} onClick={() => w().removeLastFace()}>UNDO LAST</button>
          <button className="workshop__btn workshop__btn--danger" disabled={!shard || shard.vertices.length === 0} onClick={() => { if (window.confirm('Clear every vertex and face of this shard?')) w().clearShard() }}>CLEAR</button>
        </div>
      </div>
    </div>
  )
}
