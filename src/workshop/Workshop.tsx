/**
 * Workshop.tsx - the shard workshop's shell: the bench full-screen, and the
 * controls as overlays on it, the way the main scene's instruments sit on
 * the world.
 *
 * Top left, a row of chips: MENU (the shard itself: name, mode, the list,
 * clear, explain) and GRID (the level the placing tools work on, the deploy
 * scale multiplier, and the grid's own size), each opening one panel below
 * the row; UNDO and REDO float beside them. Bottom left, TOOLS (STAMP, ADD,
 * SELECT, FACE and each tool's options). Top right, DEPLOY and the way out. Bottom right,
 * the CONTROLS pad, present only while points are selected: the main pad's
 * shape, nudging the selection in screen directions, with CONNECT and DELETE
 * in its corners; and below it COLOR, folded to a swatch of the current
 * color until tapped, shut again by a tap anywhere else, and held open while
 * SELECT is the tool; gone while FACE is the tool with no face in hand, back
 * once a face is selected so a color can be put on its corners. TOOLS sits
 * bottom left, its panel opening upward. On a phone the open color bar spans
 * the bottom above the two corners.
 */

import { useEffect, useRef, useState } from 'react'
import { Grid3x3, Link, Menu, MousePointer2, Pipette, Plus, Redo2, RotateCcw, RotateCw, Stamp, Trash2, Triangle, Undo2, Wrench, X, type LucideIcon } from 'lucide-react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { ConfirmModal } from '../hud/ConfirmModal'
import { Explanation } from '../hud/Explanation'
import { DIVISIONS, MAX_EXTENT, MIN_EXTENT, MODES, TICKS_PER_UNIT, hexToRgb, neededExtent, rgbToHex, ticksOf, toPayload, unitsLabel, type ShardMode } from '../lib/shards'
import { hsvToRgb, rgbToHsv, type Hsv } from '../lib/hsv'
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
  const move = (name: NudgeName) => () => { const n = nudgeFor(useBenchView.getState().axes, name); w().moveSelected(n.axis, n.delta * w().step()) }
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

/**
 * The mixer: HUE, SATURATION and BRIGHTNESS, each a slider on a track painted
 * with what that slider would give, the colour they make at the top and a hex
 * field for a colour from elsewhere. It opens on the colour in hand; when that
 * has no saturation or no brightness (white, grey, black) those two open at
 * the middle, so the first touch of HUE gives a colour rather than another grey.
 */
const MID = 50
function opening(hex: string): Hsv {
  const [h, s, v] = rgbToHsv(hexToRgb(hex))
  return [Math.round(h), s === 0 ? MID : Math.round(s), v === 0 ? MID : Math.round(v)]
}
function Mixer({ hex, onChange, onSettle }: { hex: string; onChange: (hex: string) => void; onSettle: (hex: string) => void }): JSX.Element {
  const [hsv, setHsv] = useState<Hsv>(() => opening(hex))
  const [text, setText] = useState(hex)
  const made = rgbToHex(hsvToRgb(hsv))
  // A swatch tapped while the mixer is up moves the sliders to it.
  useEffect(() => { if (hex !== made) { setHsv(opening(hex)); setText(hex) } }, [hex]) // eslint-disable-line react-hooks/exhaustive-deps
  const slide = (i: 0 | 1 | 2) => (e: { target: { value: string } }): void => {
    const next = [...hsv] as Hsv
    next[i] = Number(e.target.value)
    const out = rgbToHex(hsvToRgb(next))
    setHsv(next); setText(out); onChange(out)
  }
  const typed = (value: string): void => {
    setText(value)
    const m = /^#?([0-9a-f]{6})$/i.exec(value.trim())
    if (!m) return
    const out = '#' + m[1].toLowerCase()
    setHsv(opening(out)); onChange(out)
  }
  const at = (h: number, sat: number, v: number): string => rgbToHex(hsvToRgb([h, sat, v]))
  const tracks = [
    'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
    `linear-gradient(to right, ${at(hsv[0], 0, hsv[2])}, ${at(hsv[0], 100, hsv[2])})`,
    `linear-gradient(to right, #000, ${at(hsv[0], hsv[1], 100)})`,
  ]
  const rows: Array<[string, number, number]> = [['HUE', 360, hsv[0]], ['SATURATION', 100, hsv[1]], ['BRIGHTNESS', 100, hsv[2]]]
  return (
    <div className="ws__mixer" role="group" aria-label="Mix a color">
      <div className="ws__mixer-head">
        <span className="workshop__swatch workshop__swatch--sample" style={{ background: made }} aria-hidden />
        <input className="ws__mixer-hex" value={text} onChange={(e) => typed(e.target.value)} onBlur={() => onSettle(made)} spellCheck={false} aria-label="Hex color" />
      </div>
      {rows.map(([label, max, value], i) => (
        <label key={label} className="ws__mixer-row">
          <span className="workshop__label">{label}</span>
          <input type="range" min={0} max={max} step={1} value={value} style={{ background: tracks[i] }} onChange={slide(i as 0 | 1 | 2)} onPointerUp={() => onSettle(made)} onKeyUp={() => onSettle(made)} aria-label={label} />
        </label>
      ))}
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
  const division = useWorkshop((s) => s.division)
  const showAvatar = useWorkshop((s) => s.showAvatar)
  const color = useWorkshop((s) => s.color)
  const stampKind = useWorkshop((s) => s.stampKind)
  const stampSize = useWorkshop((s) => s.stampSize)
  const stampFacing = useWorkshop((s) => s.stampFacing)
  const canUndo = useWorkshop((s) => s.past.length > 0)
  const canRedo = useWorkshop((s) => s.future.length > 0)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [colorOpen, setColorOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // On a phone the open colour bar and the TOOLS panel share the bottom, so
  // they take turns; on a wide screen they have corners of their own.
  const [narrow, setNarrow] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = (): void => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const colorBar = (colorOpen || tool === 'select') && !(narrow && panel === 'tools')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [deleteColor, setDeleteColor] = useState<string | null>(null)
  const settle = useRef<number>()
  const picked = useRef(false)
  useEffect(() => () => window.clearTimeout(settle.current), [])
  // A tap anywhere outside the colour bar shuts it, except while SELECT is
  // the tool, when colouring the selection is the work and the bar stays.
  useEffect(() => {
    if (!colorOpen) return
    const shut = (e: PointerEvent): void => {
      if (useWorkshop.getState().tool === 'select') return
      const el = e.target as HTMLElement | null
      if (el?.closest('.ws__color, .ws__colorchip')) return
      setColorOpen(false)
    }
    document.addEventListener('pointerdown', shut, true)
    return () => document.removeEventListener('pointerdown', shut, true)
  }, [colorOpen])
  // ADD, SELECT and FACE have nothing under them, so choosing one by key puts
  // the TOOLS panel away; STAMP keeps it for the shape, size and facing.
  useEffect(() => { if (tool !== 'stamp') setPanel((p) => (p === 'tools' ? null : p)) }, [tool])
  // The mixer shuts with the column, and on a tap anywhere else.
  useEffect(() => { if (!colorBar) setPickerOpen(false) }, [colorBar])
  useEffect(() => {
    if (!pickerOpen) return
    const shut = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.closest('.ws__mixer, .workshop__color')) return
      setPickerOpen(false)
    }
    document.addEventListener('pointerdown', shut, true)
    return () => document.removeEventListener('pointerdown', shut, true)
  }, [pickerOpen])
  const bind = useRepeatable()

  if (!open) return null
  const w = useWorkshop.getState
  const say = (notice: string): void => useWorkshop.setState({ notice })
  const toggle = (p: Panel): void => setPanel((cur) => (cur === p ? null : p))

  const selectedPoints = shard ? new Set(selection.map((i) => { const v = shard.vertices[i]; return v ? ticksOf(v).join(',') : '' })).size : 0
  const one = selection.length === 1 && shard ? shard.vertices[selection[0]] : null
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
  const ToolIcon = TOOL_ICON[tool]

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
          <div className="workshop__row" role="group" aria-label="Scale avatar">
            <span className="workshop__label">AVATAR</span>
            <div className="workshop__modes">
              <button className={`workshop__mode ${showAvatar ? 'is-on' : ''}`} aria-pressed={showAvatar} onClick={() => w().setShowAvatar(true)} title="Show the to-scale avatar at the grid's centre">SHOW</button>
              <button className={`workshop__mode ${!showAvatar ? 'is-on' : ''}`} aria-pressed={!showAvatar} onClick={() => w().setShowAvatar(false)} title="Hide it">HIDE</button>
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
              the width of a sector, and GRID SIZE is how far the grid reaches from the origin. DEPLOY shows
              the shard at true size before you place it. Keys: 1 2 3 4 tools, Q turns a stamp, WASD and
              RF or the arrows nudge the selection in screen directions, C selects what faces join, Del
              deletes, Enter fills, [ ] change the level, Ctrl+Z undoes, Esc clears then closes.
            </Explanation>
          </div>
        </div>
      )}

      {panel === 'grid' && shard && (
        <div className="ws__panel" role="region" aria-label="Grid">
          <div className="workshop__row">
            <span className="workshop__label">LEVEL Y</span>
            <button className="workshop__btn" {...bind(() => w().setLevel(w().level - w().step()))} disabled={level <= -extent * TICKS_PER_UNIT} aria-label="Level down">−</button>
            <span className="workshop__value">{unitsLabel(level)}</span>
            <button className="workshop__btn" {...bind(() => w().setLevel(w().level + w().step()))} disabled={level >= extent * TICKS_PER_UNIT} aria-label="Level up">+</button>
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
          <div className="workshop__row" role="group" aria-label="Grid division">
            <span className="workshop__label">DIVISION</span>
            <div className="workshop__modes">
              {DIVISIONS.map((d) => (
                <button key={d} className={`workshop__mode ${division === d ? 'is-on' : ''}`} aria-pressed={division === d} onClick={() => w().setDivision(d)} title={d === 1 ? 'Snap to whole units' : `Snap to 1/${d} of a unit`}>{d === 1 ? '1' : `1/${d}`}</button>
              ))}
            </div>
            <span className="workshop__unit-size" title="Where taps, the box, nudges and the level land. Positions already placed keep their exact spots.">the snap for placing and nudging</span>
          </div>
          <div className="workshop__row">
            <span className="workshop__label">GRID SIZE</span>
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

      {/* Bottom left: TURN and the pad while points are selected, over TOOLS and
          its panel, which opens upward over the chip. */}
      <div className="ws__tools">
        {selection.length > 0 && (
          <div className="benchturn" role="group" aria-label="Turn the selection">
            <button className="touchpad__key" title="A quarter turn left about the vertical (Q)" aria-label="Turn left" {...noCallout} onClick={() => w().rotateSelected(-1)}>
              <RotateCcw size={18} strokeWidth={2.25} aria-hidden />
              <span className="touchpad__sub">LEFT</span>
            </button>
            <button className="touchpad__key" title="A quarter turn right (E)" aria-label="Turn right" {...noCallout} onClick={() => w().rotateSelected(1)}>
              <RotateCw size={18} strokeWidth={2.25} aria-hidden />
              <span className="touchpad__sub">RIGHT</span>
            </button>
          </div>
        )}
        {selection.length > 0 && <ControlsPad points={selectedPoints} />}
      {panel === 'tools' && (
        <div className="ws__panel ws__panel--up" role="region" aria-label="Tools">
          <div className="workshop__row" role="group" aria-label="Tool">
            {TOOLS.map((t, i) => {
              const Icon = TOOL_ICON[t]
              return (
                <button key={t} className={`workshop__tool ${tool === t ? 'is-on' : ''}`} aria-pressed={tool === t} onClick={() => { w().setTool(t); if (t !== 'stamp') setPanel(null) }} title={`${t} (${i + 1})`}>
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

        <button className={`chip ws__chip ${panel === 'tools' ? 'is-on' : ''}`} aria-pressed={panel === 'tools'} onClick={() => toggle('tools')}>
          <Wrench size={12} strokeWidth={2.25} aria-hidden />TOOLS · <ToolIcon size={12} strokeWidth={2.25} aria-hidden />{tool.toUpperCase()}
        </button>
      </div>

      {/* Bottom right: FILL for a set of points, face actions while a face is in
          hand, the color column under either. */}
      <div className="ws__corner">
        {one && (
          <div className="benchops" role="status" aria-label="Selected point">
            <span className="workshop__value workshop__value--wide">at ({ticksOf(one).map(unitsLabel).join(', ')})</span>
          </div>
        )}
        {selectedPoints >= 3 && (
          <div className="benchops" role="group" aria-label="Fill the selection">
            <span className="workshop__value workshop__value--wide">{selectedPoints} points</span>
            <button className="workshop__btn" onClick={() => w().fillSelection()} title="Faces across these points: a flat set becomes one face, a solid set its hull (Enter)">FILL</button>
          </div>
        )}
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
        {(tool !== 'face' || selectedFace !== null) && (colorBar ? (
          <div className={`ws__color ${tool === 'select' ? '' : 'is-open'}`} role="group" aria-label="Color">
            <span className="workshop__label">COLOR</span>
            <button className={`workshop__color ${pickerOpen ? 'is-on' : ''}`} onClick={() => setPickerOpen((o) => !o)} aria-pressed={pickerOpen} title="Mix a color: hue, saturation, brightness" aria-label="Mix a color" {...noCallout}>
              <Pipette size={13} strokeWidth={2.25} aria-hidden />
            </button>
            <div className="workshop__swatches">
              {palette.map((h) => (
                <Swatch key={h} hex={h} on={h === hex} onUse={() => w().colorSelected(hexToRgb(h))} onHold={() => setDeleteColor(h)} />
              ))}
            </div>
            <button className="workshop__btn" disabled={!shard || shard.vertices.length === 0} onClick={() => w().colorAll(w().color)} title="Apply the color to every vertex">ALL</button>
          </div>
        ) : (
          <button className="chip ws__colorchip" style={{ background: hex }} onClick={() => { setColorOpen(true); if (narrow && panel === 'tools') setPanel(null) }} title={`Color ${hex}. Tap for the palette.`} aria-label={`Color ${hex}, tap for the palette`} />
        ))}
        {colorBar && pickerOpen && (tool !== 'face' || selectedFace !== null) && <Mixer hex={hex} onChange={pick} onSettle={settled} />}
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
