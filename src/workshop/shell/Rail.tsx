/**
 * Rail.tsx - the left rail, one of the workshop's five fixed places
 * (workshop redesign, phase 1): UNDO and REDO, then the grid floor's LEVEL up,
 * its value, and down. The same corner they had, so old habits still work,
 * and never hidden: no sheet, panel or tool takes them away (they used to go
 * whenever a panel opened).
 */

import { ChevronDown, ChevronUp, Redo2, Undo2 } from 'lucide-react'
import { TICKS_PER_UNIT, unitsLabel } from 'sno-core/shards'
import { useRepeatable } from '../../hooks/useRepeatable'
import { useWorkshop } from '../../store/useWorkshop'

/** The plane's name under the level: the floor is the floor, a wall is named by its axis. */
const PLANE_LABEL = ['LEVEL X', 'FLOOR', 'LEVEL Z'] as const

/**
 * The grid floor's LEVEL (arkinox, 2026-10-10): one step of the current
 * division per press, held to repeat, the same step as the ] and [ keys, so
 * stacking things never means opening a panel between layers. One copy now:
 * GRID's second one went, since this one never hides.
 */
function LevelStack(): JSX.Element {
  const level = useWorkshop((s) => s.level)
  const plane = useWorkshop((s) => s.plane)
  const extentTicks = useWorkshop((s) => (s.current()?.extent ?? 0) * TICKS_PER_UNIT)
  const bind = useRepeatable()
  const w = useWorkshop.getState
  return (
    <div className="ws__level" role="group" aria-label="Grid level">
      <button className="ws__railbtn" {...bind(() => w().setLevel(w().level + w().step()))} disabled={level >= extentTicks} title="Raise the grid floor one step (])" aria-label="Raise the grid floor">
        <ChevronUp size={18} strokeWidth={2.25} aria-hidden />
      </button>
      <span className="ws__level-value" title={`LEVEL ${'XYZ'[plane]}: the height the placing tools work at`}>
        <b>{unitsLabel(level)}</b>
        <span>{PLANE_LABEL[plane]}</span>
      </span>
      <button className="ws__railbtn" {...bind(() => w().setLevel(w().level - w().step()))} disabled={level <= -extentTicks} title="Lower the grid floor one step ([)" aria-label="Lower the grid floor">
        <ChevronDown size={18} strokeWidth={2.25} aria-hidden />
      </button>
    </div>
  )
}

export function Rail(): JSX.Element {
  const canUndo = useWorkshop((s) => s.past.length > 0)
  const canRedo = useWorkshop((s) => s.future.length > 0)
  const w = useWorkshop.getState
  return (
    <nav className="ws__rail" aria-label="History and level">
      <button className="ws__railbtn" disabled={!canUndo} onClick={() => w().undo()} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={18} strokeWidth={2.25} aria-hidden /></button>
      <button className="ws__railbtn" disabled={!canRedo} onClick={() => w().redo()} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={18} strokeWidth={2.25} aria-hidden /></button>
      <LevelStack />
    </nav>
  )
}
