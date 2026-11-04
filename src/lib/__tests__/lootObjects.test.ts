/**
 * lootObjects.test.ts: which objects float out of an opened chest (arkinox,
 * 2026-10-30): one scroll for every message, coins and audio among them;
 * each object itself, one per model; each item its own model, else the
 * generic item; a chest inside as a small chest. What is held already is
 * hidden, and a loot object left standing for nothing goes. And the two
 * built-in loot models are SNO shards that read back as written.
 */
import { describe, expect, it } from 'vitest'
import { fromPayload, newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { windOutward } from 'sno-core/winding'
import type { ChestEntry } from '../chests'
import type { ItemBody } from '../hidden'
import { chestLoot, lootOf } from '../lootObjects'
import { positionHex } from '../events'
import { primeRef } from '../parts'
import { measureModel } from '../../hooks/useItemModel'
import { HOVER_Z, LOOT_ROUND, LOOT_SIDE, LOOT_UP, hoverAt, lootFit, openChestBounds } from '../../scene/ChestLoot'
import { lootModels } from '../lootModels'

let n = 0
function entry(body: ItemBody): ChestEntry {
  const id = (++n).toString(16).padStart(64, '0')
  return { id, event: { id, pubkey: 'a'.repeat(64), created_at: 1, kind: 1, tags: [], content: '', sig: '' }, verified: true, body }
}
const shard = (name: string, x = 1): ShardModel => ({ ...newShard(name), vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [x, 0, 0], c: [1, 1, 1] }, { p: [0, x, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]], mode: 'solid' })
const key = (name: string, model?: string) => ({ name, about: '', itemPubkey: 'b'.repeat(64), secretHex: 'c'.repeat(64), ...(model ? { model: { address: model } } : {}) })
const nothingHeld = (): boolean => false

describe('loot from a chest', () => {
  const m1 = entry({ type: 'message', text: 'hello' })
  const m2 = entry({ type: 'message', text: 'cashuBo2F0...' })
  const audio = entry({ type: 'audio' })
  const column = entry({ type: 'shard', shard: shard('Column') })
  const column2 = entry({ type: 'shard', shard: shard('Column, again') })
  const arch = entry({ type: 'shard', shard: shard('Arch', 2) })
  const MODEL = `33331:${'d'.repeat(64)}:sword`
  const sword = entry({ type: 'key', key: key('Sword', MODEL) })
  const plain = entry({ type: 'key', key: key('Brass Key') })
  const inner = entry({ type: 'chest', chest: { name: 'Box', lockPubkey: 'e'.repeat(64), senderPubkey: 'f'.repeat(64), requires: '', payload: 'x' } })

  it('one scroll stands for every message, coins and audio among them', () => {
    const loot = lootOf([m1, m2, audio], nothingHeld)
    expect(loot).toHaveLength(1)
    expect(loot[0]).toMatchObject({ kind: 'scroll', ids: [m1.id, m2.id, audio.id] })
  })

  it('each object comes out itself, one per model', () => {
    const loot = lootOf([column, arch, column2], nothingHeld)
    expect(loot.map((l) => l.kind)).toEqual(['shard', 'shard'])
    expect(loot[0]).toMatchObject({ ids: [column.id, column2.id] })
    expect(loot[0].shard?.name).toBe('Column')
    expect(loot[1]).toMatchObject({ ids: [arch.id] })
  })

  it('an item comes out as the model it wears, else as the generic item', () => {
    const loot = lootOf([plain, sword], nothingHeld)
    expect(loot).toEqual([
      { key: `item:${plain.id}`, kind: 'item', ids: [plain.id] },
      { key: `item:${sword.id}`, kind: 'item', ids: [sword.id], model: { address: MODEL } },
    ])
  })

  it('a chest inside comes out as a small chest, and the order is words, items, objects, chests', () => {
    expect(lootOf([inner, column, sword, m1], nothingHeld).map((l) => l.kind)).toEqual(['scroll', 'item', 'shard', 'chest'])
  })

  it('what you hold already is hidden, and a scroll with nothing left goes', () => {
    const held = new Set([m1.id, sword.id])
    const some = lootOf([m1, m2, sword, plain], (e) => held.has(e.id))
    expect(some.find((l) => l.kind === 'scroll')?.ids).toEqual([m2.id])
    expect(some.filter((l) => l.kind === 'item').map((l) => l.ids[0])).toEqual([plain.id])
    held.add(m2.id)
    held.add(plain.id)
    expect(lootOf([m1, m2, sword, plain], (e) => held.has(e.id))).toEqual([])
  })

  it('an empty chest lets nothing out', () => {
    expect(lootOf([], nothingHeld)).toEqual([])
  })
})

describe('the built-in loot models', () => {
  for (const [name, model] of Object.entries(lootModels())) {
    it(`the ${name} is a closed, solid SNO shard that reads back as written`, () => {
      expect(model.mode).toBe('solid')
      expect(model.facecolors).toHaveLength(model.faces.length)
      // Closed: every edge is shared by exactly two faces.
      const edges = new Map<string, number>()
      for (const f of model.faces) for (let i = 0; i < 3; i++) {
        const a = f[i], b = f[(i + 1) % 3]
        const k = a < b ? `${a}:${b}` : `${b}:${a}`
        edges.set(k, (edges.get(k) ?? 0) + 1)
      }
      expect([...edges.values()].every((c) => c === 2)).toBe(true)
      // Wound as sno-core's outward guess winds it.
      expect(windOutward(model).faces).toEqual(model.faces)
      const back = fromPayload(JSON.parse(JSON.stringify(toPayload(model))), model.id)
      expect(back?.vertices).toHaveLength(model.vertices.length)
      expect(back?.faces).toEqual(model.faces)
      // Small enough to fit the chest: under a gibson every way.
      for (const v of model.vertices) for (let k = 0; k < 3; k++) expect(Math.abs(v.p[k] + (v.t?.[k] ?? 0) / 120)).toBeLessThan(0.6)
    })
  }
})

describe('loot over a chest in the world (review of #534)', () => {
  const at = { x: 64n, y: 128n, z: 192n }
  const withC = (body: ItemBody, p: { x: bigint; y: bigint; z: bigint }): ChestEntry => {
    const e = entry(body)
    return { ...e, event: { ...e.event, tags: [['C', positionHex(p, 0)]] } }
  }
  const here = withC({ type: 'message', text: 'here' }, at)
  const aimed = withC({ type: 'shard', shard: shard('Column') }, { ...at, x: at.x + 3n })
  const outside = withC({ type: 'shard', shard: shard('Far', 3) }, { ...at, x: at.x + 64n })
  const base = { held: () => false, itemsReady: true }

  it('an opened door lets nothing out: what is behind it stands in the room', () => {
    expect(chestLoot({ ...base, look: 'door', entries: [here, aimed] })).toEqual([])
  })

  it('nothing floats out while this identity\u2019s ITEMS are still being read', () => {
    expect(chestLoot({ ...base, look: 'chest', entries: [here], itemsReady: false })).toEqual([])
  })

  it('everything floats out of a chest, wherever it was aimed: its contents are taken, not placed (spec #82)', () => {
    const loot = chestLoot({ ...base, look: 'chest', entries: [here, aimed, outside] })
    expect(loot.map((l) => l.ids).flat().sort()).toEqual([here.id, aimed.id, outside.id].sort())
  })
})

describe('fitting a loot object (review of #534)', () => {
  it('a one-part wrapper, as the feed places an object, is fitted by its part, not left at true size', async () => {
    const ref = ['a', `33331:${'e'.repeat(64)}:pillar`] as ['a', string]
    primeRef(ref, toPayload(shard('Pillar', 6)))
    const wrapper: ShardModel = { ...newShard('Wrapper'), vertices: [], faces: [], refs: [ref], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }
    const e = await measureModel(wrapper)
    const fit = lootFit(e)
    expect(fit).not.toBeNull()
    // Six units long: drawn at LOOT_SIDE, not six.
    expect(fit!.k * 6).toBeCloseTo(LOOT_SIDE, 6)
  })

  it('nothing measured, nothing drawn', () => {
    expect(lootFit(null)).toBeNull()
  })
})

describe('loot over the open chest (review of the ceremony)', () => {
  it('no loot object reaches into the open chest from any side, turning and bobbing, in a row of any length', () => {
    const b = openChestBounds()
    // The open look, lid up: taller than the closed chest, leaning back.
    expect(b.max[1]).toBeGreaterThan(1.3)
    for (let n = 1; n <= 9; n++) for (let i = 0; i < n; i++) {
      const [x, y] = hoverAt(i, n)
      // The volume it sweeps: a circle LOOT_ROUND about its point, LOOT_UP up and down.
      const dx = Math.max(b.min[0] - x, 0, x - b.max[0])
      const dz = Math.max(b.min[2] - HOVER_Z, 0, HOVER_Z - b.max[2])
      const beside = Math.hypot(dx, dz) >= LOOT_ROUND
      const above = y - LOOT_UP > b.max[1]
      expect(beside || above, `object ${i} of ${n}`).toBe(true)
    }
  })

  it('keeps the row\u2019s arc where it is clear of the chest', () => {
    const [, mid] = hoverAt(2, 5)
    const [, end] = hoverAt(4, 5)
    expect(end).toBeLessThan(mid)
  })
})
