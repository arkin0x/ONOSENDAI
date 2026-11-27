/**
 * AirStepper.tsx - how far the ghost block stands along your look, beside
 * PLACE (lib/terrain/airPlace.ts, store/useAirPlace.ts): a compact − and +
 * round the distance in blocks, for touch, where there is no wheel. It shows
 * only while the ghost does (your look meets no block in reach, a block in
 * hand); its slot is always kept, so nothing round it moves (owner's taste:
 * no layout jumps).
 *
 * On a desktop the wheel sets the distance while the ghost shows
 * (TerrainView.tsx terrainWheel); the stepper shows there too, with the
 * wheel's hint, so the distance is always in sight while it matters.
 */

import { Minus, Mouse, Plus } from 'lucide-react'
import { useAirPlace } from '../store/useAirPlace'
import { AIR_MAX, AIR_MIN } from '../lib/terrain/airPlace'
import { noCallout } from '../hooks/useRepeatable'

export function AirStepper(): JSX.Element {
  const ghost = useAirPlace((s) => s.ghost)
  const distance = useAirPlace((s) => s.distance)
  const shown = ghost !== 'off'
  // A press on the stepper is the stepper's alone: nothing under it (the scene, the pad) hears it.
  const press = (by: number) => (e: React.PointerEvent<HTMLButtonElement>): void => {
    e.preventDefault(); e.stopPropagation()
    useAirPlace.getState().nudge(by)
  }
  return (
    <span className={`terrain-tools__slot terrain-tools__slot--air${shown ? '' : ' is-off'}`} aria-hidden={!shown || undefined}>
      <span className={`terrain-air${ghost === 'bad' ? ' is-bad' : ''}`} role="group" aria-label={`Ghost block distance: ${distance} blocks`} title="How far the ghost block stands: scroll the wheel, or tap − and +">
        <button className="terrain-air__btn" {...noCallout} disabled={!shown || distance <= AIR_MIN} tabIndex={shown ? 0 : -1} onPointerDown={press(-1)} aria-label="Nearer"><Minus size={13} strokeWidth={2.5} aria-hidden /></button>
        <span className="terrain-air__value" aria-live="polite">
          <span className="terrain-air__num">{distance}</span>
          <Mouse className="terrain-air__wheel" size={10} strokeWidth={2.25} aria-hidden />
        </span>
        <button className="terrain-air__btn" {...noCallout} disabled={!shown || distance >= AIR_MAX} tabIndex={shown ? 0 : -1} onPointerDown={press(1)} aria-label="Farther"><Plus size={13} strokeWidth={2.5} aria-hidden /></button>
      </span>
    </span>
  )
}
