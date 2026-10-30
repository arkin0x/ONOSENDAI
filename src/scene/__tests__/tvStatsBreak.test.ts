/**
 * tvStatsBreak.test.ts: the CYBERSPACE STATS break on the tube
 * (scene/tvStatsBreak, scene/tvPainter statsBreak): every board, at every
 * beat, in the 16:9 stream at its large text, the upright stream
 * (layout=portrait, 720 x 1280) and the site on a phone; every word in the
 * frame and above the marquee, the rows apart, names cut before numbers
 * ever are, HUMANS and AGENTS side by side or stacked, his Fun Fact whole
 * and no smaller than the marquee's words, CYBERSPACE STATS in the corner.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ query: async () => [], queryEach: async () => [], queryAny: async () => [], publish: async () => ({ ok: true }), publishMany: async () => ({ ok: true }), relaySet: () => [] }))
import { TvPainter, type TvAssets, type TvPicture } from '../tvPainter'
import { CUT_MS } from '../../hud/TvSegments'
import { setBroadcastForTest, type BroadcastLayout } from '../../lib/tv/broadcast'
import { AGENTS_FUN_FACT, BEATS, BOARD_WORDS, STATS_TAG, asOfWords, statNumber, type StatsBoard } from '../../lib/tv/cyberspaceStats'

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

const inside = (a: Box, b: Box): boolean => a.x0 >= b.x0 - 0.5 && a.x1 <= b.x1 + 0.5 && a.y0 >= b.y0 - 0.5 && a.y1 <= b.y1 + 0.5

const assets: TvAssets = {
  name: (pk) => (pk.startsWith('e') ? 'ARKINOX' : pk.startsWith('f') ? 'A PLAYER WHOSE PROFILE NAME RUNS LONGER THAN ANY ROW HOLDS' : `NPUB1${pk.slice(0, 7)}\u2026`),
  picture: () => null, logo: null, spin: null, segmentShard: null, color: () => '#fff', music: null, watching: 12,
}
const picture = (stats: TvPicture['stats']): TvPicture => ({ status: 'playing', shot: null, played: 0, tapeTime: 1_760_000_000, scaleExp: 40, cutAt: 0, skipped: 0, meanwhile: false, census: null, chains: {}, arrivals: [{ pubkey: 'a'.repeat(64), at: 1 }], reactions: [], avatars: {}, stats })

const AS_OF = Date.UTC(2026, 9, 30, 2) / 1000
const ranking: StatsBoard = {
  id: 'longest-chain', ...BOARD_WORDS['longest-chain'], asOf: AS_OF, kind: 'ranking',
  rows: [['e', 1308], ['0', 130], ['f', 77], ['a', 44], ['2', 39]].map(([c, v], i) => ({ rank: i + 1, pubkey: String(c).repeat(64), value: Number(v) })),
}
const count: StatsBoard = { id: 'new-arrivals', ...BOARD_WORDS['new-arrivals'], asOf: AS_OF, kind: 'count', count: { now: 14, before: 9 } }
const split: StatsBoard = { id: 'active-users', ...BOARD_WORDS['active-users'], asOf: AS_OF, kind: 'split', humans: { now: 12, before: 19 }, agents: { now: 1, before: 1 }, note: AGENTS_FUN_FACT }

/** Paint `board` at `t` seconds into its break, twice as the set paints on. */
function paintBoard(board: StatsBoard, t: number, w: number, h: number) {
  const now = 1e12
  vi.spyOn(performance, 'now').mockReturnValue(now)
  const rec = recording()
  const painter = new TvPainter(rec.canvas)
  painter.size(w, h, 1)
  const p = picture({ at: now - CUT_MS - t * 1000, board })
  painter.paint(p, assets, now - 33, 1, false)
  rec.texts.length = 0
  rec.rects.length = 0
  painter.paint(p, assets, now, 1, false)
  vi.restoreAllMocks()
  return { ...rec, marqueeTop: painter.marqueeTop! * 1 }
}

/** The stream at its large text, 16:9 and upright, and the site on a phone. */
const FRAMES: Array<{ name: string; w: number; h: number; broadcast: boolean; layout: BroadcastLayout; stacked: boolean }> = [
  { name: '1920x1080', w: 1920, h: 1080, broadcast: true, layout: 'landscape', stacked: false },
  { name: '1280x720', w: 1280, h: 720, broadcast: true, layout: 'landscape', stacked: false },
  { name: '720x1280 portrait', w: 720, h: 1280, broadcast: true, layout: 'portrait', stacked: true },
  { name: 'site 390x844', w: 390, h: 844, broadcast: false, layout: 'landscape', stacked: true },
  { name: 'site 1440x900', w: 1440, h: 900, broadcast: false, layout: 'landscape', stacked: false },
]
const BEAT_TIMES = (b: StatsBoard): number[] => [0.6, (BEATS[b.kind].rows + BEATS[b.kind].top) / 2 + 1, BEATS[b.kind].stamp - 0.5, BEATS[b.kind].stamp + 1.5]

afterEach(() => setBroadcastForTest(null))

describe('the CYBERSPACE STATS break on the tube', () => {
  for (const f of FRAMES) {
    const set = (): void => setBroadcastForTest(f.broadcast, 'large', f.layout)
    const frame = { x0: 0, y0: 0, x1: f.w, y1: f.h }

    it(`${f.name}: every word of every board, at every beat, is in the frame, above the marquee, with CYBERSPACE STATS in the corner`, () => {
      set()
      for (const board of [ranking, count, split]) {
        for (const t of BEAT_TIMES(board)) {
          const { texts, marqueeTop } = paintBoard(board, t, f.w, f.h)
          expect(texts.some((x) => x.text === STATS_TAG), `${board.id} ${t}`).toBe(true)
          for (const x of texts) {
            // The marquee's run scrolls in from past the right edge and off past the left, as it always does.
            if (x.y >= marqueeTop) continue
            expect(inside(x.box, frame), `${board.id} ${t} "${x.text}"`).toBe(true)
            expect(x.text).not.toContain('\u2014')
            expect(x.text).not.toMatch(/HOUSE/)
          }
          // The board's own words keep above the marquee's band.
          for (const x of texts.filter((x) => x.size > 0 && x.box.y1 < f.h - 2 && x.y < marqueeTop - 1)) expect(x.box.y1, `${board.id} ${t} "${x.text}"`).toBeLessThanOrEqual(marqueeTop + 0.5)
        }
      }
    })

    it(`${f.name}: the title card, then the rows, then the stamp AS OF the hour`, () => {
      set()
      expect(paintBoard(ranking, 0.6, f.w, f.h).texts.map((x) => x.text).join(' ')).toContain('LONGEST')
      expect(paintBoard(ranking, BEATS.ranking.stamp + 1.5, f.w, f.h).texts.map((x) => x.text).join(' ')).toContain(asOfWords(AS_OF))
    })

    it(`${f.name}: a ranking's rows apart, each number whole, a long name cut before it`, () => {
      set()
      const { texts } = paintBoard(ranking, BEATS.ranking.stamp - 0.5, f.w, f.h)
      const ranks = [1, 2, 3, 4, 5].map((r) => texts.find((x) => x.text === String(r) && x.align === 'left')!)
      for (const r of ranks) expect(r).toBeDefined()
      for (let i = 1; i < ranks.length; i++) expect(ranks[i].box.y0, `row ${i + 1}`).toBeGreaterThanOrEqual(ranks[i - 1].box.y1 - 0.5)
      for (const row of ranking.rows) {
        const n = texts.find((x) => x.text === statNumber(row.value) && x.align === 'right')
        expect(n, `${row.value}`).toBeDefined()
        const name = texts.find((x) => x.align === 'left' && Math.abs(x.y - n!.y) < 1 && x.text !== String(row.rank))!
        expect(name.box.x1, `${row.value}`).toBeLessThanOrEqual(n!.box.x0)
      }
      expect(texts.some((x) => x.text.startsWith('A PLAYER') && x.text.endsWith('\u2026'))).toBe(true)
      expect(texts.some((x) => x.text === 'ARKINOX')).toBe(true)
      if (f.stacked) {
        // The #1 over the rest, the avatar's stage over the #1.
        const cube = texts.find((x) => x.text === '#1')!
        expect(cube.box.y1).toBeLessThan(ranks[0].box.y1)
      } else {
        // Rows on the right, the title and the avatar in the left third.
        expect(ranks[0].box.x0).toBeGreaterThan(f.w * 0.3)
      }
    })

    it(`${f.name}: ACTIVE USERS shows HUMANS and AGENTS, ${f.stacked ? 'one over the other' : 'side by side'}, each with last week, and his Fun Fact whole`, () => {
      set()
      const { texts } = paintBoard(split, BEATS.split.stamp - 0.5, f.w, f.h)
      const humans = texts.find((x) => x.text === 'HUMANS')!
      const agents = texts.find((x) => x.text === 'AGENTS')!
      expect(humans).toBeDefined()
      expect(agents).toBeDefined()
      expect(humans.size).toBeCloseTo(agents.size, 6)
      if (f.stacked) expect(agents.box.y0).toBeGreaterThan(humans.box.y1)
      else { expect(agents.box.x0).toBeGreaterThan(humans.box.x1); expect(agents.y).toBeCloseTo(humans.y, 6) }
      for (const v of ['12', '1', 'LAST WEEK 19', 'LAST WEEK 1']) expect(texts.some((x) => x.text === v), v).toBe(true)
      const big = texts.find((x) => x.text === '12')!
      const one = texts.find((x) => x.text === '1' && x.size === big.size)
      expect(one, 'the AGENTS number as large as the HUMANS one').toBeDefined()
      const lines = texts.filter((x) => AGENTS_FUN_FACT.includes(x.text) && x.text.length > 3 && x.text !== 'AGENTS')
      expect(lines.map((x) => x.text).join(' ')).toBe(AGENTS_FUN_FACT)
      // No smaller than the marquee's own words, the stream's smallest run of type.
      const run = texts.filter((x) => x.box.y0 > f.h * 0.8 && x.text.startsWith('NEW ARRIVAL'))
      expect(run.length).toBeGreaterThan(0)
      for (const l of lines) {
        expect(inside(l.box, frame), l.text).toBe(true)
        expect(l.size, l.text).toBeGreaterThanOrEqual(run[0].size)
      }
    })

    it(`${f.name}: NEW ARRIVALS, one number and last week's`, () => {
      set()
      const { texts } = paintBoard(count, BEATS.count.stamp - 0.5, f.w, f.h)
      expect(texts.some((x) => x.text === '14')).toBe(true)
      expect(texts.some((x) => x.text === 'LAST WEEK 9')).toBe(true)
    })
  }

  it('the upright layout is the upright stream\'s: the same frame on the 16:9 flag lays out side by side only when it is wide', () => {
    setBroadcastForTest(true, 'large', 'portrait')
    const up = paintBoard(ranking, BEATS.ranking.stamp - 0.5, 1920, 1080).texts.find((x) => x.text === '1' && x.align === 'left')!
    setBroadcastForTest(true, 'large', 'landscape')
    const wide = paintBoard(ranking, BEATS.ranking.stamp - 0.5, 1920, 1080).texts.find((x) => x.text === '1' && x.align === 'left')!
    // The portrait flag stacks whatever the frame; a wide 16:9 frame puts the rows on the right.
    expect(up.box.x0).toBeLessThan(wide.box.x0)
  })
})
