/**
 * carriedMoves.test.ts - the pieces a hidden shard carries (DECK-0003 §1.10,
 * #504) stay with it through v2's moves and bag versions: EDIT moving it to a
 * new place (#595's lineage `d`), and another hide rewriting the bag it is in
 * (#587, #593). What would go wrong silently: a move or a rewrite that rebuilt
 * the shard from the workshop would drop a piece the workshop no longer holds,
 * or re-key it, and finders would ask relays for an address nobody published.
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

const sent: { kind: number; tags: string[][]; id: string; content: string }[] = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string; content: string }) => { sent.push(ev); return { ok: true } }),
  query: vi.fn(async () => []),
  // What the relay holds at an address: every bag it took, so a move finds its item still there.
  queryEach: vi.fn(async (f: { kinds: number[]; '#d'?: string[] }) => [{ url: 'wss://relay.test', outcome: 'answered', events: sent.filter((e) => f.kinds.includes(e.kind) && (!f['#d'] || e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1])))) }]),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type Ref, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { usePublished } from '../usePublished'
import { bagEntries, HIDDEN_KIND, isReference } from '../../lib/hidden'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import type { Position } from '../../lib/space'

const me = (): string => useCyberspace.getState().identity.pubkey
const addr = (pubkey: string, d: string): Ref => ['a', `33331:${pubkey}:${d}`]
const tri = (name: string): ShardModel => ({
  ...newShard(name),
  mode: 'solid',
  vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }],
  faces: [[0, 1, 2]],
})
const placing = (name: string, refs: Ref[]): ShardModel => ({
  ...newShard(name), mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })),
})

/** A corner of a 2^3 region well inside the space. */
const BASE: Position = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const at = (dx: bigint): Position => ({ x: BASE.x + dx, y: BASE.y, z: BASE.z })
const aim = (p: Position): void => { useCyberspace.setState({ cursor: { ...p } }) }
const tag = (ev: { tags: string[][] }, name: string): string | undefined => ev.tags.find((t) => t[0] === name)?.[1]

/** The newest bag's inline items, decrypted with this deployment's key. */
async function itemsInBag(keyHex: string): Promise<NostrEvent[]> {
  const bag = [...sent].reverse().find((e) => e.kind === HIDDEN_KIND) as unknown as NostrEvent
  return (await bagEntries(bag, hexToBytes(keyHex))).filter((e) => !isReference(e)) as NostrEvent[]
}

async function deployAt(shardId: string, p: Position): Promise<void> {
  useShards.getState().startDeployShard(shardId)
  aim(p)
  useShards.setState({ deployHeight: 3 })
  await useShards.getState().deploy()
  expect(useShards.getState().deployError).toBeNull()
  expect(useShards.getState().deployStatus).toBe('done')
}

/** A room placing a piece from your library, hidden at `p`. */
async function hideRoom(p: Position): Promise<{ eventId: string; pieceKey: string }> {
  const piece = { ...tri('Water'), id: 'water' }
  const room = { ...placing('Room', [addr(me(), 'water')]), id: 'room' }
  useWorkshop.setState({ shards: [piece, room], currentId: room.id })
  await deployAt(room.id, p)
  const dep = useShards.getState().mine[useShards.getState().mine.length - 1]
  const [item] = await itemsInBag(dep.keyHex)
  const objects = JSON.parse(item.content).objects as Record<string, unknown>
  expect(Object.keys(objects)).toHaveLength(1)
  return { eventId: dep.eventId, pieceKey: Object.keys(objects)[0] }
}

beforeEach(() => {
  sent.length = 0
  usePublished.setState({ ledger: {} })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null, workshopBack: null })
  useCyberspace.setState({ live: true, scaleExp: 0, buildStep: null })
  useWorkshop.setState({ open: false })
})

describe('a shard carrying pieces, moved and re-bagged', () => {
  it('EDIT moves it with its table as hidden, even when the workshop no longer holds the piece', async () => {
    const { eventId, pieceKey } = await hideRoom(at(1n))
    const first = JSON.parse((await itemsInBag(useShards.getState().mine[0].keyHex))[0].content) as { objects: Record<string, unknown> }
    // The piece leaves the library: the move must not need it.
    useWorkshop.setState({ shards: useWorkshop.getState().shards.filter((s) => s.id !== 'water') })
    useShards.getState().startEditShard(eventId)
    aim(at(5n))
    await useShards.getState().deploy()
    expect(useShards.getState().deployError).toBeNull()
    expect(useShards.getState().deployStatus).toBe('done')
    const moved = useShards.getState().mine[0]
    expect(moved.eventId).not.toBe(eventId)
    // The moved version is the same item: its lineage `d` names the first version (#595).
    expect(tag(moved.inner, 'd')).toBe(eventId)
    const [item] = await itemsInBag(moved.keyHex)
    const objects = JSON.parse(item.content).objects as Record<string, unknown>
    expect(Object.keys(objects)).toEqual([pieceKey])
    expect(objects[pieceKey]).toEqual(first.objects[pieceKey])
  })

  it('another hide into the same bag writes a new version that still carries it, unchanged', async () => {
    const { eventId, pieceKey } = await hideRoom(at(1n))
    const before = (await itemsInBag(useShards.getState().mine[0].keyHex)).find((e) => e.id === eventId)!
    const other = { ...tri('Other'), id: 'other' }
    useWorkshop.setState({ shards: [...useWorkshop.getState().shards, other] })
    await deployAt(other.id, at(2n))
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(2)
    expect(mine[1].lookupId).toBe(mine[0].lookupId)
    const items = await itemsInBag(mine[1].keyHex)
    expect(items.map((e) => e.id)).toContain(eventId)
    const again = items.find((e) => e.id === eventId)!
    expect(again.content).toBe(before.content)
    expect(Object.keys(JSON.parse(again.content).objects)).toEqual([pieceKey])
  })
})
