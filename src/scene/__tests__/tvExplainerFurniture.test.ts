/**
 * tvExplainerFurniture.test.ts: what the tube paints around an explainer
 * (lib/tv/explainer). The top-right block (the logo, PLAY, the date and the
 * time, and on the stream WWW.ONOSENDAI.TECH) steps aside while one is on
 * screen, as the marquee and the chiron do: the explainer is its own spot,
 * with its own logo burned in (arkinox, 2026-10-24: "right top corner should
 * go away during ad"). Its title's tag no longer stands where the PIP used
 * to end, alone on the left of the picture ("left side has inexplicable
 * stuck captions"): with the PIP off there is none on the stream, and on the
 * site it takes the marquee's empty band, where a tap still reaches the
 * sound. Ad spots are unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ query: async () => [], queryEach: async () => [], queryAny: async () => [], publish: async () => ({ ok: true }), publishMany: async () => ({ ok: true }), relaySet: () => [] }))
import { MARGIN_X, MARGIN_Y, TvPainter, type TvAssets, type TvExplainer, type TvPicture } from '../tvPainter'
import { CTV_ADVERTISE_1, HOSAKA_1 } from '../../lib/tv/hosakaAd'
import { BROADCAST_TAG, setBroadcastForTest } from '../../lib/tv/broadcast'
import { explainerLayout } from '../../lib/tv/explainer'

interface Text { text: string; x: number; y: number; align: string }

/** A canvas that keeps each word, where it is written, and each picture drawn. */
function recording(): { canvas: HTMLCanvasElement; texts: Text[]; images: unknown[] } {
  const texts: Text[] = []
  const images: unknown[] = []
  const state: Record<string, unknown> = { globalAlpha: 1, font: '10px x', textAlign: 'start' }
  const stack: Array<Record<string, unknown>> = []
  const size = (): number => Number(/([\d.]+)px/.exec(String(state.font))?.[1] ?? 10)
  const ctx = new Proxy({
    measureText: (t: string) => ({ width: Array.from(t).length * size() * 0.6 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillText: (text: string, x: number, y: number) => { if (Number(state.globalAlpha) > 0) texts.push({ text, x, y, align: String(state.textAlign) }) },
    drawImage: (img: unknown) => { if (Number(state.globalAlpha) > 0) images.push(img) },
    save: () => { stack.push({ ...state }) },
    restore: () => { const top = stack.pop(); if (top) Object.assign(state, top) },
  } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
    set: (_t, key, v) => { state[key as string] = v; return true },
  })
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, texts, images }
}

const logo = { logo: true } as unknown as HTMLImageElement
const assets: TvAssets = {
  name: (pk) => pk.toUpperCase(), picture: () => null, logo, spin: null, segmentShard: null, color: () => '#fff',
  music: { title: 'A TRACK', artist: 'AN ARTIST', art: null, progress: 0.4, blocked: false, volume: 1, muted: false },
}

function picture(over: Partial<TvPicture> = {}): TvPicture {
  const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
  return { status: 'playing', shot: trip as never, played: 0, tapeTime: 1_760_000_000, scaleExp: 40, cutAt: 0, skipped: 0, meanwhile: false, census: null, chains: {}, arrivals: [], reactions: [], avatars: {}, ...over }
}

/** An explainer `mix` of the way on, laid out as the tube lays it out at `w` x `h`, PIP as given. */
function explainer(w: number, h: number, mix: number, over: Partial<TvExplainer> = {}): TvExplainer {
  const { pip, video } = explainerLayout(w, h, 16 / 9, MARGIN_X, MARGIN_Y, h * (1 - MARGIN_Y) - 32)
  return { title: 'Welcome to Cyberspace', mix, pip, video, caption: null, pipShown: false, ...over }
}

/** Paint twice (the second is the one kept), `w` x `h` at 1 canvas px each. */
function paint(p: TvPicture, a: TvAssets, w = 1920, h = 1080): ReturnType<typeof recording> & { painter: TvPainter } {
  const rec = recording()
  const painter = new TvPainter(rec.canvas)
  painter.size(w, h, 1)
  painter.paint(p, a, 1e6 - 33, 1, false)
  rec.texts.length = 0
  rec.images.length = 0
  painter.paint(p, a, 1e6, 1, false)
  return { ...rec, painter }
}

/** The top-right block's words: PLAY, the date, the time, and the stream's address. */
const corner = (texts: Text[]): Text[] => texts.filter((t) => t.text === '▶ PLAY' || t.text === BROADCAST_TAG || /^[A-Z]{3} \d\d \d{4}$/.test(t.text) || /^\d\d:\d\d:\d\d$/.test(t.text))

afterEach(() => setBroadcastForTest(null))

describe('the top-right block over an explainer (arkinox, 2026-10-24: "right top corner should go away")', () => {
  for (const mode of ['stream', 'site'] as const) {
    it(`${mode}: there with no explainer, gone the whole time one is on (coming in, playing, going out), and back after`, () => {
      if (mode === 'stream') setBroadcastForTest(true, 'large')
      else setBroadcastForTest(false)
      const before = paint(picture(), assets)
      expect(before.images).toContain(logo)
      expect(corner(before.texts).map((t) => t.text)).toContain('▶ PLAY')
      expect(corner(before.texts).some((t) => t.text === BROADCAST_TAG)).toBe(mode === 'stream')
      expect(corner(before.texts).length).toBe(mode === 'stream' ? 4 : 3)
      for (const mix of [0.05, 0.5, 1]) {
        const during = paint(picture(), { ...assets, explainer: explainer(1920, 1080, mix) })
        expect(during.images, `mix ${mix}`).not.toContain(logo)
        expect(corner(during.texts), `mix ${mix}`).toEqual([])
      }
      const after = paint(picture(), assets)
      expect(after.images).toContain(logo)
      expect(corner(after.texts).length).toBe(corner(before.texts).length)
    })
  }
})

describe('an explainer\'s title tag with the PIP off (arkinox, 2026-10-24: "inexplicable stuck captions")', () => {
  it('on the stream: never drawn, wherever the PIP would have ended', () => {
    setBroadcastForTest(true, 'large')
    for (const mix of [0.5, 0.9, 1]) {
      const { texts, painter } = paint(picture(), { ...assets, explainer: explainer(1920, 1080, mix) })
      expect(texts.some((t) => t.text.includes('Welcome to Cyberspace')), `mix ${mix}`).toBe(false)
      expect(painter.musicCard, `mix ${mix}`).toBeNull()
    }
  })

  it('on the site: in the marquee\'s empty band, bottom left, where a tap still reaches the sound', () => {
    setBroadcastForTest(false)
    const W = 1920
    const H = 1080
    const s = Math.min(1.35, Math.max(0.9, W / 1400))
    const MX = Math.round(W * MARGIN_X)
    const MY = Math.round(H * MARGIN_Y)
    const bandTop = H - MY - 28 * s
    const ex = explainer(W, H, 1)
    const { texts, painter } = paint(picture(), { ...assets, explainer: ex })
    const tag = texts.find((t) => t.text.startsWith('Welcome to Cyberspace'))
    expect(tag).toBeDefined()
    expect(tag!.y).toBeGreaterThan(bandTop)
    expect(tag!.y).toBeLessThanOrEqual(H - MY)
    expect(tag!.x).toBeLessThan(MX + 20 * s)
    // Nowhere near the PIP's old corner.
    expect(tag!.y).toBeGreaterThan(ex.pip.y + ex.pip.h + 100)
    const card = painter.musicCard!
    expect(card.y).toBeGreaterThanOrEqual(bandTop - 0.5)
    expect(card.y + card.h).toBeLessThanOrEqual(H - MY + 0.5)
    expect(card.x).toBe(MX)
    // It still says when the sound waits on a tap.
    const held = paint(picture(), { ...assets, explainer: { ...ex, soundHeld: true } })
    expect(held.texts.some((t) => t.text.includes('TAP FOR SOUND'))).toBe(true)
  })

  it('with the PIP on (kept for later): under the PIP, as before', () => {
    setBroadcastForTest(false)
    const ex = explainer(1920, 1080, 1, { pipShown: true })
    const { texts } = paint(picture(), { ...assets, explainer: ex })
    const tag = texts.find((t) => t.text.startsWith('Welcome to Cyberspace'))!
    expect(tag.x).toBeCloseTo(ex.pip.x + 7 * Math.min(1.35, Math.max(0.9, 1920 / 1400)), 6)
    expect(tag.y).toBeGreaterThan(ex.pip.y + ex.pip.h)
    expect(tag.y).toBeLessThan(ex.pip.y + ex.pip.h + 40)
  })

  it('no explainer, no tag', () => {
    for (const b of [true, false]) {
      setBroadcastForTest(b, 'large')
      const { texts } = paint(picture(), assets)
      expect(texts.some((t) => t.text.includes('Welcome to Cyberspace'))).toBe(false)
    }
  })
})

describe('an explainer\'s captions', () => {
  it('centred on the video, near its foot, above the marquee\'s band', () => {
    setBroadcastForTest(true, 'large')
    const ex = explainer(1920, 1080, 1, { caption: 'There is no central authority' })
    const { texts } = paint(picture(), { ...assets, explainer: ex })
    const cap = texts.find((t) => t.text.includes('central authority'))!
    expect(cap.align).toBe('center')
    expect(cap.x).toBeCloseTo(ex.video.x + ex.video.w / 2, 6)
    expect(cap.y).toBeGreaterThan(1080 / 2)
    expect(cap.y).toBeLessThan(1080 - Math.round(1080 * MARGIN_Y) - 32)
  })
})

describe('the ad spots keep their own corner', () => {
  it('neither spot draws the logo, PLAY, or the clock; the stream keeps its address (arkinox, 2026-10-22)', () => {
    for (const spot of [HOSAKA_1, CTV_ADVERTISE_1]) {
      for (const b of [true, false]) {
        setBroadcastForTest(b, 'large')
        const mid = spot.scenes[1] ?? spot.scenes[0]
        const { texts, images } = paint(picture({ ad: { at: 1e6 - 700 - ((mid.from + mid.to) / 2) * 1000, id: spot.id } }), { ...assets, hosaka: {} as never, hosakaMark: {} as never })
        const words = corner(texts).map((t) => t.text)
        expect(images, `${spot.id} ${b}`).not.toContain(logo)
        expect(words, `${spot.id} ${b}`).toEqual(b ? [BROADCAST_TAG] : [])
      }
    }
  })
})
