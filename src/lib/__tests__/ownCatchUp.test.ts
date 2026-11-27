/**
 * ownCatchUp.test.ts - a device far behind your other device catches up
 * without freezing, keeps what it fetched, shows where you are at once, and
 * makes no move until it is caught up (owner's tablet, 2026-11-27: about
 * 3,800 moves made on the phone; the tablet sat on CHECKING YOUR CHAIN, then
 * CHAIN NOT CHECKED after a force-close).
 *
 * What would go wrong silently:
 * - each of the live watch's backlog of moves folded on its own, building
 *   the whole chain twice per move (minutes of frozen page on a tablet);
 * - a catch-up cut short keeping nothing, so every retry and every reload
 *   starts again from zero and fails the same way;
 * - pages asked of a dead relay, or of the old read-only mirror;
 * - the position shown only once the whole stretch is in;
 * - a move signed on the head shown early, before the stretch is whole;
 * - the normal one-move live update, forks or divergence lost on the way.
 *
 * The relays are stand-ins that answer as relay.onosendai.tech does: newest
 * first, at most 500 events per REQ.
 */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'
import { normalizeURL } from 'nostr-tools/utils'
import { getEventHash } from 'nostr-tools/pure'

const builds = vi.hoisted(() => ({ chain: 0, divergence: 0 }))
vi.mock('../events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../events')>()
  return { ...actual, buildChain: vi.fn((...a: Parameters<typeof actual.buildChain>) => { builds.chain++; return actual.buildChain(...a) }) }
})
vi.mock('../branchConflict', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../branchConflict')>()
  return { ...actual, findDivergence: vi.fn((...a: Parameters<typeof actual.findDivergence>) => { builds.divergence++; return actual.findDivergence(...a) }) }
})

const CAP = 500
const net = vi.hoisted(() => ({
  /** What the relays holding the chain hold (the canonical relay and the old mirror). */
  chain: [] as Array<{ id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }>,
  /** Every question: which relays it went to, and its filter. */
  asked: [] as Array<{ relays: string[]; filter: Filter | Filter[] }>,
  /** Page questions the canonical relay still answers; past it, it goes silent (a socket gone, a deadline). */
  pagesLeft: Infinity,
  /** Every relay times out with nothing. */
  silent: false,
  /** Run on every question, before it is answered. */
  onAsk: null as null | ((f: Filter | Filter[]) => void),
  count: null as number | null,
  onEvent: null as null | ((ev: unknown, url: string) => void),
}))

const CANON = normalizeURL('wss://relay.onosendai.tech')
const DEAD = normalizeURL('wss://dead.example')
const MIRROR = normalizeURL('wss://cyberspace.nostr1.com')
const ALL = [CANON, DEAD, MIRROR]

function matches(f: Filter, e: (typeof net.chain)[number]): boolean {
  if (f.kinds && !f.kinds.includes(e.kind)) return false
  if (f.authors && !f.authors.includes(e.pubkey)) return false
  if (f.ids && !f.ids.includes(e.id)) return false
  if (f['#A'] && !e.tags.some((t) => t[0] === 'A' && f['#A']!.includes(t[1]))) return false
  if (f['#e'] && !e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1]))) return false
  if (f.since !== undefined && e.created_at < f.since) return false
  if (f.until !== undefined && e.created_at > f.until) return false
  return true
}

function answerOf(url: string, filter: Filter | Filter[]): { url: string; outcome: 'answered' | 'unreachable'; reason?: string; events: typeof net.chain } {
  if (url === DEAD || net.silent) return { url, outcome: 'unreachable', reason: 'no answer in time', events: [] }
  const fs = Array.isArray(filter) ? filter : [filter]
  const paging = fs.some((f) => f.until !== undefined || f.ids)
  if (url === CANON && paging) {
    if (net.pagesLeft <= 0) return { url, outcome: 'unreachable', reason: 'no answer in time', events: [] }
    net.pagesLeft--
  }
  const events = net.chain
    .filter((e) => fs.some((f) => matches(f, e)))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1))
    .slice(0, Math.min(CAP, ...fs.map((f) => f.limit ?? Infinity)))
  return { url, outcome: 'answered', events }
}

vi.mock('../relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay')>()
  type Opts = { only?: string[]; onAnswers?: (a: unknown[]) => void }
  const ask = (filter: Filter | Filter[], opts: Opts = {}): ReturnType<typeof answerOf>[] => {
    const relays = opts.only ?? ALL
    net.asked.push({ relays, filter })
    net.onAsk?.(filter)
    const answers = relays.map((u) => answerOf(u, filter))
    opts.onAnswers?.(answers)
    return answers
  }
  return {
    ...actual,
    signedIn: () => true,
    signInOwed: () => false,
    relaySet: () => [CANON],
    readRelaySet: () => ALL,
    dropRelays: () => {},
    authPending: () => false,
    query: async (f: Filter, opts: Opts = {}) => {
      const seen = new Map<string, unknown>()
      for (const a of ask(f, opts)) for (const e of a.events) seen.set(e.id, e)
      return [...seen.values()]
    },
    queryEach: async (f: Filter, _ms: number, opts: Opts = {}) => ask(f, opts),
    countRelay: async () => net.count,
    subscribe: () => () => {},
    subscribeOne: () => ({ close: () => {} }),
  }
})
vi.mock('../ownWatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ownWatch')>()
  return {
    ...actual,
    startOwnWatch: (pk: string, onEvent: (ev: unknown, url: string) => void, onEose?: () => void) => {
      net.onEvent = onEvent
      return actual.startOwnWatch(pk, () => {}, onEose)
    },
  }
})

import { useCyberspace, whyNoMove, CATCHING_UP_MESSAGE, CATCH_UP_STUCK_MESSAGE } from '../../store/useCyberspace'
import { placeSpawn } from '../../store/fixtures/placeSpawn'
import { actionEvent, hopEvent } from './chainFixtures'
import { buildChain, positionHex, type NostrEvent } from '../events'
import { backlogDeps, backlogSize, backlogWritten, resetBacklog } from '../ownBacklog'
import { pageRelays } from '../chains'
import { chainChipState, catchingUpWords } from '../../hud/ChainExplorer'
import { idsOf, sortIncoming } from '../chainOrphans'

const { startSelfSync, recheckNow, catchUp, selfSyncBusy, CATCH_UP_GAP_MS, CATCH_UP_DEADLINE_MS, STUCK_AFTER } = await import('../selfSync')

const S = () => useCyberspace.getState()
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const settle = async (): Promise<void> => {
  await wait(60)
  for (let i = 0; i < 20; i++) await wait(0)
}
/** Until `done`, or about twenty seconds (the stand-in IndexedDB is slow on a loaded machine). */
async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 2_000 && !done(); i++) await wait(10)
}

/** `n` hops after `from`, one a second, as another device of yours makes them. Unsigned: the stand-in relays check nothing, and nothing here re-checks a fold. */
function hopsAfter(n: number, from: NostrEvent, genesisId: string): NostrEvent[] {
  const out: NostrEvent[] = []
  let prev = from
  for (let i = 0; i < n; i++) {
    prev = hopEvent({ pubkey: from.pubkey, createdAt: prev.created_at + 1, genesisId, previousId: prev.id, c: '0'.repeat(64), to: { x: BigInt(i + 1), y: 0n, z: 0n } })
    // A real id (a row read back is held to it); the signature stays a stand-in.
    prev.id = getEventHash(prev)
    out.push(prev)
  }
  return out
}

/** The last of a stretch signed for real (by this identity's signer), so the head shown early passes its signature check. */
async function signedHop(prev: NostrEvent, genesisId: string, to: { x: bigint; y: bigint; z: bigint }): Promise<NostrEvent> {
  const tmpl = hopEvent({ pubkey: prev.pubkey, createdAt: prev.created_at + 1, genesisId, previousId: prev.id, c: '0'.repeat(64), to })
  return await S().signEvent({ kind: tmpl.kind, created_at: tmpl.created_at, tags: tmpl.tags, content: tmpl.content }) as NostrEvent
}

vi.setConfig({ testTimeout: 90_000 })

let clock = Date.now()
let started = false

/**
 * A fresh chain here: a new spawn and `held` hops after it, all on the
 * relays; the relays hold `behind` more after them, the last signed.
 */
async function tabletBehind(held: number, behind: number): Promise<{ stretch: NostrEvent[]; head: NostrEvent }> {
  await placeSpawn()
  useCyberspace.setState({ selfCheck: { pubkey: S().identity.pubkey, status: 'none' }, chainCatchUp: null, chainConflict: null, held: false })
  await S().respawn()
  const spawn = S().events[0]
  const mine = hopsAfter(held, spawn, spawn.id)
  S().adoptChain(mine)
  useCyberspace.setState({ published: Object.fromEntries(S().events.map((e) => [e.id, 'ok' as const])) })
  const stretch = hopsAfter(behind - 1, S().events[S().events.length - 1], spawn.id)
  const head = await signedHop(stretch[stretch.length - 1] ?? S().events[S().events.length - 1], spawn.id, { x: 777n, y: 0n, z: 0n })
  stretch.push(head)
  net.chain = [...S().events, ...stretch]
  return { stretch, head }
}

beforeEach(() => {
  net.asked.length = 0
  net.pagesLeft = Infinity
  net.silent = false
  net.onAsk = null
  net.count = null
  builds.chain = 0
  builds.divergence = 0
  resetBacklog()
  backlogDeps.rows = () => false
  vi.useFakeTimers({ toFake: ['Date'] })
  clock += CATCH_UP_GAP_MS * 17 + CATCH_UP_DEADLINE_MS * 2
  vi.setSystemTime(clock)
  if (!started) { started = true; startSelfSync() }
})

describe('the live watch handing over a long backlog', () => {
  it('500 moves that do not link cost no whole build of the chain, delivered together or one by one', async () => {
    const { stretch } = await tabletBehind(300, 3_760)
    const headBefore = S().prevEventId
    const newest = stretch.slice(-500)
    builds.chain = 0
    builds.divergence = 0
    S().adoptChain(newest)
    for (const ev of newest) S().adoptChain([ev])
    expect(builds.chain).toBe(0)
    expect(builds.divergence).toBe(0)
    expect(S().prevEventId).toBe(headBefore)
  })

  it('sorting them is a lookup each: the moves that extend the head link, the rest are set aside', () => {
    const inHand = idsOf(S().events)
    const head = S().events[S().events.length - 1]
    const next = hopsAfter(3, head, S().genesisId)
    const far = hopsAfter(5, next[2], S().genesisId).slice(2)
    const sorted = sortIncoming([...far, ...next.slice().reverse()], inHand, S().genesisId)
    expect(sorted.linked.map((e) => e.id)).toEqual(next.map((e) => e.id))
    expect(sorted.orphans.map((e) => e.id).sort()).toEqual(far.map((e) => e.id).sort())
  })
})

describe('catching up a 3,760-move stretch', () => {
  it('completes, pages only from the relays that hold the chain, and adopts the stretch in one go', async () => {
    const { head } = await tabletBehind(300, 3_760)
    net.count = 3_760 + 1
    builds.chain = 0
    recheckNow()
    await until(() => S().prevEventId === head.id)
    expect(S().prevEventId).toBe(head.id)
    expect(S().events).toHaveLength(1 + 300 + 3_760)
    expect(S().chainCatchUp).toBeNull()
    expect(S().chainSync?.status).toBe('done')
    // The first question goes to every read relay; every page after it to the canonical relay alone here:
    // the dead relay never answered, and the old mirror is never paged.
    const pages = net.asked.filter((q) => (Array.isArray(q.filter) ? q.filter : [q.filter]).some((f) => f.until !== undefined || f.ids))
    expect(pages.length).toBeGreaterThanOrEqual(7)
    for (const p of pages) expect(p.relays).toEqual([CANON])
    // Adopted once, not page by page: a handful of whole builds, not thousands.
    expect(builds.chain).toBeLessThan(12)
  })

  it('cut short, keeps every page; the retry goes on from there, and CHAIN NOT CHECKED only once retries bring nothing', async () => {
    const { head } = await tabletBehind(300, 3_760)
    net.pagesLeft = 3
    recheckNow()
    await until(() => (S().chainCatchUp?.got ?? 0) >= 1_900 && net.pagesLeft === 0)
    await settle()
    // Cut short: nothing adopted, the head still ours, and progress said, not CHAIN NOT CHECKED.
    expect(S().events).toHaveLength(301)
    expect(S().chainCatchUp?.stuck).toBe(false)
    const kept = backlogSize(S().identity.pubkey)
    // The newest page and three more, less the events two pages share at their boundary second.
    expect(kept).toBeGreaterThanOrEqual(1_900)
    expect(chainChipState(S())).toMatch(/^catching:/)
    expect(whyNoMove(S().actions())).toBe(CATCHING_UP_MESSAGE)
    // Retries that bring nothing: still CATCHING UP until STUCK_AFTER of them, then CHAIN NOT CHECKED.
    for (let i = 0; i < STUCK_AFTER; i++) {
      recheckNow()
      await settle()
    }
    expect(S().chainCatchUp?.stuck).toBe(true)
    expect(chainChipState(S())).toBe('unchecked')
    expect(whyNoMove(S().actions())).toBe(CATCH_UP_STUCK_MESSAGE)
    // The relay answers again: the next attempt asks only for what is still missing, and lands.
    net.pagesLeft = Infinity
    const before = net.asked.length
    recheckNow()
    await until(() => S().prevEventId === head.id)
    expect(S().prevEventId).toBe(head.id)
    expect(S().chainCatchUp).toBeNull()
    const pagesAfter = net.asked.slice(before).filter((q) => (Array.isArray(q.filter) ? q.filter : [q.filter]).some((f) => f.until !== undefined))
    expect(pagesAfter.length).toBeLessThanOrEqual(4)
  })

  it('resumes after a reload from the rows kept in the event database', async () => {
    backlogDeps.rows = () => true
    const { head } = await tabletBehind(300, 3_760)
    net.pagesLeft = 3
    recheckNow()
    await until(() => net.pagesLeft === 0 && !selfSyncBusy())
    // Offline, so no retry starts while the page "reloads".
    const nav = globalThis.navigator as { onLine?: boolean }
    Object.defineProperty(nav, 'onLine', { value: false, configurable: true })
    try {
      await until(() => !selfSyncBusy())
      await backlogWritten()
      const kept = backlogSize(S().identity.pubkey)
      expect(kept).toBeGreaterThanOrEqual(1_900)
      const { callEventDb } = await import('../eventDb/client')
      const rows = await callEventDb('seenSince', [S().identity.pubkey, 3333, 0, 20_000])
      expect(rows.length).toBeGreaterThanOrEqual(kept)
      // A reload: this page's memory is gone; the rows are not.
      resetBacklog()
      expect(backlogSize(S().identity.pubkey)).toBe(0)
    } finally {
      Object.defineProperty(nav, 'onLine', { value: true, configurable: true })
    }
    net.pagesLeft = Infinity
    const before = net.asked.length
    recheckNow()
    await until(() => S().prevEventId === head.id)
    expect(S().prevEventId).toBe(head.id)
    expect(S().events).toHaveLength(1 + 300 + 3_760)
    const pagesAfter = net.asked.slice(before).filter((q) => (Array.isArray(q.filter) ? q.filter : [q.filter]).some((f) => f.until !== undefined))
    expect(pagesAfter.length).toBeLessThanOrEqual(4)
  })

  it('one deadline over the whole attempt: past it no more pages are asked, and a retry follows on its own', async () => {
    const { head } = await tabletBehind(300, 3_760)
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    let pages = 0
    net.onAsk = (f) => {
      const fs = Array.isArray(f) ? f : [f]
      if (fs.some((x) => x.until !== undefined) && ++pages === 2) vi.setSystemTime(Date.now() + CATCH_UP_DEADLINE_MS + 1)
    }
    recheckNow()
    for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(0)
    expect(pages).toBe(2)
    expect(S().prevEventId).not.toBe(head.id)
    expect(S().chainCatchUp?.stuck).toBe(false)
    net.onAsk = null
    // The retry, on its own after the backoff's first wait.
    await vi.advanceTimersByTimeAsync(2_100)
    for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(10)
    vi.useFakeTimers({ toFake: ['Date'] })
    await until(() => S().prevEventId === head.id)
    expect(S().prevEventId).toBe(head.id)
  })

  it('says CATCHING UP got / total from one count of the canonical relay', async () => {
    await tabletBehind(10, 1_200)
    net.count = 1_200 + 1
    net.pagesLeft = 0
    recheckNow()
    await until(() => S().chainCatchUp?.total != null)
    expect(S().chainCatchUp?.total).toBe(1_200)
    expect(catchingUpWords(chainChipState(S()))).toBe(`${S().chainCatchUp!.got.toLocaleString('en-US')} / 1,200`)
  })
})

describe('your position at once', () => {
  it('the newest live move shows you there with CATCHING UP, and no move is signed until the stretch is in', async () => {
    const { stretch, head } = await tabletBehind(50, 1_500)
    useCyberspace.setState({ chainSync: { pubkey: S().identity.pubkey, status: 'done' } })
    // The relay is slow to page: the stretch is not in yet when the live move arrives.
    net.pagesLeft = 0
    net.onEvent!(head, CANON)
    for (const ev of stretch.slice(-20, -1)) net.onEvent!(ev, CANON)
    await settle()
    expect(S().chainCatchUp?.headId).toBe(head.id)
    expect(positionHex(S().position, S().plane)).toBe(head.tags.find((t) => t[0] === 'C')![1])
    // The chain in hand is not touched: its head is still this device's.
    expect(S().prevEventId).not.toBe(head.id)
    expect(chainChipState(S())).toMatch(/^catching:/)
    expect(whyNoMove(S().actions())).toBe(CATCHING_UP_MESSAGE)
    expect(await S().confirmHeadNow()).toBe(CATCHING_UP_MESSAGE)
    // The relay pages again: the stretch lands whole, and moves are signed again.
    net.pagesLeft = Infinity
    clock += CATCH_UP_GAP_MS * 17
    vi.setSystemTime(clock)
    const before = net.asked.length
    catchUp('resume')
    await until(() => S().prevEventId === head.id)
    expect(net.asked.length).toBeGreaterThan(before)
    expect(S().prevEventId).toBe(head.id)
    expect(S().chainCatchUp).toBeNull()
    // (These stand-in hops break the chain's rules, which is what refuses a move now; the catch-up no longer does.)
    expect(whyNoMove(S().actions())).not.toBe(CATCHING_UP_MESSAGE)
  })

  it('a move of another chain, or one with a forged signature, is never shown', async () => {
    await tabletBehind(5, 3)
    const where = { ...S().position }
    const other = hopEvent({ pubkey: S().identity.pubkey, createdAt: Math.floor(Date.now() / 1000) + 99, genesisId: 'ff'.repeat(32), previousId: 'ee'.repeat(32), c: '0'.repeat(64), to: { x: 5n, y: 5n, z: 5n } })
    expect(S().showCatchUpHead(other)).toBe(false)
    const forged = hopEvent({ pubkey: S().identity.pubkey, createdAt: Math.floor(Date.now() / 1000) + 99, genesisId: S().genesisId, previousId: 'ee'.repeat(32), c: '0'.repeat(64), to: { x: 5n, y: 5n, z: 5n } })
    expect(S().showCatchUpHead(forged)).toBe(false)
    expect(S().position).toEqual(where)
  })
})

describe('the hold on moves goes up only for a stretch, and comes down only when it is in (review of #955)', () => {
  /** Questions that were not pages: one per catch-up or self-check attempt, give or take the spawns. */
  const firstQuestions = (): number => net.asked.filter((q) => !(Array.isArray(q.filter) ? q.filter : [q.filter]).some((f) => f.until !== undefined || f.ids)).length

  it('a focus catch-up that brings 3 moves leaves nothing kept, and the next focus raises no hold (rows on, as on Android)', async () => {
    backlogDeps.rows = () => true
    const { head } = await tabletBehind(20, 3)
    useCyberspace.setState({ chainSync: { pubkey: S().identity.pubkey, status: 'done' } })
    catchUp('focus')
    await until(() => S().prevEventId === head.id)
    expect(S().prevEventId).toBe(head.id)
    await backlogWritten()
    await settle()
    expect(backlogSize(S().identity.pubkey)).toBe(0)
    expect(S().chainCatchUp).toBeNull()
    // The next focus: nothing is behind, so no CATCHING UP and no hold.
    for (let i = 0; i < 3; i++) {
      clock += CATCH_UP_GAP_MS * 17
      vi.setSystemTime(clock)
      const before = net.asked.length
      catchUp('focus')
      await until(() => net.asked.length > before && !selfSyncBusy())
      await settle()
      expect(S().chainCatchUp).toBeNull()
      expect(whyNoMove(S().actions())).not.toBe(CATCHING_UP_MESSAGE)
    }
  })

  it('every relay silent is not "caught up": the hold and the head shown stay, and a retry lands the stretch', async () => {
    const { stretch, head } = await tabletBehind(50, 1_500)
    useCyberspace.setState({ chainSync: { pubkey: S().identity.pubkey, status: 'done' } })
    net.silent = true
    net.onEvent!(head, CANON)
    for (const ev of stretch.slice(-20, -1)) net.onEvent!(ev, CANON)
    await settle()
    await until(() => !selfSyncBusy() && firstQuestions() > 0)
    await settle()
    expect(S().chainCatchUp?.headId).toBe(head.id)
    expect(positionHex(S().position, S().plane)).toBe(head.tags.find((t) => t[0] === 'C')![1])
    expect(whyNoMove(S().actions())).toBe(CATCHING_UP_MESSAGE)
    // The relays answer again: the retry, on its own after its wait, lands it.
    net.silent = false
    await until(() => S().prevEventId === head.id)
    expect(S().prevEventId).toBe(head.id)
    expect(S().chainCatchUp).toBeNull()
  })

  it('retries stop at CHAIN NOT CHECKED, and the tab shown again asks once more', async () => {
    const { stretch, head } = await tabletBehind(50, 1_500)
    useCyberspace.setState({ chainSync: { pubkey: S().identity.pubkey, status: 'done' } })
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    const run = async (ms: number): Promise<void> => { for (let t = 0; t < ms; t += 500) await vi.advanceTimersByTimeAsync(500) }
    try {
      net.silent = true
      net.onEvent!(head, CANON)
      for (const ev of stretch.slice(-5, -1)) net.onEvent!(ev, CANON)
      await run(1_000)
      // Through every wait of the backoff, until CHAIN NOT CHECKED.
      await run(2 * 60_000)
      expect(S().chainCatchUp?.stuck).toBe(true)
      expect(chainChipState(S())).toBe('unchecked')
      const asked = net.asked.length
      // An hour on its own asks nothing more.
      await run(60 * 60_000)
      expect(net.asked.length).toBe(asked)
      // The tab shown again (focus) asks once more, and with the relays back it lands.
      net.silent = false
      catchUp('focus')
      await run(2_000)
      expect(net.asked.length).toBeGreaterThan(asked)
      expect(S().prevEventId).toBe(head.id)
      expect(S().chainCatchUp).toBeNull()
    } finally {
      vi.useFakeTimers({ toFake: ['Date'] })
    }
  })
})

describe('what stays as it was for everyone else', () => {
  it('another chain read (a neighbor, a spectated chain, the look before publishing) pages from every read relay, as before', async () => {
    await tabletBehind(10, 1_200)
    const { fetchChainEvents } = await import('../chains')
    const before = net.asked.length
    await fetchChainEvents(S().identity.pubkey, S().genesisId, [])
    const pages = net.asked.slice(before).filter((q) => (Array.isArray(q.filter) ? q.filter : [q.filter]).some((f) => f.until !== undefined))
    expect(pages.length).toBeGreaterThan(0)
    for (const p of pages) expect(p.relays).toEqual(ALL)
  })

  it('rows read back are only those whose signature was checked', async () => {
    const { callEventDb } = await import('../eventDb/client')
    const pk = 'cd'.repeat(32)
    const base = actionEvent({ pubkey: pk, createdAt: 5_000, genesisId: 'aa'.repeat(32), previousId: 'bb'.repeat(32), name: 'hop' })
    const signedOne = { ...base, id: getEventHash(base) }
    const other = { ...base, created_at: 5_001 }
    const unsignedOne = { ...other, id: getEventHash(other) }
    await callEventDb('ingest', ['t', [{ event: signedOne, nip01: 1, pin: true, relay: CANON }, { event: unsignedOne, nip01: 2, pin: true, relay: CANON }]])
    const back = await callEventDb('seenSince', [pk, 3333, 0, 10])
    expect(back.map((e) => e.id)).toEqual([signedOne.id])
  })
})

describe('what must not change', () => {
  it('one move on the phone: the tablet takes it at once, with no fetch and no CATCHING UP', async () => {
    await tabletBehind(20, 1)
    net.chain = [...S().events]
    const [move] = hopsAfter(1, S().events[S().events.length - 1], S().genesisId)
    net.chain.push(move)
    const asked = net.asked.length
    net.onEvent!(move, CANON)
    await settle()
    expect(S().prevEventId).toBe(move.id)
    expect(net.asked.length).toBe(asked)
    expect(S().chainCatchUp).toBeNull()
  })

  it('unpublished moves forking against a stretch the relays hold still raise the diverged-branch choice', async () => {
    await tabletBehind(20, 1)
    const base = S().events[S().events.length - 1]
    const [mineHere] = hopsAfter(1, base, S().genesisId)
    S().adoptChain([mineHere])
    useCyberspace.setState({ published: { ...S().published, [mineHere.id]: 'queued' as const } })
    // Theirs: a move from the same point, then a long run after it, delivered with orphans around it.
    const fork = hopEvent({ pubkey: base.pubkey, createdAt: base.created_at + 2, genesisId: S().genesisId, previousId: base.id, c: '0'.repeat(64), to: { x: 1_000n, y: 0n, z: 0n } })
    fork.id = getEventHash(fork)
    const theirs = [fork, ...hopsAfter(29, fork, S().genesisId)]
    expect(theirs[0].id).not.toBe(mineHere.id)
    S().adoptChain([...theirs.slice(10), theirs[0]])
    expect(S().chainConflict?.kind).toBe('branch')
    expect(S().prevEventId).toBe(mineHere.id)
    useCyberspace.setState({ chainConflict: null })
  })

  it('two published moves from one point still read as a fork: the chain is dead', async () => {
    await tabletBehind(20, 1)
    const base = S().events[S().events.length - 1]
    const a = hopsAfter(1, base, S().genesisId)[0]
    const b = actionEvent({ pubkey: base.pubkey, createdAt: base.created_at + 1, genesisId: S().genesisId, previousId: base.id, name: 'hop', C: { x: 9n, y: 9n, z: 9n } })
    S().adoptChain([a, b, ...hopsAfter(5, a, S().genesisId).slice(2)])
    expect(buildChain(S().events)[0].fork).toBeDefined()
  })
})

describe('the relays a page is asked of', () => {
  it('the canonical relay and the holders that answered, never a dead one or the old mirror', () => {
    const pk = S().identity.pubkey
    const first = [
      { url: CANON, outcome: 'answered' as const, events: [] },
      { url: DEAD, outcome: 'unreachable' as const, reason: 'no answer in time', events: [] },
      { url: MIRROR, outcome: 'answered' as const, events: S().events.slice(-3) },
      { url: 'wss://holder.example/', outcome: 'answered' as const, events: S().events.slice(-3) },
    ]
    expect(pageRelays(pk, first).sort()).toEqual([CANON, normalizeURL('wss://holder.example/')].sort())
    expect(pageRelays(pk, [{ url: DEAD, outcome: 'unreachable', reason: 'x', events: [] }])).toEqual([CANON])
  })
})
