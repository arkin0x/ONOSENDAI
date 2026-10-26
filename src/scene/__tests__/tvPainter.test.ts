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
import { TvPainter, fit, tickerItems, wrap, type TvAssets, type TvExplainer, type TvPicture } from '../tvPainter'
import { cutKind, explainerPipRect, flatPoint, tubeDrift, tubeFlicker } from '../TvScreenEffect'
import { Vector2 } from 'three'
import { useTv } from '../../store/useTv'
import { ADS, CTV_ADDRESS, CTV_ADDRESS_HOLD_S, CTV_ADVERTISE_1, HOSAKA_1, type AdScene, type TvAd } from '../../lib/tv/hosakaAd'
import { setBroadcastForTest } from '../../lib/tv/broadcast'

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

  it('hides while an explainer plays, with the rest of its own furniture, and returns once the picture is back (arkinox, 2026-10-24)', () => {
    const p = new TvPainter(fakeCanvas())
    p.size(1200, 700, 1)
    let now = 1000
    p.paint(picture({ arrivals: [{ pubkey: 'ann', at: 1 }] }), assets, now, 1, false)
    const before = p.marqueeRun
    expect(before.length).toBeGreaterThan(0)
    const explainer: TvExplainer = { title: 'TEST', mix: 0.5, pip: { x: 0, y: 0, w: 10, h: 10 }, video: { x: 0, y: 0, w: 100, h: 100 }, caption: null }
    // Many frames, real elapsed time, a new arrival: the marquee stays
    // exactly as it was while an explainer plays, never scrolling or taking it up.
    for (let i = 0; i < 60; i++) {
      now += 300
      p.paint(picture({ arrivals: [{ pubkey: 'bob', at: 2 }] }), { ...assets, explainer }, now, 1, false)
    }
    expect(p.marqueeRun).toEqual(before)
    // The picture is back (mix at 0, as it is once it has grown back to the
    // whole tube): scrolling resumes, and it takes up what it missed.
    let changed = false
    for (let i = 0; i < 60 && !changed; i++) {
      now += 300
      p.paint(picture({ arrivals: [{ pubkey: 'bob', at: 2 }] }), assets, now, 1, false)
      changed = JSON.stringify(p.marqueeRun) !== JSON.stringify(before)
    }
    expect(changed).toBe(true)
  })
})

describe('cuts', () => {
  it('take turns between dip, roll and snow, and are all dips with reduced motion', () => {
    const kinds = new Set([0, 7, 14, 21, 28, 35].map((t) => cutKind(t, false)))
    expect([...kinds].sort()).toEqual([0, 1, 2])
    expect(cutKind(14, true)).toBe(0)
  })
})

describe('an explainer\'s live-picture PIP (EXPLAINER_PIP_ENABLED)', () => {
  const pip = { x: 20, y: 30, w: 100, h: 60 }

  it('enabled: shrinks from the whole tube to the corner as mix goes 0 to 1', () => {
    expect(explainerPipRect(1280, 720, pip, 0, true)).toEqual({ x: 0, y: 0, w: 1280, h: 720 })
    expect(explainerPipRect(1280, 720, pip, 1, true)).toEqual(pip)
    expect(explainerPipRect(1280, 720, pip, 0.5, true)).toEqual({ x: 10, y: 15, w: 690, h: 390 })
  })

  it('off (the default since 2026-10-24): never the corner, whatever mix is, so the shader never draws it', () => {
    const hidden = explainerPipRect(1280, 720, pip, 1, false)
    // Off the flat frame on every side, however it is scaled: never inside 0..1 of it.
    expect(hidden.x + hidden.w).toBeLessThan(0)
    expect(hidden.y + hidden.h).toBeLessThan(0)
    // The same rect whatever mix is: no corner to shrink into at all.
    expect(explainerPipRect(1280, 720, pip, 0.01, false)).toEqual(hidden)
    expect(explainerPipRect(1280, 720, pip, 1, false)).toEqual(hidden)
  })

  it('defaults to EXPLAINER_PIP_ENABLED (off)', () => {
    expect(explainerPipRect(1280, 720, pip, 1)).toEqual(explainerPipRect(1280, 720, pip, 1, false))
  })
})

describe('the tube\'s once-a-frame terms', () => {
  // Worked out on every pixel before (2026-10-20); the same numbers once a frame.
  it('drift is the turning unit split the shader worked out per pixel', () => {
    const out = new Vector2()
    for (const t of [0, 1.7, 9.2, 33.3, 600.5, 7200.25]) {
      tubeDrift(t, out)
      const x = Math.cos(t * 0.35), y = 0.6 * Math.sin(t * 0.35), l = Math.hypot(x, y)
      expect(out.length()).toBeCloseTo(1, 12)
      expect(out.x).toBeCloseTo(x / l, 12)
      expect(out.y).toBeCloseTo(y / l, 12)
    }
  })
  it('are what the shader worked out at known points', () => {
    const out = new Vector2()
    // turn = t * 0.35: none at 0, a quarter turn at pi / 0.7.
    expect(tubeDrift(0, out).toArray()).toEqual([1, 0])
    tubeDrift(Math.PI / 0.7, out)
    expect(out.x).toBeCloseTo(0, 12)
    expect(out.y).toBeCloseTo(1, 12)
    expect(tubeFlicker(0)).toBe(0.975)
    expect(tubeFlicker(Math.PI / 114)).toBeCloseTo(1, 12)
  })
  it('flicker stays within two and a half per cent either side of 0.975', () => {
    for (let t = 0; t < 10; t += 0.013) {
      const f = tubeFlicker(t)
      expect(f).toBeGreaterThanOrEqual(0.95)
      expect(f).toBeLessThanOrEqual(1)
      expect(f).toBeCloseTo(0.975 + 0.025 * Math.sin(t * 57), 12)
    }
  })
})

describe('fit', () => {
  it('cuts with an ellipsis, and measures a very long text (a bag count has no cap, spec 7.7) only as far as a panel could show', () => {
    const measured: number[] = []
    const ctx = { measureText: (t: string) => { measured.push(t.length); return { width: t.length * 10 } } } as unknown as CanvasRenderingContext2D
    expect(fit(ctx, 'short', 100)).toBe('short')
    expect(fit(ctx, 'abcdefghijkl', 50)).toBe('abcd…')
    measured.length = 0
    expect(fit(ctx, `${'9'.repeat(100_000)} SHARDS`, 200)).toBe(`${'9'.repeat(19)}…`)
    expect(Math.max(...measured)).toBeLessThanOrEqual(2049)
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

describe('the sealed bag\'s splashes', () => {
  /** The words filled on the canvas, and where (after translate), while the bag's panel is painted. */
  function splashes(item: { money: boolean; nft?: boolean }): Array<{ text: string; x: number }> {
    vi.spyOn(performance, 'now').mockReturnValue(1e12)
    const bag = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: 'p', at: 1, hint: null, height: 3, counts: null, ...item }
    const shot = { id: bag.id, kind: 'bag' as const, item: bag, pubkey: 'p', beats: [], start: 1, end: 1, offsets: [], length: 10.7 }
    useTv.setState({ shot, status: 'playing' })
    const out: Array<{ text: string; x: number }> = []
    let tx = 0
    const ctx = new Proxy({
      measureText: (t: string) => ({ width: Array.from(t).length * 7 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      save: () => {}, restore: () => { tx = 0 },
      translate: (x: number) => { tx = x },
      fillText: (text: string, x: number) => { out.push({ text, x: tx + x }) },
    } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
    p.size(412, 915, 1)
    p.paint(picture({ shot }), assets, 1e12, 1, false)
    vi.restoreAllMocks()
    return out
  }
  const at = (words: Array<{ text: string; x: number }>, text: string): number[] => words.filter((w) => w.text === text).map((w) => w.x)

  it('hypes an NFT inside as it hypes money: NFT INSIDE!', () => {
    const words = splashes({ money: false, nft: true })
    expect(at(words, 'NFT')).toHaveLength(1)
    expect(at(words, 'INSIDE!')).toHaveLength(1)
    expect(at(words, 'CASHU')).toHaveLength(0)
  })

  it('with money too, both splashes, on different corners of the cube', () => {
    const words = splashes({ money: true, nft: true })
    const [cashu] = at(words, 'CASHU')
    const [nft] = at(words, 'NFT')
    expect(cashu).toBeDefined()
    expect(nft).toBeDefined()
    expect(Math.abs(cashu - nft)).toBeGreaterThan(40)
  })

  it('no NFT, no NFT splash', () => {
    expect(at(splashes({ money: true }), 'NFT')).toHaveLength(0)
  })
})

/** The chiron's top rule's fill (tvPainter chiron). */
const RULE = 'rgba(0, 229, 255, 0.45)'

/** A canvas that keeps its stroked rectangles (a segment's panel is the first) and where the chiron's rule was filled. */
function panelCanvas(): { canvas: HTMLCanvasElement; strokes: number[][]; ruleTop: () => number | undefined } {
  const strokes: number[][] = []
  const fills: Array<{ y: number; fill: unknown }> = []
  const state: Record<string, unknown> = { globalAlpha: 1, fillStyle: '#000' }
  const ctx = new Proxy({
    measureText: (t: string) => ({ width: Array.from(t).length * 7 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    strokeRect: (...r: number[]) => { strokes.push(r) },
    fillRect: (_x: number, y: number) => { fills.push({ y, fill: state.fillStyle }) },
  } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
    set: (_t, key, v) => { state[key as string] = v; return true },
  })
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, strokes, ruleTop: () => fills.find((f) => f.fill === RULE)?.y }
}

describe('a sealed bag on a phone on its side', () => {
  it('goes beside the clock, clear of the chiron, at either pixel ratio (review of #393)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1e12)
    const item = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: 'p', at: 1, hint: null, height: 3, money: false, counts: null }
    const shot = { id: item.id, kind: 'bag' as const, item, pubkey: 'p', beats: [], start: 1, end: 1, offsets: [], length: 10 }
    useTv.setState({ shot: shot as never, status: 'playing' })
    for (const k of [1, 2]) {
      const d = panelCanvas()
      const p = new TvPainter(d.canvas)
      p.size(844, 390, k)
      p.paint(picture({ shot: shot as never }), { ...assets, music: { title: 'Saturn Day', artist: 'Sethy Bowoy', art: null, progress: 0.4, blocked: false, volume: 0.8, muted: false } }, 1e12, k, false)
      const [, y, , h] = d.strokes[0]
      expect(y + h, `scale ${k}`).toBeLessThanOrEqual(d.ruleTop()! + 0.01)
    }
    vi.restoreAllMocks()
  })
})

describe('a comment on a small phone', () => {
  it('keeps its panel clear of NOW PLAYING over the chiron (review of #393)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1e12)
    const item = { kind: 'comment' as const, id: 'c'.repeat(64), pubkey: 'p', at: 1, text: 'word '.repeat(60).trim(), on: 'move' as const, about: null }
    const shot = { id: item.id, kind: 'comment' as const, item, pubkey: 'p', beats: [], start: 1, end: 1, offsets: [], length: 10 }
    useTv.setState({ shot, status: 'playing' })
    const d = panelCanvas()
    const p = new TvPainter(d.canvas)
    p.size(568, 375, 1)
    p.paint(picture({ shot }), { ...assets, music: { title: 'Saturn Day', artist: 'Sethy Bowoy', art: null, progress: 0.4, blocked: false, volume: 0.8, muted: false } }, 1e12, 1, false)
    vi.restoreAllMocks()
    const card = p.musicCard!
    expect(card).not.toBeNull()
    const [, y, , h] = d.strokes[0]
    expect(y + h).toBeLessThanOrEqual(card.y + 0.01)
  })
})

describe('a long comment on a phone on its side', () => {
  it('keeps clear of the chiron: the type steps down and the quote is cut', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1e12)
    const text = 'word '.repeat(88).trim()
    const item = { kind: 'comment' as const, id: 'c'.repeat(64), pubkey: 'p', at: 1, text, on: 'move' as const, about: null }
    const shot = { id: item.id, kind: 'comment' as const, item, pubkey: 'p', beats: [], start: 1, end: 1, offsets: [], length: 10 }
    useTv.setState({ shot, status: 'playing' })
    const d = panelCanvas()
    const p = new TvPainter(d.canvas)
    p.size(915, 412, 1)
    p.paint(picture({ shot }), assets, 1e12, 1, false)
    vi.restoreAllMocks()
    // The panel's border is the first rectangle stroked; the chiron's top is its rule's.
    const [, y, , h] = d.strokes[0]
    expect(y + h).toBeLessThanOrEqual(d.ruleTop()! + 0.01)
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

  it('stack as on a phone on a short screen, however wide: a phone on its side is not the desktop row', () => {
    for (const [w, h] of [[844, 390], [1920, 480]]) {
      const d = drawing()
      const p = new TvPainter(d.canvas)
      p.size(w, h, 1)
      p.paint(picture({ shot: trip as never, scaleExp: 12 }), { ...assets, music }, 1000, 1, false)
      const card = p.musicCard!
      const rule = d.rects.find((r) => r.fill === RULE)!
      // The chiron spans the margins, and NOW PLAYING stands over it.
      expect(rule.w, `${w}x${h}`).toBeCloseTo(w - 2 * Math.round(w * 0.06), 0)
      expect(card.y + card.h, `${w}x${h}`).toBeLessThanOrEqual(rule.y)
    }
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

  it('keeps the run where it was as the count gains a digit', () => {
    const d = drawing()
    const p = new TvPainter(d.canvas)
    p.size(1400, 800, 1)
    const pic = picture({ shot: trip as never, arrivals: [{ pubkey: 'zed', at: 50 }] })
    const runAt = (): number => d.words.find((w) => w.text.startsWith('NEW ARRIVAL'))!.x
    // The same moment painted twice, so the run itself has not moved.
    p.paint(pic, { ...assets, music, watching: 9 }, 1000, 1, false)
    const at9 = runAt()
    d.words.length = 0
    p.paint(pic, { ...assets, music, watching: 10 }, 1000, 1, false)
    expect(runAt()).toBeCloseTo(at9, 5)
  })

  it('on a 320 px phone says the number alone, and leaves the run room', () => {
    const d = drawing()
    const p = new TvPainter(d.canvas)
    p.size(320, 568, 1)
    p.paint(picture({ shot: trip as never, arrivals: [{ pubkey: 'zed', at: 50 }] }), { ...assets, music, watching: 12 }, 1000, 1, false)
    const tv = d.words.find((w) => w.text === 'TV')!
    const count = d.words.find((w) => w.text === '12' && Math.abs(w.y - tv.y) < 2)!
    expect(count).toBeDefined()
    expect(d.words.some((w) => w.text.endsWith('WATCHING'))).toBe(false)
    expect(count.x).toBeGreaterThan(tv.x)
    // The run starts after the count, and has at least a third of the marquee.
    const run = d.words.filter((w) => w.y === tv.y && w.text.startsWith('NEW ARRIVAL'))
    expect(run.length).toBeGreaterThan(0)
    const MX = Math.round(320 * 0.06)
    const startOfRun = count.x + 3 * 7 + 16
    expect(320 - MX - startOfRun).toBeGreaterThan((320 - 2 * MX) / 3)
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
    // Its three bars, each two round ends, inside the disc.
    const ends = d.arcs.filter((a) => a !== disc && Math.abs(a[0] - disc![0]) < disc![2] && a[2] < disc![2] * 0.1)
    expect(ends).toHaveLength(6)
    expect(new Set(ends.map((a) => a[1].toFixed(3))).size).toBe(3)
  })
})

describe('the HOSAKA end card on a phone', () => {
  it('keeps the line and its button inside the frame, centred together', () => {
    const end = HOSAKA_1.scenes[HOSAKA_1.scenes.length - 1]
    const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
    for (const [w, h] of [[320, 568], [390, 844], [1400, 800]]) {
      const words: Array<{ text: string; x: number; font: string }> = []
      const arcs: number[][] = []
      const state: Record<string, unknown> = { globalAlpha: 1, font: '' }
      const ctx = new Proxy({
        measureText: (t: string) => ({ width: Array.from(t).length * parseFloat(String(state.font).replace(/^700 /, '')) * 0.6 }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        fillText: (text: string, x: number) => { words.push({ text, x, font: String(state.font) }) },
        arc: (...a: number[]) => { arcs.push(a) },
      } as Record<string, unknown>, {
        get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
        set: (_t, key, v) => { state[key as string] = v; return true },
      })
      const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
      p.size(w, h, 1)
      p.paint(picture({ shot: trip as never, ad: { at: 0, id: HOSAKA_1.id } }), assets, 700 + ((end.from + end.to) / 2) * 1000, 1, false)
      const line = words.find((x) => x.text === 'IN THE ONOSENDAI MENU')!
      expect(line, `${w}x${h}`).toBeDefined()
      const size = parseFloat(line.font.replace(/^700 /, ''))
      const tw = line.text.length * size * 0.6
      const disc = arcs.filter((a) => a[0] > line.x).sort((a, b) => b[2] - a[2])[0]
      // Drawn about the frame's centre: what is inked runs from the line's left to the disc's right.
      const left = line.x - tw / 2
      const right = disc[0] + disc[2]
      expect(Math.abs(left + right), `${w}x${h} centred`).toBeLessThan(0.5)
      expect(right - left, `${w}x${h} fits`).toBeLessThanOrEqual(w * (1 - 2 * 0.06))
    }
  })
})

describe('the HOSAKA end card on the 24/7 stream (arkinox, 2026-10-21)', () => {
  /** Paint the end card at w x h; each line written, its type size and where it starts, and the discs. */
  function endCard(w: number, h: number): { words: Array<{ text: string; x: number; font: string }>; arcs: number[][] } {
    const end = HOSAKA_1.scenes[HOSAKA_1.scenes.length - 1]
    const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
    const words: Array<{ text: string; x: number; font: string }> = []
    const arcs: number[][] = []
    const state: Record<string, unknown> = { globalAlpha: 1, font: '' }
    const ctx = new Proxy({
      measureText: (t: string) => ({ width: Array.from(t).length * parseFloat(String(state.font).replace(/^700 /, '')) * 0.6 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillText: (text: string, x: number) => { words.push({ text, x, font: String(state.font) }) },
      arc: (...a: number[]) => { arcs.push(a) },
    } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
      set: (_t, key, v) => { state[key as string] = v; return true },
    })
    const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
    p.size(w, h, 1)
    p.paint(picture({ shot: trip as never, ad: { at: 0, id: HOSAKA_1.id } }), assets, 700 + ((end.from + end.to) / 2) * 1000, 1, false)
    return { words, arcs }
  }

  it('says ONOSENDAI.TECH, inside the frame at 1280x720 with its button, the type at least the floor', () => {
    setBroadcastForTest(true)
    try {
      const { words, arcs } = endCard(1280, 720)
      expect(words.some((x) => x.text === 'IN THE ONOSENDAI MENU')).toBe(false)
      const line = words.find((x) => x.text === 'IN THE ONOSENDAI.TECH MENU')!
      expect(line).toBeDefined()
      expect(words.some((x) => x.text === 'SEE THE CLOUD COMPUTE PANEL')).toBe(true)
      const size = parseFloat(line.font.replace(/^700 /, ''))
      expect(size).toBeGreaterThanOrEqual(12)
      const tw = line.text.length * size * 0.6
      const disc = arcs.filter((a) => a[0] > line.x).sort((a, b) => b[2] - a[2])[0]
      expect(disc).toBeDefined()
      const left = line.x - tw / 2
      const right = disc[0] + disc[2]
      expect(Math.abs(left + right)).toBeLessThan(0.5)
      expect(right - left).toBeLessThanOrEqual(1280 * (1 - 2 * 0.06))
    } finally {
      setBroadcastForTest(null)
    }
  })

  it('the site keeps its own words', () => {
    setBroadcastForTest(false)
    try {
      const { words } = endCard(1280, 720)
      expect(words.some((x) => x.text === 'IN THE ONOSENDAI MENU')).toBe(true)
      expect(words.some((x) => x.text.includes('ONOSENDAI.TECH'))).toBe(false)
    } finally {
      setBroadcastForTest(null)
    }
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

describe('the house spot for the ad slot itself (CTV_ADVERTISE_1, arkinox 2026-10-24)', () => {
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
  const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
  /** Paint the spot `t` seconds in (after its cut), with the HOSAKA assets present too, to prove they are never drawn for this spot. */
  function at(t: number): { words: string[]; images: unknown[] } {
    const r = recording()
    const p = new TvPainter(r.canvas)
    p.size(1400, 800, 1)
    p.paint(picture({ shot: trip as never, ad: { at: 0, id: CTV_ADVERTISE_1.id } }), { ...assets, hosaka: banner as never, hosakaMark: mark as never }, 700 + t * 1000, 1, false)
    return r
  }

  it('opens straight on its first card, marked as an advertisement, with no banner and no mark drawn', () => {
    const { words, images } = at(1)
    expect(words).toContain('ADVERTISEMENT')
    expect(words).toContain('THIS SPOT')
    expect(words).toContain('IS OPEN.')
    expect(images).not.toContain(banner)
    expect(images).not.toContain(mark)
  })

  it('then the second card names Cyberspace TV', () => {
    const { words, images } = at(3.5)
    expect(words).toEqual(expect.arrayContaining(['ADVERTISE ON', 'CYBERSPACE TV.']))
    expect(images).not.toContain(mark)
  })

  it('ends on the call and the address, verbatim, with no mark and no menu button', () => {
    const end = CTV_ADVERTISE_1.scenes[CTV_ADVERTISE_1.scenes.length - 1]
    const { words, images } = at((end.from + end.to) / 2)
    expect(words).toContain('EMAIL TO CLAIM IT:')
    // The address is given exactly as arkinox gave it (2026-10-26): lower case, not re-cased like the ad's all-caps calls.
    expect(CTV_ADDRESS).toBe('arkinox@pm.me')
    expect(words).toContain('arkinox@pm.me')
    expect(words.some((w) => w.includes('ARKINOX') || w.includes('PM.ME'))).toBe(false)
    expect(words.some((w) => /simplelogin|aflutter/i.test(w))).toBe(false)
    expect(images).not.toContain(mark)
  })

  /**
   * A canvas that keeps, for each line of text, the size it is set in, the
   * strength it is drawn at (save and restore kept, as a real canvas keeps
   * them), and how wide it measures: a character is 0.6 of the type size,
   * about what the TV's monospaced face measures.
   */
  function typeCanvas(): { canvas: HTMLCanvasElement; seen: Array<{ text: string; size: number; alpha: number; width: number }> } {
    const seen: Array<{ text: string; size: number; alpha: number; width: number }> = []
    let state: Record<string, unknown> = { globalAlpha: 1, font: '' }
    const stack: Array<Record<string, unknown>> = []
    const size = (): number => parseFloat(String(state.font).replace(/^700 /, ''))
    const ctx = new Proxy({
      measureText: (t: string) => ({ width: Array.from(t).length * size() * 0.6 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      save: () => { stack.push({ ...state }) },
      restore: () => { state = stack.pop() ?? state },
      fillText: (text: string) => { seen.push({ text, size: size(), alpha: state.globalAlpha as number, width: Array.from(text).length * size() * 0.6 }) },
    } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
      set: (_t, key, v) => { state[key as string] = v; return true },
    })
    return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, seen }
  }

  /** The address as painted `t` seconds into the spot, on a frame `w` x `h` CSS px. */
  function address(t: number, w: number, h: number): { size: number; alpha: number; width: number } | undefined {
    const { canvas, seen } = typeCanvas()
    const p = new TvPainter(canvas)
    p.size(w, h, 1)
    p.paint(picture({ shot: trip as never, ad: { at: 0, id: CTV_ADVERTISE_1.id } }), assets, 700 + t * 1000, 1, false)
    return seen.find((l) => l.text === CTV_ADDRESS)
  }

  it(`holds the address ${CTV_ADDRESS_HOLD_S} s, at full strength all but its quick cut in and out, never blinking (arkinox, 2026-10-26: "not long enough for anyone to read it")`, () => {
    const end = CTV_ADVERTISE_1.scenes[CTV_ADVERTISE_1.scenes.length - 1]
    expect(end.lines).toContain(CTV_ADDRESS)
    expect(end.to - end.from).toBe(CTV_ADDRESS_HOLD_S)
    expect(CTV_ADDRESS_HOLD_S).toBeGreaterThanOrEqual(10)
    // Every tenth of a second through the scene: how long it stands at full strength without a break.
    let run = 0, longest = 0
    for (let t = end.from; t < end.to; t += 0.1) {
      const a = address(t, 1400, 800)
      run = a && a.alpha >= 0.999 ? run + 0.1 : 0
      longest = Math.max(longest, run)
    }
    expect(longest).toBeGreaterThan(CTV_ADDRESS_HOLD_S - 0.5)
  })

  it('makes the whole spot longer than it was (9.7 s), the first two cards held a little longer too', () => {
    const [one, two] = CTV_ADVERTISE_1.scenes
    expect(CTV_ADVERTISE_1.scenes[CTV_ADVERTISE_1.scenes.length - 1].to).toBeGreaterThanOrEqual(6 + CTV_ADDRESS_HOLD_S)
    expect(one.to - one.from).toBeGreaterThan(2.6)
    expect(two.to - two.from).toBeGreaterThan(2.6)
  })

  it('sets the address large: on the 1920 x 1080 stream at text=large and xl, big enough to read on a phone held upright, and inside the frame', () => {
    const end = CTV_ADVERTISE_1.scenes[CTV_ADVERTISE_1.scenes.length - 1]
    const mid = (end.from + end.to) / 2
    try {
      for (const size of ['large', 'xl'] as const) {
        setBroadcastForTest(true, size)
        const a = address(mid, 1920, 1080)!
        expect(a, size).toBeDefined()
        // The frame shown 400 px wide on a phone held upright (lib/tv/broadcast):
        // at least 24 px type there, more than twice the end card's 20 px a unit it had.
        expect(a.size * (400 / 1920), size).toBeGreaterThanOrEqual(24)
        expect(a.width, size).toBeLessThanOrEqual(1920 * (1 - 2 * 0.06))
      }
      // The normal text size on the stream, and the site on a laptop: as big as a punch card's.
      setBroadcastForTest(true, 'normal')
      expect(address(mid, 1920, 1080)!.size).toBeGreaterThanOrEqual(60)
      setBroadcastForTest(false)
      expect(address(mid, 1400, 800)!.size).toBeGreaterThanOrEqual(40)
      // A phone held upright on the site: still the width of the frame at most, and above a card's floor.
      const phone = address(mid, 390, 800)!
      expect(phone.size).toBeGreaterThanOrEqual(18)
      expect(phone.width).toBeLessThanOrEqual(390)
    } finally {
      setBroadcastForTest(null)
    }
  })

  it('an end card\'s lines land where a block with no mark and no subtitle should, not pushed down by a stray gap', () => {
    // Regression: subH's 22*s gap used to be added below the subtitle loop
    // whenever the scene was 'end', whether or not there was a subtitle to
    // put it under (tvPainter commercial()), while blockH and fitCard's own
    // sizing only ever budgeted that space when subLines was non-empty. For
    // an end card with no subtitle, that left the whole call shoved down by
    // 22*s past where the centred layout placed it.
    //
    // No shipping spot has such a card any more (the house spot now ends on
    // a regular card, and HOSAKA's end card has a subtitle), so this drives
    // a made-up one: a test-only spot whose one scene is an end card with no
    // mark and no subtitle, added to ADS for this test and taken out after.
    const end: AdScene = { from: 0, to: 4, kind: 'end', lines: ['NO SUBTITLE HERE', 'JUST THE CALL'], accent: 0, theme: 'night' }
    const fixture: TvAd = { id: 'test-end-no-subtitle', scenes: [end] }
    expect(end.kind).toBe('end')
    expect(end.subtitle).toBeUndefined()
    expect(end.mark).toBeUndefined()
    const seen: Array<{ text: string; y: number; size: number }> = []
    const state: Record<string, unknown> = { globalAlpha: 1, font: '' }
    const ctx = new Proxy({
      measureText: (t: string) => ({ width: Array.from(t).length * parseFloat(String(state.font).replace(/^700 /, '')) * 0.6 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      // Local coordinates, as commercial() passes them: no transform tracking needed,
      // since every line here is drawn straight from the card's own centre (x=0).
      fillText: (text: string, _x: number, y: number) => { seen.push({ text, y, size: parseFloat(String(state.font).replace(/^700 /, '')) }) },
    } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : key in state ? state[key as string] : () => {}),
      set: (_t, key, v) => { state[key as string] = v; return true },
    })
    const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
    p.size(1400, 800, 1)
    const trip = { id: 't', kind: 'trip' as const, pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 }
    ADS.push(fixture)
    try {
      setBroadcastForTest(false)
      p.paint(picture({ shot: trip as never, ad: { at: 0, id: fixture.id } }), assets, 700 + ((end.from + end.to) / 2) * 1000, 1, false)
    } finally {
      ADS.splice(ADS.indexOf(fixture), 1)
      setBroadcastForTest(null)
    }
    expect(ADS).not.toContain(fixture)
    // Found only if the painter drew the fixture: an unknown id falls back to the first spot.
    const lines = end.lines.map((text) => seen.find((s) => s.text === text))
    expect(lines.every((l) => l !== undefined)).toBe(true)
    const [first, last] = lines as Array<{ text: string; y: number; size: number }>
    expect(first.size).toBe(last.size)
    const size = first.size
    const N = end.lines.length
    // Independent of the painter's own code: with no mark and no subtitle,
    // the block is just N lines stacked at size*1.12 apiece, centred on the
    // card (blockH = N*size*1.12, top at -blockH/2), each line's baseline
    // nudged up by 0.18*size off the bottom of its own slot.
    const blockH = N * size * 1.12
    const expectedY = (i: number): number => -blockH / 2 + (i + 1) * size * 1.12 - 0.18 * size
    expect(first.y).toBeCloseTo(expectedY(0), 4)
    expect(last.y).toBeCloseTo(expectedY(N - 1), 4)
  })
})

describe('the ad break plays whichever spot the store hands it, by id', () => {
  it('draws HOSAKA\'s card for its id, and the house spot\'s for its own, from the same paint path', () => {
    for (const [id, atSeconds, line] of [[HOSAKA_1.id, 5.5, 'CYBERDECK'], [CTV_ADVERTISE_1.id, 1, 'IS OPEN.']] as const) {
      const words: string[] = []
      const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), fillText: (t: string) => { words.push(t) } } as Record<string, unknown>, {
        get: (target, key) => (key in target ? target[key as string] : () => {}),
        set: () => true,
      })
      const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
      p.size(1400, 800, 1)
      p.paint(picture({ ad: { at: 0, id } }), assets, 700 + atSeconds * 1000, 1, false)
      expect(words, id).toContain(line)
    }
  })
})

describe('the chiron', () => {
  /** A canvas that keeps each line of text drawn, and where. */
  function textCanvas(): { canvas: HTMLCanvasElement; texts: Array<{ text: string; x: number; y: number }> } {
    const texts: Array<{ text: string; x: number; y: number }> = []
    const ctx = new Proxy({
      measureText: (t: string) => ({ width: Array.from(t).length * 7 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillText: (text: string, x: number, y: number) => { texts.push({ text, x, y }) },
    } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, texts }
  }

  function paintChiron(pubkey: string, bot: boolean): { texts: Array<{ text: string; x: number; y: number }>; name: string } {
    vi.spyOn(performance, 'now').mockReturnValue(1e12)
    const item = { kind: 'comment' as const, id: 'c'.repeat(64), pubkey, at: 1, text: 'hi', on: 'move' as const, about: null }
    const shot = { id: item.id, kind: 'comment' as const, item, pubkey, beats: [], start: 1, end: 1, offsets: [], length: 10 }
    useTv.setState({ shot, status: 'playing' })
    const d = textCanvas()
    const p = new TvPainter(d.canvas)
    p.size(1200, 700, 1)
    p.paint(picture({ shot }), { ...assets, bot: () => bot }, 1e12, 1, false)
    vi.restoreAllMocks()
    return { texts: d.texts, name: pubkey.toUpperCase() }
  }

  it('tags any bot AGENT, after its name and on its line (arkinox, 2026-10-20)', () => {
    const { texts, name } = paintChiron('xor', true)
    const shown = texts.find((t) => t.text === name)!
    const tag = texts.find((t) => t.text === 'AGENT')!
    expect(shown).toBeDefined()
    expect(tag).toBeDefined()
    expect(tag.x).toBeGreaterThan(shown.x + name.length * 7)
    expect(Math.abs(tag.y - shown.y)).toBeLessThan(12)
  })

  it('does not tag anyone else', () => {
    const { texts } = paintChiron('ann', false)
    expect(texts.some((t) => t.text === 'ANN')).toBe(true)
    expect(texts.some((t) => t.text === 'AGENT')).toBe(false)
  })

  it('cuts a long name short so the tag still fits where the name would have ended', () => {
    const long = 'n'.repeat(400)
    const plain = paintChiron(long, false).texts.find((t) => t.text.startsWith('NNN'))!
    const { texts } = paintChiron(long, true)
    const shown = texts.find((t) => t.text.startsWith('NNN'))!
    const tag = texts.find((t) => t.text === 'AGENT')!
    expect(shown.text.length).toBeLessThan(plain.text.length)
    expect(tag.x + 'AGENT'.length * 7).toBeLessThanOrEqual(plain.x + Array.from(plain.text).length * 7 + 20)
  })
})

describe('an explainer on the tube (lib/tv/explainer)', () => {
  function writing(): { canvas: HTMLCanvasElement; words: string[] } {
    const words: string[] = []
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), fillText: (t: string) => { words.push(t) } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, words }
  }
  const music = { title: 'Saturn Day', artist: 'Sethy Bowoy', art: null, progress: 0.4, blocked: false, volume: 0.8, muted: false }
  const shot = { id: 'a'.repeat(64), kind: 'trip' as const, pubkey: 'p', beats: [], start: 1, end: 1, offsets: [], length: 5 }
  const explainer = { title: 'WHAT IS CYBERSPACE?', mix: 1, pip: { x: 84, y: 68, w: 420, h: 236 }, video: { x: 0, y: 0, w: 1400, h: 787.5 }, caption: 'Every move is a proof of work.' }

  it("steps the live picture's own words and the top-right block away, and paints its title and caption", () => {
    const { canvas, words } = writing()
    const p = new TvPainter(canvas)
    p.size(1400, 800, 1)
    p.paint(picture({ shot, cutAt: 999, meanwhile: true }), { ...assets, music }, 1000, 1, false)
    expect(words).toContain('P')
    expect(words).toContain('♪ NOW PLAYING')
    expect(p.musicCard).not.toBeNull()
    words.length = 0
    p.paint(picture({ shot, cutAt: 999, meanwhile: true }), { ...assets, music, explainer }, 1040, 1, false)
    // The chiron's name, NOW PLAYING (and its tap), and MEANWHILE are gone.
    expect(words).not.toContain('P')
    expect(words).not.toContain('♪ NOW PLAYING')
    expect(words.some((w) => w.includes('MEANWHILE'))).toBe(false)
    // With the PIP off, no title tag (arkinox, 2026-10-24: "inexplicable
    // stuck captions"), and with the sound on, nothing to tap for it.
    expect(p.musicCard).toBeNull()
    expect(words).not.toContain('WHAT IS CYBERSPACE?')
    // The top-right block steps aside too (arkinox, 2026-10-24: "right top
    // corner should go away"); the caption is painted.
    expect(words).not.toContain('▶ PLAY')
    expect(words).toContain('Every move is a proof of work.')
    expect(p.marqueeTop).toBeGreaterThan(600)
    // Gone again, all back.
    words.length = 0
    p.paint(picture({ shot }), { ...assets, music }, 1080, 1, false)
    expect(words).toContain('P')
    expect(words).toContain('▶ PLAY')
    expect(p.musicCard).not.toBeNull()
  })

  it('says MUTED on the tag while muted; under a PIP, no tap target while the picture is still on its way in', () => {
    const { canvas, words } = writing()
    const p = new TvPainter(canvas)
    p.size(1400, 800, 1)
    // Under a PIP (kept for later): the title, and the sound's state after it.
    const pip = { ...explainer, pipShown: true }
    p.paint(picture({ shot }), { ...assets, music: { ...music, muted: true }, explainer: pip }, 1000, 1, false)
    expect(words).toContain('WHAT IS CYBERSPACE? · MUTED')
    p.paint(picture({ shot }), { ...assets, music, explainer: { ...pip, soundHeld: true } }, 1020, 1, false)
    expect(words).toContain('WHAT IS CYBERSPACE? · TAP FOR SOUND')
    p.paint(picture({ shot }), { ...assets, music, explainer: { ...pip, mix: 0.5 } }, 1040, 1, false)
    expect(p.musicCard).toBeNull()
    // With the PIP off: the sound's state alone, a tap target from the start.
    words.length = 0
    p.paint(picture({ shot }), { ...assets, music: { ...music, muted: true }, explainer: { ...explainer, mix: 0.5 } }, 1060, 1, false)
    expect(words).toContain('♪ MUTED')
    expect(words.some((w) => w.includes('WHAT IS CYBERSPACE?'))).toBe(false)
    expect(p.musicCard).not.toBeNull()
  })

  it('over TUNING, says nothing in the middle of the video', () => {
    const { canvas, words } = writing()
    const p = new TvPainter(canvas)
    p.size(1400, 800, 1)
    p.paint(picture({ status: 'tuning' }), { ...assets, explainer }, 1000, 1, false)
    expect(words).not.toContain('TUNING')
  })
})

describe('the zoom badge on the chiron', () => {
  /** A fake 2D context that measures every character as 7 px and records what is written where. */
  function recordingCanvas(texts: Array<{ text: string; x: number }>): HTMLCanvasElement {
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), fillText: (text: string, x: number) => { texts.push({ text, x }) } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
  }
  const trip = { id: 't', kind: 'trip' as const, pubkey: 'a'.repeat(40), beats: [], start: 1, end: 2, offsets: [], length: 5 }

  it('keeps its width as the zoom gains a digit, so the name beside it is not cut again mid-zoom (review of #470)', () => {
    const drawn = (scaleExp: number) => {
      const texts: Array<{ text: string; x: number }> = []
      const p = new TvPainter(recordingCanvas(texts))
      p.size(1200, 700, 1)
      p.paint(picture({ shot: trip as never, scaleExp }), assets, 1000, 1, false)
      return { two: texts.find((t) => t.text === '2')!.x, name: texts.find((t) => t.text.startsWith('AAAA'))!.text }
    }
    const nine = drawn(9)
    for (const z of [0, 10, 84]) expect(drawn(z)).toEqual(nine)
  })
})
