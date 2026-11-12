/**
 * tvAnnounce.test.ts: an UPGRADE ANNOUNCEMENT stops TV where it is (a shot,
 * a spot, an explainer), plays, and TV picks up from exactly there; the
 * music ducks under it as under an explainer; a second waits for the first;
 * and the hook for after it hears of each once TV is back (arkinox, 2026-11-11).
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

vi.mock('../../lib/relay', () => ({
  publish: vi.fn(async () => ({ ok: true })),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
  subscribe: vi.fn(() => () => {}),
}))

/** Every word to the music's explainer duck, passed on to the real one. */
const ducks: boolean[] = []
vi.mock('../useTvMusic', async (importOriginal) => {
  const real = await importOriginal<typeof import('../useTvMusic')>()
  return { ...real, duckMusicForExplainer: (on: boolean) => { ducks.push(on); real.duckMusicForExplainer(on) } }
})

import type { Filter } from 'nostr-tools'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { positionHex, type NostrEvent } from '../../lib/events'
import { V2_EPOCH } from '../../lib/tv/tape'
import { setTvAsk, shotElapsed, tvDwellRun, useTv } from '../useTv'
import { afterUpgradeAnnouncement, announceBusy, announceCutAt, announceWaitingForTest, playUpgradeAnnouncement, startAnnouncements, useTvAnnounce } from '../useTvAnnounce'
import { explainerHeldForTest, explainerVideo, setExplainerLineupForTest, useTvExplainer } from '../useTvExplainer'
import { ANNOUNCE_IN_MS, ANNOUNCE_TEST_MS, SAMPLE_ANNOUNCEMENT, SAMPLE_UPDATES, announceMs, announcePlan, screenStarts } from '../../lib/tv/upgradeAnnounce'
import { AD_IN_MS, HOSAKA_1, adLength } from '../../lib/tv/hosakaAd'
import { EXPLAINER_FORCED_MS, EXPLAINER_IN_MS } from '../../lib/tv/explainer'

const A = '1'.repeat(64)
const B = '2'.repeat(64)
let n = 0
const id = (): string => (n++).toString(16).padStart(64, 'f')
const at = (x: bigint) => positionHex({ x, y: 5n, z: 7n }, 0)
function spawnOf(pubkey: string, t: number): NostrEvent {
  return { id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'spawn'], ['C', pubkey]], content: '', sig: '' }
}
function hop(pubkey: string, t: number, from: bigint, to: bigint): NostrEvent {
  return { id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'hop'], ['e', '0'.repeat(64), '', 'genesis'], ['e', '0'.repeat(64), '', 'previous'], ['c', at(from)], ['C', at(to)], ['proof', 'a'.repeat(64)]], content: '', sig: '' }
}
const T0 = V2_EPOCH + 1000
// A trip of four hops two seconds apart on tape: a shot several seconds long.
const tape: NostrEvent[] = [spawnOf(A, T0), hop(B, T0 + 100, 1000n, 1001n), hop(B, T0 + 102, 1001n, 1002n), hop(B, T0 + 104, 1002n, 1003n), hop(B, T0 + 106, 1003n, 1004n)]
async function ask(f: Filter): Promise<RelayAnswer[]> {
  return [{ url: 'wss://relay.test', outcome: 'answered', events: tape
    .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until) && (!f.authors || f.authors.includes(e.pubkey)))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, f.limit ?? Infinity) }]
}

async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) await vi.advanceTimersByTimeAsync(100)
}

const NOTE = { version: '2.1', text: 'A short note.' }
const noteMs = announceMs(announcePlan(NOTE)!)

beforeEach(() => {
  ducks.length = 0
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
  let calls = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (calls++ % 2 === 0 ? 0 : 0.999))
  setTvAsk(ask)
})

afterEach(() => {
  useTv.getState().stop()
  useTvAnnounce.setState({ updatesThisWeek: null })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('UPGRADE ANNOUNCEMENT', () => {
  it('does not play with TV off, nor without a version', () => {
    expect(playUpgradeAnnouncement(NOTE)).toBe(false)
    useTv.getState().start()
    expect(playUpgradeAnnouncement({ version: '', text: 'words' })).toBe(false)
    expect(announceBusy()).toBe(false)
  })

  it('stops the shot on screen where it is, and plays it on from there after', async () => {
    useTv.getState().start()
    await run(2500)
    const s = useTv.getState()
    expect(s.shot?.pubkey).toBe(B)
    const shot = s.shot
    const played = s.played
    const elapsed = shotElapsed()
    const cutAt = s.cutAt
    const dwellSince = tvDwellRun().since
    let movedUnder = false
    const off = useTv.subscribe((st, prev) => { if (announceBusy() && (st.played !== prev.played || st.shot !== prev.shot || st.avatars !== prev.avatars)) movedUnder = true })
    const t0 = performance.now()
    expect(playUpgradeAnnouncement(NOTE)).toBe(true)
    await run(noteMs - 200)
    expect(announceBusy()).toBe(true)
    expect(useTv.getState().played).toBe(played)
    await run(400)
    off()
    expect(announceBusy()).toBe(false)
    expect(movedUnder).toBe(false)
    const held = performance.now() - t0
    // The same shot, as far on as it was (a tick at most either side), and its cut and screen time moved on with it.
    expect(useTv.getState().shot).toBe(shot)
    expect(Math.abs(shotElapsed() - elapsed - (held - noteMs) / 1000)).toBeLessThan(0.35)
    expect(useTv.getState().cutAt - cutAt).toBeGreaterThanOrEqual(noteMs - 100)
    expect(tvDwellRun().since - dwellSince).toBeGreaterThanOrEqual(noteMs - 100)
    // And it plays on to its end: the whole trip.
    await run(12_000)
    expect(useTv.getState().avatars[B]?.position.x).toBe(1004n)
  })

  it('stops a spot on its scene, and the spot runs its remaining time after', async () => {
    useTv.getState().start()
    await run(2000)
    useTv.setState({ ad: { at: performance.now(), id: HOSAKA_1.id }, shot: null, cutAt: performance.now() })
    await run(3000)
    const adAt = useTv.getState().ad!.at
    const t0 = performance.now()
    playUpgradeAnnouncement(NOTE)
    await run(noteMs + 200)
    const held = performance.now() - t0
    const ad = useTv.getState().ad
    expect(ad).not.toBeNull()
    expect(ad!.at - adAt).toBeGreaterThanOrEqual(noteMs)
    expect(ad!.at - adAt).toBeLessThanOrEqual(held)
    // What was left of it, about 3 s into its own clock, and then it ends.
    const left = AD_IN_MS + adLength(HOSAKA_1) * 1000 - 3000 - (held - (ad!.at - adAt))
    await run(left - 600)
    expect(useTv.getState().ad).not.toBeNull()
    await run(1000)
    expect(useTv.getState().ad).toBeNull()
  })

  it('ducks the music as an explainer does, and puts it back after', async () => {
    useTv.getState().start()
    await run(1500)
    playUpgradeAnnouncement(NOTE)
    expect(ducks).toEqual([true])
    await run(noteMs + 200)
    expect(ducks).toEqual([true, false])
  })

  it('a second waits for the first, and the hook hears of each once TV is back', async () => {
    useTv.getState().start()
    await run(1500)
    const heard: Array<{ version: string; busy: boolean; waiting: number }> = []
    const off = afterUpgradeAnnouncement((a) => heard.push({ version: a.version, busy: announceBusy(), waiting: announceWaitingForTest() }))
    playUpgradeAnnouncement(NOTE)
    playUpgradeAnnouncement({ version: '2.2', text: 'Another.' })
    expect(useTvAnnounce.getState().showing?.plan.version).toBe('2.1')
    await run(noteMs + 200)
    // The second straight after the first, TV still stopped.
    expect(useTvAnnounce.getState().showing?.plan.version).toBe('2.2')
    expect(ducks).toEqual([true])
    await run(noteMs + 200)
    off()
    expect(announceBusy()).toBe(false)
    expect(heard.map((h) => h.version)).toEqual(['2.1', '2.2'])
    // Each told of only once TV is back: none while the second still plays (review: a reload there would cut it off).
    for (const h of heard) expect(h).toMatchObject({ busy: false, waiting: 0 })
    expect(ducks).toEqual([true, false])
  })

  it('a retune under it keeps its own clocks: the cut it began is not pushed past the end (review)', async () => {
    useTv.getState().start()
    await run(2500)
    playUpgradeAnnouncement(NOTE)
    await run(2000)
    // END OF TAPE's retune, or the stream's NO SIGNAL one, while it plays.
    useTv.getState().retune()
    const retunedCut = useTv.getState().cutAt
    await run(noteMs)
    expect(announceBusy()).toBe(false)
    expect(useTv.getState().cutAt).toBeLessThanOrEqual(performance.now())
    if (useTv.getState().cutAt !== retunedCut) expect(useTv.getState().cutAt).toBeGreaterThan(retunedCut)
  })

  it('cuts in, from screen to screen, and back to TV', async () => {
    useTv.getState().start()
    await run(1500)
    const t0 = performance.now()
    playUpgradeAnnouncement(NOTE)
    const plan = announcePlan(NOTE)!
    expect(announceCutAt(t0)).toBe(t0)
    const [, arrows, welcome] = screenStarts(plan)
    expect(announceCutAt(t0 + ANNOUNCE_IN_MS + arrows * 1000 + 50)).toBe(t0 + ANNOUNCE_IN_MS + arrows * 1000)
    expect(announceCutAt(t0 + ANNOUNCE_IN_MS + welcome * 1000 + 50)).toBe(t0 + ANNOUNCE_IN_MS + welcome * 1000)
    await run(noteMs + 200)
    const back = announceCutAt(performance.now())
    expect(back).toBeGreaterThanOrEqual(t0 + noteMs)
  })

  it('TV going off takes it away, unheard', async () => {
    useTv.getState().start()
    await run(1500)
    const heard: string[] = []
    const off = afterUpgradeAnnouncement((a) => heard.push(a.version))
    playUpgradeAnnouncement(NOTE)
    useTv.getState().stop()
    expect(announceBusy()).toBe(false)
    await run(noteMs + 200)
    off()
    expect(heard).toEqual([])
    expect(ducks).toEqual([true, false])
  })

  it('/tv?announce=test plays the sample once the first shot is up, and puts the updates this week on the marquee', async () => {
    useTv.getState().start()
    startAnnouncements('?announce=test')
    expect(useTvAnnounce.getState().updatesThisWeek).toBe(SAMPLE_UPDATES)
    await run(ANNOUNCE_TEST_MS - 200)
    expect(announceBusy()).toBe(false)
    await run(400)
    expect(useTvAnnounce.getState().showing?.plan.pages).toHaveLength(2)
    expect(useTvAnnounce.getState().showing?.plan.version).toBe(SAMPLE_ANNOUNCEMENT.version)
  })

  it('pauses an explainer where it is, and plays it on from there after', async () => {
    // A video that plays at the clock's pace, from a fetch of bytes the lineup's hash names.
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
      pause(): void { this.t = this.currentTime; this.paused = true; this.dispatchEvent(new Event('pause')) }
      play(): Promise<void> { this.from = performance.now(); this.paused = false; return Promise.resolve() }
    }
    const body = new TextEncoder().encode('clip')
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { bytesToHex } = await import('../../lib/events')
    vi.stubGlobal('document', { createElement: () => new ClockVideo(), addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' })
    vi.stubGlobal('fetch', async () => new Response(body as BodyInit))
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: <T extends ArrayBufferView>(a: T): T => real.getRandomValues(a as never) })
    const hash = bytesToHex(sha256(body))
    setExplainerLineupForTest([{ id: '1-test', title: 'TEST', duration: 60, files: [{ url: `https://b.example/${hash}.webm`, type: 'video/webm' }] }])
    vi.stubGlobal('window', { location: { search: '?explainer=1-test', pathname: '/tv' }, addEventListener: () => {}, removeEventListener: () => {}, history: { state: null, replaceState: () => {}, back: () => {} } })
    try {
      useTv.getState().start()
      await run(EXPLAINER_FORCED_MS + EXPLAINER_IN_MS + 3000)
      expect(useTvExplainer.getState().showing?.phase).toBe('play')
      const v = explainerVideo()!
      const showingAt = useTvExplainer.getState().showing!.at
      const t = v.currentTime
      ducks.length = 0
      playUpgradeAnnouncement(NOTE)
      expect(explainerHeldForTest()).toBe(true)
      expect(v.paused).toBe(true)
      await run(noteMs - 300)
      // Not a second further, and still on screen: no stall or guard took it.
      expect(v.currentTime).toBeCloseTo(t, 3)
      expect(useTvExplainer.getState().showing?.phase).toBe('play')
      await run(600)
      expect(announceBusy()).toBe(false)
      expect(explainerHeldForTest()).toBe(false)
      expect(v.paused).toBe(false)
      expect(useTvExplainer.getState().showing?.phase).toBe('play')
      expect(useTvExplainer.getState().showing!.at - showingAt).toBeGreaterThanOrEqual(noteMs - 100)
      // The explainer still has the music down: the announcement leaves it so.
      expect(ducks).toEqual([true])
      await run(2000)
      expect(v.currentTime).toBeGreaterThan(t + 1)
    } finally {
      setExplainerLineupForTest(null)
      vi.unstubAllGlobals()
    }
  })
})
