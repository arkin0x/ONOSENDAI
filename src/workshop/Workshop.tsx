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
import { Field, Switch } from '../hud/ui/Switch'
import { Vector3 } from 'three'
import { Compass3D } from '../scene/Compass3D'
import { Box, ChevronDown, ChevronUp, ClipboardPaste, Copy, Eraser, Eye, FlipVertical2, Globe, Grid2x2Plus, Grid3x3, Link, Menu, MousePointer2, PaintBucket, Pickaxe, Pipette, Plus, Redo2, RotateCcw, RotateCw, Scissors, Stamp, Trash2, Triangle, type LucideIcon, Undo2, WandSparkles, Waypoints, X } from 'lucide-react'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { PaletteModal } from './PaletteModal'
import { Explanation } from '../hud/Explanation'
import { DIVISIONS, MAX_EXTENT, MAX_UNIT, MIN_EXTENT, MODES, TICKS_PER_UNIT, neededExtent, rgbToHex, ticksOf, toPayload, unitsLabel, type ShardMode , type ShardModel} from 'sno-core/shards'
import { IMPORT_ACCEPT, IMPORT_FORMATS_LABEL } from 'sno-core/importFile'
import { importFitFor } from 'sno-core/meshToShard'
import { BUILT_IN } from 'sno-core/snoPalette'
import { importFiles } from '../lib/meshImport'
import { formatCellSize } from 'sno-core/scale'
import { FACED, FACING_LABEL, FLOOR, MAX_SIZE, MIN_SIZE, STAMPS, STAMP_HELP, type StampKind } from 'sno-core/stamps'
import { useAvatars } from '../store/useAvatars'
import { avatarReach, avatarWork } from 'cyberspace-core'
import { avatarTemplate } from '../lib/avatar'
import { clock, describeDuration, expectedTries, minedIn, serializeEvent, triesPerSec } from '../lib/avatarMine'
import { minerCount } from '../lib/avatarWorker'
import { useCalibration } from '../lib/calibration'
import { useCyberspace } from '../store/useCyberspace'
import { ownAddress, useWorkshop, type Tool } from '../store/useWorkshop'
import { useShards } from '../store/useShards'
import { usePublished } from '../store/usePublished'
import { STATE_HELP, STATE_LABEL, STATE_TAG, publishState, shardFingerprint } from '../lib/published'
import { ConfirmModal } from '../hud/ConfirmModal'
import { Bench } from './Bench'
import { benchPose, nudgeFor, nudgeLabel, orbitBy, planeAfter, requestView, useBenchView, type NudgeName } from './benchAxes'
import { stackedCount } from '../lib/weld'
import { ObjectPicker } from './ObjectPicker'
import { useEscape } from '../hooks/useEscape'

const TOOLS: Tool[] = ['view', 'stamp', 'add', 'select', 'face']
const TOOL_ICON: Record<Tool, LucideIcon> = { view: Eye, stamp: Stamp, add: Plus, select: MousePointer2, face: Triangle }

const TOAST_MS = 4000

/** One line under the tool row. */
const TOOL_HELP: Partial<Record<Tool, string>> = {
  view: 'Look around: one finger orbits, two pan, pinch zooms. The compass turns the view a quarter at a time. Pick a tool to build.',
  stamp: 'Tap the grid to place the shape where the ghost shows. Q turns it.',
  add: 'Tap the grid to place a vertex at the current level.',
  select: 'Tap points, or drag boxes, to gather them. INVERT makes taps and boxes take points out; DESELECT lets go. Drag the ORBIT ball to turn the view.',
  face: 'Tap corners in order, then the first again or FILL. Tap a face to select it and move it with the pad. A dark face shows its back: FLIP turns it round, AUTO turns every face outward. One finger orbits, or drag the ORBIT ball.',
}

type Panel = 'menu' | 'tools' | 'grid'

const INTRO_KEY = 'onosendai:workshop-intro'

function Intro(): JSX.Element | null {
  const [show, setShow] = useState<boolean>(() => { try { return !localStorage.getItem(INTRO_KEY) } catch { return false } })
  if (!show) return null
  const done = (): void => { try { localStorage.setItem(INTRO_KEY, '1') } catch { /* private mode */ } setShow(false) }
  return (
    <div className="workshop__intro" role="note" aria-label="How to make an object">
      <h3 className="workshop__intro-title">MAKE A SHARD</h3>
      <ol className="workshop__intro-steps">
        <li><b>STAMP</b> a shape: pick one under TOOLS, tap the grid where the ghost shows.</li>
        <li>One finger <b>orbits</b>, or drag the <b>ORBIT</b> ball (in SELECT and FACE one finger draws a box); two fingers <b>pan</b>. GRID raises the level to stack things.</li>
        <li><b>DEPLOY</b> hides it in the world at a place you choose.</li>
      </ol>
      <button className="workshop__btn workshop__intro-ok" onClick={done}>GOT IT</button>
    </div>
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
/**
 * The grid floor's LEVEL, raised and lowered from the top left on every tool
 * (arkinox, 2026-10-10): up, the level, down, stacked under the chip row. The
 * same step as GRID's LEVEL row and the ] and [ keys, one step of the current
 * division per press, held to repeat, so stacking things no longer means
 * opening GRID between every layer.
 */
function LevelStack(): JSX.Element {
  const level = useWorkshop((s) => s.level)
  const plane = useWorkshop((s) => s.plane)
  const extentTicks = useWorkshop((s) => (s.current()?.extent ?? 0) * TICKS_PER_UNIT)
  const bind = useRepeatable()
  const w = useWorkshop.getState
  return (
    <div className="ws__level" role="group" aria-label="Grid level">
      <button className="touchpad__key ws__level-key" {...bind(() => w().setLevel(w().level + w().step()))} disabled={level >= extentTicks} title="Raise the grid floor one step (])" aria-label="Raise the grid floor">
        <ChevronUp size={16} strokeWidth={2.5} aria-hidden />
      </button>
      <span className="ws__level-value" title={`LEVEL ${'XYZ'[plane]}: the height the placing tools work at`}>{unitsLabel(level)}</span>
      <button className="touchpad__key ws__level-key" {...bind(() => w().setLevel(w().level - w().step()))} disabled={level <= -extentTicks} title="Lower the grid floor one step ([)" aria-label="Lower the grid floor">
        <ChevronDown size={16} strokeWidth={2.5} aria-hidden />
      </button>
    </div>
  )
}

/**
 * The orbit ball, right of the pad and its size (arkinox, 2026-10-10: "not
 * being able to orbit hurts"). A drag on it turns the view about the shard,
 * and pointer capture keeps the drag alive after the finger leaves the ball,
 * until it lifts. A tap, no drag, sends the view home. It works with any
 * tool, which is the point: in SELECT and FACE a one-finger drag on the bench
 * is the box (decision A, the same day), and this is how you orbit meanwhile.
 */
function OrbitSphere(): JSX.Element {
  const last = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  const down = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (!e.isPrimary) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    last.current = { x: e.clientX, y: e.clientY }
    moved.current = false
  }
  const move = (e: React.PointerEvent<HTMLButtonElement>): void => {
    if (!last.current) return
    const dx = e.clientX - last.current.x
    const dy = e.clientY - last.current.y
    if (dx === 0 && dy === 0) return
    last.current = { x: e.clientX, y: e.clientY }
    moved.current = true
    orbitBy(dx, dy)
  }
  const up = (): void => {
    if (!last.current) return
    last.current = null
    if (!moved.current) requestView({ kind: 'home' })
  }
  return (
    <button
      className="benchorb"
      title="Drag to orbit the view; keep dragging past the ball. Tap to send the view home."
      aria-label="Orbit the view. Drag to turn, tap for the home view."
      {...noCallout}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <span className="benchorb__sub">ORBIT</span>
    </button>
  )
}

function ControlsPad({ points, objects = 0 }: { points: number; objects?: number }): JSX.Element {
  // Points and placed objects move, turn, cut and copy together.
  const held = points + objects
  const axes = useBenchView((s) => s.axes)
  // In FACE the pad's DELETE is the face's (see the corner below).
  const tool = useWorkshop((s) => s.tool)
  const face = useWorkshop((s) => s.selectedFace)
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
      {held > 0 && (<>
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
      {/* DELETE: the selected points, or in FACE the selected face, in the
          pad's corner (arkinox, 2026-10-10: "the delete button should fill
          the empty spot"). In FACE with points but no face the corner stays
          empty: deleting corners takes every face on them, which is not what
          a face tap meant. */}
      {(tool !== 'face' || face !== null) && (
        <button className="touchpad__key touchpad__key--delete" title={tool === 'face' ? 'Remove this face (Del)' : 'Delete the selected points (Del)'} aria-label={tool === 'face' ? 'Delete the face' : 'Delete selected'} {...noCallout} onClick={() => { if (tool === 'face') w().deleteSelectedFace(); else w().deleteSelected() }}>
          <Trash2 size={14} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">DELETE</span>
        </button>
      )}
      <button className="touchpad__hub" title="Clear the selection (Esc)" aria-label={`${points} points and ${objects} objects selected. Tap to clear.`} {...noCallout} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); w().selectVertex(null) }}>
        {points > 0 && `${points} ${points === 1 ? 'PT' : 'PTS'}`}{points > 0 && objects > 0 && ' · '}{objects > 0 && `${objects} OBJ`}
      </button>
    </>)}

    </div>
  )
}

/**
 * The selection row, first in the bottom-left column under SELECT and FACE
 * (arkinox, 2026-10-10: "maybe eliminate tap-to-deselect and have a deselect
 * button appear above on its own row above the other bottom left button
 * rows. then we can draw multiple little boxes to select. An Invert mode
 * could make taps and box selects deselect instead."). INVERT is always
 * there, since it changes what the next tap does even with nothing in hand,
 * and lit while on; DESELECT joins it to its right while anything is in
 * hand: points, placed objects, a selected face or a half-built face pick.
 * INVERT stands first so neither key moves when the other comes and goes.
 * Nothing on the bench deselects by itself any more, so this row, the pad's
 * hub and Esc are the three ways to let go.
 */
function SelectRow({ inHand }: { inHand: boolean }): JSX.Element {
  const invert = useWorkshop((s) => s.invert)
  const w = useWorkshop.getState
  return (
    <div className="benchclip" role="group" aria-label="Selection">
      <button className={`touchpad__key ${invert ? 'is-on' : ''}`} aria-pressed={invert} title="Taps and boxes take points out of the selection instead of adding" aria-label="Invert: taps and boxes take points out" {...noCallout} onClick={() => w().setInvert(!w().invert)}>
        <Eraser size={15} strokeWidth={2.25} aria-hidden />
        <span className="touchpad__sub">INVERT</span>
      </button>
      {inHand && (
        <button className="touchpad__key" title="Let everything go (Esc)" aria-label="Deselect everything" {...noCallout} onClick={() => { w().selectVertex(null); w().clearFacePick() }}>
          <X size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">DESELECT</span>
        </button>
      )}
    </div>
  )
}

/**
 * The action row (arkinox, 2026-10-10): ALL, FILL, SUBDIVIDE, AUTO and FLIP
 * on one row, where the clipboard row stood. ALL takes every point and every
 * placed object: VERTS and FACES went, since JOINED from one point reaches
 * the piece it belongs to and ALL reaches the pieces that do not touch, which
 * is the one thing a box on a phone cannot do in a stroke. FILL joins the
 * picked corners in FACE, or faces the selected points anywhere. AUTO and
 * FLIP came from the FACE row, which is gone: its DELETE is in the pad's
 * corner now and its SEAM is the color bucket's second stage. FLIP asks how
 * much before it turns anything, the way PASTE asks where. With nothing
 * selected the row holds AUTO alone, and stands on the bottom, since the pad
 * is away then.
 */
function ActionRow({ points, verts, parts, tool, face, picks, faces }: { points: number; verts: number; parts: number; tool: Tool; face: number | null; picks: number; faces: number }): JSX.Element | null {
  const w = useWorkshop.getState
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (face === null) setAsking(false) }, [face])
  const selecting = tool === 'select' || tool === 'face'
  // ALL under SELECT only: in FACE it confused what a tap on a face does
  // (arkinox, 2026-10-10).
  const showAll = tool === 'select' && (verts > 0 || parts > 0)
  const picking = tool === 'face' && picks > 0
  const showFill = picking || points >= 3
  const showSub = selecting && points >= 2
  const showAuto = tool === 'face' && faces > 0
  const showFlip = tool === 'face' && face !== null
  if (!showAll && !showFill && !showSub && !showAuto && !showFlip) return null
  const choose = (fn: () => void) => (): void => { setAsking(false); fn() }
  return (
    <div className="benchclip" role="group" aria-label="Actions">
      {showAll && (
        <button className="touchpad__key" title={`Select all ${verts} points${parts > 0 ? ` and ${parts} objects` : ''}`} aria-label="Select everything" {...noCallout} onClick={() => { w().setSelection([...Array(verts).keys()]); w().setPartSelection([...Array(parts).keys()]) }}>
          <Waypoints size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">ALL</span>
        </button>
      )}
      {showFill && (picking
        ? (
          <button className="touchpad__key" disabled={picks < 3} title="Join the picked corners into a face (Enter)" aria-label={`Fill the ${picks} corners`} {...noCallout} onClick={() => w().fill()}>
            <Triangle size={15} strokeWidth={2.25} aria-hidden />
            <span className="touchpad__sub">FILL</span>
          </button>
        )
        : (
          <button className="touchpad__key" title="Faces across these points: a flat set becomes one face, a solid set its hull (Enter)" aria-label="Fill the selection" {...noCallout} onClick={() => w().fillSelection()}>
            <Triangle size={15} strokeWidth={2.25} aria-hidden />
            <span className="touchpad__sub">FILL</span>
          </button>
        ))}
      {/* SUBDIVIDE after FILL, from two points up: two ends cut an edge, a
          whole face is cut into four (arkinox, 2026-10-10). */}
      {showSub && (
        <button className="touchpad__key touchpad__key--long" title="Cut each fully selected face into four, or a selected edge in two" aria-label="Subdivide the selection" {...noCallout} onClick={() => w().subdivideSelection()}>
          <Grid2x2Plus size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">SUBDIVIDE</span>
        </button>
      )}
      {showAuto && (
        <button className="touchpad__key" title="Every face in the object turned to look outward, by the bench's best guess" aria-label="Turn every face outward" {...noCallout} onClick={() => w().autoWind()}>
          <WandSparkles size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">AUTO</span>
        </button>
      )}
      {showFlip && (
        <button className="touchpad__key touchpad__key--two" title="Turn this face round: which side is its front" aria-label="Flip" aria-haspopup="menu" aria-expanded={asking} {...noCallout} onClick={() => setAsking((o) => !o)}>
          <FlipVertical2 size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">FLIP</span>
        </button>
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

/**
 * The turn row: LEFT and RIGHT, then CUT, COPY and PASTE (arkinox,
 * 2026-10-10: "cut and copy and paste can be added after rotate left and
 * rotate right on that row"). PASTE asks where before it puts anything down,
 * since the answer is not obvious: back where it came from, or on the plane
 * you are working on; CLEAR CLIPBOARD lets the held points go, and PASTE with
 * them. Up while anything is in hand, or something is held.
 */
function TurnRow({ inHand }: { inHand: number }): JSX.Element | null {
  const w = useWorkshop.getState
  const clip = useWorkshop((s) => s.clip)
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (clip === null) setAsking(false) }, [clip])
  if (inHand === 0 && clip === null) return null
  const held = clip ? [clip.points.length ? `${clip.points.length} point${clip.points.length === 1 ? '' : 's'}` : '', clip.parts.length ? `${clip.parts.length} object${clip.parts.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') : ''
  // Read at tap time, as Bench reads it for OBJECT: a paste never makes this shard place itself.
  const self = (): string | undefined => ownAddress(useCyberspace.getState().identity.pubkey, w().currentId)
  return (
    <div className="benchturn" role="group" aria-label="Turn, cut, copy and paste">
      {inHand > 0 && (
        <>
          <button className="touchpad__key" title="A quarter turn left, in the working plane (Q)" aria-label="Turn left" {...noCallout} onClick={() => w().rotateSelected(-1)}>
            <RotateCcw size={18} strokeWidth={2.25} aria-hidden />
            <span className="touchpad__sub">LEFT</span>
          </button>
          <button className="touchpad__key" title="A quarter turn right (E)" aria-label="Turn right" {...noCallout} onClick={() => w().rotateSelected(1)}>
            <RotateCw size={18} strokeWidth={2.25} aria-hidden />
            <span className="touchpad__sub">RIGHT</span>
          </button>
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
        <button className="touchpad__key touchpad__key--two" title={`Paste the ${held} held`} aria-label={`Paste the ${held} held`} aria-haspopup="menu" aria-expanded={asking} {...noCallout} onClick={() => setAsking((o) => !o)}>
          <ClipboardPaste size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">PASTE</span>
        </button>
      )}
      {asking && clip !== null && (
        <>
          {/* Anywhere else puts the question away and pastes nothing. */}
          <div className="benchpaste__away" onPointerDown={() => setAsking(false)} />
          <div className="benchpaste" role="menu" aria-label="Where to paste">
            <button className="workshop__btn" role="menuitem" title="Back on the exact points they were taken from" onClick={() => { setAsking(false); w().pasteClip('exact', self()) }}>PASTE</button>
            <button className="workshop__btn" role="menuitem" title="Resting on the plane you are working on, keeping its shape" onClick={() => { setAsking(false); w().pasteClip('floor', self()) }}>PASTE FLOOR</button>
            <button className="workshop__btn workshop__btn--danger" role="menuitem" title={`Let the ${held} go; PASTE goes with them`} onClick={() => { setAsking(false); w().clearClip() }}>CLEAR CLIPBOARD</button>
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
  const partSel = useWorkshop((s) => s.partSel)
  const stampMode = useWorkshop((s) => s.stampMode)
  const stampObject = useWorkshop((s) => s.stampObject)
  const [picking, setPicking] = useState(false)
  const facePick = useWorkshop((s) => s.facePick)
  const selectedFace = useWorkshop((s) => s.selectedFace)
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
  // PUBLISH (store/usePublished.ts): where this shard stands with the Shard
  // Feed, which the bench cannot show, since a published object and one that
  // never left the browser look the same. RETRACT asks first, so the asking
  // is state here; the yes goes to the store.
  const ledger = usePublished((s) => s.ledger)
  const publishing = usePublished((s) => s.publishing)
  const retracting = usePublished((s) => s.retracting)
  const [retractAsk, setRetractAsk] = useState(false)
  const pubState = useMemo(
    () => publishState(shard ? ledger[shard.id] : undefined, shard ? shardFingerprint(shard) : '', me),
    [shard, ledger, me],
  )
  const wireBytes = useMemo(() => (shard ? new TextEncoder().encode(JSON.stringify(toPayload(shard))).length : 0), [shard])
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
  // Something to deploy or clear: its own vertices, or objects it places (DECK-0003 §1.9 rule 13).
  const hasContent = shard !== null && (shard.vertices.length > 0 || (shard.parts?.length ?? 0) > 0)
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
  const [pickerOpen, setPickerOpen] = useState(false)
  // The color bucket's second stage while a face is in hand (FILL or SEAM):
  // put away when the face goes.
  const [askingColor, setAskingColor] = useState(false)
  const faceInHand = useWorkshop((s) => s.selectedFace)
  useEffect(() => { if (faceInHand === null) setAskingColor(false) }, [faceInHand])
  const [viewOpen, setViewOpen] = useState(false)
  // On a phone the palette sheet and the TOOLS panel would share the bottom,
  // so opening the sheet puts the panel away.
  const [narrow, setNarrow] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = (): void => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  // IMPORT: the file input it opens, whether a file is being read, and
  // whether files are being dragged over the workshop.
  const fileInput = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [dropping, setDropping] = useState(false)
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
  // The workshop is a modal over the scene, with arkinox's order inside it
  // (2026-10-01): its own modals (the palette sheet, the object picker, every
  // confirmation) open later and so close first; then the open panel, the
  // bench's menu; then the view pad, its one chip; then what is in hand; and
  // only then the workshop itself. Esc used to live in the bench's key
  // handler, which closed the workshop from under an open palette sheet.
  useEscape('modal', open, () => {
    const ws = useWorkshop.getState()
    if (panel !== null) setPanel(null)
    else if (viewOpen) setViewOpen(false)
    else if (ws.selection.length || ws.partSel.length || ws.selectedFace !== null || ws.facePick.length) { ws.selectVertex(null); ws.clearFacePick() }
    else ws.closeWorkshop()
  })

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
   *
   * It fills the bench's own clipboard first, so the PASTE beside the tools
   * puts the whole shard down in any shard (arkinox, 2026-10-08), and that
   * works even where the system clipboard does not.
   */
  const copyShard = (s: ShardModel, ok: string): void => {
    if (!w().copyShard(s)) { say(`"${s.name}" is empty. There is nothing to copy yet.`); return }
    const clip = navigator.clipboard
    if (!clip) return
    void clip.writeText(JSON.stringify(toPayload(s))).then(
      () => say(ok),
      () => say(`Copied "${s.name}" for PASTE here. The system clipboard refused it.`),
    )
  }

  const copy = (id: string): void => {
    const s = w().shards.find((x) => x.id === id)
    if (!s) return
    copyShard(s, `Copied "${s.name}" to the clipboard. PASTE it here or anywhere.`)
  }
  const importText = (text: string): void => {
    const id = w().importText(text)
    if (id) { setPasteOpen(false); setPasteText(''); say('Pasted as a new object.') }
    else say('That is not an object.')
  }
  const paste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim()) { importText(text); return }
    } catch { /* no permission or no API: fall through to the box */ }
    setPasteOpen(true)
  }

  /**
   * IMPORT: a 3D file picked or dropped, read off the main thread
   * (lib/meshImport), fitted to half this shard's grid (sno-core importFitFor)
   * with its lowest point on the working plane, and put down selected, one UNDO from gone. In an
   * empty shard it becomes the shard. The line it leaves says what happened,
   * simplified or not.
   */
  const importFromFiles = async (list: FileList | File[] | null): Promise<void> => {
    const files = list ? Array.from(list) : []
    const s = w().current()
    if (!files.length || importing || !s) return
    setImporting(true)
    say(`Reading ${files.find((f) => !/\.(mtl|bin)$/i.test(f.name))?.name ?? files[0].name}…`)
    try {
      const res = await importFiles(files, { fit: importFitFor(s.extent), unit: s.unit, palette: s.palette ?? BUILT_IN, color: w().color })
      if (!res.ok) { say(res.error); return }
      w().insertImport(res.shard, `${res.report.summary}.`)
    } finally {
      setImporting(false)
    }
  }
  const draggingFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')

  const ToolIcon = TOOL_ICON[tool]

  return (
    <div
      className="workshop"
      role="dialog"
      aria-label="Object workshop"
      onDragOver={(e) => { if (!draggingFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dropping) setDropping(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false) }}
      onDrop={(e) => { if (!draggingFiles(e)) return; e.preventDefault(); setDropping(false); void importFromFiles(e.dataTransfer.files) }}
    >
      <div className="workshop__bench">
        <Bench />
      </div>
      {/* IMPORT's picker, kept mounted so a panel closing cannot drop its answer. */}
      <input ref={fileInput} type="file" accept={IMPORT_ACCEPT} multiple hidden aria-hidden tabIndex={-1} onChange={(e) => { const list = e.currentTarget.files; void importFromFiles(list ? Array.from(list) : null); e.currentTarget.value = '' }} />
      {dropping && <div className="workshop__drop" aria-hidden>DROP TO IMPORT</div>}
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
      {/* The grid floor's level, under the chips on every tool. Out of the way
          while a panel is open, as undo and redo are: GRID has its own LEVEL
          row, and the others need the room. */}
      {!panel && shard && <LevelStack />}
      {panel === 'menu' && shard && (
        <div className="ws__panel" role="region" aria-label="Menu">
          <input className="workshop__name" value={shard.name} onChange={(e) => w().rename(shard.id, e.target.value)} aria-label="Object name" spellCheck={false} />
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
          {/* A switch, as the avatar trail, hX and region key settings are,
              in the workshop's own green (arkinox, 2026-10-10). */}
          <div className="workshop__row">
            <Field id="ws-avatar-ghost" label="Default avatar ghost" hint="The to-scale avatar at the grid's center, for size">
              <Switch id="ws-avatar-ghost" className="ui-switch--ok" checked={showAvatar} onCheckedChange={(v) => w().setShowAvatar(v)} />
            </Field>
          </div>
          {/* The shape others see for you: this shard, published as kind 11333,
              drawn in the dodecahedron's cell wherever you are drawn. */}
          <div className="workshop__avatar" role="group" aria-label="My avatar">
            <div className="workshop__row">
              <span className="workshop__label">MY AVATAR</span>
              <span className="workshop__value workshop__value--wide">{myAvatar ? myAvatar.name : 'dodecahedron'}</span>
            </div>
            {/* The buttons take their own row and share it evenly, the way NEW
                OBJECT and PASTE do. On the name's line a long object name pushed
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
                title="Publish this object as the shape others see for you, at true scale: the white avatar on the grid is the size of one cell. Its size and detail are paid for in proof of work first."
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
          {/* PUBLISH: this shard as a public kind 33331 object, listed by the
              Shard Feed and read by other apps (DECK-0003 §3.1), the way
              snocrash.art publishes one (arkinox, 2026-10-10: "I want to make
              steps, rivers, walls, and other pieces that should show up in the
              shard feed instantly"). Hiding seals a copy at a place; this puts
              the object itself on your relays for anyone to place. The tag is
              the ledger's word (lib/published.ts), since no relay keeps one. */}
          <div className="workshop__avatar" role="group" aria-label="Publishing">
            <div className="workshop__row">
              <span className="workshop__label">SHARD FEED</span>
              <span className={`tag ${STATE_TAG[pubState]}`} title={STATE_HELP[pubState]}>{STATE_LABEL[pubState]}</span>
              <span className="workshop__gap" />
            </div>
            <div className="workshop__list-row">
              <button
                className="workshop__btn workshop__btn--warn"
                disabled={!hasContent || publishing || retracting || !me}
                onClick={() => { void usePublished.getState().publish(shard) }}
                title={!hasContent
                  ? 'Nothing to publish yet: add points, or place objects'
                  : pubState === 'other-key'
                    ? STATE_HELP['other-key']
                    : 'Publish this shard as a public object on your relays: the Shard Feed lists it and anyone can place it. PUBLISH AGAIN replaces it in place, same address.'}
              >{publishing ? 'PUBLISHING' : pubState === 'published' || pubState === 'edited' ? 'PUBLISH AGAIN' : 'PUBLISH'}</button>
              {(pubState === 'published' || pubState === 'edited') && (
                <button
                  className="workshop__btn workshop__btn--danger"
                  disabled={publishing || retracting}
                  onClick={() => setRetractAsk(true)}
                  title="Ask your relays to drop the published object (NIP-09). Copies others made stay theirs. The shard stays here."
                >{retracting ? 'RETRACTING' : 'RETRACT'}</button>
              )}
            </div>
            <span className="workshop__work">{wireBytes.toLocaleString('en-US')} BYTES ON THE WIRE · {shard.vertices.length} VERTICES + {shard.faces.length} FACES{shard.parts?.length ? ` + ${shard.parts.length} PLACED` : ''}</span>
          </div>
          {retractAsk && (
            <ConfirmModal
              title={`Retract "${shard.name}"?`}
              body={<>A deletion goes to your relays, naming the object&apos;s address (NIP-09). Relays that honor it drop the object and the Shard Feed stops listing it; a relay that does not may keep handing it out. Copies and LIVE LINKs others placed stay theirs. The shard stays in your workshop, and PUBLISH puts it back.</>}
              confirmLabel="RETRACT"
              busy={retracting}
              onConfirm={() => { void usePublished.getState().retract(shard).then(() => setRetractAsk(false)) }}
              onCancel={() => setRetractAsk(false)}
            />
          )}
          <div className="ws__panel-title">SHARDS ({shards.length})</div>
          <div className="workshop__list-row">
            <button className="workshop__new" onClick={() => w().create()}>+ NEW SHARD</button>
            <button className="workshop__btn" onClick={() => void paste()} title="An object copied from here or anywhere">PASTE</button>
            <button className="workshop__btn" disabled={importing} onClick={() => fileInput.current?.click()} title={`A 3D file, fitted to the grid and put down here: ${IMPORT_FORMATS_LABEL}. Or drop one on the workshop.`}>{importing ? 'READING' : 'IMPORT'}</button>
          </div>
          {pasteOpen && (
            <div className="workshop__paste">
              <textarea className="workshop__paste-box" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder='Paste an object here: {"v":2,"name":"…","vertices":[…],…}' aria-label="Object to import" spellCheck={false} />
              <div className="workshop__list-row">
                <button className="workshop__btn" disabled={!pasteText.trim()} onClick={() => importText(pasteText)}>IMPORT</button>
                <button className="workshop__btn" onClick={() => { setPasteOpen(false); setPasteText('') }}>CANCEL</button>
              </div>
            </div>
          )}
          <ul className="workshop__list">
            {/* The avatar is not one of these shards. It lives in its own store,
                read back from the kind 11333 event you published, which is why
                deleting the object it was built from leaves the avatar standing
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
                  title="Copy it into your objects, where you can edit it"
                  onClick={() => { const id = w().importShard(myAvatar); w().select(id); say(`"${myAvatar.name}" copied into your objects.`) }}
                >⧉</button>
                <button className="workshop__mini workshop__mini--wide" title="Copy to the clipboard" onClick={() => copyShard(myAvatar, 'Avatar copied.')}>COPY</button>
              </li>
            )}
            {/* Last edited first: updatedAt moves on every edit and never on opening (arkinox, 2026-09-26). */}
            {[...shards].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).map((s) => (
              <li key={s.id} className={s.id === shard.id ? 'is-current' : ''}>
                <button className="workshop__pick" onClick={() => w().select(s.id)}>
                  <span className="workshop__pick-name">{s.name}</span>
                  <span className="workshop__pick-meta">{s.vertices.length} v · {s.faces.length} f{s.parts?.length ? ` · ${s.parts.length} parts` : ''} · {s.mode}</span>
                </button>
                <button className="workshop__mini" title="Duplicate" onClick={() => w().duplicate(s.id)}>⧉</button>
                <button className="workshop__mini workshop__mini--wide" title="Copy to the clipboard" onClick={() => copy(s.id)}>COPY</button>
                <button className="workshop__mini workshop__mini--danger workshop__mini--x" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => { if (window.confirm(`Delete "${s.name}"? This cannot be undone.`)) w().remove(s.id) }}>×</button>
              </li>
            ))}
          </ul>
          <div className="workshop__row">
            <button className="workshop__btn workshop__btn--danger" disabled={!hasContent} onClick={() => { if (window.confirm('Delete all vertices, faces and placed objects in the scene?')) w().clearShard() }} title="Empty this scene (undoable)">CLEAR THIS SCENE</button>
            <span className="workshop__gap" />
            <Explanation>
              An object is colored points on a grid of whole units, drawn SOLID (faces, colors blending
              across them), POINTS (every point a light) or LINES (one line through the points in the
              order they were made). STAMP places a whole shape; ADD one point; SELECT points, by tap
              or by dragging a box, to move, color or delete them together, and CONNECT takes everything
              faces join to them; FACE picks corners and FILL joins them, and a tap on a face selects it
              for DELETE FACE. The chip at the bottom right opens all 256 colors, with the ones you
              used most recently on top; the buttons over it put the color on the whole object, the
              connected piece or the selected points, and the dropper takes a point's or face's color. Stamps keep their own corners even where they touch, so a red block against a
              blue one keeps a crisp edge. Under GRID, LEVEL is the height the placing tools work at,
              DEPLOY SCALE MULTIPLIER says how big one grid unit is in the world, from a picometre to
              the width of a sector, and GRID SIZE is how far the grid reaches from the origin. DEPLOY shows
              the object at true size before you place it. Under SHARD FEED, PUBLISH puts the shard on your relays as a
              public object: the Shard Feed lists it, anyone can place it, and PUBLISH AGAIN replaces it under the same
              address; RETRACT asks the relays to drop it. That is separate from hiding, which seals a copy at a place.
              Keys: 1 2 3 4 tools, Q turns a stamp, WASD and
              RF or the arrows nudge the selection in screen directions, C selects what faces join, Del
              deletes, Enter fills, [ ] change the level, Ctrl+Z undoes, Esc closes a panel, then
              clears, then closes the workshop.
            </Explanation>
          </div>
        </div>
      )}

      {panel === 'grid' && shard && (
        <div className="ws__panel" role="region" aria-label="Grid">
          {/* The same stack as the overlay's, here too (arkinox, 2026-10-10:
              "replace the Grid menu Level controls with a copy of the stacked
              controls now in the overlay"). */}
          <div className="workshop__row">
            <span className="workshop__label">LEVEL {'XYZ'[plane]}</span>
            <LevelStack />
            <span className="workshop__unit-size">the height the placing tools work at</span>
          </div>
          <div className="workshop__row">
            <span className="workshop__label">DEPLOY SCALE MULTIPLIER</span>
            <span className="workshop__value">2^</span>
            <button className="workshop__btn" {...bind(() => w().setUnit((w().current()?.unit ?? 0) - 1))} disabled={shard.unit <= 0} aria-label="Smaller unit">−</button>
            <span className="workshop__value">{shard.unit}</span>
            <button className="workshop__btn" {...bind(() => w().setUnit((w().current()?.unit ?? 0) + 1))} disabled={shard.unit >= MAX_UNIT} aria-label="Larger unit">+</button>
            <span className="workshop__unit-size" title="What one grid unit is in the world. DEPLOY shows the object at this size.">one unit = {formatCellSize(shard.unit)}</span>
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
          disabled={!hasContent}
          onClick={() => { if (shard) { useShards.getState().startDeployShard(shard.id); w().closeWorkshop() } }}
          title="Place this object in the world"
        >DEPLOY ▸</button>
        <button className="chip ws__icon" onClick={() => w().closeWorkshop()} title="Close the workshop (Esc)" aria-label="Close"><X size={15} strokeWidth={2.25} aria-hidden /></button>
      </div>
      {/* Where the one selected point is: top right under DEPLOY (arkinox,
          2026-10-10; it stood in the bottom-left column before, where every
          row it shared is busy). A readout, so taps go through to the bench.
          Not in VIEW, where the compass has that corner. */}
      {one && tool !== 'view' && (
        <span className="ws__at ws__at--top" role="status" aria-label="Selected point">
          at ({ticksOf(one).map(unitsLabel).join(', ')})
        </span>
      )}

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
        {(tool === 'select' || tool === 'face') && <SelectRow inHand={selection.length > 0 || partSel.length > 0 || selectedFace !== null || facePick.length > 0} />}
        <ActionRow points={selectedPoints} verts={shard?.vertices.length ?? 0} parts={shard?.parts?.length ?? 0} tool={tool} face={selectedFace} picks={facePick.length} faces={shard?.faces.length ?? 0} />
        <TurnRow inHand={selection.length + partSel.length} />
        {/* The pad only while something is in hand: with the orbit ball on
            the bottom row now, nothing needs the pad's room kept, and an
            empty grid left AUTO floating a third of the way up the screen
            (arkinox, 2026-10-10). */}
        {(selection.length > 0 || partSel.length > 0) && <ControlsPad points={selectedPoints} objects={partSel.length} />}
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
                    <button key={k} className={`workshop__tool ${stampMode === 'shape' && stampKind === k ? 'is-on' : ''}`} aria-pressed={stampMode === 'shape' && stampKind === k} onClick={() => w().setStampKind(k)} title={STAMP_HELP[k]}>{k.toUpperCase()}</button>
                  ))}
                  {/* A published object, placed by reference (DECK-0003 §1.10): it
                      stays that object and follows its author's edits. */}
                  <button className={`workshop__tool ${stampMode === 'object' ? 'is-on' : ''}`} aria-pressed={stampMode === 'object'} onClick={() => { w().setStampMode('object'); if (!w().stampObject) setPicking(true) }} title="Stamp a published object, placed by reference">
                    <Box size={12} strokeWidth={2.25} aria-hidden />OBJECT
                  </button>
                </div>
              </div>
              {stampMode === 'object' && (
                <div className="workshop__row" role="group" aria-label="Object to stamp">
                  <span className="workshop__label">OBJECT</span>
                  <button className={`ws__slot ${stampObject ? 'is-full' : ''}`} onClick={() => setPicking(true)} title={stampObject ? 'Choose another object' : 'Choose an object'}>
                    {stampObject
                      ? <><span className="ws__slot-name">{stampObject.name}</span><span className="ws__slot-meta">{stampObject.shard.vertices.length} v · {stampObject.shard.faces.length} f{stampObject.shard.parts?.length ? ` · ${stampObject.shard.parts.length} obj` : ''} · CHANGE</span></>
                      : <span className="ws__slot-meta">EMPTY · tap to choose</span>}
                  </button>
                </div>
              )}
              <div className="workshop__row">
                {stampMode === 'shape' && (
                  <>
                    <span className="workshop__label">SIZE</span>
                    <button className="workshop__btn" {...bind(() => w().setStampSize(w().stampSize - 1))} disabled={stampSize <= MIN_SIZE} aria-label="Smaller">−</button>
                    <span className="workshop__value">{stampSize}</span>
                    <button className="workshop__btn" {...bind(() => w().setStampSize(w().stampSize + 1))} disabled={stampSize >= MAX_SIZE} aria-label="Larger">+</button>
                  </>
                )}
                {(stampMode === 'object' || FACED[stampKind]) && (
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
        {/* The tool chip, last in the column so every row stands directly
            above it (arkinox, 2026-10-10). Shorter than it was: the TOOLS
            word and the wrench went. The orbit ball is not in this column at
            all any more: docked at the bottom right (below), so no row ever
            has to clear it. */}
        <div className="ws__toolchips">
          <button className={`chip ws__chip ${panel === 'tools' ? 'is-on' : ''}`} aria-pressed={panel === 'tools'} onClick={() => toggle('tools')} title="Tools: pick what a tap does">
            <ToolIcon size={12} strokeWidth={2.25} aria-hidden />{tool.toUpperCase()}
          </button>
          {tool !== 'view' && (
            <button className="chip ws__chip ws__chip--x" onClick={() => w().setTool('view')} title="Put the tool down (1)" aria-label="Put the tool down">
              <X size={13} strokeWidth={2.25} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {/* The orbit ball, docked at the bottom right beside the color column,
          on every tool (arkinox, 2026-10-10: right aligned, and the left-hand
          rows must never jump above it). It sat in the bottom-left column's
          last row first, where its height lifted every row by 152px. */}
      <OrbitSphere />

      {/* Bottom right: the color column. FILL for a set of points is on the
          clipboard row, and the FACE tool's actions on its own row there. */}
      <div className="ws__corner">
        {stacked > 0 && (
          <div className="benchops" role="group" aria-label="Weld stacked points">
            <span className="workshop__value workshop__value--wide">{stacked} stacked</span>
            {/* Never automatic: a paste lands on its original on purpose, to be
                moved. This is the deliberate act once the shape is settled. */}
            <button className="workshop__btn" onClick={() => w().weld()} title={selection.length >= 2 ? 'Fold the selected points that stand on one spot into one' : 'Fold every point standing on another into one; faces that disagree on color keep their own'}>WELD</button>
          </div>
        )}
        {/* What an action reaches, a column over the chip, widest at the top:
            the whole object, the piece the points in hand are joined to, the
            points themselves, nearest the chip (arkinox, 2026-09-24). These used to sit inside
            a column the chip unfolded into, along with eight remembered
            swatches and a second way to open the palette. The palette modal
            replaced all three of those, so the column was a worse copy of it
            wrapped around the only part worth keeping. */}
        {(tool !== 'face' || selectedFace !== null) && (
          <div className="ws__acts" role="group" aria-label="Apply the color">
            {/* The dropper, over the globe while one point or one face is in
                hand (arkinox, 2026-10-10; it stood beside the chip before):
                that color, a face's as the average of its corners, into the
                chip and onto the front of the recent row. */}
            {(selection.length === 1 || (selection.length === 0 && selectedFace !== null)) && (
              <button className="workshop__color ws__act" onClick={() => w().sampleColor()} title={selection.length === 1 ? 'Take this point\'s color' : 'Take this face\'s color, the average of its corners'} aria-label="Take the selected color" {...noCallout}>
                <Pipette size={17} strokeWidth={2.25} aria-hidden />
              </button>
            )}
            <button className="workshop__color ws__act" disabled={!shard || shard.vertices.length === 0} onClick={() => w().colorAll(w().color)} title="The color onto every vertex in the object" aria-label="Color everything" style={{ borderColor: hex }} {...noCallout}>
              <Globe size={17} strokeWidth={2.25} aria-hidden />
            </button>
            {selection.length > 0 && (
              <button className="workshop__color ws__act" onClick={() => w().colorConnected(w().color)} title="The color onto these points and everything joined to them by faces" aria-label="Color the connected piece" style={{ borderColor: hex }} {...noCallout}>
                <Waypoints size={17} strokeWidth={2.25} aria-hidden />
              </button>
            )}
            {/* The bucket: the color onto the points in hand. With a face in
                hand it asks first (arkinox, 2026-10-10; SEAM was its own key
                on the face row): FILL colors the corners and blends across
                the edges they share, SEAM gives this one face a hard color
                that stops at its edge (store colorFace). */}
            {selection.length > 0 && selectedFace === null && (
              <button className="workshop__color ws__act" onClick={() => w().colorSelected(w().color)} title="The color onto the points in hand" aria-label="Color the selected points" style={{ borderColor: hex }} {...noCallout}>
                <PaintBucket size={17} strokeWidth={2.25} aria-hidden />
              </button>
            )}
            {selectedFace !== null && (
              <button className="workshop__color ws__act ws__act--two" onClick={() => setAskingColor((o) => !o)} title="Color this face: its corners, or a hard seam" aria-label="Color the face" aria-haspopup="menu" aria-expanded={askingColor} style={{ borderColor: hex }} {...noCallout}>
                <PaintBucket size={17} strokeWidth={2.25} aria-hidden />
              </button>
            )}
            {askingColor && selectedFace !== null && (
              <>
                {/* Anywhere else puts the question away and colors nothing. */}
                <div className="benchpaste__away" onPointerDown={() => setAskingColor(false)} />
                <div className="benchpaste benchpaste--right" role="menu" aria-label="How to color the face">
                  <button className="workshop__btn" role="menuitem" title="The color onto the face's corners; it blends across the edges they share" onClick={() => { setAskingColor(false); w().colorSelected(w().color) }}>FILL</button>
                  <button className="workshop__btn" role="menuitem" title="The color onto this face as a hard seam, not blended from its corners" onClick={() => { setAskingColor(false); w().colorFace(selectedFace, w().color) }}>SEAM</button>
                </div>
              </>
            )}
          </div>
        )}
        {/*
          Always here, including under FACE with nothing selected.

          The row above it is hidden then, because those buttons apply a color
          and there is nothing to apply one to. This does not apply anything:
          it is the color in hand, and choosing it before picking the face to
          put it on is the obvious order to work in. Hiding it meant selecting
          a face you did not want yet just to reach the palette.
        */}
        <div className="ws__chiprow">
        <button
          className="chip ws__colorchip"
          style={{ background: hex }}
          onClick={() => { setPickerOpen(true); if (narrow && panel === 'tools') setPanel(null) }}
          title={`${hex}. Tap for all 256.`}
          aria-label={`Color ${hex}, tap to open the palette`}
        />
        </div>
        {pickerOpen && <PaletteModal onClose={() => setPickerOpen(false)} />}
      </div>

      {picking && <ObjectPicker onClose={() => setPicking(false)} />}

    </div>
  )
}
