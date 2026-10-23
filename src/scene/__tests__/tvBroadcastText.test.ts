/**
 * tvBroadcastText.test.ts: the stream's text sizes (lib/tv/broadcast,
 * text=large and text=xl; arkinox, 2026-10-23: a 16:9 stream on a phone held
 * upright is about 400 px wide, and the words could not be read). Every word
 * stays in the frame, a segment's panel meets nothing outside it, the chiron,
 * NOW PLAYING, the clock and the address keep apart, at every capture size
 * and in every segment; the site's TV ignores the flag.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ query: async () => [], queryEach: async () => [], queryAny: async () => [], publish: async () => ({ ok: true }), publishMany: async () => ({ ok: true }), relaySet: () => [] }))
import { TvPainter, type TvAssets, type TvPicture } from '../tvPainter'
import { useTv } from '../../store/useTv'
import { HOSAKA_1 } from '../../lib/tv/hosakaAd'
import { BROADCAST_TAG, broadcastScale, broadcastText, setBroadcastForTest, type BroadcastTextSize } from '../../lib/tv/broadcast'

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
const bag = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: 'ann', at: 1, hint: null, height: 3, money: true, nft: true, counts: { shard: 2, cashu: 1, nft: 1 } as never }
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
const inside = (a: Box, b: Box): boolean => a.x0 >= b.x0 - 0.5 && a.x1 <= b.x1 + 0.5 && a.y0 >= b.y0 - 0.5 && a.y1 <= b.y1 + 0.5

afterEach(() => setBroadcastForTest(null))

/** The captures the streamer offers, CSS px and pixel ratio (cyberspace-tv RESOLUTIONS). */
const FRAMES: Array<[number, number, number]> = [[1920, 1080, 1], [1280, 720, 1], [720, 720, 1], [720, 720, 1.5]]
const longComment = { ...comment, text: 'the sky above the port was the color of television, tuned to a dead channel and then some more words to run it past what any panel holds at this size' }
const shortComment = { ...comment, id: 'd'.repeat(64), text: 'welcome to cyberspace! Let me know if you have any questions' }
const KINDS = [trip, segmentShot(bag), segmentShot(object), segmentShot(longComment as never), segmentShot(shortComment as never)]
/** The cards a cut can bring: none, MEANWHILE, and the longest LATER there is. */
const CARDS: Array<Partial<TvPicture>> = [{}, { meanwhile: true, cutAt: 1e12 - 1500 }, { skipped: 23 * 3600 + 59 * 60, cutAt: 1e12 - 1500 }]
const isCard = (r: { look: Look }): boolean => r.look.ink === 'rgba(2, 12, 20, 0.94)' || r.look.ink === 'rgba(0, 0, 0, 0.5)'
/** The splashes' words: stamped on a panel's corner, hanging over its edge as on the site. */
const SPLASH = new Set(['NOW', 'AVAILABLE!', 'CASHU', 'NFT', 'INSIDE!'])

describe('the stream\'s text sizes', () => {
  it('every word in the frame; a panel meets nothing it does not hold; the rest keep apart', () => {
    const silent = assets.music
    try {
      for (const size of ['large', 'xl'] as BroadcastTextSize[]) {
        setBroadcastForTest(true, size)
        for (const [w, h, scale] of FRAMES) {
          const W = w * scale
          const H = h * scale
          const frame = { x0: 0, y0: 0, x1: W, y1: H }
          for (const music of [silent, null]) {
            assets.music = music
            for (const shot of KINDS) {
              for (const [ci, cardState] of CARDS.entries()) {
                const at = `${size} ${w}x${h}@${scale} ${shot.kind}${music ? '' : ' no music'}${ci ? ` + card ${ci}` : ''}`
                const { texts, rects } = paintAt(picture({ shot: shot as never, ...cardState }), w, h, 1e12, scale)
                for (const t of texts) expect(inside(t.box, frame), `${at}: "${t.text}" ${JSON.stringify(t.box)}`).toBe(true)
                // The segment's panel: the widest gradient ground above the chiron's.
                const grounds = rects.filter((r) => r.look.ink === 'gradient' && !r.radial)
                const chironGround = grounds.reduce((low, r) => (r.y1 > low.y1 ? r : low), grounds[0])
                const panel = shot.kind === 'trip' ? undefined : grounds.filter((r) => r !== chironGround && r.y1 <= chironGround.y0 + 0.5 && r.x1 - r.x0 > 200 * scale).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0]
                if (shot.kind !== 'trip') expect(panel, `${at}: a panel`).toBeDefined()
                const cardSeq = rects.find(isCard)?.seq
                const isCardWords = (t: Text): boolean => cardSeq !== undefined && t.seq === cardSeq + 1
                const outside = texts.filter((t) => !SPLASH.has(t.text) && !isCardWords(t) && (!panel || !inside(t.box, panel)))
                if (panel) {
                  for (const t of outside) expect(meets(t.box, panel), `${at}: "${t.text}" meets the panel`).toBe(false)
                  // The panel keeps above the chiron and NOW PLAYING.
                  for (const r of grounds) if (r !== panel && r.y0 >= panel.y0 && !inside(r, panel)) expect(meets(r, panel), `${at}: ${JSON.stringify(r)} under ${JSON.stringify(panel)}`).toBe(false)
                }
                // A card meets neither the panel nor NOW PLAYING (review of #453:
                // centred on the frame, it ran over NOW PLAYING), and holds its words.
                const card = rects.find(isCard)
                if (ci > 0 && shot.kind !== 'trip') expect(card, `${at}: a card`).toBeDefined()
                if (card) {
                  expect(inside(card, frame), `${at}: card ${JSON.stringify(card)}`).toBe(true)
                  if (panel) expect(meets(card, panel), `${at}: card over the panel`).toBe(false)
                  const npLabel = texts.find((t) => t.text.includes('NOW PLAYING'))
                  const np = npLabel && grounds.find((r) => r.x0 <= npLabel.box.x0 && r.x1 >= npLabel.box.x0 && r.y0 <= npLabel.y && r.y1 >= npLabel.y)
                  if (np) expect(meets(card, np), `${at}: card ${JSON.stringify(card)} over NOW PLAYING ${JSON.stringify(np)}`).toBe(false)
                  // Its words: drawn straight after its ground (fitted to the chiron, they may end in an ellipsis).
                  const words = texts.find((t) => t.seq === card.seq + 1)!
                  expect(words, `${at}: card words`).toBeDefined()
                  expect(inside(words.box, { ...card, y0: card.y0 - words.size, y1: card.y1 + words.size }), `${at}: card words`).toBe(true)
                }
                // Outside the panel, no word meets another (the card goes over the chiron, solid, with the larger text).
                const rest = outside.filter((t) => t.text !== '▌')
                for (let i = 0; i < rest.length; i++) {
                  for (let j = i + 1; j < rest.length; j++) {
                    const a = rest[i].box, b = rest[j].box
                    // Each one's ink: the recorder's box runs 1.3 em from a line's top; a caption's lines sit 1 em apart.
                    const ink = (x: Box, s: number): Box => ({ x0: x.x0, x1: x.x1, y0: x.y0 + s * 0.25, y1: x.y1 - s * 0.3 })
                    expect(meets(ink(a, rest[i].size), ink(b, rest[j].size)), `${at}: "${rest[i].text}" meets "${rest[j].text}"`).toBe(false)
                  }
                }
              }
            }
          }
        }
      }
    } finally {
      assets.music = silent
    }
  })

  it('lays out as it says: NOW PLAYING wide, the row low, the minimap out of a panel\'s way, the run low in its band, the panel down to the chiron', () => {
    setBroadcastForTest(true, 'large')
    const s = 1.35 * 2.25
    const H = 1080
    const W = 1920
    const MY = Math.round(H * 0.085)
    const { texts, rects } = paintAt(picture({ shot: segmentShot(longComment as never) as never, arrivals: [{ pubkey: 'zed', at: 1 }] }), W, H, 1e12, 1)
    const grounds = rects.filter((r) => r.look.ink === 'gradient' && !r.radial)
    const npLabel = texts.find((t) => t.text.includes('NOW PLAYING'))!
    const np = grounds.find((r) => r.x0 <= npLabel.box.x0 && r.x1 >= npLabel.box.x0 && r.y0 <= npLabel.y && r.y1 >= npLabel.y)!
    expect(np.x1 - np.x0).toBeGreaterThanOrEqual(W * 0.32 - 0.5)
    const chiron = grounds.filter((r) => r !== np).reduce((low, r) => (r.y1 > low.y1 ? r : low))
    expect(chiron.y1 - chiron.y0).toBeCloseTo(62 * s, 6)
    expect(np.y1 - np.y0).toBeCloseTo(62 * s, 6)
    // No minimap (its ground is a radial gradient, top left) while the panel is up.
    expect(rects.filter((r) => r.radial && r.x0 < W / 2)).toEqual([])
    // The ticker's run sits in its band as its type is tall.
    const run = texts.find((t) => t.text.startsWith('NEW ARRIVAL'))!
    expect(run.y).toBeCloseTo(H - MY - 32 * s + 16 * s + 16 * s * 0.36, 6)
    // The panel comes down past the band the card used to keep above the chiron.
    const panel = grounds.filter((r) => r !== np && r !== chiron).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0]
    expect(panel.y1).toBeGreaterThan(chiron.y0 - 40 * s)
    expect(panel.y1).toBeLessThanOrEqual(chiron.y0 - 14 * s + 0.5)
  })

  it('large sets a comment\'s words 2.25 times the site\'s at 1080p, so 9 px to a capital at 400 px wide', () => {
    for (const [size, k] of [['normal', 1], ['large', 2.25], ['xl', 2.6]] as Array<[BroadcastTextSize, number]>) {
      setBroadcastForTest(true, size)
      const { texts } = paintAt(picture({ shot: segmentShot(shortComment as never) as never }), 1920, 1080, 1e12, 1)
      const quote = texts.find((t) => t.text.startsWith('“'))!
      expect(quote.size, size).toBeCloseTo(20 * 1.35 * k, 6)
    }
  })

  it('the HOSAKA spot, ONOSENDAI.TECH and all, fits every frame at every size', () => {
    const scenes = HOSAKA_1.scenes
    for (const size of ['large', 'xl'] as BroadcastTextSize[]) {
      setBroadcastForTest(true, size)
      for (const [w, h, scale] of FRAMES) {
        for (const sc of scenes) {
          const { texts } = paintAt(picture({ shot: trip as never, ad: { at: 1e12 - 700 - ((sc.from + sc.to) / 2) * 1000, id: HOSAKA_1.id } }), w, h, 1e12, scale)
          expect(texts.some((t) => t.text === BROADCAST_TAG), `${size} ${w}x${h} ${sc.kind}`).toBe(true)
          for (const t of texts) expect(inside(t.box, { x0: 0, y0: 0, x1: w * scale, y1: h * scale }), `${size} ${w}x${h}@${scale} ${sc.kind}: "${t.text}"`).toBe(true)
        }
      }
    }
  })
})

describe('the text size flag', () => {
  it('is a share of the frame: the same on a phone whatever the capture, never below the site\'s', () => {
    setBroadcastForTest(true, 'large')
    expect(broadcastText()).toBe(2.25)
    // The painter's sizes grow with the width up to 1.35 at 1890 px and more.
    expect(broadcastScale(1.35, 1920, 1.35)).toBeCloseTo(2.25, 9)
    // A square 720 frame's words are already a larger share of it.
    expect(broadcastScale(0.9, 720, 1.35)).toBeCloseTo(2.25 * (1.35 / 1920) / (0.9 / 720), 9)
    // A name label, 16 px whatever the width: never smaller than the site's.
    expect(broadcastScale(16, 720)).toBe(1)
    expect(broadcastScale(16, 1920)).toBeCloseTo(2.25, 9)
    setBroadcastForTest(true, 'normal')
    expect(broadcastScale(1.35, 1920, 1.35)).toBe(1)
  })

  it('does nothing off the stream: the site\'s TV paints the same with any text size', () => {
    setBroadcastForTest(false, 'xl')
    expect(broadcastText()).toBe(1)
    expect(broadcastScale(16, 1920)).toBe(1)
    const shots = [trip, segmentShot(longComment as never), segmentShot(bag)]
    for (const [w, h] of [[1920, 1080], [1280, 720], [390, 844], [844, 390]]) {
      for (const shot of shots) {
        setBroadcastForTest(false, 'xl')
        const a = paintAt(picture({ shot: shot as never }), w, h)
        setBroadcastForTest(false)
        const b = paintAt(picture({ shot: shot as never }), w, h)
        expect(a.texts.map((t) => [t.text, t.x, t.y, t.size])).toEqual(b.texts.map((t) => [t.text, t.x, t.y, t.size]))
        expect(a.rects.map((r) => [r.x0, r.y0, r.x1, r.y1])).toEqual(b.rects.map((r) => [r.x0, r.y0, r.x1, r.y1]))
      }
    }
  })
})
