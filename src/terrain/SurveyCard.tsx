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
 * MINED here and how many are LEFT, and whether any of it shows ("visible")
 * or it is all inside ("buried"). A list only, never where: the finding stays
 * yours. A tap or a slide across the core reads out each layer's kind (Core,
 * below).
 *
 * Live (owner, 2026-11-28: "can we make the card live update how many of the
 * blocks in the chunk you've mined and how many are left total?"): while it is
 * open it counts again whenever the chunk changes, at most four times a second
 * (surveyCard.ts watchCard). The numbers sit in fixed columns in tabular
 * figures, and a kind mined out stays on the list at 0 until the card closes,
 * so nothing on it moves.
 *
 * Starred (owner, 2026-11-28: "How can we provide a UI UX to save and star
 * this chunk so that I can find it later"): the star in the head saves the
 * chunk, with this card as it is now, to your saved chunks (MINING's SAVED
 * CHUNKS, store/starredChunks.ts); tapped again it comes off, with an UNDO.
 * The line under the head says where the chunk stands with you, always one
 * line high whatever it says: a card with a rare find (Glowcore, Cinderrock
 * and the rare band) asks you to star it, and the star glows until you do.
 * While a saved chunk's card is open, what it counts is kept with the star.
 *
 * It closes by the shared ✕, a tap outside it or Esc (hud/modalStack.tsx).
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Eye, EyeOff, Layers, Pickaxe, ScrollText, Star, Undo2 } from 'lucide-react'
import { ModalClose } from '../hud/ui/ModalClose'
import { Chamfer } from '../hud/ui/Chamfer'
import { Stacked, useModalStack } from '../hud/modalStack'
import { useTerrain } from '../store/useTerrain'
import { blockKind } from '../lib/terrain/blocks'
import { AVERAGE_HARDNESS, HARDNESS_MAX, coreLayers, coreSliceAt, hardnessLine, type CardRow } from '../lib/terrain/assay'
import { cardFor, closeSurveyCard, stampDate, useSurveyCard, watchCard, type CardFor } from './surveyCard'
import { Swatch } from './Swatch'
import { findsHere, promptFinds, snapshotOf } from '../lib/terrain/starredChunk'
import { refreshSnapshot, starChunk, undoRemove, unstarChunk, useStarredChunks } from '../store/starredChunks'
import { openSavedChunks } from './savedChunksUi'
import { MAX_STARRED_CHUNKS } from '../lib/starredChunksRecord'
import { BRIEF_TOAST_MS, useToast } from '../store/useToast'

const count = (n: number): string => n.toLocaleString('en-US')

/** The line over the lists: "You've mined 214 blocks here · 31,902 left". */
export function tallyLine(mined: number, left: number): string {
  const m = mined > 0 ? `You've mined ${count(mined)} ${mined === 1 ? 'block' : 'blocks'} here` : 'You haven\'t mined here yet'
  return `${m} · ${count(left)} left`
}

export function Row({ row }: { row: CardRow }): JSX.Element {
  const mark = row.count === 0 ? 'is-gone' : row.visible ? 'is-visible' : 'is-buried'
  return (
    <li className={`survey-row${row.prized ? ' is-prized' : ''}`}>
      <Chamfer size={34}><Swatch id={row.id} size={24} /></Chamfer>
      <span className="survey-row__name">{row.name}</span>
      <span className="survey-row__leader" aria-hidden />
      <span className={`survey-row__mark ${mark}`}>
        {row.visible ? <Eye size={11} strokeWidth={2.25} aria-hidden /> : <EyeOff size={11} strokeWidth={2.25} aria-hidden />}
        {row.count === 0 ? 'gone' : row.visible ? 'visible' : 'buried'}
      </span>
      <span className={`survey-row__mined${row.mined > 0 ? '' : ' is-none'}`} aria-label={`${count(row.mined)} mined`}>{row.mined > 0 ? count(row.mined) : '-'}</span>
      <span className="survey-row__count" aria-label={`${count(row.count)} left`}>{count(row.count)}</span>
    </li>
  )
}

/** A list's heading, with the two columns' names over the numbers. */
export function Section({ name }: { name: string }): JSX.Element {
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
export function Core({ strata }: { strata: Uint8Array }): JSX.Element {
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

/**
 * The star's line, under the card's head: one line high in every state, so
 * starring never moves the card. A rare find asks to be starred; a starred
 * chunk says where to find it again; one just taken off offers UNDO.
 */
export function StarLine({ chunk, rare, starred, removed }: { chunk: string; rare: string | null; starred: boolean; removed: boolean }): JSX.Element {
  let body: JSX.Element
  if (removed && !starred) {
    body = <><span className="survey-star__words">Taken off your saved chunks.</span><button type="button" className="survey-star__undo" onClick={() => undoRemove()}><Undo2 size={12} strokeWidth={2.25} aria-hidden />UNDO</button></>
  } else if (starred) {
    body = <><span className="survey-star__words">{rare ? `${rare} Saved: ` : 'Saved: '}</span><button type="button" className="survey-star__link" onClick={() => openSavedChunks(chunk)}>SAVED CHUNKS</button></>
  } else {
    body = <span className="survey-star__words">{rare ? `${rare} Star this chunk to find it again.` : 'Star this chunk to find it again.'}</span>
  }
  return <p className={`survey-star${rare && !starred && !removed ? ' is-asking' : ''}${starred ? ' is-starred' : ''}`} role="status">{body}</p>
}

export function SurveyCard(): JSX.Element | null {
  const key = useSurveyCard((s) => s.open)
  const owns = useTerrain((s) => !!s.inventory.compiler)
  const starred = useStarredChunks((s) => !!key && s.keys.has(key))
  const removed = useStarredChunks((s) => !!key && s.removed?.entry.c === key)
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
        // A saved chunk keeps its card as you see it now (only what changed is kept; never a write by itself).
        if (card && useStarredChunks.getState().keys.has(key)) refreshSnapshot(key, snapshotOf(card.card, card.at))
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
  const rareRows = promptFinds(card)
  const rare = rareRows.length ? findsHere(rareRows) : null
  const toggleStar = (): void => {
    if (starred) unstarChunk(key)
    else if (!starChunk(key, snapshotOf(card, at))) useToast.getState().show({ label: 'Your saved chunks are full', meta: `${MAX_STARRED_CHUNKS} at most. Remove one in MINING, SAVED CHUNKS, to star this one.`, mark: 'star', ms: BRIEF_TOAST_MS })
  }
  return (
    <Stacked>
      <div className="modal survey-modal" role="dialog" aria-modal="true" aria-label="Survey card" onPointerDown={closeSurveyCard}>
        <div className="survey-card" onPointerDown={(e) => e.stopPropagation()}>
          <div className="survey-card__head">
            <ScrollText size={16} strokeWidth={2} aria-hidden />
            <h2>FIELD SURVEY</h2>
            <button
              type="button"
              className={`survey-card__star${starred ? ' is-on' : ''}${rare && !starred ? ' is-asking' : ''}`}
              onClick={toggleStar}
              aria-pressed={starred}
              aria-label={starred ? 'Starred: tap to take it off your saved chunks' : 'Star this chunk to find it again'}
              title={starred ? 'Starred: tap to take it off your saved chunks' : 'Star this chunk to find it again'}
            >
              <Star size={15} strokeWidth={2.25} aria-hidden fill={starred ? 'currentColor' : 'none'} />
            </button>
            <ModalClose onClose={closeSurveyCard} title="Close (Esc)" />
          </div>
          <StarLine chunk={key} rare={rare} starred={starred} removed={removed} />
          <div className="survey-card__body">
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
