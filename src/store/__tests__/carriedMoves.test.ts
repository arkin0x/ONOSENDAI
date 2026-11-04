/**
 * carriedMoves.test.ts - the pieces a hidden shard carries (DECK-0003 §1.10,
 * #504) through v2's moves and bag versions:
 *
 * - EDIT moving it inside its bag and into another bag (#595's lineage `d`):
 *   it moves as hidden, carrying no more and no less, whatever the workshop
 *   holds now (review of the stack: a move once drew new pieces in and wrote
 *   a 131,162-byte bag, past what relays take, and said done);
 * - a stale rewrite elsewhere dropping it (`goneFrom`), and HIDE AGAIN;
 * - DELETE, by the bag's `a` and `e` when nothing else stays, and a rewrite
 *   that keeps the rest when something does;
 * - another hide rewriting its bag (#587);
 * - no bag over a relay's 131,072 bytes is ever signed, so none says done.
 *
 * Not here: #593's rules (lib/bagVersions.ts) choose whole bag versions and
 * deletions for a scan and never read what an entry holds, so a carried
 * table takes no part in them; bagVersions.test.ts covers them.
 *
 * What would go wrong silently: a move or a rewrite that rebuilt the shard
 * from the workshop would drop a piece the workshop no longer holds, re-key
 * it, or grow past what a relay takes.
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

const sent: { kind: number; tags: string[][]; id: string; content: string; created_at?: number }[] = []
/** Bags the relay will not hand back: another device's read that missed one. */
const withheld = new Set<string>()
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string; content: string }) => { sent.push(ev); return { ok: true } }),
  query: vi.fn(async () => []),
  // What the relay holds at an address: every bag it took, so a move finds its item still there.
  queryEach: vi.fn(async (f: { kinds: number[]; '#d'?: string[] }) => [{ url: 'wss://relay.test', outcome: 'answered', events: sent.filter((e) => !withheld.has(e.id) && f.kinds.includes(e.kind) && (!f['#d'] || e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1])))) }]),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type Ref, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useShards, type MyDeployment } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { usePublished } from '../usePublished'
import { bagEntries, HIDDEN_KIND, isReference, wantsReference } from '../../lib/hidden'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import type { Position } from '../../lib/space'

const S = () => useShards.getState()
const me = (): string => useCyberspace.getState().identity.pubkey
const addr = (pubkey: string, d: string): Ref => ['a', `33331:${pubkey}:${d}`]
const tri = (name: string): ShardModel => ({
  ...newShard(name),
  mode: 'solid',
  vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }],
  faces: [[0, 1, 2]],
})
/** A shard of `n` vertices, each its own color: its payload grows by about 40 bytes a vertex. */
const big = (name: string, n: number): ShardModel => ({
  ...newShard(name),
  mode: 'solid',
  vertices: Array.from({ length: n }, (_, i) => ({ p: [i % 7, Math.floor(i / 7) % 7, Math.floor(i / 49) % 7] as [number, number, number], c: [((i * 37) % 255) / 255, ((i * 91) % 255) / 255, ((i * 13) % 255) / 255] as [number, number, number] })),
  faces: Array.from({ length: Math.floor(n / 3) }, (_, i) => [3 * i, 3 * i + 1, 3 * i + 2] as [number, number, number]),
})
const placing = (name: string, refs: Ref[]): ShardModel => ({
  ...newShard(name), mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })),
})

/** A corner of a 2^3 region well inside the space. */
const BASE: Position = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const at = (dx: bigint): Position => ({ x: BASE.x + dx, y: BASE.y, z: BASE.z })
const aim = (p: Position): void => { useCyberspace.setState({ cursor: { ...p } }) }
const tag = (ev: { tags: string[][] }, name: string): string | undefined => ev.tags.find((t) => t[0] === name)?.[1]
const row = (id: string): MyDeployment => S().mine.find((d) => d.eventId === id)!
const newestBag = (lookupId: string) => [...sent].reverse().find((e) => e.kind === HIDDEN_KIND && tag(e, 'd') === lookupId) as unknown as NostrEvent | undefined

/** The inline items of the newest bag at `lookupId`. */
async function itemsIn(lookupId: string, keyHex: string): Promise<NostrEvent[]> {
  const bag = newestBag(lookupId)
  return bag ? (await bagEntries(bag, hexToBytes(keyHex))).filter((e) => !isReference(e)) as NostrEvent[] : []
}
const tableOf = (ev: NostrEvent | undefined): Record<string, unknown> | undefined => (ev ? JSON.parse(ev.content).objects : undefined)

async function deployAt(shardId: string, p: Position): Promise<void> {
  S().startDeployShard(shardId)
  aim(p)
  useShards.setState({ deployHeight: 3 })
  await S().deploy()
  expect(S().deployError).toBeNull()
  expect(S().deployStatus).toBe('done')
  useShards.setState({ pending: null, placedLast: null })
}

async function editTo(eventId: string, p: Position): Promise<void> {
  S().startEditShard(eventId)
  aim(p)
  await S().deploy()
  expect(S().deployError).toBeNull()
  expect(S().deployStatus).toBe('done')
  useShards.setState({ pending: null, placedLast: null })
}

/** A room placing a piece from your library, hidden at `p`: its event id and the one key it carries. */
async function hideRoom(p: Position, id = 'room'): Promise<{ eventId: string; pieceKey: string; table: Record<string, unknown> }> {
  const piece = { ...tri('Water'), id: 'water' }
  const room = { ...placing('Room', [addr(me(), 'water')]), id }
  useWorkshop.setState({ shards: [...useWorkshop.getState().shards.filter((s) => s.id !== 'water' && s.id !== id), piece, room], currentId: room.id })
  await deployAt(room.id, p)
  const dep = S().mine[S().mine.length - 1]
  const item = (await itemsIn(dep.lookupId, dep.keyHex)).find((e) => e.id === dep.eventId)
  const table = tableOf(item)!
  expect(Object.keys(table)).toHaveLength(1)
  return { eventId: dep.eventId, pieceKey: Object.keys(table)[0], table }
}

beforeEach(() => {
  sent.length = 0
  withheld.clear()
  usePublished.setState({ ledger: {} })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, placedLast: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null, workshopBack: null })
  useCyberspace.setState({ live: true, scaleExp: 0, buildStep: null })
  useWorkshop.setState({ open: false, shards: [] })
})

describe('EDIT moves a carried shard as it was hidden', () => {
  it('inside its bag: its table as hidden, though the workshop no longer holds the piece', async () => {
    const { eventId, pieceKey, table } = await hideRoom(at(1n))
    useWorkshop.setState({ shards: useWorkshop.getState().shards.filter((s) => s.id !== 'water') })
    await editTo(eventId, at(5n))
    const moved = S().mine[0]
    expect(tag(moved.inner, 'd')).toBe(eventId)
    const item = (await itemsIn(moved.lookupId, moved.keyHex)).find((e) => e.id === moved.eventId)
    expect(Object.keys(tableOf(item)!)).toEqual([pieceKey])
    expect(tableOf(item)![pieceKey]).toEqual(table[pieceKey])
  })

  it('into another bag: the same table, and the old bag taken down', async () => {
    const { eventId, pieceKey } = await hideRoom(at(1n))
    const oldLookup = row(eventId).lookupId
    await editTo(eventId, at(9n))
    const moved = S().mine.find((d) => d.eventId !== eventId)!
    expect(moved.lookupId).not.toBe(oldLookup)
    expect(tag(moved.inner, 'd')).toBe(eventId)
    const item = (await itemsIn(moved.lookupId, moved.keyHex)).find((e) => e.id === moved.eventId)
    expect(Object.keys(tableOf(item)!)).toEqual([pieceKey])
    expect(sent.some((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'a' && t[1].endsWith(`:${oldLookup}`)))).toBe(true)
  })

  it('never draws pieces in that it did not carry: an old inline hide stays small when the library grows', async () => {
    // A hide from before the stack, or of a piece not in the workshop then: nothing carried.
    const room = { ...placing('Room', [addr(me(), 'water')]), id: 'room' }
    useWorkshop.setState({ shards: [room], currentId: room.id })
    await deployAt(room.id, at(1n))
    const first = S().mine[0]
    const before = (await itemsIn(first.lookupId, first.keyHex))[0]
    expect(tableOf(before)).toBeUndefined()
    // The library now holds a large piece at that address.
    useWorkshop.setState({ shards: [room, { ...big('Water', 1500), id: 'water' }] })
    await editTo(first.eventId, at(5n))
    const moved = S().mine[0]
    const after = (await itemsIn(moved.lookupId, moved.keyHex)).find((e) => e.id === moved.eventId)!
    expect(tableOf(after)).toBeUndefined()
    expect(after.content.length).toBeLessThan(2_000)
  })
})

describe('a carried shard dropped from its bag elsewhere, and HIDE AGAIN', () => {
  it('stays listed, gone from its bag, and HIDE AGAIN hides a fresh copy with the same table', async () => {
    const x = await hideRoom(at(1n), 'x')
    const device2 = S().mine.map((d) => ({ ...d }))
    const z = await hideRoom(at(2n), 'z')
    const lookupId = row(z.eventId).lookupId
    const keyHex = row(z.eventId).keyHex
    const withZ = newestBag(lookupId)!
    const device1 = S().mine.map((d) => ({ ...d }))
    // Device 2 never read the bag holding z, and rewrites it without z.
    useShards.setState({ mine: device2, deleted: {}, discovered: {} })
    withheld.add(withZ.id)
    useWorkshop.setState({ shards: [...useWorkshop.getState().shards, { ...tri('W'), id: 'w' }] })
    await deployAt('w', at(3n))
    withheld.clear()
    expect((await itemsIn(lookupId, keyHex)).map((e) => e.id)).not.toContain(z.eventId)
    // Device 1 hides again in that bag, and learns z is gone from it.
    useShards.setState({ mine: device1, deleted: {}, discovered: {} })
    useWorkshop.setState({ shards: [...useWorkshop.getState().shards, { ...tri('Q'), id: 'q' }] })
    await deployAt('q', at(4n))
    expect(row(z.eventId).goneFrom).toBeDefined()
    expect(row(x.eventId).goneFrom).toBeUndefined()
    // HIDE AGAIN: a fresh copy where z was, no lineage, the same table.
    const zAt = tag(row(z.eventId).inner, 'C')
    expect(await S().hideAgain(z.eventId)).toBeNull()
    const copy = S().mine.find((d) => d.eventId !== z.eventId && d.eventId !== x.eventId && tag(d.inner, 'C') === zAt)
    const fresh = (await itemsIn(lookupId, keyHex)).find((e) => e.id === copy?.eventId)
    expect(fresh).toBeDefined()
    expect(tag(fresh!, 'd')).toBeUndefined()
    expect(tableOf(fresh)).toEqual(z.table)
  })
})

describe('DELETE of a carried shard', () => {
  it('alone in its bag: the bag is taken down by its a and e', async () => {
    const { eventId } = await hideRoom(at(1n))
    const d = row(eventId)
    await S().deleteInstance(eventId)
    const del = sent.find((e) => e.kind === 5)!
    expect(del.tags).toContainEqual(['a', `${HIDDEN_KIND}:${me()}:${d.lookupId}`])
    expect(del.tags).toContainEqual(['e', d.bagId])
    expect(S().mine).toHaveLength(0)
  })

  it('beside another: the rewrite leaves the other\'s table as it was', async () => {
    const a = await hideRoom(at(1n), 'a')
    const b = await hideRoom(at(2n), 'b')
    const before = (await itemsIn(row(a.eventId).lookupId, row(a.eventId).keyHex)).find((e) => e.id === a.eventId)!
    await S().deleteInstance(b.eventId)
    const items = await itemsIn(row(a.eventId).lookupId, row(a.eventId).keyHex)
    expect(items.map((e) => e.id)).toEqual([a.eventId])
    expect(items[0].content).toBe(before.content)
  })
})

describe('another hide into the same bag', () => {
  it('writes a new version that still carries it, unchanged', async () => {
    const { eventId, pieceKey } = await hideRoom(at(1n))
    const before = (await itemsIn(row(eventId).lookupId, row(eventId).keyHex)).find((e) => e.id === eventId)!
    useWorkshop.setState({ shards: [...useWorkshop.getState().shards, { ...tri('Other'), id: 'other' }] })
    await deployAt('other', at(2n))
    const items = await itemsIn(row(eventId).lookupId, row(eventId).keyHex)
    const again = items.find((e) => e.id === eventId)!
    expect(again.content).toBe(before.content)
    expect(Object.keys(tableOf(again)!)).toEqual([pieceKey])
  })
})

describe('a bag no relay would take', () => {
  it('is refused before it is signed, in D3\'s words, and the hide never says done', async () => {
    // Inline shards just under the 16 KB a reference starts at, into one bag, until the bag would pass 131,072 bytes.
    // The largest slab that still goes inline (a reference keeps the bag small).
    let n = 1
    while (!wantsReference(big('Slab', n * 2))) n *= 2
    for (let step = n / 2; step >= 1; step /= 2) if (!wantsReference(big('Slab', n + step))) n += step
    let refused: string | null = null
    for (let i = 0; i < 16 && !refused; i++) {
      useWorkshop.setState({ shards: [...useWorkshop.getState().shards, { ...big(`Slab ${i}`, n), id: `slab${i}` }] })
      S().startDeployShard(`slab${i}`)
      aim(at(BigInt(1 + (i % 6))))
      useShards.setState({ deployHeight: 3 })
      await S().deploy()
      if (S().deployStatus !== 'done') refused = S().deployError
      useShards.setState({ pending: null, placedLast: null })
    }
    expect(refused).toMatch(/kb of 128kb may be larger than relays will accept/)
    for (const bag of sent.filter((e) => e.kind === HIDDEN_KIND)) expect(JSON.stringify(bag).length).toBeLessThanOrEqual(131_072)
  })
})
