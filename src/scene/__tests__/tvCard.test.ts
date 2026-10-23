/**
 * tvCard.test.ts: a cut's LATER or MEANWHILE card, top centre between the
 * minimap and the logo (arkinox, 2026-10-23: "I don't like it appearing over
 * the chiron"). The placing rule (scene/tvCard.ts) on its own, and the
 * painter's card at the site's TV and the stream's text sizes, wide and on
 * a phone: it meets nothing else TV paints, and comes and goes as it did.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ query: async () => [], queryEach: async () => [], queryAny: async () => [], publish: async () => ({ ok: true }), publishMany: async () => ({ ok: true }), relaySet: () => [] }))
import { CARD_MS, TvPainter, type TvAssets, type TvPicture } from '../tvPainter'
import { CARD_CLEAR_PX, CARD_FLOOR, CARD_H_PX, CARD_LEAST, CARD_PAD_PX, fitAbove, placeCard, type CardFrame } from '../tvCard'
import { CUT_MS } from '../../hud/TvSegments'
import { useTv } from '../../store/useTv'
import { broadcastScale, setBroadcastForTest, type BroadcastTextSize } from '../../lib/tv/broadcast'

interface Box { x0: number; y0: number; x1: number; y1: number }
interface Look { font: string; ink: string; alpha: number }
interface Text { text: string; x: number; y: number; size: number; box: Box; look: Look; seq: number }
type Rect = Box & { radial: boolean; look: Look; seq: number }

/** A canvas that keeps each text, rectangle and picture it is given, as boxes on the frame; type measures 0.6 em a character. */
function recording(): { canvas: HTMLCanvasElement; texts: Text[]; rects: Rect[] } {
  const texts: Text[] = []
  const rects: Rect[] = []
  let seq = 0
  const state: Record<string, unknown> = { globalAlpha: 1, font: '10px x', textAlign: 'start', fillStyle: '#000' }
  const stack: Array<{ dx: number; dy: number; k: number; st: Record<string, unknown> }> = []
  let dx = 0
  let dy = 0
  let k = 1
  const look = (): Look => ({ font: String(state.font), ink: typeof state.fillStyle === 'string' ? state.fillStyle : 'gradient', alpha: Number(state.globalAlpha) })
  const size = (): number => Number(/([\d.]+)px/.exec(String(state.font))?.[1] ?? 10)
  const width = (t: string): number => Array.from(t).length * size() * 0.6
  const box = (x: number, y: number, w: number, h: number): Box => ({ x0: dx + k * Math.min(x, x + w), y0: dy + k * Math.min(y, y + h), x1: dx + k * Math.max(x, x + w), y1: dy + k * Math.max(y, y + h) })
  const rect = (x: number, y: number, w: number, h: number): void => {
    rects.push({ ...box(x, y, w, h), radial: (state.fillStyle as { radial?: boolean })?.radial === true, look: look(), seq: seq++ })
  }
  const ctx = new Proxy({
    measureText: (t: string) => ({ width: width(t) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {}, radial: true }),
    fillText: (text: string, x: number, y: number) => {
      const w = width(text)
      const align = String(state.textAlign)
      const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
      texts.push({ text, x: dx + k * x, y: dy + k * y, size: size() * k, box: box(left, y - size(), w, size() * 1.3), look: look(), seq: seq++ })
    },
    fillRect: rect,
    strokeRect: rect,
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => { rects.push({ ...box(x, y, w, h), radial: false, look: { ...look(), ink: 'image' }, seq: seq++ }) },
    translate: (x: number, y: number) => { dx += k * x; dy += k * y },
    scale: (a: number) => { k *= a },
    save: () => { stack.push({ dx, dy, k, st: { ...state } }) },
    restore: () => { const top = stack.pop(); if (top) { dx = top.dx; dy = top.dy; k = top.k; Object.assign(state, top.st) } },
  } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
    set: (_t, key, v) => { state[key as string] = v; return true },
  })
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, texts, rects }
}

const music = { title: 'A TRACK WITH A LONG NAME', artist: 'AN ARTIST', art: null, progress: 0.4, blocked: false, volume: 1, muted: false }
// A logo to draw, so its picture is on the record.
const assets: TvAssets = { name: (pk) => pk.toUpperCase(), picture: () => null, logo: {} as HTMLImageElement, spin: null, segmentShard: null, color: () => '#fff', music, watching: 12 }

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

/** Paint once at `w` x `h` and `now`, after a first paint as the set paints on. */
function paintAt(p: TvPicture, w: number, h: number, now = 1e12, scale = 1): ReturnType<typeof recording> {
  vi.spyOn(performance, 'now').mockReturnValue(now)
  if (p.shot) useTv.setState({ shot: p.shot, status: p.status })
  const rec = recording()
  const painter = new TvPainter(rec.canvas)
  painter.size(w, h, scale)
  painter.paint(p, assets, now - 33, scale, false)
  rec.texts.length = 0
  rec.rects.length = 0
  painter.paint(p, assets, now, scale, false)
  vi.restoreAllMocks()
  return rec
}

const meets = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
const inside = (a: Box, b: Box): boolean => a.x0 >= b.x0 - 0.5 && a.x1 <= b.x1 + 0.5 && a.y0 >= b.y0 - 0.5 && a.y1 <= b.y1 + 0.5
const isCard = (r: { look: Look }): boolean => r.look.ink === 'rgba(2, 12, 20, 0.94)' || r.look.ink === 'rgba(0, 0, 0, 0.5)'
/** The longest LATER there is, and MEANWHILE; each 1.5 s after its cut, up and opaque. */
const CARDS: Array<Partial<TvPicture>> = [{ skipped: 23 * 3600 + 59 * 60, cutAt: 1e12 - 1500 }, { skipped: 3 * 86400 + 23 * 3600, cutAt: 1e12 - 1500 }, { meanwhile: true, cutAt: 1e12 - 1500 }]

afterEach(() => setBroadcastForTest(null))

describe('placeCard', () => {
  /** 0.6 em a character, as a monospace face. */
  const mono = (t: string, px: number): number => Array.from(t).length * px * 0.6
  const frame = (over: Partial<CardFrame>): CardFrame => ({ width: 1920, left: 440, right: 1450, top: 92, rowBottom: 420, margin: 115, s: 1, px: 24, ...over })
  const FULL = '▶▶ 23 HOURS 59 MINUTES LATER'
  const SHORT = '▶▶ 23 HOURS LATER'

  it('in the gap, centred on the frame, its top on the top margin, at its own size', () => {
    const c = placeCard(FULL, SHORT, frame({}), mono)
    expect(c).toMatchObject({ inRow: true, words: FULL, px: 24, cx: 960, y: 92, h: CARD_H_PX })
    expect(c.w).toBeCloseTo(mono(FULL, 24) + 2 * CARD_PAD_PX, 6)
  })

  it('off the frame\'s centre only as far as it must to keep clear of either side', () => {
    const w = mono(FULL, 24) + 2 * CARD_PAD_PX
    const left = placeCard(FULL, SHORT, frame({ left: 900 }), mono)
    expect(left.inRow).toBe(true)
    expect(left.x).toBeCloseTo(900 + CARD_CLEAR_PX, 6)
    const right = placeCard(FULL, SHORT, frame({ left: 100, right: 1000 }), mono)
    expect(right.x + w).toBeCloseTo(1000 - CARD_CLEAR_PX, 6)
  })

  it('shrinks to fit, never under CARD_LEAST; then the largest unit; then under the top row', () => {
    const need = (t: string, k: number): number => mono(t, 24 * k) + 2 * CARD_PAD_PX + 2 * CARD_CLEAR_PX
    const shrunk = placeCard(FULL, SHORT, frame({ left: 0, right: need(FULL, 0.9) }), mono)
    expect(shrunk).toMatchObject({ inRow: true, words: FULL })
    expect(shrunk.px).toBeCloseTo(24 * 0.9, 6)
    const short = placeCard(FULL, SHORT, frame({ left: 0, right: need(FULL, CARD_LEAST) - 1 }), mono)
    expect(short).toMatchObject({ inRow: true, words: SHORT, px: 24 })
    const under = placeCard(FULL, SHORT, frame({ left: 0, right: need(SHORT, CARD_LEAST) - 1 }), mono)
    expect(under).toMatchObject({ inRow: false, words: FULL, px: 24, cx: 960, y: 420 + CARD_CLEAR_PX })
  })

  it('under the top row keeps within the margins, the largest unit first', () => {
    const narrow = frame({ width: 390, left: 160, right: 200, margin: 23, rowBottom: 210, px: 12.6, s: 0.9 })
    const c = placeCard(FULL, SHORT, narrow, mono)
    expect(c).toMatchObject({ inRow: false, words: FULL, cx: 195 })
    expect(c.x).toBeGreaterThanOrEqual(23)
    expect(c.x + c.w).toBeLessThanOrEqual(390 - 23)
    const tiny = placeCard(FULL, SHORT, { ...narrow, width: 200, margin: 10 }, mono)
    expect(tiny.words).toBe(SHORT)
    expect(tiny.w).toBeLessThanOrEqual(200 - 20 + 1e-9)
  })

  it('its words in the middle of its ground', () => {
    const c = placeCard(FULL, SHORT, frame({}), mono)
    expect(c.baseline - 0.35 * c.px).toBeCloseTo(c.y + c.h / 2, 6)
  })
})

describe('fitAbove', () => {
  const mono = (t: string, px: number): number => Array.from(t).length * px * 0.6
  const c = placeCard('▶▶ 2 HOURS LATER', '▶▶ 2 HOURS LATER', { width: 1920, left: 100, right: 1800, top: 100, rowBottom: 400, margin: 115, s: 3, px: 54 }, mono)
  const h = CARD_H_PX * 3

  it('leaves a card that already ends above the first limit as it is', () => {
    expect(fitAbove(c, [100 + h + 1, 500], 40)).toBe(c)
    expect(fitAbove(c, [], 40)).toBe(c)
  })

  it('rises first, to the first limit it can meet with its top no higher than minTop, at its own size', () => {
    const clear = fitAbove(c, [100 + h - 30, 400], 40)
    expect(clear).toMatchObject({ y: 100 - 30, h, px: 54, cx: c.cx, w: c.w })
    // The first limit asks too much: the second, on the panel's border.
    const border = fitAbove(c, [100 + h - 90, 100 + h - 20], 40)
    expect(border).toMatchObject({ y: 100 - 20, h, px: 54 })
  })

  it('then shrinks at minTop, type, padding and height together, about its centre, never under CARD_FLOOR', () => {
    const f = fitAbove(c, [0, 40 + h * 0.8], 40)
    expect(f.y).toBe(40)
    expect(f.h).toBeCloseTo(h * 0.8, 6)
    expect(f.px).toBeCloseTo(54 * 0.8, 6)
    expect(f.pad).toBeCloseTo(c.pad * 0.8, 6)
    expect(f.x + f.w / 2).toBeCloseTo(c.cx, 6)
    expect(f.w).toBeCloseTo((c.w - 2 * c.pad) * 0.8 + 2 * c.pad * 0.8, 6)
    expect(f.baseline - 0.35 * f.px).toBeCloseTo(f.y + f.h / 2, 6)
    expect(fitAbove(c, [0, 41], 40).h).toBeCloseTo(h * CARD_FLOOR, 6)
  })

  it('never goes lower than it was', () => {
    // A minTop under its top (a card under the top row is given its own top) keeps it there.
    expect(fitAbove(c, [0, 100 + h * 0.5], 100).y).toBe(100)
  })
})

describe('the card on the tube', () => {
  /** The site's TV, the stream's two larger sizes; wide, a phone upright and on its side, and the stream's other captures. */
  const MODES: Array<BroadcastTextSize | null> = [null, 'large', 'xl']
  const FRAMES: Array<[number, number, number]> = [[1920, 1080, 1], [1280, 720, 1], [720, 720, 1], [720, 720, 1.5], [390, 844, 1], [390, 844, 3], [844, 390, 1], [412, 915, 2.625]]

  it('top centre, between the minimap and the logo, or just under them: never over the chiron, NOW PLAYING, a panel or anything else', () => {
    const silent = assets.music
    try {
      for (const mode of MODES) {
        setBroadcastForTest(mode !== null, mode ?? 'normal')
        for (const [w, h, scale] of FRAMES) {
          // A phone on its side is the site's: the stream never captures it,
          // and there its xl panels run onto the chiron with no card at all.
          if (mode === 'xl' && w === 844) continue
          const W = w * scale
          const H = h * scale
          for (const m of [silent, null]) {
            assets.music = m
            for (const shot of KINDS) {
              for (const cardState of CARDS) {
                const at = `${mode ?? 'site'} ${w}x${h}@${scale} ${shot.kind}${m ? '' : ' no music'} ${cardState.meanwhile ? 'MEANWHILE' : cardState.skipped}`
                const { texts, rects } = paintAt(picture({ shot: shot as never, ...cardState }), w, h, 1e12, scale)
                const cards = rects.filter(isCard)
                expect(cards, at).toHaveLength(1)
                const card = cards[0]
                const words = texts.find((t) => t.seq === card.seq + 1)!
                expect(words, `${at}: words`).toBeDefined()
                if (!cardState.meanwhile) expect(words.text, at).toMatch(/^▶▶ \d+ \w+( \d+ \w+)? LATER$/)
                // Its words on it, the card in the frame, in its top half.
                expect(inside(words.box, { ...card, y0: card.y0 - words.size * 0.3, y1: card.y1 + words.size * 0.3 }), `${at}: words ${JSON.stringify(words.box)} on ${JSON.stringify(card)}`).toBe(true)
                expect(inside(card, { x0: 0, y0: 0, x1: W, y1: H }), `${at}: in the frame`).toBe(true)
                expect(card.y1, `${at}: top half`).toBeLessThan(H / 2)
                // Off the minimap: as far as its drawing reaches (the sun swings
                // past its square), from its ground's centre.
                // (Its ground is square; a snowy shot's soft backing behind the logo is not.)
                const map = rects.find((r) => r.radial && Math.abs((r.x1 - r.x0) - (r.y1 - r.y0)) < 1e-6 && r.x0 < W / 4)
                if (map) {
                  const side = (map.x1 - map.x0) / 1.3
                  const cx = (map.x0 + map.x1) / 2
                  const cy = (map.y0 + map.y1) / 2
                  const reach = { x0: cx - 0.68 * side, y0: cy - 0.68 * side, x1: cx + 0.68 * side, y1: cy + 0.68 * side }
                  expect(meets(card, reach), `${at}: card ${JSON.stringify(card)} on the minimap ${JSON.stringify(reach)}`).toBe(false)
                }
                // Off every other word TV writes (the clock, the address, the
                // chiron, NOW PLAYING, a panel's) and every ground and picture
                // (the logo, the chiron, NOW PLAYING, a panel's model, the marquee).
                for (const t of texts) if (t !== words) expect(meets(card, t.box), `${at}: card ${JSON.stringify(card)} on "${t.text}" ${JSON.stringify(t.box)}`).toBe(false)
                // A segment's panel: the largest gradient ground in the top part
                // of the frame. Where it fills its room the card may stand on its
                // top border, never further in than its padding (what it shows
                // starts under that).
                const panel = shot.kind === 'trip' ? undefined : rects.filter((r) => r.look.ink === 'gradient' && !r.radial && r.seq < card.seq && r.x1 - r.x0 > 150 * scale && r.y0 < H * 0.6).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0]
                if (shot.kind !== 'trip') expect(panel, `${at}: a panel`).toBeDefined()
                const isPanel = (r: Box): boolean => panel !== undefined && Math.abs(r.x0 - panel.x0) < 1.5 && Math.abs(r.y0 - panel.y0) < 1.5
                if (panel && meets(card, panel)) {
                  const grow = Math.min(1.35, Math.max(0.9, w / 1400))
                  const s0 = scale * grow
                  const s = s0 * broadcastScale(grow, w, 1.35)
                  const pad = (w < 600 ? 16 : s > s0 ? 14 : 24) * s
                  expect(card.y1, `${at}: card ${JSON.stringify(card)} past the panel's border ${JSON.stringify(panel)}`).toBeLessThanOrEqual(panel.y0 + pad + 0.5)
                }
                for (const r of rects) if (r !== card && !r.radial && !isPanel(r)) expect(meets(card, r), `${at}: card ${JSON.stringify(card)} on ${r.look.ink} ${JSON.stringify(r)}`).toBe(false)
              }
            }
          }
        }
      }
    } finally {
      assets.music = silent
    }
  }, 60_000)

  it('wide, it is in the gap at the top margin and centred on the frame', () => {
    for (const mode of MODES) {
      setBroadcastForTest(mode !== null, mode ?? 'normal')
      const { texts, rects } = paintAt(picture({ shot: trip as never, ...CARDS[0] }), 1920, 1080)
      const card = rects.find(isCard)!
      const logo = rects.find((r) => r.look.ink === 'image')!
      expect(card.y0, `${mode}`).toBeCloseTo(Math.round(1080 * 0.085), 6)
      // Centred on the frame, or as near it as the gap lets it be: then 12 px off the logo's column.
      const cx = (card.x0 + card.x1) / 2
      if (Math.abs(cx - 960) > 1e-6) expect(card.x1, `${mode}`).toBeCloseTo(Math.min(logo.x0, ...texts.filter((t) => t.box.x0 > 960 && t.box.y1 < 1080 / 2).map((t) => t.box.x0)) - CARD_CLEAR_PX * (mode === null ? 1.35 : 1.35 * (mode === 'large' ? 2.25 : 2.6)), 6)
      if (mode === null) expect(cx).toBeCloseTo(960, 6)
      expect(card.x1, `${mode}`).toBeLessThan(logo.x0)
      // Fewer words only where it must: all of them on the site's TV.
      if (mode === null) expect(texts.find((t) => t.seq === card.seq + 1)!.text).toBe('▶▶ 23 HOURS 59 MINUTES LATER')
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
    // Under a minute skipped, no card.
    const { rects } = paintAt(picture({ shot: trip as never, skipped: 59, cutAt: 1e12 - 1500 }), 1920, 1080)
    expect(rects.filter(isCard)).toEqual([])
  })
})
