/**
 * lookDeploy.test.ts: hiding a chest writes the model it wears as `look`
 * tags (DECK-0004 §3.6), chosen on the hide bar's
 * model row and posed by its SCALE, TURN and WALK (chest and door design,
 * D2, D3). TREASURE by default; OTHER from MINE as a copy, from FEED as a
 * one-part wrapper; a look too large is refused in words and nothing is
 * hidden. Relays are mocked; no network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import type { FeedObject } from 'sno-core/feed'
import { forgeKey } from '../../lib/chests'
import { chestItemOf } from '../../lib/hidden'
import { isTreasureShape, lookOf, lookTagsOf } from '../../lib/looks'
import { constrainOf } from '../../lib/walkConstrain'
import type { Position } from '../../lib/space'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { storedMine, useShards } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4n, z: (1n << 72n) + 0x7e5n }

function model(name: string, unit: number, n = 3): ShardModel {
  const vertices = Array.from({ length: n }, (_, i) => ({ p: [i % 8, (i >> 3) % 8, (i >> 6) % 8] as [number, number, number], c: [1, 0.5, 0] as [number, number, number] }))
  return { ...newShard(name), unit, vertices, faces: [[0, 1, 2]] }
}

async function hide(): Promise<ReturnType<typeof chestItemOf>> {
  S().setDeployHeight(4)
  await S().deploy()
  const d = S().mine.find((x) => x.type === 'chest')
  return d ? chestItemOf(d.inner) : null
}

function start(): void {
  const lock = forgeKey('Wind Key')
  S().startDeployChest({ name: 'Wind Chest', lock: { pubkey: lock.itemPubkey, label: 'Wind Key' }, requires: '', contents: [{ kind: 'message', text: 'inside' }] })
}

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: false, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  useWorkshop.setState({ shards: [] })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('a chest\u2019s record', () => {
  it('stores its look once, in its inner event; a reload has it back', async () => {
    start()
    const chest = await hide()
    expect(chest?.look).toHaveLength(2)
    const row = S().mine.find((x) => x.type === 'chest')!
    const stored = JSON.parse(storedMine(S().mine)) as Array<{ chest?: { look?: unknown }; inner: { tags: string[][] } }>
    expect(stored[0].chest?.look).toBeUndefined()
    expect(stored[0].inner.tags.filter((t) => t[0] === 'look')).toHaveLength(2)
    // One copy of each 8 KB payload, not two.
    expect(storedMine(S().mine).length).toBeLessThan(2 * JSON.stringify(row.chest?.look).length)
  })

  it('says so when this device has no room for it, rather than losing it in silence', async () => {
    const spy = vi.spyOn(useToast.getState(), 'show')
    const set = vi.spyOn(Object.getPrototypeOf(localStorage) === Object.prototype ? localStorage : Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    start()
    await hide()
    set.mockRestore()
    expect(useToast.getState().toast?.label ?? spy.mock.calls.at(-1)?.[0].label).toBe('NOT SAVED ON THIS DEVICE')
    spy.mockRestore()
  })
})

describe('a chest hides with the look it wears', () => {
  it('wears TREASURE by default, closed and open, at the model’s own size and WALK setting', async () => {
    start()
    expect(S().pending).toMatchObject({ type: 'chest', look: { from: 'builtin', name: 'treasure' } })
    expect(S().deployUnit).toBe(0)
    expect(S().deployConstrain).toBe('all')
    const chest = await hide()
    expect(S().deployError).toBeNull()
    expect(chest?.look?.map((t) => t[2] ?? 'closed')).toEqual(['closed', 'open'])
    const d = S().mine.find((x) => x.type === 'chest')!
    const look = lookOf({ type: 'chest', event: d.inner })!
    expect(isTreasureShape(look.closed)).toBe(true)
    expect(look.lid).toBeDefined()
  })

  it('SCALE, TURN and WALK pose the look that goes out', async () => {
    start()
    S().setDeployUnit(2)
    S().turnDeploy(1)
    S().setDeployConstrain('opaque')
    const chest = await hide()
    const t = lookTagsOf(chest!.look)
    expect(t.closed?.unit).toBe(2)
    expect(constrainOf(t.closed!)).toBe('opaque')
    expect(isTreasureShape(t.closed!)).toBe(false)
  })

  it('OTHER from MINE goes out as a copy of the workshop model, closed only', async () => {
    const statue = model('Statue', 3)
    useWorkshop.setState({ shards: [statue] })
    start()
    S().setDeployLook({ from: 'mine', shardId: statue.id })
    expect(S().deployUnit).toBe(3)
    const chest = await hide()
    expect(chest?.look).toHaveLength(1)
    expect(lookTagsOf(chest!.look).closed?.name).toBe('Statue')
  })

  it('OTHER from FEED goes out as a one-part wrapper naming the object', async () => {
    const object = { address: `33331:${'b'.repeat(64)}:statue`, seen: ['wss://relay.test'], shard: model('Feed statue', 1) } as unknown as FeedObject
    start()
    S().setDeployLook({ from: 'feed', object })
    const chest = await hide()
    const closed = lookTagsOf(chest!.look).closed!
    expect(closed.vertices).toEqual([])
    expect(closed.refs?.[0][1]).toBe(object.address)
  })

  it('a look over 16,384 bytes is refused in words, and nothing is hidden', async () => {
    const big = model('Monument', 0, 1400)
    useWorkshop.setState({ shards: [big] })
    start()
    S().setDeployLook({ from: 'mine', shardId: big.id })
    await hide()
    expect(S().deployError).toMatch(/too large to wear/)
    expect(S().mine).toEqual([])
  })
})
