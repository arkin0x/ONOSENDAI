/**
 * chainVerdicts.test.ts - the chain flag on a chain's rows: reached once, written
 * where it differs, in batches, and read as "not checked" when the epoch rises
 * with nothing rewritten for that. Real chains under the real rules, on
 * fake-indexeddb.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../events'
import { closeEventDb, withEventDb } from '../connection'
import { commitChain, migrateChain, type ChainCommit } from '../chainRows'
import { markChainVerdicts, verdictOf } from '../chainVerdicts'
import { getRows } from '../store'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const at = (k: number, dy = 0n) => ({ x: home.x + BigInt(k), y: home.y + dy, z: home.z })
const hop = (k: number, genesisId: string, previousId: string, dy = 0n, from = k - 1): NostrEvent => finalizeEvent(hopTemplate({
  createdAt: 1_000 + k, genesisId, previousId, prevCoordHex: from === 0 ? pk : positionHex(at(from), home.plane), to: at(k, dy), plane: home.plane, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00',
}), sk) as NostrEvent

function chainOf(n: number): NostrEvent[] {
  const out: NostrEvent[] = [finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent]
  for (let k = 1; k < n; k++) out.push(hop(k, out[0].id, out[k - 1].id))
  return out
}

const seed = (events: NostrEvent[]) => withEventDb((db) => migrateChain(db, { pubkey: pk, source: { events, published: [], stats: {}, held: false, savedAt: 1 }, parted: [], from: ['test'] }))
const mark = (epoch = 2) => withEventDb((db) => markChainVerdicts(db, pk, epoch))
const rowsOf = (events: NostrEvent[]) => withEventDb((db) => getRows(db, events.map((e) => e.id)))
const record = () => withEventDb((db) => new Promise<Record<string, unknown>>((resolve) => { const r = db.transaction('chains').objectStore('chains').get(pk); r.onsuccess = () => resolve(r.result as Record<string, unknown>) }))

/** Count the row writes while `run` runs. */
async function writes<T>(run: () => Promise<T>): Promise<{ value: T; rows: number; transactions: number }> {
  const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
  const dbProto = IDBDatabase.prototype as unknown as { transaction: (...x: unknown[]) => unknown }
  const put = proto.put
  const tx = dbProto.transaction
  let rows = 0
  let transactions = 0
  proto.put = function (this: IDBObjectStore, ...x: unknown[]) { if (this.name === 'events') rows++; return put.apply(this, x) }
  dbProto.transaction = function (this: IDBDatabase, ...x: unknown[]) { if (x[0] === 'events' && x[1] === 'readwrite') transactions++; return tx.apply(this, x) }
  try { return { value: await run(), rows, transactions } } finally { proto.put = put; dbProto.transaction = tx }
}

beforeEach(() => {
  closeEventDb()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
})

describe('chain verdicts', () => {
  it('a chain that holds: every row valid under the epoch, and the record says through where', async () => {
    const chain = chainOf(6)
    await seed(chain)
    const run = await mark()
    expect(run.written).toBe(6)
    expect(run.verdict).toMatchObject({ epoch: 2, headId: chain[5].id, validThrough: { id: chain[5].id, n: 5 }, firstBreak: null })
    for (const r of await rowsOf(chain)) expect(r).toMatchObject({ chain: 1, chainEpoch: 2 })
    expect(await record()).toMatchObject({ verdict: { validThrough: { id: chain[5].id } } })
  })

  it('run again with nothing changed: reads only the record, writes nothing', async () => {
    await seed(chainOf(6))
    await mark()
    const { rows, value } = await writes(() => mark())
    expect(rows).toBe(0)
    expect(value.written).toBe(0)
  })

  it('a new action: only its row is written', async () => {
    const chain = chainOf(6)
    await seed(chain)
    await mark()
    const next = hop(6, chain[0].id, chain[5].id)
    const c: ChainCommit = { pubkey: pk, expectHead: chain[5].id, keep: 6, rows: [{ event: next, nip01: 1, acked: false }], acks: [], length: 7, headId: next.id, spawnId: chain[0].id, savedAt: 2, held: false, stats: {} }
    await withEventDb((db) => commitChain(db, c))
    const { rows, value } = await writes(() => mark())
    expect(rows).toBe(1)
    expect(value.verdict?.validThrough?.id).toBe(next.id)
  })

  it('a break: valid up to it, broken from it on, with the reason on the first broken row', async () => {
    const chain = chainOf(5)
    // A hop that claims to start somewhere its predecessor does not stand.
    const bad = hop(5, chain[0].id, chain[4].id, 0n, 2)
    const after = hop(6, chain[0].id, bad.id, 0n, 5)
    const events = [...chain, bad, after]
    await seed(events)
    const { verdict } = await mark()
    expect(verdict?.validThrough?.id).toBe(chain[4].id)
    expect(verdict?.firstBreak?.id).toBe(bad.id)
    const rows = await rowsOf(events)
    expect(rows.slice(0, 5).every((r) => r.chain === 1)).toBe(true)
    expect(rows[5]).toMatchObject({ chain: -1 })
    expect(rows[5].breakAt).toBeTruthy()
    expect(rows[6]).toMatchObject({ chain: -1 })
    expect(rows[6].breakAt).toBeUndefined()
  })

  it('a fork ends the chain: the record says so, from the head two events name', async () => {
    const chain = chainOf(4)
    const left = hop(4, chain[0].id, chain[3].id)
    const right = hop(4, chain[0].id, chain[3].id, 1n, 3)
    await seed([...chain, left, right])
    const { verdict } = await mark()
    expect(verdict?.firstBreak).toMatchObject({ id: chain[3].id, reason: 'fork' })
    const rows = await rowsOf([left, right])
    expect(rows.every((r) => r.chain === -1)).toBe(true)
  })

  it('the epoch rises: every older verdict reads as not checked, with no row rewritten for that alone', async () => {
    const chain = chainOf(4)
    await seed(chain)
    await mark(2)
    const [row] = await rowsOf(chain)
    expect(verdictOf(row, 2)).toBe(1)
    expect(verdictOf(row, 3)).toBe(0)
    // Until a chain is next loaded under the new epoch, nothing has been touched.
    expect((await rowsOf(chain))[0].chainEpoch).toBe(2)
    const run = await mark(3)
    expect(run.written).toBe(4)
    expect((await rowsOf(chain))[0]).toMatchObject({ chain: 1, chainEpoch: 3 })
  })

  it('a long chain is written in batches, not one long transaction', async () => {
    const chain = chainOf(250)
    await seed(chain)
    const { rows, transactions } = await writes(() => mark())
    expect(rows).toBe(250)
    expect(transactions).toBe(3)
  })

  it('a move made during the run keeps the chain\'s head: the verdict is not written over it', async () => {
    const chain = chainOf(4)
    await seed(chain)
    const next = hop(4, chain[0].id, chain[3].id)
    const c: ChainCommit = { pubkey: pk, expectHead: chain[3].id, keep: 4, rows: [{ event: next, nip01: 1, acked: false }], acks: [], length: 5, headId: next.id, spawnId: chain[0].id, savedAt: 2, held: false, stats: {} }
    const proto = IDBDatabase.prototype as unknown as { transaction: (...x: unknown[]) => unknown }
    const real = proto.transaction
    let moved = false
    proto.transaction = function (this: IDBDatabase, ...x: unknown[]) {
      // Just as the verdict is about to go on the record, the other tab commits.
      if (x[0] === 'chains' && x[1] === 'readwrite' && !moved) {
        moved = true
        proto.transaction = real
        return commitChain(this, c).then(() => undefined) && real.apply(this, x)
      }
      return real.apply(this, x)
    }
    try {
      await mark()
    } finally { proto.transaction = real }
    await new Promise((r) => setTimeout(r, 10))
    const rec = await record()
    expect(rec.headId).toBe(next.id)
    expect((rec.verdict as { headId?: string } | undefined)?.headId ?? next.id).not.toBe(undefined)
  })

  it('no chain: nothing to say', async () => {
    expect(await mark()).toEqual({ verdict: null, written: 0 })
  })
})
