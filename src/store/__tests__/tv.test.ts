/**
 * tv.test.ts: Cyberspace TV plays the tape: a random start, each trip as a
 * shot framed on its avatar, arrivals on the ticker, and the view put back
 * when it is turned off. Nothing is published.
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
}))

import type { Filter } from 'nostr-tools'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { positionHex, type NostrEvent } from '../../lib/events'
import { V2_EPOCH } from '../../lib/tv/tape'
import { READ_STUCK_MS, TV_FOCUS_LABEL, fitScale, placeable, setTvAsk, shotOpening, useTv } from '../useTv'
import { useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { usePersonCard } from '../usePersonCard'
import { beatOf } from '../../lib/tv/tape'
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
    expect(published).toEqual([])
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

  it('turns off when another view takes the camera', async () => {
    useTv.getState().start()
    await run(1500)
    useCyberspace.getState().focusOn({ x: 1n, y: 1n, z: 1n }, 0, 'VIEW')
    expect(useTv.getState().on).toBe(false)
  })
})
