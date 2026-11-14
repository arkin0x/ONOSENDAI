/**
 * AnimEditor.tsx: MOTION in the workshop's SHARD panel, the editor for an
 * object's `anim` (DECK-0003 §1.14; lib/animEdit.ts holds every rule and
 * conversion, this only draws them). arkinox, 2026-11-14: "i don't want to
 * ship animations without shipping workshop tools to create and edit
 * animations".
 *
 *   - ADD: presets with familiar names (SPIN, BOB, PENDULUM, BACK AND FORTH,
 *     ELEVATOR, FERRIS WHEEL, FOLLOW PATH) that write the canonical motions,
 *     sized for the object.
 *   - The list: up to four motions in order (the first innermost), each with
 *     move up, move down and remove, and its own controls: AXIS, SPEED in
 *     cycles a minute at today's pace (stored as c/b a block), REVERSE, its
 *     amount, REST for an elevator, START (the phase), and a path's points.
 *   - PLAY / PAUSE and a scrub through one cycle, drawn on the bench.
 *
 * Every edit goes through the workshop's setAnim, so it is one undoable step
 * and only ever stores what a reader can read. Numbers typed into a field
 * commit on Enter or when the field is left, not on each key.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Pause, Play, Repeat2, Square, X } from 'lucide-react'
import type { ShardModel } from 'sno-core/shards'
import { MAX_MOTIONS, PATH_MAX, readAnim, type Motion } from '../lib/anim'
import {
  addPoint, addPreset, amountKind, amountOf, listOf, mayFlicker, MOTION_NAMES, moveMotion, movePoint, objectReach, perMinute, pointsOf, PRESETS,
  rawOf, removeMotion, removePoint, reverse, setAmount, setAxis, setPhase, setPoint, setRest, setSpeed, showNumber, stepSpeed, type Edited, type PresetId, type ShownPoint,
} from '../lib/animEdit'
import { pacedSecondsPerBlock } from '../lib/pacedClock'
import { pacedEnds } from '../lib/pacedSource'
import { reducedMotionNow } from '../scene/animMotion'
import { noCallout, useRepeatable } from '../hooks/useRepeatable'
import { useAnimPreview } from '../store/animPreview'
import { useWorkshop } from '../store/useWorkshop'

const AXIS_NAMES = ['X', 'Y', 'Z'] as const

/** A number typed into a field, committed on Enter or blur; Escape puts the shown value back. */
function NumberField({ value, onCommit, label, width = '7ch', onFocus, signed = false }: { value: string; onCommit: (n: number) => void; label: string; width?: string; onFocus?: () => void; signed?: boolean }): JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const commit = (): void => {
    if (text === null) return
    // A comma is a decimal mark too.
    const n = Number(text.trim().replace(',', '.'))
    setText(null)
    if (text.trim() !== '' && Number.isFinite(n)) onCommit(n)
  }
  const keys = (e: KeyboardEvent<HTMLInputElement>): void => {
    // The bench nudges the selection with the arrows and the panel closes on Escape: these are the field's.
    e.stopPropagation()
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') { e.preventDefault(); setText(null) }
  }
  return (
    <input
      className="ws__anim-num"
      style={{ flex: `0 0 ${width}`, width, minWidth: 0 }}
      // A phone's decimal keypad has no minus: a value that may be negative gets the full keyboard.
      inputMode={signed ? 'text' : 'decimal'}
      aria-label={label}
      value={text ?? value}
      spellCheck={false}
      onFocus={onFocus}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={keys}
    />
  )
}

/** The current shard, its motions as a reader reads them, and its unit. */
function useAnimState(): { list: Motion[]; unit: number; shard: ShardModel | null } {
  const shard = useWorkshop((s) => s.current() ?? null)
  const raw = shard ? (shard as { anim?: unknown }).anim ?? shard.extra?.anim : undefined
  return { list: Array.isArray(raw) ? listOf(raw) : [], unit: shard?.unit ?? 0, shard }
}

export function AnimEditor(): JSX.Element {
  const { list, unit, shard } = useAnimState()
  const preview = useAnimPreview()
  // Scroll-safe: the panel scrolls, and a scroll that starts on a stepper must not change it.
  const bind = useRepeatable({ scrollSafe: true })
  const [note, setNote] = useState<string | null>(null)
  const currentId = useWorkshop((s) => s.currentId)
  const pace = pacedSecondsPerBlock(Date.now() / 1000, pacedEnds())
  const reduced = reducedMotionNow()
  const rail = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  // Another shard: last shard's message goes (the preview stops on its own, store/animPreview.ts).
  useEffect(() => { setNote(null) }, [currentId])
  // A key for each card that follows its motion through a reorder, so focus and typing stay with it.
  const keys = useRef<number[]>([])
  const nextKey = useRef(0)
  if (keys.current.length !== list.length) keys.current = list.map(() => nextKey.current++)

  const apply = (e: Edited, keyed?: (k: number[]) => number[]): void => {
    if (keyed) keys.current = keyed([...keys.current])
    useWorkshop.getState().setAnim(e.list.length ? rawOf(e.list) : undefined)
    setNote(e.note ?? null)
  }
  // Read again at the press, so a held stepper works from where it is now.
  const now = (): Motion[] => { const c = useWorkshop.getState().current(); const raw = c ? (c as { anim?: unknown }).anim ?? c.extra?.anim : undefined; return Array.isArray(raw) ? listOf(raw) : [] }
  const add = (id: PresetId): void => {
    if (!shard) return
    apply(addPreset(now(), id, objectReach(shard)), (k) => (k.length < MAX_MOTIONS ? [...k, nextKey.current++] : k))
    // Show it at once: picking a preset is asking to see it.
    if (!useAnimPreview.getState().on) useAnimPreview.getState().play()
  }
  const scrubTo = (clientX: number): void => {
    const r = rail.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    preview.setScrub((clientX - r.left) / r.width)
  }
  // Entries a reader ignores (malformed, unknown, past the fourth): the next edit writes the list without them.
  const raw = shard ? (shard as { anim?: unknown }).anim ?? shard.extra?.anim : undefined
  const ignored = Array.isArray(raw) ? raw.length - readAnim(raw).length : 0
  const share = preview.scrub ?? 0

  return (
    <div className="ws__anim" role="group" aria-label="Motion">
      <div className="workshop__row">
        <span className="workshop__label">MOTION</span>
        {list.length > 0 && (preview.on && preview.playing
          ? <button className="workshop__btn" title="Pause the preview" aria-label="Pause" onClick={() => preview.pause()}><Pause size={12} aria-hidden /> PAUSE</button>
          : <button className="workshop__btn" title="Play the preview" aria-label="Play" onClick={() => preview.play()}><Play size={12} aria-hidden /> PLAY</button>)}
        {list.length > 0 && preview.on && <button className="workshop__btn" title="Stop the preview, back at rest" aria-label="Stop" onClick={() => preview.stop()}><Square size={11} aria-hidden /> STOP</button>}
        {list.length > 0 && (
          <div
            className="explorer__rail ws__anim-rail"
            ref={rail}
            role="slider"
            tabIndex={0}
            aria-label="Scrub one cycle"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
            title="Scrub one cycle"
            {...noCallout}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); scrubbing.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); scrubTo(e.clientX) }}
            onPointerMove={(e) => { if (scrubbing.current) scrubTo(e.clientX) }}
            onPointerUp={() => { scrubbing.current = false }}
            onPointerCancel={() => { scrubbing.current = false }}
            onKeyDown={(e) => {
              const k = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0
              if (!k) return
              e.preventDefault(); e.stopPropagation()
              preview.setScrub(Math.max(0, Math.min(1, share + k)))
            }}
          >
            <span className="explorer__line" />
            <span className="explorer__walked" style={{ width: `${share * 100}%` }} />
            <span className="explorer__mark" style={{ left: `${share * 100}%` }} />
          </div>
        )}
      </div>
      {reduced && list.length > 0 && <div className="ws__explain">Reduced motion is on. Scrub to see it move.</div>}

      <div className="workshop__row" role="group" aria-label="Add a motion">
        <span className="workshop__label">ADD</span>
        <div className="workshop__modes">
          {PRESETS.map((p) => (
            <button key={p.id} className="workshop__mode" title={p.tip} disabled={list.length >= MAX_MOTIONS} onClick={() => add(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>
      {list.length >= MAX_MOTIONS && <div className="ws__explain">Up to {MAX_MOTIONS} motions</div>}

      {list.map((m, i) => (
        <MotionCard key={keys.current[i]} m={m} i={i} count={list.length} unit={unit} pace={pace} bind={bind} apply={apply} now={now} />
      ))}

      {note && <div className="ws__explain ws__anim-note" role="status">{note}</div>}
      {ignored > 0 && <div className="ws__explain">{ignored === 1 ? '1 entry here is skipped and goes on the next edit' : `${ignored} entries here are skipped and go on the next edit`}</div>}
    </div>
  )
}

type Bind = ReturnType<typeof useRepeatable>

type Apply = (e: Edited, keyed?: (k: number[]) => number[]) => void
const swap = (i: number, j: number) => (k: number[]): number[] => { if (j >= 0 && j < k.length) [k[i], k[j]] = [k[j], k[i]]; return k }

function MotionCard({ m, i, count, unit, pace, bind, apply, now }: { m: Motion; i: number; count: number; unit: number; pace: number; bind: Bind; apply: Apply; now: () => Motion[] }): JSX.Element {
  const name = MOTION_NAMES[m.word] ?? m.word.toUpperCase()
  const speed = perMinute(m, pace)
  const kind = amountKind(m)
  const amountLabel = m.word === 'swing' ? 'REACH' : m.word === 'orbit' ? 'RADIUS' : m.word === 'lift' ? 'TRAVEL' : 'REACH'
  const amount = amountOf(m, unit)
  const unitStep = m.word === 'swing' ? 5 : 0.25 * 2 ** unit
  const rate = `${Math.abs(m.c)}${m.b === 1 ? '' : `/${m.b}`} a block`
  return (
    <div className="ws__anim-card" role="group" aria-label={`Motion ${i + 1}: ${name}`}>
      <div className="workshop__row">
        <span className="workshop__label ws__anim-name">{i + 1}. {name}</span>
        <button className="workshop__btn" title="Move up" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => apply(moveMotion(now(), i, -1), swap(i, i - 1))}><ArrowUp size={12} aria-hidden /></button>
        <button className="workshop__btn" title="Move down" aria-label={`Move ${name} down`} disabled={i === count - 1} onClick={() => apply(moveMotion(now(), i, 1), swap(i, i + 1))}><ArrowDown size={12} aria-hidden /></button>
        <button className="workshop__btn workshop__btn--danger" title="Remove" aria-label={`Remove ${name}`} onClick={() => apply(removeMotion(now(), i), (k) => k.filter((_, q) => q !== i))}><X size={12} aria-hidden /></button>
      </div>
      {m.axis >= 0 && (
        <div className="workshop__row" role="group" aria-label="Axis">
          <span className="workshop__label">AXIS</span>
          <div className="workshop__modes">
            {AXIS_NAMES.map((a, k) => (
              <button key={a} className={`workshop__mode ${m.axis === k ? 'is-on' : ''}`} aria-pressed={m.axis === k} title={`About ${a}`} onClick={() => apply(setAxis(now(), i, k as 0 | 1 | 2))}>{a}</button>
            ))}
          </div>
        </div>
      )}
      <div className="workshop__row" role="group" aria-label="Speed">
        <span className="workshop__label">SPEED</span>
        <button className="workshop__btn" {...bind(() => { const l = now(); apply(setSpeed(l, i, stepSpeed(perMinute(l[i], pace), -1), pace)) })} aria-label="Slower" title="Slower">−</button>
        <NumberField label="Speed, per minute" value={showNumber(Math.abs(speed))} onCommit={(n) => apply(setSpeed(now(), i, (speed < 0 ? -1 : 1) * Math.abs(n), pace))} />
        <span className="workshop__value">/MIN</span>
        <button className="workshop__btn" {...bind(() => { const l = now(); apply(setSpeed(l, i, stepSpeed(perMinute(l[i], pace), 1), pace)) })} aria-label="Faster" title="Faster">+</button>
        <button className={`workshop__btn ${m.c < 0 ? 'is-on' : ''}`} aria-pressed={m.c < 0} title="Run it the other way" aria-label="Reverse" onClick={() => apply(reverse(now(), i))}><Repeat2 size={12} aria-hidden /></button>
        <span className="ws__explain">{rate}</span>
      </div>
      {mayFlicker(m, pace) && <div className="ws__explain ws__anim-note">This may flicker more than 3 times a second</div>}
      {kind && (
        <div className="workshop__row" role="group" aria-label={amountLabel}>
          <span className="workshop__label">{amountLabel}</span>
          <button className="workshop__btn" {...bind(() => { const l = now(); apply(setAmount(l, i, amountOf(l[i], unit) - unitStep, unit)) })} aria-label="Less" title="Less">−</button>
          <NumberField label={`${amountLabel}, ${kind === 'degrees' ? 'degrees' : 'gibsons'}`} value={showNumber(amount)} signed={m.word === 'lift'} onCommit={(n) => apply(setAmount(now(), i, n, unit))} />
          <span className="workshop__value">{kind === 'degrees' ? '°' : 'G'}</span>
          <button className="workshop__btn" {...bind(() => { const l = now(); apply(setAmount(l, i, amountOf(l[i], unit) + unitStep, unit)) })} aria-label="More" title="More">+</button>
        </div>
      )}
      {m.word === 'lift' && (
        <div className="workshop__row" role="group" aria-label="Rest">
          <span className="workshop__label">REST</span>
          <button className="workshop__btn" {...bind(() => { const l = now(); apply(setRest(l, i, l[i].p[1] - 5)) })} disabled={m.p[1] <= 0} aria-label="Shorter rests" title="Shorter rests">−</button>
          <span className="workshop__value">{m.p[1]}%</span>
          <button className="workshop__btn" {...bind(() => { const l = now(); apply(setRest(l, i, l[i].p[1] + 5)) })} disabled={m.p[1] >= 49} aria-label="Longer rests" title="Longer rests">+</button>
          <span className="ws__explain">at each stop</span>
        </div>
      )}
      <div className="workshop__row" role="group" aria-label="Start">
        <span className="workshop__label">START</span>
        <button className="workshop__btn" {...bind(() => { const l = now(); apply(setPhase(l, i, l[i].phi - 15)) })} aria-label="Start earlier" title="Earlier">−</button>
        <NumberField label="Start, degrees" value={String(m.phi)} onCommit={(n) => apply(setPhase(now(), i, n))} width="5ch" />
        <span className="workshop__value">°</span>
        <button className="workshop__btn" {...bind(() => { const l = now(); apply(setPhase(l, i, l[i].phi + 15)) })} aria-label="Start later" title="Later">+</button>
      </div>
      {m.word === 'path' && <PathPoints m={m} i={i} unit={unit} apply={apply} now={now} />}
    </div>
  )
}

function PathPoints({ m, i, unit, apply, now }: { m: Motion; i: number; unit: number; apply: Apply; now: () => Motion[] }): JSX.Element {
  const points = pointsOf(m, unit)
  const editing = useAnimPreview((s) => s.point)
  const focus = (j: number): void => useAnimPreview.getState().setPoint([i, j])
  const cell = (j: number, key: keyof ShownPoint, label: string, width: string): JSX.Element => (
    <NumberField label={`Point ${j + 1} ${label}`} width={width} signed={key !== 'time'} value={key === 'time' ? String(points[j].time) : showNumber(points[j][key])} onFocus={() => focus(j)} onCommit={(n) => apply(setPoint(now(), i, j, key, n, unit))} />
  )
  return (
    <div className="ws__anim-points" role="group" aria-label="Path points">
      <div className="workshop__row ws__anim-head">
        <span className="workshop__label">POINTS</span>
        <span className="ws__explain">X Y Z in gibsons, T is each leg&apos;s share of the time</span>
      </div>
      {points.map((_, j) => (
        <div key={j} className={`workshop__row ws__anim-point ${editing && editing[0] === i && editing[1] === j ? 'is-on' : ''}`} role="group" aria-label={`Point ${j + 1}`}>
          <span className="workshop__value">{j + 1}</span>
          <span className="ws__anim-axis workshop__btn--x">X</span>{cell(j, 'x', 'X', '6.5ch')}
          <span className="ws__anim-axis workshop__btn--y">Y</span>{cell(j, 'y', 'Y', '6.5ch')}
          <span className="ws__anim-axis workshop__btn--z">Z</span>{cell(j, 'z', 'Z', '6.5ch')}
          <span className="ws__anim-axis">T</span>{cell(j, 'time', 'time', '4ch')}
          <button className="workshop__btn" title="Move up" aria-label={`Move point ${j + 1} up`} disabled={j === 0} onClick={() => apply(movePoint(now(), i, j, -1))}><ArrowUp size={12} aria-hidden /></button>
          <button className="workshop__btn" title="Move down" aria-label={`Move point ${j + 1} down`} disabled={j === points.length - 1} onClick={() => apply(movePoint(now(), i, j, 1))}><ArrowDown size={12} aria-hidden /></button>
          <button className="workshop__btn workshop__btn--danger" title="Remove" aria-label={`Remove point ${j + 1}`} disabled={points.length <= 2} onClick={() => apply(removePoint(now(), i, j))}><X size={12} aria-hidden /></button>
        </div>
      ))}
      <div className="workshop__row">
        <button className="workshop__btn" disabled={points.length >= PATH_MAX} title="Add a point before the last" onClick={() => { apply(addPoint(now(), i)); focus(points.length - 1) }}>ADD POINT</button>
        {points.length >= PATH_MAX && <span className="ws__explain">Up to {PATH_MAX} points</span>}
      </div>
    </div>
  )
}
