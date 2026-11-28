/**
 * SurveyCard.tsx - the survey card (owner, 2026-11-27: "i want the card to
 * have a distinct look like the blueprint does"). The blueprint's EXAMINE is
 * a blue drafting sheet; this is a geologist's field card: warm dark earth,
 * amber and copper ink, a core sample of the chunk's layers across the top,
 * a SURVEYED stamp with the date, topographic contour lines faint behind the
 * data, and every number in monospace. Drawn from field notebooks, assay
 * reports and core logs (references in the PR).
 *
 * What it says (lib/terrain/assay.ts): the ground type with its signature
 * rock, the hardness (terrain K, out of 16), a gentle line for each recipe
 * block here, then every kind in the chunk, rarest first, with how many you
 * MINED here and how many are LEFT, and under its name how many of what is
 * left you could see without digging and how many are buried (owner,
 * 2026-11-28: "surely they arent always one or the other"): "2 visible ·
 * 5 buried", "all visible" or "all buried". A block beside air that is
 * closed off from the outside, or on the chunk's edge against the next
 * chunk's rock, is buried (lib/terrain/assay.ts). A list only, never where:
 * the finding stays yours. A tap or a slide across the core reads out each
 * layer's kind (Core, below).
 *
 * Live (owner, 2026-11-28: "can we make the card live update how many of the
 * blocks in the chunk you've mined and how many are left total?"): while it is
 * open it counts again whenever the chunk changes, at most four times a second
 * (surveyCard.ts watchCard). The numbers sit in fixed columns in tabular
 * figures, and a kind mined out stays on the list at 0 until the card closes,
 * so nothing on it moves.
 *
 * STAY IN THIS CHUNK, at the top (owner, 2026-11-28: walking into the next
 * chunk by accident while digging this one for a resource): a switch that
 * holds you inside this chunk's edge while it is on (terrain/chunkStay.ts),
 * in TERRAIN's mint, the colour of the wall it raises. Only for the chunk you
 * stand in; never offered during the tutorial's tour.
 *
 * It closes by the shared ✕, a tap outside it or Esc (hud/modalStack.tsx).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Layers, Lock, LockOpen, Pickaxe, ScrollText } from 'lucide-react'
import { ModalClose } from '../hud/ui/ModalClose'
import { Chamfer } from '../hud/ui/Chamfer'
import { Stacked, useModalStack } from '../hud/modalStack'
import { useTerrain } from '../store/useTerrain'
import { blockKind } from '../lib/terrain/blocks'
import { AVERAGE_HARDNESS, HARDNESS_MAX, coreLayers, coreSliceAt, hardnessLine, type CardRow } from '../lib/terrain/assay'
import { cardFor, closeSurveyCard, stampDate, useSurveyCard, watchCard, type CardFor } from './surveyCard'
import { Swatch } from './Swatch'
import { chunkHere, leaveStay, stayIn, useChunkStay, useStayKey } from './chunkStay'
import { useTutorial } from '../store/useTutorial'

const count = (n: number): string => n.toLocaleString('en-US')

/** The line over the lists: "You've mined 214 blocks here · 31,902 left". */
export function tallyLine(mined: number, left: number): string {
  const m = mined > 0 ? `You've mined ${count(mined)} ${mined === 1 ? 'block' : 'blocks'} here` : 'You haven\'t mined here yet'
  return `${m} · ${count(left)} left`
}

/** The one-line explainer over the lists. */
export const VISIBLE_KEY = 'Visible means you can see it without digging.'

/** The line under a kind's name: "2 visible · 5 buried", "all visible" or "all buried"; "none left" once it is all gone. */
export function visibilityLine(visible: number, buried: number): string {
  if (visible + buried === 0) return 'none left'
  if (buried === 0) return 'all visible'
  if (visible === 0) return 'all buried'
  return `${count(visible)} visible · ${count(buried)} buried`
}

function Row({ row }: { row: CardRow }): JSX.Element {
  const mark = row.count === 0 ? 'is-gone' : row.visible === 0 ? 'is-buried' : row.buried === 0 ? 'is-visible' : 'is-some'
  return (
    <li className={`survey-row${row.prized ? ' is-prized' : ''}`}>
      <Chamfer size={34}><Swatch id={row.id} size={24} /></Chamfer>
      <span className="survey-row__name">{row.name}</span>
      <span className="survey-row__leader" aria-hidden />
      <span className={`survey-row__mined${row.mined > 0 ? '' : ' is-none'}`} aria-label={`${count(row.mined)} mined`}>{row.mined > 0 ? count(row.mined) : '-'}</span>
      <span className="survey-row__count" aria-label={`${count(row.count)} left`}>{count(row.count)}</span>
      <span className={`survey-row__seen ${mark}`}>{visibilityLine(row.visible, row.buried)}</span>
    </li>
  )
}

/** A list's heading, with the two columns' names over the numbers. */
function Section({ name }: { name: string }): JSX.Element {
  return (
    <h3 className="survey-card__section">
      <span>{name}</span>
      <span className="survey-card__rule" aria-hidden />
      <span className="survey-card__section-n">MINED</span>
      <span className="survey-card__section-n">LEFT</span>
    </h3>
  )
}

/** The caption the readout shows while no slice is picked. */
export const CORE_CAPTION = 'Core sample: this chunk\'s 32 layers'

type BandEvent = ReactPointerEvent<HTMLDivElement>

/**
 * The chunk's 32 layers as a drilled core lying in its tray, top of the chunk
 * on the left as a core log reads: each slice the kind that layer is mostly
 * made of, a layer that is mostly open space hatched (a core's lost length).
 *
 * A finger tapped or slid across it (a mouse hovered or dragged) picks the
 * slice under it, lit, and the line above the core reads it out: its swatch,
 * "Layer 7: Cinderrock" or "Layer 12: mostly open". The pointer is captured,
 * so a slide keeps its slice past either end; touch-action is none on the core
 * alone, so the card still scrolls everywhere else. The line keeps its height
 * whatever it says, and shows the caption while no slice is picked. A slider
 * to the keyboard and a screen reader: arrows, Home and End move along it.
 * It says no more than the colours do.
 */
function Core({ strata }: { strata: Uint8Array }): JSX.Element {
  const layers = useMemo(() => coreLayers(strata), [strata])
  const [active, setActive] = useState<number | null>(null)
  // Where the keyboard is along the core, kept while nothing is picked, so focus comes back to the same slice.
  const [pos, setPos] = useState(0)
  const dragging = useRef<number | null>(null)
  const pick = (i: number): void => { setActive(i); setPos(i) }
  const at = (e: BandEvent): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return coreSliceAt(e.clientX, r.left, r.width, layers.length)
  }
  const onPointerDown = (e: BandEvent): void => {
    dragging.current = e.pointerId
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a pointer already gone */ }
    pick(at(e))
  }
  const onPointerMove = (e: BandEvent): void => {
    if (dragging.current === e.pointerId || (dragging.current === null && e.pointerType === 'mouse')) pick(at(e))
  }
  const onPointerEnd = (e: BandEvent): void => {
    if (dragging.current !== e.pointerId) return
    dragging.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* released already */ }
  }
  // A mouse leaving lets go of its slice; a finger lifted keeps its slice up to read until focus moves on.
  const onPointerLeave = (e: BandEvent): void => {
    if (dragging.current === null && e.pointerType === 'mouse') setActive(null)
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const from = active ?? pos
    const last = layers.length - 1
    const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? from + 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? from - 1
        : e.key === 'Home' ? 0
          : e.key === 'End' ? last
            : null
    if (to === null) return
    e.preventDefault()
    pick(Math.min(last, Math.max(0, to)))
  }
  const shown = active === null ? null : layers[active]
  const now = layers[active ?? pos]
  return (
    <div className="survey-card__tray">
      <span className={`survey-card__readout${shown ? ' is-active' : ''}`} aria-hidden>
        {shown ? (
          <>
            {shown.id ? <Swatch id={shown.id} size={12} /> : <span className="survey-card__readout-open" />}
            <span className="survey-card__readout-line">{shown.line}</span>
          </>
        ) : <span className="survey-card__readout-line">{CORE_CAPTION}</span>}
      </span>
      <div
        className="survey-card__core"
        role="slider"
        tabIndex={0}
        aria-label={CORE_CAPTION}
        aria-orientation="horizontal"
        aria-valuemin={1}
        aria-valuemax={layers.length}
        aria-valuenow={now.layer}
        aria-valuetext={now.line}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onPointerLeave={onPointerLeave}
        onFocus={() => setActive((a) => (a === null ? pos : a))}
        onBlur={() => { dragging.current = null; setActive(null) }}
        onKeyDown={onKeyDown}
      >
        {layers.map(({ id }, i) => {
          const k = id ? blockKind(id) : null
          const cls = `survey-band${k ? '' : ' is-open'}${i === active ? ' is-active' : ''}`
          return <span key={i} className={cls} style={k ? ({ '--band': k.color, '--band-edge': k.edge } as CSSProperties) : undefined} />
        })}
      </div>
      <span className="survey-card__tray-labels" aria-hidden><span>TOP</span><span>BOTTOM</span></span>
    </div>
  )
}

/** The words under STAY IN THIS CHUNK, by state: on, offered, or not here. */
export const STAY_ON = 'The edge holds you while you dig. Tap to let go.'
export const STAY_OFF = 'Hold yourself inside this chunk while you dig.'
export const STAY_AWAY = 'Stand in this chunk to stay in it.'

/**
 * STAY IN THIS CHUNK: a switch row, the lock's icon in a chamfer, its name and
 * one line, and the switch. Its height is the same in every state, so nothing
 * on the card moves when it is flipped.
 */
export function StayRow({ chunk }: { chunk: string }): JSX.Element {
  const stay = useStayKey()
  // Where you stand changes only on a crossing (chunkStay.ts), so this re-renders only then.
  const here = useChunkStay((s) => s.here) ?? chunkHere()
  const on = stay === chunk
  const away = !on && here !== chunk
  const flip = (): void => { if (on) leaveStay(); else stayIn(chunk) }
  return (
    <button
      type="button"
      className={`survey-stay${on ? ' is-on' : ''}`}
      role="switch"
      aria-checked={on}
      disabled={away}
      onClick={flip}
    >
      <span className="survey-stay__icon" aria-hidden>{on ? <Lock size={16} strokeWidth={2.25} /> : <LockOpen size={16} strokeWidth={2.25} />}</span>
      <span className="survey-stay__text">
        <span className="survey-stay__name">STAY IN THIS CHUNK</span>
        <span className="survey-stay__line">{on ? STAY_ON : away ? STAY_AWAY : STAY_OFF}</span>
      </span>
      <span className="survey-stay__switch" aria-hidden><span className="survey-stay__knob" /></span>
    </button>
  )
}

export function SurveyCard(): JSX.Element | null {
  const key = useSurveyCard((s) => s.open)
  const owns = useTerrain((s) => !!s.inventory.compiler)
  const touring = useTutorial((s) => s.active)
  // Leaving TERRAIN takes the card with it.
  useEffect(() => () => closeSurveyCard(), [])
  // One pass over the chunk as it opens, at the revision you see it at (kept per chunk and version: lib/terrain/assay.ts
  // chunkAssay), never per frame. The ground is read through groundFor, which may wait on the blocks worker. While it is
  // open, counted again when the chunk changes (watchCard: at most four times a second), one count at a time.
  const [got, setGot] = useState<{ key: string; card: CardFor } | null>(null)
  useEffect(() => {
    if (!key) { setGot(null); return }
    let live = true
    let busy = false
    let again = false
    // Every kind the open card has listed stays listed, at 0 once it is all gone, so no row jumps off it.
    const shown = new Set<number>()
    const recount = (): void => {
      if (busy) { again = true; return }
      busy = true
      const done = (): void => {
        busy = false
        if (live && again) { again = false; recount() }
      }
      void cardFor(key, shown).then((card) => {
        if (!live) return
        if (card) for (const r of [...card.card.finds, ...card.card.common]) shown.add(r.id)
        setGot(card ? { key, card } : null)
        done()
      }, () => { if (live) setGot(null); done() })
    }
    recount()
    const stop = watchCard(key, recount)
    return () => { live = false; stop() }
  }, [key, owns])
  // On the Escape stack only while the card is drawn: one that could not be read never swallows Esc (review of #956).
  const shown = !!key && !!got && got.key === key
  useModalStack(shown, closeSurveyCard)
  if (!shown) return null
  const { card, at, revision } = got.card
  const date = stampDate(at)
  const h = card.hardness
  return (
    <Stacked>
      <div className="modal survey-modal" role="dialog" aria-modal="true" aria-label="Survey card" onPointerDown={closeSurveyCard}>
        <div className="survey-card" onPointerDown={(e) => e.stopPropagation()}>
          <div className="survey-card__head">
            <ScrollText size={16} strokeWidth={2} aria-hidden />
            <h2>FIELD SURVEY</h2>
            <ModalClose onClose={closeSurveyCard} title="Close (Esc)" />
          </div>
          <div className="survey-card__body">
            {!touring && <StayRow chunk={got.key} />}
            <Core strata={card.strata} />
            <div className="survey-card__facts">
              <div className="survey-card__ground">
                {card.ground ? <Chamfer size={44}><Swatch id={card.ground.rock} size={30} /></Chamfer> : <Chamfer size={44}><Layers size={22} strokeWidth={1.75} aria-hidden /></Chamfer>}
                <span className="survey-card__fact">
                  <span className="survey-card__label">Ground type:</span>
                  <span className="survey-card__value">{card.ground ? card.ground.name : 'Unknown'}</span>
                </span>
              </div>
              <span className="survey-card__stamp" aria-label={`Surveyed ${date}`}><span className="survey-card__stamp-word">SURVEYED</span><span className="survey-card__stamp-date">{date}</span></span>
            </div>
            <div className="survey-card__hardness">
              <span className="survey-card__label">HARDNESS</span>
              {h ? (
                <>
                  <span className="survey-meter" role="meter" aria-valuemin={0} aria-valuemax={HARDNESS_MAX} aria-valuenow={h.max} aria-label={`Hardness ${h.max} of ${HARDNESS_MAX}`}>
                    {Array.from({ length: HARDNESS_MAX }, (_, i) => <span key={i} className={`survey-meter__cell${i < h.max ? ' is-on' : ''}${i === AVERAGE_HARDNESS - 1 ? ' is-mean' : ''}`} />)}
                  </span>
                  <span className="survey-card__value survey-card__value--num">{h.max}<small> / {HARDNESS_MAX}</small></span>
                </>
              ) : <span className="survey-card__value">Not known</span>}
            </div>
            <p className="survey-card__sub">{h ? `${hardnessLine(h.max)} Rare finds need hard ground.` : 'Rare finds need hard ground.'}</p>

            {card.notes.length > 0 && (
              <ul className="survey-card__notes">
                {card.notes.map((n) => <li key={n}><Pickaxe size={13} strokeWidth={2.25} aria-hidden />{n}</li>)}
              </ul>
            )}

            <p className="survey-card__tally">{tallyLine(card.minedTotal, card.total)}</p>
            <p className="survey-card__key">{VISIBLE_KEY}</p>
            <Section name="FINDS" />
            {card.finds.length > 0
              ? <ul className="survey-card__list">{card.finds.map((r) => <Row key={r.id} row={r} />)}</ul>
              : <p className="survey-card__empty">Nothing rare in this chunk.</p>}
            <Section name="COMMON MATERIALS" />
            {card.common.length > 0
              ? <ul className="survey-card__list">{card.common.map((r) => <Row key={r.id} row={r} />)}</ul>
              : <p className="survey-card__empty">Nothing here: open space.</p>}
            <p className="survey-card__foot"><span>Survey material audit.</span><span>Ground revision {revision}</span></p>
          </div>
        </div>
      </div>
    </Stacked>
  )
}
