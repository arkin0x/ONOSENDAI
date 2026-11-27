/**
 * ownCatchUpCost.test.ts - what catching up costs on a chain the size of the
 * owner's (11,292 events on 2026-11-27, 3,760 of them made on the phone that
 * day), measured on a synthetic chain of the same shape, so the cost is seen
 * to stay bounded rather than grow with the backlog.
 *
 * | Measured | Before (per the diagnosis of 2026-11-27) | Now |
 * |---|---|---|
 * | one live move that does not link | two whole builds (findDivergence, buildChain): about 197 ms on a server | a lookup: no build |
 * | the watch's backlog | 500 such moves, about 99 s on a server, minutes on a tablet | at most SINCE_LIMIT + 1 moves, folded together, no build |
 * | the stretch itself | pages until a 60-question cap, kept only when whole | 8 or 9 pages, kept as they land, adopted in one fold |
 *
 * The numbers are printed ([catch-up cost]); the assertions are bounds a
 * slow CI machine still meets.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'
import { normalizeURL } from 'nostr-tools/utils'
import { getEventHash } from 'nostr-tools/pure'

const builds = vi.hoisted(() => ({ chain: 0 }))
vi.mock('../events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../events')>()
  return { ...actual, buildChain: vi.fn((...a: Parameters<typeof actual.buildChain>) => { builds.chain++; return actual.buildChain(...a) }) }
})

const CAP = 500
const CANON = normalizeURL('wss://relay.onosendai.tech')
const net = vi.hoisted(() => ({ chain: [] as Array<{ id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }>, pages: 0, questions: 0 }))
function answer(filter: Filter | Filter[]): typeof net.chain {
  const fs = Array.isArray(filter) ? filter : [filter]
  net.questions++
  if (fs.some((f) => f.until !== undefined || f.ids)) net.pages++
  const ok = (f: Filter, e: (typeof net.chain)[number]): boolean =>
    (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.ids || f.ids.includes(e.id))
    && (!f['#A'] || e.tags.some((t) => t[0] === 'A' && f['#A']!.includes(t[1])))
    && (!f['#e'] || e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1])))
    && (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until)
  return net.chain.filter((e) => fs.some((f) => ok(f, e))).sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1)).slice(0, CAP)
}
vi.mock('../relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay')>()
  type Opts = { only?: string[]; onAnswers?: (a: unknown[]) => void }
  const ask = (f: Filter | Filter[], opts: Opts = {}) => {
    const answers = (opts.only ?? [CANON]).map((url) => ({ url, outcome: 'answered' as const, events: answer(f) }))
    opts.onAnswers?.(answers)
    return answers
  }
  return {
    ...actual,
    signedIn: () => true,
    signInOwed: () => false,
    relaySet: () => [CANON],
    readRelaySet: () => [CANON],
    dropRelays: () => {},
    query: async (f: Filter, opts: Opts = {}) => ask(f, opts).flatMap((a) => a.events),
    queryEach: async (f: Filter, _ms: number, opts: Opts = {}) => ask(f, opts),
    countRelay: async () => null,
    subscribe: () => () => {},
    subscribeOne: () => ({ close: () => {} }),
  }
})

import { useCyberspace } from '../../store/useCyberspace'
import { placeSpawn } from '../../store/fixtures/placeSpawn'
import { hopEvent } from './chainFixtures'
import { buildChain, type NostrEvent } from '../events'
import { findDivergence } from '../branchConflict'
import { idsOf, sortIncoming } from '../chainOrphans'
import { resetBacklog } from '../ownBacklog'

const { recheckNow } = await import('../selfSync')
const S = () => useCyberspace.getState()
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const TOTAL = 11_292
const BEHIND = 3_760

function hopsAfter(n: number, from: NostrEvent, genesisId: string): NostrEvent[] {
  const out: NostrEvent[] = []
  let prev = from
  for (let i = 0; i < n; i++) {
    prev = hopEvent({ pubkey: from.pubkey, createdAt: prev.created_at + 1, genesisId, previousId: prev.id, c: '0'.repeat(64), to: { x: BigInt(i + 1), y: 0n, z: 0n } })
    prev.id = getEventHash(prev)
    out.push(prev)
  }
  return out
}

describe('catching up 3,760 moves on an 11,292-event chain', () => {
  it('costs a bounded number of builds and pages, whatever the backlog', async () => {
    resetBacklog()
    await placeSpawn()
    const spawn = S().events[0]
    const all = hopsAfter(TOTAL - 1, spawn, spawn.id)
    const held = all.slice(0, TOTAL - 1 - BEHIND)
    S().adoptChain(held)
    useCyberspace.setState({ published: Object.fromEntries(S().events.map((e) => [e.id, 'ok' as const])) })
    net.chain = [spawn, ...all]
    const stretch = all.slice(held.length)
    expect(stretch).toHaveLength(BEHIND)

    // Before: one non-linking live move, as the old fold did it (two whole builds).
    const live = stretch.slice(-500)
    const published = S().published
    let t = performance.now()
    for (const ev of live.slice(0, 10)) {
      findDivergence(S().events, published, [ev])
      buildChain(S().events.concat([ev]))
    }
    const beforeEach = (performance.now() - t) / 10

    // Now: the store folds all 500, together and one by one.
    builds.chain = 0
    t = performance.now()
    S().adoptChain(live)
    for (const ev of live) S().adoptChain([ev])
    const nowAll = performance.now() - t
    expect(builds.chain).toBe(0)
    t = performance.now()
    const sorted = sortIncoming(live, idsOf(S().events), S().genesisId)
    const sortMs = performance.now() - t
    expect(sorted.orphans).toHaveLength(500)

    // The catch-up: pages, whole builds, and time.
    builds.chain = 0
    net.pages = 0
    net.questions = 0
    t = performance.now()
    recheckNow()
    for (let i = 0; i < 3_000 && S().events.length < TOTAL; i++) await wait(5)
    const catchMs = performance.now() - t
    expect(S().events).toHaveLength(TOTAL)
    expect(S().prevEventId).toBe(all[all.length - 1].id)
    // 3,760 / 500 is 8 pages, one more for the events two pages share at their boundary.
    expect(net.pages).toBeLessThanOrEqual(Math.ceil(BEHIND / (CAP - 1)) + 1)
    expect(builds.chain).toBeLessThan(12)

    console.info(`[catch-up cost] one non-linking live move before: ${beforeEach.toFixed(1)} ms (500 of them: ${(beforeEach * 500 / 1000).toFixed(1)} s); now all 500, twice over: ${nowAll.toFixed(1)} ms, no build; sorting them: ${sortMs.toFixed(2)} ms`)
    console.info(`[catch-up cost] the 3,760-move catch-up: ${net.questions} questions, ${net.pages} pages, ${builds.chain} whole builds, ${Math.round(catchMs)} ms here (stand-in relays, no network)`)
    // Every one of the 500 folds now costs less than one old fold did.
    expect(nowAll).toBeLessThan(beforeEach * 500)
  }, 120_000)
})
