/**
 * secretsScale.test.ts: a move costs the same with thirty thousand places
 * kept as with two hundred (review of #219, finding 4).
 *
 * The budget is 250 MB of storage, about 180,000 places, and the first
 * version of this store held every place and place key in memory and copied
 * both on every move: hundreds of megabytes of heap and hundreds of
 * milliseconds a step long before the budget was reached. Now the places live
 * only in IndexedDB. This seeds the database directly, loads the store, and
 * counts the IndexedDB operations one move makes, which is what decides its
 * cost in a real browser (fake-indexeddb's own timings are not a browser's).
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }

import { bytesOf } from '../../lib/secrets/budget'
import { META_STORE } from '../../lib/idb'
import { PLACES_STORE, PLACE_KEYS_STORE, TOTALS_META, openSecretsDb } from '../../lib/secrets/db'
import { placeOf, type PlaceKey, type ScanKey } from '../../lib/secrets/places'

function scanAt(p: { x: bigint; y: bigint; z: bigint }): ScanKey[] {
  return Array.from({ length: 13 }, (_, h) => {
    const b = (v: bigint): bigint => (v >> BigInt(h)) << BigInt(h)
    return { lookupId: `h${h}:${b(p.x)},${b(p.y)},${b(p.z)}`, keyHex: 'cc'.repeat(32), height: h }
  })
}
const spot = (i: number): { x: bigint; y: bigint; z: bigint } => ({ x: (1n << 84n) + BigInt(i), y: 1n << 84n, z: 1n << 84n })

/** A walk of `n` places one gibson apart, written straight into the database with its totals. */
async function seed(n: number): Promise<void> {
  const db = await openSecretsDb()
  const tx = db.transaction([PLACES_STORE, PLACE_KEYS_STORE, META_STORE], 'readwrite')
  const keys = new Map<string, PlaceKey>()
  let bytes = 0
  for (let i = 0; i < n; i++) {
    const p = placeOf(spot(i), 0, scanAt(spot(i)), 1_800_000_000 + i)!
    tx.objectStore(PLACES_STORE).put(p.place)
    bytes += bytesOf(p.place)
    for (const k of p.keys) if (!keys.has(k.lookupId)) { keys.set(k.lookupId, k); bytes += bytesOf(k) }
  }
  for (const k of keys.values()) tx.objectStore(PLACE_KEYS_STORE).put(k)
  tx.objectStore(META_STORE).put({ key: TOTALS_META, value: { bytes, places: n, placeKeys: keys.size } })
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
  db.close()
}

const READS = ['get', 'count', 'getAll', 'getAllKeys', 'openCursor', 'openKeyCursor'] as const
const WRITES = ['put', 'add', 'delete', 'clear'] as const
type Op = (typeof READS)[number] | (typeof WRITES)[number]

/** Every IndexedDB store and index call made while `fn` runs, by kind. */
async function counting(fn: () => Promise<void>): Promise<Record<string, number>> {
  const calls: Record<string, number> = {}
  const spies: Array<{ mockRestore: () => void }> = []
  for (const [where, proto] of [['store', IDBObjectStore.prototype], ['index', IDBIndex.prototype]] as const) {
    for (const op of [...READS, ...WRITES] as Op[]) {
      const original = (proto as unknown as Record<string, unknown>)[op]
      if (typeof original !== 'function') continue
      spies.push(vi.spyOn(proto as unknown as Record<string, (...a: unknown[]) => unknown>, op).mockImplementation(function (this: unknown, ...args: unknown[]) {
        calls[`${where}.${op}`] = (calls[`${where}.${op}`] ?? 0) + 1
        return (original as (...a: unknown[]) => unknown).apply(this, args)
      }))
    }
  }
  try { await fn() } finally { for (const s of spies) s.mockRestore() }
  return calls
}

async function oneMove(n: number): Promise<{ calls: Record<string, number>; ms: number; largestInState: number; keysCopied: boolean; places: number }> {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  await seed(n)
  vi.resetModules()
  const { useSecrets } = await import('../useSecrets')
  await useSecrets.getState().load()
  const keysBefore = useSecrets.getState().keys
  const t0 = performance.now()
  const calls = await counting(() => useSecrets.getState().recordPlace(spot(n), 0, scanAt(spot(n))))
  const ms = performance.now() - t0
  // The biggest collection anywhere in the store's state, in entries.
  let largestInState = 0
  for (const v of Object.values(useSecrets.getState())) {
    if (v && typeof v === 'object' && !Array.isArray(v)) largestInState = Math.max(largestInState, Object.keys(v).length)
  }
  return { calls, ms, largestInState, keysCopied: useSecrets.getState().keys !== keysBefore, places: useSecrets.getState().storage.places }
}

afterEach(() => { vi.restoreAllMocks() })

describe('a move, however many places are kept', () => {
  it('makes the same few IndexedDB calls at 30,000 places as at 200, reads nothing in bulk, and copies nothing in memory', async () => {
    // Odd counts, so the next spot in both walks is new only in its 2^0 cube:
    // a step that crosses into a new 2^h cube also stores that cube's key,
    // which depends on where the walk is, not on how long it is.
    const small = await oneMove(201)
    const large = await oneMove(30_001)
    console.log(`one move: ${JSON.stringify(large.calls)}; ${small.ms.toFixed(1)} ms at 201 places, ${large.ms.toFixed(1)} ms at 30,001 (fake-indexeddb)`)

    expect(large.places).toBe(30_002)
    expect(large.calls).toEqual(small.calls)
    const total = Object.values(large.calls).reduce((a, b) => a + b, 0)
    // One place, its thirteen keys, the totals: a get and at most a put each.
    expect(total).toBeLessThanOrEqual(2 * (1 + 13 + 1))
    for (const bulk of ['getAll', 'getAllKeys', 'openCursor', 'openKeyCursor', 'clear']) {
      expect(large.calls[`store.${bulk}`] ?? 0).toBe(0)
      expect(large.calls[`index.${bulk}`] ?? 0).toBe(0)
    }
    // Nothing in memory grows with the places, and the held keys are not copied by a move.
    expect(large.largestInState).toBe(small.largestInState)
    expect(large.largestInState).toBeLessThan(20)
    expect(large.keysCopied).toBe(false)
  }, 120_000)
})
