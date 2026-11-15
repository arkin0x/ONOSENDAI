/**
 * glowRows.tsx - POINT SIZE, GLOW, RADIUS and GLOW STRENGTH in the SHARD
 * sheet, under DRAW and OPACITY (DECK-0003 §1.15 and §1.16; owner rulings
 * 2026-11-15).
 *
 * One point size and one glow for the whole object, drawn only in POINTS.
 * In SOLID and LINES all four rows stay where they are with their values,
 * greyed, and the gray line under them says why; RADIUS and GLOW STRENGTH
 * are greyed while GLOW is OFF. Nothing appears or disappears and nothing
 * below moves. There is no color picker: each point's glow is that point's
 * own color, so painting the points colors the glow.
 *
 * Distances are ticks of the object's own grid (120 to a unit), shown in
 * gibsons at its scale and written as whole ticks. GLOW STRENGTH is its own
 * number: the object's OPACITY never multiplies it.
 */

import { useMemo } from 'react'
import { CloudFog, Sun } from 'lucide-react'
import { GLOW_REACH, readGlow, readPointSize, type Glow, type GlowStyle } from 'sno-core/glow'
import {
  POINT_AUTO, RADIUS_MIN, STRENGTH_MAX, STRENGTH_MIN, gibsonsText, pointSizeAt, pointSizeFraction, radiusAt, radiusFraction,
  stepPointSize, stepRadius, stepStrength, strengthAt, strengthFraction, suggestedGlowStyle, typedStrength, typedTicks,
} from '../lib/pointGlow'
import { useWorkshop } from '../store/useWorkshop'
import { RailRow } from './railRow'

/** The gray line under the four rows. */
export const GLOW_NOTE = 'POINTS only. Paint the points to color the glow.'

/** A distance in gibsons for the value cell: the figure, and the word under it. */
function Gibsons({ ticks, unit }: { ticks: number; unit: number }): JSX.Element {
  const { figure, word } = gibsonsText(ticks, unit)
  return <span className="ws__gibsons"><span>{figure}</span><span className="ws__gibsons-word">{word}</span></span>
}

/** The current shard's unit, its point size (POINT_AUTO for none) and its glow. */
const useUnit = (): number => useWorkshop((s) => s.current()?.unit ?? 0)
const pointSizeNow = (): number => readPointSize(useWorkshop.getState().current()?.extra?.pointsize) ?? POINT_AUTO
const glowNow = (): Glow | undefined => readGlow(useWorkshop.getState().current()?.extra?.glow)

/**
 * POINT SIZE: AUTO at the rail's left end (no `pointsize`: each app draws
 * its own size, which is how points drew before), then 0 (no dots) to 2
 * units across the rail. − and + go on past the rail to the 64-unit cap, and
 * # types gibsons up to it.
 */
export function PointSizeRow({ disabled }: { disabled: boolean }): JSX.Element {
  const unit = useUnit()
  const ticks = useWorkshop((s) => readPointSize(s.current()?.extra?.pointsize) ?? POINT_AUTO)
  const w = useWorkshop.getState
  const auto = ticks === POINT_AUTO
  const { figure, word } = gibsonsText(Math.max(0, ticks), unit)
  return (
    <RailRow
      label="POINT SIZE"
      name="Point size"
      hint="How wide each point draws. AUTO leaves it to each app."
      value={ticks}
      read={pointSizeNow}
      write={(v) => w().setPointSize(v === POINT_AUTO ? undefined : v)}
      at={pointSizeAt}
      fraction={pointSizeFraction}
      step={stepPointSize}
      min={POINT_AUTO}
      max={GLOW_REACH}
      valueText={auto ? 'AUTO' : `${figure} ${word.toLowerCase()}`}
      shown={auto ? 'AUTO' : <Gibsons ticks={ticks} unit={unit} />}
      less="Smaller points"
      more="Bigger points"
      disabled={disabled}
      typing={{ hashTitle: 'Type gibsons', hashLabel: 'Type a point size in gibsons', fieldLabel: 'Point size in gibsons', placeholder: `0 to ${gibsonsText(GLOW_REACH, unit).figure} gibsons`, maxLength: 12, decimal: true, parse: (t) => typedTicks(t, unit, 0) }}
    />
  )
}

/**
 * GLOW: OFF, LIGHT or FOG, like CONSTRAIN's buttons. LIGHT adds the points'
 * colors to what is behind them; FOG lays them over it. While OFF, the style
 * that suits the points' colors (their mean, or the color in hand when there
 * are none: lib/pointGlow suggestedGlowStyle) wears a thin outline, the
 * pre-pick; a tap on either chooses it. Turning it on starts from the radius
 * and strength last used this session (store glowLast), and OFF removes the
 * field.
 */
export function GlowRow({ disabled }: { disabled: boolean }): JSX.Element {
  const style = useWorkshop((s) => readGlow(s.current()?.extra?.glow)?.style ?? null)
  const vertices = useWorkshop((s) => s.current()?.vertices)
  const color = useWorkshop((s) => s.color)
  const suggested = useMemo<GlowStyle>(() => suggestedGlowStyle({ vertices: vertices ?? [] }, color), [vertices, color])
  const w = useWorkshop.getState
  const button = (s: GlowStyle, label: string, icon: JSX.Element, title: string): JSX.Element => (
    <button
      className={`workshop__mode ws__glowbtn ${style === s ? 'is-on' : ''} ${style === null && suggested === s ? 'is-suggested' : ''}`}
      aria-pressed={style === s}
      title={style === null && suggested === s ? `${title}. Suits these colors.` : title}
      disabled={disabled}
      onClick={() => w().setGlow({ style: s })}
    >{icon}{label}</button>
  )
  return (
    <div className={`workshop__row ws__railrow ${disabled ? 'is-off' : ''}`}>
      <span className="workshop__label ws__raillabel">GLOW</span>
      <div className="workshop__modes ws__glowmodes" role="group" aria-label="Glow">
        <button className={`workshop__mode ws__glowbtn ${style === null ? 'is-on' : ''}`} aria-pressed={style === null} title="No glow" disabled={disabled} onClick={() => w().setGlow(null)}>OFF</button>
        {button('light', 'LIGHT', <Sun size={12} aria-hidden />, 'Light: adds the points\' colors, like sunlight')}
        {button('fog', 'FOG', <CloudFog size={12} aria-hidden />, 'Fog: lays the points\' colors over what is behind, like mist')}
      </div>
    </div>
  )
}

/** RADIUS: how far the glow reaches from each point, 1 tick to 8 units across the rail, # and + to the cap. */
export function RadiusRow({ disabled }: { disabled: boolean }): JSX.Element {
  const unit = useUnit()
  const radius = useWorkshop((s) => readGlow(s.current()?.extra?.glow)?.radius ?? s.glowLast.radius)
  const w = useWorkshop.getState
  const { figure, word } = gibsonsText(radius, unit)
  return (
    <RailRow
      label="RADIUS"
      name="Glow radius"
      hint="How far the glow reaches from each point"
      value={radius}
      read={() => glowNow()?.radius ?? w().glowLast.radius}
      write={(v) => w().setGlow({ radius: v })}
      at={radiusAt}
      fraction={radiusFraction}
      step={stepRadius}
      min={RADIUS_MIN}
      max={GLOW_REACH}
      valueText={`${figure} ${word.toLowerCase()}`}
      shown={<Gibsons ticks={radius} unit={unit} />}
      less="Shorter glow"
      more="Longer glow"
      disabled={disabled}
      typing={{ hashTitle: 'Type gibsons', hashLabel: 'Type a glow radius in gibsons', fieldLabel: 'Glow radius in gibsons', placeholder: `up to ${gibsonsText(GLOW_REACH, unit).figure} gibsons`, maxLength: 12, decimal: true, parse: (t) => typedTicks(t, unit, RADIUS_MIN) }}
    />
  )
}

/** GLOW STRENGTH: how strong the glow is at each point, 1 to 100 percent, fading to nothing at the radius. */
export function GlowStrengthRow({ disabled }: { disabled: boolean }): JSX.Element {
  const strength = useWorkshop((s) => readGlow(s.current()?.extra?.glow)?.strength ?? s.glowLast.strength)
  const w = useWorkshop.getState
  return (
    <RailRow
      label="GLOW STRENGTH"
      name="Glow strength"
      hint="How strong the glow is at each point. OPACITY does not change it."
      value={strength}
      read={() => glowNow()?.strength ?? w().glowLast.strength}
      write={(v) => w().setGlow({ strength: v })}
      at={strengthAt}
      fraction={strengthFraction}
      step={stepStrength}
      nudge={(v, by) => Math.min(STRENGTH_MAX, Math.max(STRENGTH_MIN, v + by))}
      min={STRENGTH_MIN}
      max={STRENGTH_MAX}
      valueText={`${strength}%`}
      shown={`${strength}%`}
      less="Weaker glow"
      more="Stronger glow"
      disabled={disabled}
      typing={{ hashTitle: 'Type a percent', hashLabel: 'Type a glow strength percent', fieldLabel: 'Glow strength percent', placeholder: `${STRENGTH_MIN} to ${STRENGTH_MAX}`, maxLength: 3, parse: typedStrength }}
    />
  )
}

/** The four rows and the gray line under them, always all present. */
export function PointGlowRows(): JSX.Element {
  const points = useWorkshop((s) => s.current()?.mode === 'points')
  const glowOn = useWorkshop((s) => readGlow(s.current()?.extra?.glow) !== undefined)
  return (
    <>
      <PointSizeRow disabled={!points} />
      <GlowRow disabled={!points} />
      <RadiusRow disabled={!points || !glowOn} />
      <GlowStrengthRow disabled={!points || !glowOn} />
      <div className={`ws__explain ws__glownote ${points ? '' : 'is-why'}`}>{GLOW_NOTE}</div>
    </>
  )
}
