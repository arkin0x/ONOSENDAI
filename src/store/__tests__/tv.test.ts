/**
 * tv.test.ts: Cyberspace TV plays the tape: a random start, each trip as a
 * shot framed on its avatar, arrivals on the ticker, and the view put back
 * when it is turned off. Nothing is published but the set's anonymous
 * "watching" ping (lib/tv/watching.ts), never under the viewer's key.
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
  relaySet: () => ['wss://relay.test'],
  subscribe: vi.fn(() => () => {}),
}))

/** What TV published other than its watching pings: always nothing. */
function publishedBesidesPings(): unknown[] {
  return published.filter((e) => (e as { kind?: number }).kind !== 23334)
}

import type { Filter } from 'nostr-tools'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { positionHex, type NostrEvent } from '../../lib/events'
import { coordToXyz } from 'cyberspace-core'
import { V2_EPOCH } from '../../lib/tv/tape'
import { READ_STUCK_MS, TV_FOCUS_LABEL, fitScale, pathAfter, placeable, rideEnds, rideView, setTvAsk, shotOpening, useTv, type TvJump } from '../useTv'
import { useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { usePersonCard } from '../usePersonCard'
import { beatOf } from '../../lib/tv/tape'
import { AD_EVERY_MS, BROADCAST_AD_EVERY_MS } from '../../lib/tv/hosakaAd'
import { setBroadcastForTest } from '../../lib/tv/broadcast'
import { musicHeldForAd } from '../useTvMusic'
import type { Shot } from '../../lib/tv/director'

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
const tape: NostrEvent[] = [
  spawnOf(A, T0),
  hop(B, T0 + 100, 1000n, 1001n),
  hop(B, T0 + 102, 1001n, 1002n),
  hop(B, T0 + 104, 1002n, 1003n),
]

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
  // The random moment lands before the tape, and the random pick is the
  // oldest event after it (relays answer newest first): the tape's first.
  let calls = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (calls++ % 2 === 0 ? 0 : 0.999))
  setTvAsk(ask)
})

afterEach(() => {
  useTv.getState().stop()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function run(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) await vi.advanceTimersByTimeAsync(100)
}

describe('Cyberspace TV', () => {
  it('plays a trip as one shot framed on its avatar, with the arrival on the ticker', async () => {
    const zoomBefore = useCyberspace.getState().scaleExp
    useTv.getState().start()
    await run(1500)
    const s = useTv.getState()
    expect(s.on).toBe(true)
    expect(s.arrivals.map((a) => a.pubkey)).toEqual([A])
    expect(s.shot?.pubkey).toBe(B)
    expect(useCyberspace.getState().focus?.label).toBe(TV_FOCUS_LABEL)
    // The whole trip plays: three hops, the avatar where the last one put it.
    await run(8000)
    const end = useTv.getState()
    expect(end.avatars[B]?.position.x).toBe(1003n)
    expect(end.tapeTime).toBe(T0 + 104)
    useTv.getState().stop()
    expect(useCyberspace.getState().focus).toBeNull()
    expect(useCyberspace.getState().scaleExp).toBe(zoomBefore)
    expect(publishedBesidesPings()).toEqual([])
  })

  it('ends the tape at now, says so, and tunes in again', async () => {
    useTv.getState().start()
    // The shot ends a little after 8 s; END OF TAPE holds, then a new random start.
    await run(11000)
    expect(useTv.getState().status).toBe('end')
    await run(5000)
    expect(useTv.getState().status).toBe('playing')
  })

  it('a slow new tape after the end is not cut short, and END does not loop', async () => {
    useTv.getState().start()
    await run(9000)
    expect(useTv.getState().status).toBe('end')
    lag = 3000
    const states: string[] = []
    const off = useTv.subscribe((s) => { states.push(s.status) })
    await run(25000)
    off()
    // Tuning once, then playing; never END again inside the new tape's first shot.
    const i = states.indexOf('tuning')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(states.slice(i).includes('playing')).toBe(true)
    expect(states.slice(i, states.indexOf('playing', i))).not.toContain('end')
  })

  it('says NO SIGNAL only after reads keep failing, and RETRY keeps the set on', async () => {
    down = 1000
    useTv.getState().start()
    await run(20000)
    expect(useTv.getState().status).toBe('no-signal')
    down = 0
    useTv.getState().retune()
    await run(3000)
    expect(useTv.getState().on).toBe(true)
    expect(useTv.getState().status).toBe('playing')
  })

  it('puts the view back as it was: a view, its cursor, the pin, the zoom', async () => {
    const cs = useCyberspace.getState()
    cs.focusOn({ x: 5000n, y: 6n, z: 7n }, 0, 'VIEW', 3, true)
    useCyberspace.setState({ pin: { position: { x: 1n, y: 2n, z: 3n }, plane: 0, label: 'PIN', scaleExp: 4 } as never })
    const was = useCyberspace.getState()
    useTv.getState().start()
    await run(2000)
    usePersonCard.getState().open(B)
    // Never empty on the way back: a view's watchers read that as RETURN.
    let emptied = false
    const off = useCyberspace.subscribe((st) => { if (st.focus === null) emptied = true })
    useTv.getState().stop()
    off()
    expect(emptied).toBe(false)
    const now = useCyberspace.getState()
    expect(now.focus).toEqual(was.focus)
    expect(now.cursor).toEqual(was.cursor)
    expect(now.anchor).toEqual(was.anchor)
    expect(now.scaleExp).toBe(was.scaleExp)
    expect(now.pin).toEqual(was.pin)
    expect(usePersonCard.getState().pubkey).toBeNull()
    useCyberspace.getState().clearFocus()
    useCyberspace.setState({ pin: null })
  })

  it('OFF before the first shot still puts the view back', async () => {
    lag = 3000
    const zoom = useCyberspace.getState().scaleExp
    useCyberspace.setState({ scaleExp: zoom + 2 })
    useTv.getState().start()
    await run(1000)
    expect(useTv.getState().shot).toBeNull()
    useTv.getState().stop()
    expect(useCyberspace.getState().scaleExp).toBe(zoom + 2)
    expect(useCyberspace.getState().focus).toBeNull()
    useCyberspace.setState({ scaleExp: zoom })
  })

  it('will not start while BUILD owns the camera', () => {
    useBuilder.setState({ active: true })
    expect(useTv.getState().start()).toBe(false)
    expect(useTv.getState().on).toBe(false)
    useBuilder.setState({ active: false })
  })

  it('frames a shot that opens with a jump on where it lands', () => {
    const jump = beatOf({ ...hop(B, T0, 0n, 1n << 59n), tags: [['A', 'hyperjump'], ['e', '0'.repeat(64), '', 'genesis'], ['e', '0'.repeat(64), '', 'previous'], ['c', at(0n)], ['C', at(1n << 59n)], ['proof', 'a'.repeat(64)], ['from_height', '100'], ['B', '200'], ['mp', 'x']] })!
    expect(jump.action.type).toBe('hyperjump')
    const hops = [hop(B, T0 + 2, 1n << 59n, (1n << 59n) + 1n), hop(B, T0 + 4, (1n << 59n) + 1n, (1n << 59n) + 2n)].map((e) => beatOf(e)!)
    const shot = { beats: [jump, ...hops] } as unknown as Shot
    expect(fitScale(shot.beats)).toBeLessThan(4)
    expect(shotOpening(shot).position.x).toBe(1n << 59n)
  })

  it('rides a hyperjump on screen: the tunnel, the line between its two blocks, then the rider at B', async () => {
    const C = '3'.repeat(64)
    const far = 1n << 59n
    tape.push({ ...hop(C, T0 + 200, 1000n, far), tags: [['A', 'hyperjump'], ['e', '0'.repeat(64), '', 'genesis'], ['e', '0'.repeat(64), '', 'previous'], ['c', at(1000n)], ['C', at(far)], ['proof', 'a'.repeat(64)], ['from_height', '100'], ['B', '200'], ['mp', 'x']] })
    try {
      useTv.getState().start()
      const seen: Array<{ phase: TvJump['phase'] | null; scaleExp: number; x: bigint | undefined; focusX: bigint | undefined }> = []
      const off = useTv.subscribe((s) => {
        if (s.shot?.pubkey !== C) return
        const last = seen[seen.length - 1]
        const phase = s.jump?.phase ?? null
        if (!last || last.phase !== phase) seen.push({ phase, scaleExp: s.scaleExp, x: s.avatars[C]?.position.x, focusX: undefined })
      })
      // Where the view looks, once each phase has framed it.
      const offFocus = useCyberspace.subscribe((cs) => { const last = seen[seen.length - 1]; if (last && last.focusX === undefined) last.focusX = cs.focus?.position.x })
      await run(40000)
      off()
      offFocus()
      // The first time through (the tape ends and tunes in again after it).
      expect(seen.slice(0, 3).map((p) => p.phase)).toEqual(['warp', 'line', null])
      // The tunnel where the rider stood (no stop index here: its `c`).
      expect(seen[0].x).toBe(1000n)
      // The line: both blocks in frame, from halfway between them.
      const view = rideView({ x: 1000n, y: 5n, z: 7n }, { x: far, y: 5n, z: 7n })
      expect(seen[1].scaleExp).toBe(view.scaleExp)
      expect(view.scaleExp).toBeGreaterThan(50)
      expect(seen[1].focusX).toBe((1000n + far) / 2n)
      // Then the rider at B, close up.
      expect(seen[2].x).toBe(far)
      expect(seen[2].scaleExp).toBeLessThan(4)
      expect(publishedBesidesPings()).toEqual([])
    } finally {
      tape.pop()
    }
  })

  it('a ride\'s block A: B itself on a ride to the same block, else the rider\'s `c`, never named as A', () => {
    const ride = (from: string, to: string, extra: string[][] = []) => beatOf({ ...hop(B, T0, 1000n, 1n << 59n), tags: [['A', 'hyperjump'], ['e', '0'.repeat(64), '', 'genesis'], ['e', '0'.repeat(64), '', 'previous'], ['c', at(1000n)], ['C', at(1n << 59n)], ['proof', 'a'.repeat(64)], ['from_height', from], ['B', to], ['mp', 'x'], ...extra] })!
    // No stop index here: A is never looked up.
    const same = rideEnds(ride('300', '300'))
    expect(same.from.position.x).toBe(1n << 59n)
    expect(same.from.exact).toBe(true)
    // Without the index, where the rider stood: A on a chained ride, the
    // boarding spot on a first one, and `as_of` cannot tell which.
    for (const r of [ride('100', '200'), ride('100', '90', [['as_of', '100']])]) {
      expect(rideEnds(r).from.position.x).toBe(1000n)
      expect(rideEnds(r).from.exact).toBe(false)
    }
  })

  it('a bag with a public hint box is shown at its box, which stays; one without is never placed', async () => {
    const hint = '3129509e23d3a6125e1451a5912dbe01099e1517200000000000000000000000'
    tape.push(
      { id: id(), pubkey: A, created_at: T0 + 200, kind: 33330, tags: [['d', 'a'.repeat(64)], ['h', '7'], ['hint', hint, '30', '30', '30']], content: '', sig: '' },
      { id: id(), pubkey: A, created_at: T0 + 300, kind: 33330, tags: [['d', 'b'.repeat(64)], ['h', '7']], content: '', sig: '' },
    )
    try {
      useTv.getState().start()
      const seen: Array<{ kind: string; scale: number; boxes: number; focusAfter?: bigint }> = []
      const off = useTv.subscribe((s, prev) => {
        // Where the view stands when a shot ends: what that shot framed.
        if (prev.shot && s.shot !== prev.shot && seen.length > 0) seen[seen.length - 1].focusAfter ??= useCyberspace.getState().focus?.position.x
        if (s.shot && s.shot !== prev.shot) seen.push({ kind: s.shot.kind, scale: s.scaleExp, boxes: s.boxes.length })
      })
      await run(30000)
      off()
      const bags = seen.filter((x) => x.kind === 'bag')
      expect(bags.length).toBe(2)
      // The located one: framed on its box (2^30 a side, so 2^27 a cell), and its outline kept.
      expect(bags[0].scale).toBe(27)
      expect(bags[0].boxes).toBe(1)
      // The other: no box added, and the camera not moved to anywhere of its own.
      expect(bags[1].boxes).toBe(1)
      expect(bags[1].focusAfter).toBe(bags[0].focusAfter)
    } finally {
      tape.splice(tape.length - 2, 2)
    }
  })

  it('a reaction is a ticker line, never a shot', async () => {
    tape.push({ id: id(), pubkey: A, created_at: T0 + 101, kind: 7, tags: [['e', 'b'.repeat(64)], ['k', '3333']], content: '🔥', sig: '' })
    try {
      useTv.getState().start()
      const kinds: string[] = []
      const off = useTv.subscribe((s, prev) => { if (s.shot && s.shot !== prev.shot) kinds.push(s.shot.kind) })
      await run(9000)
      off()
      expect(kinds).not.toContain('reaction')
      expect(useTv.getState().reactions.map((r) => r.content)).toEqual(['🔥'])
    } finally {
      tape.pop()
    }
  })

  it('a hint box too uneven to frame plays in the inset', () => {
    expect(placeable({ base: { x: 0n, y: 0n, z: 0n }, plane: 0, heights: [30, 30, 30] })).toBe(true)
    expect(placeable({ base: { x: 0n, y: 0n, z: 0n }, plane: 0, heights: [30, 30, 20] })).toBe(false)
    expect(placeable(null)).toBe(false)
  })

  it('a trip after a segment is a cut, never a continuation', async () => {
    // B's trip, then A's comment on it, then A's own trip.
    tape.push(
      { id: id(), pubkey: A, created_at: T0 + 105, kind: 1111, tags: [['E', 'b'.repeat(64)], ['K', '3333'], ['e', 'b'.repeat(64)], ['k', '3333'], ['P', B]], content: 'nice', sig: '' },
      hop(A, T0 + 110, 1003n, 1004n),
    )
    try {
      useTv.getState().start()
      const cuts: Array<{ kind: string; cut: boolean }> = []
      let lastCut = -1
      const off = useTv.subscribe((s, prev) => {
        if (s.shot && s.shot !== prev.shot) { cuts.push({ kind: s.shot.kind, cut: s.cutAt !== lastCut }); lastCut = s.cutAt }
      })
      await run(30000)
      off()
      const i = cuts.findIndex((c) => c.kind === 'comment')
      expect(i).toBeGreaterThanOrEqual(0)
      expect(cuts[i + 1]).toEqual({ kind: 'trip', cut: true })
    } finally {
      tape.splice(tape.length - 2, 2)
    }
  })

  it('remembers where an avatar came from, to face along its move', async () => {
    useTv.getState().start()
    await run(9000)
    const b = useTv.getState().avatars[B]
    expect(b?.position.x).toBe(1003n)
    expect(b?.from?.x).toBe(1002n)
  })

  it('keeps the path an avatar walked on tape, for its trail', async () => {
    useTv.getState().start()
    await run(9000)
    // From where the trip opened, through each hop it played.
    expect(useTv.getState().avatars[B]?.path?.map((p) => p.x)).toEqual([1000n, 1001n, 1002n, 1003n])
    // The arrival that went nowhere has a path of one place: no line.
    expect(useTv.getState().avatars[A]?.path).toHaveLength(1)
  })

  it('a respawn starts a new trail, never one ending on an avatar not yet grown', async () => {
    // Back to its spawn point straight after its own trip, at the same zoom:
    // a shot that follows straight on, but opening with a spawn.
    const D = '4'.repeat(64)
    const s0 = coordToXyz(BigInt('0x' + D))
    const near = (dx: bigint) => positionHex({ x: s0.x + dx, y: s0.y, z: s0.z }, s0.plane as 0 | 1)
    const step = (t: number, a: bigint, b: bigint): NostrEvent => ({ ...hop(D, t, 0n, 0n), tags: [['A', 'hop'], ['e', '0'.repeat(64), '', 'genesis'], ['e', '0'.repeat(64), '', 'previous'], ['c', near(a)], ['C', near(b)], ['proof', 'a'.repeat(64)]] })
    const added = [spawnOf(D, T0 + 300), step(T0 + 302, 0n, 1n), spawnOf(D, T0 + 306), step(T0 + 308, 0n, 1n)]
    tape.push(...added)
    try {
      useTv.getState().start()
      const unborn: number[] = []
      const off = useTv.subscribe((s) => { const d = s.avatars[D]; if (d?.born === Infinity) unborn.push(d.path?.length ?? 0) })
      await run(40000)
      off()
      expect(unborn.length).toBeGreaterThan(0)
      expect(unborn.every((n) => n === 1)).toBe(true)
    } finally {
      tape.splice(tape.length - added.length, added.length)
    }
  })

  it('a path goes on in its plane, starts again in the other, and keeps its newest places', () => {
    const p = (x: bigint) => ({ x, y: 0n, z: 0n })
    const was = { position: p(2n), plane: 0, at: 0, path: [p(1n), p(2n)] }
    expect(pathAfter(was, p(3n), 0).map((q) => q.x)).toEqual([1n, 2n, 3n])
    // Standing still adds nothing.
    expect(pathAfter(was, p(2n), 0)).toBe(was.path)
    // Across the planes the two places are not a line.
    expect(pathAfter(was, p(3n), 1)).toEqual([p(3n)])
    expect(pathAfter(undefined, p(3n), 0)).toEqual([p(3n)])
    let long = { ...was, path: [p(0n)] }
    for (let i = 1n; i <= 300n; i++) long = { ...long, path: pathAfter(long, p(i), 0) }
    expect(long.path).toHaveLength(256)
    expect(long.path[255].x).toBe(300n)
  })

  it('gives up on a read that never comes back, and reads on without doubling', async () => {
    useTv.getState().start()
    await run(500)
    // Every question from now on hangs, as a dead socket's would.
    let hang = true
    setTvAsk((f) => (hang ? new Promise(() => {}) : ask(f)))
    useTv.getState().retune()
    await run(1000)
    hang = false
    await run(READ_STUCK_MS + 12_000)
    const s = useTv.getState()
    expect(s.status === 'playing' || s.status === 'end').toBe(true)
    setTvAsk(ask)
  })

  it('an avatar that spawns on screen is born when its spawn plays, not before', async () => {
    const C = '3'.repeat(64)
    tape.push(spawnOf(C, T0 + 200), hop(C, T0 + 202, 5000n, 5001n))
    try {
      useTv.getState().start()
      const seen: Array<number | undefined> = []
      const off = useTv.subscribe((s) => { if (s.shot?.pubkey === C) seen.push(s.avatars[C]?.born) })
      await run(20000)
      off()
      // Held at nothing while the shot opens, then born at a real moment.
      expect(seen[0]).toBe(Infinity)
      expect(seen.some((b) => b !== undefined && Number.isFinite(b))).toBe(true)
    } finally {
      tape.splice(tape.length - 2, 2)
    }
  })

  it('breaks for the HOSAKA commercial every AD_EVERY_MS, between shots, with nothing from the tape under it', async () => {
    useTv.getState().start()
    const ads: Array<{ at: number; shot: unknown; tapeTime: number | null }> = []
    let tapeMovedDuringAd = false
    // The music plays on under the break (2026-10-20: "we don't have to
    // mute the music while my hosaka ad plays").
    const held: boolean[] = []
    const off = useTv.subscribe((s, prev) => {
      if (s.ad && !prev.ad) { ads.push({ at: performance.now(), shot: s.shot, tapeTime: s.tapeTime }); held.push(musicHeldForAd()) }
      if (s.ad && prev.ad && s.played !== prev.played) tapeMovedDuringAd = true
      if (!s.ad && prev.ad) held.push(musicHeldForAd())
    })
    await run(AD_EVERY_MS - 1000)
    expect(ads).toHaveLength(0)
    await run(60_000)
    off()
    expect(ads.length).toBeGreaterThanOrEqual(1)
    expect(ads[0].shot).toBeNull()
    expect(tapeMovedDuringAd).toBe(false)
    // It ends with a cut, and the tape picks up.
    expect(useTv.getState().ad).toBeNull()
    expect(held.slice(0, 2)).toEqual([false, false])
    expect(musicHeldForAd()).toBe(false)
  })

  it('on the 24/7 stream, breaks every BROADCAST_AD_EVERY_MS instead (arkinox, 2026-10-21)', async () => {
    setBroadcastForTest(true)
    try {
      useTv.getState().start()
      const ads: number[] = []
      const t0 = performance.now()
      const off = useTv.subscribe((s, prev) => { if (s.ad && !prev.ad) ads.push(performance.now() - t0) })
      // Past the site's five minutes, and past ten: no break yet.
      await run(BROADCAST_AD_EVERY_MS - 1000)
      expect(ads).toHaveLength(0)
      await run(60_000)
      off()
      expect(ads).toHaveLength(1)
      expect(ads[0]).toBeGreaterThanOrEqual(BROADCAST_AD_EVERY_MS)
    } finally {
      useTv.getState().stop()
      setBroadcastForTest(null)
    }
  })

  it('never holds the music, through a break, a retune that cuts it short, or the set going off in it', async () => {
    for (const end of ['retune', 'stop'] as const) {
      useTv.getState().start()
      await run(AD_EVERY_MS - 1000)
      for (let i = 0; i < 120 && !useTv.getState().ad; i++) await run(500)
      expect(useTv.getState().ad).not.toBeNull()
      expect(musicHeldForAd()).toBe(false)
      if (end === 'retune') useTv.getState().retune()
      else useTv.getState().stop()
      expect(musicHeldForAd()).toBe(false)
      useTv.getState().stop()
    }
  })

  it('goes back to the tape in one cut, and never says NO SIGNAL over the commercial', async () => {
    useTv.getState().start()
    await run(AD_EVERY_MS - 1000)
    const cuts: number[] = []
    const statuses = new Set<string>()
    let began = false
    let ended: number | null = null
    const off = useTv.subscribe((s, prev) => {
      // Every read fails from the moment the break starts: NO SIGNAL waits until it is over.
      if (s.ad && !prev.ad) { began = true; down = 1_000 }
      if (s.ad) statuses.add(s.status)
      if (prev.ad && !s.ad) { ended = performance.now(); cuts.length = 0 }
      // The cuts as it comes out of the break. A later one is the set's own
      // business (a retune when the tape has run out), not a second cut back.
      if (ended !== null && s.cutAt !== prev.cutAt && performance.now() - ended < 3000) cuts.push(s.cutAt)
    })
    await run(60_000)
    off()
    down = 0
    // Not vacuous: a break was watched from its start to its end.
    expect(began).toBe(true)
    expect(ended).not.toBeNull()
    expect(statuses.size).toBeGreaterThan(0)
    expect(statuses.has('no-signal')).toBe(false)
    expect(new Set(cuts.slice(0, 2)).size).toBeLessThanOrEqual(1)
  })

  it('turns off when another view takes the camera', async () => {
    useTv.getState().start()
    await run(1500)
    useCyberspace.getState().focusOn({ x: 1n, y: 1n, z: 1n }, 0, 'VIEW')
    expect(useTv.getState().on).toBe(false)
  })
})
