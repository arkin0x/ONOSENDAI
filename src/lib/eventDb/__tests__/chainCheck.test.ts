/**
 * chainCheck.test.ts - the worker's check of a chain's rows: what a flag lets
 * it skip, what it still recomputes, and that a flag is only ever raised by a
 * check that passed.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Every Schnorr check and every id recomputed while `on`, in order, with the page's turns between them. */
const seen = vi.hoisted(() => ({ on: false, log: [] as string[], schnorr: 0 }))
vi.mock('nostr-tools/pure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools/pure')>()
  return {
    ...actual,
    verifyEvent: (e: Parameters<typeof actual.verifyEvent>[0]) => { if (seen.on) seen.schnorr++; return actual.verifyEvent(e) },
    getEventHash: (e: Parameters<typeof actual.getEventHash>[0]) => { if (seen.on) seen.log.push('h'); return actual.getEventHash(e) },
  }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { closeEventDb, withEventDb } from '../connection'
import { checkChainRows, commitChain, flagRows, migrateChain, type ChainCommit } from '../chainRows'
import { getRows } from '../store'
import type { NostrEvent } from '../../events'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const action = (n: number): NostrEvent => finalizeEvent({ kind: 3333, created_at: 1000 + n, tags: [['A', 'hop']], content: '' }, sk) as NostrEvent
const check = () => withEventDb((db) => checkChainRows(db, pk))
const migrate = (events: NostrEvent[]) => withEventDb((db) => migrateChain(db, { pubkey: pk, source: { events, published: [], stats: {}, held: false, savedAt: 1 }, parted: [], from: ['test'] }))
const flagged = async (id: string) => (await withEventDb((db) => getRows(db, [id])))[0].nip01

beforeEach(() => {
  closeEventDb()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
})

describe('checkChainRows on the main thread (the event worker given up)', () => {
  it('checks no signature: the rows not flagged come back for the signature worker, and stay unflagged until it says', async () => {
    const chain = [action(1), action(2), action(3)]
    await migrate(chain)
    seen.on = true
    seen.schnorr = 0
    const r = await withEventDb((db) => checkChainRows(db, pk, { verify: false }))
    seen.on = false
    expect(seen.schnorr).toBe(0)
    expect(r.signed).toBe(0)
    expect(r.unchecked.map((e) => e.id)).toEqual(chain.map((e) => e.id))
    expect(await flagged(chain[0].id)).toBe(0)
    await withEventDb((db) => flagRows(db, chain))
    expect(await flagged(chain[0].id)).toBe(1)
    expect(await withEventDb((db) => checkChainRows(db, pk, { verify: false }))).toEqual({ bad: [], signed: 0, rehashed: 3, unchecked: [] })
  })

  it('recomputes ids in chunks, with the page given turns between them', async () => {
    const chain = Array.from({ length: 450 }, (_, i) => action(i))
    await migrate(chain)
    await withEventDb((db) => flagRows(db, chain))
    seen.log = []
    seen.on = true
    const ticker = setInterval(() => { if (seen.on) seen.log.push('t') }, 0)
    try {
      const r = await withEventDb((db) => checkChainRows(db, pk, { verify: false }))
      expect(r.rehashed).toBe(450)
    } finally { seen.on = false; clearInterval(ticker) }
    const first = seen.log.indexOf('h')
    const last = seen.log.lastIndexOf('h')
    expect(seen.log.slice(first, last).filter((x) => x === 't').length).toBeGreaterThanOrEqual(2)
  }, 30_000)

  it('a flagged row whose bytes changed is still caught', async () => {
    const chain = [action(1), action(2)]
    await migrate(chain)
    await withEventDb((db) => flagRows(db, chain))
    await withEventDb((db) => new Promise<void>((resolve) => {
      const tx = db.transaction('events', 'readwrite')
      const os = tx.objectStore('events')
      const g = os.get(chain[1].id)
      g.onsuccess = () => os.put({ ...g.result, content: 'rot' })
      tx.oncomplete = () => resolve()
    }))
    expect((await withEventDb((db) => checkChainRows(db, pk, { verify: false }))).bad).toEqual([chain[1].id])
  })
})

const commit = (c: Partial<ChainCommit> & Pick<ChainCommit, 'expectHead' | 'keep' | 'rows' | 'length' | 'headId'>) =>
  withEventDb((db) => commitChain(db, { pubkey: pk, acks: [], spawnId: 'x', savedAt: 1, held: false, stats: {}, ...c } as ChainCommit))

describe('a flag is raised only on the bytes that were checked (review of #574, F1)', () => {
  it('a row dropped and back under the same id with another signature while the check ran is never flagged', async () => {
    const a = [action(0), action(1), action(2)]
    await migrate(a)
    // The main-thread check hands all three out for the signature worker.
    const found = await withEventDb((db) => checkChainRows(db, pk, { verify: false }))
    expect(found.unchecked.map((e) => e.id)).toEqual(a.map((e) => e.id))
    // Meanwhile the head is taken back, and a copy with a bad signature comes back under its id.
    expect((await commit({ expectHead: a[2].id, keep: 2, rows: [], length: 2, headId: a[1].id })).status).toBe('ok')
    const forged = { ...a[2], sig: 'f'.repeat(128) }
    expect((await commit({ expectHead: a[1].id, keep: 2, rows: [{ event: forged, nip01: 0, acked: false }], length: 3, headId: a[2].id })).status).toBe('ok')
    // The signature worker says the three it was handed are good.
    await withEventDb((db) => flagRows(db, found.unchecked))
    expect(await flagged(a[0].id)).toBe(1)
    const row = (await withEventDb((db) => getRows(db, [a[2].id])))[0]
    expect(row.sig).toBe(forged.sig)
    expect(row.nip01).toBe(0)
    // So the next check verifies it in full, and finds it.
    expect((await check()).bad).toEqual([a[2].id])
  })
})

describe('checkChainRows', () => {
  it('checks each unflagged row once and flags it; the next check only rehashes', async () => {
    const chain = [action(1), action(2), action(3)]
    await migrate(chain)
    expect(await check()).toEqual({ bad: [], signed: 3, rehashed: 0, unchecked: [] })
    expect(await flagged(chain[0].id)).toBe(1)
    expect(await check()).toEqual({ bad: [], signed: 0, rehashed: 3, unchecked: [] })
  })

  it('a flagged row whose bytes changed is reported by its id, and nothing checks its signature', async () => {
    const chain = [action(1), action(2)]
    await migrate(chain)
    await check()
    await withEventDb((db) => new Promise<void>((resolve) => {
      const tx = db.transaction('events', 'readwrite')
      const os = tx.objectStore('events')
      const g = os.get(chain[1].id)
      g.onsuccess = () => os.put({ ...g.result, content: 'rot' })
      tx.oncomplete = () => resolve()
    }))
    expect(await check()).toEqual({ bad: [chain[1].id], signed: 0, rehashed: 2, unchecked: [] })
  })

  it('a forged row is reported and never flagged', async () => {
    const chain = [action(1), action(2)]
    const forged = { ...chain[1], sig: 'f'.repeat(128) }
    await migrate([chain[0], forged])
    expect(await check()).toEqual({ bad: [chain[1].id], signed: 1, rehashed: 0, unchecked: [] })
    expect(await flagged(chain[1].id)).toBe(0)
  })

  it('an unsigned-on-purpose row has its id recomputed and keeps its flag', async () => {
    const signed = action(1)
    const unsigned = { ...signed, sig: '' }
    const c: ChainCommit = { pubkey: pk, expectHead: null, keep: 0, rows: [{ event: unsigned, nip01: 2, acked: false }], acks: [], length: 1, headId: signed.id, spawnId: signed.id, savedAt: 1, held: false, stats: {} }
    await withEventDb((db) => commitChain(db, c))
    expect(await check()).toEqual({ bad: [], signed: 0, rehashed: 1, unchecked: [] })
    expect(await flagged(signed.id)).toBe(2)
  })

  it('flags land in batches: a long chain is not one long transaction', async () => {
    const chain = Array.from({ length: 250 }, (_, i) => action(i))
    await migrate(chain)
    const proto = IDBDatabase.prototype as unknown as { transaction: (...x: unknown[]) => IDBTransaction }
    const real = proto.transaction
    let writes = 0
    proto.transaction = function (this: IDBDatabase, ...x: unknown[]) { if (x[1] === 'readwrite') writes++; return real.apply(this, x) }
    try {
      await check()
    } finally { proto.transaction = real }
    expect(writes).toBe(3)
    // Genuinely slow: 250 events moved into the database and checked, about 3.5 s alone in a parallel run, past 5 s under load.
  }, 20_000)

  it('no chain: nothing to check', async () => {
    expect(await check()).toEqual({ bad: [], signed: 0, rehashed: 0, unchecked: [] })
  })
})
