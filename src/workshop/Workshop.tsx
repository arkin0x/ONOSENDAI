/**
 * Workshop.tsx — where shards are made.
 *
 * A full-screen bench over the world. The tools are few and exact, in the
 * order a first visit meets them: STAMP lands a whole shape where you tap
 * (a block, a wedge, a pyramid, a column, a ring, a star, an arrow), sized in
 * whole units and turned a quarter at a time; ADD places one vertex; SELECT
 * picks a point so the pad can nudge it a unit along X, Y or Z, colour it or
 * delete it; FACE collects corners and FILL joins them into a face, any
 * number of corners, notches and all. Colour applies to the selection or to
 * everything. The mode, solid, points or lines, is part of the shard and
 * previews live. Every edit undoes.
 *
 * v1's modeller wanted a mouse: drag handles for every axis, bars to drag for
 * every colour channel. This wants a thumb. Every action is a tap or a button,
 * every position an integer, and the keyboard is a shortcut, not a requirement.
 * The tray shows the row the current tool needs and nothing else, so a phone
 * keeps most of its screen for the bench.
 */

import { useState } from 'react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { Explanation } from '../hud/Explanation'
import { GRID_HALF, MODES, hexToRgb, rgbToHex, toPayload, type ShardMode } from '../lib/shards'
import { formatCellSize } from '../lib/scale'
import { FACED, FACING_LABEL, MAX_SIZE, MIN_SIZE, STAMPS, STAMP_HELP, type StampKind } from '../lib/stamps'
import { useWorkshop, type Tool } from '../store/useWorkshop'
import { useShards } from '../store/useShards'
import { Bench } from './Bench'

const PALETTE = ['#00e5ff', '#ff2323', '#52e39f', '#ffb020', '#c07dff', '#f7931a', '#ffffff', '#2f81f7']

const TOOLS: Tool[] = ['stamp', 'add', 'select', 'face']

const TOOL_HELP: Record<Tool, string> = {
  stamp: 'Tap the grid to place the shape where the ghost shows. Q turns it.',
  add: 'Tap the grid to place a vertex at the current level.',
  select: 'Tap a point, then nudge it with the pad, colour it, or delete it.',
  face: 'Tap the corners of a face in order, then tap the first again, or FILL.',
}

/** Shown once, the first time the workshop opens on this device. */
const INTRO_KEY = 'onosendai:workshop-intro'

function Intro(): JSX.Element | null {
  const [show, setShow] = useState<boolean>(() => { try { return !localStorage.getItem(INTRO_KEY) } catch { return false } })
  if (!show) return null
  const done = (): void => { try { localStorage.setItem(INTRO_KEY, '1') } catch { /* private mode */ } setShow(false) }
  return (
    <div className="workshop__intro" role="note" aria-label="How to make a shard">
      <h3 className="workshop__intro-title">MAKE A SHARD</h3>
      <ol className="workshop__intro-steps">
        <li><b>STAMP</b> a shape: pick one below, tap the grid where the ghost shows.</li>
        <li><b>Drag</b> to look around. <b>LEVEL</b> raises the grid to stack things.</li>
        <li><b>DEPLOY</b> hides it in the world at a place you choose.</li>
      </ol>
      <button className="workshop__btn workshop__intro-ok" onClick={done}>GOT IT</button>
    </div>
  )
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
  const stampKind = useWorkshop((s) => s.stampKind)
  const stampSize = useWorkshop((s) => s.stampSize)
  const stampFacing = useWorkshop((s) => s.stampFacing)
  const canUndo = useWorkshop((s) => s.past.length > 0)
  const canRedo = useWorkshop((s) => s.future.length > 0)
  const notice = useWorkshop((s) => s.notice)
  const [listOpen, setListOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const bind = useRepeatable()

  if (!open) return null
  const w = useWorkshop.getState

  const nudge = (axis: 0 | 1 | 2, d: number) => () => w().moveSelected(axis, d)
  const canNudge = selected !== null
  const say = (notice: string): void => useWorkshop.setState({ notice })

  const copy = (id: string): void => {
    const s = w().shards.find((x) => x.id === id)
    if (!s) return
    navigator.clipboard?.writeText(JSON.stringify(toPayload(s))).then(() => say(`Copied "${s.name}" to the clipboard. PASTE it here or anywhere.`)).catch(() => say('The clipboard is not available here.'))
  }

  const importText = (text: string): void => {
    const id = w().importText(text)
    if (id) { setPasteOpen(false); setPasteText(''); setListOpen(false); say('Pasted as a new shard.') }
    else say('That is not a shard.')
  }

  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) { importText(text); return }
    } catch { /* no permission or no API: fall through to the box */ }
    setPasteOpen(true)
  }

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
          <div className="workshop__list-row">
            <button className="workshop__new" onClick={() => { w().create(); setListOpen(false) }}>+ NEW SHARD</button>
            <button className="workshop__btn" onClick={() => void paste()} title="A shard copied from here or anywhere">PASTE</button>
          </div>
          {pasteOpen && (
            <div className="workshop__paste">
              <textarea
                className="workshop__paste-box"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder='Paste a shard here: {"v":1,"type":"shard",...}'
                aria-label="Shard to import"
                spellCheck={false}
              />
              <div className="workshop__list-row">
                <button className="workshop__btn" disabled={!pasteText.trim()} onClick={() => importText(pasteText)}>IMPORT</button>
                <button className="workshop__btn" onClick={() => { setPasteOpen(false); setPasteText('') }}>CANCEL</button>
              </div>
            </div>
          )}
          <ul>
            {shards.map((s) => (
              <li key={s.id} className={s.id === shard?.id ? 'is-current' : ''}>
                <button className="workshop__pick" onClick={() => { w().select(s.id); setListOpen(false) }}>
                  <span className="workshop__pick-name">{s.name}</span>
                  <span className="workshop__pick-meta">{s.vertices.length} v · {s.faces.length} f · {s.mode}</span>
                </button>
                <button className="workshop__mini" title="Duplicate" onClick={() => w().duplicate(s.id)}>⧉</button>
                <button className="workshop__mini workshop__mini--wide" title="Copy to the clipboard" onClick={() => copy(s.id)}>COPY</button>
                <button className="workshop__mini workshop__mini--danger" title="Delete" onClick={() => { if (window.confirm(`Delete "${s.name}"? This cannot be undone.`)) w().remove(s.id) }}>✕</button>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="workshop__bench">
        <Bench />
        <Intro />
        {shard && (
          <div className="workshop__stats">
            {shard.vertices.length} vertices · {shard.faces.length} faces · unit 2^{shard.unit} = {formatCellSize(shard.unit)}
            {selected !== null && shard.vertices[selected] && (
              <> · selected ({shard.vertices[selected].p.join(', ')})</>
            )}
            {tool === 'face' && facePick.length > 0 && <> · {facePick.length} corner{facePick.length === 1 ? '' : 's'}</>}
            {shard.mode !== 'solid' && shard.faces.length > 0 && <> · faces draw in SOLID</>}
            {notice && <div className="workshop__notice">{notice}</div>}
          </div>
        )}
      </div>

      <div className="workshop__tools">
        <div className="workshop__row" role="group" aria-label="Tool">
          {TOOLS.map((t, i) => (
            <button key={t} className={`workshop__tool ${tool === t ? 'is-on' : ''}`} aria-pressed={tool === t} onClick={() => w().setTool(t)} title={`${t} (${i + 1})`}>
              {t.toUpperCase()}
            </button>
          ))}
          <span className="workshop__gap" />
          <button className="workshop__btn" disabled={!canUndo} onClick={() => w().undo()} title="Undo (Ctrl+Z)">UNDO</button>
          <button className="workshop__btn" disabled={!canRedo} onClick={() => w().redo()} title="Redo (Ctrl+Shift+Z)">REDO</button>
          <span className="workshop__help">{TOOL_HELP[tool]}</span>
          <Explanation>
            A shard is coloured points on a grid of whole units, drawn SOLID (faces, colours blending
            across them), POINTS (every point a light) or LINES (one line through the points in the
            order they were made). STAMP places a whole shape; ADD one point; SELECT a point to move,
            colour or delete it; FACE picks corners and FILL joins them. Stamps keep their own corners
            even where they touch, so a red block against a blue one keeps a crisp edge. UNIT says how
            big one grid unit is in the world, from a picometre to the width of a sector; DEPLOY shows
            the shard at true size before you place it. Keys: 1 2 3 4 tools, Q turns a stamp, WASD /
            RF or arrows nudge, Del deletes, Enter fills, [ ] change the level, Ctrl+Z undoes, Esc
            deselects then closes.
          </Explanation>
        </div>

        {tool === 'stamp' && (
          <div className="workshop__row" role="group" aria-label="Shape">
            <span className="workshop__label">SHAPE</span>
            <div className="workshop__shapes">
              {STAMPS.map((k: StampKind) => (
                <button key={k} className={`workshop__tool ${stampKind === k ? 'is-on' : ''}`} aria-pressed={stampKind === k} onClick={() => w().setStampKind(k)} title={STAMP_HELP[k]}>
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
            <span className="workshop__label workshop__label--gap">SIZE</span>
            <button className="workshop__btn" {...bind(() => w().setStampSize(w().stampSize - 1))} disabled={stampSize <= MIN_SIZE} aria-label="Smaller">−</button>
            <span className="workshop__value">{stampSize}</span>
            <button className="workshop__btn" {...bind(() => w().setStampSize(w().stampSize + 1))} disabled={stampSize >= MAX_SIZE} aria-label="Larger">+</button>
            {FACED[stampKind] && (
              <>
                <span className="workshop__label workshop__label--gap">FACING</span>
                <button className="workshop__btn" onClick={() => w().turnStamp()} title="Turn a quarter (Q)">{FACING_LABEL[stampFacing]} ↻</button>
              </>
            )}
          </div>
        )}

        {tool === 'select' && (
          <div className="workshop__row">
            <span className="workshop__label">NUDGE</span>
            <div className="workshop__pad" role="group" aria-label="Move selected point">
              <button className="workshop__btn workshop__btn--x" disabled={!canNudge} {...bind(nudge(0, -1))} title="−X (A)">−X</button>
              <button className="workshop__btn workshop__btn--x" disabled={!canNudge} {...bind(nudge(0, 1))} title="+X (D)">+X</button>
              <button className="workshop__btn workshop__btn--y" disabled={!canNudge} {...bind(nudge(1, -1))} title="−Y (F)">−Y</button>
              <button className="workshop__btn workshop__btn--y" disabled={!canNudge} {...bind(nudge(1, 1))} title="+Y (R)">+Y</button>
              <button className="workshop__btn workshop__btn--z" disabled={!canNudge} {...bind(nudge(2, -1))} title="−Z (W)">−Z</button>
              <button className="workshop__btn workshop__btn--z" disabled={!canNudge} {...bind(nudge(2, 1))} title="+Z (S)">+Z</button>
            </div>
            <button className="workshop__btn workshop__btn--danger" disabled={!canNudge} onClick={() => w().deleteSelected()} title="Delete point (Del)">DELETE</button>
          </div>
        )}

        {tool === 'face' && (
          <div className="workshop__row">
            <span className="workshop__label">FACE</span>
            <span className="workshop__value workshop__value--wide">{facePick.length} corner{facePick.length === 1 ? '' : 's'}</span>
            <button className="workshop__btn" disabled={facePick.length < 3} onClick={() => w().fill()} title="Join the corners into a face (Enter)">FILL</button>
            <button className="workshop__btn" disabled={facePick.length === 0} onClick={() => w().clearFacePick()} title="Drop the picks (Esc)">CANCEL</button>
          </div>
        )}

        <div className="workshop__row">
          <span className="workshop__label">LEVEL Y</span>
          <button className="workshop__btn" {...bind(() => w().setLevel(w().level - 1))} disabled={level <= -GRID_HALF} aria-label="Level down">−</button>
          <span className="workshop__value">{level}</span>
          <button className="workshop__btn" {...bind(() => w().setLevel(w().level + 1))} disabled={level >= GRID_HALF} aria-label="Level up">+</button>

          <span className="workshop__label workshop__label--gap">UNIT 2^</span>
          <button className="workshop__btn" {...bind(() => w().setUnit((shard?.unit ?? 0) - 1))} disabled={!shard || shard.unit <= 0} aria-label="Smaller unit">−</button>
          <span className="workshop__value">{shard?.unit ?? 0}</span>
          <button className="workshop__btn" {...bind(() => w().setUnit((shard?.unit ?? 0) + 1))} disabled={!shard || shard.unit >= 84} aria-label="Larger unit">+</button>
          <span className="workshop__gap" />
          <button className="workshop__btn workshop__btn--danger" disabled={!shard || shard.vertices.length === 0} onClick={() => { if (window.confirm('Clear every vertex and face of this shard? (UNDO brings it back.)')) w().clearShard() }}>CLEAR</button>
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
      </div>
    </div>
  )
}
