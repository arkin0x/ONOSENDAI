/**
 * shardRows.tsx - the SHARD sheet's rows that carry their own state: BOUNCE,
 * OPACITY, and the bouncy shard's chip that MENU's list wears too. Moved out
 * of Workshop.tsx unchanged when the workshop was split by place (workshop
 * redesign, phase 1).
 */

import { useEffect, useRef, useState } from 'react'
import { Hash } from 'lucide-react'
import { OPACITY_FLOOR, type ShardModel } from 'sno-core/shards'
import { Field, Switch } from '../hud/ui/Switch'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { clampOpacity, dragHistory, opacityAt, opacityFraction, opacityPercent, stepOpacity } from '../lib/opacityStep'
import { BOUNCE_MAX, BOUNCE_MIN, BOUNCE_PRESETS, BOUNCE_REFLECT, BOUNCE_START, bounceChip, bounceChipTip, bounceOf, clampBounce, springboardOf } from '../lib/walkBounce'
import { useWorkshop } from '../store/useWorkshop'

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
 * number entry like the hyperspace chip"): the hyperspace scrubber's rail,
 * from the floor to 100 in whole percent, with − and + in fives either side
 * as before, and # beside it to type a percent, as the block line has. 100
 * is solid and writes nothing (lib/opacityStep).
 *
 * A drag is one edit: every whole percent it passes draws at once, and when
 * the finger lifts the history keeps only the shard as it was before the
 * drag, so one UNDO puts the whole drag back, as one press of − does.
 */
export function OpacityRow(): JSX.Element {
  const percent = useWorkshop((s) => opacityPercent(s.current()?.opacity))
  const bind = useRepeatable()
  const w = useWorkshop.getState
  const rail = useRef<HTMLDivElement>(null)
  // The history and the shard as they were when the drag began.
  const drag = useRef<{ id: string; past: ShardModel[]; before: ShardModel } | null>(null)
  // The typed percent, open while # is pressed.
  const [typing, setTyping] = useState<string | null>(null)
  const setTo = (p: number | null): void => {
    if (p === null || p === opacityPercent(w().current()?.opacity)) return
    w().setOpacity(p)
  }
  const slideTo = (clientX: number): void => {
    const r = rail.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    setTo(opacityAt((clientX - r.left) / r.width))
  }
  const endDrag = (): void => {
    const d = drag.current
    drag.current = null
    const st = w()
    const now = st.current()
    if (!d || !now || st.currentId !== d.id || now === d.before) return
    useWorkshop.setState({ past: dragHistory(d.past, d.before, st.past) })
  }
  // A drag the panel closed under (Esc) still ends as one edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => endDrag, [])
  const typed = typing !== null && /^\d+$/.test(typing) ? clampOpacity(Number(typing)) : null
  const goTyped = (): void => {
    if (typed === null) return
    setTo(typed)
    setTyping(null)
  }
  const keyStep: Record<string, number | 'floor' | 'top'> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10, Home: 'floor', End: 'top' }
  const fraction = opacityFraction(percent)
  return (
    <>
      <div className="workshop__row" role="group" aria-label="Opacity">
        <span className="workshop__label">OPACITY</span>
        <button className="workshop__btn" {...bind(() => w().setOpacity(stepOpacity(w().current()?.opacity, -1)))} disabled={percent <= OPACITY_FLOOR} aria-label="More see-through" title="More see-through">−</button>
        <div
          className="explorer__rail ws__opacity-rail"
          ref={rail}
          role="slider"
          tabIndex={0}
          aria-label="Opacity"
          aria-valuemin={OPACITY_FLOOR}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${percent}%`}
          {...noCallout}
          onPointerDown={(e) => {
            e.preventDefault(); e.stopPropagation()
            const st = w()
            const s = st.current()
            if (!s) return
            drag.current = { id: s.id, past: st.past, before: s }
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            ;(e.currentTarget as HTMLElement).focus()
            slideTo(e.clientX)
          }}
          onPointerMove={(e) => { if (drag.current) slideTo(e.clientX) }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={(e) => {
            const k = keyStep[e.key]
            if (k === undefined || e.metaKey || e.ctrlKey || e.altKey) return
            // The bench nudges the selection with the arrows: these are the slider's.
            e.preventDefault(); e.stopPropagation()
            setTo(k === 'floor' ? OPACITY_FLOOR : k === 'top' ? 100 : clampOpacity(percent + k))
          }}
        >
          <span className="explorer__line" />
          <span className="explorer__walked" style={{ width: `${fraction * 100}%` }} />
          <span className="explorer__mark" style={{ left: `${fraction * 100}%` }} />
        </div>
        <button className="workshop__btn" {...bind(() => w().setOpacity(stepOpacity(w().current()?.opacity, 1)))} disabled={percent >= 100} aria-label="More solid" title="More solid">+</button>
        {/* A fixed width: a number that narrowed from 100% to 99% moved the rail under the finger mid-drag (arkinox, 2026-10-25). */}
        <span className="workshop__value ws__opacity-value">{percent}%</span>
        <button
          className={`workshop__btn linescrub__hash ${typing !== null ? 'is-on' : ''}`}
          title="Type a percent"
          aria-label="Type an opacity percent"
          aria-expanded={typing !== null}
          onClick={() => setTyping((t) => (t === null ? '' : null))}
        ><Hash size={12} strokeWidth={2.5} aria-hidden /></button>
      </div>
      {typing !== null && (
        <form className="linescrub__goto" onSubmit={(e) => { e.preventDefault(); goTyped() }}>
          <input
            className="linescrub__goto-input"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            autoFocus
            placeholder={`${OPACITY_FLOOR} to 100`}
            aria-label="Opacity percent"
            value={typing}
            onChange={(e) => setTyping(e.target.value.replace(/[^\d]/g, ''))}
            // Escape puts the field away and nothing else; preventDefault keeps the panel open (useKeyboard).
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setTyping(null) } }}
          />
          <button className="workshop__btn" type="submit" disabled={typed === null}>SET</button>
        </form>
      )}
    </>
  )
}

/** A bouncy shard's chip (lib/walkBounce.ts bounceChip): BOUNCE 12, SPRING 12 or REFLECT, and nothing for a shard that does not bounce. */
export function BounceChip({ shard }: { shard: Pick<ShardModel, 'extra'> }): JSX.Element | null {
  const label = bounceChip(shard)
  if (!label) return null
  return <span className="workshop__tag ws__bounce-chip" title={bounceChipTip(shard)}>{label}</span>
}
