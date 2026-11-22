/**
 * ownWatch.test.ts: the standing subscription on each relay, and when a relay
 * counts as current for the head check (owner's ruling of 2026-11-22).
 *
 * What would go wrong silently: a relay trusted before it caught up, after it
 * reconnected, or while its socket has gone quiet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EOSE_WAIT_MS, FRESHEN_WAIT_MS, LIVE_MS, STALL_MS, freshenOwnWatch, ownWatchDeps, ownWatchState, startOwnWatch, stopOwnWatch } from '../ownWatch'
import type { NostrEvent } from '../events'

type H = Parameters<typeof ownWatchDeps.subscribeOne>[2]
const net = { subs: [] as Array<{ url: string; filter: Record<string, unknown>; h: H; closed: boolean }>, age: new Map<string, number>(), owed: new Map<string, number>(), dropped: [] as string[], failed: new Set<string>() }

const PK = 'ab'.repeat(32)
const A = 'wss://a.example/', B = 'wss://b.example/'
const ev = (n: number, pubkey = PK): NostrEvent => ({ id: n.toString(16).padStart(64, '0'), pubkey, created_at: n, kind: 3333, tags: [], content: '', sig: '' })

function install(): void {
  ownWatchDeps.subscribeOne = (url, filter, h) => { const s = { url, filter: filter as Record<string, unknown>, h, closed: false }; net.subs.push(s); return { close: () => { s.closed = true } } }
  ownWatchDeps.frameAge = (url) => net.age.get(url) ?? 0
  ownWatchDeps.unansweredFor = (url) => net.owed.get(url) ?? 0
  ownWatchDeps.relays = () => [A, B]
  ownWatchDeps.signInFailed = (url) => net.failed.has(url)
  ownWatchDeps.drop = (url) => { net.dropped.push(url) }
}
const own = (url: string) => net.subs.filter((s) => s.url === url && s.filter.authors && !s.closed).at(-1)!
const state = (url: string) => ownWatchState(PK)!.find((r) => r.url === url)!

afterEach(() => { stopOwnWatch(); net.subs.length = 0; net.age.clear(); net.owed.clear(); net.dropped.length = 0; net.failed.clear(); vi.useRealTimers() })

describe('the standing watch', () => {
  it("one subscription per relay, for this identity's moves; current only after its EOSE", () => {
    install()
    const seen: string[] = []
    startOwnWatch(PK, (e) => seen.push((e as { id: string }).id))
    expect(net.subs.filter((s) => s.filter.authors)).toHaveLength(2)
    expect(state(A).current).toBe(false)
    own(A).h.onevent(ev(5))
    own(A).h.oneose()
    expect(state(A).current).toBe(true)
    expect(state(A).newest?.created_at).toBe(5)
    expect(state(B).current).toBe(false)
    // Another identity's event is not this watch's.
    own(A).h.onevent(ev(9, 'cd'.repeat(32)))
    expect(state(A).newest?.created_at).toBe(5)
    expect(seen).toEqual([ev(5).id])
  })

  it('a socket that has gone quiet past LIVE_MS is not current, and is again once it is heard from', () => {
    install()
    startOwnWatch(PK, () => {})
    own(A).h.oneose()
    expect(state(A).current).toBe(true)
    net.age.set(A, LIVE_MS + 1)
    expect(state(A).current).toBe(false)
    net.age.set(A, 10)
    expect(state(A).current).toBe(true)
  })

  it('a socket that was sent a move and has said nothing back for STALL_MS is not current, well before LIVE_MS of silence', () => {
    install()
    startOwnWatch(PK, () => {})
    own(A).h.oneose()
    net.age.set(A, STALL_MS + 1)
    net.owed.set(A, STALL_MS + 1)
    expect(STALL_MS).toBeLessThan(LIVE_MS)
    expect(state(A).current).toBe(false)
    net.owed.set(A, 0)
    expect(state(A).current).toBe(true)
  })

  it('a subscription that closes is not current, and after it opens again not until its EOSE', () => {
    vi.useFakeTimers()
    install()
    startOwnWatch(PK, () => {})
    own(A).h.oneose()
    own(A).h.onclose('socket gone')
    expect(state(A).current).toBe(false)
    vi.advanceTimersByTime(1_100)
    expect(net.subs.filter((s) => s.url === A && s.filter.authors)).toHaveLength(2)
    expect(state(A).current).toBe(false)
    own(A).h.oneose()
    expect(state(A).current).toBe(true)
  })

  it('a relay whose sign-in failed is not current and is asked again only after the long wait, never holding anything', () => {
    vi.useFakeTimers()
    install()
    startOwnWatch(PK, () => {})
    own(B).h.oneose()
    net.failed.add(A)
    own(A).h.onclose('auth-required: sign in')
    vi.advanceTimersByTime(60_000)
    expect(net.subs.filter((s) => s.url === A && s.filter.authors)).toHaveLength(1)
    expect(state(A).current).toBe(false)
    expect(state(B).current).toBe(true)
  })

  it('after a pause, a quiet relay is asked for a frame (no events, not the chain) and is current once it answers', async () => {
    install()
    startOwnWatch(PK, () => {})
    own(A).h.oneose()
    own(B).h.oneose()
    net.age.set(A, LIVE_MS + 1)
    net.age.set(B, LIVE_MS + 1)
    expect(state(A).current).toBe(false)
    const done = freshenOwnWatch(PK)
    const probes = net.subs.filter((s) => s.filter.ids && !s.closed)
    expect(probes.map((p) => p.url).sort()).toEqual([A, B])
    expect(probes.every((p) => !p.filter.authors && !p.filter.kinds)).toBe(true)
    net.age.set(A, 5)
    probes.find((p) => p.url === A)!.h.oneose()
    await done
    expect(state(A).current).toBe(true)
    expect(state(B).current).toBe(false)
  })

  it('a stalled relay answers no probe: freshen gives up after FRESHEN_WAIT_MS and it stays not current', async () => {
    vi.useFakeTimers()
    install()
    ownWatchDeps.relays = () => [A]
    startOwnWatch(PK, () => {})
    own(A).h.oneose()
    net.age.set(A, LIVE_MS + 1)
    let settled = false
    const done = freshenOwnWatch(PK).then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(FRESHEN_WAIT_MS - 100)
    expect(settled).toBe(false)
    net.owed.set(A, FRESHEN_WAIT_MS)
    await vi.advanceTimersByTimeAsync(200)
    await done
    expect(state(A).current).toBe(false)
    // Its socket is dropped, so the watch reopens over a fresh one.
    expect(net.dropped).toEqual([A])
  })

  it('a subscription that never reaches its EOSE (its REQ lost, the socket stalled) is asked again, over a fresh socket when it owes an answer', async () => {
    vi.useFakeTimers()
    install()
    ownWatchDeps.relays = () => [A]
    startOwnWatch(PK, () => {})
    net.owed.set(A, EOSE_WAIT_MS)
    await vi.advanceTimersByTimeAsync(EOSE_WAIT_MS + 10)
    expect(net.dropped).toEqual([A])
    expect(state(A).current).toBe(false)
    await vi.advanceTimersByTimeAsync(1_100)
    const opened = net.subs.filter((s) => s.url === A && s.filter.authors)
    expect(opened).toHaveLength(2)
    expect(opened[0].closed).toBe(true)
    net.owed.set(A, 0)
    own(A).h.oneose()
    expect(state(A).current).toBe(true)
  })

  it('answers only for the identity it watches', () => {
    install()
    startOwnWatch(PK, () => {})
    expect(ownWatchState('cd'.repeat(32))).toBeNull()
    stopOwnWatch()
    expect(ownWatchState(PK)).toBeNull()
  })
})
