/**
 * GridSheet.tsx - GRID, a top-level area with its own sheet (workshop
 * redesign, phase 1): the deploy scale multiplier, the snap (DIVISION) and
 * the grid's own size. Moved from the old panel unchanged, but for its copy
 * of the LEVEL stack: the rail's one never hides now, so one is enough.
 * GRID SIZE runs to 4,096 (DECK-0003 §1.8, 2026-11-23): ones up to 64, then
 * sixteenths of each doubling (gridSize.ts), and a held key is one undo step.
 */

import { DIVISIONS, MAX_EXTENT, MAX_UNIT, MIN_EXTENT, neededExtent } from 'sno-core/shards'
import { formatCellSize } from 'sno-core/scale'
import { useRepeatable } from '../../hooks/useRepeatable'
import { useWorkshop } from '../../store/useWorkshop'
import { stepDivision } from '../divisions'
import { stepExtent } from '../gridSize'

export function GridBody(): JSX.Element | null {
  const shard = useWorkshop((s) => s.current())
  const division = useWorkshop((s) => s.division)
  const bind = useRepeatable()
  const w = useWorkshop.getState
  if (!shard) return null
  const extent = shard.extent ?? MIN_EXTENT
  const minExtent = Math.max(MIN_EXTENT, neededExtent(shard))
  return (
    <>
      <div className="workshop__row">
        <span className="workshop__label">DEPLOY SCALE MULTIPLIER</span>
        <span className="workshop__value">2^</span>
        <button className="workshop__btn" {...bind(() => w().setUnit((w().current()?.unit ?? 0) - 1))} disabled={shard.unit <= 0} aria-label="Smaller unit">−</button>
        <span className="workshop__value">{shard.unit}</span>
        <button className="workshop__btn" {...bind(() => w().setUnit((w().current()?.unit ?? 0) + 1))} disabled={shard.unit >= MAX_UNIT} aria-label="Larger unit">+</button>
        <span className="workshop__unit-size" title="What one grid unit is in the world. DEPLOY shows the object at this size.">one unit = {formatCellSize(shard.unit)}</span>
      </div>
      {/* A stepper like the rows around it (arkinox, 2026-10-15): fifteen
          divisions down to a single tick no longer fit as a row of buttons. */}
      <div className="workshop__row" role="group" aria-label="Grid division">
        <span className="workshop__label">DIVISION</span>
        <button className="workshop__btn" onClick={() => w().setDivision(stepDivision(division, -1))} disabled={division === DIVISIONS[0]} aria-label="Coarser division" title="Coarser snap">−</button>
        <span className="workshop__value" title={division === 1 ? 'Snap to whole units' : `Snap to 1/${division} of a unit`}>{division === 1 ? '1' : `1/${division}`}</span>
        <button className="workshop__btn" onClick={() => w().setDivision(stepDivision(division, 1))} disabled={division === DIVISIONS[DIVISIONS.length - 1]} aria-label="Finer division" title="Finer snap">+</button>
        <span className="workshop__unit-size" title="Where taps, the box, nudges and the level land. Positions already placed keep their exact spots.">the snap for placing and nudging</span>
      </div>
      <div className="workshop__row">
        <span className="workshop__label">GRID SIZE</span>
        <button className="workshop__btn" {...bind(() => w().setExtent(stepExtent(w().current()?.extent ?? MIN_EXTENT, -1)))} disabled={extent <= minExtent} aria-label="Smaller grid">−</button>
        <span className="workshop__value">{extent}</span>
        <button className="workshop__btn" {...bind(() => w().setExtent(stepExtent(w().current()?.extent ?? MIN_EXTENT, 1)))} disabled={extent >= MAX_EXTENT} aria-label="Larger grid">+</button>
        <span className="workshop__unit-size" title="Saved with the shard. Never below what its points need.">gibsons each side of each axis</span>
      </div>
    </>
  )
}
