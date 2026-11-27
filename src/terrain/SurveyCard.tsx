/**
 * SurveyCard.tsx - the survey card (owner, 2026-11-27: "i want the card to
 * have a distinct look like the blueprint does"). The blueprint's EXAMINE is
 * a blue drafting sheet; this is a geologist's field card: warm dark earth,
 * amber and copper ink, a core sample of the chunk's layers across the top,
 * an ASSAY stamp with the date, topographic contour lines faint behind the
 * data, and every number in monospace. Drawn from field notebooks, assay
 * reports and core logs (references in the PR).
 *
 * What it says (lib/terrain/assay.ts): the ground type with its signature
 * rock, the hardness (terrain K, out of 16), a gentle line for each recipe
 * block here, then every kind in the chunk, rarest first, with its count and
 * whether any of it shows ("visible") or it is all inside ("buried"). A list
 * only, never where: the finding stays yours.
 *
 * It closes by the shared ✕, a tap outside it or Esc (hud/modalStack.tsx).
 */

import { useEffect, useMemo, type CSSProperties } from 'react'
import { Eye, EyeOff, Layers, Pickaxe, ScrollText } from 'lucide-react'
import { ModalClose } from '../hud/ui/ModalClose'
import { Chamfer } from '../hud/ui/Chamfer'
import { Stacked, useModalStack } from '../hud/modalStack'
import { useTerrain } from '../store/useTerrain'
import { blockKind } from '../lib/terrain/blocks'
import { HARDNESS_MAX, type CardRow } from '../lib/terrain/assay'
import { cardFor, closeSurveyCard, stampDate, useSurveyCard } from './surveyCard'
import { Swatch } from './Swatch'

const count = (n: number): string => n.toLocaleString('en-US')

function Row({ row }: { row: CardRow }): JSX.Element {
  return (
    <li className={`survey-row${row.prized ? ' is-prized' : ''}`}>
      <Chamfer size={34}><Swatch id={row.id} size={24} /></Chamfer>
      <span className="survey-row__name">{row.name}</span>
      <span className="survey-row__leader" aria-hidden />
      <span className={`survey-row__mark${row.visible ? ' is-visible' : ' is-buried'}`}>
        {row.visible ? <Eye size={11} strokeWidth={2.25} aria-hidden /> : <EyeOff size={11} strokeWidth={2.25} aria-hidden />}
        {row.visible ? 'visible' : 'buried'}
      </span>
      <span className="survey-row__count">{count(row.count)}</span>
    </li>
  )
}

/**
 * The chunk's 32 layers as a drilled core lying in its tray, top of the chunk
 * on the left as a core log reads: each slice the kind that layer is mostly
 * made of, a layer that is mostly open space hatched (a core's lost length).
 */
function Core({ strata }: { strata: Uint8Array }): JSX.Element {
  const bands = Array.from(strata).reverse()
  return (
    <div className="survey-card__tray" aria-hidden>
      <div className="survey-card__core">
        {bands.map((id, i) => {
          const k = id ? blockKind(id) : null
          return <span key={i} className={k ? 'survey-band' : 'survey-band is-open'} style={k ? ({ '--band': k.color, '--band-edge': k.edge } as CSSProperties) : undefined} />
        })}
      </div>
      <span className="survey-card__tray-labels"><span>TOP</span><span>32 LAYERS</span><span>BASE</span></span>
    </div>
  )
}

export function SurveyCard(): JSX.Element | null {
  const key = useSurveyCard((s) => s.open)
  const owns = useTerrain((s) => !!s.inventory.compiler)
  useModalStack(key !== null, closeSurveyCard)
  // Leaving TERRAIN takes the card with it.
  useEffect(() => () => closeSurveyCard(), [])
  // One pass over the chunk as it opens (kept per chunk and version: lib/terrain/assay.ts chunkAssay), never per frame.
  const got = useMemo(() => (key ? cardFor(key) : null), [key, owns])
  if (!key || !got) return null
  const { card, at } = got
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
            <Core strata={card.strata} />
            <div className="survey-card__facts">
              <div className="survey-card__ground">
                {card.ground ? <Chamfer size={44}><Swatch id={card.ground.rock} size={30} /></Chamfer> : <Chamfer size={44}><Layers size={22} strokeWidth={1.75} aria-hidden /></Chamfer>}
                <span className="survey-card__fact">
                  <span className="survey-card__label">GROUND</span>
                  <span className="survey-card__value">{card.ground ? card.ground.name : 'Unknown'}</span>
                </span>
              </div>
              <span className="survey-card__stamp" aria-label={`Surveyed ${date}`}><span className="survey-card__stamp-word">ASSAY</span><span className="survey-card__stamp-date">{date}</span></span>
            </div>
            <div className="survey-card__hardness">
              <span className="survey-card__label">HARDNESS</span>
              {h ? (
                <>
                  <span className="survey-meter" role="meter" aria-valuemin={0} aria-valuemax={HARDNESS_MAX} aria-valuenow={h.max} aria-label={`Hardness ${h.max} of ${HARDNESS_MAX}`}>
                    {Array.from({ length: HARDNESS_MAX }, (_, i) => <span key={i} className={`survey-meter__cell${i < h.max ? ' is-on' : ''}${i === Math.round(h.mean) - 1 ? ' is-mean' : ''}`} />)}
                  </span>
                  <span className="survey-card__value survey-card__value--num">{h.max}<small> / {HARDNESS_MAX}</small></span>
                </>
              ) : <span className="survey-card__value">Not known</span>}
            </div>
            <p className="survey-card__sub">{h ? `At its hardest. About ${Math.round(h.mean)} on average. Rare finds need hard ground.` : 'Rare finds need hard ground.'}</p>

            {card.notes.length > 0 && (
              <ul className="survey-card__notes">
                {card.notes.map((n) => <li key={n}><Pickaxe size={13} strokeWidth={2.25} aria-hidden />{n}</li>)}
              </ul>
            )}

            <h3 className="survey-card__section"><span>FINDS</span><span className="survey-card__rule" aria-hidden /><span className="survey-card__section-n">{card.finds.length}</span></h3>
            {card.finds.length > 0
              ? <ul className="survey-card__list">{card.finds.map((r) => <Row key={r.id} row={r} />)}</ul>
              : <p className="survey-card__empty">Nothing rare in this chunk.</p>}
            <h3 className="survey-card__section"><span>COMMON ROCK</span><span className="survey-card__rule" aria-hidden /><span className="survey-card__section-n">{card.common.length}</span></h3>
            {card.common.length > 0
              ? <ul className="survey-card__list">{card.common.map((r) => <Row key={r.id} row={r} />)}</ul>
              : <p className="survey-card__empty">No rock: open space.</p>}
            <p className="survey-card__foot"><span>What is here, not where.</span><span>{count(card.total)} blocks</span></p>
          </div>
        </div>
      </div>
    </Stacked>
  )
}
