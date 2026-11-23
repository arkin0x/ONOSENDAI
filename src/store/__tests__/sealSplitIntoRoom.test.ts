/**
 * sealSplitIntoRoom.test.ts: SEAL (R3) moves a split build (lib/pieces.ts)
 * behind a door: its pieces are sealed again under the room key at fresh
 * addresses, the parent names the new ones, and the old pieces are retracted
 * once the ordinary bag no longer names the parent. Relays are a map in
 * memory. No network.
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

const relay = vi.hoisted(() => ({ events: [] as Array<{ id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }>, log: [] as Array<{ id: string; kind: number; tags: string[][] }> }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    // An addressable event replaces its older version, as a relay does.
    publishMany: vi.fn(async (_r: string[], ev: (typeof relay.events)[number]) => {
      const d = ev.tags.find((t) => t[0] === 'd')?.[1]
      if (ev.kind >= 30000 && ev.kind < 40000) relay.events = relay.events.filter((e) => !(e.kind === ev.kind && e.pubkey === ev.pubkey && e.tags.find((t) => t[0] === 'd')?.[1] === d))
      relay.events.push(ev)
      relay.log.push(ev)
      return { ok: true }
    }),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async (f: Parameters<typeof answer>[0]) => [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f) }]),
    relaySet: () => ['wss://relay.test'],
  }
})

import { newShard, type Ref, type ShardModel } from 'sno-core/shards'
import { forgeKey } from '../../lib/chests'
import { hexToBytes } from '../../lib/events'
import { OBJECT_KIND, bagEntries, isReference, type KeyItem } from '../../lib/hidden'
import { decryptForRegion } from '../../lib/shardCrypto'
import type { NostrEvent } from '../../lib/events'
import type { Position } from '../../lib/space'
import { forgetPieceKeys } from '../../lib/pieceKeys'
import { forgetReferences } from '../../lib/references'
import { useStash } from '../../hud/stash'
import { resetDoorSecrets } from '../doorSecrets'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useWorkshop } from '../useWorkshop'
import { resetOpenedChests } from '../useOpenedChests'
import { useShards, type MyDeployment } from '../useShards'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const HEIGHT = 4
let lock: KeyItem

function tri(name: string, id: string): ShardModel {
  return { ...newShard(name), id, unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}

async function hideSplit(): Promise<MyDeployment> {
  const refs: Ref[] = [['a', `33331:${me()}:quiet-a`], ['a', `33331:${me()}:quiet-b`]]
  const parent: ShardModel = { ...newShard('Split gate'), unit: 0, mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [i * 120, 0, 0], turn: [0, 0, 0], step: 0 })) }
  useWorkshop.setState({ shards: [tri('Gate A', 'quiet-a'), tri('Gate B', 'quiet-b'), parent], currentId: parent.id })
  S().startDeployShard(parent.id)
  S().setDeployHeight(HEIGHT)
  await S().deploy()
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  return S().mine.find((d) => d.type === 'shard')!
}

async function sealDoor(): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startPlaceDoor()
  S().setDeployHeight(HEIGHT)
  S().placeChest()
  await S().sealPlacedChest({ name: 'Gate Door', lock: { pubkey: lock.itemPubkey, label: lock.name }, requires: 'the key', contents: [] })
  expect(S().deployError).toBeNull()
  return S().mine.find((d) => !before.has(d.eventId))!
}

beforeEach(() => {
  relay.events = []
  relay.log = []
  lock = forgeKey('Gate Key')
  localStorage.removeItem('onosendai:door-secrets')
  localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets()
  resetOpenedChests()
  forgetPieceKeys()
  forgetReferences()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: [], deployRoomSnap: null, deployInto: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('SEAL moves a split build behind a door', () => {
  it('its pieces are sealed again under the room key, the parent names them, and the old ones are retracted', async () => {
    const before = await hideSplit()
    expect(before.pieces).toHaveLength(2)
    const door = await sealDoor()
    relay.log = []
    expect(await S().sealIntoRoom(door.eventId, [before.eventId])).toBeNull()
    const moved = S().mine.find((d) => d.type === 'shard')!
    expect(moved.room).toEqual({ doorId: door.eventId })
    expect(moved.keyHex).not.toBe(before.keyHex)
    expect(moved.pieces).toHaveLength(2)
    for (const a of moved.pieces!) expect(before.pieces).not.toContain(a)
    // The new pieces open with the room key, and went out before the room bag.
    const fresh = relay.log.filter((e) => e.kind === OBJECT_KIND)
    expect(fresh.map((e) => `${OBJECT_KIND}:${me()}:${e.tags.find((t) => t[0] === 'd')![1]}`)).toEqual(moved.pieces)
    for (const e of fresh) expect(await decryptForRegion(hexToBytes(moved.keyHex), e.tags.find((t) => t[0] === 'encrypted')![2])).not.toBeNull()
    // The room bag's parent names the new pieces.
    const roomBag = relay.events.find((e) => e.kind === 33330 && e.tags.some((t) => t[0] === 'd' && t[1] === moved.lookupId)) as unknown as NostrEvent
    const parent = (await bagEntries(roomBag, hexToBytes(moved.keyHex))).find((e) => !isReference(e) && (e as NostrEvent).kind === 3330) as NostrEvent
    expect((JSON.parse(parent.content) as { refs: string[][] }).refs.map((r) => r[1])).toEqual(moved.pieces)
    // The old ones: retracted, now that the ordinary bag no longer names the parent.
    const gone = relay.log.filter((e) => e.kind === 5).flatMap((e) => e.tags.filter((t) => t[0] === 'a').map((t) => t[1]))
    for (const a of before.pieces!) expect(gone).toContain(a)
    for (const a of moved.pieces!) expect(gone).not.toContain(a)
  })
})
