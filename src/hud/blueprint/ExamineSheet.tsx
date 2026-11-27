/**
 * ExamineSheet.tsx - EXAMINE: every clue a blueprint gives, drawn onto one
 * drafting sheet (design page craft-design/block-uses, 4.6). Deep blue paper,
 * a fine grid, cyan and white ink. The sheet is a strip of panels that scrolls
 * sideways, as long as the build needs:
 *
 * 1. title and settings: the name, the three settings in plain words, how
 *    many blocks are shown with a bar, how many are still hidden and how many
 *    a miss burns (all of them), the compass with the black sun and the
 *    maker's note in the margin;
 * 2. isometric: the build opening as an exploded view whose layers settle
 *    together (on first sight and on REPLAY; assembled under reduced motion),
 *    a compass in the corner and a +Z arrow on the floor to the black sun;
 * 3. three views: from above, from the sun and from +X, each with its compass;
 * 4. cutaway, only when the build has an inside: a section through every
 *    layer and the isometric with the front quarter cut away;
 * 5. the blocks shown, by kind, and the prize as far as it is revealed;
 * 6. the title block: a scale bar in gibsons, the name, maker, date, sheet,
 *    lock and revision.
 *
 * Nothing on it is a stored picture of the answer: every canvas draws fresh
 * from the finder's view (lib/blueprint/draw.ts). One animation loop serves
 * every canvas and draws only those on screen; it stops once nothing moves
 * (no smoke and the layers settled), and never runs under reduced motion.
 *
 * Closed by the shared ✕, a tap outside or Escape (modalStack).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, DraftingCompass, RotateCcw } from 'lucide-react'
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
import { PRIZE_VIEWS, type FinderView, type LockKind, type PrizeReveal, type PrizeView } from '../../lib/blueprint/format'
import { blockKind } from '../../lib/terrain/blocks'
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
  /** The prize as far as it is revealed: `views` holds the pictures of the views the maker chose. */
  prize: { reveal: PrizeReveal; text?: string; views: Partial<Record<PrizeView, string>>; title: string }
  lock: LockKind
  /** A location lock's region height. */
  height?: number
  /** When it was drawn, unix seconds; absent for a draft. */
  drawnAt?: number
  /** Its revision, 1 for the first. */
  revision?: number
}

/** The layers settle over this long, after a short pause, from when the isometric panel is first seen. */
const EXPLODE_DELAY_S = 0.45
const EXPLODE_S = 1.7
/** The isometric panel's drawing, in CSS pixels. */
const ISO_PX = 320
const CUT_PX = 220
const COMPASS_PX = 54

const VIEW_LABEL: Record<PrizeView, string> = { x: 'along X', y: 'along Y', z: 'along Z', iso: 'isometric' }

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

function prizeWords(reveal: PrizeReveal, n: number): string {
  const views = `${n} view${n === 1 ? '' : 's'}`
  switch (reveal) {
    case 'hidden': return 'kept secret until it is built'
    case 'description': return 'described by the maker'
    case 'silhouette': return `shown as an outline in ${views}`
    case 'render': return `shown as pictures in ${views}`
  }
}

const REVEAL_LABEL: Record<PrizeReveal, string> = { hidden: 'SECRET', description: 'DESCRIBED', silhouette: 'OUTLINE', render: 'PICTURES' }

export function ExamineSheet({ bp, onClose }: { bp: ExamineBlueprint; onClose: () => void }): JSX.Element {
  useModalStack(true, onClose)
  const reduced = useReducedMotion()
  const view = bp.view
  const [sx, sy, sz] = view.size
  const total = useMemo(() => blockCount(view), [view])
  const hidden = useMemo(() => hiddenCount(view), [view])
  const shown = total - hidden
  const hollow = useMemo(() => enclosedEmpty(view), [view])
  const inside = useMemo(() => hollow.size > 0 || buriedCells(view).size > 0, [view, hollow])
  const parts = useMemo(() => {
    const byId = new Map<number, number>()
    for (const id of view.revealed.values()) byId.set(id, (byId.get(id) ?? 0) + 1)
    return [...byId.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  }, [view])
  const prizeViews = PRIZE_VIEWS.filter((v) => bp.prize.views[v])
  const pictures = bp.prize.reveal === 'silhouette' || bp.prize.reveal === 'render'

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
    const ctx = cv.getContext('2d')
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
    drawIso(ctx, view, { x: 0, y: 0, size: ISO_PX, smokePhase: f.phase, exploded: f.exploded, floor: true })
    drawCompass(ctx, ISO_PX - 30, 30, 26, 'iso')
  }, [view])
  const paintCut = useCallback<Paint>((ctx, f) => drawIso(ctx, view, { x: 0, y: 0, size: CUT_PX, smokePhase: f.phase, cutaway: true, floor: true }), [view])

  const longest = Math.max(sx, sy, sz)
  const viewCell = Math.max(8, Math.min(26, Math.floor(150 / longest)))
  const sliceCell = Math.max(6, Math.min(17, Math.floor(110 / Math.max(sx, sz))))

  const axisCanvas = (axis: AxisView): JSX.Element => {
    const g = axisGrid(view, axis)
    const w = g.cols * viewCell, h = g.rows * viewCell
    return <AxisCanvas view={view} axis={axis} w={w} h={h} reg={reg} />
  }

  const lockWords = bp.lock === 'location' ? 'only inside its region' : 'works anywhere'
  const lockShort = bp.lock === 'location' ? `IN ITS REGION${bp.height ? ` · HEIGHT ${bp.height}` : ''}` : 'ANYWHERE'
  const rev = revisionMark(bp.revision)
  const date = dateOf(bp.drawnAt)
  const note = bp.description.trim() || (bp.prize.reveal === 'hidden' ? 'No word about the prize. Build it and see.' : '')

  return (
    <Stacked>
      <div className="modal modal--top bp-ex" role="dialog" aria-modal="true" aria-label={`Examine blueprint ${bp.name}`} onPointerDown={(e) => { e.stopPropagation(); onClose() }} onClick={(e) => e.stopPropagation()}>
        <div className="bp-ex__card" onPointerDown={(e) => e.stopPropagation()}>
          <div className="bp-ex__head">
            <span className="bp-ex__badge"><DraftingCompass size={12} strokeWidth={2.25} aria-hidden />EXAMINE</span>
            <span className="bp-ex__headname">{bp.name}</span>
            <ModalClose onClose={onClose} />
          </div>
          <div className="bp-ex__wrap" ref={wrap} onScroll={onScroll}>
            <div className="bp-ex__sheet">
              {/* 1. Title and settings */}
              <section className="bp-ex__panel bp-ex__panel--title">
                <div className="bp-ex__kicker">ONOSENDAI · BLUEPRINT</div>
                <h2 className="bp-ex__name">{bp.name}</h2>
                <dl className="bp-ex__settings">
                  <div><dt>1 · RECIPE</dt><dd>{shown} of {total} blocks shown</dd></div>
                  <div><dt>2 · PRIZE</dt><dd>{prizeWords(bp.prize.reveal, prizeViews.length)}</dd></div>
                  <div><dt>3 · LOCK</dt><dd>{lockWords}</dd></div>
                </dl>
                <div className="bp-ex__meter">
                  <div className="bp-ex__meter-l">BLOCKS SHOWN <b>{shown} / {total}</b></div>
                  <div className="bp-ex__bar"><i style={{ width: `${total ? (100 * shown) / total : 0}%` }} /></div>
                  <div className="bp-ex__meter-n">Smoke marks a block not shown yet.</div>
                  <div className="bp-ex__cost"><span>STILL HIDDEN <b>{hidden}</b></span><span>A MISS BURNS ALL <b>{total}</b></span></div>
                </div>
                <div className="bp-ex__sunrow">
                  <Compass reg={reg} orientation="iso" px={88} />
                  <p>Every view on this sheet is in world axes, each with its own compass. The black sun is +Z. The puzzle is which blocks go where, never which way the build faces.</p>
                </div>
                {note && <p className="bp-ex__note">{note}<span>~ {bp.maker}</span></p>}
                <div className="bp-ex__stamps"><div className="bp-ex__stamp"><b>REV {rev}</b><span>{bp.drawnAt ? `DRAWN ${date}` : 'DRAFT'}</span></div></div>
              </section>

              {/* 2. Isometric */}
              <section className="bp-ex__panel bp-ex__panel--iso">
                <div className="bp-ex__ph">
                  <span>ISOMETRIC</span>
                  <button type="button" className="bp-ex__replay" onClick={replay} title="Watch the layers come together again"><RotateCcw size={12} strokeWidth={2.25} aria-hidden />REPLAY</button>
                </div>
                <SheetCanvas w={ISO_PX} h={ISO_PX} paint={paintIso} reg={reg} explodes label={`Isometric model: ${shown} of ${total} blocks shown, the rest as smoke`} />
                <div className="bp-ex__foot">Y0 at the bottom · 1 block = 1 gibson · box {sx} × {sy} × {sz}</div>
              </section>

              {/* 3. Three views */}
              <section className="bp-ex__panel bp-ex__panel--ortho">
                <div className="bp-ex__ph"><span>THREE VIEWS · ONE ALONG EACH AXIS</span></div>
                <div className="bp-ex__ortho">
                  <div className="bp-ex__ov bp-ex__ov--above">
                    <div className="bp-ex__ol">FROM ABOVE <span>{sx} X × {sz} Z</span></div>
                    <div className="bp-ex__ovrow">{axisCanvas('y')}<Compass reg={reg} orientation="y" /></div>
                  </div>
                  <div className="bp-ex__ov bp-ex__ov--sun">
                    <div className="bp-ex__ol">FROM THE SUN <span>{sx} X × {sy} Y</span></div>
                    <div className="bp-ex__ovrow">{axisCanvas('z')}<Compass reg={reg} orientation="z" /></div>
                  </div>
                  <div className="bp-ex__ov bp-ex__ov--side">
                    <div className="bp-ex__ol">FROM +X <span>{sz} Z × {sy} Y</span></div>
                    <div className="bp-ex__ovrow">{axisCanvas('x')}<Compass reg={reg} orientation="x" /></div>
                  </div>
                </div>
                <div className="bp-ex__foot">Each square shows the first block met looking in: darker the deeper it sits.</div>
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
                  <div className="bp-ex__bh"><span>BLOCKS SHOWN</span><b>{shown} OF {total}</b></div>
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
                  </div>
                  <div className="bp-ex__btot">{total} BLOCKS IN ALL · BOX {sx} × {sy} × {sz}</div>
                </div>
                <div className="bp-ex__box">
                  <div className="bp-ex__bh"><span>THE PRIZE</span><b>{REVEAL_LABEL[bp.prize.reveal]}</b></div>
                  {bp.prize.reveal === 'hidden' ? (
                    <>
                      <div className="bp-ex__ptitle">{bp.name}</div>
                      <div className="bp-ex__redact" aria-hidden><i style={{ width: '86%' }} /><i style={{ width: '58%' }} /></div>
                      <p className="bp-ex__ptext bp-ex__ptext--dim">Nothing more is shown. Build it and see.</p>
                    </>
                  ) : (
                    <>
                      <div className="bp-ex__ptitle">{bp.prize.title || bp.name}</div>
                      {bp.prize.text && <p className="bp-ex__ptext">{bp.prize.text}</p>}
                      {pictures && (
                        <div className="bp-ex__frames">
                          {prizeViews.map((v) => (
                            <figure className="bp-ex__frame" key={v}>
                              <Chamfer decorative={false}><img className="bp-ex__pic" src={bp.prize.views[v]} alt={`The prize ${VIEW_LABEL[v]}`} /></Chamfer>
                              <figcaption>{VIEW_LABEL[v]}</figcaption>
                            </figure>
                          ))}
                          {prizeViews.length === 0 && <p className="bp-ex__ptext bp-ex__ptext--dim">No pictures came with this blueprint.</p>}
                        </div>
                      )}
                    </>
                  )}
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
                    <div><span>LOCK</span>{lockShort}</div>
                    <div><span>BOX</span>{sx} × {sy} × {sz}</div>
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
  const words = axis === 'y' ? 'from above' : axis === 'z' ? 'from the sun' : 'from +X'
  return <SheetCanvas w={w} h={h} paint={paint} reg={reg} label={`The build seen ${words}`} />
}

/** One layer's section, on its own canvas. */
function SliceCanvas({ view, layer, w, h, hollow, reg }: { view: FinderView; layer: number; w: number; h: number; hollow: ReadonlySet<number>; reg: Register }): JSX.Element {
  const paint = useCallback<Paint>((ctx, f) => drawSection(ctx, view, layer, { x: 0, y: 0, size: w, height: h, smokePhase: f.phase, hollow }), [view, layer, w, h, hollow])
  return <SheetCanvas w={w} h={h} paint={paint} reg={reg} label={`Layer ${layer}, seen from above`} />
}
