/**
 * sealedLookDeploy.test.ts: a chest's sealed look (DECK-0004 §3.6) through the
 * store: a LOCAL chest moved inside its own bag keeps the object it never sent,
 * for BROADCAST; BROADCAST sends it before the bag; DELETE takes down a sealed
 * look and never your own public object a FEED look places. Relays are a map in
 * memory: what was published is what a query finds. No network.
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

type Ev = { id: string; kind: number; pubkey: string; created_at: number; content: string; tags: string[][]; sig: string }
const relay: Ev[] = []
const matches = (e: Ev, f: { kinds?: number[]; authors?: string[]; ids?: string[]; '#d'?: string[] }): boolean =>
  (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f.ids || f.ids.includes(e.id)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? ''))

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_urls: string[], e: Ev) => { relay.push(e); return { ok: true } }),
  query: vi.fn(async (f: object) => relay.filter((e) => matches(e, f))),
  queryAny: vi.fn(async (_urls: string[], f: object) => relay.filter((e) => matches(e, f))),
  queryEach: vi.fn(async (f: object) => [{ outcome: 'answered', events: relay.filter((e) => matches(e, f)) }]),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { forgeKey } from '../../lib/chests'
import { HIDDEN_KIND, OBJECT_KIND, chestItemOf } from '../../lib/hidden'
import { forgetSealedLooks } from '../../lib/looks'
import { forgetReferences } from '../../lib/references'
import { sealedLookAddresses, sealedLookPayload } from '../../lib/sealedLooks'
import { publishMany } from '../../lib/relay'
import type { Position } from '../../lib/space'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4n, z: (1n << 72n) + 0x7e5n }

function model(name: string, n: number): ShardModel {
  const vertices = Array.from({ length: n }, (_, i) => ({ p: [i % 8, (i >> 3) % 8, (i >> 6) % 8] as [number, number, number], c: [1, 0.5, 0] as [number, number, number] }))
  return { ...newShard(name), unit: 0, vertices, faces: [[0, 1, 2]] }
}

async function hide(): Promise<void> {
  S().setDeployHeight(4)
  await S().deploy()
}

function start(): void {
  const lock = forgeKey('Wind Key')
  S().startDeployChest({ name: 'Wind Chest', lock: { pubkey: lock.itemPubkey, label: 'Wind Key' }, requires: '', contents: [{ kind: 'message', text: 'inside' }] })
}

const chestRow = () => S().mine.find((x) => x.type === 'chest')!
const sent = () => vi.mocked(publishMany).mock.calls.map((c) => c[1] as unknown as Ev)

beforeEach(() => {
  relay.length = 0
  vi.mocked(publishMany).mockClear()
  forgetSealedLooks()
  forgetReferences()
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: false, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  useWorkshop.setState({ shards: [] })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('a sealed look through MOVE, BROADCAST and DELETE', () => {
  it('a LOCAL chest moved inside its own bag keeps the object it never sent, and BROADCAST sends it before the bag', async () => {
    const big = model('Monument', 1400)
    useWorkshop.setState({ shards: [big] })
    start()
    S().setDeployLook({ from: 'mine', shardId: big.id })
    await hide()
    const first = chestRow()
    expect(first.lookObjects).toHaveLength(1)
    const object = first.lookObjects![0]
    // MOVE before the look was opened here: its tags go as they are, within the same bag.
    S().startMoveChest(first.eventId)
    expect(S().pending).toMatchObject({ type: 'chest', look: { from: 'kept' } })
    // One gibson over: the same bag (2^4), another place.
    const next = { ...CURSOR, x: CURSOR.x + 1n }
    useCyberspace.setState({ position: next, anchor: next, cursor: next })
    await hide()
    expect(S().deployError).toBeNull()
    const moved = chestRow()
    expect(moved.eventId).not.toBe(first.eventId)
    expect(sealedLookAddresses(moved.chest?.look, object.pubkey)).toEqual([`${OBJECT_KIND}:${object.pubkey}:${object.tags.find((t) => t[0] === 'd')![1]}`])
    expect(moved.lookObjects?.map((o) => o.id)).toEqual([object.id])
    expect(sent()).toEqual([])
    // BROADCAST: the object first, then the bag that names it.
    expect(await S().broadcast(moved.lookupId)).toBe(true)
    const kinds = sent().map((e) => e.kind)
    expect(kinds.indexOf(OBJECT_KIND)).toBeGreaterThanOrEqual(0)
    expect(kinds.indexOf(HIDDEN_KIND)).toBeGreaterThan(kinds.indexOf(OBJECT_KIND))
    expect(sent().find((e) => e.kind === OBJECT_KIND)?.id).toBe(object.id)
  })

  it('DELETE takes down a LIVE chest’s sealed look once its bag no longer names it', async () => {
    useCyberspace.setState({ live: true })
    const big = model('Monument', 1400)
    useWorkshop.setState({ shards: [big] })
    start()
    S().setDeployLook({ from: 'mine', shardId: big.id })
    await hide()
    expect(S().deployError).toBeNull()
    const row = chestRow()
    const [address] = sealedLookAddresses(chestItemOf(row.inner)!.look, row.inner.pubkey)
    vi.mocked(publishMany).mockClear()
    await S().deleteInstance(row.eventId)
    const deletion = sent().find((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'a' && t[1] === address))
    expect(deletion).toBeDefined()
  })

  it('DELETE never takes down your own public object that a FEED look places, though it has a sealed look’s shape', async () => {
    useCyberspace.setState({ live: true })
    const me = C().identity.pubkey
    // Your own published object, on the relay, in the clear.
    const statue = model('Statue', 3)
    relay.push({ id: 'f'.repeat(64), kind: OBJECT_KIND, pubkey: me, created_at: 1, content: JSON.stringify(toPayload(statue)), tags: [['d', 'statue']], sig: '0'.repeat(128) })
    const address = `${OBJECT_KIND}:${me}:statue`
    start()
    S().setDeployLook({ from: 'feed', object: { address, seen: [], shard: statue } as never })
    await hide()
    expect(S().deployError).toBeNull()
    const row = chestRow()
    expect(sealedLookAddresses(chestItemOf(row.inner)!.look, me)).toEqual([address])
    vi.mocked(publishMany).mockClear()
    await S().deleteInstance(row.eventId)
    expect(sent().some((e) => e.kind === 5 && e.tags.some((t) => t[1] === address))).toBe(false)
  })
})

describe('a chest near its cap seals its look whatever its size (DECK-0004 §3.2, Size)', () => {
  it('a look small enough for its tag rides inline on a small chest, and goes sealed on a chest past 65,535 bytes, which then fits its bag', async () => {
    const look = model('Crate', 400)
    useWorkshop.setState({ shards: [look] })
    expect(new TextEncoder().encode(JSON.stringify(toPayload(look))).length).toBeGreaterThan(3_900)
    start()
    S().setDeployLook({ from: 'mine', shardId: look.id })
    await hide()
    expect(S().deployError).toBeNull()
    expect(chestRow().lookObjects ?? []).toHaveLength(0)
    expect(sealedLookAddresses(chestRow().chest?.look, C().identity.pubkey)).toEqual([])

    useShards.setState({ mine: [], pending: null, deployStatus: 'idle', deployError: null })
    relay.length = 0
    const lock = forgeKey('Hoard Key')
    const texts = Array.from({ length: 12 }, (_, i) => 'abcdefghijkl'[i].repeat(10_000))
    S().startDeployChest({ name: 'Hoard', lock: { pubkey: lock.itemPubkey, label: 'Hoard Key' }, requires: 'Hoard Key', contents: texts.map((text) => ({ kind: 'message' as const, text })) })
    S().setDeployLook({ from: 'mine', shardId: look.id })
    await hide()
    expect(S().deployError).toBeNull()
    expect(S().deployStatus).toBe('done')
    const row = chestRow()
    expect(row.chest!.payload.length).toBeGreaterThan(87_472)
    expect(sealedLookAddresses(row.chest?.look, C().identity.pubkey)).toHaveLength(1)
    expect(row.lookObjects).toHaveLength(1)
  })
})

describe('sealedLookPayload', () => {
  it('a wrapper keeps the sealed payload’s name, unit and stance, and nothing else', () => {
    const w = JSON.parse(sealedLookPayload(JSON.stringify(toPayload({ ...model('Hoard', 3), unit: 2 })), `33331:${'a'.repeat(64)}:x`))
    expect(w).toMatchObject({ name: 'Hoard', unit: 2, vertices: [], faces: [], parts: [[0, 0, 0, 0, 0, 0, 0, 0]] })
  })
})
