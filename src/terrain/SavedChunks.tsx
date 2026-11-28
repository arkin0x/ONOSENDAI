/**
 * SavedChunks.tsx - SAVED CHUNKS: the chunks you starred, and each one's
 * card and whereabouts (owner, 2026-11-28: "you can star a survey card and
 * keep it in the mining panel in a button that triggers a modal that shows all
 * your saved chunks and then you can view the chunk and it'll show you where
 * it's at and then you can navigate to it or set it as a waypoint or set it as
 * a heads-up display target").
 *
 * THE LIST. One row per saved chunk, newest starred first, each the same
 * height: its best find's block, its name (your note, else its finds:
 * "Glowcore ×2, Cinderrock ×40"), its finds or ground under that, the date you
 * starred it, and on the right an arrow and how many chunks away it is, the
 * arrow on a compass with the sun at the top (facing the sun, left-handed: +Z
 * ahead, +X on your right). The chunk being guided to wears a gold beacon.
 * A row just removed stays where it was, as one line with UNDO, for a while.
 *
 * THE VIEW, a tap on a row. Where it is: the distance in chunks and gibsons,
 * the way facing the sun, the height above or below you, and a small top-down
 * locator with the sun at the top, you in the middle and the chunk as a gold
 * star (at the rim, pointing out, when it is further than the map). Then the
 * actions, half-width pairs as the CREATE panel's:
 *   - NAVIGATE plans the trip there with GOAL (store/useGoal.ts planTo), as
 *     GOAL beside the star does: nothing is signed or paid by planning, and
 *     SET on the GOAL chip lines up the walk or the ride with its usual
 *     confirmation.
 *   - SET WAYPOINT: the gold beacon over the chunk in the world
 *     (scene/StarredChunkMarks.tsx).
 *   - HUD TARGET: the marker on screen with the distance, pinned to the
 *     screen's edge when the chunk is off screen (hud/Targets.tsx).
 *     The waypoint and the target are each on or off by themselves, for one
 *     saved chunk at a time: picking another moves them to it.
 *   - RENAME: your note, in place of the name, in a field of the same height.
 *   - REMOVE: off the list at once, with UNDO in its place for a while; never
 *     a removal without a way back.
 * Then its saved card, drawn with the survey card's own parts (SurveyCard.tsx)
 * from the snapshot kept with the star, counted again each time you are there.
 *
 * Stacked (hud/modalStack.tsx): the shared ✕, a tap outside or Esc close it;
 * from a chunk's view, Esc and BACK go back to the list.
 *
 * The look is the survey card's field card: warm dark earth, amber ink, the
 * chamfered frame. The locator is drawn from the round radar insets of sci-fi
 * HUDs (Elite Dangerous' scanner, the mini-maps of Xaero's and JourneyMap
 * with their waypoint beams), in the card's own copper and gold.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { ChevronLeft, Check, Crosshair, MapPin, Navigation, Navigation2, Pencil, RadioTower, ScrollText, Star, Trash2, Undo2, X } from 'lucide-react'
import type { Plane } from 'cyberspace-core'
import { ModalClose } from '../hud/ui/ModalClose'
import { Chamfer } from '../hud/ui/Chamfer'
import { Stacked, leaveModals, useModalStack } from '../hud/modalStack'
import { useCyberspace } from '../store/useCyberspace'
import { useGoal } from '../store/useGoal'
import { BRIEF_TOAST_MS, useToast } from '../store/useToast'
import {
  expireUndo, nudgeStarred, renameChunk, setHudTarget, setWaypoint, undoRemove, unstarChunk, useStarredChunks, type ChunkGuide,
} from '../store/starredChunks'
import { MAX_NOTE, type StarEntry } from '../lib/starredChunksRecord'
import { parseChunkKey } from '../lib/terrain/coords'
import { HARDNESS_MAX, AVERAGE_HARDNESS } from '../lib/terrain/assay'
import {
  autoLabel, cardOfSnapshot, chunkCentre, chunkName, chunkWords, gibsonWords, groundOf, locatorPoint, savedDate, topFinds, whereIs, type Where,
} from '../lib/terrain/starredChunk'
import { stampDate } from './surveyCard'
import { Core, Row, Section, tallyLine } from './SurveyCard'
import { Swatch } from './Swatch'
import { backToList, closeSavedChunks, useSavedChunksUi } from './savedChunksUi'

const PLANE_NAME = ['dataspace', 'ideaspace'] as const

/** The right column of a row: how far, in chunks, or where it is when not on your plane. */
export function rowDistance(w: Where | null): string {
  if (!w) return ''
  if (!w.samePlane) return 'Other plane'
  if (w.inside) return 'You are here'
  return chunkWords(w.chunks)
}

/** The line under a row's name: its finds when it carries your note, else its ground and hardness. */
export function rowSub(e: StarEntry): string {
  if (e.n) return autoLabel(e.s)
  const g = groundOf(e.s?.g ?? null)
  const k = e.s?.k
  return [g ? `${g.name} ground` : null, k !== null && k !== undefined ? `Hardness ${k} / ${HARDNESS_MAX}` : null].filter(Boolean).join(' · ') || 'Card not counted yet'
}

/** The block a row shows: its best find, else its ground's rock. */
function rowSwatch(e: StarEntry): number | null {
  const top = topFinds(e.s, 1)[0]
  if (top) return top[0]
  return groundOf(e.s?.g ?? null)?.rock ?? null
}

function Arrow({ w, size = 16 }: { w: Where | null; size?: number }): JSX.Element {
  // No way on the level (inside, the other plane, straight above or below): a pin, never an arrow pointing at the sun.
  const flat = !w || !w.samePlane || w.inside || (w.dx === 0n && w.dz === 0n)
  return (
    <span className={`saved-arrow${flat ? ' is-flat' : ''}`} style={{ '--deg': `${flat ? 0 : w!.deg}deg` } as CSSProperties} aria-hidden>
      {flat ? <MapPin size={size} strokeWidth={2} /> : <Navigation2 size={size} strokeWidth={2} fill="currentColor" />}
    </span>
  )
}

/** Where your head is, and its plane: WALK's cursor while walking, else your chain's position. */
function useHead(): { head: { x: bigint; y: bigint; z: bigint }; plane: number } {
  const head = useCyberspace((s) => (s.walking ? s.cursor : s.position))
  const plane = useCyberspace((s) => s.headPlane)
  return { head, plane }
}

function ListRow({ e, w, guide, onOpen }: { e: StarEntry; w: Where | null; guide: ChunkGuide | null; onOpen: () => void }): JSX.Element {
  const sw = rowSwatch(e)
  const guided = guide?.key === e.c
  return (
    <li>
      <button type="button" className={`saved-row${guided ? ' is-guided' : ''}`} onClick={onOpen} aria-label={`${chunkName(e)}: ${rowDistance(w)}. Open`}>
        <Chamfer size={44}>{sw ? <Swatch id={sw} size={30} /> : <ScrollText size={20} strokeWidth={1.75} aria-hidden />}</Chamfer>
        <span className="saved-row__text">
          <span className="saved-row__name">
            <Star size={11} strokeWidth={2.25} fill="currentColor" aria-hidden />
            <span className="saved-row__name-text">{chunkName(e)}</span>
            {guided && <RadioTower className="saved-row__beacon" size={12} strokeWidth={2.25} aria-label="Guiding to it" />}
          </span>
          <span className="saved-row__sub">{rowSub(e)}</span>
          <span className="saved-row__date">Saved {savedDate(e.a)}</span>
        </span>
        <span className="saved-row__where">
          <Arrow w={w} />
          <span className="saved-row__dist">{rowDistance(w)}</span>
        </span>
      </button>
    </li>
  )
}

function RemovedRow({ e }: { e: StarEntry }): JSX.Element {
  return (
    <li>
      <div className="saved-row saved-row--removed" role="status">
        <span className="saved-row__removed-words">Removed {chunkName(e)}</span>
        <button type="button" className="cham-btn saved-undo" onClick={() => undoRemove()}><Undo2 size={13} strokeWidth={2.25} aria-hidden />UNDO</button>
      </div>
    </li>
  )
}

/**
 * The locator: a top-down map with the sun at the top, you in the middle, the
 * chunk as a gold star; rings at half and the whole of its span, in chunks.
 */
export function Locator({ w, size = 132 }: { w: Where; size?: number }): JSX.Element {
  const r = size / 2
  const rim = r - 14
  const p = locatorPoint(w)
  const sx = r + p.x * rim, sy = r + p.y * rim
  const star = (cx: number, cy: number, o: number, i: number): string => Array.from({ length: 10 }, (_, k) => {
    const a = (Math.PI / 5) * k - Math.PI / 2
    const rr = k % 2 === 0 ? o : i
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`
  }).join(' ')
  return (
    <svg className="saved-locator" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Map from above with the sun at the top: the chunk is ${w.inside ? 'where you are' : w.way.toLowerCase()}, ${chunkWords(w.chunks)} away`}>
      <circle cx={r} cy={r} r={rim} className="saved-locator__rim" />
      <circle cx={r} cy={r} r={rim / 2} className="saved-locator__ring" />
      <line x1={r} y1={r - rim} x2={r} y2={r + rim} className="saved-locator__axis" />
      <line x1={r - rim} y1={r} x2={r + rim} y2={r} className="saved-locator__axis" />
      {/* The black sun, at +Z: the top of the map. */}
      <circle cx={r} cy={7} r={4.5} className="saved-locator__sun" />
      <text x={r + 9} y={10} className="saved-locator__label">SUN</text>
      <text x={size - 4} y={size - 4} textAnchor="end" className="saved-locator__label">{chunkWords(BigInt(p.span))}</text>
      {/* You. */}
      <circle cx={r} cy={r} r={3.5} className="saved-locator__you" />
      {w.samePlane && !w.inside && (p.x !== 0 || p.y !== 0) && <line x1={r} y1={r} x2={sx} y2={sy} className="saved-locator__path" />}
      {w.samePlane && <polygon points={star(sx, sy, 7, 3)} className={`saved-locator__star${p.past ? ' is-past' : ''}`} />}
    </svg>
  )
}

function WhereItIs({ w, plane }: { w: Where | null; plane: number }): JSX.Element {
  if (!w) return <p className="saved-where__words">Not a chunk this build reads.</p>
  return (
    <div className="saved-where">
      <Locator w={w} />
      <div className="saved-where__facts">
        {!w.samePlane ? (
          <>
            <span className="saved-where__big">In {PLANE_NAME[plane === 0 ? 1 : 0]}</span>
            <span className="saved-where__line">You are in {PLANE_NAME[plane]}: switch planes to go there.</span>
          </>
        ) : w.inside ? (
          <>
            <span className="saved-where__big">You are here</span>
            <span className="saved-where__line">You are in this chunk.</span>
          </>
        ) : (
          <>
            <span className="saved-where__big">{chunkWords(w.chunks)}</span>
            <span className="saved-where__line saved-where__line--num">{gibsonWords(w.gibsons)}</span>
            <span className="saved-where__line saved-where__way"><Arrow w={w} size={14} />{w.way}</span>
            <span className="saved-where__line">{w.height}</span>
            <span className="saved-where__hint">Facing the sun</span>
          </>
        )}
      </div>
    </div>
  )
}

function ChunkView({ e, w, plane, guide }: { e: StarEntry; w: Where | null; plane: number; guide: ChunkGuide | null }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(e.n ?? '')
  const name = chunkName(e)
  const on = guide?.key === e.c ? guide : null
  const card = e.s ? cardOfSnapshot(e.s) : null
  const h = card?.hardness ?? null
  const navigate = (): void => {
    const c = parseChunkKey(e.c)
    if (!c) return
    useGoal.getState().planTo(chunkCentre(c), c.plane as Plane, name)
    closeSavedChunks()
    leaveModals()
    useToast.getState().show({ label: `Trip planned to ${name}`, meta: 'SET on the GOAL chip lines it up. Nothing moves until you go.', mark: 'goal', ms: BRIEF_TOAST_MS })
  }
  const save = (): void => { renameChunk(e.c, draft); setEditing(false) }
  return (
    <>
      <div className="saved-view__name">
        {editing ? (
          <form className="saved-rename" onSubmit={(ev) => { ev.preventDefault(); save() }}>
            <input
              className="saved-rename__input"
              value={draft}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setEditing(false) } }}
              maxLength={MAX_NOTE}
              placeholder={autoLabel(e.s)}
              aria-label={`Name for ${name}`}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              autoFocus
            />
            <button type="submit" className="saved-rename__btn" aria-label="Keep this name" title="Keep this name"><Check size={14} strokeWidth={2.5} aria-hidden /></button>
            <button type="button" className="saved-rename__btn" aria-label="Cancel renaming" title="Leave the name as it was" onClick={() => setEditing(false)}><X size={14} strokeWidth={2.5} aria-hidden /></button>
          </form>
        ) : (
          <>
            <Star size={14} strokeWidth={2.25} fill="currentColor" aria-hidden />
            <span className="saved-view__name-text">{name}</span>
          </>
        )}
      </div>
      <h3 className="survey-card__section"><span>WHERE IT IS</span><span className="survey-card__rule" aria-hidden /></h3>
      <WhereItIs w={w} plane={plane} />
      <div className="saved-actions" role="group" aria-label="Go there">
        <button type="button" className="cham-btn saved-act saved-act--go" onClick={navigate}><Navigation size={14} strokeWidth={2.25} aria-hidden />NAVIGATE</button>
        <button type="button" className={`cham-btn saved-act${on?.waypoint ? ' is-on' : ''}`} aria-pressed={!!on?.waypoint} onClick={() => setWaypoint(e.c, !on?.waypoint)}><RadioTower size={14} strokeWidth={2.25} aria-hidden />{on?.waypoint ? 'WAYPOINT ON' : 'SET WAYPOINT'}</button>
        <button type="button" className={`cham-btn saved-act${on?.hud ? ' is-on' : ''}`} aria-pressed={!!on?.hud} onClick={() => setHudTarget(e.c, !on?.hud)}><Crosshair size={14} strokeWidth={2.25} aria-hidden />{on?.hud ? 'HUD TARGET ON' : 'HUD TARGET'}</button>
        <button type="button" className="cham-btn saved-act" onClick={() => { setDraft(e.n ?? ''); setEditing(true) }} disabled={editing}><Pencil size={14} strokeWidth={2.25} aria-hidden />RENAME</button>
        <button type="button" className="cham-btn saved-act saved-act--remove" onClick={() => { unstarChunk(e.c); backToList() }}><Trash2 size={14} strokeWidth={2.25} aria-hidden />REMOVE</button>
      </div>
      <h3 className="survey-card__section"><span>SAVED CARD</span><span className="survey-card__rule" aria-hidden /></h3>
      {card ? (
        <>
          <Core strata={card.strata} />
          <div className="survey-card__facts">
            <div className="survey-card__ground">
              {card.ground ? <Chamfer size={44}><Swatch id={card.ground.rock} size={30} /></Chamfer> : <Chamfer size={44}><ScrollText size={22} strokeWidth={1.75} aria-hidden /></Chamfer>}
              <span className="survey-card__fact">
                <span className="survey-card__label">Ground type:</span>
                <span className="survey-card__value">{card.ground ? card.ground.name : 'Unknown'}</span>
              </span>
            </div>
            <span className="survey-card__stamp" aria-label={`Starred ${stampDate(e.a * 1000)}`}><span className="survey-card__stamp-word">STARRED</span><span className="survey-card__stamp-date">{stampDate(e.a * 1000)}</span></span>
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
          <p className="survey-card__tally">{tallyLine(card.minedTotal, card.total)}</p>
          <Section name="FINDS" />
          {card.finds.length > 0
            ? <ul className="survey-card__list">{card.finds.map((r) => <Row key={r.id} row={r} />)}</ul>
            : <p className="survey-card__empty">Nothing rare in this chunk.</p>}
          <Section name="COMMON MATERIALS" />
          {card.common.length > 0
            ? <ul className="survey-card__list">{card.common.map((r) => <Row key={r.id} row={r} />)}</ul>
            : <p className="survey-card__empty">Nothing here: open space.</p>}
          <p className="survey-card__foot"><span>Card as of {stampDate((e.st ?? e.a) * 1000)}.</span><span>Counted again each visit.</span></p>
        </>
      ) : <p className="survey-card__empty">This chunk's card was not counted yet. It is counted the next time you are there.</p>}
    </>
  )
}

export function SavedChunks(): JSX.Element | null {
  const open = useSavedChunksUi((s) => s.open)
  const view = useSavedChunksUi((s) => s.view)
  const entries = useStarredChunks((s) => s.entries)
  const guide = useStarredChunks((s) => s.guide)
  const removed = useStarredChunks((s) => s.removed)
  const { head, plane } = useHead()
  // Esc from a chunk's view goes back to the list; from the list, it closes.
  useModalStack(open, () => (useSavedChunksUi.getState().view ? backToList() : closeSavedChunks()))
  // Open: read the other devices' list (never a write), at most once a minute.
  useEffect(() => { if (open) nudgeStarred('panel') }, [open])
  // UNDO goes once its time is up; the removal stands.
  useEffect(() => {
    if (!removed) return
    const t = setTimeout(() => expireUndo(), Math.max(0, removed.until - Date.now()))
    return () => clearTimeout(t)
  }, [removed])
  const viewed = view ? entries.find((e) => e.c === view) ?? null : null
  // A chunk removed while it was viewed (here or on another device): back to the list.
  useEffect(() => { if (open && view && !viewed) backToList() }, [open, view, viewed])
  if (!open) return null
  const rows: Array<{ e: StarEntry; gone: boolean }> = entries.map((e) => ({ e, gone: false }))
  if (removed && !entries.some((e) => e.c === removed.entry.c)) {
    rows.push({ e: removed.entry, gone: true })
    rows.sort((p, q) => q.e.a - p.e.a || (p.e.c < q.e.c ? -1 : 1))
  }
  return (
    <Stacked>
      <div className="modal survey-modal saved-modal" role="dialog" aria-modal="true" aria-label={viewed ? `Saved chunk: ${chunkName(viewed)}` : 'Saved chunks'} onPointerDown={closeSavedChunks}>
        <div className="survey-card saved-card" onPointerDown={(ev) => ev.stopPropagation()}>
          <div className="survey-card__head">
            {viewed ? (
              <button type="button" className="saved-back" onClick={backToList} aria-label="Back to saved chunks"><ChevronLeft size={16} strokeWidth={2.25} aria-hidden />SAVED CHUNKS</button>
            ) : (
              <>
                <Star size={16} strokeWidth={2} aria-hidden />
                <h2>SAVED CHUNKS</h2>
              </>
            )}
            <ModalClose onClose={closeSavedChunks} title="Close (Esc)" />
          </div>
          <div className="survey-card__body">
            {viewed ? (
              <ChunkView key={viewed.c} e={viewed} w={whereIs(head, plane, viewed.c)} plane={plane} guide={guide} />
            ) : rows.length === 0 ? (
              <p className="saved-empty">No saved chunks yet. Open a chunk's survey card and tap its star to keep it here.</p>
            ) : (
              <ul className="saved-list">
                {rows.map(({ e, gone }) => gone
                  ? <RemovedRow key={e.c} e={e} />
                  : <ListRow key={e.c} e={e} w={whereIs(head, plane, e.c)} guide={guide} onOpen={() => useSavedChunksUi.setState({ view: e.c })} />)}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Stacked>
  )
}
