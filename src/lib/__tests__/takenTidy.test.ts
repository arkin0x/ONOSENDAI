/**
 * takenTidy.test.ts: the TAKEN list (arkinox, 2026-10-11). One shard per
 * model, so a chest's two identical Columns are taken once; a row moved
 * into the workshop or cleared leaves the list and is out of ITEMS, so its
 * chest offers it again (arkinox, 2026-11-09: "it should check each item
 * against my ITEMS current state. anything missing should appear again",
 * chestRowsFollowItems.test). CLEAR ALL is gone (owner, 2026-11-14).
 */

import { describe, expect, it } from 'vitest'
import { newShard, vertexAt } from 'sno-core/shards'
import type { ShardModel } from 'sno-core/shards'
import { holdsModel, modelPrint, splitPanels, type HeldItem } from '../inventory'

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

  it('a model in ITEMS counts as held under any name; one cleared off TAKEN does not', () => {
    expect(holdsModel({ a: held('a', { shard: column('Column', 'a') }) }, column('Column', 'other'))).toBe(true)
    expect(holdsModel({ a: held('a', { shard: column('Column', 'a'), archived: 4 }) }, column('Column', 'other'))).toBe(true)
    expect(holdsModel({ a: held('a', { shard: column('Column', 'a'), cleared: 5 }) }, column('Column', 'other'))).toBe(false)
    expect(holdsModel({ a: held('a', { shard: column('Column', 'a') }) }, column('Pool', 'pool', 7))).toBe(false)
  })
})

describe('leaving the TAKEN list', () => {
  it('a cleared row is not listed', () => {
    const items = [held('a', { cleared: 5 }), held('b', {})]
    expect(splitPanels([], items).loot.taken.map((t) => t.id)).toEqual(['b'])
  })
})
