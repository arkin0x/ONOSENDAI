/**
 * store.test.ts - the rules of the event database (onosendai/event-db-design.md,
 * section 3.6), on fake-indexeddb. Unit tests never touch the network.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { closeEventDb, withEventDb } from '../connection'
import { TAG_ENTRIES_MAX, addressOf, keptEvent, keptKind, tagIndexOf, type EventRow } from '../schema'
import { DELETION_TARGETS_MAX, READ_LIMIT_DEFAULT, budget, byAddress, byAuthorKind, byKind, byTag, getRows, inTransaction, ingest } from '../store'
import type { NostrEvent } from '../../events'

const alice = generateSecretKey()
const mallory = generateSecretKey()
const alicePk = getPublicKey(alice)

const sign = (sk: Uint8Array, kind: number, created_at: number, tags: string[][] = [], content = ''): NostrEvent =>
  finalizeEvent({ kind, created_at, tags, content }, sk) as NostrEvent

const put = (events: NostrEvent[], opts: { relay?: string; pin?: boolean; nip01?: 0 | 1 | 2 } = {}, now?: number) =>
  withEventDb((db) => ingest(db, events.map((event) => ({ event, nip01: opts.nip01 ?? (1 as const), relay: opts.relay, pin: opts.pin })), now))
const size = (e: NostrEvent): number => new TextEncoder().encode(JSON.stringify(e)).length
const countOf = (store: string) => withEventDb((db) => new Promise<number>((resolve) => { const r = db.transaction(store).objectStore(store).count(); r.onsuccess = () => resolve(r.result) }))
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
    expect(r!.bytes).toBe(size(e))
    expect([...r!.tagx].sort()).toEqual([['X:12', 1000], ['d:lookup', 1000]])
  })

  it('takes only the seven fields of the event, whatever else the object carries', async () => {
    const e = { ...sign(alice, 1, 1000), extra: 'a symbol or a field a library added' } as NostrEvent
    await put([e])
    expect((await row(e.id)) as unknown as { extra?: string }).not.toHaveProperty('extra')
  })

  it('indexes only the letters read locally, and no value too long to look up', () => {
    expect(tagIndexOf({ created_at: 5, tags: [['e', 'x'], ['client', 'y'], ['mp', 'z'], ['e', 'x'], ['p', 'q'.repeat(300)]] })).toEqual([['e:x', 5]])
  })

  it('indexes the combined sector tag, and stops at a cap so one event cannot bloat the index', () => {
    expect(tagIndexOf({ created_at: 5, tags: [['S', '1-2-3']] })).toEqual([['S:1-2-3', 5]])
    const many = Array.from({ length: TAG_ENTRIES_MAX + 50 }, (_, i) => ['e', String(i)])
    expect(tagIndexOf({ created_at: 5, tags: many })).toHaveLength(TAG_ENTRIES_MAX)
  })

  it('counts bytes, not UTF-16 units', async () => {
    const e = sign(alice, 7, 1000, [], '漢'.repeat(1000))
    await put([e])
    expect((await row(e.id))!.bytes).toBe(new TextEncoder().encode(JSON.stringify(e)).length)
    expect((await row(e.id))!.bytes).toBeGreaterThan(JSON.stringify(e).length)
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
    for (const k of [22242, 23194, 23195, 23334, 24242, 27235, 321, 13, 14, 3330, 3340, 3341]) expect(keptKind(k)).toBe(false)
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

describe('what is kept, by its contents', () => {
  it('refuses anything carrying a private key, whatever its kind, pinned or not', async () => {
    const key = sign(alice, 1, 1000, [['secret', 'deadbeef']], 'text')
    expect(keptEvent(key)).toBe(false)
    expect((await put([key], { pin: true })).refused).toEqual([key.id])
    expect(await row(key.id)).toBeUndefined()
  })

  it('refuses an event more than an hour ahead, and takes one less than an hour ahead', async () => {
    const now = 1_800_000_000_000
    const far = sign(mallory, 33331, 1_800_000_000 + 3_601, [['d', 'spam']])
    const near = sign(mallory, 33331, 1_800_000_000 + 3_599, [['d', 'fine']])
    expect((await put([far], {}, now)).refused).toEqual([far.id])
    expect((await put([near], {}, now)).added).toEqual([near.id])
  })

  it('takes a far-ahead pinned row and a far-ahead movement action: a chain has its own clock', async () => {
    const now = 1_800_000_000_000
    const mine = sign(alice, 7, 1_900_000_000)
    const action = sign(mallory, 3333, 1_900_000_000)
    expect((await put([mine], { pin: true }, now)).added).toEqual([mine.id])
    expect((await put([action], {}, now)).added).toEqual([action.id])
  })

  it('one malformed event costs the batch nothing, and is refused by its id', async () => {
    const good = sign(alice, 7, 1000)
    const noTags = { id: 'a'.repeat(64), pubkey: alicePk, created_at: 1, kind: 7, content: '', sig: '' } as unknown as NostrEvent
    const noId = { pubkey: alicePk, created_at: 1, kind: 7, tags: [], content: '', sig: '' } as unknown as NostrEvent
    const badTag = { ...sign(alice, 7, 1001), tags: [['e', 5]] } as unknown as NostrEvent
    const r = await put([noTags, good, noId, badTag])
    expect(r.added).toEqual([good.id])
    expect(r.refused).toEqual([noTags.id, '', badTag.id])
    expect(await row(good.id)).toBeDefined()
    expect((await withEventDb(budget)).unpinnedRows).toBe(1)
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

describe('the NIP-01 flag describes the bytes beside it', () => {
  it('a verified arrival replaces forged bytes under the same id, with the size recounted', async () => {
    const real = sign(alice, 3333, 1000, [['X', '1']], 'real')
    const forged = { ...real, content: 'FORGED and much longer than the real one', sig: 'f'.repeat(128), tags: [] }
    await put([forged], { nip01: 0, pin: true, relay: 'wss://a/' })
    await put([real], { nip01: 1, relay: 'wss://b/' })
    const r = await row(real.id)
    expect(r).toMatchObject({ nip01: 1, content: 'real', sig: real.sig, tags: real.tags, tagx: [['X:1', 1000]], bytes: size(real), pin: 1, seen: ['wss://a/', 'wss://b/'] })
    expect(await withEventDb(budget)).toMatchObject({ pinnedBytes: size(real), pinnedRows: 1 })
  })

  it('a sign-later row takes the signature when its signed copy arrives', async () => {
    const signed = sign(alice, 3333, 1000)
    await put([{ ...signed, sig: '' }], { nip01: 2, pin: true })
    await put([signed], { relay: 'wss://a/' })
    expect(await row(signed.id)).toMatchObject({ nip01: 1, sig: signed.sig, pin: 1 })
    expect((await withEventDb(budget)).pinnedBytes).toBe(size(signed))
  })

  it('a sign-later copy outranks nothing checked, and never replaces a verified row', async () => {
    const signed = sign(alice, 3333, 1000)
    await put([signed], { nip01: 1 })
    await put([{ ...signed, sig: '' }], { nip01: 2 })
    expect(await row(signed.id)).toMatchObject({ nip01: 1, sig: signed.sig })
    const m = sign(alice, 3333, 1001)
    await put([{ ...m, content: 'FORGED' }], { nip01: 0 })
    await put([{ ...m, sig: '' }], { nip01: 2 })
    expect(await row(m.id)).toMatchObject({ nip01: 2, content: '', sig: '' })
    await put([{ ...m, content: 'FORGED' }], { nip01: 0 })
    expect(await row(m.id)).toMatchObject({ nip01: 2, content: '' })
  })

  it('a row replaced keeps what was known of the row: its verdicts and its place', async () => {
    const real = sign(alice, 3333, 1000)
    await put([{ ...real, content: 'forged' }], { nip01: 0 })
    await withEventDb((db) => new Promise<void>((resolve) => {
      const tx = db.transaction('events', 'readwrite')
      const os = tx.objectStore('events')
      const g = os.get(real.id)
      g.onsuccess = () => os.put({ ...g.result, chainOf: alicePk, chainN: 4, proof: 1, chain: 1, chainEpoch: 2, acked: 1 })
      tx.oncomplete = () => resolve()
    }))
    await put([real], { nip01: 1 })
    expect(await row(real.id)).toMatchObject({ chainOf: alicePk, chainN: 4, proof: 1, chain: 1, chainEpoch: 2, acked: 1, content: '' })
  })
})

describe('rules never act on what nobody checked', () => {
  it('an unchecked deletion deletes nothing and leaves no tombstone', async () => {
    const victim = sign(alice, 7, 1000)
    await put([victim])
    const forged: NostrEvent = { id: 'a'.repeat(64), pubkey: alicePk, created_at: 1001, kind: 5, tags: [['e', victim.id]], content: '', sig: 'b'.repeat(128) }
    expect((await put([forged], { nip01: 0 })).refused).toEqual([forged.id])
    expect(await row(victim.id)).toBeDefined()
    expect(await countOf('deletions')).toBe(0)
    expect(await row(forged.id)).toBeUndefined()
  })

  it('an unchecked or unsigned address kind never takes the address', async () => {
    const real = sign(alice, 0, 1000)
    await put([real])
    const forged: NostrEvent = { id: 'c'.repeat(64), pubkey: alicePk, created_at: 5_000, kind: 0, tags: [], content: '{}', sig: 'd'.repeat(128) }
    expect((await put([forged], { nip01: 0 })).refused).toEqual([forged.id])
    expect((await put([forged], { nip01: 2 })).refused).toEqual([forged.id])
    expect((await withEventDb((db) => byAddress(db, `0:${alicePk}:`)))?.id).toBe(real.id)
  })

  it('reads do not hand out an unchecked row, and asking for it by id still finds it', async () => {
    const e = sign(alice, 7, 1000, [['X', '1']])
    await put([e], { nip01: 0 })
    expect(await withEventDb((db) => byKind(db, 7))).toEqual([])
    expect(await withEventDb((db) => byAuthorKind(db, alicePk, 7))).toEqual([])
    expect(await withEventDb((db) => byTag(db, 'X:1'))).toEqual([])
    expect(await row(e.id)).toBeDefined()
    await put([e], { nip01: 1 })
    expect(await withEventDb((db) => byKind(db, 7))).toHaveLength(1)
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

  it('on a tie, a higher id arriving second takes nothing', async () => {
    const a = sign(alice, 33331, 1000, [['d', 'y'], ['n', '1']])
    const b = sign(alice, 33331, 1000, [['d', 'y'], ['n', '2']])
    const [low, high] = a.id < b.id ? [a, b] : [b, a]
    await put([low])
    await put([high])
    expect((await withEventDb((db) => byAddress(db, `33331:${alicePk}:y`)))?.id).toBe(low.id)
    expect((await row(high.id))!.addr).toBeUndefined()
  })

  it('reads hand out the current version only, and an older one is still found by id', async () => {
    const old = sign(alice, 33331, 1000, [['d', 'x'], ['v', '1']])
    const fresh = sign(alice, 33331, 1001, [['d', 'x'], ['v', '2']])
    await put([old, fresh])
    expect((await withEventDb((db) => byKind(db, 33331))).map((e) => e.id)).toEqual([fresh.id])
    expect((await withEventDb((db) => byAuthorKind(db, alicePk, 33331))).map((e) => e.id)).toEqual([fresh.id])
    expect((await withEventDb((db) => byTag(db, 'd:x'))).map((e) => e.id)).toEqual([fresh.id])
    expect(await row(old.id)).toBeDefined()
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

  it('a pinned row is marked and kept, and reads do not hand it out', async () => {
    const e = sign(alice, 33330, 1000, [['d', 'x']])
    await put([e], { pin: true })
    await put([sign(alice, 5, 1001, [['e', e.id]])])
    expect((await row(e.id))!.deleted).toBe(1)
    expect(await withEventDb((db) => byKind(db, 33330))).toHaveLength(0)
  })

  it('your own event ends the same whichever comes first, it or its deletion', async () => {
    const e = sign(alice, 7, 1000)
    const del = sign(alice, 5, 1001, [['e', e.id]])
    await put([del])
    const r = await put([e], { pin: true })
    expect(r.added).toEqual([e.id])
    const first = await row(e.id)
    expect(first).toMatchObject({ deleted: 1, pin: 1 })
    closeEventDb()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
    await put([e], { pin: true })
    await put([del])
    expect((await row(e.id))?.deleted).toBe(first?.deleted)
  })

  it('a deleted pinned version gives the address up: a newer one can take it', async () => {
    const e = sign(alice, 33330, 1000, [['d', 'x']])
    await put([e], { pin: true })
    await put([sign(alice, 5, 1001, [['a', `33330:${alicePk}:x`]])])
    const fresh = sign(alice, 33330, 1002, [['d', 'x']])
    expect((await put([fresh], { pin: true })).added).toEqual([fresh.id])
    expect((await withEventDb((db) => byAddress(db, `33330:${alicePk}:x`)))?.id).toBe(fresh.id)
  })

  it('a kind 5 has no effect on a movement action, on the row or on a later arrival: a fork is still a fork', async () => {
    const action = sign(alice, 3333, 1000)
    await put([action])
    const del = sign(alice, 5, 1001, [['e', action.id]])
    expect((await put([del])).struck).toEqual([])
    expect((await row(action.id))?.deleted).toBeUndefined()
    const later = sign(alice, 3333, 1002)
    await put([sign(alice, 5, 1003, [['e', later.id]])])
    expect((await put([later])).added).toEqual([later.id])
    expect(await withEventDb((db) => byAuthorKind(db, alicePk, 3333))).toHaveLength(2)
  })

  it('a deletion against a deletion does nothing, whichever arrives first', async () => {
    const del = sign(alice, 5, 1000, [['e', 'f'.repeat(64)]])
    const against = sign(alice, 5, 1001, [['e', del.id]])
    await put([del])
    await put([against])
    expect(await row(del.id)).toBeDefined()
    closeEventDb()
    ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = new IDBFactory()
    await put([against])
    expect((await put([del])).added).toEqual([del.id])
  })

  it('a deletion older than the current version leaves it', async () => {
    const cur = sign(alice, 33330, 2000, [['d', 'x']])
    await put([cur])
    expect((await put([sign(alice, 5, 1000, [['a', `33330:${alicePk}:x`]])])).struck).toEqual([])
    expect((await withEventDb((db) => byAddress(db, `33330:${alicePk}:x`)))?.id).toBe(cur.id)
  })

  it('a version with the same time as the deletion stays deleted', async () => {
    await put([sign(alice, 5, 1005, [['a', `33330:${alicePk}:x`]])])
    const same = sign(alice, 33330, 1005, [['d', 'x']])
    expect((await put([same])).refused).toEqual([same.id])
  })

  it('a newer deletion of the address replaces the older one, and an older one does not take it back', async () => {
    const addr = `33330:${alicePk}:x`
    const older = sign(alice, 5, 1000, [['a', addr]])
    const newer = sign(alice, 5, 1010, [['a', addr]])
    await put([older])
    await put([newer])
    const between = sign(alice, 33330, 1007, [['d', 'x']])
    expect((await put([between])).refused).toEqual([between.id])
    const third = sign(alice, 5, 900, [['a', addr]])
    await put([third])
    const stillBetween = sign(alice, 33330, 1008, [['d', 'x']])
    expect((await put([stillBetween])).refused).toEqual([stillBetween.id])
    const tomb = await withEventDb((db) => new Promise<{ by: string }>((resolve) => { const r = db.transaction('deletions').objectStore('deletions').get(`a:${addr}`); r.onsuccess = () => resolve(r.result as { by: string }) }))
    expect(tomb.by).toBe(newer.id)
  })

  it('a deletion naming more than the cap is refused whole: no row, no tombstones', async () => {
    const tags = Array.from({ length: DELETION_TARGETS_MAX + 1 }, (_, i) => ['e', i.toString(16).padStart(64, '0')])
    const big = sign(mallory, 5, 1000, tags)
    expect((await put([big])).refused).toEqual([big.id])
    expect(await countOf('deletions')).toBe(0)
    const atCap = sign(mallory, 5, 1001, tags.slice(0, DELETION_TARGETS_MAX))
    expect((await put([atCap])).added).toEqual([atCap.id])
    expect(await countOf('deletions')).toBe(DELETION_TARGETS_MAX)
  })

  it('tombstones are counted, and a replaced one is not counted twice', async () => {
    const addr = `33330:${alicePk}:x`
    await put([sign(alice, 5, 1000, [['a', addr]])])
    const one = (await withEventDb(budget)).tombstoneBytes
    expect(one).toBeGreaterThan(0)
    await put([sign(alice, 5, 1001, [['a', addr]])])
    expect((await withEventDb(budget)).tombstoneBytes).toBe(one)
    await put([sign(alice, 5, 1002, [['a', `${addr}2`]])])
    expect((await withEventDb(budget)).tombstoneBytes).toBeGreaterThan(one)
  })

  it('says which rows it struck', async () => {
    const e = sign(alice, 7, 1000)
    await put([e])
    expect((await put([sign(alice, 5, 1001, [['e', e.id]])])).struck).toEqual([e.id])
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

describe('limited reads', () => {
  it('byTag stops at its limit, newest first, reading no further', async () => {
    const events = Array.from({ length: 60 }, (_, i) => sign(mallory, 7, 1000 + i, [['X', 'same']]))
    await put(events)
    const proto = IDBCursor.prototype as unknown as { continue: (...a: unknown[]) => unknown }
    const real = proto.continue
    let steps = 0
    proto.continue = function (this: IDBCursor, ...a: unknown[]) { steps++; return real.apply(this, a) }
    try {
      expect((await withEventDb((db) => byTag(db, 'X:same', 2))).map((e) => e.id)).toEqual([events[59].id, events[58].id])
    } finally { proto.continue = real }
    expect(steps).toBe(1)
  })

  it('byTag reads one value only, not its neighbors in the key order', async () => {
    await put([sign(alice, 7, 1000, [['X', '1']]), sign(alice, 7, 1001, [['X', '10']])])
    expect(await withEventDb((db) => byTag(db, 'X:1'))).toHaveLength(1)
  })

  it('a read that does not say how many has a finite limit', async () => {
    expect(Number.isFinite(READ_LIMIT_DEFAULT)).toBe(true)
    const events = Array.from({ length: 3 }, (_, i) => sign(alice, 7, 1000 + i))
    await put(events)
    expect(await withEventDb((db) => byKind(db, 7, 2))).toHaveLength(2)
    expect(await withEventDb((db) => byAuthorKind(db, alicePk, 7, 2))).toHaveLength(2)
  })
})

describe('the budget', () => {
  it('counts pinned and unpinned bytes exactly, through arrivals, pins and deletions', async () => {
    const mine = sign(alice, 3333, 1000)
    const theirs = sign(mallory, 3333, 1000)
    await put([mine], { pin: true })
    await put([theirs])
    await put([theirs], { relay: 'wss://again/' })
    expect(await withEventDb(budget)).toEqual({ pinnedBytes: size(mine), pinnedRows: 1, unpinnedBytes: size(theirs), unpinnedRows: 1, tombstoneBytes: 0 })
    await put([theirs], { pin: true })
    expect(await withEventDb(budget)).toEqual({ pinnedBytes: size(mine) + size(theirs), pinnedRows: 2, unpinnedBytes: 0, unpinnedRows: 0, tombstoneBytes: 0 })
    // A relay's copy of a pinned row leaves it pinned, and the totals where they are.
    await put([mine], { relay: 'wss://hostile/' })
    expect((await row(mine.id))!.pin).toBe(1)
    expect((await withEventDb(budget)).pinnedRows).toBe(2)
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
      await expect(put([a, b])).rejects.toMatchObject({ name: 'QuotaExceededError' })
    } finally {
      proto.put = real
    }
    expect(await row(a.id)).toBeUndefined()
    expect((await withEventDb(budget)).unpinnedRows).toBe(0)
    expect((await put([a])).added).toEqual([a.id])
  })
})

describe('inTransaction', () => {
  /** A transaction whose ending the test decides. */
  function fakeTx(error: unknown = null) {
    const tx = { oncomplete: null as null | (() => void), onerror: null as null | (() => void), onabort: null as null | (() => void), error, aborted: 0, abort() { this.aborted++; this.onabort?.() } }
    return tx
  }

  it('does not answer until the transaction has committed', async () => {
    const tx = fakeTx()
    let answered = false
    const done = inTransaction(tx as unknown as IDBTransaction, async () => 'value').then((v) => { answered = true; return v })
    await new Promise((r) => setTimeout(r, 5))
    expect(answered).toBe(false)
    tx.oncomplete?.()
    expect(await done).toBe('value')
  })

  it('a body that fails aborts the transaction, so none of it lands', async () => {
    const tx = fakeTx()
    await expect(inTransaction(tx as unknown as IDBTransaction, async () => { throw new Error('the body') })).rejects.toThrow('the body')
    expect(tx.aborted).toBe(1)
  })

  it('rejects with what the transaction reports, by name, over what the body met', async () => {
    const tx = fakeTx(new DOMException('full', 'QuotaExceededError'))
    await expect(inTransaction(tx as unknown as IDBTransaction, async () => { throw new DOMException('aborted', 'AbortError') })).rejects.toMatchObject({ name: 'QuotaExceededError' })
  })

  it('a transaction that aborts by itself after the body is done rejects, by name', async () => {
    const tx = fakeTx(new DOMException('full', 'QuotaExceededError'))
    const done = inTransaction(tx as unknown as IDBTransaction, async () => 'value')
    await new Promise((r) => setTimeout(r, 0))
    tx.onabort?.()
    await expect(done).rejects.toMatchObject({ name: 'QuotaExceededError' })
  })
})
