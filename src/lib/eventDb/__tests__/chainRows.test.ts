/**
 * chainRows.test.ts - a chain as rows, on fake-indexeddb: a move is one row,
 * two tabs cannot both extend one head, a fold leaves no second branch to find,
 * and a move into rows copies, reads back, compares, and only then switches.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { closeEventDb, withEventDb } from '../connection'
import { chainHead, commitChain, migrateChain, partedBranches, readChain, setAsideBranch, type ChainCommit, type ChainSource } from '../chainRows'
import { budget, getRows, ingest } from '../store'
import type { NostrEvent } from '../../events'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const action = (n: number, tag = 'a'): NostrEvent => finalizeEvent({ kind: 3333, created_at: 1000 + n, tags: [['A', 'hop'], ['n', tag]], content: '' }, sk) as NostrEvent
const stats = { hops: 1 }

function commit(over: Partial<ChainCommit> & { events: NostrEvent[]; keep: number; expectHead: string | null }): ChainCommit {
  const { events, keep, ...rest } = over
  return {
    pubkey: pk, keep, rows: events.slice(keep).map((event) => ({ event, nip01: 1 as const, acked: false })), acks: [],
    length: events.length, headId: events[events.length - 1].id, spawnId: events[0].id, savedAt: 5, held: false, stats, ...rest,
  }
}

const source = (events: NostrEvent[], published: string[] = [], savedAt = 7): ChainSource => ({ events, published, stats, held: false, savedAt })
const commitIt = (c: ChainCommit) => withEventDb((db) => commitChain(db, c))
const read = () => withEventDb((db) => readChain(db, pk))
const ids = (events: NostrEvent[]): string[] => events.map((e) => e.id)
const plain = (e: NostrEvent): NostrEvent => ({ id: e.id, pubkey: e.pubkey, created_at: e.created_at, kind: e.kind, tags: e.tags, content: e.content, sig: e.sig })

beforeEach(() => {
  closeEventDb()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
})

describe('a commit', () => {
  it('writes one row and the record for a move, whatever the chain\'s length', async () => {
    const chain = Array.from({ length: 300 }, (_, i) => action(i))
    await commitIt(commit({ events: chain.slice(0, 299), keep: 0, expectHead: null }))
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    const writes: Record<string, number> = {}
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) { writes[this.name] = (writes[this.name] ?? 0) + 1; return real.apply(this, x) }
    try {
      expect(await commitIt(commit({ events: chain, keep: 299, expectHead: chain[298].id }))).toMatchObject({ status: 'ok', changed: true })
    } finally { proto.put = real }
    expect(writes.events).toBe(1)
    expect(writes.chains).toBe(1)
    expect(ids((await read())!.events)).toEqual(ids(chain))
  })

  it('is strict: it answers once the action is on disk, because the answer lets it go to a relay', async () => {
    const proto = IDBDatabase.prototype as unknown as { transaction: (...x: unknown[]) => unknown }
    const real = proto.transaction
    const asked: unknown[] = []
    proto.transaction = function (this: IDBDatabase, ...x: unknown[]) { asked.push(x[2]); return real.apply(this, x) }
    try {
      await commitIt(commit({ events: [action(1)], keep: 0, expectHead: null }))
    } finally { proto.transaction = real }
    expect(asked).toContainEqual({ durability: 'strict' })
  })

  it('reads back in chain order, with the record beside it', async () => {
    const chain = [action(1), action(2), action(3)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null, held: true }))
    const r = await read()
    expect(r).toMatchObject({ stats, held: true, savedAt: 5, generation: 1, headId: chain[2].id, published: [], checked: ids(chain) })
    expect(ids(r!.events)).toEqual(ids(chain))
    expect(Object.keys((await read())!.events[0]).sort()).toEqual(['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'])
  })

  it('of two moves from one head, the first wins, and the second writes nothing', async () => {
    const base = [action(1), action(2)]
    await commitIt(commit({ events: base, keep: 0, expectHead: null }))
    const mine = [...base, action(3, 'tab a')]
    const theirs = [...base, action(3, 'tab b')]
    const [first, second] = await Promise.all([
      commitIt(commit({ events: mine, keep: 2, expectHead: base[1].id })),
      commitIt(commit({ events: theirs, keep: 2, expectHead: base[1].id })),
    ])
    expect(first).toMatchObject({ status: 'ok' })
    expect(second).toMatchObject({ status: 'lost', record: { headId: mine[2].id, length: 3 } })
    expect(ids((await read())!.events)).toEqual(ids(mine))
    expect(await withEventDb((db) => getRows(db, [theirs[2].id]))).toEqual([])
  })

  it('two tabs creating the first action: one chain', async () => {
    const a = [action(1, 'a')]
    const b = [action(1, 'b')]
    await commitIt(commit({ events: a, keep: 0, expectHead: null }))
    expect(await commitIt(commit({ events: b, keep: 0, expectHead: null }))).toMatchObject({ status: 'lost' })
  })

  it('asked again after it landed, it changes nothing and is not lost', async () => {
    const chain = [action(1), action(2)]
    const c = commit({ events: chain, keep: 0, expectHead: null })
    await commitIt(c)
    expect(await commitIt(c)).toMatchObject({ status: 'ok', changed: false, repeated: true, generation: 1 })
    expect((await read())!.generation).toBe(1)
  })

  it('an acknowledgement touches the row and keeps the time and the generation', async () => {
    const chain = [action(1), action(2)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null, savedAt: 5 }))
    await commitIt(commit({ events: chain, keep: 2, expectHead: chain[1].id, acks: [chain[0].id], savedAt: 5 }))
    expect(await read()).toMatchObject({ published: [chain[0].id], generation: 1, savedAt: 5 })
  })

  it('an acknowledgement from a tab behind the head lands on the row, and leaves the record alone', async () => {
    const chain = [action(1), action(2)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null, held: false }))
    const further = [...chain, action(3)]
    await commitIt(commit({ events: further, keep: 2, expectHead: chain[1].id }))
    // The late tab still thinks the chain ends at chain[1]: same length as the record says or not, it changes no place.
    const late = commit({ events: chain, keep: 2, expectHead: chain[1].id, acks: [chain[0].id], held: true, length: 3 })
    expect(await commitIt(late)).toMatchObject({ status: 'ok', changed: false })
    const after = await read()
    expect(after!.published).toEqual([chain[0].id])
    expect(after!.headId).toBe(further[2].id)
    expect(after!.held).toBe(false)
  })

  it('a fold that drops actions takes their place away: the load does not bring them back, and their rows stay', async () => {
    const chain = [action(1), action(2), action(3), action(4)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null }))
    const kept = [chain[0], chain[1], action(5, 'other way')]
    expect(await commitIt(commit({ events: kept, keep: 2, expectHead: chain[3].id }))).toMatchObject({ status: 'ok', changed: true })
    expect(ids((await read())!.events)).toEqual(ids(kept))
    const dropped = await withEventDb((db) => getRows(db, [chain[3].id]))
    expect(dropped).toHaveLength(1)
    expect(dropped[0].chainOf).toBeUndefined()
  })

  it('a fold that only shortens the chain is a change too', async () => {
    const chain = [action(1), action(2), action(3)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null }))
    await commitIt(commit({ events: chain.slice(0, 2), keep: 2, expectHead: chain[2].id }))
    expect(ids((await read())!.events)).toEqual(ids(chain.slice(0, 2)))
  })

  it('an action that comes back keeps its row and takes its place again', async () => {
    const chain = [action(1), action(2), action(3)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null }))
    await commitIt(commit({ events: chain.slice(0, 2), keep: 2, expectHead: chain[2].id }))
    await commitIt(commit({ events: chain, keep: 2, expectHead: chain[1].id }))
    expect(ids((await read())!.events)).toEqual(ids(chain))
    expect((await withEventDb(budget)).pinnedRows).toBe(3)
  })

  it('a forked chain is kept whole, both branches in the order they were held', async () => {
    const spawn = action(1)
    const forked = [spawn, action(2, 'left'), action(2, 'right')]
    await commitIt(commit({ events: forked, keep: 0, expectHead: null }))
    expect(ids((await read())!.events)).toEqual(ids(forked))
  })

  it('one identity\'s chain is never read as another\'s', async () => {
    const other = generateSecretKey()
    const otherPk = getPublicKey(other)
    const theirs = finalizeEvent({ kind: 3333, created_at: 9, tags: [], content: '' }, other) as NostrEvent
    await commitIt(commit({ events: [action(1)], keep: 0, expectHead: null }))
    await commitIt(commit({ pubkey: otherPk, events: [theirs], keep: 0, expectHead: null }))
    expect(ids((await read())!.events)).toHaveLength(1)
    expect((await withEventDb((db) => readChain(db, otherPk)))!.events[0].id).toBe(theirs.id)
    expect(await withEventDb((db) => chainHead(db, 'f'.repeat(64)))).toBeNull()
  })

  it('a full disk writes nothing, and the chain reads as it did', async () => {
    const chain = [action(1), action(2)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null }))
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.name === 'chains') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return real.apply(this, x)
    }
    const next = [...chain, action(3)]
    try {
      await expect(commitIt(commit({ events: next, keep: 2, expectHead: chain[1].id }))).rejects.toMatchObject({ name: 'QuotaExceededError' })
    } finally { proto.put = real }
    expect(ids((await read())!.events)).toEqual(ids(chain))
    expect(await withEventDb((db) => getRows(db, [next[2].id]))).toEqual([])
  })

  it('counts the chain as pinned: your own events are never against the budget', async () => {
    const chain = [action(1), action(2)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null }))
    expect(await withEventDb(budget)).toEqual({ pinnedBytes: JSON.stringify(chain[0]).length + JSON.stringify(chain[1]).length, pinnedRows: 2, unpinnedBytes: 0, unpinnedRows: 0, tombstoneBytes: 0 })
  })
})

describe('a row already here', () => {
  it('forged bytes nobody checked are replaced when the action takes its place, and recounted', async () => {
    const real = action(1)
    await withEventDb((db) => ingest(db, [{ event: { ...real, content: 'FORGED, and longer' }, nip01: 0 }]))
    await commitIt(commit({ events: [real], keep: 0, expectHead: null }))
    const [row] = await withEventDb((db) => getRows(db, [real.id]))
    expect(row).toMatchObject({ content: '', nip01: 1, pin: 1, chainOf: pk, chainN: 0, bytes: JSON.stringify(plain(real)).length })
    expect(await withEventDb(budget)).toMatchObject({ pinnedBytes: JSON.stringify(plain(real)).length, pinnedRows: 1, unpinnedBytes: 0, unpinnedRows: 0 })
  })

  it('a verified row keeps its bytes against a hand that has checked nothing', async () => {
    const real = action(1)
    await withEventDb((db) => ingest(db, [{ event: real, nip01: 1 }]))
    await withEventDb((db) => migrateChain(db, { pubkey: pk, source: source([{ ...real, content: 'changed' }]), parted: [], from: ['test'] }))
    const [row] = await withEventDb((db) => getRows(db, [real.id]))
    expect(row).toMatchObject({ content: '', nip01: 1 })
  })

  it('a sign-later row takes its signature when its signed copy arrives, and keeps its place in the chain', async () => {
    const signed = action(1)
    const unsigned = { ...signed, sig: '' }
    await commitIt({ ...commit({ events: [signed], keep: 0, expectHead: null }), rows: [{ event: unsigned, nip01: 2, acked: false }] })
    expect((await withEventDb((db) => getRows(db, [signed.id])))[0]).toMatchObject({ nip01: 2, sig: '' })
    await withEventDb((db) => ingest(db, [{ event: signed, nip01: 1 }]))
    expect((await withEventDb((db) => getRows(db, [signed.id])))[0]).toMatchObject({ nip01: 1, sig: signed.sig, chainOf: pk, chainN: 0, pin: 1 })
    expect((await read())!.events[0].sig).toBe(signed.sig)
  })
})

describe('reads refuse what a commit cannot leave', () => {
  it('rows and a record that disagree are never read as a chain', async () => {
    const chain = [action(1), action(2)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null }))
    await withEventDb((db) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('events', 'readwrite')
      tx.objectStore('events').delete(chain[1].id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }))
    await expect(read()).rejects.toThrow(/do not match/)
  })
})

describe('moving a chain into rows', () => {
  const chain = Array.from({ length: 450 }, (_, i) => action(i))
  const migrate = (s: ChainSource, parted: ChainSource[] = []) => withEventDb((db) => migrateChain(db, { pubkey: pk, source: s, parted, from: ['test'] }))

  it('copies every action, in order, with what the relays took, and switches', async () => {
    const published = [chain[0].id, chain[1].id]
    expect(await migrate(source(chain, published))).toEqual({ status: 'switched', rows: chain.length, headId: chain[449].id })
    const r = await read()
    expect(ids(r!.events)).toEqual(ids(chain))
    expect(JSON.stringify(r!.events[100])).toBe(JSON.stringify(plain(chain[100])))
    expect(r).toMatchObject({ published, savedAt: 7, generation: 1, headId: chain[449].id, stats, checked: [] })
  })

  it('leaves its mark in meta', async () => {
    await migrate(source(chain))
    const mark = await withEventDb((db) => new Promise((resolve) => {
      const req = db.transaction('meta').objectStore('meta').get(`migrated:chain:${pk}`)
      req.onsuccess = () => resolve(req.result)
    }))
    expect(mark).toMatchObject({ value: { rows: chain.length, headId: chain[449].id, from: ['test'] } })
  })

  it('does not switch when a row reads back differently: nothing reads as a chain, and the next try can still switch', async () => {
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    let damaged = false
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      const row = x[0] as { id?: string; content?: string; chainOf?: string }
      if (this.name === 'events' && !damaged && row.id === chain[300].id && row.chainOf === undefined) {
        damaged = true
        return real.apply(this, [{ ...row, content: 'bit rot' }])
      }
      return real.apply(this, x)
    }
    try {
      expect(await migrate(source(chain))).toEqual({ status: 'unverified', id: chain[300].id })
    } finally { proto.put = real }
    expect(await read()).toBeNull()
  })

  it('a damaged row is put right by the source on the next try, and the chain switches', async () => {
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    let damaged = false
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      const row = x[0] as { id?: string; chainOf?: string }
      if (this.name === 'events' && !damaged && row.id === chain[10].id && row.chainOf === undefined) { damaged = true; return real.apply(this, [{ ...row, content: 'bit rot' }]) }
      return real.apply(this, x)
    }
    try {
      expect(await migrate(source(chain))).toEqual({ status: 'unverified', id: chain[10].id })
    } finally { proto.put = real }
    expect(await migrate(source(chain))).toMatchObject({ status: 'switched' })
    expect((await read())!.events[10].content).toBe(chain[10].content)
  })

  it('a full disk partway through switches nothing', async () => {
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    let n = 0
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.name === 'events' && ++n > 300) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return real.apply(this, x)
    }
    try {
      await expect(migrate(source(chain))).rejects.toMatchObject({ name: 'QuotaExceededError' })
    } finally { proto.put = real }
    expect(await read()).toBeNull()
    expect(await migrate(source(chain))).toMatchObject({ status: 'switched' })
  })

  it('a second tab finds the chain moved, and changes nothing', async () => {
    await migrate(source(chain))
    const further = [...chain, action(500)]
    await commitIt(commit({ events: further, keep: 450, expectHead: chain[449].id }))
    expect(await migrate(source(chain))).toEqual({ status: 'exists' })
    expect(ids((await read())!.events)).toEqual(ids(further))
  })

  it('two tabs moving at once: one switch, and a chain that reads whole', async () => {
    const results = await Promise.all([migrate(source(chain)), migrate(source(chain))])
    expect(results.map((r) => r.status).sort()).toEqual(['exists', 'switched'])
    expect(ids((await read())!.events)).toEqual(ids(chain))
  })

  it('keeps a copy holding other actions as a branch set aside, and never reads it as the chain', async () => {
    const branch = [chain[0], action(600, 'parted')]
    await migrate(source(chain), [source(branch, [], 3)])
    expect(ids((await read())!.events)).toEqual(ids(chain))
    const parted = await withEventDb((db) => partedBranches(db, pk))
    expect(parted).toHaveLength(1)
    expect(parted[0]).toMatchObject({ published: [], stats, held: false, savedAt: 3 })
    expect(ids(parted[0].events)).toEqual(ids(branch))
  })
})

describe('a branch set aside', () => {
  it('pins the rows it finds here, and two in one millisecond are two', async () => {
    const theirs = action(50, 'relay brought')
    await withEventDb((db) => ingest(db, [{ event: theirs, nip01: 1 }]))
    await withEventDb((db) => setAsideBranch(db, pk, source([theirs]), 100))
    expect((await withEventDb((db) => getRows(db, [theirs.id])))[0].pin).toBe(1)
    expect(await withEventDb(budget)).toMatchObject({ pinnedRows: 1, unpinnedRows: 0 })
    await withEventDb((db) => setAsideBranch(db, pk, source([action(51, 'other')]), 100))
    expect(await withEventDb((db) => partedBranches(db, pk))).toHaveLength(2)
  })

  it('is never written over by a save, and the chain\'s rows keep their places', async () => {
    const chain = [action(1), action(2)]
    await commitIt(commit({ events: chain, keep: 0, expectHead: null }))
    const branch = [chain[0], action(3, 'aside')]
    await withEventDb((db) => setAsideBranch(db, pk, source(branch), 100))
    await withEventDb((db) => setAsideBranch(db, pk, source([chain[0], action(4, 'aside too')]), 200))
    const next = [...chain, action(5)]
    await commitIt(commit({ events: next, keep: 2, expectHead: chain[1].id }))
    expect(ids((await read())!.events)).toEqual(ids(next))
    const parted = await withEventDb((db) => partedBranches(db, pk))
    expect(parted).toHaveLength(2)
    expect(ids(parted[0].events)).toEqual(ids(branch))
  })
})
