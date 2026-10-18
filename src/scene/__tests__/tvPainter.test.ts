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
import { cutKind } from '../TvScreenEffect'
import { useTv } from '../../store/useTv'

/** A 2D context that measures every character as 7 px and draws nothing. */
function fakeCanvas(): HTMLCanvasElement {
  const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }) } as Record<string, unknown>, {
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
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), lineTo: () => { n++ } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, lines: () => n }
  }
  /** The bag's panel painted at `t` seconds into it (its shot over, so the clock reads its length). */
  function drawnAt(t: number): number {
    vi.spyOn(performance, 'now').mockReturnValue(1e12)
    const bag = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: 'p', at: 1, hint: null, height: 3 }
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
