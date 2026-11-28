/**
 * ExamineSheet.tsx - EXAMINE: every clue a blueprint gives, drawn onto one
 * drafting sheet (design page craft-design/block-uses, 4.6). Deep blue paper,
 * a fine grid, cyan and white ink. The sheet is a strip of panels that scrolls
 * sideways, as long as the build needs:
 *
 * 1. title and summary: the ONOSENDAI logo over the name, then MATERIALS
 *    (known and unknown blocks), CONSTRUCTION (anywhere, or a specific
 *    region) and PRIZE (a mystery, hints only or public information); while
 *    any block is unknown, how many are known with a bar, how many are
 *    unknown and how many any incorrect block burns on compile (all of
 *    them); and the maker's note in the margin;
 * 2. isometric: seen from the (+X, +Y, -Z) corner, behind and to the right
 *    of a player facing the sun: +X runs down to the right, +Z up to the
 *    right, the black sun beyond the build. The build opens as an exploded
 *    view whose layers settle together (on first sight and on REPLAY;
 *    assembled under reduced motion), with a compass in the corner. Beside
 *    it on a wide screen, under it on a phone, the three views in one
 *    compact column, each row the view, its compass and its label: facing
 *    the sun (looking along +Z from the -Z side, X right, Y up, the sun
 *    behind the build), from above (+Z up, the sun at the top edge) and
 *    from +X (+Z on the right);
 * 4. cutaway, only when the build has an inside: a section through every
 *    layer and the isometric with the front quarter cut away;
 * 5. the blocks shown, by kind, and the prize as far as it is revealed:
 *    its name only when its maker chose to show it, never the blueprint's;
 * 6. the title block: a scale bar in gibsons, the name, maker, date, sheet,
 *    construction and revision.
 *
 * Nothing on it is a stored picture of the answer: every canvas draws fresh
 * from the finder's view (lib/blueprint/draw.ts). One animation loop serves
 * every canvas and draws only those on screen; it stops once nothing moves
 * (no smoke and the layers settled), and never runs under reduced motion.
 *
 * A maker examining their own blueprint gets a two-way switch over the
 * sheet: FINDER (what others see, the default) and MAKER (every block, as
 * they made it). The sheet is redrawn in place: both prize boxes are laid
 * out and the one not shown is hidden, and the parts list keeps as many
 * slots as the longer of the two, so nothing on the sheet moves.
 *
 * Closed by the shared ✕, a tap outside or Escape (modalStack).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { ChevronRight, DraftingCompass, Eye, PencilRuler, RotateCcw } from 'lucide-react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import {
  TILE_IMAGES,
  axisGrid,
  blockCount,
  buriedCells,
  drawAxisView,
  drawCompass,
  drawIso,
  drawSection,
  enclosedEmpty,
  hiddenCount,
  type AxisView,
  type CompassOrientation,
} from '../../lib/blueprint/draw'
import { PRIZE_VIEWS_SHOWN, type FinderView, type LockKind, type PrizeReveal, type PrizeView } from '../../lib/blueprint/format'
import { ITEM_ORANGE } from '../../lib/blueprint/itemMark'
import { blockKind } from '../../lib/terrain/blocks'
import { GAME_CONSTRUCTION, GAME_CONSTRUCTION_SHEET } from '../../lib/blueprint/gameCard'
import { tileUrl } from '../../lib/terrain/tiles'
import { Chamfer } from '../ui/Chamfer'
import { ModalClose } from '../ui/ModalClose'
import { Stacked, useModalStack } from '../modalStack'

/** What the sheet draws. */
export interface ExamineBlueprint {
  name: string
  /** The maker's display name. */
  maker: string
  /** The maker's note, written in the margin. */
  description: string
  view: FinderView
  /**
   * The prize as far as it is revealed: `views` holds the pictures of the
   * views the maker chose, `name` the prize's own name only when the maker
   * chose to show it (absent or null otherwise; never the blueprint's title).
   */
  prize: { reveal: PrizeReveal; text?: string; views: Partial<Record<PrizeView, string>>; name?: string | null }
  lock: LockKind
  /** A location lock's region height. */
  height?: number
  /** When it was drawn, unix seconds; absent for a draft. */
  drawnAt?: number
  /** Its revision, 1 for the first. */
  revision?: number
  /** An item blueprint (lib/blueprint/itemMark): an orange ITEM chip beside its name. */
  item?: boolean
  /** The game's own (the Compiler's or the Quarry Charge's): CONSTRUCTION says how to build it isolated. */
  game?: boolean
  /** The game's own: what PRIZE names (gamePrizeName). */
  gamePrize?: string
}

/** For a maker examining their own blueprint: the whole arrangement and the prize's real name, if it has one to give. */
export interface ExamineMaker {
  view: FinderView
  prizeName: string | null
}

/** The layers settle over this long, after a short pause, from when the isometric panel is first seen. */
const EXPLODE_DELAY_S = 0.45
const EXPLODE_S = 1.7
/** The isometric panel's drawing, in CSS pixels. */
const ISO_PX = 320
const CUT_PX = 220
const COMPASS_PX = 54
/** A view's compass in the three views' column. */
const VIEW_COMPASS_PX = 40

const VIEW_LABEL: Record<PrizeView, string> = { x: 'from +X', y: 'from above', z: 'facing the sun', iso: 'isometric' }

/** A frame of the sheet's one clock. */
interface Frame {
  /** The smoke's drift, seconds. */
  phase: number
  /** 1 apart to 0 assembled. */
  exploded: number
}
type Paint = (ctx: CanvasRenderingContext2D, f: Frame) => void
interface Entry { paint: Paint; w: number; h: number; visible: boolean; explodes: boolean }
type Register = (cv: HTMLCanvasElement, e: Omit<Entry, 'visible'> | null) => void

const easeInOutCubic = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const pxRatio = (): number => (typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1))

/** The orange ITEM chip beside an item blueprint's name, on the sheet and on its card. */
export function ItemChip(): JSX.Element {
  return <span className="bp-item-chip" style={{ '--bp-item-orange': ITEM_ORANGE } as CSSProperties} title="An item blueprint: its prize is an item, not a shard">ITEM</span>
}

/** One canvas on the sheet, drawn by the sheet's clock. */
function SheetCanvas({ w, h, paint, reg, label, explodes = false, className }: { w: number; h: number; paint: Paint; reg: Register; label: string; explodes?: boolean; className?: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const dpr = pxRatio()
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    reg(cv, { paint, w, h, explodes })
    return () => reg(cv, null)
  }, [reg, paint, w, h, explodes])
  return <canvas ref={ref} className={className} width={Math.round(w * dpr)} height={Math.round(h * dpr)} style={{ width: w, height: h }} role="img" aria-label={label} />
}

/** A compass turned to a view, on its own small canvas. */
function Compass({ reg, orientation, px = COMPASS_PX, className }: { reg: Register; orientation: CompassOrientation; px?: number; className?: string }): JSX.Element {
  const paint = useCallback<Paint>((ctx) => drawCompass(ctx, px / 2, px / 2, px / 2 - 1, orientation), [px, orientation])
  return <SheetCanvas w={px} h={px} paint={paint} reg={reg} className={className ?? 'bp-ex__compass'} label="Compass: X red, Y green, Z blue, the black sun past +Z" />
}

function revisionMark(n: number | undefined): string {
  const r = Math.max(1, Math.floor(n ?? 1))
  return r <= 26 ? String.fromCharCode(64 + r) : String(r)
}

function dateOf(s: number | undefined): string {
  if (!s) return 'Draft'
  try { return new Date(s * 1000).toISOString().slice(0, 10) } catch { return 'Draft' }
}

/** The prize setting in plain words; the number of views only when there are pictures to count. */
export function prizeWords(reveal: PrizeReveal, n: number): string {
  const views = n > 0 ? ` in ${n} view${n === 1 ? '' : 's'}` : ''
  switch (reveal) {
    case 'hidden': return 'kept secret until it is built'
    case 'description': return 'described by the maker'
    case 'silhouette': return `shown as an outline${views}`
    case 'render': return `shown as pictures${views}`
  }
}

/** MATERIALS, in the summary, the BLUEPRINTS list and the card: "5 known / 0 unknown". */
export function materialsWords(known: number, unknown: number): string {
  return `${known} known / ${unknown} unknown`
}

/** CONSTRUCTION, in the summary, the title block, the BLUEPRINTS list and the card; a game blueprint's says to build it isolated. */
export function constructionWords(lock: LockKind, height?: number, game = false): string {
  if (game) return GAME_CONSTRUCTION
  if (lock !== 'location') return 'May be built anywhere'
  return height !== undefined && Number.isFinite(height) ? `Must be built in a specific h${height} region` : 'Must be built in a specific region'
}

/** CONSTRUCTION in the title block, short: "Anywhere" or "h5 region" ("region" with no height); "Air gapped." for the game's own (owner's wording, as its card row). */
export function constructionShort(lock: LockKind, height?: number, game = false): string {
  if (game) return GAME_CONSTRUCTION
  if (lock !== 'location') return 'Anywhere'
  return height !== undefined && Number.isFinite(height) ? `h${height} region` : 'region'
}

/**
 * PRIZE in one of three short values, in the summary, the BLUEPRINTS list
 * and the card: public information when it is shown in pictures or its
 * name is shown, a mystery when it is kept secret, hints only otherwise.
 */
export function prizeShort(reveal: PrizeReveal, nameShown: boolean, gamePrize?: string): string {
  if (gamePrize) return gamePrize
  if (nameShown || reveal === 'render') return 'Public information'
  return reveal === 'hidden' ? 'A mystery' : 'Hints only'
}

/** The heading of PRIZE when its maker did not choose to show its name. */
export const MYSTERY_PRIZE = 'A mystery prize'
/** The prize heading when the prize shows but its maker kept the name back. */
export const NAME_HIDDEN = 'Name hidden'
/** What PRIZE says when it should show pictures and none came. */
export const NO_PICTURES = 'The pictures did not come with this copy.'

/** The blocks shown, by kind, most first. */
function partsOf(view: FinderView): Array<[number, number]> {
  const byId = new Map<number, number>()
  for (const id of view.revealed.values()) byId.set(id, (byId.get(id) ?? 0) + 1)
  return [...byId.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
}


export function ExamineSheet({ bp, maker, onClose }: { bp: ExamineBlueprint; maker?: ExamineMaker; onClose: () => void }): JSX.Element {
  useModalStack(true, onClose)
  const reduced = useReducedMotion()
  const [as, setAs] = useState<'finder' | 'maker'>('finder')
  const asMaker = !!maker && as === 'maker'
  // What a finder gets, whichever view is drawn: the settings and the meter always speak of it.
  const finder = bp.view
  const view = maker && asMaker ? maker.view : finder
  const [sx, sy, sz] = view.size
  const total = useMemo(() => blockCount(view), [view])
  const hidden = useMemo(() => hiddenCount(view), [view])
  const shown = total - hidden
  const finderHidden = useMemo(() => hiddenCount(finder), [finder])
  const finderShown = total - finderHidden
  // The inside is the shape's, the same in both views.
  const hollow = useMemo(() => enclosedEmpty(view), [view])
  const inside = useMemo(() => hollow.size > 0 || buriedCells(view).size > 0, [view, hollow])
  const parts = useMemo(() => partsOf(view), [view])
  // As many part slots as the longer list of the two views, so switching never moves the sheet.
  const slots = useMemo(() => {
    const f = partsOf(finder).length + (finderHidden > 0 ? 1 : 0)
    return maker ? Math.max(f, partsOf(maker.view).length + (hiddenCount(maker.view) > 0 ? 1 : 0)) : f
  }, [finder, finderHidden, maker])
  const pad = Math.max(0, slots - parts.length - (hidden > 0 ? 1 : 0))
  const prizeViews = PRIZE_VIEWS_SHOWN.filter((v) => bp.prize.views[v])
  const pictures = bp.prize.reveal === 'silhouette' || bp.prize.reveal === 'render'
  const prizeName = bp.prize.name?.trim() || null

  /* ---------- the one clock ---------- */
  const entries = useRef(new Map<HTMLCanvasElement, Entry>())
  const start = useRef<number | null>(null)
  const raf = useRef(0)
  const io = useRef<IntersectionObserver | null>(null)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const smoky = hidden > 0

  const frameAt = (now: number): Frame => {
    if (reducedRef.current) return { phase: 0, exploded: 0 }
    if (start.current === null) return { phase: now / 1000, exploded: 1 }
    const p = Math.min(1, Math.max(0, ((now - start.current) / 1000 - EXPLODE_DELAY_S) / EXPLODE_S))
    return { phase: now / 1000, exploded: 1 - easeInOutCubic(p) }
  }
  const paintOne = (cv: HTMLCanvasElement, e: Entry, f: Frame): void => {
    const ctx = typeof cv.getContext === 'function' ? cv.getContext('2d') : null
    if (!ctx) return
    const dpr = cv.width / e.w
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, e.w, e.h)
    e.paint(ctx, f)
  }
  const paintAll = (now: number, onlyVisible: boolean): void => {
    const f = frameAt(now)
    for (const [cv, e] of entries.current) if (!onlyVisible || e.visible) paintOne(cv, e, f)
  }
  const moving = (now: number): boolean => {
    if (reducedRef.current) return false
    const settling = start.current === null || (now - start.current) / 1000 < EXPLODE_DELAY_S + EXPLODE_S + 0.1
    return smoky || settling
  }
  const run = (): void => {
    if (raf.current || reducedRef.current || typeof requestAnimationFrame === 'undefined') return
    const tick = (now: number): void => {
      raf.current = 0
      let any = false
      for (const e of entries.current.values()) if (e.visible) { any = true; break }
      if (!any) return
      paintAll(now, true)
      if (moving(now)) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
  }
  const runRef = useRef(run)
  runRef.current = run
  const paintAllRef = useRef(paintAll)
  paintAllRef.current = paintAll

  const reg = useCallback<Register>((cv, e) => {
    if (!e) { entries.current.delete(cv); io.current?.unobserve(cv); return }
    const had = entries.current.get(cv)
    const entry: Entry = { ...e, visible: had?.visible ?? !io.current }
    entries.current.set(cv, entry)
    io.current?.observe(cv)
    paintOne(cv, entry, frameAt(performance.now()))
  }, [])

  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver((es) => {
      const now = performance.now()
      for (const en of es) {
        const e = entries.current.get(en.target as HTMLCanvasElement)
        if (!e) continue
        e.visible = en.isIntersecting
        // The layers start to settle once the isometric drawing is well in sight.
        if (e.explodes && start.current === null && en.intersectionRatio >= 0.5) start.current = now
      }
      runRef.current()
    }, { root: wrap.current, threshold: [0, 0.5] })
    io.current = obs
    for (const cv of entries.current.keys()) obs.observe(cv)
    return () => { obs.disconnect(); io.current = null }
  }, [])

  // Without an observer, every canvas counts as seen and the layers settle from the start.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' && start.current === null) start.current = performance.now()
    paintAllRef.current(performance.now(), false)
    runRef.current()
    return TILE_IMAGES.onLoad(() => { paintAllRef.current(performance.now(), false); runRef.current() })
  }, [reduced, view])

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current) }, [])

  const replay = (): void => {
    start.current = performance.now()
    if (reducedRef.current) paintAll(start.current, false)
    else runRef.current()
  }

  /* ---------- the scroll hint, on touch screens until the first swipe ---------- */
  const [hint, setHint] = useState(() => {
    try { return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches } catch { return false }
  })
  const onScroll = (): void => { if (hint) setHint(false) }

  /* ---------- the drawings ---------- */
  const paintIso = useCallback<Paint>((ctx, f) => {
    // The compass in the top-left corner, opposite the black sun (up and to the right); the drawing keeps clear of it.
    drawIso(ctx, view, { x: 0, y: 0, size: ISO_PX, smokePhase: f.phase, exploded: f.exploded, floor: true, compass: 24 })
    const pad = Math.max(1, ISO_PX * 0.05)
    drawCompass(ctx, pad + 24, pad + 24, 24, 'iso')
  }, [view])
  const paintCut = useCallback<Paint>((ctx, f) => drawIso(ctx, view, { x: 0, y: 0, size: CUT_PX, smokePhase: f.phase, cutaway: true, floor: true }), [view])

  const longest = Math.max(sx, sy, sz)
  // The three views share one cell size, kept small so the column stays compact.
  const viewCell = Math.max(6, Math.min(22, Math.floor(120 / longest)))
  const sliceCell = Math.max(6, Math.min(17, Math.floor(110 / Math.max(sx, sz))))

  // The views' sizes come from the shape alone, the same in FINDER and MAKER, so switching moves nothing.
  const axisSize = (axis: AxisView): { w: number; h: number } => {
    const g = axisGrid(view, axis)
    return { w: g.cols * viewCell, h: g.rows * viewCell }
  }
  const viewsCol = Math.max(...(['z', 'y', 'x'] as const).map((a) => axisSize(a).w))
  const axisRows: Array<{ axis: AxisView; name: string; dims: string; caption: string }> = [
    { axis: 'z', name: 'FACING THE SUN', dims: `${sx} X × ${sy} Y`, caption: 'X right · Y up · the sun behind the build' },
    { axis: 'y', name: 'FROM ABOVE', dims: `${sx} X × ${sz} Z`, caption: '+Z up · the sun at the top edge' },
    { axis: 'x', name: 'FROM +X', dims: `${sz} Z × ${sy} Y`, caption: '+Z on the right · Y up' },
  ]

  const construction = constructionWords(bp.lock, bp.height, bp.game)
  const rev = revisionMark(bp.revision)
  const date = dateOf(bp.drawnAt)
  const note = bp.description.trim() || (bp.prize.reveal === 'hidden' ? 'No word about the prize. Build it and see.' : '')

  const frames = (
    <div className="bp-ex__frames">
      {prizeViews.map((v) => (
        <figure className="bp-ex__frame" key={v}>
          <Chamfer decorative={false}><img className="bp-ex__pic" src={bp.prize.views[v]} alt={`The prize ${VIEW_LABEL[v]}`} /></Chamfer>
          <figcaption>{VIEW_LABEL[v]}</figcaption>
        </figure>
      ))}
    </div>
  )
  // PRIZE as a finder gets it: its name only when the maker chose to show it. "Mystery" only when the prize is kept
  // secret (the PRIZE value says "A mystery" then); otherwise a hidden name says just that.
  const finderPrize = bp.prize.reveal === 'hidden' ? (
    <>
      <div className="bp-ex__ptitle">{prizeName ?? MYSTERY_PRIZE}</div>
      <div className="bp-ex__redact" aria-hidden><i style={{ width: '86%' }} /><i style={{ width: '58%' }} /></div>
      <p className="bp-ex__ptext bp-ex__ptext--dim">Nothing more is shown. Build it and see.</p>
    </>
  ) : (
    <>
      <div className={`bp-ex__ptitle${prizeName ? '' : ' bp-ex__ptitle--hidden'}`}>{prizeName ?? NAME_HIDDEN}</div>
      {bp.prize.text && <p className="bp-ex__ptext">{bp.prize.text}</p>}
      {pictures && (prizeViews.length > 0 ? frames : <p className="bp-ex__ptext bp-ex__ptext--dim">{NO_PICTURES}</p>)}
    </>
  )
  // PRIZE as its maker knows it.
  const makerPrize = maker && (
    <>
      <div className="bp-ex__ptitle">{maker.prizeName?.trim() || 'Your prize'}</div>
      <p className="bp-ex__ptext bp-ex__ptext--dim">Finders see it {prizeWords(bp.prize.reveal, prizeViews.length)}.</p>
      {bp.prize.text && <p className="bp-ex__ptext">{bp.prize.text}</p>}
      {prizeViews.length > 0 && frames}
    </>
  )

  return (
    <Stacked>
      <div className="modal modal--top bp-ex" role="dialog" aria-modal="true" aria-label={`Examine blueprint ${bp.name}`} data-as={asMaker ? 'maker' : 'finder'} data-shown={shown} onPointerDown={(e) => { e.stopPropagation(); onClose() }} onClick={(e) => e.stopPropagation()}>
        <div className="bp-ex__card" onPointerDown={(e) => e.stopPropagation()}>
          <div className="bp-ex__head">
            <span className="bp-ex__badge"><DraftingCompass size={12} strokeWidth={2.25} aria-hidden />EXAMINE</span>
            <span className="bp-ex__headname">{bp.name}</span>
            <ModalClose onClose={onClose} />
          </div>
          {maker && (
            <div className="bp-ex__as" role="radiogroup" aria-label="Whose view the sheet shows">
              <button type="button" role="radio" aria-checked={!asMaker} className={`bp-ex__asbtn${asMaker ? '' : ' is-on'}`} onClick={() => setAs('finder')} title="The sheet exactly as a finder gets it"><Eye size={13} strokeWidth={2.25} aria-hidden /><b>FINDER:</b> what others see</button>
              <button type="button" role="radio" aria-checked={asMaker} className={`bp-ex__asbtn${asMaker ? ' is-on' : ''}`} onClick={() => setAs('maker')} title="Every block and the prize, as you made it"><PencilRuler size={13} strokeWidth={2.25} aria-hidden /><b>MAKER:</b> everything</button>
            </div>
          )}
          <div className="bp-ex__wrap" ref={wrap} onScroll={onScroll}>
            <div className={`bp-ex__sheet${asMaker ? ' bp-ex__sheet--maker' : ''}`} data-mark={asMaker ? "MAKER'S VIEW · EVERY BLOCK" : undefined}>
              {/* 1. Title and settings */}
              <section className="bp-ex__panel bp-ex__panel--title">
                <div className="bp-ex__kicker">
                  {/* The app's own wordmark (public/logo.png, as the menu shows it); its size is reserved before it loads. */}
                  <img className="bp-ex__wordmark" src="/logo.png" alt="ONOSENDAI" width={1969} height={354} decoding="async" />
                  <span>{asMaker ? "MAKER'S VIEW" : 'BLUEPRINT'}</span>
                </div>
                <div className="bp-ex__titlerow">
                  <h2 className="bp-ex__name">{bp.name}</h2>
                  {bp.item && <ItemChip />}
                </div>
                <dl className="bp-ex__settings">
                  <div><dt>MATERIALS</dt><dd>{materialsWords(finderShown, finderHidden)}</dd></div>
                  <div><dt>CONSTRUCTION</dt><dd>{bp.game ? GAME_CONSTRUCTION_SHEET : construction}</dd></div>
                  <div><dt>PRIZE</dt><dd>{prizeShort(bp.prize.reveal, !!prizeName, bp.gamePrize)}</dd></div>
                </dl>
                {/* Only while something is unknown to a finder: the same in FINDER and MAKER, so switching moves nothing. */}
                {finderHidden > 0 && (
                  <div className="bp-ex__meter">
                    <div className="bp-ex__meter-l">{maker ? 'FINDERS SEE' : 'KNOWN MATERIALS'} <b>{finderShown} / {total}</b></div>
                    <div className="bp-ex__bar"><i style={{ width: `${total ? (100 * finderShown) / total : 0}%` }} /></div>
                    <div className="bp-ex__meter-n">{asMaker ? 'You see every block, as you made it.' : 'Smoke marks a block not shown yet.'}</div>
                    <div className="bp-ex__cost"><span>UNKNOWN <b>{finderHidden}</b></span><span>ANY INCORRECT BLOCK BURNS ALL <b>{total}</b> ON COMPILE</span></div>
                  </div>
                )}
                {note && <p className="bp-ex__note">{note}<span>~ {bp.maker}</span></p>}
                <div className="bp-ex__stamps"><div className="bp-ex__stamp"><b>REV {rev}</b><span>{bp.drawnAt ? `DRAWN ${date}` : 'DRAFT'}</span></div></div>
              </section>

              {/* 2. Isometric, and the three views in a column beside it (under it on a phone) */}
              <section className="bp-ex__panel bp-ex__panel--iso">
                <div className="bp-ex__isocol">
                  <div className="bp-ex__ph">
                    <span>ISOMETRIC VIEW</span>
                    <button type="button" className="bp-ex__replay" onClick={replay} title="Watch the layers come together again"><RotateCcw size={12} strokeWidth={2.25} aria-hidden />REPLAY</button>
                  </div>
                  <SheetCanvas w={ISO_PX} h={ISO_PX} paint={paintIso} reg={reg} explodes className="bp-ex__isocv" label={`${asMaker ? `Isometric model: all ${total} blocks, as you made it` : `Isometric model: ${shown} of ${total} blocks shown, the rest as smoke`}. Seen from behind and to the right of a player facing the sun: +X runs down to the right, +Z up to the right, the black sun beyond the build`} />
                  <div className="bp-ex__foot">1 block = 1 gibson · volume {sx} × {sy} × {sz}</div>
                </div>
                <div className="bp-ex__views" style={{ '--bp-vw': `${viewsCol}px` } as CSSProperties}>
                  <div className="bp-ex__ph"><span>THREE VIEWS · ONE ALONG EACH AXIS</span></div>
                  {axisRows.map((r) => {
                    const { w, h } = axisSize(r.axis)
                    return (
                      <div className={`bp-ex__vrow bp-ex__vrow--${r.axis}`} key={r.axis}>
                        <div className="bp-ex__vpic"><AxisCanvas view={view} axis={r.axis} w={w} h={h} reg={reg} /></div>
                        <Compass reg={reg} orientation={r.axis} px={VIEW_COMPASS_PX} />
                        <div className="bp-ex__vl">
                          <b>{r.name}</b>
                          <span className="bp-ex__vdims">{r.dims}</span>
                          <span className="bp-ex__oh">{r.caption}</span>
                        </div>
                      </div>
                    )
                  })}
                  <div className="bp-ex__foot">Each square shows the first block met looking in: darker the deeper it sits.</div>
                </div>
              </section>

              {/* 4. Cutaway, only when there is an inside */}
              {inside && (
                <section className="bp-ex__panel bp-ex__panel--cut">
                  <div className="bp-ex__ph"><span>CUTAWAY · THE INSIDE</span></div>
                  <div className="bp-ex__slices">
                    {Array.from({ length: sy }, (_, y) => (
                      <div className="bp-ex__slice" key={y}>
                        <SliceCanvas view={view} layer={y} w={sx * sliceCell} h={sz * sliceCell} hollow={hollow} reg={reg} />
                        <span>LAYER Y{y}</span>
                      </div>
                    ))}
                    <Compass reg={reg} orientation="y" px={46} />
                  </div>
                  <div className="bp-ex__cutiso">
                    <SheetCanvas w={CUT_PX} h={CUT_PX} paint={paintCut} reg={reg} label="The model with its front quarter cut away" />
                    <span>FRONT QUARTER CUT AWAY</span>
                  </div>
                  {hollow.size > 0 && <div className="bp-ex__foot"><i className="bp-ex__hollow" aria-hidden />A hollow sealed inside the build: {hollow.size} empty cell{hollow.size === 1 ? '' : 's'}.</div>}
                </section>
              )}

              {/* 5. The blocks shown, and the prize */}
              <section className="bp-ex__panel bp-ex__panel--bom">
                <div className="bp-ex__box">
                  <div className="bp-ex__bh"><span>{asMaker ? 'EVERY BLOCK' : 'KNOWN MATERIALS'}</span><b>{shown} OF {total}</b></div>
                  <div className="bp-ex__parts">
                    {parts.map(([id, n]) => {
                      const kind = blockKind(id)
                      if (!kind) return null
                      return (
                        <div className="bp-ex__part" key={id}>
                          <Chamfer><img className="bp-ex__tile" src={tileUrl(kind, 1)} alt="" /></Chamfer>
                          <span className="bp-ex__pname">{kind.name}</span>
                          <span className="bp-ex__pcount">× {n}</span>
                        </div>
                      )
                    })}
                    {hidden > 0 && (
                      <div className="bp-ex__part">
                        <Chamfer><span className="bp-ex__smoke" /></Chamfer>
                        <span className="bp-ex__pname">Still hidden</span>
                        <span className="bp-ex__pcount">× {hidden}</span>
                      </div>
                    )}
                    {Array.from({ length: pad }, (_, i) => (
                      <div className="bp-ex__part bp-ex__part--pad" key={`pad-${i}`} aria-hidden>
                        <Chamfer><span className="bp-ex__smoke" /></Chamfer>
                        <span className="bp-ex__pname">&nbsp;</span>
                        <span className="bp-ex__pcount">&nbsp;</span>
                      </div>
                    ))}
                  </div>
                  <div className="bp-ex__btot">{total} BLOCKS IN ALL · VOLUME {sx} × {sy} × {sz}</div>
                </div>
                <div className="bp-ex__box">
                  <div className="bp-ex__bh"><span>PRIZE</span><b>{prizeShort(bp.prize.reveal, !!prizeName, bp.gamePrize)}</b></div>
                  {makerPrize ? (
                    // Both laid out in one cell, the one not shown hidden, so the box keeps its height.
                    <div className="bp-ex__pstack">
                      <div className={asMaker ? 'is-off' : undefined} aria-hidden={asMaker || undefined}>{finderPrize}</div>
                      <div className={asMaker ? undefined : 'is-off'} aria-hidden={!asMaker || undefined}>{makerPrize}</div>
                    </div>
                  ) : finderPrize}
                </div>
              </section>

              {/* 6. Title block */}
              <section className="bp-ex__panel bp-ex__panel--tb">
                <div className="bp-ex__scale" aria-label="Scale: 1 block is 1 gibson">
                  <div className="bp-ex__sbar"><i /><i /><i /><i /><i /></div>
                  <div className="bp-ex__snum"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
                  <div className="bp-ex__sl">GIBSONS · 1 BLOCK = 1 GIBSON</div>
                </div>
                <div className="bp-ex__tblock">
                  <div className="bp-ex__tbtitle">
                    <span>TITLE</span><b>{bp.name}</b>
                    <svg viewBox="0 0 26 28" className="bp-ex__logo" aria-hidden><path d="M13 1L25 7V21L13 27L1 21V7Z M1 7L13 13L25 7M13 13V27" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
                  </div>
                  <div className="bp-ex__tbgrid">
                    <div><span>DRAWN BY</span>{bp.maker}</div>
                    <div><span>DATE</span>{date}</div>
                    <div><span>SHEET</span>1 OF 1</div>
                    <div><span>CONSTRUCTION</span>{constructionShort(bp.lock, bp.height, bp.game)}</div>
                    <div><span>VOLUME</span>{sx} × {sy} × {sz}</div>
                    <div><span>REVISION</span>{rev}</div>
                  </div>
                </div>
              </section>
            </div>
          </div>
          {hint && <div className="bp-ex__hint" aria-hidden><ChevronRight size={18} strokeWidth={2.25} /></div>}
        </div>
      </div>
    </Stacked>
  )
}

/** A view along an axis, on its own canvas. */
function AxisCanvas({ view, axis, w, h, reg }: { view: FinderView; axis: AxisView; w: number; h: number; reg: Register }): JSX.Element {
  const paint = useCallback<Paint>((ctx, f) => drawAxisView(ctx, view, axis, { x: 0, y: 0, size: w, height: h, smokePhase: f.phase }), [view, axis, w, h])
  const words = axis === 'y' ? 'from above, +Z up and the sun at the top edge' : axis === 'z' ? 'facing the sun, X right and Y up, the sun behind the build' : 'from +X, +Z on the right and Y up'
  return <SheetCanvas w={w} h={h} paint={paint} reg={reg} label={`The build seen ${words}`} />
}

/** One layer's section, on its own canvas. */
function SliceCanvas({ view, layer, w, h, hollow, reg }: { view: FinderView; layer: number; w: number; h: number; hollow: ReadonlySet<number>; reg: Register }): JSX.Element {
  const paint = useCallback<Paint>((ctx, f) => drawSection(ctx, view, layer, { x: 0, y: 0, size: w, height: h, smokePhase: f.phase, hollow }), [view, layer, w, h, hollow])
  return <SheetCanvas w={w} h={h} paint={paint} reg={reg} label={`Layer ${layer}, seen from above`} />
}
