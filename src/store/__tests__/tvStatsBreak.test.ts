/**
 * tvStatsBreak.test.ts: the CYBERSPACE STATS break in TV's engine
 * (store/useTv, lib/tv/cyberspaceStats). It comes due on its own clock, ten
 * minutes on the site and fifteen on the stream, and never collides with a
 * spot or an explainer: it waits for them, keeps STATS_GAP_MS either side,
 * and they never wait on it. Nothing of the tape plays under it, and nothing
 * is published or fetched from outside.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const published: unknown[] = []
vi.mock('../../lib/relay', () => ({
  publish: vi.fn(async (ev: unknown) => { published.push(ev); return { ok: true } }),
  publishMany: vi.fn(async (_r: string[], ev: unknown) => { published.push(ev); return { ok: true } }),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  askEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
  subscribe: vi.fn(() => () => {}),
}))

import type { Filter } from 'nostr-tools'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { positionHex, type NostrEvent } from '../../lib/events'
import { V2_EPOCH } from '../../lib/tv/tape'
import { setStatsSnapshotForTest, setTvAsk, statsClockForTest, useTv } from '../useTv'
import { setExplainerLineupForTest, useTvExplainer } from '../useTvExplainer'
import { setBroadcastForTest } from '../../lib/tv/broadcast'
import { BROADCAST_STATS_FIRST_MS, STATS_FIRST_MS, STATS_GAP_MS, STATS_HOUR_S, STATS_TAG } from '../../lib/tv/cyberspaceStats'

const A = '1'.repeat(64)
const B = '2'.repeat(64)
let n = 0
const id = (): string => (n++).toString(16).padStart(64, 'f')
const at = (x: bigint) => positionHex({ x, y: 5n, z: 7n }, 0)
const T0 = V2_EPOCH + 1000
const spawnOf = (pubkey: string, t: number): NostrEvent => ({ id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'spawn'], ['C', pubkey]], content: '', sig: '' })
const hop = (pubkey: string, t: number, from: bigint, to: bigint): NostrEvent => ({ id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'hop'], ['e', '0'.repeat(64), '', 'genesis'], ['e', '0'.repeat(64), '', 'previous'], ['c', at(from)], ['C', at(to)], ['proof', 'a'.repeat(64)]], content: '', sig: '' })
// A long tape, so the set plays for the whole half hour.
const tape: NostrEvent[] = [spawnOf(A, T0), ...Array.from({ length: 4000 }, (_, i) => hop(B, T0 + 100 + i * 2, 1000n + BigInt(i), 1001n + BigInt(i)))]

const asked: Filter[] = []
async function ask(f: Filter): Promise<RelayAnswer[]> {
  asked.push(f)
  return [{ url: 'wss://relay.test', outcome: 'answered', events: tape
    .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until) && (!f.authors || f.authors.includes(e.pubkey)))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, f.limit ?? Infinity) }]
}

/** The explainer's video and its bytes, at the clock's pace (as store/__tests__/tv.test.ts stubs them); any other fetch fails: no network. */
async function stubExplainerMedia(): Promise<string> {
  class ClockVideo extends EventTarget {
    playsInline = false; preload = ''; muted = false; volume = 1; ended = false; error = null; readyState = 0
    videoWidth = 1280; videoHeight = 720; paused = true
    private t = 0; private from = 0; private source = ''
    canPlayType(): string { return 'probably' }
    get src(): string { return this.source }
    set src(v: string) { this.source = v; queueMicrotask(() => { this.readyState = 4; this.dispatchEvent(new Event('canplay')) }) }
    get currentTime(): number { return this.paused ? this.t : this.t + (performance.now() - this.from) / 1000 }
    set currentTime(v: number) { this.t = v; this.from = performance.now() }
    removeAttribute(): void { this.source = '' }
    load(): void {}
    pause(): void { this.t = this.currentTime; this.paused = true }
    play(): Promise<void> { this.from = performance.now(); this.paused = false; return Promise.resolve() }
  }
  const body = new TextEncoder().encode('clip')
  const { sha256 } = await import('@noble/hashes/sha2.js')
  const { bytesToHex } = await import('../../lib/events')
  const hash = bytesToHex(sha256(body))
  vi.stubGlobal('document', { createElement: () => new ClockVideo(), addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' })
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes(hash)) return new Response(body as BodyInit)
    throw new Error(`no network in tests: ${String(url)}`)
  })
  const real = globalThis.crypto
  vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T): T => real.getRandomValues(a as never) })
  return hash
}

async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) await vi.advanceTimersByTimeAsync(100)
}

interface Span { kind: 'ad' | 'stats' | 'explainer'; from: number; to: number; label?: string }

/** Every break and explainer while TV runs `ms`, from its start. */
async function watch(ms: number): Promise<{ spans: Span[]; t0: number; tapeUnderStats: boolean; boards: string[] }> {
  const spans: Span[] = []
  const open: Partial<Record<Span['kind'], Span>> = {}
  const t0 = performance.now()
  let tapeUnderStats = false
  const boards: string[] = []
  const mark = (kind: Span['kind'], on: boolean, label?: string): void => {
    if (on && !open[kind]) { open[kind] = { kind, from: performance.now() - t0, to: Infinity, label }; spans.push(open[kind]!) }
    if (!on && open[kind]) { open[kind]!.to = performance.now() - t0; delete open[kind] }
  }
  const off = useTv.subscribe((s, prev) => {
    mark('ad', s.ad !== null)
    mark('stats', s.stats !== null, s.stats?.board.id)
    if (s.stats && !prev.stats) boards.push(s.stats.board.id)
    if (s.stats && prev.stats && s.played !== prev.played) tapeUnderStats = true
  })
  const offEx = useTvExplainer.subscribe((e) => mark('explainer', e.showing !== null))
  useTv.getState().start()
  await run(ms)
  off()
  offEx()
  return { spans, t0, tapeUnderStats, boards }
}

/** No two spans overlap, and a stats break keeps `gap` from every other span, either side. */
function expectClear(spans: Span[], gap: number): void {
  const stats = spans.filter((s) => s.kind === 'stats')
  for (const b of stats) {
    for (const o of spans) {
      if (o === b) continue
      const apart = o.from >= b.to ? o.from - b.to : b.from >= o.to ? b.from - o.to : -1
      expect(apart, `${b.label} at ${Math.round(b.from / 1000)}s against ${o.kind} at ${Math.round(o.from / 1000)}s`).toBeGreaterThanOrEqual(o.kind === 'stats' ? 0 : gap - 100)
    }
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
  let calls = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (calls++ % 2 === 0 ? 0 : 0.999))
  asked.length = 0
  published.length = 0
  setStatsSnapshotForTest(null)
  setTvAsk(ask)
  const hash = await stubExplainerMedia()
  setExplainerLineupForTest([{ id: '1-test', title: 'TEST', duration: 45, files: [{ url: `https://b.example/${hash}.webm`, type: 'video/webm' }] }])
})

afterEach(() => {
  useTv.getState().stop()
  setExplainerLineupForTest(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setBroadcastForTest(null)
})

describe('the CYBERSPACE STATS break in TV\'s engine', () => {
  it('on the site: first after STATS_FIRST_MS, then in turn, clear of every spot and explainer, the tape still under it', async () => {
    const { spans, tapeUnderStats, boards } = await watch(32 * 60_000)
    const stats = spans.filter((s) => s.kind === 'stats')
    expect(stats.length).toBeGreaterThanOrEqual(2)
    expect(stats[0].from).toBeGreaterThanOrEqual(STATS_FIRST_MS)
    expect(spans.filter((s) => s.kind === 'ad').length).toBeGreaterThanOrEqual(4)
    expect(spans.filter((s) => s.kind === 'explainer').length).toBeGreaterThanOrEqual(1)
    expectClear(spans, STATS_GAP_MS)
    // The boards in turn: never the same one twice running.
    for (let i = 1; i < boards.length; i++) expect(boards[i]).not.toBe(boards[i - 1])
    expect(tapeUnderStats).toBe(false)
    // It ends, and the tape picks up.
    expect(useTv.getState().stats === null || stats[stats.length - 1].to === Infinity).toBe(true)
   }, 60_000)

  it('on the stream: first at BROADCAST_STATS_FIRST_MS, between the spots, clear of them', async () => {
    setBroadcastForTest(true)
    const { spans } = await watch(40 * 60_000)
    const stats = spans.filter((s) => s.kind === 'stats')
    expect(stats.length).toBeGreaterThanOrEqual(2)
    expect(stats[0].from).toBeGreaterThanOrEqual(BROADCAST_STATS_FIRST_MS)
    expectClear(spans, STATS_GAP_MS)
   }, 60_000)

  it('counts from one read of the movement events and the scoped deletions, stamped on the hour; publishes nothing', async () => {
    let board: { asOf: number; title: string } | null = null
    const off = useTv.subscribe((s) => { if (s.stats && !board) board = s.stats.board })
    useTv.getState().start()
    await run(STATS_FIRST_MS + 60_000)
    off()
    expect(board).not.toBeNull()
    expect(board!.asOf % STATS_HOUR_S).toBe(0)
    expect(board!.title).not.toContain(STATS_TAG)
    expect(asked.some((f) => f.kinds?.length === 1 && f.kinds[0] === 3333 && !f.authors && !f['#A' as keyof Filter] && f.since === undefined)).toBe(true)
    expect(asked.some((f) => f.kinds?.[0] === 5 && (f as Record<string, unknown>)['#k'] !== undefined)).toBe(true)
    expect(asked.some((f) => f.kinds?.[0] === 5 && (f as Record<string, unknown>)['#k'] === undefined)).toBe(false)
    expect(published.filter((e) => (e as { kind?: number }).kind !== 23334)).toEqual([])
    expect(statsClockForTest().due).toBeGreaterThan(0)
  })

  it('a board the address names plays first, at the first cut after its counts are in (/tv?stats=<id>)', async () => {
    vi.stubGlobal('window', { location: { pathname: '/tv', search: '?stats=new-arrivals' }, setTimeout, clearTimeout, addEventListener: () => {}, removeEventListener: () => {} })
    const ids: string[] = []
    const off = useTv.subscribe((s, prev) => { if (s.stats && !prev.stats) ids.push(s.stats.board.id) })
    useTv.getState().start()
    // Between shots, as every break is: once the shot on screen when its counts came in is over.
    await run(120_000)
    off()
    expect(ids[0]).toBe('new-arrivals')
  })
})
