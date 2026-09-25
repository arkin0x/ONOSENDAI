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

import { useEffect, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { Compass3D } from '../scene/Compass3D'
import { ClipboardPaste, Copy, Eye, FlipVertical2, Grid3x3, Link, Menu, MousePointer2, PaintBucket, Pickaxe, Pipette, Plus, Redo2, RotateCcw, RotateCw, Scissors, Stamp, Trash2, Triangle, type LucideIcon, Undo2, WandSparkles, Wrench, X } from 'lucide-react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { ConfirmModal } from '../hud/ConfirmModal'
import { PaletteModal } from './PaletteModal'
import { Explanation } from '../hud/Explanation'
import { DIVISIONS, MAX_EXTENT, MAX_UNIT, MIN_EXTENT, MODES, TICKS_PER_UNIT, hexToRgb, neededExtent, rgbToHex, ticksOf, toPayload, unitsLabel, type ShardMode , type ShardModel} from 'sno-core/shards'
import { formatCellSize } from 'sno-core/scale'
import { FACED, FACING_LABEL, FLOOR, MAX_SIZE, MIN_SIZE, STAMPS, STAMP_HELP, type StampKind } from 'sno-core/stamps'
import { useAvatars } from '../store/useAvatars'
import { avatarReach, avatarWork } from 'cyberspace-core'
import { avatarTemplate } from '../lib/avatar'
import { clock, describeDuration, expectedTries, minedIn, serializeEvent, triesPerSec } from '../lib/avatarMine'
import { minerCount } from '../lib/avatarWorker'
import { useCalibration } from '../lib/calibration'
import { useCyberspace } from '../store/useCyberspace'
import { useWorkshop, type Tool } from '../store/useWorkshop'
import { useShards } from '../store/useShards'
import { Bench } from './Bench'
import { benchPose, nudgeFor, nudgeLabel, planeAfter, requestView, useBenchView, type NudgeName } from './benchAxes'
import { stackedCount } from '../lib/weld'

const TOOLS: Tool[] = ['view', 'stamp', 'add', 'select', 'face']
const TOOL_ICON: Record<Tool, LucideIcon> = { view: Eye, stamp: Stamp, add: Plus, select: MousePointer2, face: Triangle }

const LONG_PRESS_MS = 550
const TOAST_MS = 4000
/** Swatches shown in the color column; the rest live in the palette. */
const RECENT_SWATCHES = 8

/** One line under the tool row. SELECT needs none: the pad appears when something is selected. */
const TOOL_HELP: Partial<Record<Tool, string>> = {
  view: 'Look around: one finger orbits, two pan, pinch zooms. The compass turns the view a quarter at a time. Pick a tool to build.',
  stamp: 'Tap the grid to place the shape where the ghost shows. Q turns it.',
  add: 'Tap the grid to place a vertex at the current level.',
  face: 'Tap corners in order, then the first again or FILL. Tap a face to select it. A dark face shows its back: FLIP turns it round, AUTO turns every face outward.',
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
      {points > 0 && (<>
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
    </>)}

    </div>
  )
}

/**
 * The clipboard row: FILL while three or more points are in hand, CUT and
 * COPY while any are, PASTE whenever something is held, on every tool. It
 * stands first in the bottom-left column so nothing else there or in the
 * color column ever covers it (arkinox, 2026-09-24); FILL joined it at its
 * left end the same evening, out of the right-hand corner. PASTE asks where
 * before it puts anything down, since the answer is not obvious: back where
 * it came from, or on the plane you are working on. CLEAR lets the held
 * points go, and PASTE with them.
 */
function ClipRow({ points }: { points: number }): JSX.Element | null {
  const w = useWorkshop.getState
  const clip = useWorkshop((s) => s.clip)
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (clip === null) setAsking(false) }, [clip])
  if (points === 0 && clip === null) return null
  const held = clip ? `${clip.points.length} point${clip.points.length === 1 ? '' : 's'}` : ''
  return (
    <div className="benchclip" role="group" aria-label="Clipboard">
      {points >= 3 && (
        <button className="touchpad__key" title="Faces across these points: a flat set becomes one face, a solid set its hull (Enter)" aria-label="Fill the selection" {...noCallout} onClick={() => w().fillSelection()}>
          <Triangle size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">FILL</span>
        </button>
      )}
      {points > 0 && (
        <>
          <button className="touchpad__key" title="Cut the selected points, and their faces, to the clipboard" aria-label="Cut the selection" {...noCallout} onClick={() => w().cutSelection()}>
            <Scissors size={15} strokeWidth={2.25} aria-hidden />
            <span className="touchpad__sub">CUT</span>
          </button>
          <button className="touchpad__key" title="Copy the selected points, and their faces, to the clipboard; they stay where they are" aria-label="Copy the selection" {...noCallout} onClick={() => w().copySelection()}>
            <Copy size={15} strokeWidth={2.25} aria-hidden />
            <span className="touchpad__sub">COPY</span>
          </button>
        </>
      )}
      {clip !== null && (
        <button className="touchpad__key touchpad__key--paste" title={`Paste the ${held} held`} aria-label={`Paste the ${held} held`} aria-haspopup="menu" aria-expanded={asking} {...noCallout} onClick={() => setAsking((o) => !o)}>
          <ClipboardPaste size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">PASTE</span>
        </button>
      )}
      {asking && clip !== null && (
        <>
          {/* Anywhere else puts the question away and pastes nothing. */}
          <div className="benchpaste__away" onPointerDown={() => setAsking(false)} />
          <div className="benchpaste" role="menu" aria-label="Where to paste">
            <button className="workshop__btn" role="menuitem" title="Back on the exact points they were taken from" onClick={() => { setAsking(false); w().pasteClip('exact') }}>PASTE</button>
            <button className="workshop__btn" role="menuitem" title="Resting on the plane you are working on, keeping its shape" onClick={() => { setAsking(false); w().pasteClip('floor') }}>PASTE FLOOR</button>
            <button className="workshop__btn workshop__btn--danger" role="menuitem" title={`Let the ${held} go; PASTE goes with them`} onClick={() => { setAsking(false); w().clearClip() }}>CLEAR CLIPBOARD</button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The FACE tool's row: where the clipboard row stands, in its keys (arkinox,
 * 2026-09-25). AUTO always, since it needs no face: every face in the shard
 * turned to look outward by the bench's guess. FLIP, SEAM and DELETE while a
 * face is in hand; FLIP asks how much before it turns anything, the way PASTE
 * asks where. FILL once corners are picked. No CANCEL: a tap on empty space
 * lets go of the face and the picks, as it does everywhere on the bench, and
 * so does Esc.
 */
function FaceRow({ face, picks, faces }: { face: number | null; picks: number; faces: number }): JSX.Element | null {
  const w = useWorkshop.getState
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (face === null) setAsking(false) }, [face])
  if (faces === 0 && picks === 0) return null
  const choose = (fn: () => void) => (): void => { setAsking(false); fn() }
  return (
    <div className="benchclip" role="group" aria-label="Faces">
      {faces > 0 && (
        <button className="touchpad__key" title="Every face in the shard turned to look outward, by the bench's best guess" aria-label="Turn every face outward" {...noCallout} onClick={() => w().autoWind()}>
          <WandSparkles size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">AUTO</span>
        </button>
      )}
      {picks > 0 && (
        <button className="touchpad__key" disabled={picks < 3} title="Join the corners into a face (Enter)" aria-label={`Fill the ${picks} corners`} {...noCallout} onClick={() => w().fill()}>
          <Triangle size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">FILL</span>
        </button>
      )}
      {face !== null && (
        <>
          <button className="touchpad__key" title="Turn this face round: which side is its front" aria-label="Flip" aria-haspopup="menu" aria-expanded={asking} {...noCallout} onClick={() => setAsking((o) => !o)}>
            <FlipVertical2 size={15} strokeWidth={2.25} aria-hidden />
            <span className="touchpad__sub">FLIP</span>
          </button>
          {/* A hard colour, which colouring the corners cannot give: a corner
              belongs to every face touching it, so that bleeds across the
              shared edges. This stops at the edge. */}
          <button className="touchpad__key" title="Give this face the current color as a hard seam, not blended from its corners" aria-label="Seam" {...noCallout} onClick={() => w().colorFace(face, w().color)}>
            <PaintBucket size={15} strokeWidth={2.25} aria-hidden />
            <span className="touchpad__sub">SEAM</span>
          </button>
          <button className="touchpad__key touchpad__key--danger" title="Remove this face (Del)" aria-label="Delete the face" {...noCallout} onClick={() => w().deleteSelectedFace()}>
            <Trash2 size={15} strokeWidth={2.25} aria-hidden />
            <span className="touchpad__sub">DELETE</span>
          </button>
        </>
      )}
      {asking && face !== null && (
        <>
          {/* Anywhere else puts the question away and turns nothing. */}
          <div className="benchpaste__away" onPointerDown={() => setAsking(false)} />
          <div className="benchpaste" role="menu" aria-label="What to flip">
            <button className="workshop__btn" role="menuitem" title="This face turned round, its back to the front" onClick={choose(() => w().flipSelectedFace())}>FLIP FACE</button>
            <button className="workshop__btn" role="menuitem" title="This face turned round, and every face joined to it by an edge turned to agree" onClick={choose(() => w().flipSelectedSurface())}>FLIP SURFACE</button>
          </div>
        </>
      )}
    </div>
  )
}

/** The bench's axes as the compass draws them: model +Z is render -Z (shards.ts toRender). */
const BENCH_DIRS = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, -1) }

/**
 * The view pad, for the bench: the arrows turn the working grid a quarter
 * while the geometry stays put, so the next points go down on another plane.
 * Up and down tip it about the screen's horizontal, left and right roll it
 * about the line of sight (benchAxes planeAfter). SUN is the black sun's seat
 * here: the grid back on the floor and the camera back where the bench opens.
 */
function BenchViewMenu(): JSX.Element {
  const w = useWorkshop.getState
  const press = (fn: () => void) => (e: React.PointerEvent): void => { e.preventDefault(); e.stopPropagation(); fn() }
  const turn = (about: 'tip' | 'roll') => (): void => w().setPlane(planeAfter(w().plane, useBenchView.getState().axes, about))
  return (
    <div className="viewmenu viewmenu--bench" role="group" aria-label="Grid controls">
      <div className="viewmenu__pad">
        <button className="viewmenu__key viewmenu__key--up" {...noCallout} onPointerDown={press(turn('tip'))} aria-label="Tip the grid up">▲</button>
        <button className="viewmenu__key viewmenu__key--left" {...noCallout} onPointerDown={press(turn('roll'))} aria-label="Roll the grid left">◀</button>
        <span className="viewmenu__hub" aria-hidden="true">GRID</span>
        <button className="viewmenu__key viewmenu__key--right" {...noCallout} onPointerDown={press(turn('roll'))} aria-label="Roll the grid right">▶</button>
        <button className="viewmenu__key viewmenu__key--down" {...noCallout} onPointerDown={press(turn('tip'))} aria-label="Tip the grid down">▼</button>
      </div>
      <div className="viewmenu__row">
        <button className="viewmenu__op" {...noCallout} onPointerDown={press(() => { w().setPlane(FLOOR); requestView({ kind: 'home' }) })} title="The grid back on the floor, the view back where the bench opens">RESET</button>
      </div>
    </div>
  )
}

/**
 * The mark inside a round icon button, in pixels.
 *
 * One number for the whole app: the touchpad's EARTH and cube keys are 38px
 * squares with a 16px mark, and every other round icon button matches them so
 * a hand learns one size. A new icon button takes this, not a number of its
 * own.
 */
const ICON_PX = 16


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
  const plane = useWorkshop((s) => s.plane)
  const division = useWorkshop((s) => s.division)
  const showAvatar = useWorkshop((s) => s.showAvatar)
  const me = useCyberspace((s) => s.identity.pubkey)
  const myAvatar = useAvatars((s) => s.shards[me] ?? null)
  const mining = useAvatars((s) => s.mining)
  const phase = useAvatars((s) => s.phase)
  const minedMs = useAvatars((s) => s.minedMs)
  const adoptError = useAvatars((s) => s.adoptError)
  const minePublished = useAvatars((s) => s.minePublished)
  const live = useCyberspace((s) => s.live)
  // The moment the work is done: say so, because the signer's prompt may take a
  // while to appear and nothing else marks the end of the mining.
  const lastPhase = useRef<typeof phase>(null)
  useEffect(() => {
    if (lastPhase.current === 'mining' && phase === 'signing') useWorkshop.setState({ notice: `Mined in ${minedIn(minedMs ?? 0)}. Sign the avatar event when your signer asks.` })
    lastPhase.current = phase
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])
  const sha256PerSec = useCalibration((s) => s.sha256PerSec)
  // The avatar's price (spec 8.10), memoised on the geometry; a hook, so it sits with the others.
  const buildable = shard !== null && shard.vertices.length > 0 && shard.faces.length > 0
  const work = useMemo(() => {
    if (!shard || !buildable) return { required: 0, reach: 0, detail: 0, bytes: 0 }
    const payload = toPayload(shard)
    // The bytes hashed per try: the serialized event with a nonce tag of typical width.
    const bytes = new TextEncoder().encode(serializeEvent({ ...avatarTemplate(shard, 1_800_000_000), pubkey: me })).length + 40
    return { required: avatarWork(payload), reach: Math.max(1, avatarReach(payload)), detail: shard.vertices.length + shard.faces.length, bytes }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildable, shard?.vertices, shard?.faces, shard?.unit, shard?.name, me])
  const color = useWorkshop((s) => s.color)
  const stampKind = useWorkshop((s) => s.stampKind)
  const stampSize = useWorkshop((s) => s.stampSize)
  const stampFacing = useWorkshop((s) => s.stampFacing)
  const canUndo = useWorkshop((s) => s.past.length > 0)
  const canRedo = useWorkshop((s) => s.future.length > 0)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [colorOpen, setColorOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [viewOpen, setViewOpen] = useState(false)
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
  // A tap anywhere outside the colour bar shuts it, except while SELECT is
  // the tool, when colouring the selection is the work and the bar stays.
  useEffect(() => {
    if (!colorOpen) return
    const shut = (e: PointerEvent): void => {
      if (useWorkshop.getState().tool === 'select') return
      const el = e.target as HTMLElement | null
      if (el?.closest('.ws__color, .ws__colorchip, .ws__mixer')) return
      setColorOpen(false)
    }
    document.addEventListener('pointerdown', shut, true)
    return () => document.removeEventListener('pointerdown', shut, true)
  }, [colorOpen])
  // ADD, SELECT and FACE have nothing under them, so choosing one by key puts
  // the TOOLS panel away; STAMP keeps it for the shape, size and facing.
  useEffect(() => { if (tool !== 'stamp') setPanel((p) => (p === 'tools' ? null : p)) }, [tool])
  // The view pad goes with the VIEW tool, and shuts on a tap anywhere else.
  useEffect(() => { if (tool !== 'view') setViewOpen(false) }, [tool])
  useEffect(() => {
    if (!viewOpen) return
    const shut = (e: PointerEvent): void => {
      const el = e.target as HTMLElement | null
      if (el?.closest('.viewmenu, .compass-3d')) return
      setViewOpen(false)
    }
    document.addEventListener('pointerdown', shut, true)
    return () => document.removeEventListener('pointerdown', shut, true)
  }, [viewOpen])
  const bind = useRepeatable()
  // Every hook above this line, none below it: the early return that follows
  // changes which hooks run, and React counts them. This one sat after the
  // return for a day and opening the workshop threw React #310 (2026-09-24).
  const stacked = useMemo(() => (shard ? stackedCount(shard) : 0), [shard])

  if (!open) return null
  const w = useWorkshop.getState
  const say = (notice: string): void => useWorkshop.setState({ notice })
  const toggle = (p: Panel): void => setPanel((cur) => (cur === p ? null : p))

  const selectedPoints = shard ? new Set(selection.map((i) => { const v = shard.vertices[i]; return v ? ticksOf(v).join(',') : '' })).size : 0
  const one = selection.length === 1 && shard ? shard.vertices[selection[0]] : null
  const extent = shard?.extent ?? MIN_EXTENT
  const minExtent = shard ? Math.max(MIN_EXTENT, neededExtent(shard)) : MIN_EXTENT

  // Every colour in reach is a palette colour now, so there is nothing to snap
  // and nothing to settle: the swatch row holds hexes taken from the built-in,
  // and the sheet behind the dropper holds all 256.
  const hex = rgbToHex(color)

  /**
   * Put a shard on the clipboard, or say why not. Two silences lived here.
   *
   * An empty shard copied happily. A brand new object is zero vertices, and
   * the payload that comes out is well formed, so pasting one into snocrash
   * reported success and put nothing on the bench. "Nothing happens" was the
   * whole of the bug report and it was accurate. Nothing is worth copying
   * until there is something in it.
   *
   * And where there is no clipboard at all, `navigator.clipboard?.writeText(x)
   * .then(...)` short-circuits the ENTIRE chain, not just the call: the button
   * did nothing and said nothing. The check is explicit now, and the avatar's
   * COPY goes through here too, where it used to reach for
   * navigator.clipboard with no guard and throw.
   */
  const copyShard = (s: ShardModel, ok: string): void => {
    if (s.vertices.length === 0) { say(`"${s.name}" is empty. There is nothing to copy yet.`); return }
    const clip = navigator.clipboard
    if (!clip) { say('The clipboard is not available here.'); return }
    void clip.writeText(JSON.stringify(toPayload(s))).then(
      () => say(ok),
      () => say('The clipboard refused that.'),
    )
  }

  const copy = (id: string): void => {
    const s = w().shards.find((x) => x.id === id)
    if (!s) return
    copyShard(s, `Copied "${s.name}" to the clipboard. PASTE it here or anywhere.`)
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
      <div className={`ws__top ${panel ? 'ws__top--open' : ''}`}>
      <div className="ws__chips">
        <button className={`chip ws__chip ${panel === 'menu' ? 'is-on' : ''}`} aria-pressed={panel === 'menu'} onClick={() => toggle('menu')}>
          <Menu size={12} strokeWidth={2.25} aria-hidden />MENU
        </button>
        <button className={`chip ws__chip ${panel === 'grid' ? 'is-on' : ''}`} aria-pressed={panel === 'grid'} onClick={() => toggle('grid')}>
          <Grid3x3 size={12} strokeWidth={2.25} aria-hidden />GRID
        </button>
        {phase && (
          <button className="chip ws__chip ws__chip--work" onClick={() => { if (panel !== 'menu') toggle('menu') }} title="Your avatar: see MENU" aria-live="polite">
            <Pickaxe size={12} strokeWidth={2.25} aria-hidden />
            {phase === 'mining' ? `MINING ${mining ? clock(mining.elapsedMs) : ''}` : phase === 'signing' ? 'SIGN IT' : 'PUBLISHING'}
          </button>
        )}
        {/* Out of the way while a panel is open: on a phone they wrapped the chip
            row onto a second line and pushed the panel down with it. */}
        {!panel && (
          <span className="ws__history">
            <button className="chip ws__icon" disabled={!canUndo} onClick={() => w().undo()} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={ICON_PX} strokeWidth={2.25} aria-hidden /></button>
            <button className="chip ws__icon" disabled={!canRedo} onClick={() => w().redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={ICON_PX} strokeWidth={2.25} aria-hidden /></button>
          </span>
        )}
      </div>
      {panel === 'menu' && shard && (
        <div className="ws__panel" role="region" aria-label="Menu">
          <input className="workshop__name" value={shard.name} onChange={(e) => w().rename(shard.id, e.target.value)} aria-label="Shard name" spellCheck={false} />
          <div className="ws__stats">
            {shard.vertices.length} vertices · {shard.faces.length} faces · unit 2^{shard.unit} = {formatCellSize(shard.unit)}
            {shard.mode !== 'solid' && shard.faces.length > 0 && <> · faces draw in SOLID</>}
            {shard.facecolors && <> · <button className="workshop__link" onClick={() => w().clearFaceColors()} title="Give every face back to its corners, so colors blend across them again">{shard.facecolors.length} face colors, clear</button></>}
          </div>
          <div className="workshop__row">
            <span className="workshop__label">DRAW</span>
            <div className="workshop__modes" role="group" aria-label="Render mode">
              {MODES.map((m: ShardMode) => (
                <button key={m} className={`workshop__mode ${shard.mode === m ? 'is-on' : ''}`} aria-pressed={shard.mode === m} onClick={() => w().setMode(m)}>{m.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div className="workshop__row" role="group" aria-label="Default avatar ghost">
            <span className="workshop__label">DEFAULT AVATAR GHOST</span>
            <div className="workshop__modes">
              <button className={`workshop__mode ${showAvatar ? 'is-on' : ''}`} aria-pressed={showAvatar} onClick={() => w().setShowAvatar(true)} title="Show the to-scale avatar at the grid's centre">SHOW</button>
              <button className={`workshop__mode ${!showAvatar ? 'is-on' : ''}`} aria-pressed={!showAvatar} onClick={() => w().setShowAvatar(false)} title="Hide it">HIDE</button>
            </div>
          </div>
          {/* The shape others see for you: this shard, published as kind 33331,
              drawn in the dodecahedron's cell wherever you are drawn. */}
          <div className="workshop__avatar" role="group" aria-label="My avatar">
            <div className="workshop__row">
              <span className="workshop__label">MY AVATAR</span>
              <span className="workshop__value workshop__value--wide">{myAvatar ? myAvatar.name : 'dodecahedron'}</span>
            </div>
            {/* The buttons take their own row and share it evenly, the way NEW
                SHARD and PASTE do. On the name's line a long shard name pushed
                them off the edge (arkinox, 2026-09-15). */}
            <div className="workshop__list-row">
            {/* Adopted while LOCAL: signed and kept and drawn for you, but no relay has it. */}
            {myAvatar && !minePublished && !phase && (
              live
                ? <button className="workshop__btn workshop__btn--warn" onClick={() => { void useAvatars.getState().broadcastMine().then((ok) => say(ok ? 'Your avatar is published.' : useAvatars.getState().adoptError ?? 'No relay took the avatar.')) }} title="Send the avatar you adopted while LOCAL to the relays">BROADCAST</button>
                : <span className="workshop__value">LOCAL</span>
            )}
            {phase === 'mining' ? (
              <button className="workshop__btn workshop__btn--danger" onClick={() => useAvatars.getState().cancelAdopt()} title="Stop mining; your avatar stays as it is">CANCEL</button>
            ) : phase ? (
              <button className="workshop__btn" disabled title={phase === 'signing' ? 'Waiting for your signer' : 'Publishing to the relays'}>{phase === 'signing' ? 'SIGNING' : 'PUBLISHING'}</button>
            ) : (
              <button
                className="workshop__btn"
                disabled={!buildable}
                onClick={() => {
                  const started = Date.now()
                  void useAvatars.getState().adopt(shard).then((ok) => {
                    const st = useAvatars.getState()
                    const took = describeDuration((Date.now() - started) / 1000).replace('about ', '')
                    if (!ok) { say(st.adoptError ?? 'Mining cancelled. Your avatar is as it was.'); return }
                    say(st.minePublished
                      ? `"${shard.name}" is your avatar now: ${work.required} bits of work in ${took}.`
                      : `"${shard.name}" is your avatar on this device: ${work.required} bits of work in ${took}. You are LOCAL, so no relay has it. BROADCAST sends it when you go LIVE.`)
                  })
                }}
                title="Publish this shard as the shape others see for you, at true scale: the white avatar on the grid is the size of one cell. Its size and detail are paid for in proof of work first."
              >USE THIS SHARD</button>
            )}
            {myAvatar && !phase && (
              <button className="workshop__btn" onClick={() => { void useAvatars.getState().adopt(null).then((ok) => say(ok ? 'The dodecahedron is your avatar again.' : useAvatars.getState().adoptError ?? 'No relay took the change.')) }} title="Back to the dodecahedron; it owes no work">DODECAHEDRON</button>
            )}
            </div>
            {/* The price (spec 8.10): 16 bits for any avatar, 6 more per doubling of
                its reach in gibsons, 3 per doubling of vertices plus faces beyond 32;
                the whole event is hashed per try, so bytes cost as well. */}
            {buildable && (
              <span className="workshop__work" aria-live="polite">
                {mining
                  ? `MINING ${mining.required} BITS · ${clock(mining.elapsedMs)} ELAPSED · ${mining.elapsedMs > 1000 ? describeDuration(expectedTries(mining.required) / (mining.tries / (mining.elapsedMs / 1000))).toUpperCase() + ' EXPECTED · ' : ''}${mining.elapsedMs > 1000 ? Math.round(mining.tries / (mining.elapsedMs / 1000) / 1000) + 'K TRIES/S' : 'MEASURING'}`
                  : phase === 'signing'
                    ? `MINED IN ${minedIn(minedMs ?? 0).toUpperCase()} · WAITING FOR YOUR SIGNER`
                    : phase === 'publishing'
                      ? `MINED IN ${minedIn(minedMs ?? 0).toUpperCase()} · SIGNED · PUBLISHING`
                      : `${adoptError ? `LAST ATTEMPT: ${adoptError.toUpperCase()} · ` : ''}WORK ${work.required} BITS · ${work.reach.toFixed(work.reach >= 10 ? 0 : 1)} GIBSON REACH · ${work.detail} VERTICES + FACES · ${sha256PerSec ? describeDuration(expectedTries(work.required) / triesPerSec(sha256PerSec, work.bytes, minerCount())).toUpperCase() + ' ON THIS DEVICE' : 'TIME UNKNOWN UNTIL CALIBRATED'}`}
              </span>
            )}
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
            {/* The avatar is not one of these shards. It lives in its own store,
                read back from the kind 33331 event you published, which is why
                deleting the shard it was built from leaves the avatar standing
                (arkinox found this by doing it). It gets a row anyway so the
                shape you are wearing is visible and can be copied back into the
                workshop, and no row that would change it: the way to change an
                avatar is USE THIS SHARD or DODECAHEDRON above. */}
            {myAvatar && (
              <li className="workshop__list-avatar">
                <span className="workshop__pick workshop__pick--static">
                  <span className="workshop__pick-name">{myAvatar.name}</span>
                  <span className="workshop__pick-meta">{myAvatar.vertices.length} v · {myAvatar.faces.length} f · {myAvatar.mode}</span>
                </span>
                <span className="workshop__tag" title="The shape others see for you. Change it with USE THIS SHARD above.">AVATAR</span>
                <button
                  className="workshop__mini"
                  title="Copy it into your shards, where you can edit it"
                  onClick={() => { const id = w().importShard(myAvatar); w().select(id); say(`"${myAvatar.name}" copied into your shards.`) }}
                >⧉</button>
                <button className="workshop__mini workshop__mini--wide" title="Copy to the clipboard" onClick={() => copyShard(myAvatar, 'Avatar copied.')}>COPY</button>
              </li>
            )}
            {shards.map((s) => (
              <li key={s.id} className={s.id === shard.id ? 'is-current' : ''}>
                <button className="workshop__pick" onClick={() => w().select(s.id)}>
                  <span className="workshop__pick-name">{s.name}</span>
                  <span className="workshop__pick-meta">{s.vertices.length} v · {s.faces.length} f · {s.mode}</span>
                </button>
                <button className="workshop__mini" title="Duplicate" onClick={() => w().duplicate(s.id)}>⧉</button>
                <button className="workshop__mini workshop__mini--wide" title="Copy to the clipboard" onClick={() => copy(s.id)}>COPY</button>
                <button className="workshop__mini workshop__mini--danger workshop__mini--x" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => { if (window.confirm(`Delete "${s.name}"? This cannot be undone.`)) w().remove(s.id) }}>×</button>
              </li>
            ))}
          </ul>
          <div className="workshop__row">
            <button className="workshop__btn workshop__btn--danger" disabled={shard.vertices.length === 0} onClick={() => { if (window.confirm('Delete all vertices and faces in the scene?')) w().clearShard() }} title="Empty this scene (undoable)">CLEAR THIS SCENE</button>
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
            <span className="workshop__label">LEVEL {'XYZ'[plane]}</span>
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
            <button className="workshop__btn" {...bind(() => w().setUnit((w().current()?.unit ?? 0) + 1))} disabled={shard.unit >= MAX_UNIT} aria-label="Larger unit">+</button>
            <span className="workshop__unit-size" title="What one grid unit is in the world. DEPLOY shows the shard at this size.">one unit = {formatCellSize(shard.unit)}</span>
          </div>
          <div className="workshop__row" role="group" aria-label="Grid division">
            <span className="workshop__label">DIVISION</span>
            <div className="workshop__modes workshop__modes--divisions">
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

      {/* Top right, under DEPLOY and the way out: the compass while VIEW is in
          hand, the grid pad under it when tapped. */}
      {tool === 'view' && (
        <div className="ws__view">
          <Compass3D bench pose={benchPose} dirs={BENCH_DIRS} onTap={() => setViewOpen((o) => !o)} />
          {viewOpen && <BenchViewMenu />}
        </div>
      )}

      {/* Bottom left: TURN and the pad while points are selected, over TOOLS and
          its panel, which opens upward over the chip. */}
      <div className="ws__tools">
        {tool === 'face' && <FaceRow face={selectedFace} picks={facePick.length} faces={shard?.faces.length ?? 0} />}
        <ClipRow points={selectedPoints} />
        {selection.length > 0 && (
          <div className="benchturn" role="group" aria-label="Turn the selection">
            <button className="touchpad__key" title="A quarter turn left, in the working plane (Q)" aria-label="Turn left" {...noCallout} onClick={() => w().rotateSelected(-1)}>
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

        {/* The tool in hand, and an X joined to the chip that puts it down: VIEW,
            the tool that builds nothing. */}
        <div className="ws__toolchips">
          <button className={`chip ws__chip ${panel === 'tools' ? 'is-on' : ''}`} aria-pressed={panel === 'tools'} onClick={() => toggle('tools')}>
            <Wrench size={12} strokeWidth={2.25} aria-hidden />TOOLS · <ToolIcon size={12} strokeWidth={2.25} aria-hidden />{tool.toUpperCase()}
          </button>
          {tool !== 'view' && (
            <button className="chip ws__chip ws__chip--x" onClick={() => w().setTool('view')} title="Put the tool down (1)" aria-label="Put the tool down">
              <X size={13} strokeWidth={2.25} aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Bottom right: the color column. FILL for a set of points is on the
          clipboard row, and the FACE tool's actions on its own row there. */}
      <div className="ws__corner">
        {one && (
          <div className="benchops" role="status" aria-label="Selected point">
            <span className="workshop__value workshop__value--wide">at ({ticksOf(one).map(unitsLabel).join(', ')})</span>
          </div>
        )}
        {stacked > 0 && (
          <div className="benchops" role="group" aria-label="Weld stacked points">
            <span className="workshop__value workshop__value--wide">{stacked} stacked</span>
            {/* Never automatic: a paste lands on its original on purpose, to be
                moved. This is the deliberate act once the shape is settled. */}
            <button className="workshop__btn" onClick={() => w().weld()} title={selection.length >= 2 ? 'Fold the selected points that stand on one spot into one' : 'Fold every point standing on another into one; faces that disagree on color keep their own'}>WELD</button>
          </div>
        )}
        {(tool !== 'face' || selectedFace !== null) && (colorBar ? (
          <div className={`ws__color ${tool === 'select' ? '' : 'is-open'}`} role="group" aria-label="Color">
            <span className="workshop__label">COLOR</span>
            <button className={`workshop__color ${pickerOpen ? 'is-on' : ''}`} onClick={() => setPickerOpen((o) => !o)} aria-pressed={pickerOpen} title="All 256 colors, and which palette this object is on" aria-label="Open the palette" {...noCallout}>
              <Pipette size={13} strokeWidth={2.25} aria-hidden />
            </button>
            <div className="workshop__swatches">
              {/* The eight most recent; the palette keeps up to 24 and the
                  pipette shows all 256. A taller column stood over the pad in
                  the other corner on a phone (arkinox, 2026-09-24). */}
              {palette.slice(0, RECENT_SWATCHES).map((h) => (
                <Swatch key={h} hex={h} on={h === hex} onUse={() => w().colorSelected(hexToRgb(h))} onHold={() => setDeleteColor(h)} />
              ))}
            </div>
            <button className="workshop__btn" disabled={!shard || shard.vertices.length === 0} onClick={() => w().colorAll(w().color)} title="Apply the color to every vertex">ALL</button>
          </div>
        ) : (
          <button className="chip ws__colorchip" style={{ background: hex }} onClick={() => { setColorOpen(true); if (narrow && panel === 'tools') setPanel(null) }} title={`Color ${hex}. Tap for the palette.`} aria-label={`Color ${hex}, tap for the palette`} />
        ))}
        {pickerOpen && <PaletteModal onClose={() => setPickerOpen(false)} />}
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
