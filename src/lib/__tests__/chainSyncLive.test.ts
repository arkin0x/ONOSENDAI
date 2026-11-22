/**
 * chainSyncLive.test.ts - your chain kept caught up with your other devices
 * without a move (owner, 2026-11-21: "when I go to my tablet and refresh,
 * it doesn't immediately get the movement chain events I did on my phone.
 * I'm afraid to move because I dont want to fork my chain").
 *
 * What would go wrong silently:
 * - the watch on your own chain asked with a `since`, so moves your phone
 *   signed while LOCAL and published hours later never reach the open
 *   tablet (it stopped 115 moves in, the rest only on reloads);
 * - a live move whose previous move this device missed dropped on the
 *   floor instead of the gap being asked for;
 * - a catch-up per focus event, or per step: REQ churn (#844, #846);
 * - the HUD left on CHECKING YOUR CHAIN, or never told the relays were silent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'

const net = vi.hoisted(() => ({
  filters: [] as Filter[],
  /** The watch's handler, as selfSync opened it. */
  onEvent: null as ((ev: unknown) => void) | null,
  /** What each fetch from the newest held event returns, and what each asked. */
  fetches: [] as Array<{ since?: number }>,
  fetchAnswer: [] as unknown[],
  check: null as null | (() => Promise<unknown[]>),
}))
vi.mock('../relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../relay')>()),
  subscribe: (f: Filter) => { net.filters.push(f); return () => {} },
  // The standing subscription on each relay (lib/ownWatch.ts).
  subscribeOne: (_url: string, f: Filter) => { net.filters.push(f); return { close: () => {} } },
}))
vi.mock('../ownWatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ownWatch')>()
  return {
    ...actual,
    startOwnWatch: (pk: string, onEvent: (ev: unknown, url: string) => void, onEose?: () => void) => {
      net.onEvent = (ev: unknown) => onEvent(ev, 'wss://relay.onosendai.tech/')
      return actual.startOwnWatch(pk, () => {}, onEose)
    },
  }
})
vi.mock('../chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chains')>()
  return {
    ...actual,
    askChainEvents: async () => (net.check ? net.check() : []),
    fetchChainEvents: async (_pk: string, _g: string, _have: unknown[], since?: number) => { net.fetches.push({ since }); return net.fetchAnswer },
  }
})

import { placeSpawn } from '../../store/fixtures/placeSpawn'
import { useCyberspace } from '../../store/useCyberspace'
import { actionEvent } from './chainFixtures'
import { DEFAULT_RELAY } from '../../store/useRelays'
import { newestOnRelays } from '../../store/useCyberspace'
import type { NostrEvent } from '../events'

const S = () => useCyberspace.getState()
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) }

/** `n` actions after the head, as another device of yours would sign them. */
function movesAfter(n: number, from: NostrEvent = S().events[S().events.length - 1]): NostrEvent[] {
  const out: NostrEvent[] = []
  let prev = from
  for (let i = 0; i < n; i++) {
    prev = actionEvent({ pubkey: S().identity.pubkey, createdAt: prev.created_at + 1, genesisId: S().genesisId!, previousId: prev.id, name: 'wave' })
    out.push(prev)
  }
  return out
}

const { startSelfSync, catchUp, CATCH_UP_GAP_MS } = await import('../selfSync')
let clock = Date.now()

beforeEach(async () => {
  await placeSpawn()
  // Every event of the chain is on the relays, as an adopted chain's are.
  useCyberspace.setState({ published: Object.fromEntries(S().events.map((e) => [e.id, 'ok' as const])), chainConflict: null, held: false })
  net.fetches.length = 0
  net.fetchAnswer = []
  net.check = null
  vi.useFakeTimers({ toFake: ['Date'] })
  // Past any gap a catch-up before this case left, backed off or not.
  clock += CATCH_UP_GAP_MS * 17
  vi.setSystemTime(clock)
})

describe('the watch on your own chain', () => {
  it('asks for new events whatever their created_at: no since, one stored event', () => {
    startSelfSync()
    const own = net.filters.find((f) => f.authors?.includes(S().identity.pubkey))
    expect(own).toEqual({ kinds: [3333], authors: [S().identity.pubkey], limit: 1 })
  })

  it('a move signed long ago and published now is adopted at once, with no fetch', async () => {
    startSelfSync()
    const [late] = movesAfter(1)
    late.created_at = 1000 // signed while LOCAL, hours before it reached the relay
    net.onEvent!(late)
    await settle()
    expect(S().prevEventId).toBe(late.id)
    expect(net.fetches).toHaveLength(0)
  })

  it('a move whose previous this device missed asks the relays for the gap, from the newest event held, and lands on it', async () => {
    startSelfSync()
    const newestHeld = newestOnRelays(S().events, S().published)
    const missed = movesAfter(5)
    net.fetchAnswer = missed
    net.onEvent!(missed[4])
    await settle()
    expect(net.fetches).toEqual([{ since: newestHeld }])
    expect(S().prevEventId).toBe(missed[4].id)
  })

  it('an event of another chain (an old spawn\'s) asks nothing', async () => {
    startSelfSync()
    const other = actionEvent({ pubkey: S().identity.pubkey, createdAt: 5, genesisId: 'ff'.repeat(32), previousId: 'ee'.repeat(32), name: 'wave' })
    net.onEvent!(other)
    await settle()
    expect(net.fetches).toHaveLength(0)
  })
})

describe('catching up on a return to the tab', () => {
  it('live events that keep failing to link do not start a fetch each: one per gap, backed off after a fetch that heard nothing', async () => {
    startSelfSync()
    const other = movesAfter(3)
    net.fetchAnswer = []
    for (const ev of other.slice(1)) net.onEvent!(ev)
    await settle()
    net.onEvent!(other[2])
    net.onEvent!(other[1])
    await settle()
    expect(net.fetches).toHaveLength(1)
  })

  it('one ask per CATCH_UP_GAP_MS however many focus and visibility events come', async () => {
    const moves = movesAfter(3)
    net.fetchAnswer = moves
    catchUp('focus')
    catchUp('focus')
    await settle()
    catchUp('focus')
    await settle()
    expect(net.fetches).toHaveLength(1)
    expect(S().prevEventId).toBe(moves[2].id)
    clock += CATCH_UP_GAP_MS + 1
    vi.setSystemTime(clock)
    catchUp('focus')
    await settle()
    expect(net.fetches).toHaveLength(2)
  })

  it('unpublished moves forking against the relays\' raise the diverged-branch choice, and nothing is folded', async () => {
    const base = S().events[S().events.length - 1]
    const mineHere = movesAfter(1)
    useCyberspace.getState().adoptChain(mineHere)
    useCyberspace.setState({ published: { ...S().published, [mineHere[0].id]: 'queued' as const } })
    net.fetchAnswer = movesAfter(2, base)
    catchUp('resume')
    await settle()
    expect(S().chainConflict?.kind).toBe('branch')
    expect(S().prevEventId).toBe(mineHere[0].id)
  })
})

describe('the page\'s first look at the relays, as the HUD reads it', () => {
  it('CHECKING while out, done when the relays answered', async () => {
    let answer!: (a: unknown[]) => void
    net.check = () => new Promise((r) => { answer = r })
    const { recheckNow } = await import('../selfSync')
    useCyberspace.setState({ chainSync: null })
    recheckNow()
    expect(S().chainSync).toEqual({ pubkey: S().identity.pubkey, status: 'checking' })
    answer([{ url: DEFAULT_RELAY, outcome: 'answered', events: S().events }])
    await settle()
    expect(S().chainSync).toEqual({ pubkey: S().identity.pubkey, status: 'done' })
  })

  it('unreachable when no relay answered', async () => {
    net.check = async () => [{ url: DEFAULT_RELAY, outcome: 'unreachable', reason: 'no answer in time', events: [] }]
    const { recheckNow } = await import('../selfSync')
    recheckNow()
    await settle()
    expect(S().chainSync).toEqual({ pubkey: S().identity.pubkey, status: 'unreachable' })
    // A recheck while they stay silent does not flip the HUD back to CHECKING, or hold moves again.
    let answer!: (a: unknown[]) => void
    net.check = () => new Promise((r) => { answer = r })
    recheckNow()
    expect(S().chainSync).toEqual({ pubkey: S().identity.pubkey, status: 'unreachable' })
    answer([{ url: DEFAULT_RELAY, outcome: 'unreachable', reason: 'no answer in time', events: [] }])
    await settle()
    // A catch-up that hears nothing leaves it up: silence is not an answer.
    net.fetchAnswer = []
    catchUp('resume')
    await settle()
    expect(S().chainSync).toEqual({ pubkey: S().identity.pubkey, status: 'unreachable' })
    // One that hears the chain back takes the warning down.
    clock += CATCH_UP_GAP_MS * 17
    vi.setSystemTime(clock)
    net.fetchAnswer = S().events.slice(-1)
    catchUp('resume')
    await settle()
    expect(S().chainSync).toEqual({ pubkey: S().identity.pubkey, status: 'done' })
  })
})
