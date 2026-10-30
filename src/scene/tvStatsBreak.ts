/**
 * tvStatsBreak.ts: how the CYBERSPACE STATS break (lib/tv/cyberspaceStats) is
 * laid out and drawn on the tube, in the spot's family (scene/tvPainter
 * commercial): a ground and speed stripes in one of the spot's three themes,
 * cards slamming in, rows decoding in from scrambled glyphs (lib/decode, the
 * AskBubble and KeyFoundChip effect), a #1 splash in the NOW AVAILABLE!
 * family, and the #1's avatar turning (hud/TvSegments TvSpinHost), or the red
 * avatar cube when they have none (design 4.2 to 4.4).
 *
 * Landscape (design 4.3): the title, then the turning avatar, in the left
 * third; the rows on the right. Stacked, on the upright stream (layout=portrait,
 * lib/tv/broadcast isPortraitBroadcast) and on any frame taller than wide or
 * narrow (a phone), never side by side (design 4.4): the title on top, the
 * #1 with its avatar in the upper half, rows 2 to 5 under a rule; names are
 * cut to fit before numbers ever are.
 *
 * The painter (scene/tvPainter) draws the ground, the tag, the address and
 * the marquee round it, as it does round a spot; what is here is the board.
 */

import { decodeText, easeOutCubic, seedOf } from '../lib/decode'
import { BEATS, STATS_TAG, asOfWords, rowStart, statNumber, type StatsBoard, type WeekCount } from '../lib/tv/cyberspaceStats'

/** A rectangle, canvas px, by its corners. */
export interface Box { x0: number; y0: number; x1: number; y1: number }

/** What the board needs of the painter: its canvas, its type, and its own pieces. */
export interface BreakKit {
  ctx: CanvasRenderingContext2D
  font: string
  fit: (text: string, max: number) => string
  wrap: (text: string, max: number) => string[]
  /** The #1 splash, landing at `t` seconds (tvPainter splash). */
  splash: (cx: number, cy: number, r: number, t: number) => void
  /** Name the part about to be drawn (drawTracker). */
  part: (name: string) => void
}

/** Where the board may draw, canvas px, and how. */
export interface BreakFrame {
  /** The room between the tag's band and the marquee, the margins in. */
  area: Box
  /** Canvas px per CSS px, the stream's text size in it (tvPainter's s). */
  s: number
  /** Canvas px per CSS px alone, without the stream's text size: for a size that must read on any screen. Taken as s when not given. */
  css?: number
  /** Stacked, as the upright stream and a phone are (design 4.4). */
  stacked: boolean
  /** The card's accent (tvPainter AD_THEMES). */
  accent: string
}

/** What the board draws people with. */
export interface BreakPeople {
  name: (pubkey: string) => string
  /** The #1's avatar, turning (TvSpinHost), or null for the red cube. */
  spin: CanvasImageSource | null
}

const FG = '#f2fbff'
const DIM = 'rgba(242, 251, 255, 0.7)'
/** Every avatar's red (scene/Avatar.tsx; tvPainter AVATAR_RED). */
const AVATAR_RED = '#ff2323'
/** How long a row takes to decode in, s (lib/decode TEXT_DECODE_MS). */
const DECODE_S = 1.4
/** How long a card takes to slam in, s, and to fade out (tvPainter commercial). */
const SLAM_S = 0.22
const FADE_S = 0.15

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const w = (b: Box): number => b.x1 - b.x0
const h = (b: Box): number => b.y1 - b.y0

/** The layout of a ranking: its title's box, the #1's avatar stage (square), and each row's box, the #1 first. */
export interface RankLayout {
  title: Box
  hero: Box
  rows: Box[]
}

/** A ranking's layout in `f`'s area, for `n` rows (design 4.3, 4.4). */
export function rankLayout(f: BreakFrame, n: number): RankLayout {
  const a = f.area
  const s = f.s
  if (!f.stacked) {
    const leftW = w(a) * 0.34
    const title: Box = { x0: a.x0, y0: a.y0, x1: a.x0 + leftW, y1: a.y0 + h(a) * 0.3 }
    const stage = Math.min(leftW * 0.78, h(a) * 0.6)
    const hero: Box = { x0: a.x0 + (leftW - stage) / 2, y0: title.y1 + (a.y1 - title.y1 - stage) / 2, x1: a.x0 + (leftW + stage) / 2, y1: title.y1 + (a.y1 - title.y1 + stage) / 2 }
    const listX = a.x0 + leftW + 24 * s
    const rowH = Math.min(h(a) / Math.max(1, n), 130 * s)
    const top = a.y0 + (h(a) - rowH * n) / 2
    return { title, hero, rows: Array.from({ length: n }, (_, i) => ({ x0: listX, y0: top + i * rowH + 4 * s, x1: a.x1, y1: top + (i + 1) * rowH - 4 * s })) }
  }
  const title: Box = { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y0 + h(a) * 0.14 }
  const stage = Math.min(w(a) * 0.5, h(a) * 0.28)
  const hero: Box = { x0: a.x0 + (w(a) - stage) / 2, y0: title.y1 + 8 * s, x1: a.x0 + (w(a) + stage) / 2, y1: title.y1 + 8 * s + stage }
  const firstH = Math.min(h(a) * 0.1, 120 * s)
  const first: Box = { x0: a.x0, y0: hero.y1 + 10 * s, x1: a.x1, y1: hero.y1 + 10 * s + firstH }
  const restTop = first.y1 + 18 * s
  const restH = Math.min((a.y1 - restTop) / Math.max(1, n - 1), firstH * 0.85)
  const rest = Array.from({ length: n - 1 }, (_, i): Box => ({ x0: a.x0, y0: restTop + i * restH + 3 * s, x1: a.x1, y1: restTop + (i + 1) * restH - 3 * s }))
  return { title, hero, rows: [first, ...rest] }
}

/** The largest size, at most `max`, at which every line fits `width`, and the lines fit `height` at `lead` a line. */
function fitSize(k: BreakKit, lines: string[], width: number, height: number, max: number, lead = 1.12): number {
  let size = max
  k.ctx.font = `700 ${size}px ${k.font}`
  const widest = Math.max(1, ...lines.map((l) => k.ctx.measureText(l).width))
  if (widest > width) size *= width / widest
  return Math.min(size, height / (lines.length * lead))
}

/** A title as one line or, where two give it larger type, split in two at a space. */
function titleLines(k: BreakKit, title: string, width: number, height: number, max: number): { lines: string[]; size: number } {
  const one = { lines: [title], size: fitSize(k, [title], width, height, max) }
  const words = title.split(' ')
  if (words.length < 2) return one
  let best = one
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    const size = fitSize(k, lines, width, height, max)
    if (size > best.size * 1.15) best = { lines, size }
  }
  return best
}

/**
 * A card slamming in, the spot's way: big then down to size with a jolt as it
 * lands, a quick fade out. Its lead in the card's accent, its second line
 * under it, smaller.
 */
function slam(k: BreakKit, f: BreakFrame, lead: string, second: string, tc: number, left: number, reduced: boolean, leadAccent: boolean): void {
  const ctx = k.ctx
  const s = f.s
  const a = f.area
  // Stacked, the title takes two lines where that makes it larger (design 4.4: LONGEST / CHAIN).
  const big = titleLines(k, lead, w(a) - 20 * s, h(a) * (f.stacked ? 0.4 : 0.55), (f.stacked ? 140 : 110) * s)
  const subSize = Math.max(14 * s, big.size * 0.32)
  ctx.font = `700 ${subSize}px ${k.font}`
  const sub = k.wrap(second, w(a) - 20 * s)
  const blockH = big.lines.length * big.size * 1.12 + 18 * s + sub.length * subSize * 1.3
  const kk = reduced ? 1 : clamp01(tc / SLAM_S)
  const zoom = 1 + 0.35 * (1 - kk) * (1 - kk)
  const jolt = reduced || tc <= SLAM_S ? 0 : Math.sin(tc * 70) * 4 * s * (1 - clamp01((tc - SLAM_S) / 0.2))
  ctx.save()
  ctx.globalAlpha *= (reduced ? 1 : clamp01(tc / 0.1)) * (reduced ? 1 : clamp01(left / FADE_S))
  ctx.translate((a.x0 + a.x1) / 2 + jolt, (a.y0 + a.y1) / 2)
  ctx.scale(zoom, zoom)
  ctx.textAlign = 'center'
  let y = -blockH / 2
  ctx.font = `700 ${big.size}px ${k.font}`
  for (const line of big.lines) {
    y += big.size * 1.12
    ctx.fillStyle = leadAccent ? f.accent : FG
    ctx.shadowColor = leadAccent ? f.accent : 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = (leadAccent ? 18 : 10) * s
    ctx.fillText(line, 0, y - big.size * 0.18)
  }
  y += 18 * s
  ctx.font = `700 ${subSize}px ${k.font}`
  for (const line of sub) {
    y += subSize * 1.3
    ctx.fillStyle = leadAccent ? FG : f.accent
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
    ctx.shadowBlur = 8 * s
    ctx.fillText(line, 0, y - subSize * 0.2)
  }
  ctx.restore()
}

/** The board's title and qualifier, small, once its rows are up: left-aligned in the left third, or centred on top when stacked. */
function header(k: BreakKit, f: BreakFrame, box: Box, board: StatsBoard, alpha: number): void {
  const ctx = k.ctx
  const s = f.s
  ctx.save()
  ctx.globalAlpha *= alpha
  const centre = f.stacked
  ctx.textAlign = centre ? 'center' : 'left'
  const x = centre ? (box.x0 + box.x1) / 2 : box.x0
  const t = titleLines(k, board.title, w(box), h(box) * 0.62, (centre ? 44 : 56) * s)
  const qSize = Math.max(12 * s, t.size * 0.34)
  ctx.font = `700 ${t.size}px ${k.font}`
  ctx.fillStyle = FG
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
  ctx.shadowBlur = 8 * s
  let y = box.y0
  for (const line of t.lines) { y += t.size * 1.1; ctx.fillText(line, x, y - t.size * 0.18) }
  ctx.font = `700 ${qSize}px ${k.font}`
  ctx.fillStyle = f.accent
  for (const line of k.wrap(board.qualifier, w(box)).slice(0, 2)) { y += qSize * 1.35; ctx.fillText(line, x, y) }
  ctx.restore()
}

/** One row: its rank, the name cut to fit, the number whole; decoding in over `p` 0 to 1, landing from large when it is the #1. */
function row(k: BreakKit, f: BreakFrame, box: Box, rank: number, pubkey: string, name: string, value: number, p: number, frame: number, first: boolean): void {
  const ctx = k.ctx
  const s = f.s
  if (p <= 0) return
  ctx.save()
  ctx.globalAlpha *= clamp01(p * 4)
  // The bar under it: the #1's ringed in the accent.
  ctx.fillStyle = first ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.45)'
  ctx.fillRect(box.x0, box.y0, w(box), h(box))
  if (first) {
    ctx.strokeStyle = f.accent
    ctx.lineWidth = Math.max(1, 2 * s)
    ctx.strokeRect(box.x0 + 1, box.y0 + 1, w(box) - 2, h(box) - 2)
  }
  const pad = 14 * s
  const size = Math.min(h(box) * 0.5, (first ? 52 : 40) * s)
  ctx.font = `700 ${size}px ${k.font}`
  const base = (box.y0 + box.y1) / 2 + size * 0.36
  const number = statNumber(value)
  const numW = ctx.measureText(number).width
  const rankW = ctx.measureText('8 ').width
  ctx.textAlign = 'left'
  ctx.fillStyle = f.accent
  ctx.fillText(String(rank), box.x0 + pad, base)
  // Names give way first; the number never does (design 4.4).
  const room = Math.max(size, w(box) - 2 * pad - rankW - numW - 20 * s)
  const fitted = k.fit(name, room)
  const seed = seedOf(pubkey)
  ctx.fillStyle = FG
  ctx.fillText(p >= 1 ? fitted : decodeText(fitted, p, seed, frame), box.x0 + pad + rankW, base)
  ctx.textAlign = 'right'
  ctx.fillStyle = first ? f.accent : FG
  ctx.fillText(p >= 1 ? number : decodeText(number, p, seed + 1, frame), box.x1 - pad, base)
  ctx.restore()
}

/** The red avatar cube, turning: for a #1 with no avatar of their own. */
function redCube(ctx: CanvasRenderingContext2D, b: Box, t: number, s: number): void {
  const size = w(b)
  const turn = t * 0.9
  const tilt = -0.42
  const V: Array<[number, number, number]> = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
  const E: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
  const F = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]
  const pts = V.map(([x, y, z]) => {
    const x1 = x * Math.cos(turn) + z * Math.sin(turn)
    const z1 = -x * Math.sin(turn) + z * Math.cos(turn)
    const y2 = y * Math.cos(tilt) - z1 * Math.sin(tilt)
    const z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt)
    const k = 4 / (4 + z2)
    return { x: b.x0 + size / 2 + x1 * size * 0.27 * k, y: b.y0 + size / 2 - y2 * size * 0.27 * k }
  })
  ctx.save()
  ctx.fillStyle = AVATAR_RED
  ctx.strokeStyle = AVATAR_RED
  ctx.lineJoin = 'round'
  for (const face of F) {
    ctx.globalAlpha = 0.22
    ctx.beginPath()
    face.forEach((n, j) => (j === 0 ? ctx.moveTo(pts[n].x, pts[n].y) : ctx.lineTo(pts[n].x, pts[n].y)))
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalAlpha = 0.95
  ctx.lineWidth = 2.5 * s
  ctx.beginPath()
  for (const [i, j] of E) { ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y) }
  ctx.stroke()
  ctx.restore()
}

/** The #1's avatar on its stage, slamming in at `t` 0, with the #1 splash at its right, halfway down: clear of the title over it. */
function hero(k: BreakKit, f: BreakFrame, b: Box, spin: CanvasImageSource | null, t: number, reduced: boolean): void {
  if (t < 0) return
  const ctx = k.ctx
  const kk = reduced ? 1 : clamp01(t / SLAM_S)
  const zoom = 1 + 0.3 * (1 - kk) * (1 - kk)
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  ctx.save()
  ctx.globalAlpha *= reduced ? 1 : clamp01(t / 0.1)
  ctx.translate(cx, cy)
  ctx.scale(zoom, zoom)
  ctx.translate(-cx, -cy)
  if (spin) ctx.drawImage(spin, b.x0, b.y0, w(b), h(b))
  else redCube(ctx, b, t, f.s)
  ctx.restore()
  // Never so small its #1 cannot be read: at least SPLASH_MIN_PX across the middle (review of #537, a phone).
  k.splash(b.x1 - w(b) * 0.04, b.y0 + h(b) * 0.5, Math.max(w(b) * 0.2, SPLASH_MIN_PX * (f.css ?? f.s)), t)
}

/** A count, large, and LAST WEEK under it: counting up from nothing as it comes in. */
function bigCount(k: BreakKit, f: BreakFrame, b: Box, label: string | null, c: WeekCount, p: number): void {
  const ctx = k.ctx
  const s = f.s
  if (p <= 0) return
  ctx.save()
  ctx.globalAlpha *= clamp01(p * 4)
  ctx.textAlign = 'center'
  const cx = (b.x0 + b.x1) / 2
  const labelSize = label ? Math.min(h(b) * 0.12, 34 * s) : 0
  const prev = `LAST WEEK ${statNumber(c.before)}`
  const shown = statNumber(c.now * easeOutCubic(p))
  const size = fitSize(k, [statNumber(Math.max(c.now, c.before, 1000))], w(b) * 0.85, h(b) * 0.5, 220 * s, 1)
  const prevSize = Math.max(14 * s, Math.min(size * 0.2, 30 * s))
  const blockH = labelSize * 1.4 + size + prevSize * 1.8
  let y = (b.y0 + b.y1) / 2 - blockH / 2
  if (label) {
    ctx.font = `700 ${labelSize}px ${k.font}`
    ctx.fillStyle = f.accent
    y += labelSize
    ctx.fillText(label, cx, y)
    y += labelSize * 0.4
  }
  ctx.font = `700 ${size}px ${k.font}`
  ctx.fillStyle = FG
  ctx.shadowColor = f.accent
  ctx.shadowBlur = 18 * s
  y += size * 0.92
  ctx.fillText(shown, cx, y)
  ctx.shadowBlur = 0
  ctx.font = `700 ${prevSize}px ${k.font}`
  ctx.fillStyle = DIM
  y += size * 0.08 + prevSize * 1.6
  ctx.fillText(prev, cx, y)
  ctx.restore()
}

/** The #1 splash's least radius, CSS px: its #1 is set at 0.3 of it (tvPainter splash), so never under 12 px on any screen, a large frame keeping its own size. */
const SPLASH_MIN_PX = 40

/** The note line's type, CSS px before the stream's scale: his Fun Fact, wrapped, never re-cased. */
const NOTE_PX = 20

/**
 * The board, `t` seconds into its break (after the cut): the title card, then
 * the rows (or the numbers), then the stamp (design 4.3). `frame` turns the
 * scrambled glyphs over.
 */
export function paintStatsBoard(k: BreakKit, f: BreakFrame, board: StatsBoard, people: BreakPeople, t: number, frame: number, reduced: boolean): void {
  const beats = BEATS[board.kind]
  const a = f.area
  const s = f.s
  if (t < beats.rows) {
    k.part('statsTitle')
    slam(k, f, board.title, board.qualifier, t, beats.rows - t, reduced, false)
    return
  }
  if (t >= beats.stamp) {
    k.part('statsStamp')
    slam(k, f, STATS_TAG, asOfWords(board.asOf), t - beats.stamp, beats.end - t, reduced, true)
    return
  }
  const fade = reduced ? 1 : clamp01((beats.stamp - t) / FADE_S)
  const ctx = k.ctx
  ctx.save()
  ctx.globalAlpha *= fade
  if (board.kind === 'ranking') {
    const L = rankLayout(f, board.rows.length)
    k.part('statsHeader')
    header(k, f, L.title, board, reduced ? 1 : clamp01((t - beats.rows) / 0.3))
    k.part('statsRows')
    // Placed by position: equal numbers share a rank (1, 1, 3), each still on its own row.
    board.rows.forEach((r, i) => {
      const p = reduced ? 1 : clamp01((t - rowStart(i + 1, board.rows.length)) / DECODE_S)
      row(k, f, L.rows[i], r.rank, r.pubkey, people.name(r.pubkey), r.value, p, frame, i === 0)
    })
    k.part('statsHero')
    hero(k, f, L.hero, people.spin, t - beats.top, reduced)
  } else {
    const head: Box = { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y0 + h(a) * (f.stacked ? 0.14 : 0.2) }
    k.part('statsHeader')
    header(k, f, head, board, reduced ? 1 : clamp01((t - beats.rows) / 0.3))
    const p = reduced ? 1 : clamp01((t - beats.rows) / 1.2)
    k.part('statsCount')
    if (board.kind === 'count') bigCount(k, f, { ...a, y0: head.y1 }, null, board.count, p)
    else {
      // His line at the foot, wrapped, above the marquee; the two counts side by side over it, or one over the other when stacked.
      const noteSize = NOTE_PX * s
      ctx.font = `700 ${noteSize}px ${k.font}`
      const note = k.wrap(board.note, w(a) - 20 * s)
      const noteH = note.length * noteSize * 1.35 + 14 * s
      const body: Box = { x0: a.x0, y0: head.y1, x1: a.x1, y1: a.y1 - noteH }
      const cells: Box[] = f.stacked
        ? [{ ...body, y1: (body.y0 + body.y1) / 2 }, { ...body, y0: (body.y0 + body.y1) / 2 }]
        : [{ ...body, x1: (body.x0 + body.x1) / 2 - 12 * s }, { ...body, x0: (body.x0 + body.x1) / 2 + 12 * s }]
      bigCount(k, f, cells[0], 'HUMANS', board.humans, p)
      bigCount(k, f, cells[1], 'AGENTS', board.agents, p)
      k.part('statsNote')
      const np = reduced ? 1 : clamp01((t - beats.rows - 1.5) / 0.4)
      if (np > 0) {
        ctx.save()
        ctx.globalAlpha *= np
        ctx.textAlign = 'center'
        ctx.font = `700 ${noteSize}px ${k.font}`
        let y = a.y1 - noteH + 14 * s
        for (const line of note) {
          y += noteSize * 1.35
          const lw = ctx.measureText(line).width
          ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
          ctx.fillRect((a.x0 + a.x1) / 2 - lw / 2 - 8 * s, y - noteSize * 1.05, lw + 16 * s, noteSize * 1.35)
          ctx.fillStyle = FG
          ctx.fillText(line, (a.x0 + a.x1) / 2, y - noteSize * 0.12)
        }
        ctx.restore()
      }
    }
  }
  ctx.restore()
}
