/**
 * Strip.tsx - the strip, over the dock, one of the workshop's five fixed
 * places: the one place for options (workshop redesign, phases 1 to 3).
 *
 * With nothing held it shows the tool's options: on its left the tool in
 * hand and a ? that says what a tap does, then the options, then MORE at the
 * right end, on every tool.
 *   LOOK:   HOME and FIT.
 *   STAMP:  the shape (a chip that opens picture tiles, OBJECT among them),
 *           SIZE, TURN.
 *   SELECT: POINTS, FACES or OBJECTS (what a tap or a box takes), ADD or
 *           REMOVE, BOX (a one-finger drag draws a box instead of
 *           orbiting), ALL.
 *   PAINT:  POINT, FACE, PIECE or ALL (what a tap paints), BLEND or EDGE.
 *   FACE:   the corners so far, then FILL, BACK, CANCEL, AUTO, always in
 *           that order, greyed out until they apply.
 * With anything held, in any tool but LOOK, it is the held bar (HeldBar),
 * whose slots never move; LOOK shows the shard as the world does, so what is
 * held stays out of sight there (workshop/benchLook.tsx). FACE's corner picking is not holding: its strip stays.
 */

import { useEffect, useState } from 'react'
import { ArrowBigUp, Box, Boxes, House, Scan, ChevronDown, CircleDot, CircleHelp, Cylinder, Ellipsis, Pyramid, RotateCw, SquareDashedMousePointer, Star, Torus, TriangleRight, Undo2, WandSparkles, Waypoints, X, Triangle, type LucideIcon } from 'lucide-react'
import { FACED, FACING_LABEL, MAX_SIZE, MIN_SIZE, STAMPS, STAMP_HELP, type StampKind } from 'sno-core/stamps'
import { useEscape } from '../../hooks/useEscape'
import { noCallout, useRepeatable } from '../../hooks/useRepeatable'
import { useWorkshop, type PaintMode, type SelectKind, type Tool } from '../../store/useWorkshop'
import { requestView } from '../benchAxes'
import { slotOf } from './Dock'
import { HeldBar, useHolding } from './HeldBar'
import { isLook } from '../lookTool'

/** What a tap does with each tool, behind the strip's ?. */
export const TOOL_HELP: Record<Tool, string> = {
  view: 'See it as it looks in cyberspace. One finger orbits, two pan, pinch zooms. Tap the view ball for views, or to tip or roll the grid a quarter so the next points go on another plane. Pick a tool to build.',
  stamp: 'Tap the grid to place the shape where the ghost shows. Q turns it.',
  add: 'Tap the grid to place a vertex at the current level.',
  select: 'Tap to gather points, faces or objects, as the first chip says. BOX makes a drag draw a box; REMOVE makes taps and boxes take out. The count in the bar lets go.',
  face: 'Tap corners in order, then the first again or FILL. A dark face shows its back: AUTO turns every face outward. To hold a face, SELECT FACES.',
  paint: 'Pick a color in the last slot, then tap: POINT, FACE, PIECE or ALL says what it paints. BLEND or EDGE is how a face takes it.',
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

/** LOOK's options: the view sent HOME, or the whole shard FIT in it (as the view ball's menu has them). */
function LookOptions(): JSX.Element {
  return (
    <>
      <button className="ws__stripbtn ws__stripbtn--tall" onClick={() => requestView({ kind: 'home' })} title="The view the bench opens on" {...noCallout}>
        <House size={16} strokeWidth={2.25} aria-hidden /><span>HOME</span>
      </button>
      <button className="ws__stripbtn ws__stripbtn--tall" onClick={() => requestView({ kind: 'fit' })} title="The whole shard in view, from where you look" {...noCallout}>
        <Scan size={16} strokeWidth={2.25} aria-hidden /><span>FIT</span>
      </button>
    </>
  )
}

/** What SELECT takes, by its switch: the picture and the word on the chip and its tiles. */
const KINDS: Array<{ kind: SelectKind; label: string; icon: LucideIcon; title: string }> = [
  { kind: 'points', label: 'POINTS', icon: CircleDot, title: 'Taps and boxes take points' },
  { kind: 'faces', label: 'FACES', icon: Triangle, title: 'Taps and boxes take faces, with their corners' },
  { kind: 'objects', label: 'OBJECTS', icon: Boxes, title: 'Taps and boxes take placed objects' },
]

/**
 * SELECT's options: what a tap or a box takes (POINTS, FACES or OBJECTS, a
 * chip that opens tiles, as STAMP's shape does), ADD or REMOVE, BOX, ALL.
 */
function SelectOptions({ tiles, setTiles }: { tiles: boolean; setTiles: (on: boolean) => void }): JSX.Element {
  const invert = useWorkshop((s) => s.invert)
  const box = useWorkshop((s) => s.boxSelect)
  const kind = useWorkshop((s) => s.selectKind)
  const counts = useWorkshop((s) => { const c = s.current(); return { points: c?.vertices.length ?? 0, faces: c?.faces.length ?? 0, objects: c?.parts?.length ?? 0 } }, (a, b) => a.points === b.points && a.faces === b.faces && a.objects === b.objects)
  const w = useWorkshop.getState
  const on = KINDS.find((k) => k.kind === kind) ?? KINDS[0]
  return (
    <>
      <button className="ws__stripbtn ws__shapechip is-on" onClick={() => setTiles(!tiles)} aria-haspopup="menu" aria-expanded={tiles} aria-label={`Takes ${on.label}. Tap to change.`} title="What a tap or a box takes">
        <on.icon size={16} strokeWidth={2.25} aria-hidden />
        <span className="ws__shapechip-name">{on.label}</span>
        <ChevronDown size={14} strokeWidth={2.25} aria-hidden />
      </button>
      <div className="ws__seg" role="group" aria-label="A tap or a box">
        <button className={`ws__stripbtn${!invert ? ' is-on' : ''}`} aria-pressed={!invert} onClick={() => w().setInvert(false)} title="Taps and boxes add" {...noCallout}>ADD</button>
        <button className={`ws__stripbtn${invert ? ' is-on' : ''}`} aria-pressed={invert} onClick={() => w().setInvert(true)} aria-label="Remove: taps and boxes take out" title="Taps and boxes take out" {...noCallout}>REMOVE</button>
      </div>
      <button className={`ws__stripbtn ws__stripbtn--tall${box ? ' is-on' : ''}`} aria-pressed={box} onClick={() => w().setBoxSelect(!box)} title="On: a one-finger drag draws a box. Off: it turns the view" aria-label="Box: a drag draws a box" {...noCallout}>
        <SquareDashedMousePointer size={16} strokeWidth={2.25} aria-hidden /><span>BOX</span>
      </button>
      <button className="ws__stripbtn ws__stripbtn--tall ws__strip-all" disabled={counts[kind] === 0} onClick={() => w().selectAll()} title={`Every one of the ${on.label.toLowerCase()}`} aria-label="Select everything" {...noCallout}>
        <Waypoints size={16} strokeWidth={2.25} aria-hidden /><span>ALL</span>
      </button>
      {tiles && (
        <>
          <div className="benchpaste__away" onPointerDown={() => setTiles(false)} />
          <div className="ws__tiles ws__tiles--three" role="menu" aria-label="What a tap takes">
            {KINDS.map((k) => (
              <button key={k.kind} role="menuitemradio" aria-checked={k.kind === kind} className={`ws__tile${k.kind === kind ? ' is-on' : ''}`} title={k.title} onClick={() => { w().setSelectKind(k.kind); setTiles(false) }}>
                <k.icon size={22} strokeWidth={1.75} aria-hidden /><span>{k.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/**
 * PAINT's options (workshop redesign, phase 3, decision 3): what a tap
 * paints, a POINT, a FACE, the PIECE it is part of, or ALL; and for a face,
 * BLEND (its corners, blending into the next face) or EDGE (a hard seam),
 * greyed for the others. The color is the dock's last slot; the dropper is
 * in the palette's header and in MORE.
 */
function PaintOptions(): JSX.Element {
  const mode = useWorkshop((s) => s.paintMode)
  const edge = useWorkshop((s) => s.paintEdge)
  const take = useWorkshop((s) => s.paintTake)
  useEscape('modal', take, () => useWorkshop.getState().setPaintTake(false))
  const w = useWorkshop.getState
  const MODES: Array<{ mode: PaintMode; label: string; title: string }> = [
    { mode: 'point', label: 'POINT', title: 'A tap paints the point' },
    { mode: 'face', label: 'FACE', title: 'A tap paints the face' },
    { mode: 'piece', label: 'PIECE', title: 'A tap paints everything joined to what it met' },
    { mode: 'all', label: 'ALL', title: 'A tap paints the whole object' },
  ]
  return (
    <>
      <div className="ws__seg" role="group" aria-label="What a tap paints">
        {MODES.map((m) => (
          <button key={m.mode} className={`ws__stripbtn${mode === m.mode ? ' is-on' : ''}`} aria-pressed={mode === m.mode} onClick={() => w().setPaintMode(m.mode)} title={m.title} {...noCallout}>{m.label}</button>
        ))}
      </div>
      <div className="ws__seg" role="group" aria-label="How a face takes it">
        <button className={`ws__stripbtn${!edge ? ' is-on' : ''}`} disabled={mode !== 'face'} aria-pressed={!edge} onClick={() => w().setPaintEdge(false)} title="The face's corners take the color, blending into the faces beside it" {...noCallout}>BLEND</button>
        <button className={`ws__stripbtn${edge ? ' is-on' : ''}`} disabled={mode !== 'face'} aria-pressed={edge} onClick={() => w().setPaintEdge(true)} title="The face takes the color flat, with a hard edge" {...noCallout}>EDGE</button>
      </div>
      {/* The dropper, armed from the palette's header or MORE: the next tap takes a color. A tap here, or Esc, puts it away. */}
      {take && <div className="ws__hint ws__hint--take" role="status" onClick={() => w().setPaintTake(false)}>Tap a point or a face to take its color.</div>}
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
  // Not in LOOK, which shows the shard as the world does: what is held stays held, out of sight until an editing tool (workshop/benchLook.tsx).
  if (holding && !isLook(tool)) {
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
        {tool === 'view' && <LookOptions />}
        {tool === 'stamp' && <StampOptions onPickObject={onPickObject} tiles={tiles} setTiles={setTiles} />}
        {tool === 'select' && <SelectOptions tiles={tiles} setTiles={setTiles} />}
        {tool === 'paint' && <PaintOptions />}
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
