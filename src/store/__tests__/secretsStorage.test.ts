/**
 * secretsStorage.test.ts: region keys and places kept in IndexedDB.
 *
 * A reload is a fresh copy of the store module over the same database, which
 * is what a page load is: memory gone, IndexedDB and localStorage still there.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

import type { HeldKey, ScanKey } from '../useSecrets'
import { bytesOfAll } from '../../lib/secrets/budget'
import { LEGACY_KEY } from '../../lib/secrets/db'

type Mod = typeof import('../useSecrets')

/** A page load: the module fresh, then its load. */
async function boot(): Promise<Mod> {
  vi.resetModules()
  const mod = await import('../useSecrets')
  await mod.useSecrets.getState().load()
  return mod
}

const key = (id: string, over: Partial<HeldKey> = {}): HeldKey => ({
  lookupId: id.repeat(32), keyHex: 'bb'.repeat(32), height: 8, base: { x: '256', y: '512', z: '768' }, plane: 0, source: 'scan', at: 1_800_000_000, ...over,
})

/** The thirteen keys a scan computes at a position, each named by its cube. */
function scanAt(p: { x: bigint; y: bigint; z: bigint }): ScanKey[] {
  return Array.from({ length: 13 }, (_, h) => {
    const b = (v: bigint): bigint => (v >> BigInt(h)) << BigInt(h)
    return { lookupId: `h${h}:${b(p.x)},${b(p.y)},${b(p.z)}`, keyHex: 'cc'.repeat(32), height: h }
  })
}
const here = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const nextDoor = { ...here, x: here.x + 1n }

/** The running total against a whole re-measure of what is held. */
function measured(m: Mod): number {
  const { keys, places, placeKeys } = m.useSecrets.getState()
  return bytesOfAll(Object.values(keys)) + bytesOfAll(Object.values(places)) + bytesOfAll(Object.values(placeKeys))
}

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  mem.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the first load copies localStorage in, once, and leaves it alone', () => {
  it('serves the copied keys from IndexedDB with the localStorage string unchanged', async () => {
    const raw = JSON.stringify({ ['aa'.repeat(32)]: key('aa'), ['cc'.repeat(32)]: key('cc', { source: 'cloud' }) })
    mem.set(LEGACY_KEY, raw)
    const m = await boot()
    expect(m.useSecrets.getState().storage.mode).toBe('indexeddb')
    expect(Object.keys(m.useSecrets.getState().keys)).toHaveLength(2)
    expect(mem.get(LEGACY_KEY)).toBe(raw)

    // Writes go to IndexedDB, never back to localStorage.
    m.useSecrets.getState().hold([key('dd')])
    m.useSecrets.getState().forget('aa'.repeat(32))
    expect(mem.get(LEGACY_KEY)).toBe(raw)

    // A reload does not copy again: the forgotten key stays forgotten.
    const again = await boot()
    expect(Object.keys(again.useSecrets.getState().keys).sort()).toEqual(['cc'.repeat(32), 'dd'.repeat(32)])
    expect(mem.get(LEGACY_KEY)).toBe(raw)
  })
})

describe('held keys in IndexedDB', () => {
  it('a key held survives a reload, the first holding kept', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([key('aa')])
    m.useSecrets.getState().hold([key('aa', { at: 1_900_000_000 })])
    const again = await boot()
    expect(again.useSecrets.getState().keys['aa'.repeat(32)].at).toBe(1_800_000_000)
  })

  it('a key held before the load settles is kept and written', async () => {
    vi.resetModules()
    const m = await import('../useSecrets')
    m.useSecrets.getState().hold([key('ee')])
    await m.useSecrets.getState().load()
    expect(m.useSecrets.getState().keys['ee'.repeat(32)]).toBeTruthy()
    expect((await boot()).useSecrets.getState().keys['ee'.repeat(32)]).toBeTruthy()
  })

  it('forget and forget all reach IndexedDB, and forgetting keys leaves the places', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([key('aa'), key('bb'), key('cc', { source: 'cloud' })])
    m.useSecrets.getState().recordPlace(here, 0, scanAt(here))
    m.useSecrets.getState().forget('aa'.repeat(32))
    expect(Object.keys((await boot()).useSecrets.getState().keys).sort()).toEqual(['bb'.repeat(32), 'cc'.repeat(32)])

    const m2 = await boot()
    m2.useSecrets.getState().forgetAll()
    const after = await boot()
    expect(after.useSecrets.getState().keys).toEqual({})
    expect(Object.keys(after.useSecrets.getState().places)).toHaveLength(1)
    expect(after.useSecrets.getState().storage.bytes).toBe(measured(after))
  })
})

describe('places in IndexedDB', () => {
  it('the same spot is one row with its time moved; shared keys are one row each', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_800_000_000_000)
    const m = await boot()
    m.useSecrets.getState().recordPlace(here, 0, scanAt(here))
    vi.setSystemTime(1_800_000_100_000)
    m.useSecrets.getState().recordPlace(nextDoor, 0, scanAt(nextDoor))
    vi.setSystemTime(1_800_000_200_000)
    m.useSecrets.getState().recordPlace(here, 0, scanAt(here))

    const after = await boot()
    const { places, placeKeys } = after.useSecrets.getState()
    expect(Object.keys(places)).toHaveLength(2)
    const first = Object.values(places).find((p) => p.position.x === String(here.x))!
    expect(first.at).toBe(1_800_000_200)
    expect(first.first).toBe(1_800_000_000)
    // Thirteen cubes around here, and next door adds only its own 2^0 cube.
    expect(Object.keys(placeKeys)).toHaveLength(14)
    expect(after.useSecrets.getState().storage.bytes).toBe(measured(after))
  })

  it('forgetting one place drops only the keys no other place uses; forgetting all leaves the held keys', async () => {
    const m = await boot()
    m.useSecrets.getState().hold([key('aa')])
    m.useSecrets.getState().recordPlace(here, 0, scanAt(here))
    m.useSecrets.getState().recordPlace(nextDoor, 0, scanAt(nextDoor))
    const id = Object.values(m.useSecrets.getState().places).find((p) => p.position.x === String(here.x))!.id
    m.useSecrets.getState().forgetPlace(id)

    const m2 = await boot()
    expect(Object.keys(m2.useSecrets.getState().places)).toHaveLength(1)
    expect(Object.keys(m2.useSecrets.getState().placeKeys)).toHaveLength(13)
    expect(m2.useSecrets.getState().placeKeys[scanAt(here)[0].lookupId]).toBeUndefined()

    m2.useSecrets.getState().forgetAllPlaces()
    const after = await boot()
    expect(after.useSecrets.getState().places).toEqual({})
    expect(after.useSecrets.getState().placeKeys).toEqual({})
    expect(Object.keys(after.useSecrets.getState().keys)).toEqual(['aa'.repeat(32)])
    expect(after.useSecrets.getState().storage.bytes).toBe(measured(after))
  })
})

describe('the byte budget, through the store', () => {
  it('drops the oldest place first, then opened and crossed keys, and never a bought one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const m = await boot()
    const s = m.useSecrets.getState
    s().hold([
      key('b0', { source: 'cloud', at: 1 }),
      key('s1', { source: 'scan', at: 2 }),
      key('h2', { source: 'hop', at: 3 }),
    ])
    vi.setSystemTime(1_800_000_000_000)
    s().recordPlace(here, 0, scanAt(here))
    vi.setSystemTime(1_800_000_100_000)
    s().recordPlace(nextDoor, 0, scanAt(nextDoor))
    expect(s().storage.bytes).toBe(measured(m))

    // A budget exactly what is kept now, so the next key puts it over: the
    // place stood on longest ago goes, with the one key only it used, and
    // nothing else.
    m.useSecrets.setState((st) => ({ storage: { ...st.storage, budget: st.storage.bytes } }))
    s().hold([key('n3', { source: 'scan', at: 4 })])
    expect(Object.values(s().places).map((p) => p.position.x)).toEqual([String(nextDoor.x)])
    expect(Object.keys(s().placeKeys)).toHaveLength(13)
    expect(Object.keys(s().keys)).toHaveLength(4)
    expect(s().storage.bytes).toBe(measured(m))

    // No room at all: every place, then the earned keys; the bought one stays.
    m.useSecrets.setState((st) => ({ storage: { ...st.storage, budget: 0 } }))
    s().hold([key('n4', { source: 'scan', at: 5 })])
    expect(s().places).toEqual({})
    expect(s().placeKeys).toEqual({})
    expect(Object.keys(s().keys)).toEqual(['b0'.repeat(32)])
    expect(s().storage.bytes).toBe(measured(m))

    // And IndexedDB agrees.
    const after = await boot()
    expect(Object.keys(after.useSecrets.getState().keys)).toEqual(['b0'.repeat(32)])
    expect(after.useSecrets.getState().places).toEqual({})
  })
})

describe('without IndexedDB', () => {
  it('falls back to localStorage as before: the keys are written there, places only in memory', async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
    const m = await boot()
    expect(m.useSecrets.getState().storage.mode).toBe('local')
    expect(m.useSecrets.getState().storage.reason).toMatch(/IndexedDB/)
    m.useSecrets.getState().hold([key('aa')])
    m.useSecrets.getState().recordPlace(here, 0, scanAt(here))
    expect(Object.keys(JSON.parse(mem.get(LEGACY_KEY) ?? '{}'))).toEqual(['aa'.repeat(32)])
    expect(Object.keys(m.useSecrets.getState().places)).toHaveLength(1)
    const again = await boot()
    expect(Object.keys(again.useSecrets.getState().keys)).toEqual(['aa'.repeat(32)])
    expect(again.useSecrets.getState().places).toEqual({})
  })

  it('keeps the newest SECRETS_MAX there, dropping opened and crossed keys before a bought one', async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB
    const m = await boot()
    const bought = key('ff', { source: 'cloud', at: 0 })
    const many = Array.from({ length: m.SECRETS_MAX + 20 }, (_, i) =>
      key(i.toString(16).padStart(2, '0'), { lookupId: i.toString(16).padStart(64, '0'), at: 1_800_000_000 + i }))
    m.useSecrets.getState().hold([bought, ...many])
    const held = m.heldList(m.useSecrets.getState().keys)
    expect(held).toHaveLength(m.SECRETS_MAX)
    expect(held[0].at).toBe(1_800_000_000 + m.SECRETS_MAX + 19)
    expect(m.useSecrets.getState().keys[bought.lookupId]).toBeTruthy()
  })

  it('falls back when IndexedDB refuses to open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => { /* the refusal is the point */ })
    ;(globalThis as { indexedDB?: unknown }).indexedDB = { open: () => { throw new Error('InvalidStateError') } }
    const m = await boot()
    expect(m.useSecrets.getState().storage.mode).toBe('local')
    expect(m.useSecrets.getState().storage.reason).toMatch(/InvalidStateError/)
  })
})

describe('asking the browser to keep the storage', () => {
  it('asks at the first write, not at load, and once', async () => {
    const persist = vi.fn(async () => true)
    const persisted = vi.fn(async () => false)
    vi.stubGlobal('navigator', { storage: { persist, persisted } })
    const m = await boot()
    expect(persist).not.toHaveBeenCalled()
    expect(m.useSecrets.getState().storage.persisted).toBe('unasked')

    m.useSecrets.getState().hold([key('aa')])
    m.useSecrets.getState().hold([key('bb')])
    await vi.waitFor(() => { expect(m.useSecrets.getState().storage.persisted).toBe('granted') })
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('says when the browser will not', async () => {
    vi.stubGlobal('navigator', { storage: { persist: vi.fn(async () => false), persisted: vi.fn(async () => false) } })
    const m = await boot()
    m.useSecrets.getState().hold([key('aa')])
    await vi.waitFor(() => { expect(m.useSecrets.getState().storage.persisted).toBe('denied') })
  })

  it('says when there is no way to ask', async () => {
    vi.stubGlobal('navigator', {})
    const m = await boot()
    expect(m.useSecrets.getState().storage.persisted).toBe('unsupported')
  })
})
