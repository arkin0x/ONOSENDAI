/**
 * HeldRows.tsx - what you can do to what you hold: the selection row
 * (INVERT, DESELECT), the turn row (LEFT, RIGHT, CUT, COPY, PASTE), the
 * action row (ALL, FILL, SUBDIVIDE, AUTO, FLIP) and WELD, side by side in
 * the strip, and the move pad over the strip at the bottom left. Moved out of
 * Workshop.tsx unchanged when the workshop was split by place (workshop
 * redesign, phase 1); phase 2 turns them into the held bar's fixed slots.
 */

import { useEffect, useMemo, useState } from 'react'
import { ClipboardPaste, Copy, Eraser, FlipVertical2, Grid2x2Plus, Link, Merge, RotateCcw, RotateCw, Scissors, Trash2, Triangle, WandSparkles, Waypoints, X } from 'lucide-react'
import { ticksOf } from 'sno-core/shards'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { stackedSpots } from '../lib/weld'
import { useCyberspace } from '../store/useCyberspace'
import { ownAddress, useWorkshop, type Tool } from '../store/useWorkshop'
import { nudgeFor, nudgeLabel, useBenchView, type NudgeName } from './benchAxes'

/**
 * The CONTROLS pad: the main pad's nine cells, for the selection. Arrows move
 * it a unit in screen directions (the sub-label says which world axis that is
 * right now), the corners CONNECT and DELETE, the hub counts the points and
 * clears them.
 */
function ControlsPad({ points, objects = 0 }: { points: number; objects?: number }): JSX.Element {
  // Points and placed objects move, turn, cut and copy together.
  const held = points + objects
  const axes = useBenchView((s) => s.axes)
  // In FACE the pad's DELETE is the face's (see the corner below).
  const tool = useWorkshop((s) => s.tool)
  const face = useWorkshop((s) => s.selectedFaces.length > 0)
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
      {(tool !== 'face' || face) && (
        <button className="touchpad__key touchpad__key--delete" title={tool === 'face' ? 'Remove the selected faces (Del)' : 'Delete the selected points (Del)'} aria-label={tool === 'face' ? 'Delete the face' : 'Delete selected'} {...noCallout} onClick={() => { if (tool === 'face') w().deleteSelectedFace(); else w().deleteSelected() }}>
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
 * The weld row, its own row at the top of the bottom-left column (arkinox,
 * 2026-10-12: "weld ui overlay disables the orbit button. I don't like this.
 * let's move it to the left side stack and make it a row. if nothing is below
 * it, it should sit above the tools button."). It stood in the color corner
 * at the bottom right, where it rose over the orbit ball and took its drags.
 * First in the column, so the selection rows, the pad and the chip under it
 * never move when it comes and goes; with none of them up it stands directly
 * on the chip. The count is the readout, WELD the act: never automatic, since
 * a paste lands on its original on purpose, to be moved.
 */
export function WeldRow({ stacked, selected }: { stacked: { spots: number; points: number }; selected: number }): JSX.Element | null {
  if (stacked.spots <= 0) return null
  return (
    <div className="benchclip benchweld" role="group" aria-label="Weld stacked points">
      <span className="benchweld__count" role="status" title={`${stacked.points} points share ${stacked.spots} spot${stacked.spots === 1 ? '' : 's'}; WELD folds each spot into one point`}>{stacked.spots} SPOT{stacked.spots === 1 ? '' : 'S'} STACKED</span>
      <button className="touchpad__key" title={selected >= 2 ? 'Fold the selected points that stand on one spot into one' : 'Fold every point standing on another into one; faces that disagree on color keep their own'} aria-label={selected >= 2 ? 'Weld the selected stacked points' : 'Weld every stacked point'} {...noCallout} onClick={() => useWorkshop.getState().weld()}>
        <Merge size={15} strokeWidth={2.25} aria-hidden />
        <span className="touchpad__sub">WELD</span>
      </button>
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
function ActionRow({ points, verts, parts, tool, face, picks, faces }: { points: number; verts: number; parts: number; tool: Tool; face: boolean; picks: number; faces: number }): JSX.Element | null {
  const w = useWorkshop.getState
  const [asking, setAsking] = useState(false)
  useEffect(() => { if (!face) setAsking(false) }, [face])
  const selecting = tool === 'select' || tool === 'face'
  // ALL under SELECT only: in FACE it confused what a tap on a face does
  // (arkinox, 2026-10-10).
  const showAll = tool === 'select' && (verts > 0 || parts > 0)
  const picking = tool === 'face' && picks > 0
  const showFill = picking || points >= 3
  const showSub = selecting && points >= 2
  const showAuto = tool === 'face' && faces > 0
  const showFlip = tool === 'face' && face
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
        <button className="touchpad__key touchpad__key--two" title="Turn the selected faces round: which side is the front" aria-label="Flip" aria-haspopup="menu" aria-expanded={asking} {...noCallout} onClick={() => setAsking((o) => !o)}>
          <FlipVertical2 size={15} strokeWidth={2.25} aria-hidden />
          <span className="touchpad__sub">FLIP</span>
        </button>
      )}
      {asking && face && (
        <>
          {/* Anywhere else puts the question away and turns nothing. */}
          <div className="benchpaste__away" onPointerDown={() => setAsking(false)} />
          <div className="benchpaste" role="menu" aria-label="What to flip">
            <button className="workshop__btn" role="menuitem" title="The selected faces turned round, each back to its front" onClick={choose(() => w().flipSelectedFace())}>FLIP FACE</button>
            <button className="workshop__btn" role="menuitem" title="The selected faces turned round, and every face joined to them by an edge turned to agree" onClick={choose(() => w().flipSelectedSurface())}>FLIP SURFACE</button>
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

/** How many points the selection holds: vertices sharing a spot count once. */
function useSelectedPoints(): number {
  const shard = useWorkshop((s) => s.current())
  const selection = useWorkshop((s) => s.selection)
  return shard ? new Set(selection.map((i) => { const v = shard.vertices[i]; return v ? ticksOf(v).join(',') : '' })).size : 0
}

/**
 * The held rows, side by side in the strip (workshop redesign, phase 1):
 * the selection row, the turn row, the action row and WELD, each there only
 * when it applies, as they were when they stood in a column over the tools.
 * Their keys and their questions (PASTE where, FLIP how much) are unchanged.
 */
export function HeldActions(): JSX.Element {
  const shard = useWorkshop((s) => s.current())
  const tool = useWorkshop((s) => s.tool)
  const selection = useWorkshop((s) => s.selection)
  const partSel = useWorkshop((s) => s.partSel)
  const facePick = useWorkshop((s) => s.facePick)
  const faceHeld = useWorkshop((s) => s.selectedFaces.length > 0)
  const stacked = useMemo(() => (shard ? stackedSpots(shard) : { spots: 0, points: 0 }), [shard])
  const selectedPoints = useSelectedPoints()
  return (
    <>
      {(tool === 'select' || tool === 'face') && <SelectRow inHand={selection.length > 0 || partSel.length > 0 || faceHeld || facePick.length > 0} />}
      <TurnRow inHand={selection.length + partSel.length} />
      <ActionRow points={selectedPoints} verts={shard?.vertices.length ?? 0} parts={shard?.parts?.length ?? 0} tool={tool} face={faceHeld} picks={facePick.length} faces={shard?.faces.length ?? 0} />
      <WeldRow stacked={stacked} selected={selection.length} />
    </>
  )
}

/**
 * The move pad, at the bottom left standing on the strip, only while
 * something is in hand: an empty grid left AUTO floating a third of the way
 * up the screen (arkinox, 2026-10-10). Phase 2 puts move handles on the
 * object in its place, and the pad behind MORE.
 */
export function HeldPad(): JSX.Element | null {
  const selection = useWorkshop((s) => s.selection)
  const partSel = useWorkshop((s) => s.partSel)
  const selectedPoints = useSelectedPoints()
  if (selection.length === 0 && partSel.length === 0) return null
  return (
    <div className="ws__held">
      <ControlsPad points={selectedPoints} objects={partSel.length} />
    </div>
  )
}
