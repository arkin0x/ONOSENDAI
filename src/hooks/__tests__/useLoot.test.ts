import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const events: Array<Record<string, unknown>> = []
let queryCalls = 0
let subscribeCalls = 0
let closed = 0
/** How the canonical relay answers the next backfills: null is an answer, else why it did not. */
let trouble: 'auth' | 'unreachable' | null = null
/** What the list registered to hear: the relay signing this visit in, and the connection coming back. */
const heard: { signIn: Array<() => void>; resume: Array<() => void> } = { signIn: [], resume: [] }

vi.mock('../../lib/relay', () => ({
  // What a merged read gives for the same answers: a refusal is an empty list (how v2 read it).
  query: vi.fn(async () => { queryCalls++; return trouble ? [] : [...events] }),
  queryChecked: vi.fn(async () => { queryCalls++; return trouble ? { events: [], trouble } : { events: [...events], trouble: null } }),
  subscribe: vi.fn(() => { subscribeCalls++; return () => { closed++ } }),
  onCanonicalSignIn: vi.fn((fn: () => void) => { heard.signIn.push(fn); return () => {} }),
  onResume: vi.fn((fn: () => void) => { heard.resume.push(fn); return () => {} }),
}))

vi.mock('../../lib/loot', async () => {
  const actual = await vi.importActual<typeof import('../../lib/loot')>('../../lib/loot')
  return { ...actual, summarizeBag: (ev: { id: string }) => ({ key: ev.id, bagId: ev.id, at: 1, bytes: 10 } as never) }
})

import { ensureLoot, refreshLoot, useLootStore } from '../useLoot'

beforeEach(() => { trouble = null })

describe('the loot list outlives the panel', () => {
  beforeEach(() => {
    events.length = 0
    queryCalls = 0; subscribeCalls = 0; closed = 0
    useLootStore.setState({ items: [], status: 'loading', source: '', trouble: null })
  })

  it('reads the relay once for a relay set, however often the panel opens', async () => {
    events.push({ id: 'a' }, { id: 'b' })
    ensureLoot(['wss://one'])
    await vi.waitFor(() => { expect(useLootStore.getState().status).toBe('ready') })
    expect(useLootStore.getState().items).toHaveLength(2)

    // The panel closing and opening again asks, and is answered from memory.
    ensureLoot(['wss://one'])
    ensureLoot(['wss://one'])
    expect(queryCalls).toBe(1)
    expect(subscribeCalls).toBe(1)
    expect(useLootStore.getState().items).toHaveLength(2)
  })

  it('a new relay set is read again, without emptying the list first', async () => {
    events.push({ id: 'a' })
    ensureLoot(['wss://one'])
    await vi.waitFor(() => { expect(useLootStore.getState().status).toBe('ready') })

    events.push({ id: 'c' })
    ensureLoot(['wss://one', 'wss://two'])
    // Still showing what it had, and not back to LOADING.
    expect(useLootStore.getState().status).toBe('ready')
    expect(useLootStore.getState().items.length).toBeGreaterThan(0)
    // At least this run's own subscription; the previous test's closer is
    // module state and may be flushed here too.
    expect(closed).toBeGreaterThanOrEqual(1)
    await vi.waitFor(() => { expect(useLootStore.getState().items).toHaveLength(2) })
    expect(queryCalls).toBe(2)
  })

  it('loads with nothing to show only when there is nothing to show', async () => {
    ensureLoot(['wss://one'])
    expect(useLootStore.getState().status).toBe('loading')
    await vi.waitFor(() => { expect(useLootStore.getState().status).toBe('ready') })
  })
})

describe('the list survives a reload', () => {
  it('writes what it learns, so the next visit opens with rows', async () => {
    events.push({ id: 'a' }, { id: 'b' })
    useLootStore.setState({ items: [], status: 'loading', source: '' })
    ensureLoot(['wss://one'])
    await vi.waitFor(() => { expect(useLootStore.getState().status).toBe('ready') })

    const kept = JSON.parse(localStorage.getItem('onosendai:loot') ?? '[]')
    expect(kept).toHaveLength(2)
  })

  it('a list already on screen is not a loading state', () => {
    // What the store looks like when it was built from a cache.
    useLootStore.setState({ items: [{ key: 'a' } as never], status: 'ready', source: '' })
    expect(useLootStore.getState().status).toBe('ready')
  })
})

/**
 * The owner's phone, 2026-11-04: the canonical relay gates reads on NIP-42
 * AUTH, his bunker could not sign it, and the relay's refusal read as an
 * empty answer: "0 HIDDEN, Nothing hidden on the relay yet" with 105 bags
 * there, the rows and their cache replaced by nothing, and no later read.
 */
describe('a read the canonical relay did not answer is not "nothing"', () => {
  beforeEach(() => {
    events.length = 0
    queryCalls = 0
    localStorage.clear()
    useLootStore.setState({ items: [], status: 'loading', source: '', trouble: null })
  })

  it('says the relay refused, instead of a ready, empty list', async () => {
    events.push({ id: 'a' })
    trouble = 'auth'
    ensureLoot(['wss://refused'])
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe('auth') })
    // Not 'ready': the panel shows the notice, never "Nothing hidden on the relay yet".
    expect(useLootStore.getState().status).toBe('error')
    expect(useLootStore.getState().items).toEqual([])
  })

  it('keeps the rows on screen, and their cache, when the relay refuses', async () => {
    const rows = [{ key: 'a', bagId: 'a' }, { key: 'b', bagId: 'b' }] as never[]
    localStorage.setItem('onosendai:loot', JSON.stringify(rows))
    useLootStore.setState({ items: rows, status: 'ready', source: '', trouble: null })
    trouble = 'auth'
    ensureLoot(['wss://refused-with-rows'])
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe('auth') })
    expect(useLootStore.getState().items).toHaveLength(2)
    expect(useLootStore.getState().status).toBe('ready')
    expect(JSON.parse(localStorage.getItem('onosendai:loot') ?? '[]')).toHaveLength(2)
  })

  it('an unreachable relay is said too, not read as nothing', async () => {
    trouble = 'unreachable'
    ensureLoot(['wss://down'])
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe('unreachable') })
    expect(useLootStore.getState().status).toBe('error')
  })

  it('reads again once the relay signs this visit in, and the list fills', async () => {
    events.push({ id: 'a' }, { id: 'b' }, { id: 'c' })
    trouble = 'auth'
    ensureLoot(['wss://signs-in-later'])
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe('auth') })
    // The signer came back and the relay took its AUTH.
    trouble = null
    for (const fn of heard.signIn) fn()
    await vi.waitFor(() => { expect(useLootStore.getState().items).toHaveLength(3) })
    expect(useLootStore.getState()).toMatchObject({ status: 'ready', trouble: null })
  })

  it('reads again when the connection comes back', async () => {
    events.push({ id: 'a' })
    trouble = 'unreachable'
    ensureLoot(['wss://comes-back'])
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe('unreachable') })
    trouble = null
    for (const fn of heard.resume) fn()
    await vi.waitFor(() => { expect(useLootStore.getState().items).toHaveLength(1) })
    expect(useLootStore.getState().trouble).toBeNull()
  })

  it('a list that answered is not read again when the relay signs in', async () => {
    events.push({ id: 'a' })
    ensureLoot(['wss://answered'])
    await vi.waitFor(() => { expect(useLootStore.getState().status).toBe('ready') })
    const before = queryCalls
    for (const fn of heard.signIn) fn()
    for (const fn of heard.resume) fn()
    expect(queryCalls).toBe(before)
  })

  it('RETRY reads again, keeping what is on screen', async () => {
    trouble = 'auth'
    ensureLoot(['wss://retry'])
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe('auth') })
    events.push({ id: 'z' })
    trouble = null
    refreshLoot()
    await vi.waitFor(() => { expect(useLootStore.getState().items).toHaveLength(1) })
    expect(useLootStore.getState().trouble).toBeNull()
  })
})
