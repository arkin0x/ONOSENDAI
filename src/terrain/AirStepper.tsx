/**
 * AirStepper.tsx - how far the ghost block stands along your look, under
 * PLACE (lib/terrain/airPlace.ts, store/useAirPlace.ts): a compact − and +
 * round the distance in blocks, for touch, where there is no wheel. It shows
 * only while the ghost does, or would (your look meets no block in reach, a
 * block in hand); its slot is always kept, so nothing round it moves
 * (owner's taste: no layout jumps).
 *
 * The number in the middle turns air placing off and on (owner, 2026-11-27:
 * "Tapping the middle of the place distance button should toggle it off so
 * you can't see the place cube. Tap again to toggle it on."; store/airSwitch.ts,
 * kept per identity). Off, the middle shows an eye struck through over the
 * number struck through, the frame dims, and − and + are dimmed and do
 * nothing (the wheel leaves the distance alone too): the middle is the one
 * way back. It is a button like any other: a click with the mouse, a tap, or
 * Enter and Space on a keyboard (no letter key: H is HOP's).
 *
 * On a desktop the wheel sets the distance while the ghost shows
 * (TerrainView.tsx terrainWheel); the wheel's hint stands under it, never in
 * the number's cell, where a mouse read as a zero (review of #949), so the
 * distance is always in sight while it matters.
 */

import { EyeOff, Minus, Mouse, Plus } from 'lucide-react'
import { useAirPlace } from '../store/useAirPlace'
import { airPlacing, toggleAirPlacing, useAirPlacing } from '../store/airSwitch'
import { AIR_MAX, AIR_MIN } from '../lib/terrain/airPlace'
import { noCallout } from '../hooks/useRepeatable'

export function AirStepper(): JSX.Element {
  const ghost = useAirPlace((s) => s.ghost)
  const distance = useAirPlace((s) => s.distance)
  const on = useAirPlacing()
  const shown = ghost !== 'off'
  const live = shown && on
  // A press on the stepper is the stepper's alone: nothing under it (the scene, the pad) hears it.
  const press = (act: () => void) => (e: React.PointerEvent<HTMLButtonElement>): void => {
    e.preventDefault(); e.stopPropagation()
    act()
  }
  // − and + only while the ghost shows: switched off, they do nothing, whatever reaches them.
  const nudge = (by: number) => press(() => { if (airPlacing() && useAirPlace.getState().ghost !== 'off') useAirPlace.getState().nudge(by) })
  return (
    <span className={`terrain-tools__slot terrain-tools__slot--air${shown ? '' : ' is-off'}`} aria-hidden={!shown || undefined}>
      <span
        className={`terrain-air${ghost === 'bad' && on ? ' is-bad' : ''}${on ? '' : ' is-paused'}`}
        role="group"
        aria-label={on ? `Ghost block distance: ${distance} blocks` : 'Air placing is off'}
        title={on ? 'How far the ghost block stands: scroll the wheel, or tap − and +. Tap the number to turn air placing off' : 'Air placing is off: tap the number to turn it on'}
      >
        <button className="terrain-air__btn" {...noCallout} disabled={!live || distance <= AIR_MIN} tabIndex={live ? 0 : -1} onPointerDown={nudge(-1)} aria-label="Nearer"><Minus size={13} strokeWidth={2.5} aria-hidden /></button>
        <button
          className="terrain-air__value"
          {...noCallout}
          disabled={!shown}
          tabIndex={shown ? 0 : -1}
          onPointerDown={press(() => { toggleAirPlacing() })}
          // Enter and Space: a click the keyboard made (no pointer, detail 0). A pointer's own click after its press is
          // ignored, so a tap never turns it twice.
          onClick={(e) => { e.stopPropagation(); if (e.detail === 0) toggleAirPlacing() }}
          aria-pressed={on}
          aria-label={on ? `Air placing on, ${distance} blocks: turn it off` : 'Air placing off: turn it on'}
        >
          {on ? distance : <><EyeOff size={11} strokeWidth={2.25} aria-hidden data-icon="eye-off" /><s className="terrain-air__struck">{distance}</s></>}
        </button>
        <button className="terrain-air__btn" {...noCallout} disabled={!live || distance >= AIR_MAX} tabIndex={live ? 0 : -1} onPointerDown={nudge(1)} aria-label="Farther"><Plus size={13} strokeWidth={2.5} aria-hidden /></button>
      </span>
      {/* The wheel's hint, where there is a wheel (styles.css), outside the frame with a clear gap; none while off. */}
      <span className="terrain-air__hint" aria-hidden>{on && <><Mouse size={11} strokeWidth={2} />WHEEL</>}</span>
    </span>
  )
}
