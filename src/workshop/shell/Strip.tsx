/**
 * Strip.tsx - the strip, over the dock, one of the workshop's five fixed
 * places: the one place for options (workshop redesign, phases 1 and 2).
 *
 * With nothing held it shows the tool's options: on its left the tool in
 * hand and a ? that says what a tap does, then the options, then MORE at the
 * right end, on every tool.
 *   STAMP:  the shape (a chip that opens picture tiles, OBJECT among them),
 *           SIZE, TURN.
 *   SELECT: ADD or REMOVE (what a tap or a box does), BOX (a one-finger drag
 *           draws a box instead of orbiting), ALL.
 *   FACE:   the corners so far, then FILL, BACK, CANCEL, AUTO, always in
 *           that order, greyed out until they apply.
 * With anything held, in any tool, it is the held bar (HeldBar), whose slots
 * never move. FACE's corner picking is not holding: its strip stays.
 */

import { useEffect, useState } from 'react'
import { ArrowBigUp, Box, ChevronDown, CircleHelp, Cylinder, Ellipsis, Pyramid, RotateCw, SquareDashedMousePointer, Star, Torus, TriangleRight, Undo2, WandSparkles, Waypoints, X, Triangle, type LucideIcon } from 'lucide-react'
import { FACED, FACING_LABEL, MAX_SIZE, MIN_SIZE, STAMPS, STAMP_HELP, type StampKind } from 'sno-core/stamps'
import { useEscape } from '../../hooks/useEscape'
import { noCallout, useRepeatable } from '../../hooks/useRepeatable'
import { useWorkshop, type Tool } from '../../store/useWorkshop'
import { slotOf } from './Dock'
import { HeldBar, useHolding } from './HeldBar'

/** What a tap does with each tool, behind the strip's ?. */
export const TOOL_HELP: Record<Tool, string> = {
  view: 'Look around: one finger orbits, two pan, pinch zooms. Tap the view ball for views, or to tip or roll the grid a quarter so the next points go on another plane. Pick a tool to build.',
  stamp: 'Tap the grid to place the shape where the ghost shows. Q turns it.',
  add: 'Tap the grid to place a vertex at the current level.',
  select: 'Tap points to gather them. BOX makes a drag draw a box; REMOVE makes taps and boxes take points out. The count in the bar lets go.',
  face: 'Tap corners in order, then the first again or FILL. Tap a face to hold it. A dark face shows its back: FLIP under MORE turns it round, AUTO turns every face outward.',
}

/** Each built-in shape's picture on its tile and on the shape chip. */
const SHAPE_ICON: Record<StampKind, LucideIcon> = { block: Box, wedge: TriangleRight, pyramid: Pyramid, column: Cylinder, ring: Torus, star: Star, arrow: ArrowBigUp }

/** STAMP's options: the shape chip and its tiles, SIZE or the object, TURN. */
function StampOptions({ onPickObject, tiles, setTiles }: { onPickObject: () => void; tiles: boolean; setTiles: (on: boolean) => void }): JSX.Element {
  const stampMode = useWorkshop((s) => s.stampMode)
  const stampObject = useWorkshop((s) => s.stampObject)
  const stampKind = useWorkshop((s) => s.stampKind)
  const stampSize = useWorkshop((s) => s.stampSize)
  const stampFacing = useWorkshop((s) => s.stampFacing)
  const bind = useRepeatable()
  const w = useWorkshop.getState
  const object = stampMode === 'object'
  const Icon = object ? Box : SHAPE_ICON[stampKind]
  return (
    <>
      <button className="ws__stripbtn ws__shapechip is-on" onClick={() => setTiles(!tiles)} aria-haspopup="menu" aria-expanded={tiles} aria-label={`Shape: ${object ? 'OBJECT' : stampKind.toUpperCase()}. Tap for the shapes.`} title="Choose what STAMP places">
        <Icon size={16} strokeWidth={2.25} aria-hidden />
        <span className="ws__shapechip-name">{object ? (stampObject?.name ?? 'OBJECT') : stampKind.toUpperCase()}</span>
        <ChevronDown size={14} strokeWidth={2.25} aria-hidden />
      </button>
      {object
        ? (
          <button className={`ws__slot${stampObject ? ' is-full' : ''}`} onClick={onPickObject} title={stampObject ? 'Choose another object' : 'Choose an object'}>
            {stampObject
              ? <><span className="ws__slot-name">{stampObject.name}</span><span className="ws__slot-meta">{stampObject.shard.vertices.length} v · {stampObject.shard.faces.length} f · CHANGE</span></>
              : <span className="ws__slot-meta">EMPTY · tap to choose</span>}
          </button>
        )
        : (
          <div className="ws__strip-group ws__stepper" role="group" aria-label="Size">
            <button className="ws__stripbtn ws__stripbtn--sq" {...bind(() => w().setStampSize(w().stampSize - 1))} disabled={stampSize <= MIN_SIZE} aria-label="Smaller">−</button>
            <span className="ws__stepper-value"><b>{stampSize}</b><span>SIZE</span></span>
            <button className="ws__stripbtn ws__stripbtn--sq" {...bind(() => w().setStampSize(w().stampSize + 1))} disabled={stampSize >= MAX_SIZE} aria-label="Larger">+</button>
          </div>
        )}
      <button className="ws__stripbtn ws__stripbtn--tall" disabled={!object && !FACED[stampKind]} onClick={() => w().turnStamp()} title={`Turn a quarter (Q): facing ${FACING_LABEL[stampFacing]}`} aria-label={`Turn, facing ${FACING_LABEL[stampFacing]}`}>
        <RotateCw size={16} strokeWidth={2.25} aria-hidden /><span>TURN</span>
      </button>
      {tiles && (
        <>
          <div className="benchpaste__away" onPointerDown={() => setTiles(false)} />
          <div className="ws__tiles" role="menu" aria-label="Shapes">
            {STAMPS.map((k) => {
              const I = SHAPE_ICON[k]
              const on = !object && stampKind === k
              return (
                <button key={k} role="menuitemradio" aria-checked={on} className={`ws__tile${on ? ' is-on' : ''}`} title={STAMP_HELP[k]} onClick={() => { w().setStampKind(k); setTiles(false) }}>
                  <I size={22} strokeWidth={1.75} aria-hidden /><span>{k.toUpperCase()}</span>
                </button>
              )
            })}
            {/* A published object, placed by reference (DECK-0003 §1.10): it
                stays that object and follows its author's edits. */}
            <button role="menuitemradio" aria-checked={object} className={`ws__tile${object ? ' is-on' : ''}`} title="Stamp a published object, placed by reference" onClick={() => { w().setStampMode('object'); setTiles(false); if (!w().stampObject) onPickObject() }}>
              <Box size={22} strokeWidth={1.75} aria-hidden /><span>OBJECT</span>
            </button>
          </div>
        </>
      )}
    </>
  )
}

/** SELECT's options: what a tap or a box does, whether a drag draws a box, and ALL. */
function SelectOptions(): JSX.Element {
  const invert = useWorkshop((s) => s.invert)
  const box = useWorkshop((s) => s.boxSelect)
  const any = useWorkshop((s) => { const c = s.current(); return !!c && (c.vertices.length > 0 || (c.parts?.length ?? 0) > 0) })
  const w = useWorkshop.getState
  return (
    <>
      <div className="ws__seg" role="group" aria-label="A tap or a box">
        <button className={`ws__stripbtn${!invert ? ' is-on' : ''}`} aria-pressed={!invert} onClick={() => w().setInvert(false)} title="Taps and boxes add points" {...noCallout}>ADD</button>
        <button className={`ws__stripbtn${invert ? ' is-on' : ''}`} aria-pressed={invert} onClick={() => w().setInvert(true)} aria-label="Remove: taps and boxes take points out" title="Taps and boxes take points out" {...noCallout}>REMOVE</button>
      </div>
      <button className={`ws__stripbtn ws__stripbtn--tall${box ? ' is-on' : ''}`} aria-pressed={box} onClick={() => w().setBoxSelect(!box)} title="On: a one-finger drag draws a box. Off: it turns the view" aria-label="Box: a drag draws a box" {...noCallout}>
        <SquareDashedMousePointer size={16} strokeWidth={2.25} aria-hidden /><span>BOX</span>
      </button>
      <button className="ws__stripbtn ws__stripbtn--tall" disabled={!any} onClick={() => { const c = w().current(); if (!c) return; w().setSelection([...Array(c.vertices.length).keys()]); w().setPartSelection([...Array(c.parts?.length ?? 0).keys()]) }} title="Every point and every placed object" aria-label="Select everything" {...noCallout}>
        <Waypoints size={16} strokeWidth={2.25} aria-hidden /><span>ALL</span>
      </button>
    </>
  )
}

/** FACE's options: the corners so far, FILL, BACK, CANCEL, AUTO, in that order always. */
function FaceOptions(): JSX.Element {
  const picks = useWorkshop((s) => s.facePick.length)
  const faces = useWorkshop((s) => s.current()?.faces.length ?? 0)
  const w = useWorkshop.getState
  return (
    <>
      <span className={`ws__corners${picks > 0 ? ' is-on' : ''}`} role="status" aria-label={`${picks} corners picked`}>
        <b>{picks < 3 ? `${picks}/3` : picks}</b><span>CORNERS</span>
      </span>
      <button className="ws__stripbtn ws__stripbtn--tall" disabled={picks < 3} onClick={() => w().fill()} title="Join the picked corners into a face (Enter)" aria-label={`Fill the ${picks} corners`} {...noCallout}>
        <Triangle size={16} strokeWidth={2.25} aria-hidden /><span>FILL</span>
      </button>
      <button className="ws__stripbtn ws__stripbtn--tall" disabled={picks === 0} onClick={() => w().unpickLast()} title="Let the last corner go" aria-label="Back: let the last corner go" {...noCallout}>
        <Undo2 size={16} strokeWidth={2.25} aria-hidden /><span>BACK</span>
      </button>
      <button className="ws__stripbtn ws__stripbtn--tall" disabled={picks === 0} onClick={() => w().clearFacePick()} title="Let every corner go" aria-label="Cancel the face" {...noCallout}>
        <X size={16} strokeWidth={2.25} aria-hidden /><span>CANCEL</span>
      </button>
      <button className="ws__stripbtn ws__stripbtn--tall" disabled={faces === 0} onClick={() => w().autoWind()} title="Every face in the object turned to look outward, by the bench's best guess" aria-label="Turn every face outward" {...noCallout}>
        <WandSparkles size={16} strokeWidth={2.25} aria-hidden /><span>AUTO</span>
      </button>
    </>
  )
}

export function Strip({ onPickObject, onMore, moreBadge }: { onPickObject: () => void; onMore: () => void; moreBadge: number }): JSX.Element {
  const tool = useWorkshop((s) => s.tool)
  const holding = useHolding()
  const [help, setHelp] = useState(false)
  const [tiles, setTiles] = useState(false)
  // A new tool, or something held, and the last question's answer goes.
  useEffect(() => { setHelp(false); setTiles(false) }, [tool, holding])
  useEscape('modal', help, () => setHelp(false))
  useEscape('modal', tiles, () => setTiles(false))
  if (holding) {
    return (
      <div className="ws__strip ws__strip--held">
        <HeldBar onMore={onMore} moreBadge={moreBadge} />
      </div>
    )
  }
  const slot = slotOf(tool)
  const Icon = slot.icon
  return (
    <div className="ws__strip" role="toolbar" aria-label={`${slot.label} options`}>
      <button className={`ws__strip-tool${help ? ' is-on' : ''}`} onClick={() => setHelp((h) => !h)} aria-expanded={help} aria-label={`What ${slot.label} does`} title={`What ${slot.label} does`}>
        <Icon size={16} strokeWidth={2} aria-hidden />
        <span>{slot.label}</span>
        <CircleHelp size={12} strokeWidth={2.25} aria-hidden className="ws__strip-q" />
      </button>
      <div className="ws__strip-opts">
        {tool === 'stamp' && <StampOptions onPickObject={onPickObject} tiles={tiles} setTiles={setTiles} />}
        {tool === 'select' && <SelectOptions />}
        {tool === 'face' && <FaceOptions />}
      </div>
      <button className="ws__stripbtn ws__stripbtn--tall ws__strip-more" onClick={onMore} title="Everything rarer: PASTE, COLOR ALL, WELD" aria-label="More">
        <Ellipsis size={16} strokeWidth={2.25} aria-hidden /><span>MORE</span>
        {moreBadge > 0 && <i className="ws__badge" aria-hidden>{moreBadge}</i>}
      </button>
      {help && <div className="ws__hint" role="note" onClick={() => setHelp(false)}>{TOOL_HELP[tool]}</div>}
    </div>
  )
}
