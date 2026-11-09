/**
 * boughtBase.test.ts: a bought key's corner stays exact near 2^84, and a
 * corner stored inexact by an earlier build throws nowhere and is repaired
 * where it can be (lib/secrets/base.ts).
 *
 * hosaka-api is Python, and its region_key answer sends `base` as bare JSON
 * integers; JSON.parse rounded them, String() stored "2.90...e+25", and
 * BigInt() of that threw in RESCAN ALL and every other reader. The texts here
 * are what Python's json.dumps writes. HOSAKA is never reached: the client is
 * given a fetch that answers with the text.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

vi.mock('../../relay', async (o) => {
  const a = await o<typeof import('../../relay')>()
  const { offlineRelay } = await import('../../../test/offlineRelay')
  return { ...a, ...offlineRelay, relaySet: () => ['wss://relay.test'] }
})

import { createHosaka, parseJsonExactIntegers } from '../../hosaka'
import { alignedBase, baseOf, exactInteger, repairBase } from '../base'
import { allBatches, heldEntry } from '../rescan'
import { BOUGHT_KEY } from '../backstop'
import { KEYS_STORE, SECRETS_DB } from '../db'
import type { HeldKey } from '../../../store/useSecrets'
import type { Position } from '../../space'

/** A point near 2^84 on every axis, with low bits a double cannot hold. */
const AT: Position = { x: (1n << 84n) + (1n << 83n) + 12_345_678_901_234_567n, y: (1n << 84n) + 987_654_321_987_654_321n, z: (1n << 84n) + 55_555_555_555n }
const H = 20

/** The corner as Python writes it: bare integers. */
function pythonJob(at: Position, height: number): string {
  const b = alignedBase(at, height)
  return `{"id": "job1", "status": "completed", "cost_msats": 2000, "error": null, "result": {"secret_key": "${'ab'.repeat(32)}", "lookup_id": "${'cd'.repeat(32)}", "height": ${height}, "base": {"x": ${b.x}, "y": ${b.y}, "z": ${b.z}}, "compute_msats": 2000}}`
}

/** What an earlier build stored for that corner: String() of the rounded Number. */
const rounded = (v: string): string => String(Number(v))

describe('parseJsonExactIntegers', () => {
  it('keeps an integer past 2^53 exact, as its decimal string, and leaves the rest as JSON.parse does', () => {
    const b = alignedBase(AT, H)
    const job = parseJsonExactIntegers(pythonJob(AT, H)) as { cost_msats: number; result: { height: number; base: Record<string, unknown> } }
    expect(job.result.base).toEqual(b)
    expect(job.result.height).toBe(H)
    expect(job.cost_msats).toBe(2000)
    // The rounding this replaces.
    expect(String((JSON.parse(pythonJob(AT, H)) as typeof job).result.base.x)).not.toBe(b.x)
  })

  it('never touches digits inside strings, floats, exponents, or safe integers, and reads escapes', () => {
    const text = '{"s": "19342813113834066795298816 \\" 2", "f": 1.5, "e": 1e30, "n": -9007199254740993, "safe": 9007199254740991, "a": [123456789012345678901234567, true, null]}'
    expect(parseJsonExactIntegers(text)).toEqual({ s: '19342813113834066795298816 " 2', f: 1.5, e: 1e30, n: '-9007199254740993', safe: 9007199254740991, a: ['123456789012345678901234567', true, null] })
  })

  it('carries an exact corner through the HOSAKA client, from Python\'s text to the job it returns', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => pythonJob(AT, H), headers: { get: () => null } })) as unknown as typeof globalThis.fetch
    const client = createHosaka({ apiUrl: 'http://hosaka.invalid', sign: async () => { throw new Error('not signed here') }, fetch })
    const job = await client.getJob('job1', 'tok')
    expect((job.result as { base: unknown }).base).toEqual(alignedBase(AT, H))
  })
})

describe('the corner helpers', () => {
  it('alignedBase is exact at 2^84', () => {
    const b = alignedBase(AT, H)
    expect(BigInt(b.x)).toBe((AT.x >> 20n) << 20n)
    expect(BigInt(b.x) % (1n << 20n)).toBe(0n)
  })

  it('exactInteger and baseOf take decimal strings, bigints and safe integers, and refuse a rounded Number without throwing', () => {
    expect(exactInteger('123')).toBe(123n)
    expect(exactInteger(5)).toBe(5n)
    expect(exactInteger(2 ** 60)).toBeNull()
    expect(exactInteger('1.93e+25')).toBeNull()
    const b = alignedBase(AT, H)
    expect(baseOf(b)).toEqual({ x: BigInt(b.x), y: BigInt(b.y), z: BigInt(b.z) })
    expect(baseOf({ x: rounded(b.x), y: b.y, z: b.z })).toBeNull()
    expect(baseOf({ x: '1.93e+25', y: '0', z: '0' })).toBeNull()
    expect(baseOf(null)).toBeNull()
  })

  it('repairBase: exact from where it was hidden; from the rounded Number only where one corner fits; else unknown', () => {
    const b20 = alignedBase(AT, 20)
    const bad20 = { x: rounded(b20.x), y: rounded(b20.y), z: rounded(b20.z) }
    // From the point: exact whatever the height.
    expect(repairBase(bad20, 20, AT)).toEqual(b20)
    // At h20 near 2^84 a double's unit is 2^32: thousands of corners fit, so unknown.
    expect(repairBase(bad20, 20)).toBeNull()
    // At h40 one corner fits the rounding, and it is the right one.
    const b40 = alignedBase(AT, 40)
    expect(repairBase({ x: rounded(b40.x), y: rounded(b40.y), z: rounded(b40.z) }, 40)).toEqual(b40)
    // Already exact: nothing to repair.
    expect(repairBase(b20, 20)).toBeNull()
    expect(repairBase({ x: '1.93e+25', y: '0', z: '0' }, 20)).toBeNull()
  })
})

const goodKey = (n: number, over: Partial<HeldKey> = {}): HeldKey => ({
  lookupId: n.toString(16).padStart(64, '0'), keyHex: (n + 7).toString(16).padStart(64, '0'), height: 4, base: { x: '0', y: '16', z: '32' }, plane: 0, source: 'hop', at: 1, ...over,
})
const STORED_BAD = { x: '1.93e+25', y: rounded(alignedBase(AT, H).y), z: rounded(alignedBase(AT, H).z) }

describe('RESCAN ALL with a key whose corner was stored inexact', () => {
  it('asks about every key, the bad one with no origin, and throws nowhere', async () => {
    const keys = { [goodKey(1).lookupId]: goodKey(1), [goodKey(2).lookupId]: goodKey(2, { source: 'cloud', height: H, base: STORED_BAD }) }
    expect(() => heldEntry(keys[goodKey(2).lookupId])).not.toThrow()
    async function* none(): AsyncGenerator<never[]> { /* no place keys */ }
    const batches: Array<Array<{ lookupId: string; origin?: unknown }>> = []
    for await (const b of allBatches(keys, none())) batches.push(b)
    const entries = batches.flat()
    expect(entries.map((e) => e.lookupId)).toEqual([goodKey(1).lookupId, goodKey(2).lookupId])
    expect(entries[0].origin).toBeDefined()
    expect(entries[1].origin).toBeUndefined()
  })
})

describe('a stored inexact corner is repaired on load, and no bought key is dropped', () => {
  type Mods = { secrets: typeof import('../../../store/useSecrets'); shards: typeof import('../../../store/useShards') }
  async function boot(before?: (m: Mods) => void): Promise<Mods> {
    vi.resetModules()
    const secrets = await import('../../../store/useSecrets')
    const shards = await import('../../../store/useShards')
    before?.({ secrets, shards })
    await secrets.useSecrets.getState().load()
    return { secrets, shards }
  }

  async function onDisk(lookupId: string): Promise<HeldKey | undefined> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(SECRETS_DB)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const row = await new Promise<HeldKey | undefined>((resolve) => {
      const q = db.transaction(KEYS_STORE).objectStore(KEYS_STORE).get(lookupId)
      q.onsuccess = () => resolve(q.result as HeldKey | undefined)
    })
    db.close()
    return row
  }
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

  beforeAll(async () => {
    await import('../../../store/useSecrets')
  }, 60_000)

  beforeEach(() => {
    mem.clear()
    ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  })

  it('from the deploy row that names it: exact, in the list, IndexedDB and the backstop', async () => {
    const k = goodKey(9, { source: 'cloud', height: H, base: STORED_BAD })
    mem.set(BOUGHT_KEY, JSON.stringify({ [k.lookupId]: k }))
    const { secrets } = await boot(({ shards }) => {
      shards.useShards.setState({ mine: [{ lookupId: k.lookupId, height: H, at: { x: AT.x.toString(), y: AT.y.toString(), z: AT.z.toString() } } as never] })
    })
    await settle()
    const want = alignedBase(AT, H)
    expect(secrets.useSecrets.getState().keys[k.lookupId]).toMatchObject({ base: want, keyHex: k.keyHex, source: 'cloud' })
    expect((await onDisk(k.lookupId))?.base).toEqual(want)
    expect(JSON.parse(mem.get(BOUGHT_KEY)!)[k.lookupId].base).toEqual(want)
    // And the held comparison, which never matched it, does now.
    expect(secrets.keyStateForAction({ type: 'hop', position: AT, plane: 0 }, { position: { x: AT.x ^ (1n << 19n), y: AT.y, z: AT.z } }, secrets.useSecrets.getState().keys, () => H).state).toBe('held')
  })

  it('from the rounded Number where only one corner fits it (h40)', async () => {
    const b40 = alignedBase(AT, 40)
    const k = goodKey(10, { source: 'cloud', height: 40, base: { x: rounded(b40.x), y: rounded(b40.y), z: rounded(b40.z) } })
    mem.set(BOUGHT_KEY, JSON.stringify({ [k.lookupId]: k }))
    const { secrets } = await boot()
    await settle()
    expect(secrets.useSecrets.getState().keys[k.lookupId].base).toEqual(b40)
  })

  it('where it cannot be known: the key is kept, its corner as it was, in the list and the backstop', async () => {
    const k = goodKey(11, { source: 'cloud', height: H, base: STORED_BAD })
    mem.set(BOUGHT_KEY, JSON.stringify({ [k.lookupId]: k }))
    const { secrets } = await boot()
    await settle()
    expect(secrets.useSecrets.getState().keys[k.lookupId]).toMatchObject({ keyHex: k.keyHex, base: STORED_BAD })
    expect(JSON.parse(mem.get(BOUGHT_KEY)!)[k.lookupId]).toBeDefined()
    expect(await onDisk(k.lookupId)).toBeDefined()
  })
})

describe('a key bought now', () => {
  it('stores the corner computed from where it was bought, never HOSAKA\'s, even a rounded one', async () => {
    vi.resetModules()
    const secrets = await import('../../../store/useSecrets')
    const cs = await import('../../../store/useCyberspace')
    const b = alignedBase(AT, H)
    cs.useCyberspace.setState({
      buyRegionKey: async () => ({ ok: true as const, result: { secret_key: 'ab'.repeat(32), lookup_id: 'cd'.repeat(32), height: H, base: { x: Number(b.x), y: Number(b.y), z: Number(b.z) } } }),
    })
    const held = await secrets.useSecrets.getState().buy(AT, 0, H)
    expect(held?.base).toEqual(b)
    expect(held?.height).toBe(H)
  })
})
