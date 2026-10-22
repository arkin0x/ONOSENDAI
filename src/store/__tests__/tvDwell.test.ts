/**
 * tvDwell.test.ts: no one holds Cyberspace TV for more than a minute
 * (arkinox, 2026-10-22: "I had an npub on screen for like 8 minutes and it
 * was just moving one by one by one gibson"). Past DWELL_MAX_S of screen time
 * TV moves on to someone else, and does not come back to them for
 * DWELL_REST_S unless no one else is on the tape (lib/tv/dwell).
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

import type { Filter } from 'nostr-tools'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { positionHex, type NostrEvent } from '../../lib/events'
import { V2_EPOCH } from '../../lib/tv/tape'
import { setTvAsk, useTv } from '../useTv'
import { DWELL_HELD_MAX, DWELL_MAX_S, DWELL_REST_S, Dwell, dwellLimits } from '../../lib/tv/dwell'
import type { Shot } from '../../lib/tv/director'

// ---------------------------------------------------------------- the rule

const shot = (pubkey: string, kind: Shot['kind'] = 'trip'): Shot => ({ id: `${pubkey}-${Math.random()}`, kind, pubkey, beats: [], start: 0, end: 0, offsets: [], length: 20 })
const S = 1000

describe('the dwell rule (lib/tv/dwell)', () => {
  it('is a minute on screen, then ten minutes off, in one place', () => {
    expect(DWELL_MAX_S).toBe(60)
    expect(DWELL_REST_S).toBe(600)
    expect(dwellLimits(false)).toEqual({ maxMs: 60 * S, restMs: 600 * S })
    expect(dwellLimits(true)).toEqual(dwellLimits(false))
  })

  it('a long run of one pubkey moves on at 60 s, to the next of anyone else', () => {
    const d = new Dwell()
    const queue = [shot('a'), shot('a'), shot('b'), shot('a'), shot('c')]
    d.onScreen('a', 0)
    // Shot after shot of the same pubkey is one run.
    d.onScreen('a', 20 * S)
    d.onScreen('a', 40 * S)
    expect(d.run).toEqual({ pubkey: 'a', since: 0 })
    expect(d.over(59.9 * S)).toBe(false)
    expect(d.pick(queue, 59.9 * S, true)).toEqual({ play: 0 })
    expect(d.over(60 * S)).toBe(true)
    expect(d.resting('a', 60 * S)).toBe(true)
    expect(d.someoneElse(queue, 60 * S)).toBe(true)
    expect(d.pick(queue, 60 * S, true)).toEqual({ play: 2 })
    // Someone else on: a new run.
    d.onScreen('b', 60 * S)
    expect(d.over(61 * S)).toBe(false)
  })

  it('passes over the rested pubkey for its rest, and lets it back after', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    d.over(60 * S)
    const queue = [shot('a'), shot('b')]
    for (const t of [61, 200, 400, 659]) expect(d.pick(queue, t * S, true), `${t} s`).toEqual({ play: 1 })
    expect(d.resting('a', 660 * S)).toBe(false)
    expect(d.pick(queue, 660 * S, true)).toEqual({ play: 0 })
  })

  it('a break or anyone else in between ends a run', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    d.onScreen(null, 50 * S)
    d.onScreen('a', 55 * S)
    expect(d.over(100 * S)).toBe(false)
    d.onScreen('b', 110 * S)
    d.onScreen('a', 115 * S)
    expect(d.over(174 * S)).toBe(false)
    expect(d.over(175 * S)).toBe(true)
  })

  it('ticker lines (arrivals, reactions) are never picked, never held, and do not count as anyone else', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    d.over(60 * S)
    const queue = [shot('b', 'arrival'), shot('a'), shot('c', 'reaction')]
    expect(d.someoneElse(queue, 61 * S)).toBe(false)
    expect(d.pick(queue, 61 * S, true)).toEqual({ wait: true })
    expect(d.playable(queue, 61 * S)).toBe(2)
    expect(d.pick([shot('b', 'arrival')], 61 * S, true)).toEqual({ none: true })
  })

  it('with only the rested pubkey on the tape: waits while more can be read, then plays it anyway', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    d.over(60 * S)
    const queue = [shot('a'), shot('a')]
    expect(d.pick(queue, 61 * S, true)).toEqual({ wait: true })
    expect(d.pick(queue, 61 * S, false)).toEqual({ play: 0 })
    // Held as far as DWELL_HELD_MAX, then it plays on rather than reading on and on.
    const many = Array.from({ length: DWELL_HELD_MAX }, () => shot('a'))
    expect(d.pick(many, 61 * S, true)).toEqual({ play: 0 })
    expect(d.playable(many, 61 * S)).toBe(Infinity)
    expect(d.playable(many.slice(1), 61 * S)).toBe(0)
  })

  it('playing on alone, it stays over: the first shot of anyone else that comes is put on', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    expect(d.over(60 * S)).toBe(true)
    d.onScreen('a', 70 * S)
    expect(d.over(80 * S)).toBe(true)
    // Its rest runs out while it plays on alone: it rests again.
    expect(d.over(700 * S)).toBe(true)
    expect(d.resting('a', 1250 * S)).toBe(true)
    expect(d.pick([shot('a'), shot('b')], 700 * S, true)).toEqual({ play: 1 })
  })
})

// ------------------------------------------------------------- on the tape

let n = 0
const id = (): string => (n++).toString(16).padStart(64, 'e')
const at = (x: bigint) => positionHex({ x, y: 5n, z: 7n }, 0)
function hop(pubkey: string, t: number, from: bigint, to: bigint): NostrEvent {
  return { id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'hop'], ['e', '0'.repeat(64), '', 'genesis'], ['e', '0'.repeat(64), '', 'previous'], ['c', at(from)], ['C', at(to)], ['proof', 'a'.repeat(64)]], content: '', sig: '' }
}

const A = 'a'.repeat(64)
const OTHERS = ['b', 'c', 'd', 'e'].map((c) => c.repeat(64))
const T0 = V2_EPOCH + 1000

/** One avatar moving one gibson at a time, a hop every 3 s, for `seconds` of tape. */
function crawler(pubkey: string, seconds: number): NostrEvent[] {
  const out: NostrEvent[] = []
  for (let k = 0; k * 3 < seconds; k++) out.push(hop(pubkey, T0 + k * 3, 1000n + BigInt(k), 1001n + BigInt(k)))
  return out
}
/** Trips of `hops` hops 3 s apart by the others in turn, one every `every` s of tape from `from` to `to`. */
function visitors(from: number, to: number, every: number, hops = 3): NostrEvent[] {
  const out: NostrEvent[] = []
  for (let k = 0, t = from; t < to; k++, t += every) {
    const pk = OTHERS[k % OTHERS.length]
    const x = 9_000_000n + BigInt(k) * 100n
    for (let j = 0; j < hops; j++) out.push(hop(pk, T0 + t + j * 3, x + BigInt(j), x + BigInt(j) + 1n))
  }
  return out
}
/** Under a relay's window (tape WINDOW_LIMIT), so the random start lands on the tape's first event. */
function load(events: NostrEvent[]): void {
  expect(events.length).toBeLessThan(500)
  tape = events
}

let tape: NostrEvent[] = []
async function ask(f: Filter): Promise<RelayAnswer[]> {
  return [{ url: 'wss://relay.test', outcome: 'answered', events: tape
    .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until) && (!f.authors || f.authors.includes(e.pubkey)))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, f.limit ?? Infinity) }]
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
  // The random start lands on the tape's first event (as tv.test.ts).
  let calls = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (calls++ % 2 === 0 ? 0 : 0.999))
  setTvAsk(ask)
})

afterEach(() => {
  useTv.getState().stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Run TV for `ms` of fake time, noting whose shot is on screen every 100 ms (null: none, or a break). */
async function watch(ms: number, seen: Array<{ t: number; pk: string | null; ad?: boolean }>): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100)
    const s = useTv.getState()
    seen.push({ t: performance.now(), pk: s.ad ? null : s.shot?.pubkey ?? null, ad: s.ad !== null })
  }
}

describe('Cyberspace TV moves on after a minute of one pubkey', () => {
  it('cuts away from a one-gibson-at-a-time crawler at 60 s, to whoever else the tape has', async () => {
    // Alone for its first 200 s of tape: without the rule, over three minutes of it on screen.
    load([...crawler(A, 600), ...visitors(200, 600, 30)])
    useTv.getState().start()
    const seen: Array<{ t: number; pk: string | null; ad?: boolean }> = []
    await watch(80_000, seen)
    const onA = seen.filter((x) => x.pk === A)
    expect(onA[0].t).toBeLessThan(2000)
    const lastA = onA[onA.length - 1].t
    // Never longer than the limit (a tick's slack), and moved on then.
    expect(lastA - onA[0].t).toBeLessThanOrEqual(DWELL_MAX_S * 1000 + 100)
    expect(lastA - onA[0].t).toBeGreaterThanOrEqual(DWELL_MAX_S * 1000 - 100)
    const after = seen.filter((x) => x.t > lastA)
    expect(after.length).toBeGreaterThan(100)
    expect(after.every((x) => x.pk !== A)).toBe(true)
    expect(OTHERS).toContain(after.find((x) => x.pk !== null)!.pk)
    // The tape skipped on to them: the crawler's shots in between were passed over.
    expect(useTv.getState().tapeTime! - T0).toBeGreaterThanOrEqual(200)
  })

  it('does not come back to it while it rests and others are on the tape, and no one else holds a minute', async () => {
    // Visitors' trips of 45 s, one every 100 s: without the rule, the crawler held about 100 s between them.
    load([...crawler(A, 900), ...visitors(150, 900, 100, 15)])
    const lastVisit = Math.max(...tape.filter((e) => e.pubkey !== A).map((e) => e.created_at))
    useTv.getState().start()
    const seen: Array<{ t: number; pk: string | null; ad?: boolean; tape?: number }> = []
    for (let t = 0; t < 500_000; t += 100) {
      await vi.advanceTimersByTimeAsync(100)
      const s = useTv.getState()
      seen.push({ t: performance.now(), pk: s.ad ? null : s.shot?.pubkey ?? null, ad: s.ad !== null, tape: s.tapeTime ?? 0 })
    }
    const onA = seen.filter((x) => x.pk === A)
    const firstRunEnd = onA.find((x, i) => i > 0 && x.t - onA[i - 1].t > 100)?.t ?? Infinity
    const restFrom = onA.filter((x) => x.t < firstRunEnd).pop()!.t
    expect(restFrom - onA[0].t).toBeLessThanOrEqual(DWELL_MAX_S * 1000 + 100)
    // Off screen from then until the others' last trip has played: only then is it all the tape has left.
    const othersDone = seen.find((x) => x.pk !== A && x.pk !== null && (x.tape ?? 0) >= lastVisit)!.t
    expect(othersDone - restFrom).toBeGreaterThan(5 * 60_000)
    expect(othersDone - restFrom).toBeLessThan(DWELL_REST_S * 1000)
    expect(seen.some((x) => x.pk === A && x.t > restFrom && x.t <= othersDone)).toBe(false)
    // Then it plays on, alone, before its rest is up: better than a still picture or the end.
    expect(seen.some((x) => x.pk === A && x.t > othersDone)).toBe(true)
    // Nobody's run, the visitors' included, goes past the minute.
    let runPk: string | null = null
    let runFrom = 0
    for (const x of seen.filter((y) => y.t <= othersDone)) {
      if (x.pk !== runPk) { runPk = x.pk; runFrom = x.t }
      if (runPk !== null) expect(x.t - runFrom, `${runPk.slice(0, 4)} at ${x.t}`).toBeLessThanOrEqual(DWELL_MAX_S * 1000 + 100)
    }
  })

  it('plays on with a lone pubkey: the rest never leaves a still picture or ends the tape early', async () => {
    load(crawler(A, 600))
    useTv.getState().start()
    const seen: Array<{ t: number; pk: string | null; ad?: boolean }> = []
    await watch(150_000, seen)
    const s = useTv.getState()
    expect(s.status).toBe('playing')
    // Still the crawler, well past its minute, and the tape has moved on with it.
    expect(seen.filter((x) => x.pk === A).length).toBeGreaterThan(1400)
    expect(s.tapeTime! - T0).toBeGreaterThan(120)
    // No gap without a shot longer than a moment, but the HOSAKA spot.
    let gap = 0
    let worst = 0
    for (const x of seen.slice(20)) { gap = x.pk === null && !x.ad ? gap + 100 : 0; worst = Math.max(worst, gap) }
    expect(worst).toBeLessThanOrEqual(1000)
  })
})
