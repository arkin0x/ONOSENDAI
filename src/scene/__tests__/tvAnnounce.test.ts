/**
 * tvAnnounce.test.ts: what the tube writes for an UPGRADE ANNOUNCEMENT, in
 * the owner's words exactly, on every frame shape TV plays in; and the
 * marquee's words for ONOSENDAI's version and the updates this week.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ query: async () => [], queryEach: async () => [], queryAny: async () => [], publish: async () => ({ ok: true }), publishMany: async () => ({ ok: true }), relaySet: () => [] }))
import { TvPainter, tickerItems, type TvAssets, type TvPicture } from '../tvPainter'
import { CUT_MS } from '../../hud/TvSegments'
import { announcePlan, charsShown, releaseTicker, SAMPLE_ANNOUNCEMENT, type AnnouncePlan } from '../../lib/tv/upgradeAnnounce'
import { setBroadcastForTest } from '../../lib/tv/broadcast'

/** A 2D context that measures every character as 7 px at 12 px (scaled with the font) and keeps what is written. */
function recordingCanvas(): { canvas: HTMLCanvasElement; texts: string[]; rects: Array<{ style: string; x: number; y: number; w: number; h: number }> } {
  const texts: string[] = []
  const rects: Array<{ style: string; x: number; y: number; w: number; h: number }> = []
  let px = 12
  let style = ''
  const target: Record<string, unknown> = {
    measureText: (t: string) => ({ width: Array.from(t).length * px * 0.6 }),
    fillText: (t: string) => { texts.push(t) },
    fillRect: (x: number, y: number, w: number, h: number) => { rects.push({ style, x, y, w, h }) },
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  }
  const ctx = new Proxy(target, {
    get: (t, key) => (key in t ? t[key as string] : () => {}),
    set: (_t, key, v) => {
      if (key === 'font') { const m = /(\d+(?:\.\d+)?)px/.exec(String(v)); if (m) px = Number(m[1]) }
      if (key === 'fillStyle') style = String(v)
      return true
    },
  })
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, texts, rects }
}

const picture: TvPicture = { status: 'playing', shot: null, played: 0, tapeTime: 100, scaleExp: 0, cutAt: 0, skipped: 0, meanwhile: false, census: null, chains: {}, arrivals: [{ pubkey: 'ann', at: 1 }], reactions: [], avatars: {} }
const assets = (announce: { at: number; plan: AnnouncePlan } | null, release: string[] = []): TvAssets => ({ name: (pk) => pk.toUpperCase(), picture: () => null, logo: null, spin: null, segmentShard: null, color: () => '#fff', announce, release })

/** What one paint writes and fills, `t` seconds into the announcement's own clock. */
function paintAt(plan: AnnouncePlan, t: number, w = 1400, h = 860): ReturnType<typeof recordingCanvas> {
  const rec = recordingCanvas()
  const p = new TvPainter(rec.canvas)
  p.size(w, h, 1)
  const at = 1000
  p.paint(picture, assets({ at, plan }), at + CUT_MS + t * 1000, 1, false)
  return rec
}
const written = (plan: AnnouncePlan, t: number, w = 1400, h = 860): string[] => paintAt(plan, t, w, h).texts

afterEach(() => setBroadcastForTest(null))

describe('the UPGRADE ANNOUNCEMENT on the tube', () => {
  const plan = announcePlan(SAMPLE_ANNOUNCEMENT)!
  const [, page1, page2, welcome] = plan.scenes

  it('screen 1: UPGRADE ANNOUNCEMENT, and nothing of TV round it', () => {
    const t = written(plan, 1)
    expect(t.join(' ')).toContain('UPGRADE ANNOUNCEMENT')
    expect(t).not.toContain('▶ PLAY')
    expect(t.some((x) => x.includes('NEW ARRIVAL'))).toBe(false)
  })

  it('screen 2: the page printing so far, NEW! on the starburst, which page of two', () => {
    const mid = page1.kind === 'page' ? page1.typeFrom + 2 : 0
    const t = written(plan, mid)
    expect(t).toContain('NEW!')
    expect(t).toContain('1 / 2')
    const shown = page1.kind === 'page' ? charsShown(page1, mid) : 0
    const printed = t.filter((x) => plan.pages[0].includes(x) && x.length > 1).join(' ')
    expect(printed.length).toBeGreaterThan(0)
    expect(printed.length).toBeLessThanOrEqual(shown + 1)
    expect(plan.pages[0].startsWith(printed.slice(0, 20))).toBe(true)
  })

  it('page 2 prints whole before its page ends', () => {
    const t = written(plan, page2.to - 0.5)
    expect(t).toContain('2 / 2')
    expect(t.filter((x) => plan.pages[1].includes(x) && x.length > 1).join(' ')).toBe(plan.pages[1])
  })

  it('screen 3: WELCOME TO ONOSENDAI VERSION <x>, ENJOY! under it', () => {
    const t = written(plan, welcome.from + 1)
    expect(t.join(' ')).toContain('WELCOME TO ONOSENDAI VERSION TEST')
    expect(t).toContain('ENJOY!')
    expect(t.indexOf('ENJOY!')).toBe(t.length - 1)
  })

  it('every screen paints on the stream (16:9 large, xl), upright, and on a phone', () => {
    const shapes: Array<[number, number, () => void]> = [
      [1920, 1080, () => setBroadcastForTest(true, 'large')],
      [1920, 1080, () => setBroadcastForTest(true, 'xl')],
      [720, 1280, () => setBroadcastForTest(true, 'large', 'portrait')],
      [390, 844, () => setBroadcastForTest(null)],
    ]
    for (const [w, h, set] of shapes) {
      set()
      expect(written(plan, 1, w, h).join(' ')).toContain('UPGRADE')
      expect(written(plan, page1.kind === 'page' ? page1.typeFrom + 1 : 0, w, h)).toContain('NEW!')
      const end = written(plan, welcome.from + 1, w, h)
      expect(end.join(' ')).toContain('ONOSENDAI')
      expect(end).toContain('ENJOY!')
    }
  })
})

describe('the box and the starburst', () => {
  const plan = announcePlan(SAMPLE_ANNOUNCEMENT)!
  const page1 = plan.scenes[1]
  const t = page1.kind === 'page' ? page1.typeFrom + 1 : 0

  it('never meet, on the site, the stream at every text size, upright and on a phone (review)', () => {
    const shapes: Array<[number, number, () => void]> = [
      [1400, 860, () => setBroadcastForTest(null)],
      [1920, 1080, () => setBroadcastForTest(true, 'normal')],
      [1920, 1080, () => setBroadcastForTest(true, 'large')],
      [1920, 1080, () => setBroadcastForTest(true, 'xl')],
      [720, 1280, () => setBroadcastForTest(true, 'large', 'portrait')],
      [390, 844, () => setBroadcastForTest(null)],
    ]
    for (const [w, h, set] of shapes) {
      set()
      const box = paintAt(plan, t, w, h).rects.find((r) => r.style === 'rgba(2, 8, 34, 0.9)')!
      expect(box).toBeDefined()
      // Where the burst can reach: its radius, as the painter sizes it, from the top right margins.
      const tall = w < 600 || w < h
      const r = Math.min(w, h) * (tall ? 0.13 : 0.1)
      const reach = { x0: w - Math.round(w * 0.06) - r * 1.9, y1: Math.round(h * 0.085) + r * 1.9 }
      const meets = box.x + box.w > reach.x0 && box.y < reach.y1
      expect(meets, `${w}x${h}`).toBe(false)
      // And the box stays in the frame.
      expect(box.y + box.h).toBeLessThanOrEqual(h)
    }
  })

  it('a word cut across two lines prints whole, nothing skipped at the cut (review)', () => {
    const long = announcePlan({ version: '1', text: `${'a'.repeat(120)} end.` })!
    const pg = long.scenes[1]
    const printed = written(long, pg.to - 0.5, 390, 844).filter((x) => long.pages[0].includes(x) && x.length > 1)
    expect(printed.join('')).toBe(long.pages[0])
  })
})

describe('the marquee\'s release words', () => {
  it('ONOSENDAI VERSION and the updates this week join the run', () => {
    const items = tickerItems(picture, (pk) => pk.toUpperCase(), releaseTicker('2.20261111.3.656', 7))
    expect(items).toContain('ONOSENDAI VERSION 2.20261111.3.656')
    expect(items).toContain('7 UPDATES THIS WEEK')
  })

  it('stay on while the tape has no moment yet (tuning)', () => {
    expect(tickerItems({ ...picture, tapeTime: null }, (pk) => pk, ['ONOSENDAI VERSION 2.1'])).toEqual(['ONOSENDAI VERSION 2.1'])
    expect(tickerItems({ ...picture, tapeTime: null }, (pk) => pk)).toEqual([])
  })

  it('are on the marquee as it scrolls', () => {
    const { canvas } = recordingCanvas()
    const p = new TvPainter(canvas)
    p.size(1400, 860, 1)
    p.paint(picture, assets(null, releaseTicker('2.1', 3)), 1000, 1, false)
    expect(p.marqueeRun).toContain('ONOSENDAI VERSION 2.1')
    expect(p.marqueeRun).toContain('3 UPDATES THIS WEEK')
  })
})
