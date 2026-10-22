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
import { setTvAsk, shotElapsed, tvDwellRun, useTv } from '../useTv'
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
    expect(d.pick(queue, 59.9 * S)).toEqual({ play: 0 })
    expect(d.over(60 * S)).toBe(true)
    expect(d.resting('a', 60 * S)).toBe(true)
    expect(d.someoneElse(queue, 60 * S)).toBe(true)
    expect(d.pick(queue, 60 * S)).toEqual({ play: 2 })
    // Someone else on: a new run.
    d.onScreen('b', 60 * S)
    expect(d.over(61 * S)).toBe(false)
  })

  it('passes over the rested pubkey for its rest, and lets it back after', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    d.over(60 * S)
    const queue = [shot('a'), shot('b')]
    for (const t of [61, 200, 400, 659]) expect(d.pick(queue, t * S), `${t} s`).toEqual({ play: 1 })
    expect(d.resting('a', 660 * S)).toBe(false)
    expect(d.pick(queue, 660 * S)).toEqual({ play: 0 })
  })

  it('playing on as the rested one after a break started its count again, it still gives way at once', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    d.over(60 * S)
    d.onScreen(null, 80 * S)
    d.onScreen('a', 100 * S)
    expect(d.over(110 * S)).toBe(false)
    expect(d.moveOn([shot('a')], 110 * S)).toBe(false)
    expect(d.moveOn([shot('a'), shot('b')], 110 * S)).toBe(true)
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
    // No one else queued: the rested one plays on, past the lines, while the tape is read on for someone.
    expect(d.pick(queue, 61 * S)).toEqual({ play: 1 })
    // Wanting someone else: nothing playable, however many lines wait too, so it reads on.
    expect(d.playable(queue, 61 * S)).toBe(0)
    expect(d.playable([...queue, ...Array.from({ length: 10 }, () => shot('f', 'arrival'))], 61 * S)).toBe(0)
    // With someone else's shot there, the lines count as before.
    expect(d.playable([...queue, shot('b')], 61 * S)).toBe(3)
    expect(d.pick([shot('b', 'arrival')], 61 * S)).toEqual({ none: true })
  })

  it('with only the rested pubkey queued: plays it on, reads on for someone else, and cuts to them when they come', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    d.over(60 * S)
    const queue = [shot('a'), shot('a')]
    expect(d.pick(queue, 61 * S)).toEqual({ play: 0 })
    expect(d.playable(queue, 61 * S)).toBe(0)
    expect(d.moveOn(queue, 61 * S)).toBe(false)
    d.onScreen('a', 70 * S)
    // Someone read in: cut now, and its rest is from the cut, the play-on unspent.
    expect(d.moveOn([...queue, shot('b')], 95 * S)).toBe(true)
    d.onScreen('b', 95 * S)
    expect(d.resting('a', (95 + 599) * S)).toBe(true)
    expect(d.resting('a', (95 + 600) * S)).toBe(false)
    // Read as far as DWELL_HELD_MAX of its shots, then no further: it plays on.
    const e = new Dwell()
    e.onScreen('a', 0)
    e.over(60 * S)
    const many = Array.from({ length: DWELL_HELD_MAX }, () => shot('a'))
    expect(e.pick(many, 61 * S)).toEqual({ play: 0 })
    expect(e.playable(many, 61 * S)).toBe(Infinity)
    expect(e.playable(many.slice(1), 61 * S)).toBe(0)
  })

  it('rests ten minutes from when TV moves away from it, however long it played on alone (review of #447)', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    expect(d.over(60 * S)).toBe(true)
    // Alone on the tape: it plays on, past the end of its first rest.
    for (const t of [100, 300, 540, 700]) { d.onScreen('a', t * S); d.over(t * S) }
    d.onScreen('b', 705 * S)
    const queue = [shot('a'), shot('c')]
    for (const t of [706, 900, 1304]) expect(d.pick(queue, t * S), `${t} s`).toEqual({ play: 1 })
    expect(d.pick(queue, 1305 * S)).toEqual({ play: 0 })
    // Under its minute, moving away rests no one.
    d.onScreen('c', 1305 * S)
    d.onScreen('a', 1330 * S)
    expect(d.resting('c', 1331 * S)).toBe(false)
  })

  it('playing on as the rested one for under a minute spends none of its rest: ten minutes from the last cut (review of #448)', () => {
    // Cut at 100 s; on again alone 300 to 330 s, cut again.
    const d = new Dwell()
    d.onScreen('a', 0)
    d.over(60 * S)
    d.onScreen('b', 100 * S)
    d.onScreen('a', 300 * S)
    d.onScreen('b', 330 * S)
    expect(d.resting('a', 929 * S)).toBe(true)
    expect(d.resting('a', 930 * S)).toBe(false)
    // A break, then on alone 120 to 170 s: rests from 170 s.
    const e = new Dwell()
    e.onScreen('a', 0)
    e.over(60 * S)
    e.onScreen(null, 90 * S)
    e.onScreen('a', 120 * S)
    e.onScreen('b', 170 * S)
    expect(e.resting('a', 769 * S)).toBe(true)
    expect(e.resting('a', 770 * S)).toBe(false)
    // On alone 61 s rests from its cut just the same: no jump at the minute.
    const f = new Dwell()
    f.onScreen('a', 0)
    f.over(60 * S)
    f.onScreen(null, 90 * S)
    f.onScreen('a', 120 * S)
    f.over(181 * S)
    f.onScreen('b', 181 * S)
    expect(f.resting('a', 780 * S)).toBe(true)
    expect(f.resting('a', 781 * S)).toBe(false)
  })

  it('a shot cued on purpose plays whoever it is', () => {
    const d = new Dwell()
    d.onScreen('a', 0)
    d.over(60 * S)
    d.free('a')
    expect(d.pick([shot('a'), shot('b')], 61 * S)).toEqual({ play: 0 })
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
    expect(d.pick([shot('a'), shot('b')], 700 * S)).toEqual({ play: 1 })
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
function spawnOf(pubkey: string, t: number): NostrEvent {
  return { id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'spawn'], ['C', pubkey]], content: '', sig: '' }
}
/** Under a relay's window (tape WINDOW_LIMIT), so the random start lands on the tape's first event. */
function load(events: NostrEvent[]): void {
  expect(events.length).toBeLessThan(500)
  tape = events
}

let tape: NostrEvent[] = []
/** Questions no relay answers, from now on, while above zero. */
let down = 0
/** How long the relay takes to answer, ms (fake time). */
let lag = 0
async function ask(f: Filter): Promise<RelayAnswer[]> {
  if (lag > 0) await new Promise((r) => setTimeout(r, lag))
  if (down > 0) { down--; return [{ url: 'wss://relay.test', outcome: 'unreachable', reason: 'down', events: [] }] }
  return [{ url: 'wss://relay.test', outcome: 'answered', events: tape
    .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until) && (!f.authors || f.authors.includes(e.pubkey)))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, f.limit ?? Infinity) }]
}

beforeEach(() => {
  down = 0
  lag = 0
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

type Seen = { t: number; pk: string | null; ad?: boolean; held?: boolean; tape?: number; el?: number; len?: number }
/**
 * Run TV for `ms` of fake time, noting every 100 ms whose shot is on screen
 * (null: none, or a break), and whether the picture is held: playing, no
 * commercial, and no shot or one past its end.
 */
async function watch(ms: number, seen: Seen[]): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100)
    const s = useTv.getState()
    const held = s.ad === null && s.status === 'playing' && (s.shot === null || shotElapsed() > s.shot.length + 0.2)
    seen.push({ t: performance.now(), pk: s.ad ? null : s.shot?.pubkey ?? null, ad: s.ad !== null, held, tape: s.tapeTime ?? 0, el: shotElapsed(), len: s.shot?.length ?? 0 })
  }
}
/** The longest the picture was held, ms, after `from`. */
function longestHold(seen: Seen[], from = 0): number {
  let run = 0
  let worst = 0
  for (const x of seen) { if (x.t < from) continue; run = x.held ? run + 100 : 0; worst = Math.max(worst, run) }
  return worst
}

describe('Cyberspace TV moves on after a minute of one pubkey', () => {
  it('cuts away from a one-gibson-at-a-time crawler at 60 s, to whoever else the tape has', async () => {
    // Alone for its first 200 s of tape: without the rule, over three minutes of it on screen.
    load([...crawler(A, 600), ...visitors(200, 600, 30)])
    useTv.getState().start()
    const seen: Seen[] = []
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
    const seen: Seen[] = []
    await watch(500_000, seen)
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
    const seen: Seen[] = []
    await watch(150_000, seen)
    const s = useTv.getState()
    expect(s.status).toBe('playing')
    // Still the crawler, well past its minute, and the tape has moved on with it.
    expect(seen.filter((x) => x.pk === A).length).toBeGreaterThan(1400)
    expect(s.tapeTime! - T0).toBeGreaterThan(120)
    // Never a still picture (no shot, or one held past its end) longer than a moment, but the HOSAKA spot.
    expect(longestHold(seen, 2000)).toBeLessThanOrEqual(1000)
  })
  it('reads on past ticker lines for someone else: six arrivals behind the rested shots never hold the picture (review of #447)', async () => {
    const crawl: NostrEvent[] = []
    for (let k = 0; k * 5 < 1700; k++) crawl.push(hop(A, T0 + k * 5, 1000n + BigInt(k), 1001n + BigInt(k)))
    const arrivals = Array.from({ length: 6 }, (_, k) => spawnOf(OTHERS[k % 4].slice(0, 63) + String(k), T0 + 400 + k * 5))
    load([...crawl, ...arrivals, ...visitors(2100, 2400, 60)])
    useTv.getState().start()
    const seen: Seen[] = []
    await watch(120_000, seen)
    const onA = seen.filter((x) => x.pk === A)
    expect(onA[onA.length - 1].t - onA[0].t).toBeLessThanOrEqual(DWELL_MAX_S * 1000 + 100)
    // On to a visitor straight after the minute, the arrivals on the ticker on the way.
    const visit = seen.find((x) => x.pk !== null && OTHERS.includes(x.pk))!
    expect(visit.t - onA[onA.length - 1].t).toBeLessThanOrEqual(1000)
    // The ticker keeps the newest four arrivals: the last of the six.
    expect(useTv.getState().arrivals.map((x) => x.at)).toContain(T0 + 425)
    expect(longestHold(seen, 2000)).toBeLessThanOrEqual(1000)
  })

  it('plays the rested one on while slow relays are read ahead for someone else, and cuts the moment they come (arkinox, 2026-10-22)', async () => {
    // A hop every 2 s: shots of some 46 s on screen, so a cut at a shot's end would show.
    load([...crawler(A, 900), ...visitors(1300, 1500, 60)])
    lag = 3000
    useTv.getState().start()
    const seen: Seen[] = []
    await watch(150_000, seen)
    const visit = seen.find((x) => x.pk !== null && OTHERS.includes(x.pk))!
    expect(visit).toBeDefined()
    const onA = seen.filter((x) => x.pk === A && x.t < visit.t)
    // It played on past its minute while the reads came in, never a still picture,
    expect(onA[onA.length - 1].t - onA[0].t).toBeGreaterThan(DWELL_MAX_S * 1000 + 2000)
    const playing = seen.find((x) => x.pk !== null)!.t
    expect(longestHold(seen, playing)).toBeLessThanOrEqual(1000)
    // and gave way the tick a visitor was read in: mid-shot, not at its end.
    const lastA = onA[onA.length - 1]
    expect(visit.t - lastA.t).toBeLessThanOrEqual(200)
    expect(lastA.len! - lastA.el!).toBeGreaterThan(2)
  })

  it('keeps its rest across a new tape', async () => {
    load([...crawler(A, 600), ...visitors(200, 600, 30)])
    useTv.getState().start()
    const seen: Seen[] = []
    await watch(70_000, seen)
    expect(seen.at(-1)!.pk).not.toBe(A)
    // A retune lands on the crawler's first hop again: still resting, so on to the others.
    useTv.getState().retune()
    const after: Seen[] = []
    await watch(40_000, after)
    expect(after.some((x) => x.pk !== null && OTHERS.includes(x.pk))).toBe(true)
    expect(after.some((x) => x.pk === A)).toBe(false)
  })

  it('with the relays not answering while it waits for someone else, plays the rested one on rather than hold the picture', async () => {
    load(crawler(A, 1490))
    useTv.getState().start()
    const seen: Seen[] = []
    await watch(55_000, seen)
    down = 1_000_000
    await watch(60_000, seen)
    down = 0
    const late = seen.filter((x) => x.t > 75_000)
    expect(late.filter((x) => x.pk === A).length).toBeGreaterThan(200)
    // Held no longer than the reads take to fail three times, with their backoff.
    expect(longestHold(seen, 2000)).toBeLessThanOrEqual(15_000)
  })

  it('a HOSAKA break ends the run: the minute starts again after it', async () => {
    load(crawler(A, 1200))
    useTv.getState().start()
    const seen: Seen[] = []
    // A break comes at the first cut after five minutes.
    await watch(7 * 60_000, seen)
    const ad = seen.find((x) => x.ad)
    expect(ad).toBeDefined()
    const back = seen.find((x) => x.t > ad!.t && !x.ad && x.pk === A)
    expect(back).toBeDefined()
    expect(tvDwellRun().pubkey).toBe(A)
    expect(tvDwellRun().since).toBeGreaterThanOrEqual(ad!.t)
  })

})
