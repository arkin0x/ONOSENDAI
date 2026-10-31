/**
 * store.test.ts - the rules of the event database (onosendai/event-db-design.md,
 * section 3.6), on fake-indexeddb. Unit tests never touch the network.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { closeEventDb, withEventDb } from '../connection'
import { addressOf, keptKind, tagIndexOf, type EventRow } from '../schema'
import { budget, byAddress, byAuthorKind, byKind, byTag, getRows, ingest } from '../store'
import type { NostrEvent } from '../../events'

const alice = generateSecretKey()
const mallory = generateSecretKey()
const alicePk = getPublicKey(alice)

const sign = (sk: Uint8Array, kind: number, created_at: number, tags: string[][] = [], content = ''): NostrEvent =>
  finalizeEvent({ kind, created_at, tags, content }, sk) as NostrEvent

const put = (events: NostrEvent[], opts: { relay?: string; pin?: boolean } = {}, now?: number) =>
  withEventDb((db) => ingest(db, events.map((event) => ({ event, nip01: 1 as const, ...opts })), now))
const row = async (id: string): Promise<EventRow | undefined> => (await withEventDb((db) => getRows(db, [id])))[0]

beforeEach(() => {
  closeEventDb()
  ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
})

describe('a row', () => {
  it('is the event as it arrived, with the flags beside it, and ciphertext stays ciphertext', async () => {
    const e = sign(alice, 33330, 1000, [['d', 'lookup'], ['X', '12'], ['mp', 'ab'.repeat(3000)]], 'ciphertext')
    await put([e], { relay: 'wss://a/' })
    const r = await row(e.id)
    expect(r).toMatchObject({ id: e.id, content: 'ciphertext', sig: e.sig, tags: e.tags, nip01: 1, proof: 0, chain: 0, pin: 0, seen: ['wss://a/'], addr: `33330:${alicePk}:lookup` })
    expect(r!.bytes).toBe(JSON.stringify(e).length)
    expect(r!.tagx.sort()).toEqual(['X:12', 'd:lookup'])
  })

  it('takes only the seven fields of the event, whatever else the object carries', async () => {
    const e = { ...sign(alice, 1, 1000), extra: 'a symbol or a field a library added' } as NostrEvent
    await put([e])
    expect((await row(e.id)) as unknown as { extra?: string }).not.toHaveProperty('extra')
  })

  it('indexes only the letters read locally, and no value too long to look up', () => {
    expect(tagIndexOf({ tags: [['e', 'x'], ['client', 'y'], ['mp', 'z'], ['e', 'x'], ['p', 'q'.repeat(300)]] })).toEqual(['e:x'])
  })

  it('names addresses for replaceable and addressable kinds only', () => {
    expect(addressOf({ kind: 0, pubkey: 'p', tags: [] })).toBe('0:p:')
    expect(addressOf({ kind: 10002, pubkey: 'p', tags: [] })).toBe('10002:p:')
    expect(addressOf({ kind: 33331, pubkey: 'p', tags: [['d', 'x']] })).toBe('33331:p:x')
    expect(addressOf({ kind: 3333, pubkey: 'p', tags: [['d', 'x']] })).toBeUndefined()
  })
})

describe('what is kept', () => {
  it('refuses ephemeral kinds but the chat envelope, auth and wallet traffic, and anchors', async () => {
    for (const k of [22242, 23194, 23195, 23334, 24242, 27235, 321]) expect(keptKind(k)).toBe(false)
    for (const k of [0, 3, 5, 7, 3333, 11333, 23330, 33330, 33331, 1059]) expect(keptKind(k)).toBe(true)
    const e = sign(alice, 22242, 1000)
    expect((await put([e])).refused).toEqual([e.id])
    expect(await row(e.id)).toBeUndefined()
  })

  it('refuses an event past its expiration, and hands out none that expired since', async () => {
    const past = sign(alice, 1, 1000, [['expiration', '1500']])
    expect((await put([past], {}, 2_000_000)).refused).toEqual([past.id])
    const soon = sign(alice, 1, 1000, [['expiration', '1500']])
    await put([soon], {}, 1_000_000)
    expect(await withEventDb((db) => byKind(db, 1, 10, 1_000_000))).toHaveLength(1)
    expect(await withEventDb((db) => byKind(db, 1, 10, 2_000_000))).toHaveLength(0)
  })
})

describe('an event that arrives again', () => {
  it('adds the relay to `seen`, and the row is otherwise as it was', async () => {
    const e = sign(alice, 3333, 1000)
    await put([e], { relay: 'wss://a/' })
    const before = await row(e.id)
    expect((await put([e], { relay: 'wss://b/' })).known).toEqual([e.id])
    expect(await row(e.id)).toEqual({ ...before, seen: ['wss://a/', 'wss://b/'] })
    await put([e], { relay: 'wss://a/' })
    expect((await row(e.id))!.seen).toEqual(['wss://a/', 'wss://b/'])
  })

  it('never loses a check that passed', async () => {
    const e = sign(alice, 3333, 1000)
    await withEventDb((db) => ingest(db, [{ event: e, nip01: 1 }]))
    await withEventDb((db) => ingest(db, [{ event: e, nip01: 0 }]))
    expect((await row(e.id))!.nip01).toBe(1)
    const m = sign(alice, 3333, 1001)
    await withEventDb((db) => ingest(db, [{ event: m, nip01: 0 }]))
    await withEventDb((db) => ingest(db, [{ event: m, nip01: 1 }]))
    expect((await row(m.id))!.nip01).toBe(1)
  })
})

describe('replaceable and addressable', () => {
  it('the newer wins, the older keeps its row without the address', async () => {
    const old = sign(alice, 33331, 1000, [['d', 'x']])
    const fresh = sign(alice, 33331, 1001, [['d', 'x']])
    await put([old])
    await put([fresh])
    expect((await withEventDb((db) => byAddress(db, `33331:${alicePk}:x`)))?.id).toBe(fresh.id)
    expect((await row(old.id))!.addr).toBeUndefined()
    expect(await row(old.id)).toBeDefined()
  })

  it('an older one arriving late takes nothing from the newer', async () => {
    const old = sign(alice, 0, 1000)
    const fresh = sign(alice, 0, 1001)
    await put([fresh])
    await put([old])
    expect((await withEventDb((db) => byAddress(db, `0:${alicePk}:`)))?.id).toBe(fresh.id)
    expect((await row(old.id))!.addr).toBeUndefined()
  })

  it('on a tie the lower id wins, whichever came first', async () => {
    const a = sign(alice, 33331, 1000, [['d', 'x'], ['n', '1']])
    const b = sign(alice, 33331, 1000, [['d', 'x'], ['n', '2']])
    const [low, high] = a.id < b.id ? [a, b] : [b, a]
    await put([high])
    await put([low])
    expect((await withEventDb((db) => byAddress(db, `33331:${alicePk}:x`)))?.id).toBe(low.id)
    await put([high])
    expect((await withEventDb((db) => byAddress(db, `33331:${alicePk}:x`)))?.id).toBe(low.id)
  })

  it('other people at the same d are other addresses', async () => {
    const a = sign(alice, 33331, 1000, [['d', 'x']])
    const m = sign(mallory, 33331, 2000, [['d', 'x']])
    await put([a, m])
    expect((await withEventDb((db) => byAddress(db, `33331:${alicePk}:x`)))?.id).toBe(a.id)
  })
})

describe('deletions', () => {
  it('the author can delete their event; the row goes, the deletion stays, and it stays deleted', async () => {
    const e = sign(alice, 7, 1000)
    const del = sign(alice, 5, 1001, [['e', e.id]])
    await put([e])
    await put([del])
    expect(await row(e.id)).toBeUndefined()
    expect(await row(del.id)).toBeDefined()
    expect((await put([e])).refused).toEqual([e.id])
  })

  it('a deletion that arrives first still refuses the event', async () => {
    const e = sign(alice, 7, 1000)
    await put([sign(alice, 5, 1001, [['e', e.id]])])
    expect((await put([e])).refused).toEqual([e.id])
  })

  it('nobody else can delete it, or get in ahead of it', async () => {
    const e = sign(alice, 7, 1000)
    await put([sign(mallory, 5, 900, [['e', e.id]])])
    expect((await put([e])).added).toEqual([e.id])
    await put([sign(mallory, 5, 1001, [['e', e.id]])])
    expect(await row(e.id)).toBeDefined()
    const bag = sign(alice, 33330, 1000, [['d', 'x']])
    await put([bag])
    await put([sign(mallory, 5, 1001, [['a', `33330:${alicePk}:x`]])])
    expect(await withEventDb((db) => byAddress(db, `33330:${alicePk}:x`))).not.toBeNull()
  })

  it('a pinned row is marked and kept, because your own history is the chain\'s evidence', async () => {
    const e = sign(alice, 33330, 1000, [['d', 'x']])
    await put([e], { pin: true })
    await put([sign(alice, 5, 1001, [['e', e.id]])])
    expect((await row(e.id))!.deleted).toBe(1)
    expect(await withEventDb((db) => byKind(db, 33330))).toHaveLength(0)
  })

  it('an address comes back with a version newer than the deletion, and not with an older one', async () => {
    const old = sign(alice, 33330, 1000, [['d', 'x'], ['v', '1']])
    await put([old])
    await put([sign(alice, 5, 1005, [['a', `33330:${alicePk}:x`]])])
    expect(await withEventDb((db) => byAddress(db, `33330:${alicePk}:x`))).toBeNull()
    const stale = sign(alice, 33330, 1002, [['d', 'x'], ['v', '2']])
    expect((await put([stale])).refused).toEqual([stale.id])
    const fresh = sign(alice, 33330, 1010, [['d', 'x'], ['v', '3']])
    expect((await put([fresh])).added).toEqual([fresh.id])
    expect((await withEventDb((db) => byAddress(db, `33330:${alicePk}:x`)))?.id).toBe(fresh.id)
  })
})

describe('reads', () => {
  it('finds by author and kind, by kind and by tag, newest first, with no field the row added', async () => {
    const a1 = sign(alice, 3333, 1000, [['X', '1']])
    const a2 = sign(alice, 3333, 1002, [['X', '1']])
    const m1 = sign(mallory, 3333, 1001, [['X', '1']])
    const other = sign(alice, 7, 1003, [['X', '2']])
    await put([a1, a2, m1, other])
    expect((await withEventDb((db) => byAuthorKind(db, alicePk, 3333))).map((e) => e.id)).toEqual([a2.id, a1.id])
    expect((await withEventDb((db) => byAuthorKind(db, alicePk, 3333, 1))).map((e) => e.id)).toEqual([a2.id])
    expect((await withEventDb((db) => byKind(db, 3333))).map((e) => e.id)).toEqual([a2.id, m1.id, a1.id])
    expect((await withEventDb((db) => byTag(db, 'X:1'))).map((e) => e.id)).toEqual([a2.id, m1.id, a1.id])
    expect(Object.keys((await withEventDb((db) => byKind(db, 7)))[0]).sort()).toEqual(['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags'])
  })
})

describe('the budget', () => {
  it('counts pinned and unpinned bytes exactly, through arrivals, pins and deletions', async () => {
    const mine = sign(alice, 3333, 1000)
    const theirs = sign(mallory, 3333, 1000)
    await put([mine], { pin: true })
    await put([theirs])
    await put([theirs], { relay: 'wss://again/' })
    const size = (e: NostrEvent) => JSON.stringify(e).length
    expect(await withEventDb(budget)).toEqual({ pinnedBytes: size(mine), pinnedRows: 1, unpinnedBytes: size(theirs), unpinnedRows: 1 })
    await put([theirs], { pin: true })
    expect(await withEventDb(budget)).toEqual({ pinnedBytes: size(mine) + size(theirs), pinnedRows: 2, unpinnedBytes: 0, unpinnedRows: 0 })
    const gone = sign(mallory, 7, 1000)
    const del = sign(mallory, 5, 1001, [['e', gone.id]])
    await put([gone])
    await put([del])
    expect((await withEventDb(budget)).unpinnedBytes).toBe(size(del))
  })
})

describe('a write that cannot land', () => {
  it('a full disk writes none of the batch, and says so by name', async () => {
    const a = sign(alice, 7, 1000)
    const b = sign(alice, 7, 1001)
    const proto = IDBObjectStore.prototype as unknown as { put: (...x: unknown[]) => unknown }
    const real = proto.put
    let n = 0
    proto.put = function (this: IDBObjectStore, ...x: unknown[]) {
      if (this.name === 'events' && ++n === 2) { this.transaction.abort(); throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
      return real.apply(this, x)
    }
    try {
      await expect(put([a, b])).rejects.toBeDefined()
    } finally {
      proto.put = real
    }
    expect(await row(a.id)).toBeUndefined()
    expect((await put([a])).added).toEqual([a.id])
  })
})
