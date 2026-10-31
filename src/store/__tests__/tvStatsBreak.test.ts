/**
 * tvStatsBreak.test.ts: the CYBERSPACE STATS break in TV's engine
 * (store/useTv, lib/tv/cyberspaceStats). On the stream it comes due on its
 * own clock, every fifteen minutes, and never collides with a spot or an
 * explainer: it waits for them, keeps STATS_GAP_MS either side, and they
 * never wait on it. Nothing of the tape plays under it, and nothing is
 * published or fetched from outside. On the site (STATS_ON_SITE OFF since
 * 2026-10-31) there is no break at all and no read to count one.
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
import { resetStatsReadsForTest, setStatsSnapshotForTest, setTvAsk, statsClockForTest, statsReadsForTest, useTv } from '../useTv'
import { useProfiles } from '../useProfiles'
import { asOfHour } from '../../lib/tv/cyberspaceStats'
import { setExplainerLineupForTest, useTvExplainer } from '../useTvExplainer'
import { setBroadcastForTest } from '../../lib/tv/broadcast'
import { BROADCAST_STATS_FIRST_MS, PROFILE_HOLD_MS, STATS_FIRST_MS, STATS_GAP_MS, STATS_HOUR_S, STATS_LOAD_DELAY_MS, STATS_ON_SITE, STATS_TAG } from '../../lib/tv/cyberspaceStats'

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
  resetStatsReadsForTest()
  // The census is kept across runs of TV, as the counts are: each test starts with none.
  useTv.setState({ census: null })
  useProfiles.setState({ profiles: {} })
  setTvAsk(ask)
  // The boards play only on the stream (STATS_ON_SITE OFF): every test is the stream unless it says the site.
  setBroadcastForTest(true)
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
  it('on the site, with STATS_ON_SITE off: never a break, and never a read to count one', async () => {
    expect(STATS_ON_SITE).toBe(false)
    setBroadcastForTest(false)
    const { spans } = await watch(STATS_FIRST_MS + 12 * 60_000)
    expect(spans.filter((s) => s.kind === 'stats')).toEqual([])
    // The spots still play: only the boards are gone.
    expect(spans.filter((s) => s.kind === 'ad').length).toBeGreaterThanOrEqual(1)
    expect(statsClockForTest().due).toBe(Infinity)
    // No whole read of the movement events from V2_EPOCH (the counting read): the tape's own reads always carry an until.
    expect(asked.some((f) => f.kinds?.[0] === 3333 && !f.authors && f.since === V2_EPOCH && f.until === undefined && !f['#A' as keyof Filter])).toBe(false)
    expect(statsReadsForTest().actions).toBe(0)
    // The census TV reads when it comes on (its marquee), once: never again for the hour's counts.
    expect(asked.filter((f) => f.kinds?.[0] === 33330).length).toBeLessThanOrEqual(1)
  }, 60_000)

  it('on the site, a board the address names is not played either (/tv?stats=<id>)', async () => {
    setBroadcastForTest(false)
    vi.stubGlobal('window', { location: { pathname: '/tv', search: '?stats=new-arrivals' }, setTimeout, clearTimeout, addEventListener: () => {}, removeEventListener: () => {} })
    const { spans } = await watch(STATS_LOAD_DELAY_MS + 60_000)
    expect(spans.filter((s) => s.kind === 'stats')).toEqual([])
    expect(statsReadsForTest().actions).toBe(0)
  }, 60_000)

  it('on the stream: first after BROADCAST_STATS_FIRST_MS, then in turn, clear of every spot and explainer, the tape still under it', async () => {
    const { spans, tapeUnderStats, boards } = await watch(40 * 60_000)
    const stats = spans.filter((s) => s.kind === 'stats')
    expect(stats.length).toBeGreaterThanOrEqual(2)
    expect(stats[0].from).toBeGreaterThanOrEqual(BROADCAST_STATS_FIRST_MS)
    expect(spans.filter((s) => s.kind === 'ad').length).toBeGreaterThanOrEqual(2)
    expect(spans.filter((s) => s.kind === 'explainer').length).toBeGreaterThanOrEqual(1)
    expectClear(spans, STATS_GAP_MS)
    // The boards in turn: never the same one twice running.
    for (let i = 1; i < boards.length; i++) expect(boards[i]).not.toBe(boards[i - 1])
    expect(tapeUnderStats).toBe(false)
    // It ends, and the tape picks up.
    expect(useTv.getState().stats === null || stats[stats.length - 1].to === Infinity).toBe(true)
   }, 60_000)

  it('counts from one read of the movement events and the scoped deletions, stamped on the hour; publishes nothing', async () => {
    let board: { asOf: number; title: string } | null = null
    const off = useTv.subscribe((s) => { if (s.stats && !board) board = s.stats.board })
    useTv.getState().start()
    await run(BROADCAST_STATS_FIRST_MS + 60_000)
    off()
    expect(board).not.toBeNull()
    expect(board!.asOf % STATS_HOUR_S).toBe(0)
    expect(board!.title).not.toContain(STATS_TAG)
    // From V2_EPOCH (never v1 history), not by A.
    expect(asked.some((f) => f.kinds?.length === 1 && f.kinds[0] === 3333 && !f.authors && !f['#A' as keyof Filter] && f.since === V2_EPOCH)).toBe(true)
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

  it('TV off and on again in the same hour reads and counts nothing again; the census TV came on with is the one counted', async () => {
    // The stream's watchdog reloads the page when no frame is drawn (none are, here): a reload that goes nowhere.
    vi.stubGlobal('window', { location: { pathname: '/tv', search: '?broadcast=1', replace: () => {} }, setTimeout, clearTimeout, addEventListener: () => {}, removeEventListener: () => {} })
    useTv.getState().start()
    await run(BROADCAST_STATS_FIRST_MS + 30_000)
    // A whole read's first page: from V2_EPOCH with no until (the tape's random start always has one).
    const whole = asked.filter((f) => f.kinds?.[0] === 3333 && !f.authors && f.since === V2_EPOCH && f.until === undefined && !f['#A' as keyof Filter]).length
    const censusBags = asked.filter((f) => f.kinds?.[0] === 33330).length
    expect(whole).toBeGreaterThan(0)
    // Every distinct event of the tape (its ids repeat where the padding meets: f, ff, fff...).
    expect(statsReadsForTest().actions).toBe(new Set(tape.map((e) => e.id)).size)
    // Only the census TV read when it came on: counting did not read it again.
    expect(censusBags).toBe(1)
    useTv.getState().stop()
    useTv.getState().start()
    await run(BROADCAST_STATS_FIRST_MS + 30_000)
    expect(asked.filter((f) => f.kinds?.[0] === 3333 && !f.authors && f.since === V2_EPOCH && f.until === undefined && !f['#A' as keyof Filter]).length).toBe(whole)
    expect(asked.filter((f) => f.kinds?.[0] === 33330).length).toBe(censusBags)
  }, 60_000)
})

describe('who is an agent: a break holds for the profiles (review of #537)', () => {
  const AGENT = 'a'.repeat(64)
  const people = ['b', 'c', 'd'].map((c) => c.repeat(64))
  /** Counts as of this hour: the agent the longest chain, three people after it, all four active. */
  function counts() {
    const asOf = asOfHour(Date.now() / 1000)
    const chain = new Map([[AGENT, 500], [people[0], 130], [people[1], 77], [people[2], 44]])
    return { asOf, chain, respawns: new Map(), bags: new Map(), objects: new Map(), arrivals: new Map(), active: [AGENT, ...people], activeBefore: [] }
  }
  // Asked for by name, on an empty tape: no shot to wait out, so a board is due 4 s in, and only the hold keeps it off.
  const forced = (): void => {
    vi.stubGlobal('window', { location: { pathname: '/tv', search: '?stats=longest-chain' }, setTimeout, clearTimeout, addEventListener: () => {}, removeEventListener: () => {} })
    setTvAsk(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: [] }])
  }

  it('waits for the answers, then leaves the agent off the humans\' board', async () => {
    forced()
    const shown: Array<{ at: number; board: unknown }> = []
    const off = useTv.subscribe((s, prev) => { if (s.stats && !prev.stats) shown.push({ at: performance.now(), board: s.stats.board }) })
    const t0 = performance.now()
    useTv.getState().start()
    setStatsSnapshotForTest(counts())
    // The answers come late, inside the hold.
    const answerAt = PROFILE_HOLD_MS - 1_000
    await run(answerAt)
    // Not yet: no answer about anyone's kind 0.
    expect(shown).toHaveLength(0)
    useProfiles.setState({ profiles: { [AGENT]: { name: 'XOR', bot: true, operator: people[0] } as never, [people[0]]: null, [people[1]]: null, [people[2]]: null } })
    await run(60_000)
    off()
    expect(shown.length).toBeGreaterThan(0)
    expect(shown[0].at - t0).toBeGreaterThanOrEqual(answerAt)
    const b = shown[0].board as { id: string; rows: Array<{ pubkey: string }> }
    expect(b.id).toBe('longest-chain')
    expect(b.rows.map((r) => r.pubkey)).toEqual(people)
  }, 60_000)

  it('with no answer by PROFILE_HOLD_MS, a key not known is shown nowhere: not ranked, not counted a human', async () => {
    forced()
    const shown: Array<{ at: number; board: { id: string; kind: string; rows?: unknown[]; humans?: { now: number }; agents?: { now: number } } }> = []
    const off = useTv.subscribe((s, prev) => { if (s.stats && !prev.stats) shown.push({ at: performance.now(), board: s.stats.board as never }) })
    const t0 = performance.now()
    useTv.getState().start()
    setStatsSnapshotForTest(counts())
    // Everyone but the agent answered.
    useProfiles.setState({ profiles: { [people[0]]: null, [people[1]]: null, [people[2]]: null } })
    await run(PROFILE_HOLD_MS + 60_000)
    off()
    expect(shown.length).toBeGreaterThan(0)
    expect(shown[0].at - t0).toBeGreaterThanOrEqual(PROFILE_HOLD_MS - 200)
    for (const { board } of shown) {
      if (board.kind === 'ranking') expect(JSON.stringify(board.rows)).not.toContain(AGENT)
      if (board.kind === 'split') expect([board.humans!.now, board.agents!.now]).toEqual([3, 0])
    }
  }, 90_000)
})
