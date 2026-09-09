import { beforeEach, describe, expect, it, vi } from 'vitest'

const events: Array<Record<string, unknown>> = []
let queryCalls = 0
let subscribeCalls = 0
let closed = 0

vi.mock('../lib/relay', () => ({
  query: vi.fn(async () => { queryCalls++; return events }),
  subscribe: vi.fn(() => { subscribeCalls++; return () => { closed++ } }),
}))

vi.mock('../lib/loot', async () => {
  const actual = await vi.importActual<typeof import('../lib/loot')>('../lib/loot')
  return { ...actual, summarizeBag: (ev: { id: string }) => ({ key: ev.id, bagId: ev.id, at: 1, bytes: 10 } as never) }
})

import { ensureLoot, useLootStore } from './useLoot'

describe('the loot list outlives the panel', () => {
  beforeEach(() => {
    events.length = 0
    queryCalls = 0; subscribeCalls = 0; closed = 0
    useLootStore.setState({ items: [], status: 'loading', source: '' })
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
