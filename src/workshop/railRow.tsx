/**
 * railRow.tsx - one slider row of the SHARD sheet: − rail + value #, the
 * hyperspace scrubber's rail (arkinox, 2026-10-23: "turn this into a slider
 * with number entry like the hyperspace chip"). OPACITY, POINT SIZE, RADIUS
 * and GLOW STRENGTH are all this row with their own arithmetic.
 *
 * A drag is one edit: every value it passes draws at once, and when the
 * finger lifts the history keeps only the shard as it was before the drag,
 * so one UNDO puts the whole drag back, as one press of − does. − and +
 * repeat while held. The arrows, Page Up and Down, Home and End move the
 * rail while it has focus. # opens a field to type a value.
 *
 * Greyed rows stay in place with their values (owner taste: nothing appears
 * or disappears, nothing below moves); every control in them is disabled.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Hash } from 'lucide-react'
import type { ShardModel } from 'sno-core/shards'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { dragHistory } from '../lib/opacityStep'
import { useWorkshop } from '../store/useWorkshop'

export interface RailRowProps {
  /** The printed label. */
  label: string
  /** The group's and the slider's accessible name. */
  name: string
  /** The value now, as the row's selector reads it. */
  value: number
  /** The value now, read again at a press, so a held − climbs from where it is. */
  read: () => number
  /** Write a value: one edit. */
  write: (v: number) => void
  /** The value at `t` (0..1) along the rail. */
  at: (t: number) => number
  /** Where a value sits along the rail, 0..1. */
  fraction: (v: number) => number
  /** − and +. */
  step: (v: number, dir: -1 | 1) => number
  /** The arrows (1) and Page Up and Down (10) while the rail has focus; − and + by default. */
  nudge?: (v: number, by: -10 | -1 | 1 | 10) => number
  /** The ends: − stops at `min`, + at `max`, and Home and End go there. */
  min: number
  max: number
  /** The slider's least value as read aloud, when it is not `min` (POINT SIZE's AUTO sits under 0). */
  ariaMin?: number
  /** The value as read aloud, when it is not `value`; null for none (AUTO has no number). */
  ariaNow?: number | null
  /** The value read aloud. */
  valueText: string
  /** The value cell's content. */
  shown: ReactNode
  /** − and +'s names. */
  less: string
  more: string
  /** Greyed: every control disabled, the values kept. */
  disabled?: boolean
  /** The # field. */
  typing: { hashTitle: string; hashLabel: string; fieldLabel: string; placeholder: string; maxLength: number; decimal?: boolean; parse: (text: string) => number | null }
  /** A tooltip on the label. */
  hint?: string
}

const KEYS: Record<string, -10 | -1 | 1 | 10 | 'min' | 'max'> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10, Home: 'min', End: 'max' }

export function RailRow(p: RailRowProps): JSX.Element {
  const bind = useRepeatable()
  const w = useWorkshop.getState
  const rail = useRef<HTMLDivElement>(null)
  // The history and the shard as they were when the drag began.
  const drag = useRef<{ id: string; past: ShardModel[]; before: ShardModel } | null>(null)
  // The typed value, open while # is pressed.
  const [typing, setTyping] = useState<string | null>(null)
  const off = p.disabled === true
  const setTo = (v: number | null): void => {
    if (off || v === null || v === p.read()) return
    p.write(v)
  }
  const slideTo = (clientX: number): void => {
    const r = rail.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    setTo(p.at((clientX - r.left) / r.width))
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
  // A row greyed while its field was open puts the field away.
  useEffect(() => { if (off) setTyping(null) }, [off])
  const typed = typing !== null ? p.typing.parse(typing) : null
  const goTyped = (): void => {
    if (typed === null) return
    setTo(typed)
    setTyping(null)
  }
  const nudge = p.nudge ?? ((v: number, by: -10 | -1 | 1 | 10) => {
    const dir = by < 0 ? -1 : 1
    let n = v
    for (let i = 0; i < (Math.abs(by) === 10 ? 3 : 1); i++) n = p.step(n, dir)
    return n
  })
  const fraction = p.fraction(p.value)
  return (
    <>
      <div className={`workshop__row ws__railrow ${off ? 'is-off' : ''}`} role="group" aria-label={p.name} aria-disabled={off || undefined}>
        <span className="workshop__label ws__raillabel" title={p.hint}>{p.label}</span>
        <button className="workshop__btn" {...bind(() => setTo(p.step(p.read(), -1)))} disabled={off || p.value <= p.min} aria-label={p.less} title={p.less}>−</button>
        <div
          className="explorer__rail ws__opacity-rail"
          ref={rail}
          role="slider"
          tabIndex={off ? -1 : 0}
          aria-label={p.name}
          aria-valuemin={p.ariaMin ?? p.min}
          aria-valuemax={p.max}
          aria-valuenow={p.ariaNow === null ? undefined : p.ariaNow ?? p.value}
          aria-valuetext={p.valueText}
          aria-disabled={off || undefined}
          {...noCallout}
          onPointerDown={(e) => {
            if (off) return
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
            const k = KEYS[e.key]
            if (off || k === undefined || e.metaKey || e.ctrlKey || e.altKey) return
            // The bench nudges the selection with the arrows: these are the slider's.
            e.preventDefault(); e.stopPropagation()
            const v = p.read()
            setTo(k === 'min' ? p.min : k === 'max' ? p.max : Math.min(p.max, Math.max(p.min, nudge(v, k))))
          }}
        >
          <span className="explorer__line" />
          <span className="explorer__walked" style={{ width: `${fraction * 100}%` }} />
          <span className="explorer__mark" style={{ left: `${fraction * 100}%` }} />
        </div>
        <button className="workshop__btn" {...bind(() => setTo(p.step(p.read(), 1)))} disabled={off || p.value >= p.max} aria-label={p.more} title={p.more}>+</button>
        {/* A fixed width: a number that narrowed from 100% to 99% moved the rail under the finger mid-drag (arkinox, 2026-10-25). */}
        <span className="workshop__value ws__opacity-value">{p.shown}</span>
        <button
          className={`workshop__btn linescrub__hash ${typing !== null ? 'is-on' : ''}`}
          title={p.typing.hashTitle}
          aria-label={p.typing.hashLabel}
          aria-expanded={typing !== null}
          disabled={off}
          onClick={() => setTyping((t) => (t === null ? '' : null))}
        ><Hash size={12} strokeWidth={2.5} aria-hidden /></button>
      </div>
      {typing !== null && !off && (
        <form className="linescrub__goto" onSubmit={(e) => { e.preventDefault(); goTyped() }}>
          <input
            className="linescrub__goto-input"
            inputMode={p.typing.decimal ? 'decimal' : 'numeric'}
            pattern={p.typing.decimal ? '[0-9.]*' : '[0-9]*'}
            maxLength={p.typing.maxLength}
            autoFocus
            placeholder={p.typing.placeholder}
            aria-label={p.typing.fieldLabel}
            value={typing}
            onChange={(e) => setTyping(e.target.value.replace(p.typing.decimal ? /[^\d.]/g : /[^\d]/g, ''))}
            // Escape puts the field away and nothing else; preventDefault keeps the panel open (useKeyboard).
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setTyping(null) } }}
          />
          <button className="workshop__btn" type="submit" disabled={typed === null}>SET</button>
        </form>
      )}
    </>
  )
}
