/**
 * tvPainter.test.ts: the marquee never rewrites what is on screen when the
 * numbers change (arkinox, 2026-10-18: "the marquee seems to jump or reset
 * when the scene changes"), the cuts take turns, and text wraps by width.
 */
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ query: async () => [], queryEach: async () => [], queryAny: async () => [], publish: async () => ({ ok: true }), publishMany: async () => ({ ok: true }), relaySet: () => [] }))
import { TvPainter, tickerItems, wrap, type TvAssets, type TvPicture } from '../tvPainter'
import { cutKind, flatPoint } from '../TvScreenEffect'
import { useTv } from '../../store/useTv'
import { HOSAKA_1 } from '../../lib/tv/hosakaAd'

/** A 2D context that measures every character as 7 px and draws nothing. */
function fakeCanvas(): HTMLCanvasElement {
  const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }) } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : () => {}),
    set: () => true,
  })
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
}

const assets: TvAssets = { name: (pk) => pk.toUpperCase(), picture: () => null, logo: null, spin: null, segmentShard: null, color: () => '#fff' }

function picture(over: Partial<TvPicture>): TvPicture {
  return { status: 'playing', shot: null, played: 0, tapeTime: 100, scaleExp: 0, cutAt: 0, skipped: 0, meanwhile: false, census: null, chains: {}, arrivals: [], reactions: [], avatars: {}, ...over }
}

describe('the marquee', () => {
  it('keeps what is on screen when the numbers change, and adds the new ones after', () => {
    const p = new TvPainter(fakeCanvas())
    p.size(1200, 700, 1)
    p.paint(picture({ arrivals: [{ pubkey: 'ann', at: 1 }] }), assets, 1000, 1, false)
    const before = p.marqueeRun
    expect(before[0]).toBe('NEW ARRIVAL ANN')
    // A cut: different numbers now.
    p.paint(picture({ arrivals: [{ pubkey: 'bob', at: 2 }] }), assets, 1040, 1, false)
    expect(p.marqueeRun.slice(0, before.length)).toEqual(before)
  })

  it('reads the numbers as of the tape', () => {
    const census = { arrivals: [1, 50, 200], bags: [10], bagsBy: new Map(), objects: [] }
    expect(tickerItems(picture({ census, tapeTime: 60 }), (pk) => pk)).toContain('2 AVATARS IN CYBERSPACE')
  })
})

describe('cuts', () => {
  it('take turns between dip, roll and snow, and are all dips with reduced motion', () => {
    const kinds = new Set([0, 7, 14, 21, 28, 35].map((t) => cutKind(t, false)))
    expect([...kinds].sort()).toEqual([0, 1, 2])
    expect(cutKind(14, true)).toBe(0)
  })
})

describe('wrap', () => {
  it('breaks at spaces within the width, and inside a word only when it must', () => {
    const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) } as unknown as CanvasRenderingContext2D
    expect(wrap(ctx, 'one two three', 80)).toEqual(['one two', 'three'])
    expect(wrap(ctx, 'abcdefghijkl', 50)).toEqual(['abcde', 'fghij', 'kl'])
  })
})

describe('the sealed bag', () => {
  /** A canvas that counts the line segments drawn on it. */
  function counting(): { canvas: HTMLCanvasElement; lines: () => number } {
    let n = 0
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), lineTo: () => { n++ } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, lines: () => n }
  }
  /** The bag's panel painted at `t` seconds into it (its shot over, so the clock reads its length). */
  function drawnAt(t: number): number {
    vi.spyOn(performance, 'now').mockReturnValue(1e12)
    const bag = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: 'p', at: 1, hint: null, height: 3, money: false, counts: null }
    const shot = { id: bag.id, kind: 'bag' as const, item: bag, pubkey: 'p', beats: [], start: 1, end: 1, offsets: [], length: t + 0.7 }
    useTv.setState({ shot, status: 'playing' })
    const c = counting()
    const p = new TvPainter(c.canvas)
    p.size(412, 915, 1)
    p.paint(picture({ shot }), assets, 1e12, 1, false)
    vi.restoreAllMocks()
    return c.lines()
  }

  it('stamps a key on its sides, which are there by 3.4 s and gone by 6 s', () => {
    const before = drawnAt(0.5)
    expect(drawnAt(3.4) - before).toBeGreaterThan(100)
    expect(drawnAt(6.5)).toBe(before)
  })
})

describe('a long comment on a phone on its side', () => {
  it('keeps clear of the chiron: the type steps down and the quote is cut', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1e12)
    const text = 'word '.repeat(88).trim()
    const item = { kind: 'comment' as const, id: 'c'.repeat(64), pubkey: 'p', at: 1, text, on: 'move' as const, about: null }
    const shot = { id: item.id, kind: 'comment' as const, item, pubkey: 'p', beats: [], start: 1, end: 1, offsets: [], length: 10 }
    useTv.setState({ shot, status: 'playing' })
    const rects: number[][] = []
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), strokeRect: (...r: number[]) => { rects.push(r) } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
    p.size(915, 412, 1)
    p.paint(picture({ shot }), assets, 1e12, 1, false)
    vi.restoreAllMocks()
    // The panel's border is the first rectangle stroked; the chiron's top, on
    // this frame, is at 412 - 35 (margin) - 25.2 (marquee) - 9 - 68.4 = 274.4.
    const [, y, , h] = rects[0]
    expect(y + h).toBeLessThanOrEqual(274.4)
  })
})

describe('the minimap', () => {
  it('draws the sun and, once there is an avatar on screen, its dot', () => {
    const arcs: number[][] = []
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), arc: (...a: number[]) => { arcs.push(a) } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
    p.size(1280, 720, 1)
    p.paint(picture({ status: 'tuning' }), assets, 1000, 1, false)
    const alone = arcs.length
    const mid = 1n << 84n
    const shot = { id: 'a'.repeat(64), kind: 'trip' as const, pubkey: 'p', beats: [], start: 1, end: 1, offsets: [], length: 5 }
    arcs.length = 0
    p.paint(picture({ shot, avatars: { p: { position: { x: mid, y: mid, z: mid }, plane: 0, at: 1 } } }), assets, 2000, 1, false)
    // One more circle than with nobody on screen: the dot.
    expect(alone).toBeGreaterThanOrEqual(1)
    expect(arcs.length).toBeGreaterThan(alone)
  })
})

describe('the minimap\'s black sun', () => {
  it('has a solid black face, not a see-through ring', () => {
    const fills: Array<{ style: unknown; alpha: unknown }> = []
    const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: '' }
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), fill: () => { fills.push({ style: state.fillStyle, alpha: state.globalAlpha }) } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
      set: (_t, key, v) => { state[key as string] = v; return true },
    })
    const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
    p.size(1280, 720, 1)
    p.paint(picture({ status: 'tuning' }), assets, 1000, 1, false)
    expect(fills).toContainEqual({ style: '#000', alpha: 1 })
  })
})

describe('NOW PLAYING', () => {
  /** A canvas that keeps every word it is asked to write. */
  function writing(): { canvas: HTMLCanvasElement; words: string[] } {
    const words: string[] = []
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), fillText: (t: string) => { words.push(t) } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, words }
  }
  const music = { title: 'Saturn Day', artist: 'Sethy Bowoy', art: null, progress: 0.4, blocked: false, volume: 0.8, muted: false }

  it('says MUTED while muted, and knows where it is for a tap', () => {
    const { canvas, words } = writing()
    const p = new TvPainter(canvas)
    p.size(1400, 800, 2)
    p.paint(picture({}), { ...assets, music: { ...music, muted: true } }, 1000, 2, false)
    expect(words).toContain('♪ MUTED')
    expect(words).not.toContain('♪ NOW PLAYING')
    // In CSS px, bottom right, inside the margins.
    const c = p.musicCard!
    expect(c.x + c.w).toBeCloseTo(1400 * (1 - 0.06), 0)
    expect(c.w).toBeGreaterThan(200)
    expect(c.h).toBeGreaterThan(60)
    expect(c.y + c.h).toBeLessThan(800)
    p.paint(picture({}), assets, 1040, 2, false)
    expect(p.musicCard).toBeNull()
  })

  it('shows the track and its artist while music plays, and nothing without it', () => {
    const { canvas, words } = writing()
    const p = new TvPainter(canvas)
    p.size(1400, 800, 1)
    p.paint(picture({}), { ...assets, music }, 1000, 1, false)
    expect(words).toEqual(expect.arrayContaining(['♪ NOW PLAYING', 'SATURN DAY', 'SETHY BOWOY']))
    words.length = 0
    p.paint(picture({}), assets, 1040, 1, false)
    expect(words).not.toContain('♪ NOW PLAYING')
  })

  it('stands still whether or not the chiron is up, so a tap finds it where it was', () => {
    const p = new TvPainter(fakeCanvas())
    p.size(1400, 800, 1)
    p.paint(picture({ status: 'tuning' }), { ...assets, music }, 1000, 1, false)
    const tuning = p.musicCard
    const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
    p.paint(picture({ shot: trip as never }), { ...assets, music }, 1040, 1, false)
    expect(p.musicCard).toEqual(tuning)
  })

  it('is left off a screen too short for it, and the music plays on', () => {
    const p = new TvPainter(fakeCanvas())
    p.size(568, 280, 1)
    p.paint(picture({}), { ...assets, music }, 1000, 1, false)
    expect(p.musicCard).toBeNull()
  })

  it('says TAP FOR SOUND in place of the bar while the browser holds the sound back', () => {
    const { canvas, words } = writing()
    const p = new TvPainter(canvas)
    p.size(412, 915, 1)
    p.paint(picture({}), { ...assets, music: { ...music, blocked: true } }, 1000, 1, true)
    expect(words).toContain('▶ TAP FOR SOUND')
  })
})

describe('the chiron and NOW PLAYING', () => {
  /** A canvas that keeps its rectangles with their fill, its words with where they went, and its arcs. */
  function drawing(): { canvas: HTMLCanvasElement; rects: Array<{ x: number; y: number; w: number; h: number; fill: unknown }>; words: Array<{ text: string; x: number; y: number }>; arcs: number[][] } {
    const rects: Array<{ x: number; y: number; w: number; h: number; fill: unknown }> = []
    const words: Array<{ text: string; x: number; y: number }> = []
    const arcs: number[][] = []
    const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: '#000' }
    const ctx = new Proxy({
      measureText: (t: string) => ({ width: Array.from(t).length * 7 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillRect: (x: number, y: number, w: number, h: number) => { rects.push({ x, y, w, h, fill: state.fillStyle }) },
      fillText: (text: string, x: number, y: number) => { words.push({ text, x, y }) },
      arc: (...a: number[]) => { arcs.push(a) },
    } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
      set: (_t, key, v) => { state[key as string] = v; return true },
    })
    return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, rects, words, arcs }
  }
  const music = { title: 'Saturn Day', artist: 'Sethy Bowoy', art: null, progress: 0.4, blocked: false, volume: 0.8, muted: false }
  const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
  const RULE = 'rgba(0, 229, 255, 0.45)'

  it('stand side by side on a wide screen, the chiron on the left, the same height, a blue rule on its top', () => {
    const d = drawing()
    const p = new TvPainter(d.canvas)
    p.size(1400, 800, 1)
    p.paint(picture({ shot: trip as never, scaleExp: 33 }), { ...assets, music }, 1000, 1, false)
    const card = p.musicCard!
    const rule = d.rects.find((r) => r.fill === RULE)!
    expect(rule).toBeDefined()
    // The chiron's rule ends before NOW PLAYING begins, on the same top.
    expect(rule.x + rule.w).toBeLessThan(card.x)
    expect(rule.y).toBeCloseTo(card.y, 5)
    expect(rule.h).toBeLessThanOrEqual(1.35)
    // And reaches most of the way across.
    expect(rule.w).toBeGreaterThan(1400 * 0.5)
  })

  it('shows the zoom as 2 to the power of the shot\'s, boxed at the far right, and no scale bar', () => {
    const d = drawing()
    const p = new TvPainter(d.canvas)
    p.size(1400, 800, 1)
    p.paint(picture({ shot: trip as never, scaleExp: 33 }), { ...assets, music }, 1000, 1, false)
    const two = d.words.find((w) => w.text === '2')!
    const exp = d.words.find((w) => w.text === '33')!
    expect(two).toBeDefined()
    expect(exp).toBeDefined()
    // Raised, after the 2, and right of the name.
    expect(exp.x).toBeGreaterThan(two.x)
    expect(exp.y).toBeLessThan(two.y)
    expect(two.x).toBeGreaterThan(d.words.find((w) => w.text === 'ANN')!.x + 400)
    expect(d.words.some((w) => w.text === 'ZOOM' || w.text.startsWith('1 CELL'))).toBe(false)
  })

  it('on a phone: the chiron the whole width under NOW PLAYING, its zoom boxed too', () => {
    const d = drawing()
    const p = new TvPainter(d.canvas)
    p.size(412, 915, 1)
    p.paint(picture({ shot: trip as never, scaleExp: 12 }), { ...assets, music }, 1000, 1, false)
    const card = p.musicCard!
    const rule = d.rects.find((r) => r.fill === RULE)!
    expect(rule.y).toBeGreaterThan(card.y + card.h)
    expect(rule.w).toBeCloseTo(card.w, 0)
    expect(d.words.some((w) => w.text === '12')).toBe(true)
    expect(d.words.some((w) => w.text === 'ZOOM')).toBe(false)
  })

  it('says how many are watching after the CYBERSPACE TV bug, and the marquee runs after it', () => {
    const d = drawing()
    const p = new TvPainter(d.canvas)
    p.size(1400, 800, 1)
    p.paint(picture({ shot: trip as never, arrivals: [{ pubkey: 'zed', at: 50 }] }), { ...assets, music, watching: 3 }, 1000, 1, false)
    const tv = d.words.find((w) => w.text === 'TV')!
    const watching = d.words.find((w) => w.text === '3 WATCHING')!
    expect(watching).toBeDefined()
    expect(watching.x).toBeGreaterThan(tv.x)
    // The run's first words start right of the count's end.
    const run = d.words.filter((w) => w.y === tv.y && w.x > tv.x && w.text !== '3 WATCHING' && w.text !== '◆')
    expect(run.length).toBeGreaterThan(0)
    for (const w of run) expect(w.x).toBeGreaterThan(watching.x + '3 WATCHING'.length * 7)
    // Without a count yet, no words for it.
    const e = drawing()
    const q = new TvPainter(e.canvas)
    q.size(1400, 800, 1)
    q.paint(picture({ shot: trip as never }), { ...assets, music }, 1000, 1, false)
    expect(e.words.some((w) => w.text.endsWith('WATCHING'))).toBe(false)
  })

  it('the HOSAKA end card draws the menu button after its last line', () => {
    const end = HOSAKA_1.scenes[HOSAKA_1.scenes.length - 1]
    expect(end.icon).toBe('menu')
    const d = drawing()
    const p = new TvPainter(d.canvas)
    p.size(1400, 800, 1)
    p.paint(picture({ shot: trip as never, ad: { at: 0, id: HOSAKA_1.id } }), { ...assets, music }, 700 + ((end.from + end.to) / 2) * 1000, 1, false)
    const line = d.words.find((w) => w.text === 'IN THE ONOSENDAI MENU')!
    expect(line).toBeDefined()
    // A disc to the right of the line's middle (the line is centred with it, so shifted left of 0).
    expect(line.x).toBeLessThan(0)
    const disc = d.arcs.find((a) => a[0] > line.x + ('IN THE ONOSENDAI MENU'.length * 7) / 2)
    expect(disc).toBeDefined()
    // Its three bars, in the accent.
    const bars = d.rects.filter((r) => r.fill === '#00e5ff' && Math.abs(r.x + r.w / 2 - disc![0]) < 0.01)
    expect(bars).toHaveLength(3)
  })
})

describe('a tap on the glass', () => {
  it('lands where the picture shows it: the centre stays, the edges bend outward', () => {
    expect(flatPoint(500, 300, 1000, 600)).toEqual([500, 300])
    const [x, y] = flatPoint(900, 540, 1000, 600)
    expect(x).toBeGreaterThan(900)
    expect(y).toBeGreaterThan(540)
  })
})

describe('the HOSAKA commercial', () => {
  /** A canvas that keeps the words it writes and the pictures it draws. */
  function recording(): { canvas: HTMLCanvasElement; words: string[]; images: unknown[] } {
    const words: string[] = []
    const images: unknown[] = []
    const state: Record<string, unknown> = { globalAlpha: 1 }
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), fillText: (t: string) => { if ((state.globalAlpha as number) > 0) words.push(t) }, drawImage: (img: unknown) => { images.push(img) } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
      set: (_t, key, v) => { state[key as string] = v; return true },
    })
    return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, words, images }
  }
  const banner = { banner: true }
  const mark = { mark: true }
  const music = { title: 'Saturn Day', artist: 'Sethy Bowoy', art: null, progress: 0.4, blocked: false, volume: 0.8, muted: false }
  const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
  /** Paint the spot `t` seconds in (after its cut). */
  function at(t: number): { words: string[]; images: unknown[]; p: TvPainter } {
    const r = recording()
    const p = new TvPainter(r.canvas)
    p.size(1400, 800, 1)
    p.paint(picture({ shot: trip as never, ad: { at: 0, id: HOSAKA_1.id } }), { ...assets, music, hosaka: banner as never, hosakaMark: mark as never }, 700 + t * 1000, 1, false)
    return { ...r, p }
  }

  it('opens on the banner, huge, marked as an advertisement, with no chiron', () => {
    const { words, images, p } = at(2)
    expect(images).toContain(banner)
    expect(words).toContain('ADVERTISEMENT')
    expect(words).not.toContain('ANN')
    expect(words).not.toContain('HOSAKA')
    // No music card over the spot ("gotta hide the music player during the hosaka ad"), nor its tap.
    expect(words).not.toContain('SATURN DAY')
    expect(words).not.toContain('♪ NOW PLAYING')
    expect(p.musicCard).toBeNull()
  })

  it('then one card at a time: the banner gone, the mark over HOSAKA CAN HELP.', () => {
    const first = at(5.5)
    expect(first.words).toContain('CYBERDECK')
    expect(first.words).not.toContain('CAN HELP.')
    expect(first.images).not.toContain(banner)
    const second = at(7.6)
    expect(second.words).toEqual(expect.arrayContaining(['HOSAKA', 'CAN HELP.']))
    expect(second.words).not.toContain('CYBERDECK')
    expect(second.images).toContain(mark)
  })

  it('on short screens with music, every word stays readable, NOW PLAYING stays away, and the name is said in full', () => {
    for (const [w, h] of [[844, 390], [1024, 400], [640, 300], [568, 320], [740, 340]]) {
      // Every scene after the banner, at its middle, so a retimed spot is still covered to its end card.
      for (const t of HOSAKA_1.scenes.slice(1).map((sc) => (sc.from + sc.to) / 2)) {
        // A canvas that keeps each word with its type size and where it lands, through saves and moves.
        type St = { font: string; dx: number; dy: number; k: number; globalAlpha: number }
        let st: St = { font: '', dx: 0, dy: 0, k: 1, globalAlpha: 1 }
        const stack: St[] = []
        const seen: Array<{ text: string; px: number; x: number; y: number }> = []
        const ctx = new Proxy({
          measureText: (x: string) => ({ width: Array.from(x).length * Number(/([\d.]+)px/.exec(st.font)?.[1] ?? 10) * 0.62 }),
          createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }),
          save: () => { stack.push({ ...st }) }, restore: () => { st = stack.pop() ?? st },
          translate: (x: number, y: number) => { st.dx += x * st.k; st.dy += y * st.k }, scale: (_x: number, y: number) => { st.k *= y },
          fillText: (x: string, a: number, y: number) => { seen.push({ text: x, px: Number(/([\d.]+)px/.exec(st.font)?.[1] ?? 0) * st.k, x: st.dx + a * st.k, y: st.dy + y * st.k }) },
        } as Record<string, unknown>, {
          get: (target, key) => (key in target ? target[key as string] : key in st ? st[key as keyof St] : () => {}),
          set: (_t, key, v) => { (st as Record<string, unknown>)[key as string] = v; return true },
        })
        const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
        p.size(w, h, 1.5)
        p.paint(picture({ ad: { at: 0, id: HOSAKA_1.id } }), { ...assets, music, hosaka: banner as never, hosakaMark: mark as never }, 700 + t * 1000 + 300, 1.5, false)
        const s = 1.5 * Math.min(1.35, Math.max(0.9, w / 1400))
        expect(p.musicCard, `${w}x${h} ${t}s`).toBeNull()
        expect(seen.some((x) => x.text === '♪ NOW PLAYING'), `${w}x${h} ${t}s`).toBe(false)
        const scene = HOSAKA_1.scenes.find((sc) => t >= sc.from && t < sc.to)!
        for (const line of scene.lines) {
          const word = seen.find((x) => x.text === line)
          expect(word, `${w}x${h} ${t}s ${line}`).toBeDefined()
          expect(word!.px, `${w}x${h} ${t}s ${line}`).toBeGreaterThanOrEqual((scene.kind === 'end' ? 12 : 18) * s - 0.01)
        }
        if (scene.kind === 'end') expect(seen.some((x) => x.text.includes('HIGH-AVAILABILITY')), `${w}x${h} subtitle`).toBe(true)
      }
    }
  })

  it('ends on the mark, the name in full, and where to find it', () => {
    const end = HOSAKA_1.scenes[HOSAKA_1.scenes.length - 1]
    const { words, images } = at((end.from + end.to) / 2)
    expect(images).toContain(mark)
    expect(words).toEqual(expect.arrayContaining(['SEE THE CLOUD COMPUTE PANEL', 'IN THE ONOSENDAI MENU']))
    expect(words.some((w) => w.includes('HIGH-AVAILABILITY OFFLOAD SERVICE'))).toBe(true)
  })
})
