/**
 * tvBroadcastTag.test.ts: the 24/7 stream says WWW.ONOSENDAI.TECH under the
 * clock, top right, for good (arkinox, 2026-10-22), and over the HOSAKA spot
 * in the band the spot keeps clear; never on the site's own TV. It keeps clear
 * of everything else TV paints, and it changes nothing else's place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ query: async () => [], queryEach: async () => [], queryAny: async () => [], publish: async () => ({ ok: true }), publishMany: async () => ({ ok: true }), relaySet: () => [] }))
import { MARGIN_X, MARGIN_Y, TvPainter, type TvAssets, type TvPicture } from '../tvPainter'
import { useTv } from '../../store/useTv'
import { HOSAKA_1 } from '../../lib/tv/hosakaAd'
import { BROADCAST_MAX_DPR, BROADCAST_TAG, broadcastDpr, setBroadcastForTest } from '../../lib/tv/broadcast'

interface Box { x0: number; y0: number; x1: number; y1: number }
/** The drawing state a call inked with: the font, the ink, how opaque, the shadow. */
interface Look { font: string; ink: string; alpha: number; shadow: string }
interface Text { text: string; x: number; y: number; size: number; align: string; box: Box; look: Look; seq: number }

/** A canvas that keeps each text, rectangle, picture and translation it is given, as boxes on the frame (through translate and scale); type measures 0.6 em a character. */
function recording(): { canvas: HTMLCanvasElement; texts: Text[]; rects: Array<Box & { radial: boolean; look: Look; seq: number }>; spots: Array<{ x: number; y: number }> } {
  const texts: Text[] = []
  const rects: Array<Box & { radial: boolean; look: Look; seq: number }> = []
  /** Each drawing call's place in the paint, for what is drawn over what. */
  let seq = 0
  const spots: Array<{ x: number; y: number }> = []
  const state: Record<string, unknown> = { globalAlpha: 1, font: '10px x', textAlign: 'start', fillStyle: '#000', shadowColor: 'rgba(0, 0, 0, 0)', shadowBlur: 0 }
  const stack: Array<{ dx: number; dy: number; k: number; st: Record<string, unknown> }> = []
  let dx = 0
  let dy = 0
  let k = 1
  const look = (): Look => ({
    font: String(state.font),
    ink: typeof state.fillStyle === 'string' ? state.fillStyle : 'gradient',
    alpha: Number(state.globalAlpha),
    shadow: `${String(state.shadowColor ?? '')} ${String(state.shadowBlur ?? 0)}`,
  })
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
      texts.push({ text, x: dx + k * x, y: dy + k * y, size: size() * k, align, box: box(left, y - size(), w, size() * 1.3), look: look(), seq: seq++ })
    },
    fillRect: rect,
    strokeRect: rect,
    drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => { rects.push({ ...box(x, y, w, h), radial: false, look: { ...look(), ink: 'image' }, seq: seq++ }) },
    translate: (x: number, y: number) => { dx += k * x; dy += k * y; spots.push({ x: dx, y: dy }) },
    scale: (a: number) => { k *= a },
    save: () => { stack.push({ dx, dy, k, st: { ...state } }) },
    restore: () => { const top = stack.pop(); if (top) { dx = top.dx; dy = top.dy; k = top.k; Object.assign(state, top.st) } },
  } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
    set: (_t, key, v) => { state[key as string] = v; return true },
  })
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, texts, rects, spots }
}

const assets: TvAssets = {
  name: (pk) => pk.toUpperCase(), picture: () => null, logo: null, spin: null, segmentShard: null, color: () => '#fff',
  music: { title: 'A TRACK WITH A LONG NAME', artist: 'AN ARTIST', art: null, progress: 0.4, blocked: false, volume: 1, muted: false },
  watching: 12,
}

function picture(over: Partial<TvPicture>): TvPicture {
  return { status: 'playing', shot: null, played: 0, tapeTime: 1_760_000_000, scaleExp: 40, cutAt: 0, skipped: 0, meanwhile: false, census: null, chains: {}, arrivals: [], reactions: [], avatars: {}, ...over }
}

const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
const bag = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: 'ann', at: 1, hint: null, height: 3, money: true, nft: true, counts: { shards: 2, cashu: 1, nft: 1 } as never }
const object = { kind: 'object' as const, id: 'o'.repeat(64), pubkey: 'ann', at: 1, event: {} as never }
const comment = { kind: 'comment' as const, id: 'c'.repeat(64), pubkey: 'ann', at: 1, text: 'word '.repeat(40).trim(), on: 'move' as const, about: null }
const segmentShot = (item: typeof bag | typeof object | typeof comment) => ({ id: item.id, kind: item.kind, item, pubkey: 'ann', beats: [], start: 1, end: 1, offsets: [], length: 30 })

/** Paint once at `w` x `h`, well into the shot (the panels faded in, the splashes landed). */
function paintAt(p: TvPicture, w = 1280, h = 720, now = 1e12, scale = 1): ReturnType<typeof recording> {
  vi.spyOn(performance, 'now').mockReturnValue(now)
  if (p.shot) useTv.setState({ shot: p.shot, status: p.status })
  const rec = recording()
  const painter = new TvPainter(rec.canvas)
  painter.size(w, h, scale)
  // Two paints, as the set paints on: the marquee has its run by the second.
  painter.paint(p, assets, now - 33, scale, false)
  rec.texts.length = 0
  rec.rects.length = 0
  rec.spots.length = 0
  painter.paint(p, assets, now, scale, false)
  vi.restoreAllMocks()
  return rec
}

const meets = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

afterEach(() => setBroadcastForTest(null))

describe('WWW.ONOSENDAI.TECH on the 24/7 stream (arkinox, 2026-10-22)', () => {
  it('is on the stream only: the site\'s TV never says it', () => {
    setBroadcastForTest(false)
    for (const shot of [trip, segmentShot(bag)]) {
      expect(paintAt(picture({ shot: shot as never })).texts.some((t) => t.text.includes('ONOSENDAI.TECH'))).toBe(false)
    }
    setBroadcastForTest(true)
    const tags = paintAt(picture({ shot: trip as never })).texts.filter((t) => t.text === BROADCAST_TAG)
    expect(tags).toHaveLength(1)
  })

  it('stands under the clock, on the logo\'s right edge, in the top right quarter, legible at 720p', () => {
    setBroadcastForTest(true)
    const { texts } = paintAt(picture({ shot: trip as never }))
    const tag = texts.find((t) => t.text === BROADCAST_TAG)!
    expect(tag.align).toBe('right')
    expect(tag.x).toBe(1280 - Math.round(1280 * MARGIN_X))
    const time = texts.find((t) => /^\d\d:\d\d:\d\d$/.test(t.text))!
    expect(tag.x).toBe(time.x)
    expect(tag.y).toBeGreaterThan(time.y + 10)
    expect(tag.box.y1).toBeLessThan(720 / 2)
    expect(tag.box.x0).toBeGreaterThan(1280 / 2)
    // Under the top band where YouTube shows its title and buttons on hover.
    expect(tag.box.y0).toBeGreaterThan(Math.round(720 * MARGIN_Y) + 80)
    expect(tag.size).toBeGreaterThanOrEqual(10.5)
    // In the chiron's accent, a little dim, with a dark edge: subtle, and it reads.
    expect(tag.look.ink).toBe('#00e5ff')
    expect(tag.look.alpha).toBeGreaterThanOrEqual(0.8)
    expect(tag.look.alpha).toBeLessThan(1)
    expect(tag.look.shadow).toMatch(/^rgba\(0, 0, 0, 0\.[5-9]\d*\) [1-9]/)
    expect(tag.look.font).toMatch(/^700 [\d.]+px 'Monaspace Argon'/)
  })

  it('stands still: the same place tuning, with no signal, on a trip and in a segment', () => {
    setBroadcastForTest(true)
    const at = [
      picture({ status: 'tuning', tapeTime: null }),
      picture({ status: 'no-signal', tapeTime: null }),
      picture({ shot: trip as never }),
      picture({ shot: segmentShot(bag) as never }),
    ].map((p) => paintAt(p).texts.find((t) => t.text === BROADCAST_TAG)!)
    for (const t of at) expect({ x: t.x, y: t.y, size: t.size, look: t.look }).toEqual({ x: at[0].x, y: at[0].y, size: at[0].size, look: at[0].look })
    // And over time: no blink, no fade, frame after frame.
    const over = [0, 250, 500, 700, 1300, 4000, 61_000].map((ms) => paintAt(picture({ shot: trip as never }), 1280, 720, 1e12 + ms).texts.find((t) => t.text === BROADCAST_TAG)!)
    for (const t of over) expect({ x: t.x, y: t.y, look: t.look }).toEqual({ x: over[0].x, y: over[0].y, look: over[0].look })
  })

  it('meets nothing else TV paints at 1280x720: the clock, the chiron, NOW PLAYING, the marquee, the minimap, a panel or its INSIDE stamps', () => {
    setBroadcastForTest(true)
    for (const shot of [trip, segmentShot(bag), segmentShot(object), segmentShot(comment)]) {
      const { texts, rects, spots } = paintAt(picture({ shot: shot as never, meanwhile: true, cutAt: 1e12 - 1500 }))
      const tag = texts.find((t) => t.text === BROADCAST_TAG)!.box
      for (const t of texts) if (t.text !== BROADCAST_TAG) expect(meets(tag, t.box), `${shot.kind}: "${t.text}"`).toBe(false)
      // The dark backing under heavy snow is meant to sit behind it; nothing else.
      for (const r of rects) if (!r.radial && r.x1 - r.x0 < 1280) expect(meets(tag, r), `${shot.kind}: rect ${JSON.stringify(r)}`).toBe(false)
      // The CASHU and NFT INSIDE! stamps, as far out as they land from.
      for (const c of spots) expect(meets(tag, { x0: c.x - 140, y0: c.y - 140, x1: c.x + 140, y1: c.y + 140 }), `${shot.kind}: stamp at ${c.x},${c.y}`).toBe(false)
    }
  })

  it('moves nothing else at 1280x720: every other word and panel is where, and as, the site\'s TV has it', () => {
    for (const shot of [trip, segmentShot(bag), segmentShot(object), segmentShot(comment)]) {
      setBroadcastForTest(false)
      const site = paintAt(picture({ shot: shot as never }))
      setBroadcastForTest(true)
      const stream = paintAt(picture({ shot: shot as never }))
      // Where, and how: the tag leaves nothing of its ink, alpha or shadow on what comes after it.
      const where = (r: ReturnType<typeof recording>): unknown => ({ texts: r.texts.filter((t) => t.text !== BROADCAST_TAG).map((t) => [t.text, t.x, t.y, t.look]), rects: r.rects.map(({ seq: _seq, ...rest }) => rest) })
      expect(where(stream), shot.kind).toEqual(where(site))
    }
  })

  it('stays over the HOSAKA spot (arkinox, 2026-10-22), in the band it keeps clear, across from ADVERTISEMENT, at 1280x720 and in the square', () => {
    setBroadcastForTest(true)
    const was = { hosaka: assets.hosaka, hosakaMark: assets.hosakaMark }
    Object.assign(assets, { hosaka: {} as never, hosakaMark: {} as never })
    try {
      for (const [w, h, scale] of [[1280, 720, 1], [720, 720, 1], [720, 720, 1.5]] as const) {
        const W = w * scale
        const s = scale * Math.min(1.35, Math.max(0.9, w / 1400))
        const MX = Math.round(W * MARGIN_X)
        const MY = Math.round(h * scale * MARGIN_Y)
        const places = new Set<string>()
        for (const sc of HOSAKA_1.scenes) {
          // Landed (the middle of each scene, and as each card has just come in),
          // and in the slam itself: for its first fifth of a second a card comes
          // in big over the band, ADVERTISEMENT's too, and the address is drawn over it.
          for (const into of [(sc.to - sc.from) / 2, 0.3, 0.1, 0.02]) {
            const landed = into >= 0.3
            const at = `${w}x${h}@${scale} ${sc.kind} ${sc.from}+${into}`
            const { texts, rects } = paintAt(picture({ shot: trip as never, ad: { at: 1e12 - 700 - (sc.from + into) * 1000, id: HOSAKA_1.id } }), w, h, 1e12, scale)
            const tags = texts.filter((t) => t.text === BROADCAST_TAG)
            expect(tags, at).toHaveLength(1)
            const tag = tags[0]
            places.add(`${tag.x},${tag.y}`)
            expect(tag.align).toBe('right')
            expect(tag.x).toBe(W - MX)
            // In the band over the spot's cards, ADVERTISEMENT's line.
            expect(tag.box.y1, at).toBeLessThanOrEqual(MY + 26 * s)
            const advert = texts.find((t) => t.text === 'ADVERTISEMENT')!
            expect(Math.abs((tag.box.y0 + tag.box.y1) / 2 - (advert.box.y0 + advert.box.y1) / 2), at).toBeLessThan(4 * s)
            for (const t of texts) {
              if (t === tag) continue
              if (landed) expect(meets(tag.box, t.box), `${at}: "${t.text}"`).toBe(false)
              else if (meets(tag.box, t.box)) expect(t.seq, `${at}: "${t.text}" under it`).toBeLessThan(tag.seq)
            }
            for (const r of rects) {
              if (r.x1 - r.x0 >= W) continue
              if (landed) expect(meets(tag.box, r), `${at}: ${r.look.ink} ${JSON.stringify(r)}`).toBe(false)
              else if (meets(tag.box, r)) expect(r.seq, `${at}: ${r.look.ink} under it`).toBeLessThan(tag.seq)
            }
          }
        }
        // Still: one place the whole spot.
        expect(places.size, `${w}x${h}@${scale}`).toBe(1)
      }
      // The site's TV: no address over its spot.
      setBroadcastForTest(false)
      const { texts } = paintAt(picture({ shot: trip as never, ad: { at: 1e12 - 700 - 3000, id: HOSAKA_1.id } }))
      expect(texts.some((t) => t.text.includes('ONOSENDAI.TECH'))).toBe(false)
    } finally {
      Object.assign(assets, was)
    }
  })

  it('over the spot, it moves nothing of the spot: every other word and picture is where the site\'s TV has it', () => {
    const was = { hosaka: assets.hosaka, hosakaMark: assets.hosakaMark }
    Object.assign(assets, { hosaka: {} as never, hosakaMark: {} as never })
    try {
      // Not the end card, whose words the stream changes (lib/tv/hosakaAd broadcastCut).
      for (const sc of HOSAKA_1.scenes.filter((x) => x.kind !== 'end')) {
        const p = picture({ shot: trip as never, ad: { at: 1e12 - 700 - ((sc.from + sc.to) / 2) * 1000, id: HOSAKA_1.id } })
        setBroadcastForTest(false)
        const site = paintAt(p, 720, 720)
        setBroadcastForTest(true)
        const stream = paintAt(p, 720, 720)
        const where = (r: ReturnType<typeof recording>): unknown => ({ texts: r.texts.filter((t) => t.text !== BROADCAST_TAG).map((t) => [t.text, t.x, t.y, t.look]), rects: r.rects.map(({ seq: _seq, ...rest }) => rest) })
        expect(where(stream), `${sc.kind} ${sc.from}`).toEqual(where(site))
      }
    } finally {
      Object.assign(assets, was)
    }
  })

  it('keeps NOW PLAYING under it, or to one line, or away, on a short stream', () => {
    setBroadcastForTest(true)
    for (const [w, h] of [[1280, 480], [1280, 420], [1280, 350], [1280, 340], [1280, 300], [1000, 345], [854, 480], [700, 360]] as const) {
      const { texts, rects } = paintAt(picture({ shot: trip as never }), w, h)
      const tag = texts.find((t) => t.text === BROADCAST_TAG)!.box
      for (const t of texts) if (t.text !== BROADCAST_TAG) expect(meets(tag, t.box), `${w}x${h}: "${t.text}"`).toBe(false)
      for (const r of rects) if (!r.radial) expect(meets(tag, r), `${w}x${h}: ${JSON.stringify(r)}`).toBe(false)
    }
  })

  it('keeps a centre panel under it where the panel would reach across to it, on a narrower stream', () => {
    setBroadcastForTest(true)
    for (const item of [bag, object, comment]) {
      for (const [w, h] of [[960, 540], [854, 480], [800, 720], [800, 560], [760, 520], [700, 900], [640, 600], [640, 360], [390, 844]] as const) {
        const { texts, rects } = paintAt(picture({ shot: segmentShot(item) as never }), w, h)
        const tag = texts.find((t) => t.text === BROADCAST_TAG)!.box
        for (const r of rects) if (!r.radial) expect(meets(tag, r), `${item.kind} ${w}x${h}: ${JSON.stringify(r)}`).toBe(false)
      }
    }
  })
})

describe('the stream in a square frame (arkinox, 2026-10-22: 720x720, and 1080x1080 at 1.5)', () => {
  /** The minimap's square on the canvas, as the painter sizes it. */
  function minimapBox(w: number, h: number, scale: number): Box {
    const s = scale * Math.min(1.35, Math.max(0.9, w / 1400))
    const W = w * scale
    const H = h * scale
    const size = Math.min(200 * s, W * 0.3, H * 0.34)
    const MX = Math.round(W * MARGIN_X)
    const MY = Math.round(H * MARGIN_Y)
    return { x0: MX, y0: MY, x1: MX + size, y1: MY + size }
  }
  const kinds = [trip, segmentShot(bag), segmentShot(object), segmentShot(comment)]

  it('everything fits: nothing meets the address, no panel meets the minimap, every word inside the frame', () => {
    setBroadcastForTest(true)
    for (const scale of [1, 1.5]) {
      const W = 720 * scale
      const map = minimapBox(720, 720, scale)
      for (const shot of kinds) {
        const { texts, rects, spots } = paintAt(picture({ shot: shot as never }), 720, 720, 1e12, scale)
        const at = `${shot.kind} at ${scale}`
        const tag = texts.find((t) => t.text === BROADCAST_TAG)!.box
        for (const t of texts) if (t.text !== BROADCAST_TAG) expect(meets(tag, t.box), `${at}: "${t.text}"`).toBe(false)
        for (const r of rects) if (!r.radial) expect(meets(tag, r), `${at}: ${JSON.stringify(r)}`).toBe(false)
        for (const c of spots) expect(meets(tag, { x0: c.x - 100 * scale, y0: c.y - 100 * scale, x1: c.x + 100 * scale, y1: c.y + 100 * scale }), `${at}: stamp`).toBe(false)
        // A segment's panel (its gradient ground) keeps under the minimap.
        for (const r of rects) if (r.look.ink === 'gradient' && !r.radial && r.y0 > map.y0) expect(meets(map, r), `${at}: panel ${JSON.stringify(r)}`).toBe(false)
        for (const t of texts) {
          expect(t.box.x0, `${at}: "${t.text}"`).toBeGreaterThanOrEqual(0)
          expect(t.box.x1, `${at}: "${t.text}"`).toBeLessThanOrEqual(W)
        }
      }
    }
  })

  it('a LATER or MEANWHILE card never touches a segment\'s panel (review of #447)', () => {
    setBroadcastForTest(true)
    const silent = assets.music
    try {
      for (const music of [silent, null]) {
        assets.music = music
        for (const scale of [1, 1.5]) {
          for (const item of [bag, object, comment]) {
            const { rects } = paintAt(picture({ shot: segmentShot(item) as never, meanwhile: true, cutAt: 1e12 - 1500 }), 720, 720, 1e12, scale)
            const card = rects.find((r) => r.look.ink === 'rgba(0, 0, 0, 0.5)')!
            expect(card, `${item.kind} ${scale}`).toBeDefined()
            const panels = rects.filter((r) => r.look.ink === 'gradient' && !r.radial && r.x1 - r.x0 > 300 * scale && r.y1 < card.y1)
            for (const r of panels) expect(meets(card, r), `${item.kind} at ${scale}${music ? '' : ', no music'}: ${JSON.stringify(r)} vs ${JSON.stringify(card)}`).toBe(false)
          }
        }
      }
    } finally {
      assets.music = silent
    }
  })

  it('the HOSAKA end card, ONOSENDAI.TECH and all, fits the square', () => {
    setBroadcastForTest(true)
    const end = HOSAKA_1.scenes[HOSAKA_1.scenes.length - 1]
    for (const scale of [1, 1.5]) {
      const { texts } = paintAt(picture({ shot: trip as never, ad: { at: 1e12 - 700 - ((end.from + end.to) / 2) * 1000, id: HOSAKA_1.id } }), 720, 720, 1e12, scale)
      const line = texts.find((t) => t.text === 'IN THE ONOSENDAI.TECH MENU')!
      expect(line, `${scale}`).toBeDefined()
      for (const t of texts) {
        expect(t.box.x0, `${scale}: "${t.text}"`).toBeGreaterThanOrEqual(0)
        expect(t.box.x1, `${scale}: "${t.text}"`).toBeLessThanOrEqual(720 * scale)
      }
    }
  })

  it('the site\'s TV in a square window is as it was: its panel is placed under the clock alone', () => {
    setBroadcastForTest(false)
    const map = minimapBox(720, 720, 1)
    const { rects } = paintAt(picture({ shot: segmentShot(object) as never }), 720, 720)
    const panel = rects.find((r) => r.look.ink === 'gradient' && !r.radial && r.y0 > map.y0 && r.x1 - r.x0 > 400)!
    expect(panel.y0).toBeLessThan(map.y1)
  })

  it('draws at the capture\'s pixel ratio, 1 to 1.5', () => {
    expect(BROADCAST_MAX_DPR).toBe(1.5)
    expect([1, 1.25, 1.5, 2, 3, 0.5, 0, Number.NaN].map((d) => broadcastDpr(d))).toEqual([1, 1.25, 1.5, 1.5, 1.5, 1, 1, 1])
  })
})
