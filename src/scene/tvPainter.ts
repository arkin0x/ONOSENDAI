/**
 * tvPainter.ts: everything Cyberspace TV writes on the picture, painted into
 * the tube rather than laid over it.
 *
 * The furniture (the clock, the chiron, the marquee, the cards, the segment
 * panels and the logo) used to be page elements over the canvas, so none of
 * it took the tube: no curve, no fringe, no scanlines, while the logo, drawn
 * in the tube, did (arkinox, 2026-10-18: "the PLAY, date and time, chiron,
 * and marquee dont seem to have the screen shape distortion or CRT effects
 * that they ought to"). Now it is all painted here, onto a flat canvas the
 * tube samples like the picture (TvScreenEffect), above the snow, so a cut
 * never hides it.
 *
 * Laid out in the flat frame, before the glass bends it, with the logo's own
 * margins for everything ("the ONOSENDAI logo looks to have a proper amount
 * of edge padding. please apply that precisely to the date and time, the
 * marquee, and the chiron"). In Monaspace Argon.
 *
 * The marquee scrolls in pixels and never rewrites what is on screen: new
 * numbers join the end of the line, so a cut no longer jumps it back
 * ("the marquee seems to jump or reset when the scene changes").
 */

import { formatCellSize } from 'sno-core/scale'
import type { ShardModel } from 'sno-core/shards'
import { actionLabel } from '../lib/events'
import { MAX_SCALE_EXP } from '../lib/space'
import { chainLengthAt, countTo } from '../lib/tv/stats'
import { itemLength, type Shot, type TapeItem } from '../lib/tv/director'
import { LANDMARKS } from '../hud/ScaleLadder'
import { CUT_MS, quoteOf, segmentDoing, typePace, TYPE_DELAY_S } from '../hud/TvSegments'
import { placeable, shotProgress, type TvAvatar } from '../store/useTv'
import type { Census, ChainTimes } from '../lib/tv/stats'

/** The face every word on the tube is set in. */
export const TV_FONT = "'Monaspace Argon', ui-monospace, monospace"

/** The logo's margins from the sides and from the top, as shares of the frame: everyone's margins. */
export const MARGIN_X = 0.06
export const MARGIN_Y = 0.085
/** The logo's width, CSS px, and at most this share of the frame's; public/logo.png's proportions. */
const LOGO_PX = 260
const LOGO_SHARE = 0.42
const LOGO_ASPECT = 354 / 1871

/** How long a cut's LATER or MEANWHILE stays up, ms, after the cut's own transition. */
export const CARD_MS = 2600
/** The marquee's pace, CSS px a second. */
const TICKER_PX_S = 70

const FG = '#f2fbff'
const ACCENT = '#00e5ff'
const REGION = '#52e39f'
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** The tape's clock: the date and the time, local, as a camcorder stamps them. */
export function tapeStamp(at: number): { date: string; time: string } {
  const d = new Date(at * 1000)
  const two = (n: number): string => String(n).padStart(2, '0')
  return {
    date: `${MONTHS[d.getMonth()]} ${two(d.getDate())} ${d.getFullYear()}`,
    time: `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`,
  }
}

/** A stretch of skipped dead air, in the largest two units it spans. */
export function skipWords(seconds: number): string {
  const units: Array<[number, string]> = [[86400, 'DAY'], [3600, 'HOUR'], [60, 'MINUTE'], [1, 'SECOND']]
  const parts: string[] = []
  let left = Math.floor(seconds)
  for (const [n, w] of units) {
    if (parts.length === 2) break
    const k = Math.floor(left / n)
    if (k > 0 || (parts.length === 0 && n === 1)) {
      parts.push(`${k} ${w}${k === 1 ? '' : 'S'}`)
      left -= k * n
    }
  }
  return parts.join(' ')
}

/** What the tube shows, read from the store and the profiles each paint. */
export interface TvPicture {
  status: 'tuning' | 'playing' | 'end' | 'no-signal'
  shot: Shot | null
  played: number
  tapeTime: number | null
  scaleExp: number
  cutAt: number
  skipped: number
  meanwhile: boolean
  census: Census | null
  chains: Record<string, ChainTimes>
  arrivals: Array<{ pubkey: string; at: number }>
  reactions: Array<{ pubkey: string; at: number; content: string; on: 'shard' | 'move' }>
  avatars: Record<string, TvAvatar>
}

/** What the painter needs from outside the store. */
export interface TvAssets {
  /** Someone's name, as TV writes it (lib/tv/text tvName). */
  name: (pubkey: string) => string
  /** Their picture, once loaded and safe to paint (CORS), else null. */
  picture: (pubkey: string) => HTMLImageElement | null
  /** The logo, once loaded. */
  logo: HTMLImageElement | null
  /** The turning shard of the segment on screen (TvSegments TvSpinHost), when there is one. */
  spin: HTMLCanvasElement | null
  /** The object or avatar the segment shows, for its name. */
  segmentShard: ShardModel | null
  /** A colour for someone, for a picture that is not there. */
  color: (pubkey: string) => string
}

/** The words on the marquee as of the moment on tape. */
export function tickerItems(p: TvPicture, name: (pk: string) => string): string[] {
  const t = p.tapeTime
  if (t === null) return []
  const out: string[] = []
  const shot = p.shot
  const last = shot && shot.beats.length > 0 ? shot.beats[Math.max(0, p.played - 1)] : null
  if (last?.action.sector) out.push(`SECTOR ${last.action.sector}`)
  if (p.census) {
    out.push(`${countTo(p.census.arrivals, t).toLocaleString()} AVATARS IN CYBERSPACE`)
    out.push(`${countTo(p.census.bags, t).toLocaleString()} BAGS HIDDEN`)
    out.push(`${countTo(p.census.objects, t).toLocaleString()} OBJECTS PUBLISHED`)
  }
  if (shot) {
    const who = name(shot.pubkey)
    const chain = p.chains[shot.pubkey]
    // Zero when their spawn is not on the relays: no number is better than a wrong one.
    const length = chain ? chainLengthAt(chain, t) : 0
    if (length > 0) out.push(`${who}: CHAIN OF ${length.toLocaleString()} ACTION${length === 1 ? '' : 'S'}`)
    if (p.census) {
      const bags = countTo(p.census.bagsBy.get(shot.pubkey) ?? [], t)
      out.push(`${who}: ${bags} BAG${bags === 1 ? '' : 'S'} HIDDEN`)
    }
  }
  for (const a of [...p.arrivals].reverse()) out.push(`NEW ARRIVAL ${name(a.pubkey)}`)
  for (const r of [...p.reactions].reverse()) out.push(`${r.content} FROM ${name(r.pubkey)} ON A ${r.on === 'shard' ? 'SHARD' : 'MOVE'}`)
  return out
}

/** What the chiron says the shot's avatar did. */
export function chironDoing(shot: Shot, played: number): string {
  if (shot.item) return segmentDoing(shot.item)
  const last = played > 0 ? shot.beats[played - 1] : null
  const trip = shot.beats.length
  if (last) return `${actionLabel(last.action)}${trip > 1 ? ` · ${played} OF ${trip}` : ''}`
  return trip > 1 ? `${trip} ACTIONS COMING UP` : 'ABOUT TO MOVE'
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const ramp = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a))

/** The longest start of `text` that fits `max`, with an ellipsis when cut. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  const chars = Array.from(text)
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(`${chars.slice(0, mid).join('')}…`).width <= max) lo = mid
    else hi = mid - 1
  }
  return `${chars.slice(0, lo).join('').trimEnd()}…`
}

/** `text` broken into lines of at most `max` wide, at spaces, and inside a word only when it must. */
export function wrap(ctx: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, max: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= max) { line = next; continue }
    if (line) lines.push(line)
    line = ''
    // A word wider than the line goes in pieces.
    let piece = ''
    for (const ch of Array.from(word)) {
      if (ctx.measureText(piece + ch).width > max && piece) { lines.push(piece); piece = '' }
      piece += ch
    }
    line = piece
  }
  if (line) lines.push(line)
  return lines
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const CUBE: Array<[number, number, number]> = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
const CUBE_EDGES: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
const CUBE_FACES: number[][] = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]

export class TvPainter {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  /** What is on the marquee, left to right, and where the first of it is. */
  private run: Array<{ text: string; w: number }> = []
  private runX: number | null = null
  private feed: string[] = []
  private feedAt = 0
  private lastPaint = 0
  private lastScale = 1

  /** `canvas` for tests; a new one otherwise. */
  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
  }

  /** What the marquee shows now, left to right: for tests. */
  get marqueeRun(): string[] {
    return this.run.map((r) => r.text)
  }

  /** Size the canvas: `w` by `h` CSS px at `s` canvas px each. True when that changed it. */
  size(w: number, h: number, s: number): boolean {
    const W = Math.max(2, Math.round(w * s))
    const H = Math.max(2, Math.round(h * s))
    if (this.canvas.width === W && this.canvas.height === H) return false
    this.canvas.width = W
    this.canvas.height = H
    this.run = []
    this.runX = null
    return true
  }

  /** Measure the marquee again: what is on it was measured in the face that was there before the TV's own loaded. */
  remeasure(): void {
    const ctx = this.ctx
    const s = this.lastScale
    ctx.font = `${12 * s}px ${TV_FONT}`
    for (const r of this.run) r.w = ctx.measureText(r.text).width
  }

  /**
   * Paint the picture's furniture. `scale` is canvas px per CSS px; sizes are
   * set in CSS px and grow a little on a large screen, where 12 px across a
   * 1920 px tube read as fine print.
   */
  paint(p: TvPicture, a: TvAssets, now: number, scale: number, reduced: boolean): void {
    const cssW = this.canvas.width / scale
    const s = scale * Math.min(1.35, Math.max(0.9, cssW / 1400))
    this.lastScale = s
    const dt = this.lastPaint ? Math.min(0.25, (now - this.lastPaint) / 1000) : 0
    this.lastPaint = now
    const ctx = this.ctx
    const W = this.canvas.width
    const H = this.canvas.height
    ctx.clearRect(0, 0, W, H)
    ctx.textBaseline = 'alphabetic'
    const MX = Math.round(W * MARGIN_X)
    const MY = Math.round(H * MARGIN_Y)
    const narrow = cssW < 600

    // The logo, top right: the margins everything else takes.
    const lw = Math.min(LOGO_PX * s, W * LOGO_SHARE)
    const lh = lw * LOGO_ASPECT
    // Under heavy snow (tuning, no signal, a bag with no public place) the
    // logo and the clock get a soft dark backing, to read against the noise.
    const snowy = p.status === 'tuning' || p.status === 'no-signal' || (p.shot?.item?.kind === 'bag' && !placeable(p.shot.item.hint))
    if (snowy) {
      const bx = W - MX - lw - 18 * s
      const by = MY - 14 * s
      const back = ctx.createRadialGradient(W - MX - lw / 2, MY + lh, 0, W - MX - lw / 2, MY + lh, lw * 0.9)
      back.addColorStop(0, 'rgba(0, 0, 0, 0.72)')
      back.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = back
      ctx.fillRect(bx, by, lw + 36 * s, lh + 130 * s)
    }
    if (a.logo) {
      ctx.globalAlpha = 0.96
      ctx.drawImage(a.logo, W - MX - lw, MY, lw, lh)
      ctx.globalAlpha = 1
    }

    // The clock, under the logo, on the logo's right edge.
    ctx.fillStyle = FG
    ctx.textAlign = 'right'
    let cy = MY + lh + 18 * s
    ctx.font = `700 ${11 * s}px ${TV_FONT}`
    ctx.fillText('▶ PLAY', W - MX, cy)
    if (p.tapeTime !== null) {
      const stamp = tapeStamp(p.tapeTime)
      ctx.font = `700 ${(narrow ? 13 : 16) * s}px ${TV_FONT}`
      cy += 20 * s
      ctx.fillText(stamp.date, W - MX, cy)
      cy += 20 * s
      ctx.fillText(stamp.time, W - MX, cy)
    }

    // The marquee along the bottom margin, the CYBERSPACE TV bug at its head.
    const tickH = 28 * s
    const tickY = H - MY - tickH
    this.marquee(p, a, MX, tickY, W - MX, tickH, s, dt)

    // The chiron above it.
    let chironTop = tickY
    // As wide as the marquee under it: it faded out a third of the way
    // short of the right side (arkinox, 2026-10-18).
    if (p.shot && p.status === 'playing') chironTop = this.chiron(p, a, MX, tickY - 10 * s, W - 2 * MX, s, narrow)

    // A segment's panel at the centre.
    const item = p.shot?.item
    const inset = item !== undefined && !(item.kind === 'bag' && placeable(item.hint))
    if (item && inset && p.status === 'playing') this.segment(item, p.shot!.length, a, W, cy + 14 * s, chironTop - 50 * s, MX, MY, W - MX - lw - 16 * s, s, narrow, now)

    // LATER and MEANWHILE, after the cut's transition; under an inset's panel.
    this.card(p, W, s, narrow, inset ? chironTop - 34 * s : H * 0.34, now)

    // TUNING, END OF TAPE, NO SIGNAL.
    if (p.status !== 'playing') {
      const label = p.status === 'tuning' ? 'TUNING' : p.status === 'end' ? 'END OF TAPE' : 'NO SIGNAL'
      ctx.globalAlpha = reduced ? 1 : 0.55 + 0.45 * (Math.floor(now / 700) % 2)
      ctx.font = `700 ${26 * s}px ${TV_FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = FG
      ctx.fillText(label, W / 2, H / 2)
      ctx.globalAlpha = 1
    }
  }

  private marquee(p: TvPicture, a: TvAssets, x0: number, y: number, x1: number, h: number, s: number, dt: number): void {
    const ctx = this.ctx
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)'
    ctx.fillRect(x0, y, x1 - x0, h)
    ctx.fillStyle = 'rgba(0, 229, 255, 0.4)'
    ctx.fillRect(x0, y, x1 - x0, Math.max(1, s))
    ctx.fillRect(x0, y + h - Math.max(1, s), x1 - x0, Math.max(1, s))
    // The bug: CYBERSPACE and a boxed TV.
    const base = y + h / 2 + 4.5 * s
    ctx.font = `700 ${12 * s}px ${TV_FONT}`
    ctx.textAlign = 'left'
    ctx.fillStyle = FG
    const word = 'CYBERSPACE'
    const ww = ctx.measureText(word).width
    let bx = x0 + 10 * s
    ctx.fillText(word, bx, base)
    bx += ww + 7 * s
    const tw = ctx.measureText('TV').width
    ctx.strokeStyle = FG
    ctx.lineWidth = Math.max(1, s)
    roundRect(ctx, bx - 4 * s, y + 6 * s, tw + 8 * s, h - 12 * s, 3 * s)
    ctx.stroke()
    ctx.fillText('TV', bx, base)
    const startX = bx + tw + 16 * s
    ctx.fillStyle = 'rgba(0, 229, 255, 0.4)'
    ctx.fillRect(startX - 8 * s, y + 5 * s, Math.max(1, s), h - 10 * s)

    // The run: what is on screen stays as it was until it scrolls off.
    ctx.font = `${12 * s}px ${TV_FONT}`
    const gap = ctx.measureText('   ◆   ').width
    const area = x1 - startX
    if (this.runX === null) this.runX = area * 0.25
    this.runX -= TICKER_PX_S * s * dt
    while (this.run.length > 0 && this.runX + this.run[0].w + gap < 0) {
      this.runX += this.run[0].w + gap
      this.run.shift()
    }
    let total = this.run.reduce((sum, r) => sum + r.w + gap, 0)
    for (let guard = 0; this.runX + total < area * 1.5 && guard < 40; guard++) {
      if (this.feedAt >= this.feed.length) {
        // A fresh reading of the numbers, each time round.
        this.feed = tickerItems(p, a.name)
        this.feedAt = 0
        if (this.feed.length === 0) break
      }
      const text = this.feed[this.feedAt++]
      const w = ctx.measureText(text).width
      this.run.push({ text, w })
      total += w + gap
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(startX, y, area, h)
    ctx.clip()
    let x = startX + this.runX
    for (const r of this.run) {
      ctx.fillStyle = FG
      ctx.fillText(r.text, x, base)
      ctx.fillStyle = ACCENT
      ctx.fillText('◆', x + r.w + gap / 2 - ctx.measureText('◆').width / 2, base)
      x += r.w + gap
    }
    ctx.restore()
  }

  /** The chiron, bottom edge at `bottom`; its top. */
  private chiron(p: TvPicture, a: TvAssets, x: number, bottom: number, w: number, s: number, narrow: boolean): number {
    const ctx = this.ctx
    const shot = p.shot!
    const h = (narrow ? 88 : 62) * s
    const y = bottom - h
    const grad = ctx.createLinearGradient(x, 0, x + w, 0)
    grad.addColorStop(0, 'rgba(0, 60, 80, 0.88)')
    grad.addColorStop(0.85, 'rgba(0, 34, 50, 0.78)')
    grad.addColorStop(1, 'rgba(0, 30, 44, 0.45)')
    ctx.fillStyle = grad
    ctx.fillRect(x, y, w, h)
    // The picture.
    const r = 22 * s
    const pcx = x + 10 * s + r
    const pcy = y + (narrow ? 10 * s + r : h / 2)
    this.disc(a, shot.pubkey, pcx, pcy, r)
    // Who and what.
    const tx = pcx + r + 12 * s
    const gaugeW = 170 * s
    const textW = (narrow ? w - (tx - x) : w - (tx - x) - gaugeW - 16 * s) - 8 * s
    ctx.textAlign = 'left'
    ctx.fillStyle = FG
    ctx.font = `700 ${(narrow ? 16 : 20) * s}px ${TV_FONT}`
    ctx.fillText(fit(ctx, a.name(shot.pubkey), textW), tx, pcy - 3 * s)
    ctx.fillStyle = ACCENT
    ctx.font = `${11 * s}px ${TV_FONT}`
    ctx.fillText(fit(ctx, chironDoing(shot, p.played), textW), tx, pcy + 14 * s)
    // How far out: the scale ladder's landmarks, the zoom on it.
    const gx = narrow ? x + 10 * s : x + w - gaugeW - 12 * s
    const gy = narrow ? y + h - 26 * s : y + 20 * s
    const gw = narrow ? w - 20 * s : gaugeW
    this.gauge(p.scaleExp, gx, gy, gw, s)
    return y
  }

  private gauge(scaleExp: number, x: number, y: number, w: number, s: number): void {
    const ctx = this.ctx
    const top = MAX_SCALE_EXP + 1
    ctx.font = `${9 * s}px ${TV_FONT}`
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(242, 251, 255, 0.7)'
    ctx.fillText('ZOOM', x, y + 3 * s)
    const rx = x + ctx.measureText('ZOOM').width + 8 * s
    const rw = x + w - rx
    ctx.fillStyle = 'rgba(200, 245, 255, 0.5)'
    ctx.fillRect(rx, y + 4 * s, rw, Math.max(1, s))
    for (const l of LANDMARKS) {
      if (l.h > MAX_SCALE_EXP) continue
      ctx.fillRect(rx + (l.h / top) * rw, y - 2 * s, Math.max(1, s), 6 * s)
    }
    ctx.fillStyle = ACCENT
    ctx.beginPath()
    ctx.arc(rx + (scaleExp / top) * rw, y + 4 * s, 3.5 * s, 0, Math.PI * 2)
    ctx.fill()
    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(242, 251, 255, 0.85)'
    ctx.fillText(`1 CELL = ${formatCellSize(scaleExp).toUpperCase()}`, x + w, y + 18 * s)
  }

  /** Someone's picture in a circle, or their colour and initial when there is none to paint. */
  private disc(a: TvAssets, pubkey: string, cx: number, cy: number, r: number): void {
    const ctx = this.ctx
    const img = a.picture(pubkey)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()
    if (img) {
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2)
    } else {
      ctx.fillStyle = a.color(pubkey)
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
      ctx.fillStyle = '#05070d'
      ctx.font = `700 ${r}px ${TV_FONT}`
      ctx.textAlign = 'center'
      ctx.fillText(Array.from(a.name(pubkey))[0] ?? '?', cx, cy + r * 0.36)
    }
    ctx.restore()
  }

  private card(p: TvPicture, W: number, s: number, narrow: boolean, y: number, now: number): void {
    if (p.status !== 'playing') return
    const text = p.meanwhile ? '◀◀ MEANWHILE' : p.skipped >= 60 ? `▶▶ ${skipWords(p.skipped)} LATER` : null
    if (!text) return
    const t = (now - p.cutAt - CUT_MS) / CARD_MS
    if (t < 0 || t > 1) return
    const ctx = this.ctx
    ctx.globalAlpha = t < 0.08 ? t / 0.08 : t > 0.8 ? (1 - t) / 0.2 : 1
    ctx.font = `700 ${(narrow ? 14 : 18) * s}px ${TV_FONT}`
    ctx.textAlign = 'center'
    const tw = ctx.measureText(text).width
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fillRect(W / 2 - tw / 2 - 14 * s, y - 22 * s, tw + 28 * s, 32 * s)
    ctx.fillStyle = FG
    ctx.fillText(text, W / 2, y)
    ctx.globalAlpha = 1
  }

  /** The panel of a segment shown in an inset: a sealed bag, an object, a new avatar, a comment. */
  private segment(item: TapeItem, shotLength: number, a: TvAssets, W: number, top: number, bottom: number, MX: number, MY: number, sideRight: number, s: number, narrow: boolean, now: number): void {
    const ctx = this.ctx
    // Seconds since the segment came on, after its cut, by the shot's own
    // clock (the shot's length, which is the item's unless a test cued it longer).
    const length = itemLength(item)
    const t = Math.max(0, shotProgress() * shotLength - CUT_MS / 1000)
    const pad = (narrow ? 16 : 24) * s
    // An advertisement is the product first: the model in the middle, the
    // words under it, on every screen (arkinox, 2026-10-18: "make sure the
    // NOW AVAILABLE shows the rotating model in the center of the layout,
    // text can go under"). Everything else stacks only on a phone.
    const ad = item.kind === 'object'
    const layout = (stage: number, pw: number, stacked: boolean, size?: number, maxLines?: number): { stage: number; pw: number; stacked: boolean; textX: number; textW: number; lines: string[]; quoteSize: number; ph: number } => {
      const textX = stacked ? 0 : stage + 28 * s
      const textW = stacked ? pw - 2 * pad : pw - 2 * pad - textX
      let lines: string[] = []
      let quoteSize = 0
      if (item.kind === 'comment') {
        quoteSize = size ?? (narrow ? 15 : 20) * s
        ctx.font = `${quoteSize}px ${TV_FONT}`
        lines = wrap(ctx, `“${quoteOf(item)}”`, textW)
        if (maxLines !== undefined && lines.length > maxLines) {
          lines = lines.slice(0, Math.max(1, maxLines))
          lines[lines.length - 1] = fit(ctx, `${lines[lines.length - 1]}…`, textW)
        }
      }
      const captionH = item.kind === 'comment' ? lines.length * quoteSize * 1.45 + 30 * s : 96 * s
      const ph = stacked ? stage + 18 * s + captionH + 2 * pad : Math.max(stage, captionH) + 2 * pad
      return { stage, pw, stacked, textX, textW, lines, quoteSize, ph }
    }
    // The model gives up size first, the words never.
    const fitPanel = (pw: number, stacked: boolean, room: number): ReturnType<typeof layout> => {
      const first = layout((ad ? (narrow ? 170 : 250) : narrow ? 140 : 210) * s, pw, stacked)
      if (first.ph <= room) return first
      // The model gives up size first.
      let f = layout(Math.max(60 * s, first.stage - (first.ph - room)), pw, stacked)
      if (f.ph <= room || item.kind !== 'comment') return f
      // Then a long quote's type, down to 12 px, and then its last lines,
      // cut with an ellipsis: on a phone on its side the words covered the
      // chiron and the marquee (review of #375).
      for (let size = f.quoteSize - s; size >= 12 * s && f.ph > room; size -= s) f = layout(f.stage, pw, stacked, size)
      if (f.ph <= room) return f
      const over = f.ph - room
      const keep = f.lines.length - Math.ceil(over / (f.quoteSize * 1.45))
      return layout(f.stage, pw, stacked, f.quoteSize, keep)
    }
    // Where the panel goes: between the clock and the chiron (and a card's
    // room above the chiron), so it covers neither and the date can be read
    // (arkinox, 2026-10-18: "the date is obscured so we dont know when it
    // happened"). On a short screen (a phone on its side) that strip is too
    // narrow: the panel goes up beside the clock instead, short of the
    // logo's column, side by side.
    const fullW = Math.min(760 * s, W - 2 * MX)
    let room = Math.max(0, bottom - top)
    let fitted = fitPanel(fullW, narrow || ad, room)
    let px = (W - fullW) / 2
    let top0 = top
    if (fitted.ph > room) {
      const sideW = Math.min(760 * s, sideRight - MX)
      const sideRoom = Math.max(0, bottom - MY)
      const beside = fitPanel(sideW, false, sideRoom)
      if (beside.ph <= sideRoom || beside.ph < fitted.ph) { fitted = beside; px = MX; room = sideRoom; top0 = MY }
    }
    const { stage, pw, stacked, textX, textW, lines, quoteSize, ph } = fitted
    const py = top0 + Math.max(0, (room - ph) / 2)
    ctx.globalAlpha = ramp(t, 0, 0.5)
    const grad = ctx.createLinearGradient(px, py, px + pw, py + ph)
    grad.addColorStop(0, 'rgba(0, 40, 56, 0.92)')
    grad.addColorStop(1, 'rgba(2, 12, 20, 0.92)')
    ctx.fillStyle = grad
    ctx.fillRect(px, py, pw, ph)
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)'
    ctx.lineWidth = Math.max(1, s)
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1)

    const sx = px + pad
    const sy = py + pad
    const tx = stacked ? px + pad : sx + textX
    const ty = stacked ? sy + stage + 18 * s : sy

    if (item.kind === 'bag') {
      this.cube(sx + (stacked ? (pw - 2 * pad - stage) / 2 : 0), sy, stage, t, s)
      this.caption(tx, ty + (narrow ? 0 : stage / 2 - 40 * s), textW, 'A BAG IS SEALED', 'LOCATION SECRET', item.height !== null ? `A REGION 2^${item.height} GIBSONS ACROSS` : null, s)
    } else if (item.kind === 'object') {
      // An advertisement: the product turning in the middle, NOW AVAILABLE!
      // slammed on its corner, the words centred under it.
      // Beside the clock on a short screen it lies side by side: the model
      // left, the words beside it.
      const ox = stacked ? px + (pw - stage) / 2 : sx
      if (a.spin) ctx.drawImage(a.spin, ox, sy, stage, stage)
      const title = (a.segmentShard?.name ?? 'AN OBJECT').toUpperCase()
      if (stacked) this.caption(px + pw / 2, ty, textW, 'NEW IN CYBERSPACE', title, `FROM ${a.name(item.pubkey)}`, s, 'center')
      else this.caption(tx, ty + stage / 2 - 40 * s, textW, 'NEW IN CYBERSPACE', title, `FROM ${a.name(item.pubkey)}`, s)
      // On the model's left (arkinox, 2026-10-18: "move the now available to the left side").
      this.splash(ox + stage * 0.08, sy + stage * 0.14, stage * 0.3, t, s)
    } else if (item.kind === 'avatar') {
      const ox = sx + (stacked ? (pw - 2 * pad - stage) / 2 : 0)
      if (a.spin) ctx.drawImage(a.spin, ox, sy, stage, stage)
      this.caption(tx, ty + (narrow ? 0 : stage / 2 - 30 * s), textW, 'NEW LOOK', a.name(item.pubkey), null, s)
    } else if (item.kind === 'comment') {
      // The commenter as a photograph: their avatar turning, else their picture.
      const ox = sx + (stacked ? (pw - 2 * pad - stage) / 2 : 0)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      ctx.fillRect(ox, sy, stage, stage)
      if (a.spin) ctx.drawImage(a.spin, ox + 8 * s, sy + 6 * s, stage - 16 * s, stage - 34 * s)
      else this.disc(a, item.pubkey, ox + stage / 2, sy + stage / 2 - 12 * s, stage * 0.32)
      ctx.strokeStyle = 'rgba(230, 240, 245, 0.88)'
      ctx.lineWidth = 6 * s
      ctx.strokeRect(ox + 3 * s, sy + 3 * s, stage - 6 * s, stage - 6 * s)
      ctx.font = `${10 * s}px ${TV_FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = FG
      ctx.fillText(fit(ctx, a.name(item.pubkey), stage - 20 * s), ox + stage / 2, sy + stage - 14 * s)
      // The quote, printing.
      const quote = quoteOf(item)
      const pace = typePace(Array.from(quote).length, length)
      const shown = Math.max(0, Math.floor((t - TYPE_DELAY_S) / pace))
      ctx.font = `${quoteSize}px ${TV_FONT}`
      ctx.textAlign = 'left'
      ctx.fillStyle = item.text === null ? '#9fb4bf' : FG
      let left = shown + 1 // the opening mark prints with the first word
      let ly = ty + quoteSize
      for (const line of lines) {
        const chars = Array.from(line)
        const take = Math.max(0, Math.min(chars.length, left))
        if (take > 0) ctx.fillText(chars.slice(0, take).join(''), tx, ly)
        if (take < chars.length && take >= 0 && left >= 0) {
          // The caret, where the printing is.
          if (Math.floor(now / 400) % 2 === 0) ctx.fillText('▌', tx + ctx.measureText(chars.slice(0, take).join('')).width, ly)
          left = -1
          break
        }
        left -= chars.length
        ly += quoteSize * 1.45
      }
      const on = item.on === 'bag' ? 'ON A SEALED BAG' : item.about && item.about !== item.pubkey ? `ON ${a.name(item.about)}'S MOVE` : 'ON A MOVE'
      ctx.font = `${10 * s}px ${TV_FONT}`
      ctx.fillStyle = ACCENT
      ctx.fillText(fit(ctx, `${a.name(item.pubkey)} · ${on}${item.text === null ? ' · SEALED TO ITS REGION' : ''}`, textW), tx, ty + lines.length * quoteSize * 1.45 + 18 * s)
    }
    ctx.globalAlpha = 1
  }

  /**
   * NOW AVAILABLE!, on a starburst, as the corner of an advertisement: it
   * lands from large (a stamp), then sways and breathes for the rest of the
   * segment.
   */
  private splash(cx: number, cy: number, r: number, t: number, s: number): void {
    const ctx = this.ctx
    const land = ramp(t, 0.6, 0.9)
    if (land <= 0) return
    const size = r * (1.9 - 0.9 * land) * (1 + 0.04 * Math.sin(t * 5))
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.22 + 0.05 * Math.sin(t * 2.2))
    ctx.globalAlpha *= land
    // The burst: sixteen points.
    ctx.beginPath()
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2
      const rr = i % 2 === 0 ? size : size * 0.76
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    ctx.closePath()
    ctx.fillStyle = '#ffd23f'
    ctx.fill()
    ctx.lineWidth = 2 * s
    ctx.strokeStyle = '#ff2d7a'
    ctx.stroke()
    ctx.fillStyle = '#1a0610'
    ctx.textAlign = 'center'
    ctx.font = `700 ${size * 0.3}px ${TV_FONT}`
    ctx.fillText('NOW', 0, -size * 0.08)
    ctx.font = `700 ${size * 0.2}px ${TV_FONT}`
    ctx.fillText('AVAILABLE!', 0, size * 0.22)
    ctx.restore()
  }

  private caption(x: number, y: number, w: number, kicker: string, title: string, note: string | null, s: number, align: 'left' | 'center' = 'left'): void {
    const ctx = this.ctx
    ctx.textAlign = align
    ctx.fillStyle = ACCENT
    ctx.font = `${11 * s}px ${TV_FONT}`
    ctx.fillText(kicker, x, y + 12 * s)
    ctx.fillStyle = FG
    ctx.font = `700 ${24 * s}px ${TV_FONT}`
    ctx.fillText(fit(this.ctx, title, w), x, y + 44 * s)
    if (note) {
      ctx.globalAlpha *= 0.8
      ctx.font = `${10 * s}px ${TV_FONT}`
      ctx.fillText(fit(this.ctx, note, w), x, y + 66 * s)
      ctx.globalAlpha /= 0.8
    }
  }

  /**
   * The sealed bag, standing for itself and nowhere: outlines, then sides, a
   * key stamped on each side facing the viewer, the sides fading, outlines
   * kept. The same timing as the box in the world (TvBoxes).
   */
  private cube(x: number, y: number, size: number, t: number, s: number): void {
    const ctx = this.ctx
    const turn = t * 0.7
    const tilt = -0.42
    // Cube space to the panel: turned, tilted, in perspective.
    const project = (vx: number, vy: number, vz: number): { x: number; y: number; z: number } => {
      const x1 = vx * Math.cos(turn) + vz * Math.sin(turn)
      const z1 = -vx * Math.sin(turn) + vz * Math.cos(turn)
      const y2 = vy * Math.cos(tilt) - z1 * Math.sin(tilt)
      const z2 = vy * Math.sin(tilt) + z1 * Math.cos(tilt)
      const k = 4 / (4 + z2)
      return { x: x + size / 2 + x1 * size * 0.27 * k, y: y + size / 2 - y2 * size * 0.27 * k, z: z2 }
    }
    const proj = CUBE.map(([vx, vy, vz]) => project(vx, vy, vz))
    const edges = ramp(t, 0.4, 1.4)
    const sides = ramp(t, 1.4, 2.2) * (1 - ramp(t, 4.6, 5.8))
    ctx.save()
    ctx.strokeStyle = REGION
    ctx.fillStyle = REGION
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    CUBE_FACES.forEach((f) => {
      ctx.globalAlpha = 0.14 * sides
      ctx.beginPath()
      f.forEach((n, j) => (j === 0 ? ctx.moveTo(proj[n].x, proj[n].y) : ctx.lineTo(proj[n].x, proj[n].y)))
      ctx.closePath()
      ctx.fill()
    })
    // A key stamped on each side, lying on it: drawn in the face's own plane
    // and turned with the box, as the keys on the CSS cube were (arkinox,
    // 2026-10-18: "they stuck to the sides of the box which is what I
    // wanted"). The far sides show through the box, fainter.
    FACE_PLANES.forEach(({ n, u, v }, i) => {
      const start = 2.4 + i * 0.22
      const k = ramp(t, start, start + 0.18)
      if (k <= 0) return
      const away = project(n[0] * 2, n[1] * 2, n[2] * 2).z > project(0, 0, 0).z
      // Lands from large, as a stamp comes down, within the face.
      const scale = 0.62 * (1.8 - 0.8 * k)
      const at = (gx: number, gy: number): { x: number; y: number } => {
        const lx = ((gx - 64) / 64) * scale
        const ly = (-(gy - 64) / 64) * scale
        return project(n[0] + u[0] * lx + v[0] * ly, n[1] + u[1] * lx + v[1] * ly, n[2] + u[2] * lx + v[2] * ly)
      }
      const alpha = k * (1 - ramp(t, 4.6, 5.8)) * (away ? 0.4 : 1)
      if (alpha <= 0) return
      ctx.globalAlpha = alpha
      ctx.lineWidth = 2.4 * s
      ctx.beginPath()
      for (const stroke of KEY_STROKES) {
        stroke.forEach(([gx, gy], j) => {
          const p = at(gx, gy)
          if (j === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
      }
      ctx.stroke()
    })
    ctx.globalAlpha = 0.95 * edges
    ctx.lineWidth = 2 * s
    ctx.beginPath()
    for (const [i, j] of CUBE_EDGES) {
      ctx.moveTo(proj[i].x, proj[i].y)
      ctx.lineTo(proj[j].x, proj[j].y)
    }
    ctx.stroke()
    ctx.restore()
  }
}

/** The six sides of the cube: each one's outward normal, and its across and up in its own plane. */
const FACE_PLANES: Array<{ n: [number, number, number]; u: [number, number, number]; v: [number, number, number] }> = [
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
]

/** The key (drawKey's), as strokes on a 128 grid: the bow's ring, the shaft, two teeth. */
const KEY_STROKES: Array<Array<[number, number]>> = [
  Array.from({ length: 25 }, (_, i): [number, number] => [38 + 20 * Math.cos((i / 24) * Math.PI * 2), 64 + 20 * Math.sin((i / 24) * Math.PI * 2)]),
  [[58, 64], [112, 64]],
  [[96, 64], [96, 84]],
  [[110, 64], [110, 80]],
]

export { CUT_MS }
