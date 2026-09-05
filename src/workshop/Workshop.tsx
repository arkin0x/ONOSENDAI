/**
 * Workshop.tsx - the shard workshop's shell: the bench full-screen, and the
 * controls as overlays on it, the way the main scene's instruments sit on
 * the world.
 *
 * Top left, a row of chips: MENU (the shard itself: name, mode, the list,
 * clear, explain), TOOLS (STAMP, ADD, SELECT, FACE and each tool's options)
 * and GRID (the level the placing tools work on, the deploy scale multiplier,
 * and the grid's own scale), each opening one panel below the row; UNDO and
 * REDO float beside them. Top right, DEPLOY and the way out. Bottom right,
 * the CONTROLS pad, present only while points are selected: the main pad's
 * shape, nudging the selection in screen directions, with CONNECT and DELETE
 * in its corners; and below it the COLOR bar, gone while FACE is the tool
 * since a face has no color of its own. On a phone the color bar spans the
 * bottom and the pad stacks above it.
 */

import { useEffect, useRef, useState } from 'react'
import { Grid3x3, Link, Menu, MousePointer2, Pipette, Plus, Redo2, Stamp, Trash2, Triangle, Undo2, Wrench, X, type LucideIcon } from 'lucide-react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { ConfirmModal } from '../hud/ConfirmModal'
import { Explanation } from '../hud/Explanation'
import { MAX_EXTENT, MIN_EXTENT, MODES, hexToRgb, neededExtent, rgbToHex, toPayload, type ShardMode } from '../lib/shards'
import { formatCellSize } from '../lib/scale'
import { FACED, FACING_LABEL, MAX_SIZE, MIN_SIZE, STAMPS, STAMP_HELP, type StampKind } from '../lib/stamps'
import { useWorkshop, type Tool } from '../store/useWorkshop'
import { useShards } from '../store/useShards'
import { Bench } from './Bench'
import { nudgeFor, nudgeLabel, useBenchView, type NudgeName } from './benchAxes'

const TOOLS: Tool[] = ['stamp', 'add', 'select', 'face']
const TOOL_ICON: Record<Tool, LucideIcon> = { stamp: Stamp, add: Plus, select: MousePointer2, face: Triangle }

const LONG_PRESS_MS = 550
const SETTLE_MS = 500
const TOAST_MS = 4000

/** One line under the tool row. SELECT needs none: the pad appears when something is selected. */
const TOOL_HELP: Partial<Record<Tool, string>> = {
  stamp: 'Tap the grid to place the shape where the ghost shows. Q turns it.',
  add: 'Tap the grid to place a vertex at the current level.',
  face: 'Tap corners in order, then the first again or FILL. Tap a face to select it; DELETE FACE removes it.',
}

type Panel = 'menu' | 'tools' | 'grid'

const INTRO_KEY = 'onosendai:workshop-intro'

function Intro(): JSX.Element | null {
  const [show, setShow] = useState<boolean>(() => { try { return !localStorage.getItem(INTRO_KEY) } catch { return false } })
  if (!show) return null
  const done = (): void => { try { localStorage.setItem(INTRO_KEY, '1') } catch { /* private mode */ } setShow(false) }
  return (
    <div className="workshop__intro" role="note" aria-label="How to make a shard">
      <h3 className="workshop__intro-title">MAKE A SHARD</h3>
      <ol className="workshop__intro-steps">
        <li><b>STAMP</b> a shape: pick one under TOOLS, tap the grid where the ghost shows.</li>
        <li>One finger <b>orbits</b>, two fingers <b>pan</b>. GRID raises the level to stack things.</li>
        <li><b>DEPLOY</b> hides it in the world at a place you choose.</li>
      </ol>
      <button className="workshop__btn workshop__intro-ok" onClick={done}>GOT IT</button>
    </div>
  )
}

function Swatch({ hex, on, onUse, onHold }: { hex: string; on: boolean; onUse: () => void; onHold: () => void }): JSX.Element {
  const timer = useRef<number>()
  const held = useRef(false)
  const stop = (): void => { window.clearTimeout(timer.current); timer.current = undefined }
  useEffect(() => stop, [])
  return (
    <button
      className={`workshop__swatch ${on ? 'is-on' : ''}`}
      style={{ background: hex }}
      aria-label={`Color ${hex}`}
      aria-pressed={on}
      title={`${hex} (hold to delete)`}
      onPointerDown={() => { held.current = false; stop(); timer.current = window.setTimeout(() => { held.current = true; onHold() }, LONG_PRESS_MS) }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onClick={() => { if (!held.current) onUse() }}
      {...noCallout}
    />
  )
}

/** The store's one-line notice, shown for a moment at the top and then gone. */
function Toast(): JSX.Element | null {
  const notice = useWorkshop((s) => s.notice)
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) { setShown(null); return }
    setShown(notice)
    const t = window.setTimeout(() => setShown(null), TOAST_MS)
    return () => window.clearTimeout(t)
  }, [notice])
  if (!shown) return null
  return <div className="ws__toast" role="status">{shown}</div>
}

/**
 * The CONTROLS pad: the main pad's nine cells, for the selection. Arrows move
 * it a unit in screen directions (the sub-label says which world axis that is
 * right now), the corners CONNECT and DELETE, the hub counts the points and
 * clears them.
 */
function ControlsPad({ points }: { points: number }): JSX.Element {
  const axes = useBenchView((s) => s.axes)
  const bind = useRepeatable()
  const w = useWorkshop.getState
  const move = (name: NudgeName) => () => { const n = nudgeFor(useBenchView.getState().axes, name); w().moveSelected(n.axis, n.delta) }
  const sub = (name: NudgeName): string => nudgeLabel(nudgeFor(axes, name))
  const arrows: Array<{ cell: string; glyph: string; name: NudgeName; key: string }> = [
    { cell: 'away', glyph: '⊗', name: 'away', key: 'R' },
    { cell: 'up', glyph: '▲', name: 'up', key: 'W' },
    { cell: 'toward', glyph: '⊙', name: 'toward', key: 'F' },
    { cell: 'left', glyph: '◀', name: 'left', key: 'A' },
    { cell: 'right', glyph: '▶', name: 'right', key: 'D' },
    { cell: 'down', glyph: '▼', name: 'down', key: 'S' },
  ]
  return (
    <div className="benchpad" role="group" aria-label="Move the selected points">
      {arrows.map((a) => (
        <button key={a.cell} className={`touchpad__key touchpad__key--${a.cell}`} title={`${a.name} (${a.key}): ${sub(a.name)}`} aria-label={`Move ${a.name}, ${sub(a.name)}`} {...bind(move(a.name))}>
          {a.glyph}
          <span className="touchpad__sub">{sub(a.name)}</span>
        </button>
      ))}
      <button className="touchpad__key touchpad__key--connect" title="Select everything joined by faces (C)" aria-label="Select connected" {...noCallout} onClick={() => w().selectConnected()}>
        <Link size={14} strokeWidth={2.25} aria-hidden />
        <span className="touchpad__sub">JOINED</span>
      </button>
      <button className="touchpad__key touchpad__key--delete" title="Delete the selected points (Del)" aria-label="Delete selected" {...noCallout} onClick={() => w().deleteSelected()}>
        <Trash2 size={14} strokeWidth={2.25} aria-hidden />
        <span className="touchpad__sub">DELETE</span>
      </button>
      <button className="touchpad__hub" title="Clear the selection (Esc)" aria-label={`${points} points selected. Tap to clear.`} {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); w().selectVertex(null) }}>
        {points} {points === 1 ? 'PT' : 'PTS'}
      </button>
    </div>
  )
}

export function Workshop(): JSX.Element | null {
  const open = useWorkshop((s) => s.open)
  const shard = useWorkshop((s) => s.current())
  const shards = useWorkshop((s) => s.shards)
  const tool = useWorkshop((s) => s.tool)
  const selection = useWorkshop((s) => s.selection)
  const facePick = useWorkshop((s) => s.facePick)
  const selectedFace = useWorkshop((s) => s.selectedFace)
  const palette = useWorkshop((s) => s.palette)
  const level = useWorkshop((s) => s.level)
  const color = useWorkshop((s) => s.color)
  const stampKind = useWorkshop((s) => s.stampKind)
  const stampSize = useWorkshop((s) => s.stampSize)
  const stampFacing = useWorkshop((s) => s.stampFacing)
  const canUndo = useWorkshop((s) => s.past.length > 0)
  const canRedo = useWorkshop((s) => s.future.length > 0)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [deleteColor, setDeleteColor] = useState<string | null>(null)
  const settle = useRef<number>()
  const picked = useRef(false)
  useEffect(() => () => window.clearTimeout(settle.current), [])
  const bind = useRepeatable()

  if (!open) return null
  const w = useWorkshop.getState
  const say = (notice: string): void => useWorkshop.setState({ notice })
  const toggle = (p: Panel): void => setPanel((cur) => (cur === p ? null : p))

  const selectedPoints = shard ? new Set(selection.map((i) => shard.vertices[i]?.p.join(','))).size : 0
  const extent = shard?.extent ?? MIN_EXTENT
  const minExtent = shard ? Math.max(MIN_EXTENT, neededExtent(shard)) : MIN_EXTENT

  // The picker paints live and, once the wheel has settled, puts the color at
  // the front of the palette; leaving the picker settles it at once.
  const hex = rgbToHex(color)
  const pick = (value: string): void => {
    w().colorSelected(hexToRgb(value))
    picked.current = true
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => { picked.current = false; w().rememberColor(value) }, SETTLE_MS)
  }
  const settled = (value: string): void => {
    if (!picked.current) return
    window.clearTimeout(settle.current)
    picked.current = false
    w().rememberColor(value)
  }

  const copy = (id: string): void => {
    const s = w().shards.find((x) => x.id === id)
    if (!s) return
    navigator.clipboard?.writeText(JSON.stringify(toPayload(s))).then(() => say(`Copied "${s.name}" to the clipboard. PASTE it here or anywhere.`)).catch(() => say('The clipboard is not available here.'))
  }
  const importText = (text: string): void => {
    const id = w().importText(text)
    if (id) { setPasteOpen(false); setPasteText(''); say('Pasted as a new shard.') }
    else say('That is not a shard.')
  }
  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) { importText(text); return }
    } catch { /* no permission or no API: fall through to the box */ }
    setPasteOpen(true)
  }

  const facing = tool === 'face' && selection.length === 0 && (selectedFace !== null || facePick.length > 0)

  return (
    <div className="workshop" role="dialog" aria-label="Shard workshop">
      <div className="workshop__bench">
        <Bench />
      </div>
      <Intro />
      <Toast />

      {/* Top left: the three chips and the history in one row, wrapping on a phone,
          and the open panel under whatever the row wrapped to. */}
      <div className="ws__top">
      <div className="ws__chips">
        <button className={`chip ws__chip ${panel === 'menu' ? 'is-on' : ''}`} aria-pressed={panel === 'menu'} onClick={() => toggle('menu')}>
          <Menu size={12} strokeWidth={2.25} aria-hidden />MENU
        </button>
        <button className={`chip ws__chip ${panel === 'tools' ? 'is-on' : ''}`} aria-pressed={panel === 'tools'} onClick={() => toggle('tools')}>
          <Wrench size={12} strokeWidth={2.25} aria-hidden />TOOLS · {tool.toUpperCase()}
        </button>
        <button className={`chip ws__chip ${panel === 'grid' ? 'is-on' : ''}`} aria-pressed={panel === 'grid'} onClick={() => toggle('grid')}>
          <Grid3x3 size={12} strokeWidth={2.25} aria-hidden />GRID
        </button>
        <span className="ws__history">
          <button className="chip ws__icon" disabled={!canUndo} onClick={() => w().undo()} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={15} strokeWidth={2.25} aria-hidden /></button>
          <button className="chip ws__icon" disabled={!canRedo} onClick={() => w().redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={15} strokeWidth={2.25} aria-hidden /></button>
        </span>
      </div>
      {panel === 'menu' && shard && (
        <div className="ws__panel" role="region" aria-label="Menu">
          <input className="workshop__name" value={shard.name} onChange={(e) => w().rename(shard.id, e.target.value)} aria-label="Shard name" spellCheck={false} />
          <div className="ws__stats">
            {shard.vertices.length} vertices · {shard.faces.length} faces · unit 2^{shard.unit} = {formatCellSize(shard.unit)}
            {shard.mode !== 'solid' && shard.faces.length > 0 && <> · faces draw in SOLID</>}
          </div>
          <div className="workshop__row">
            <span className="workshop__label">DRAW</span>
            <div className="workshop__modes" role="group" aria-label="Render mode">
              {MODES.map((m: ShardMode) => (
                <button key={m} className={`workshop__mode ${shard.mode === m ? 'is-on' : ''}`} aria-pressed={shard.mode === m} onClick={() => w().setMode(m)}>{m.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div className="ws__panel-title">SHARDS ({shards.length})</div>
          <div className="workshop__list-row">
            <button className="workshop__new" onClick={() => w().create()}>+ NEW SHARD</button>
            <button className="workshop__btn" onClick={() => void paste()} title="A shard copied from here or anywhere">PASTE</button>
          </div>
          {pasteOpen && (
            <div className="workshop__paste">
              <textarea className="workshop__paste-box" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder='Paste a shard here: {"v":1,"type":"shard",...}' aria-label="Shard to import" spellCheck={false} />
              <div className="workshop__list-row">
                <button className="workshop__btn" disabled={!pasteText.trim()} onClick={() => importText(pasteText)}>IMPORT</button>
                <button className="workshop__btn" onClick={() => { setPasteOpen(false); setPasteText('') }}>CANCEL</button>
              </div>
            </div>
          )}
          <ul className="workshop__list">
            {shards.map((s) => (
              <li key={s.id} className={s.id === shard.id ? 'is-current' : ''}>
                <button className="workshop__pick" onClick={() => w().select(s.id)}>
                  <span className="workshop__pick-name">{s.name}</span>
                  <span className="workshop__pick-meta">{s.vertices.length} v · {s.faces.length} f · {s.mode}</span>
                </button>
                <button className="workshop__mini" title="Duplicate" onClick={() => w().duplicate(s.id)}>⧉</button>
                <button className="workshop__mini workshop__mini--wide" title="Copy to the clipboard" onClick={() => copy(s.id)}>COPY</button>
                <button className="workshop__mini workshop__mini--danger" title="Delete" onClick={() => { if (window.confirm(`Delete "${s.name}"? This cannot be undone.`)) w().remove(s.id) }}>×</button>
              </li>
            ))}
          </ul>
          <div className="workshop__row">
            <button className="workshop__btn workshop__btn--danger" disabled={shard.vertices.length === 0} onClick={() => { if (window.confirm('Clear every vertex and face of this shard?')) w().clearShard() }} title="Empty this shard (undoable)">CLEAR SHARD</button>
            <span className="workshop__gap" />
            <Explanation>
              A shard is colored points on a grid of whole units, drawn SOLID (faces, colors blending
              across them), POINTS (every point a light) or LINES (one line through the points in the
              order they were made). STAMP places a whole shape; ADD one point; SELECT points, by tap
              or by dragging a box, to move, color or delete them together, and CONNECT takes everything
              faces join to them; FACE picks corners and FILL joins them, and a tap on a face selects it
              for DELETE FACE. The palette keeps every color the picker settles on; hold a swatch to
              delete it. Stamps keep their own corners even where they touch, so a red block against a
              blue one keeps a crisp edge. Under GRID, LEVEL is the height the placing tools work at,
              DEPLOY SCALE MULTIPLIER says how big one grid unit is in the world, from a picometre to
              the width of a sector, and SCALE is how far the grid reaches from the origin. DEPLOY shows
              the shard at true size before you place it. Keys: 1 2 3 4 tools, Q turns a stamp, WASD and
              RF or the arrows nudge the selection in screen directions, C selects what faces join, Del
              deletes, Enter fills, [ ] change the level, Ctrl+Z undoes, Esc clears then closes.
            </Explanation>
          </div>
        </div>
      )}

      {panel === 'tools' && (
        <div className="ws__panel" role="region" aria-label="Tools">
          <div className="workshop__row" role="group" aria-label="Tool">
            {TOOLS.map((t, i) => {
              const Icon = TOOL_ICON[t]
              return (
                <button key={t} className={`workshop__tool ${tool === t ? 'is-on' : ''}`} aria-pressed={tool === t} onClick={() => w().setTool(t)} title={`${t} (${i + 1})`}>
                  <Icon size={12} strokeWidth={2.25} aria-hidden />{t.toUpperCase()}
                </button>
              )
            })}
          </div>
          {TOOL_HELP[tool] && <div className="workshop__help">{TOOL_HELP[tool]}</div>}
          {tool === 'stamp' && (
            <>
              <div className="workshop__row" role="group" aria-label="Shape">
                <span className="workshop__label">SHAPE</span>
                <div className="workshop__shapes">
                  {STAMPS.map((k: StampKind) => (
                    <button key={k} className={`workshop__tool ${stampKind === k ? 'is-on' : ''}`} aria-pressed={stampKind === k} onClick={() => w().setStampKind(k)} title={STAMP_HELP[k]}>{k.toUpperCase()}</button>
                  ))}
                </div>
              </div>
              <div className="workshop__row">
                <span className="workshop__label">SIZE</span>
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
            </>
          )}
        </div>
      )}

      {panel === 'grid' && shard && (
        <div className="ws__panel" role="region" aria-label="Grid">
          <div className="workshop__row">
            <span className="workshop__label">LEVEL Y</span>
            <button className="workshop__btn" {...bind(() => w().setLevel(w().level - 1))} disabled={level <= -extent} aria-label="Level down">−</button>
            <span className="workshop__value">{level}</span>
            <button className="workshop__btn" {...bind(() => w().setLevel(w().level + 1))} disabled={level >= extent} aria-label="Level up">+</button>
            <span className="workshop__unit-size">the height the placing tools work at</span>
          </div>
          <div className="workshop__row">
            <span className="workshop__label">DEPLOY SCALE MULTIPLIER</span>
            <span className="workshop__value">2^</span>
            <button className="workshop__btn" {...bind(() => w().setUnit((w().current()?.unit ?? 0) - 1))} disabled={shard.unit <= 0} aria-label="Smaller unit">−</button>
            <span className="workshop__value">{shard.unit}</span>
            <button className="workshop__btn" {...bind(() => w().setUnit((w().current()?.unit ?? 0) + 1))} disabled={shard.unit >= 84} aria-label="Larger unit">+</button>
            <span className="workshop__unit-size" title="What one grid unit is in the world. DEPLOY shows the shard at this size.">one unit = {formatCellSize(shard.unit)}</span>
          </div>
          <div className="workshop__row">
            <span className="workshop__label">SCALE</span>
            <button className="workshop__btn" {...bind(() => w().setExtent((w().current()?.extent ?? MIN_EXTENT) - 1))} disabled={extent <= minExtent} aria-label="Smaller grid">−</button>
            <span className="workshop__value">{extent}</span>
            <button className="workshop__btn" {...bind(() => w().setExtent((w().current()?.extent ?? MIN_EXTENT) + 1))} disabled={extent >= MAX_EXTENT} aria-label="Larger grid">+</button>
            <span className="workshop__unit-size" title="Saved with the shard. Never below what its points need.">gibsons each side of each axis</span>
          </div>
        </div>
      )}

      </div>

      {/* Top right: the way out, and the way into the world. */}
      <div className="ws__exit">
        <button
          className="workshop__deploy"
          disabled={!shard || shard.vertices.length === 0}
          onClick={() => { if (shard) { useShards.getState().startDeployShard(shard.id); w().closeWorkshop() } }}
          title="Place this shard in the world"
        >DEPLOY ▸</button>
        <button className="chip ws__icon" onClick={() => w().closeWorkshop()} title="Close the workshop (Esc)" aria-label="Close"><X size={15} strokeWidth={2.25} aria-hidden /></button>
      </div>

      {/* Bottom right: the pad while points are selected, face actions while a face is in hand, the color bar under either. */}
      <div className="ws__corner">
        {selection.length > 0 && <ControlsPad points={selectedPoints} />}
        {facing && selectedFace !== null && (
          <div className="benchops" role="group" aria-label="Selected face">
            <span className="workshop__value workshop__value--wide">face {selectedFace + 1} of {shard?.faces.length ?? 0}</span>
            <button className="workshop__btn workshop__btn--danger" onClick={() => w().deleteSelectedFace()} title="Remove this face (Del)">DELETE FACE</button>
            <button className="workshop__btn" onClick={() => w().selectFace(null)} title="Keep it (Esc)">CANCEL</button>
          </div>
        )}
        {facing && selectedFace === null && (
          <div className="benchops" role="group" aria-label="Face corners">
            <span className="workshop__value workshop__value--wide">{facePick.length} corner{facePick.length === 1 ? '' : 's'}</span>
            <button className="workshop__btn" disabled={facePick.length < 3} onClick={() => w().fill()} title="Join the corners into a face (Enter)">FILL</button>
            <button className="workshop__btn" onClick={() => w().clearFacePick()} title="Drop the picks (Esc)">CANCEL</button>
          </div>
        )}
        {tool !== 'face' && (
          <div className="ws__color" role="group" aria-label="Color">
            <span className="workshop__label">COLOR</span>
            <span className="workshop__picker" title="Pick any color; it joins the palette">
              <input type="color" className="workshop__color" value={hex} list="workshop-palette" onChange={(e) => pick(e.target.value)} onBlur={(e) => settled(e.target.value)} aria-label="Pick a color" {...noCallout} />
              <Pipette className="workshop__picker-icon" size={13} strokeWidth={2.25} aria-hidden />
              <datalist id="workshop-palette">{palette.map((h) => <option key={h} value={h} />)}</datalist>
            </span>
            <div className="workshop__swatches">
              {palette.map((h) => (
                <Swatch key={h} hex={h} on={h === hex} onUse={() => w().colorSelected(hexToRgb(h))} onHold={() => setDeleteColor(h)} />
              ))}
            </div>
            <button className="workshop__btn" disabled={!shard || shard.vertices.length === 0} onClick={() => w().colorAll(w().color)} title="Apply the color to every vertex">ALL</button>
          </div>
        )}
      </div>

      {deleteColor !== null && (
        <ConfirmModal
          title="Delete color from palette?"
          body={<><span className="workshop__swatch workshop__swatch--sample" style={{ background: deleteColor }} aria-hidden />{deleteColor} leaves the palette. Vertices already painted with it keep it.</>}
          confirmLabel="DELETE"
          onConfirm={() => { w().forgetColor(deleteColor); setDeleteColor(null) }}
          onCancel={() => setDeleteColor(null)}
        />
      )}
    </div>
  )
}
