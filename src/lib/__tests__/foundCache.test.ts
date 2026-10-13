/**
 * foundCache.test.ts: a stored bag is opened again as a fresh find is, or
 * not at all (arkinox, 2026-10-13). Real bags, real keys, real signatures.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, type NostrEvent } from 'nostr-tools/pure'
import { newShard, type ShardModel } from 'sno-core/shards'
import { regionKeyAt } from '../shardCrypto'
import { bytesToHex } from '../events'
import { bagTemplate, messageInnerTemplate, objectTemplate, referenceTo, type Reference } from '../hidden'
import { deletedRows, foundRow, keepsOver, openRow, rowKeyOf, toEvict, unbagRemembered, setFoundSink } from '../foundCache'
import type { FoundBag } from '../foundDb'

const ME = 'ee'.repeat(32)
const hider = generateSecretKey()
const hiderPk = getPublicKey(hider)
const at = { x: 90_000n, y: 4_000n, z: 71n }
const rk = regionKeyAt(at, 6, 20)
const shard: ShardModel = { ...newShard('arch'), mode: 'points', unit: 4, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 2, 3], c: [0, 1, 1] }], faces: [] }

async function bag(entries: (NostrEvent | Reference)[], createdAt = 100, signer = hider): Promise<NostrEvent> {
  return finalizeEvent(await bagTemplate(entries, rk.key, rk.lookupId, 6, createdAt), signer)
}

/** What the sink would be handed for this bag. */
async function remembered(outer: NostrEvent, resolve?: (ref: Reference) => Promise<NostrEvent | null>): Promise<FoundBag> {
  let row: FoundBag | null = null
  setFoundSink((o, keyHex, items, refs, height, origin) => { row = foundRow(ME, o, keyHex, items, refs, height, origin, 1_000) })
  await unbagRemembered(outer, rk.key, resolve, undefined, 6)
  setFoundSink(null)
  if (!row) throw new Error('nothing remembered')
  return row
}

describe('a stored bag opens again as a fresh find does', () => {
  it('a message bag reopens to the same item', async () => {
    const m = finalizeEvent(messageInnerTemplate('under the arch', at, 0, 5), hider)
    const row = await remembered(await bag([m]))
    expect(row.rowKey).toBe(`${ME}/${hiderPk}:${rk.lookupId}`)
    expect(row.keyHex).toBe(bytesToHex(rk.key))
    const items = await openRow(row)
    expect(items?.map((h) => h.text)).toEqual(['under the arch'])
  })

  it('a reference reopens from the stored object, with nobody asked', async () => {
    const o = finalizeEvent(await objectTemplate(shard, rk.key, 'kit-1', 50), hider)
    const ref = referenceTo(o, at, 0, '')
    const row = await remembered(await bag([ref]), async () => o)
    expect(Object.keys(row.refs)).toHaveLength(1)
    const items = await openRow(row)
    expect(items).toHaveLength(1)
    expect(items![0].shard?.name).toBe('arch')
  })

  it('a tampered bag, a tampered object, a wrong key, or a forged owner is dropped', async () => {
    const m = finalizeEvent(messageInnerTemplate('x', at, 0, 5), hider)
    const row = await remembered(await bag([m]))
    expect(await openRow({ ...row, outer: { ...row.outer, content: row.outer.content.slice(0, -4) + 'AAAA' } })).toBeNull()
    expect(await openRow({ ...row, keyHex: bytesToHex(regionKeyAt({ ...at, x: at.x + 10_000n }, 6, 20).key) })).toBeNull()
    expect(await openRow({ ...row, rowKey: `${'dd'.repeat(32)}/${hiderPk}:${rk.lookupId}` })).toBeNull()

    const o = finalizeEvent(await objectTemplate(shard, rk.key, 'kit-2', 50), hider)
    const refRow = await remembered(await bag([referenceTo(o, at, 0, '')]), async () => o)
    const [k] = Object.keys(refRow.refs)
    expect(await openRow({ ...refRow, refs: { [k]: { ...refRow.refs[k], content: 'swapped' } } })).toBeNull()
  })
})

describe('versions and deletions', () => {
  it('the newer version is kept, and a tie goes to the larger id', () => {
    expect(keepsOver({ created_at: 2, id: 'a' }, { created_at: 1, id: 'z' })).toBe(true)
    expect(keepsOver({ created_at: 1, id: 'b' }, { created_at: 1, id: 'a' })).toBe(true)
    expect(keepsOver({ created_at: 1, id: 'a' }, { created_at: 1, id: 'b' })).toBe(false)
  })

  it('only the bag author\'s own deletion removes a row, by id or by address no older than the bag', async () => {
    const outer = await bag([finalizeEvent(messageInnerTemplate('x', at, 0, 5), hider)], 100)
    const row = foundRow(ME, outer, bytesToHex(rk.key), [], {}, 6, undefined, 1)!
    const byId = finalizeEvent({ kind: 5, created_at: 200, tags: [['e', outer.id]], content: '' }, hider)
    const byAddr = finalizeEvent({ kind: 5, created_at: 200, tags: [['a', `33330:${hiderPk}:${rk.lookupId}`]], content: '' }, hider)
    const tooOld = finalizeEvent({ kind: 5, created_at: 50, tags: [['a', `33330:${hiderPk}:${rk.lookupId}`]], content: '' }, hider)
    const stranger = finalizeEvent({ kind: 5, created_at: 200, tags: [['e', outer.id]], content: '' }, generateSecretKey())
    expect(deletedRows([row], [byId])).toEqual([row.rowKey])
    expect(deletedRows([row], [byAddr])).toEqual([row.rowKey])
    expect(deletedRows([row], [tooOld, stranger])).toEqual([])
    expect(deletedRows([row], [])).toEqual([])
  })

  it('a row is keyed by bag address, so a new version of the bag lands on the same row', async () => {
    const a = await bag([finalizeEvent(messageInnerTemplate('v1', at, 0, 5), hider)], 100)
    const b = await bag([finalizeEvent(messageInnerTemplate('v2', at, 0, 6), hider)], 200)
    expect(rowKeyOf(ME, a)).toBe(rowKeyOf(ME, b))
  })
})

describe('the budget', () => {
  const row = (key: string, seenAt: number, pad: number): FoundBag => ({
    rowKey: key, owner: ME, outer: { id: key, pubkey: hiderPk, kind: 33330, created_at: 1, tags: [['d', key]], content: 'x'.repeat(pad), sig: '' }, keyHex: '00'.repeat(32), refs: {}, itemIds: [key], seenAt,
  })
  it('evicts the oldest seen first, only until under budget, and never an exempt row', () => {
    const rows = [row('new', 30, 1000), row('old', 10, 1000), row('mid', 20, 1000), row('starred', 1, 1000)]
    const total = rows.reduce((n, r) => n + JSON.stringify(r).length, 0)
    const one = JSON.stringify(rows[0]).length
    expect(toEvict(rows, total, () => false)).toEqual([])
    expect(toEvict(rows, total - one, (r) => r.rowKey === 'starred')).toEqual(['old'])
    expect(toEvict(rows, total - 2 * one, (r) => r.rowKey === 'starred')).toEqual(['old', 'mid'])
    expect(toEvict(rows, 0, (r) => r.rowKey === 'starred')).toEqual(['old', 'mid', 'new'])
  })
})
