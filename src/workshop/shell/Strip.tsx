/**
 * Strip.tsx - the strip, over the dock, one of the workshop's five fixed
 * places (workshop redesign, phase 1): the one place for the tool's options.
 * On its left the tool in hand and a ? that says what a tap does with it; then
 * the tool's options, then what you can do to what you hold, scrolling
 * sideways if they run long. STAMP's shape, OBJECT, SIZE and FACING moved
 * here from the TOOLS panel unchanged, and the held rows from their column
 * over it (HeldRows). Phase 2 gives the tools their own options here and
 * makes the held rows a bar of fixed slots.
 */

import { useEffect, useState } from 'react'
import { Box, CircleHelp } from 'lucide-react'
import { FACED, FACING_LABEL, MAX_SIZE, MIN_SIZE, STAMPS, STAMP_HELP, type StampKind } from 'sno-core/stamps'
import { useEscape } from '../../hooks/useEscape'
import { useRepeatable } from '../../hooks/useRepeatable'
import { useWorkshop, type Tool } from '../../store/useWorkshop'
import { HeldActions } from '../HeldRows'
import { slotOf } from './Dock'

/** What a tap does with each tool, behind the strip's ?. */
export const TOOL_HELP: Record<Tool, string> = {
  view: 'Look around: one finger orbits, two pan, pinch zooms. Tap the view ball for views. Pick a tool to build.',
  stamp: 'Tap the grid to place the shape where the ghost shows. Q turns it.',
  add: 'Tap the grid to place a vertex at the current level.',
  select: 'Tap points, or drag boxes, to gather them. INVERT makes taps and boxes take points out; DESELECT lets go. Drag the view ball to turn the view.',
  face: 'Tap corners in order, then the first again or FILL. Tap a face to select it and move it with the pad. A dark face shows its back: FLIP turns it round, AUTO turns every face outward. One finger orbits.',
}

/** STAMP's options: the shape or a published OBJECT, SIZE, FACING. */
function StampOptions({ onPickObject }: { onPickObject: () => void }): JSX.Element {
  const stampMode = useWorkshop((s) => s.stampMode)
  const stampObject = useWorkshop((s) => s.stampObject)
  const stampKind = useWorkshop((s) => s.stampKind)
  const stampSize = useWorkshop((s) => s.stampSize)
  const stampFacing = useWorkshop((s) => s.stampFacing)
  const bind = useRepeatable()
  const w = useWorkshop.getState
  return (
    <>
      <div className="ws__strip-group" role="group" aria-label="Shape">
        {STAMPS.map((k: StampKind) => (
          <button key={k} className={`ws__stripbtn${stampMode === 'shape' && stampKind === k ? ' is-on' : ''}`} aria-pressed={stampMode === 'shape' && stampKind === k} onClick={() => w().setStampKind(k)} title={STAMP_HELP[k]}>{k.toUpperCase()}</button>
        ))}
        {/* A published object, placed by reference (DECK-0003 §1.10): it
            stays that object and follows its author's edits. */}
        <button className={`ws__stripbtn${stampMode === 'object' ? ' is-on' : ''}`} aria-pressed={stampMode === 'object'} onClick={() => { w().setStampMode('object'); if (!w().stampObject) onPickObject() }} title="Stamp a published object, placed by reference">
          <Box size={14} strokeWidth={2.25} aria-hidden />OBJECT
        </button>
      </div>
      {stampMode === 'object' && (
        <div className="ws__strip-group" role="group" aria-label="Object to stamp">
          <button className={`ws__slot${stampObject ? ' is-full' : ''}`} onClick={onPickObject} title={stampObject ? 'Choose another object' : 'Choose an object'}>
            {stampObject
              ? <><span className="ws__slot-name">{stampObject.name}</span><span className="ws__slot-meta">{stampObject.shard.vertices.length} v · {stampObject.shard.faces.length} f{stampObject.shard.parts?.length ? ` · ${stampObject.shard.parts.length} obj` : ''} · CHANGE</span></>
              : <span className="ws__slot-meta">EMPTY · tap to choose</span>}
          </button>
        </div>
      )}
      {stampMode === 'shape' && (
        <div className="ws__strip-group ws__stepper" role="group" aria-label="Size">
          <button className="ws__stripbtn ws__stripbtn--sq" {...bind(() => w().setStampSize(w().stampSize - 1))} disabled={stampSize <= MIN_SIZE} aria-label="Smaller">−</button>
          <span className="ws__stepper-value"><b>{stampSize}</b><span>SIZE</span></span>
          <button className="ws__stripbtn ws__stripbtn--sq" {...bind(() => w().setStampSize(w().stampSize + 1))} disabled={stampSize >= MAX_SIZE} aria-label="Larger">+</button>
        </div>
      )}
      {(stampMode === 'object' || FACED[stampKind]) && (
        <div className="ws__strip-group" role="group" aria-label="Facing">
          <button className="ws__stripbtn" onClick={() => w().turnStamp()} title="Turn a quarter (Q)">FACING {FACING_LABEL[stampFacing]} ↻</button>
        </div>
      )}
    </>
  )
}

export function Strip({ onPickObject }: { onPickObject: () => void }): JSX.Element {
  const tool = useWorkshop((s) => s.tool)
  const [help, setHelp] = useState(false)
  // A new tool, a new question: the answer to the last one goes.
  useEffect(() => { setHelp(false) }, [tool])
  useEscape('modal', help, () => setHelp(false))
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
        {tool === 'stamp' && <StampOptions onPickObject={onPickObject} />}
        <HeldActions />
      </div>
      {help && <div className="ws__hint" role="note" onClick={() => setHelp(false)}>{TOOL_HELP[tool]}</div>}
    </div>
  )
}
