/**
 * tvCard.test.ts: a cut's LATER or MEANWHILE card, top centre between the
 * minimap and the logo (arkinox, 2026-10-23: "I don't like it appearing over
 * the chiron"). The placing rules (scene/tvCard.ts) on their own, and the
 * painter's card at the site's TV and the stream's text sizes, wide and on
 * phones: it meets nothing else TV paints (a panel's border only, never what
 * the panel shows), panels lie as they did, and it comes and goes as it did.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ query: async () => [], queryEach: async () => [], queryAny: async () => [], publish: async () => ({ ok: true }), publishMany: async () => ({ ok: true }), relaySet: () => [] }))
import { CARD_MS, MARGIN_X, MARGIN_Y, TvPainter, type TvAssets, type TvPicture } from '../tvPainter'
import { CARD_CLEAR_PX, CARD_FLOOR, CARD_H_PX, CARD_LEAST, CARD_LINE_EM, CARD_PAD_PX, clearOfPanel, placeCard, type CardFrame, type PanelInk } from '../tvCard'
import { CUT_MS } from '../../hud/TvSegments'
import { useTv } from '../../store/useTv'
import { setBroadcastForTest, type BroadcastTextSize } from '../../lib/tv/broadcast'
import { explainerLayout } from '../../lib/tv/explainer'

interface Box { x0: number; y0: number; x1: number; y1: number }
interface Look { font: string; ink: string; alpha: number }
interface Text { text: string; x: number; y: number; size: number; box: Box; look: Look; seq: number }
type Rect = Box & { radial: boolean; look: Look; seq: number; path: boolean }

/**
 * A canvas that keeps each text, rectangle, picture and filled or stroked
 * path it is given (the bursts, the cube, the minimap's lines and sun), as
 * boxes on the frame through translate, rotate and scale; type measures
 * 0.6 em a character.
 */
function recording(): { canvas: HTMLCanvasElement; texts: Text[]; rects: Rect[] } {
  const texts: Text[] = []
  const rects: Rect[] = []
  let seq = 0
  const state: Record<string, unknown> = { globalAlpha: 1, font: '10px x', textAlign: 'start', fillStyle: '#000', strokeStyle: '#000' }
  const stack: Array<{ dx: number; dy: number; k: number; a: number; st: Record<string, unknown> }> = []
  let dx = 0
  let dy = 0
  let k = 1
  let a = 0
  let path: Array<[number, number]> = []
  const at = (x: number, y: number): [number, number] => [dx + k * (Math.cos(a) * x - Math.sin(a) * y), dy + k * (Math.sin(a) * x + Math.cos(a) * y)]
  const look = (ink: unknown = state.fillStyle): Look => ({ font: String(state.font), ink: typeof ink === 'string' ? ink : 'gradient', alpha: Number(state.globalAlpha) })
  const size = (): number => Number(/([\d.]+)px/.exec(String(state.font))?.[1] ?? 10)
  const width = (t: string): number => Array.from(t).length * size() * 0.6
  const bounds = (pts: Array<[number, number]>): Box => ({ x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) })
  const box = (x: number, y: number, w: number, h: number): Box => bounds([at(x, y), at(x + w, y), at(x, y + h), at(x + w, y + h)])
  const rect = (x: number, y: number, w: number, h: number): void => {
    rects.push({ ...box(x, y, w, h), radial: (state.fillStyle as { radial?: boolean })?.radial === true, look: look(), seq: seq++, path: false })
  }
  const inkPath = (ink: unknown): void => {
    if (path.length > 0) rects.push({ ...bounds(path), radial: false, look: look(ink), seq: seq++, path: true })
  }
  const ctx = new Proxy({
    measureText: (t: string) => ({ width: width(t) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {}, radial: true }),
    fillText: (text: string, x: number, y: number) => {
      const w = width(text)
      const align = String(state.textAlign)
      const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
      texts.push({ text, x: at(x, y)[0], y: at(x, y)[1], size: size() * k, box: box(left, y - size(), w, size() * 1.3), look: look(), seq: seq++ })
    },
    fillRect: rect,
    strokeRect: rect,
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => { rects.push({ ...box(x, y, w, h), radial: false, look: { ...look(), ink: 'image' }, seq: seq++, path: false }) },
    beginPath: () => { path = [] },
    moveTo: (x: number, y: number) => { path.push(at(x, y)) },
    lineTo: (x: number, y: number) => { path.push(at(x, y)) },
    arcTo: (x1: number, y1: number, x2: number, y2: number) => { path.push(at(x1, y1), at(x2, y2)) },
    arc: (x: number, y: number, r: number) => { path.push(at(x - r, y - r), at(x + r, y + r), at(x - r, y + r), at(x + r, y - r)) },
    rect: (x: number, y: number, w: number, h: number) => { path.push(at(x, y), at(x + w, y + h)) },
    clip: () => { path = [] },
    fill: () => inkPath(state.fillStyle),
    stroke: () => inkPath(state.strokeStyle),
    translate: (x: number, y: number) => { [dx, dy] = at(x, y) },
    rotate: (r: number) => { a += r },
    scale: (f: number) => { k *= f },
    save: () => { stack.push({ dx, dy, k, a, st: { ...state } }) },
    restore: () => { const top = stack.pop(); if (top) { dx = top.dx; dy = top.dy; k = top.k; a = top.a; Object.assign(state, top.st) } },
  } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
    set: (_t, key, v) => { state[key as string] = v; return true },
  })
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, texts, rects }
}

const music = { title: 'A TRACK WITH A LONG NAME', artist: 'AN ARTIST', art: null, progress: 0.4, blocked: false, volume: 1, muted: false }
// A logo to draw, so its picture is on the record.
const assets: TvAssets = { name: (pk) => pk.toUpperCase(), picture: () => null, logo: {} as HTMLImageElement, spin: {} as HTMLCanvasElement, segmentShard: null, color: () => '#fff', music, watching: 12 }

function picture(over: Partial<TvPicture>): TvPicture {
  return { status: 'playing', shot: null, played: 0, tapeTime: 1_760_000_000, scaleExp: 40, cutAt: 0, skipped: 0, meanwhile: false, census: null, chains: {}, arrivals: [], reactions: [], avatars: {}, ...over }
}

const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
const bag = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: 'ann', at: 1, hint: null, height: 3, money: true, nft: true, counts: { shard: 2, cashu: 1, nft: 1 } as never }
const object = { kind: 'object' as const, id: 'o'.repeat(64), pubkey: 'ann', at: 1, event: {} as never }
const comment = { kind: 'comment' as const, id: 'c'.repeat(64), pubkey: 'ann', at: 1, text: 'the sky above the port was the color of television, tuned to a dead channel and then some more words to run it past what any panel holds at this size', on: 'move' as const, about: null }
const shortComment = { ...comment, id: 'd'.repeat(64), text: 'welcome to cyberspace! Let me know if you have any questions' }
const segmentShot = (item: typeof bag | typeof object | typeof comment) => ({ id: item.id, kind: item.kind, item, pubkey: 'ann', beats: [], start: 1, end: 1, offsets: [], length: 30 })
const KINDS = [trip, segmentShot(bag), segmentShot(object), segmentShot(comment), segmentShot(shortComment)]

/** Paint once at `w` x `h` and `now` (`into` ms into the shot for a segment), after a first paint as the set paints on, with `a`. */
function paintAt(p: TvPicture, w: number, h: number, now = 1e12, scale = 1, into = 1500, a: TvAssets = assets): ReturnType<typeof recording> {
  vi.spyOn(performance, 'now').mockReturnValue(now)
  if (p.shot) useTv.setState({ shot: p.shot, status: p.status, cutAt: now - into, played: 0 })
  const rec = recording()
  const painter = new TvPainter(rec.canvas)
  painter.size(w, h, scale)
  painter.paint(p, a, now - 33, scale, false)
  rec.texts.length = 0
  rec.rects.length = 0
  painter.paint(p, a, now, scale, false)
  vi.restoreAllMocks()
  return rec
}

const meets = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const inside = (a: Box, b: Box): boolean => a.x0 >= b.x0 - 0.5 && a.x1 <= b.x1 + 0.5 && a.y0 >= b.y0 - 0.5 && a.y1 <= b.y1 + 0.5
const isCard = (r: { look: Look; path?: boolean }): boolean => !r.path && (r.look.ink === 'rgba(2, 12, 20, 0.94)' || r.look.ink === 'rgba(0, 0, 0, 0.5)')
/** The longest LATER there is, a long one in days, and MEANWHILE; each 1.5 s after its cut, up and opaque. */
const CARDS: Array<Partial<TvPicture>> = [{ skipped: 23 * 3600 + 59 * 60, cutAt: 1e12 - 1500 }, { skipped: 3 * 86400 + 23 * 3600, cutAt: 1e12 - 1500 }, { meanwhile: true, cutAt: 1e12 - 1500 }]

afterEach(() => setBroadcastForTest(null))

/** 0.6 em a character, as a monospace face. */
const mono = (t: string, px: number): number => Array.from(t).length * px * 0.6
const frame = (over: Partial<CardFrame>): CardFrame => ({ width: 1920, left: 440, right: 1450, top: 92, rowBottom: 420, floor: 900, blocks: [], margin: 115, s: 1, px: 24, ...over })
const FULL = '▶▶ 23 HOURS 59 MINUTES LATER'
const SHORT = '▶▶ 23 HOURS LATER'
/** What a gap `w` wide must be for `lines` at `k` of 24 px. */
const need = (lines: string[], k: number): number => Math.max(...lines.map((l) => mono(l, 24 * k))) + 2 * CARD_PAD_PX + 2 * CARD_CLEAR_PX

describe('placeCard', () => {
  it('in the gap, centred on the frame, its top on the top margin, at its own size', () => {
    const c = placeCard(FULL, SHORT, frame({}), mono)
    expect(c).toMatchObject({ inRow: true, lines: [FULL], px: 24, cx: 960, y: 92, h: CARD_H_PX })
    expect(c.w).toBeCloseTo(mono(FULL, 24) + 2 * CARD_PAD_PX, 6)
    expect(c.baseline - 0.35 * c.px).toBeCloseTo(c.y + c.h / 2, 6)
  })

  it('off the frame\'s centre only as far as it must to keep clear of either side', () => {
    const w = mono(FULL, 24) + 2 * CARD_PAD_PX
    expect(placeCard(FULL, SHORT, frame({ left: 900 }), mono).x).toBeCloseTo(900 + CARD_CLEAR_PX, 6)
    const right = placeCard(FULL, SHORT, frame({ left: 100, right: 1000 }), mono)
    expect(right.x + w).toBeCloseTo(1000 - CARD_CLEAR_PX, 6)
  })

  it('shrinks to fit, never under CARD_LEAST; then the largest unit; then under the top row', () => {
    const shrunk = placeCard(FULL, SHORT, frame({ left: 0, right: need([FULL], 0.9) }), mono)
    expect(shrunk).toMatchObject({ inRow: true, lines: [FULL] })
    expect(shrunk.px).toBeCloseTo(24 * 0.9, 6)
    expect(placeCard(FULL, SHORT, frame({ left: 0, right: need([FULL], CARD_LEAST) - 1 }), mono)).toMatchObject({ inRow: true, lines: [SHORT], px: 24 })
    const under = placeCard(FULL, SHORT, frame({ left: 0, right: need([SHORT], CARD_LEAST) - 1 }), mono)
    expect(under).toMatchObject({ inRow: false, lines: [FULL], px: 24, cx: 960, y: 420 + CARD_CLEAR_PX })
  })

  it('under the top row keeps within the margins, the largest unit first', () => {
    const narrow = frame({ width: 390, left: 160, right: 200, margin: 23, rowBottom: 210, px: 12.6, s: 0.9 })
    const c = placeCard(FULL, SHORT, narrow, mono)
    expect(c).toMatchObject({ inRow: false, lines: [FULL], cx: 195 })
    expect(c.x).toBeGreaterThanOrEqual(23)
    expect(c.x + c.w).toBeLessThanOrEqual(390 - 23)
    const tiny = placeCard(FULL, SHORT, { ...narrow, width: 200, margin: 10 }, mono)
    expect(tiny.lines).toEqual([SHORT])
    expect(tiny.w).toBeLessThanOrEqual(200 - 20 + 1e-9)
    // A frame narrower than its padding: no words room, never negative.
    expect(placeCard(FULL, SHORT, { ...narrow, width: 40, margin: 10 }, mono).maxWords).toBe(0)
  })

  it('where under the top row would reach the chiron or NOW PLAYING: two lines in the gap, then its least size', () => {
    // Too narrow for the largest unit on one line at CARD_LEAST, wide enough for two lines at 80%.
    const gap = need(['▶▶ 23 HOURS 59', 'MINUTES LATER'], 0.8)
    expect(gap).toBeLessThan(need([SHORT], CARD_LEAST))
    const low = frame({ left: 0, right: gap, floor: 420 + CARD_CLEAR_PX + CARD_H_PX - 1 })
    const two = placeCard(FULL, SHORT, low, mono)
    expect(two).toMatchObject({ inRow: true, y: 92 })
    expect(two.px).toBeCloseTo(24 * 0.8, 6)
    expect(two.lines).toEqual(['▶▶ 23 HOURS 59', 'MINUTES LATER'])
    expect(two.h).toBeCloseTo(CARD_H_PX + CARD_LINE_EM * 24 * 0.8, 6)
    // Its two lines sit in the middle of its ground.
    expect((two.baseline - 0.35 * two.px + two.baseline + CARD_LINE_EM * two.px - 0.35 * two.px) / 2).toBeCloseTo(two.y + two.h / 2, 6)
    // NOW PLAYING under the top row does the same.
    const np = frame({ left: 0, right: gap, blocks: [{ x0: 0, y0: 430, x1: 1920, y1: 500 }] })
    expect(placeCard(FULL, SHORT, np, mono).inRow).toBe(true)
    // The arrows never stand alone on a line: MEANWHILE is one word after them.
    const mw = placeCard('◀◀ MEANWHILE', '◀◀ MEANWHILE', frame({ left: 0, right: need(['◀◀ MEANWHILE'], 0.6), floor: 0 }), mono)
    expect(mw).toMatchObject({ inRow: true, lines: ['◀◀ MEANWHILE'] })
    expect(mw.px).toBeCloseTo(24 * 0.6, 6)
    expect(mw.px).toBeGreaterThanOrEqual(24 * CARD_FLOOR)
  })
})

describe('clearOfPanel', () => {
  const s = 1
  const f = frame({ floor: 900 })
  const c = placeCard(SHORT, SHORT, f, mono)
  const h = c.h
  const ink = (y: number, over: Partial<PanelInk> = {}): PanelInk => ({ panel: { x0: 200, y0: y, x1: 1400, y1: y + 300 }, content: { x0: 200, y0: y + 20, x1: 1400, y1: y + 300 }, bursts: [], ...over })

  it('leaves a card clear of the panel as it is', () => {
    expect(clearOfPanel(c, ink(92 + h + CARD_CLEAR_PX + 1), f, 37, mono)).toBe(c)
  })

  it('rises into the top margin, at its own size, to end clear above the panel', () => {
    const k = clearOfPanel(c, ink(92 + h), f, 37, mono)
    expect(k).toMatchObject({ y: 92 - CARD_CLEAR_PX - 1e-9 * 0, h, px: 24, cx: c.cx })
  })

  it('then on the panel\'s border, clear of what it shows and of its bursts', () => {
    const tab = clearOfPanel(c, ink(70), f, 37, mono)
    expect(tab.h).toBe(h)
    expect(tab.y + tab.h).toBeLessThanOrEqual(90 - 2 * s + 1e-9)
    expect(tab.y).toBeGreaterThanOrEqual(37)
    // A burst over the card's width, poking up past the border: the tab keeps above it.
    const burst = { x0: 900, y0: 80, x1: 1000, y1: 180 }
    const withBurst = clearOfPanel(c, ink(70, { bursts: [burst] }), f, 37, mono)
    expect(meets({ x0: withBurst.x, y0: withBurst.y, x1: withBurst.x + withBurst.w, y1: withBurst.y + withBurst.h }, burst)).toBe(false)
  })

  it('then under the panel, centred on the frame, above the chiron and off NOW PLAYING', () => {
    const full = { x0: 200, y0: 40, x1: 1400, y1: 400 }
    const under = clearOfPanel(c, { panel: full, content: full, bursts: [] }, f, 37, mono)
    expect(under).toMatchObject({ y: 400 + CARD_CLEAR_PX, cx: 960, h })
    // A card under the top row (a phone held upright) never rises, and goes under.
    const low = { ...c, inRow: false, y: 300 }
    expect(clearOfPanel(low, ink(250), f, 37, mono).y).toBe(250 + 300 + CARD_CLEAR_PX)
  })

  it('then beside the panel, in the highest free place of the column right of it (a small phone on its side)', () => {
    const tall = { x0: 200, y0: 40, x1: 1400, y1: 880 }
    const beside = clearOfPanel(c, { panel: tall, content: tall, bursts: [] }, f, 37, mono)
    expect(beside).toMatchObject({ y: 37, h, px: 24, lines: [SHORT] })
    expect(beside.x).toBeGreaterThanOrEqual(1400 + CARD_CLEAR_PX)
    expect(beside.x + beside.w).toBeLessThanOrEqual(1920 - 115)
    // Something in that column above (the logo's column): under it.
    const logo = { x0: 1450, y0: 0, x1: 1920, y1: 300 }
    expect(clearOfPanel(c, { panel: tall, content: tall, bursts: [] }, { ...f, blocks: [logo] }, 37, mono).y).toBe(300)
    // Two lines from the gap go back to one where the column is wide enough.
    const pair = { ...c, lines: ['▶▶ 23', 'HOURS LATER'], h: h + CARD_LINE_EM * 24 }
    expect(clearOfPanel(pair, { panel: tall, content: tall, bursts: [] }, f, 37, mono)).toMatchObject({ lines: [SHORT], h })
  })

  it('then, with no room under or beside, smaller at the top, never under CARD_FLOOR', () => {
    const full = { x0: 0, y0: 40, x1: 1920, y1: 880 }
    const small = clearOfPanel(c, { panel: full, content: { ...full, y0: 37 + h * 0.7 + 2 }, bursts: [] }, f, 37, mono)
    expect(small.y).toBe(37)
    expect(small.h).toBeCloseTo(h * 0.7, 6)
    expect(small.px).toBeCloseTo(24 * 0.7, 6)
    expect(small.x + small.w / 2).toBeCloseTo(c.cx, 6)
    expect(clearOfPanel(c, { panel: full, content: full, bursts: [] }, f, 37, mono).h).toBeCloseTo(h * CARD_FLOOR, 6)
  })
})

/** Sizes, CSS px and pixel ratio: the stream's captures, desktops, and phones upright and on their sides (review of #469 added the small ones). */
const FRAMES: Array<[number, number, number]> = [
  [1920, 1080, 1], [1280, 720, 1], [1366, 768, 1], [2560, 1440, 1], [720, 720, 1], [720, 720, 1.5],
  [390, 844, 1], [390, 844, 3], [375, 667, 2], [360, 740, 3], [360, 800, 3], [414, 736, 3], [320, 568, 2], [412, 915, 2.625],
  [844, 390, 1], [667, 375, 2], [568, 320, 2], [640, 360, 3], [740, 360, 3], [932, 430, 3],
]
const MODES: Array<BroadcastTextSize | null> = [null, 'large', 'xl']

describe('the card on the tube', () => {
  it('top centre, or as near as it can: never on the minimap, the logo, the clock, the address, the chiron, NOW PLAYING, or what a panel shows', async () => {
    const silent = assets.music
    const issues: string[] = []
    try {
      for (const mode of MODES) {
        setBroadcastForTest(mode !== null, mode ?? 'normal')
        for (const [w, h, scale] of FRAMES) {
          const W = w * scale
          const H = h * scale
          // At 320 CSS px wide a panel beside the clock is about 23 px wide and
          // its own words run out of it, card or no card (a follow-up of its own).
          if (w === 320) continue
          // The stream never captures a 568x320 frame; there, with its address
          // under the clock, a panel leaves the card no free place at all.
          if (mode !== null && w === 568) continue
          for (const m of [silent, null]) {
            assets.music = m
            for (const shot of KINDS) {
              for (const cardState of CARDS) {
                for (const into of shot.kind === 'trip' ? [1500] : [1500, 700 + 600 + 50]) {
                  const at = `${mode ?? 'site'} ${w}x${h}@${scale} ${shot.kind}${m ? '' : ' no music'} ${cardState.meanwhile ? 'MEANWHILE' : cardState.skipped} +${into}`
                  const { texts, rects } = paintAt(picture({ shot: shot as never, ...cardState }), w, h, 1e12, scale, into)
                  const cards = rects.filter(isCard)
                  if (cards.length !== 1) { issues.push(`${at}: ${cards.length} cards`); continue }
                  const card = cards[0]
                  const words = texts.filter((t) => t.seq > card.seq && t.seq <= card.seq + 2 && t.look.font === texts.find((u) => u.seq === card.seq + 1)?.look.font)
                  if (words.length === 0) { issues.push(`${at}: no words`); continue }
                  const said = words.map((t) => t.text).join(' ')
                  if (!cardState.meanwhile && !/^▶▶ \d+ \w+( \d+ \w+)? LATER$/.test(said)) issues.push(`${at}: says "${said}"`)
                  for (const t of words) if (!inside(t.box, { ...card, y0: card.y0 - t.size * 0.3, y1: card.y1 + t.size * 0.3 })) issues.push(`${at}: "${t.text}" off its card`)
                  if (!inside(card, { x0: 0, y0: 0, x1: W, y1: H })) issues.push(`${at}: off the frame`)
                  // Off the minimap: as far as its drawing reaches at any time (the sun swings past its square).
                  const map = rects.find((r) => r.radial && Math.abs((r.x1 - r.x0) - (r.y1 - r.y0)) < 1e-6 && r.x0 < W / 4)
                  if (map) {
                    const side = (map.x1 - map.x0) / 1.3
                    const cx = (map.x0 + map.x1) / 2
                    const cy = (map.y0 + map.y1) / 2
                    if (meets(card, { x0: cx - 0.68 * side, y0: cy - 0.68 * side, x1: cx + 0.68 * side, y1: cy + 0.68 * side })) issues.push(`${at}: on the minimap's reach`)
                  }
                  // A segment's panel: its ground and, drawn straight after, its border on the same box.
                  const panel = shot.kind === 'trip' ? undefined : rects.filter((r, i) => r.look.ink === 'gradient' && !r.radial && !r.path && r.seq < card.seq && rects[i + 1] !== undefined && rects[i + 1].seq === r.seq + 1 && Math.abs(rects[i + 1].x0 - r.x0) < 1.5 && Math.abs(rects[i + 1].y1 - r.y1) < 1.5 && r.x1 - r.x0 > 20 * scale).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0]
                  const isPanel = (r: Box): boolean => panel !== undefined && Math.abs(r.x0 - panel.x0) < 1.5 && Math.abs(r.y0 - panel.y0) < 1.5 && Math.abs(r.x1 - panel.x1) < 1.5
                  for (const t of texts) if (!words.includes(t) && meets(card, t.box)) issues.push(`${at}: on "${t.text}"`)
                  for (const r of rects) if (r !== card && !r.radial && !isPanel(r) && meets(card, r)) issues.push(`${at}: on ${r.path ? 'path' : 'rect'} ${r.look.ink} ${JSON.stringify([r.x0, r.y0, r.x1, r.y1].map(Math.round))} card ${JSON.stringify([card.x0, card.y0, card.x1, card.y1].map(Math.round))}`)
                }
              }
            }
          }
        }
      }
    } finally {
      assets.music = silent
    }
    if (process.env.CARD_ISSUES) (await import('node:fs')).writeFileSync(process.env.CARD_ISSUES, issues.join('\n'))
    expect(issues.slice(0, 40), `${issues.length} issues`).toEqual([])
  }, 120_000)

  it('panels lie exactly as they do with no card', () => {
    for (const mode of MODES) {
      setBroadcastForTest(mode !== null, mode ?? 'normal')
      for (const [w, h, scale] of FRAMES) {
        for (const shot of KINDS.slice(1)) {
          const panelOf = (over: Partial<TvPicture>): unknown => paintAt(picture({ shot: shot as never, ...over }), w, h, 1e12, scale).rects.filter((r) => !isCard(r)).map(({ seq: _seq, ...r }) => r)
          expect(panelOf(CARDS[0]), `${mode} ${w}x${h}@${scale} ${shot.kind}`).toEqual(panelOf({ cutAt: 1e12 - 1500 }))
        }
      }
    }
  }, 120_000)

  it('wide, it is in the gap at the top margin, centred on the frame or 12 px off the logo\'s column', () => {
    for (const mode of MODES) {
      setBroadcastForTest(mode !== null, mode ?? 'normal')
      const { texts, rects } = paintAt(picture({ shot: trip as never, ...CARDS[0] }), 1920, 1080)
      const card = rects.find(isCard)!
      const logo = rects.find((r) => r.look.ink === 'image')!
      expect(card.y0, `${mode}`).toBeCloseTo(Math.round(1080 * 0.085), 6)
      const cx = (card.x0 + card.x1) / 2
      const s = 1.35 * (mode === null ? 1 : mode === 'large' ? 2.25 : 2.6)
      const column = Math.min(logo.x0, ...texts.filter((t) => t.box.x0 > 960 && t.box.y1 < 1080 / 2).map((t) => t.box.x0))
      if (Math.abs(cx - 960) > 1e-6) expect(card.x1, `${mode}`).toBeCloseTo(column - CARD_CLEAR_PX * s, 6)
      if (mode === null) {
        expect(cx).toBeCloseTo(960, 6)
        expect(texts.find((t) => t.seq === card.seq + 1)!.text).toBe(FULL)
      }
    }
  })

  it('comes and goes as it did: up CUT_MS after the cut for CARD_MS, in over 8%, out over the last 20%', () => {
    setBroadcastForTest(false)
    const alphaAt = (ms: number): number | null => {
      const { rects } = paintAt(picture({ shot: trip as never, skipped: 7200, cutAt: 1e12 - ms }), 1920, 1080)
      const card = rects.find(isCard)
      return card ? card.look.alpha : null
    }
    expect(alphaAt(CUT_MS - 10)).toBeNull()
    expect(alphaAt(CUT_MS + CARD_MS * 0.04)).toBeCloseTo(0.5, 6)
    expect(alphaAt(CUT_MS + CARD_MS * 0.5)).toBe(1)
    expect(alphaAt(CUT_MS + CARD_MS * 0.9)).toBeCloseTo(0.5, 6)
    expect(alphaAt(CUT_MS + CARD_MS + 10)).toBeNull()
    // Under a minute skipped, or the tape not playing, no card.
    expect(paintAt(picture({ shot: trip as never, skipped: 59, cutAt: 1e12 - 1500 }), 1920, 1080).rects.filter(isCard)).toEqual([])
    expect(paintAt(picture({ shot: trip as never, status: 'end', skipped: 7200, cutAt: 1e12 - 1500 }), 1920, 1080).rects.filter(isCard)).toEqual([])
  })
})

describe('the card over an explainer (#485: the live picture\'s words step away with it)', () => {
  it('not drawn while one is on (coming in, playing, going out), on the site and the stream, and back after', () => {
    const [w, h] = [1920, 1080]
    const { pip, video } = explainerLayout(w, h, 16 / 9, MARGIN_X, MARGIN_Y, h * (1 - MARGIN_Y) - 32)
    for (const mode of [null, 'large', 'xl'] as Array<BroadcastTextSize | null>) {
      setBroadcastForTest(mode !== null, mode ?? 'normal')
      for (const shot of [trip, segmentShot(comment)]) {
        const at = `${mode ?? 'site'} ${shot.kind}`
        const p = picture({ shot: shot as never, ...CARDS[0] })
        expect(paintAt(p, w, h).rects.filter(isCard).length, `${at} before`).toBe(1)
        for (const mix of [0.05, 0.5, 1]) {
          const during = paintAt(p, w, h, 1e12, 1, 1500, { ...assets, explainer: { title: 'Welcome to Cyberspace', mix, pip, video, caption: null, pipShown: false } })
          expect(during.rects.filter(isCard).length, `${at} mix ${mix}`).toBe(0)
          expect(during.texts.some((t) => /LATER$/.test(t.text)), `${at} mix ${mix}`).toBe(false)
        }
        expect(paintAt(p, w, h).rects.filter(isCard).length, `${at} after`).toBe(1)
      }
    }
  })
})
