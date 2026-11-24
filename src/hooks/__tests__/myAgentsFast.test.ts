/**
 * myAgentsFast.test.ts: MY AGENTS is never empty for minutes (the owner,
 * 2026-11-24: "lately my agents panel has been empty... and minutes later
 * XOR will show up").
 *
 * - A known agent shows at once from the list kept on the device (IndexedDB,
 *   per pubkey), before any relay answers.
 * - The canonical relay answering is enough to draw the rows: a slow relay
 *   holds nobody.
 * - Only the canonical relay's answer takes an agent off the list.
 * - "None" waits for every relay, and the follow list never waits on a
 *   sign-in without limit.
 */
import 'fake-indexeddb/auto'
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

const CANON = 'wss://relay.onosendai.tech'
const SLOW = 'wss://relay.damus.io'

interface Pending { url: string; filter: Record<string, unknown>; onEvent: (ev: never) => void; resolve: (outcome: 'answered' | 'unreachable') => void }
/** Every question asked, still open until the test answers it. */
const asked: Pending[] = []

vi.mock('../../lib/relay', () => ({
  CYBERSPACE_RELAY: 'wss://relay.onosendai.tech',
  relaySet: () => ['wss://relay.onosendai.tech'],
  askRelay: vi.fn((url: string, filter: Record<string, unknown>, onEvent: (ev: never) => void) => new Promise((resolve) => {
    asked.push({ url, filter, onEvent, resolve: (outcome) => resolve(outcome === 'answered' ? { url, outcome, events: [] } : { url, outcome, reason: 'no answer in time', events: [] }) })
  })),
}))

vi.mock('../../store/useProfiles', () => {
  const profiles = new Map<string, { at: number }>()
  return { useProfiles: { getState: () => ({ get: (pk: string) => profiles.get(pk), remember: () => undefined }) } }
})

import { flushCachedNow, writeCached } from '../../lib/deviceCache'
import { RETRY_MS, myAgentsCacheKey, useMyAgents, useMyAgentsAnswer } from '../useMyAgents'

const ME = 'e'.repeat(64)
const XOR = 'd'.repeat(64)
const OTHER = 'a'.repeat(64)

/** A bot profile naming ME as operator. */
const profile = (pk: string, at = 100): never => ({
  id: pk.slice(0, 2).repeat(32), pubkey: pk, kind: 0, created_at: at, sig: '0'.repeat(128),
  content: JSON.stringify({ bot: true, name: 'agent' }), tags: [['p', ME, '', 'operator']],
}) as never
const contacts = (follows: string[], at = 50): never => ({
  id: 'f'.repeat(64), pubkey: ME, kind: 3, created_at: at, sig: '0'.repeat(128), content: '',
  tags: follows.map((pk) => ['p', pk]),
}) as never

const questions = (url: string, kind: number): Pending[] => asked.filter((q) => q.url === url && (q.filter.kinds as number[])[0] === kind)
const answerAll = (kind: number, outcome: 'answered' | 'unreachable', except: string[] = []): void => {
  for (const q of asked.filter((x) => (x.filter.kinds as number[])[0] === kind && !except.includes(x.url))) q.resolve(outcome)
}

/** Start an ask for ME the way the hook does on mount. */
function start(): void {
  // useMyAgents(me) asks from an effect (stubbed here); the refresh it returns asks the same way, outside React.
  useMyAgentsAnswer.setState({ me: '', agents: [], status: 'loading' })
  useMyAgents(ME).refresh()
}

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => undefined,
}))
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const h = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(h.getState()), h)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

beforeEach(async () => {
  asked.length = 0
  // Each case starts with nothing kept: a write still queued from the last case goes first, then is cleared.
  flushCachedNow()
  await new Promise((r) => setTimeout(r, 20))
  await writeCached(myAgentsCacheKey(ME), null)
})
afterEach(() => { vi.useRealTimers() })

describe('MY AGENTS, fast', () => {
  it('a known agent shows at once from the device, before any relay answers', async () => {
    await writeCached(myAgentsCacheKey(ME), { agents: [XOR], at: 1 })
    start()
    await vi.waitFor(() => { expect(useMyAgentsAnswer.getState()).toMatchObject({ me: ME, agents: [XOR], status: 'ready' }) })
    // Nothing has answered yet.
    expect(asked.length).toBeGreaterThan(0)
    answerAll(0, 'answered'); answerAll(3, 'answered')
  })

  it('the canonical relay answering draws the rows; a slow relay holds nobody', async () => {
    start()
    expect(useMyAgentsAnswer.getState().status).toBe('loading')
    // The canonical relay sends XOR's profile and answers; a general relay sends my follow list.
    for (const q of questions(CANON, 0)) { q.onEvent(profile(XOR)); q.resolve('answered') }
    for (const q of asked.filter((x) => (x.filter.kinds as number[])[0] === 3 && x.url !== SLOW)) { q.onEvent(contacts([XOR])); q.resolve('answered') }
    await vi.waitFor(() => { expect(useMyAgentsAnswer.getState()).toMatchObject({ agents: [XOR], status: 'ready' }) })
    // SLOW has not answered either question: still on screen, nothing waited for it.
    expect(questions(SLOW, 0)).toHaveLength(1)
    answerAll(0, 'unreachable'); answerAll(3, 'unreachable')
  })

  it('every relay is asked on its own (askRelay), the follow list included: no list read that waits on a sign-in without limit', () => {
    start()
    const kinds = asked.map((q) => (q.filter.kinds as number[])[0])
    expect(kinds).toContain(0)
    expect(kinds).toContain(3)
    expect(questions(CANON, 0)).toHaveLength(1)
    answerAll(0, 'answered'); answerAll(3, 'answered')
  })

  it('"none" waits for every relay to answer or give up', async () => {
    start()
    for (const q of questions(CANON, 0)) q.resolve('answered')
    for (const q of asked.filter((x) => (x.filter.kinds as number[])[0] === 3)) { q.onEvent(contacts([])); q.resolve('answered') }
    await new Promise((r) => setTimeout(r, 20))
    expect(useMyAgentsAnswer.getState().status).toBe('loading')
    answerAll(0, 'answered')
    await vi.waitFor(() => { expect(useMyAgentsAnswer.getState()).toMatchObject({ agents: [], status: 'ready' }) })
  })

  it('without the canonical relay, a kept agent stays, and the canonical relay is asked again', async () => {
    await writeCached(myAgentsCacheKey(ME), { agents: [XOR], at: 1 })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    start()
    await vi.waitFor(() => { expect(useMyAgentsAnswer.getState().agents).toEqual([XOR]) })
    // The general relays answer with nothing; the canonical relay does not answer.
    answerAll(0, 'answered', [CANON]); answerAll(3, 'answered')
    for (const q of questions(CANON, 0)) q.resolve('unreachable')
    await new Promise((r) => setTimeout(r, 20))
    expect(useMyAgentsAnswer.getState()).toMatchObject({ agents: [XOR], status: 'ready' })
    const before = questions(CANON, 0).length
    vi.advanceTimersByTime(RETRY_MS + 10)
    expect(questions(CANON, 0).length).toBe(before + 1)
    answerAll(0, 'answered'); answerAll(3, 'answered')
  })

  it('a relay that answers with no follow list of mine never wipes the kept list', async () => {
    await writeCached(myAgentsCacheKey(ME), { agents: [XOR], at: 1 })
    start()
    await vi.waitFor(() => { expect(useMyAgentsAnswer.getState().agents).toEqual([XOR]) })
    // The canonical relay answers the profiles; every relay answers the follow list with nothing.
    answerAll(0, 'answered'); answerAll(3, 'answered')
    await new Promise((r) => setTimeout(r, 30))
    expect(useMyAgentsAnswer.getState()).toMatchObject({ agents: [XOR], status: 'ready' })
  })

  it('the rows keep the kept order while answers land', async () => {
    await writeCached(myAgentsCacheKey(ME), { agents: [XOR, OTHER], at: 1 })
    start()
    await vi.waitFor(() => { expect(useMyAgentsAnswer.getState().agents).toEqual([XOR, OTHER]) })
    // OTHER's profile lands first, and is the newer one.
    for (const q of asked.filter((x) => (x.filter.kinds as number[])[0] === 3)) q.onEvent(contacts([XOR, OTHER]))
    for (const q of questions(CANON, 0)) q.onEvent(profile(OTHER, 200))
    expect(useMyAgentsAnswer.getState().agents).toEqual([XOR, OTHER])
    for (const q of questions(CANON, 0)) q.onEvent(profile(XOR, 100))
    expect(useMyAgentsAnswer.getState().agents).toEqual([XOR, OTHER])
    answerAll(0, 'answered'); answerAll(3, 'answered')
    // The final list, once sure, is newest profile first.
    await vi.waitFor(() => { expect(useMyAgentsAnswer.getState().agents).toEqual([OTHER, XOR]) })
  })

  it('the canonical relay\'s answer takes an unfollowed agent off, and the device keeps the new list', async () => {
    await writeCached(myAgentsCacheKey(ME), { agents: [XOR, OTHER], at: 1 })
    start()
    await vi.waitFor(() => { expect(useMyAgentsAnswer.getState().agents).toEqual([XOR, OTHER]) })
    for (const q of questions(CANON, 0)) { q.onEvent(profile(XOR)); q.onEvent(profile(OTHER, 90)) }
    for (const q of asked.filter((x) => (x.filter.kinds as number[])[0] === 3)) q.onEvent(contacts([XOR]))
    answerAll(0, 'answered'); answerAll(3, 'answered')
    await vi.waitFor(() => { expect(useMyAgentsAnswer.getState()).toMatchObject({ agents: [XOR], status: 'ready' }) })
    flushCachedNow()
    const { readCached } = await import('../../lib/deviceCache')
    await vi.waitFor(async () => { expect(await readCached(myAgentsCacheKey(ME))).toMatchObject({ agents: [XOR] }) })
  })
})
