/**
 * shardRows.tsx - the SHARD sheet's rows that carry their own state: BOUNCE,
 * OPACITY, and the bouncy shard's chip that MENU's list wears too. Moved out
 * of Workshop.tsx when the workshop was split by place (workshop redesign,
 * phase 1). OPACITY's rail is the shared RailRow (railRow.tsx) that POINT
 * SIZE, RADIUS and GLOW STRENGTH use too (glowRows.tsx).
 */

import type { ShardModel } from 'sno-core/shards'
import { Field, Switch } from '../hud/ui/Switch'
import { useRepeatable } from '../hooks/useRepeatable'
import { OPACITY_MIN, clampOpacity, opacityAt, opacityFraction, opacityPercent, stepOpacity } from '../lib/opacityStep'
import { BOUNCE_MAX, BOUNCE_MIN, BOUNCE_PRESETS, BOUNCE_REFLECT, BOUNCE_START, bounceChip, bounceChipTip, bounceOf, clampBounce, springboardOf } from '../lib/walkBounce'
import { useWorkshop } from '../store/useWorkshop'
import { RailRow } from './railRow'

/**
 * BOUNCE (lib/walkBounce.ts; arkinox, 2026-11-10: "can i make bounce surfaces
 * in the workshop now then?"): OFF, a fixed HEIGHT, or REFLECT, three buttons
 * like CONSTRAIN's. With a HEIGHT, a stepper (hold to repeat) and one-tap
 * presets, and SPRINGBOARD, which launches on walk-on too; REFLECT has no
 * SPRINGBOARD, since walking on you fell from nowhere. Every press goes
 * through setBounce, which writes only what a walker reads, so no value this
 * row can make is invalid, and OFF removes both fields.
 */
export function BounceRow(): JSX.Element {
  const bounce = useWorkshop((s) => { const c = s.current(); return c ? bounceOf(c) : 0 })
  const spring = useWorkshop((s) => { const c = s.current(); return c ? springboardOf(c) : false })
  const bind = useRepeatable()
  const w = useWorkshop.getState
  const fixed = typeof bounce === 'number' && bounce > 0 ? bounce : null
  // Read again at the press, so a held stepper climbs from where it is now.
  const step = (by: number): void => {
    const c = w().current()
    const b = c ? bounceOf(c) : 0
    if (!c || typeof b !== 'number' || b === 0) return
    w().setBounce(clampBounce(b + by), springboardOf(c))
  }
  return (
    <>
      <div className="workshop__row">
        <span className="workshop__label">BOUNCE</span>
        <div className="workshop__modes" role="group" aria-label="Bounce">
          <button className={`workshop__mode ${bounce === 0 ? 'is-on' : ''}`} aria-pressed={bounce === 0} title="No bounce" onClick={() => w().setBounce(0)}>OFF</button>
          <button className={`workshop__mode ${fixed !== null ? 'is-on' : ''}`} aria-pressed={fixed !== null} title="Launch walkers a set height" onClick={() => { if (fixed === null) w().setBounce(BOUNCE_START) }}>HEIGHT</button>
          <button className={`workshop__mode ${bounce === BOUNCE_REFLECT ? 'is-on' : ''}`} aria-pressed={bounce === BOUNCE_REFLECT} title={`Bounce back to the height fallen from, up to ${BOUNCE_MAX}`} onClick={() => w().setBounce(BOUNCE_REFLECT)}>REFLECT</button>
        </div>
      </div>
      {fixed !== null && (
        <>
          <div className="workshop__row" role="group" aria-label="Bounce height">
            <span className="workshop__label">GIBSONS</span>
            <button className="workshop__btn" {...bind(() => step(-1))} disabled={fixed <= BOUNCE_MIN} aria-label="Lower bounce" title="Lower">−</button>
            <span className="workshop__value">{fixed}</span>
            <button className="workshop__btn" {...bind(() => step(1))} disabled={fixed >= BOUNCE_MAX} aria-label="Higher bounce" title="Higher">+</button>
            <div className="workshop__modes" role="group" aria-label="Bounce presets">
              {BOUNCE_PRESETS.map((n) => (
                <button key={n} className={`workshop__mode ${fixed === n ? 'is-on' : ''}`} aria-pressed={fixed === n} title={`Launch ${n} gibsons`} onClick={() => w().setBounce(n, spring)}>{n}</button>
              ))}
            </div>
          </div>
          <div className="workshop__row">
            <Field id="ws-springboard" label="springboard" hint="launch on walk-on">
              <Switch id="ws-springboard" className="ui-switch--ok" checked={spring} onCheckedChange={(v) => { const c = w().current(); const b = c ? bounceOf(c) : 0; if (typeof b === 'number' && b > 0) w().setBounce(b, v) }} />
            </Field>
          </div>
        </>
      )}
      {bounce !== 0 && <div className="ws__explain">Walkers with gravity on bounce off its top.</div>}
    </>
  )
}

/**
 * OPACITY in SHARD (arkinox, 2026-10-23: "turn this into a slider with
 * number entry like the hyperspace chip"): the shared rail (railRow.tsx),
 * from 0 to 100 in whole percent, with − and + in fives either side, and #
 * beside it to type a percent, as the block line has. 100 is solid and
 * writes nothing (lib/opacityStep). There is no floor (owner, 2026-11-15):
 * at 0% the object draws nothing of its own, and its glow still shows.
 */
export function OpacityRow(): JSX.Element {
  const percent = useWorkshop((s) => opacityPercent(s.current()?.opacity))
  const w = useWorkshop.getState
  return (
    <RailRow
      label="OPACITY"
      name="Opacity"
      value={percent}
      read={() => opacityPercent(w().current()?.opacity)}
      write={(p) => w().setOpacity(p)}
      at={opacityAt}
      fraction={opacityFraction}
      step={stepOpacity}
      nudge={(v, by) => clampOpacity(v + by) ?? v}
      min={OPACITY_MIN}
      max={100}
      valueText={`${percent}%`}
      shown={`${percent}%`}
      less="More see-through"
      more="More solid"
      typing={{ hashTitle: 'Type a percent', hashLabel: 'Type an opacity percent', fieldLabel: 'Opacity percent', placeholder: `${OPACITY_MIN} to 100`, maxLength: 3, parse: (t) => (/^\d+$/.test(t) ? clampOpacity(Number(t)) : null) }}
    />
  )
}

/** A bouncy shard's chip (lib/walkBounce.ts bounceChip): BOUNCE 12, SPRING 12 or REFLECT, and nothing for a shard that does not bounce. */
export function BounceChip({ shard }: { shard: Pick<ShardModel, 'extra'> }): JSX.Element | null {
  const label = bounceChip(shard)
  if (!label) return null
  return <span className="workshop__tag ws__bounce-chip" title={bounceChipTip(shard)}>{label}</span>
}
