/**
 * chainCheck.test.ts - the worker's check of a chain's rows: what a flag lets
 * it skip, what it still recomputes, and that a flag is only ever raised by a
 * check that passed.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { closeEventDb, withEventDb } from '../connection'
import { checkChainRows, commitChain, migrateChain, type ChainCommit } from '../chainRows'
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

describe('checkChainRows', () => {
  it('checks each unflagged row once and flags it; the next check only rehashes', async () => {
    const chain = [action(1), action(2), action(3)]
    await migrate(chain)
    expect(await check()).toEqual({ bad: [], signed: 3, rehashed: 0 })
    expect(await flagged(chain[0].id)).toBe(1)
    expect(await check()).toEqual({ bad: [], signed: 0, rehashed: 3 })
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
    expect(await check()).toEqual({ bad: [chain[1].id], signed: 0, rehashed: 2 })
  })

  it('a forged row is reported and never flagged', async () => {
    const chain = [action(1), action(2)]
    const forged = { ...chain[1], sig: 'f'.repeat(128) }
    await migrate([chain[0], forged])
    expect(await check()).toEqual({ bad: [chain[1].id], signed: 1, rehashed: 0 })
    expect(await flagged(chain[1].id)).toBe(0)
  })

  it('an unsigned-on-purpose row has its id recomputed and keeps its flag', async () => {
    const signed = action(1)
    const unsigned = { ...signed, sig: '' }
    const c: ChainCommit = { pubkey: pk, expectHead: null, keep: 0, rows: [{ event: unsigned, nip01: 2, acked: false }], acks: [], length: 1, headId: signed.id, spawnId: signed.id, savedAt: 1, held: false, stats: {} }
    await withEventDb((db) => commitChain(db, c))
    expect(await check()).toEqual({ bad: [], signed: 0, rehashed: 1 })
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
  })

  it('no chain: nothing to check', async () => {
    expect(await check()).toEqual({ bad: [], signed: 0, rehashed: 0 })
  })
})
