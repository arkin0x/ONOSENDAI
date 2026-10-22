/**
 * takenTidy.test.ts: the TAKEN list (arkinox, 2026-10-11). One shard per
 * model, so a chest's two identical Columns are taken once; a row moved
 * into the workshop or cleared leaves the list but stays held, so its chest
 * still says TAKEN; CLEAR ALL never clears a coin.
 */

import { describe, expect, it } from 'vitest'
import { newShard, vertexAt } from 'sno-core/shards'
import type { ShardModel } from 'sno-core/shards'
import { clearsWithAll, holdsModel, modelPrint, splitPanels, type HeldItem } from '../inventory'
import { hasNftLink } from '../nftLink'

const column = (name: string, id: string, x = 0): ShardModel => ({
  ...newShard(name),
  id,
  vertices: [[x, 0, 0], [1, 0, 0], [0, 1, 0]].map((p) => vertexAt(p as [number, number, number], [255, 255, 255])),
  faces: [[0, 1, 2]],
})

const held = (id: string, extra: Partial<HeldItem>): HeldItem => ({
  rowKey: `me/${id}`, owner: 'me', id, type: 'shard', name: id, event: { id, pubkey: 'p', created_at: 1, kind: 1, tags: [], content: '', sig: '' },
  author: 'p', verified: true, source: 'taken', place: null, from: null, at: 1, ...extra,
})

describe('one shard per model', () => {
  it('sets the name and id aside: two identical Columns are one model', () => {
    expect(modelPrint(column('Column', 'a'))).toBe(modelPrint(column('Pillar', 'b')))
    expect(modelPrint(column('Column', 'a'))).not.toBe(modelPrint(column('Column', 'a', 3)))
  })

  it('a model already held, cleared or not, counts as held', () => {
    const items = { a: held('a', { shard: column('Column', 'a'), cleared: 5 }) }
    expect(holdsModel(items, column('Column', 'other'))).toBe(true)
    expect(holdsModel(items, column('Pool', 'pool', 7))).toBe(false)
  })
})

describe('leaving the TAKEN list', () => {
  it('a cleared row is not listed, and is still held', () => {
    const items = [held('a', { cleared: 5 }), held('b', {})]
    expect(splitPanels([], items).loot.taken.map((t) => t.id)).toEqual(['b'])
  })

  it('CLEAR ALL leaves coins, which are money', () => {
    const coin = (t: string | undefined) => (t ?? '').startsWith('cashuB')
    expect(clearsWithAll({ type: 'message', text: 'cashuBo2F0...' }, coin)).toBe(false)
    expect(clearsWithAll({ type: 'message', text: 'hello' }, coin)).toBe(true)
    expect(clearsWithAll({ type: 'shard', text: undefined }, coin)).toBe(true)
    // An unclaimed NFT swept up by CLEAR ALL could never be taken again (review of #440).
    const kept = (t: string | undefined): boolean => coin(t) || hasNftLink(t)
    const nft = `for you https://nonfungible.cash/claim/${'6f'.repeat(16)}#${'A'.repeat(43)}`
    expect(clearsWithAll({ type: 'message', text: nft }, kept)).toBe(false)
    expect(clearsWithAll({ type: 'message', text: 'hello' }, kept)).toBe(true)
  })
})
