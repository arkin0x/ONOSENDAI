/**
 * deployCarried.test.ts - a hide carries the pieces it places from your
 * library inside its own payload (DECK-0003 §1.10 `objects`), and a live link
 * stays a reference (arkinox, 2026-10-25: "if i chose my water in my library,
 * then its inlined. if i chose my water from the feed, then its a live
 * reference"). Over the budget the hide is refused in his words (D3).
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
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: [] }]),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type Ref, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { usePublished } from '../usePublished'
import { bagEntries, HIDDEN_KIND, isReference } from '../../lib/hidden'
import { CARRY_BUDGET_BYTES, carryRefusal, payloadBytes } from '../../lib/carried'
import { carryLibrary } from '../localObjects'
import { hexToBytes, type NostrEvent } from '../../lib/events'

const THEM = 'b'.repeat(64)
const me = (): string => useCyberspace.getState().identity.pubkey
const addr = (pubkey: string, d: string, relay?: string): Ref => (relay ? ['a', `33331:${pubkey}:${d}`, relay] : ['a', `33331:${pubkey}:${d}`])
const tri = (name: string, extra: Partial<ShardModel> = {}): ShardModel => ({
  ...newShard(name),
  mode: 'solid',
  vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }],
  faces: [[0, 1, 2]],
  ...extra,
})
const placing = (name: string, refs: Ref[]): ShardModel => ({
  ...newShard(name), mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [0, 0, 0], turn: [0, 0, 0], step: 0 })),
})

/** The workshop holds `pieces` under their ids; deploy `root` from it. */
async function hide(root: ShardModel, pieces: Record<string, ShardModel>): Promise<Record<string, unknown>> {
  useWorkshop.setState({ shards: [...Object.entries(pieces).map(([id, s]) => ({ ...s, id })), root], currentId: root.id })
  useShards.getState().startDeployShard(root.id)
  await useShards.getState().deploy()
  if (useShards.getState().deployStatus !== 'done') return {}
  const dep = useShards.getState().mine[0]
  const bag = [...sent].reverse().find((e) => e.kind === HIDDEN_KIND) as unknown as NostrEvent
  const entries = await bagEntries(bag, hexToBytes(dep.keyHex))
  const item = entries.find((e) => !isReference(e)) as NostrEvent
  return JSON.parse(item.content) as Record<string, unknown>
}

beforeEach(() => {
  sent.length = 0
  usePublished.setState({ ledger: {} })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: true })
})

describe('a hide carries your library pieces', () => {
  it('carries the room and its water, under your key, each written OPAQUE where its author never chose', async () => {
    const root = placing('Flooded', [addr(me(), 'room'), addr(me(), 'water')])
    const payload = await hide(root, { room: tri('Room'), water: tri('Water', { opacity: 40, extra: { constrain: 'off' } }) })
    const objects = payload.objects as Record<string, Record<string, unknown>>
    expect(Object.keys(objects).sort()).toEqual([`33331:${me()}:room`, `33331:${me()}:water`])
    expect(objects[`33331:${me()}:room`].constrain).toBe('opaque')
    expect(objects[`33331:${me()}:water`]).toMatchObject({ name: 'Water', opacity: 40, constrain: 'off' })
    // The references stay exactly as they were.
    expect(payload.refs).toEqual([addr(me(), 'room'), addr(me(), 'water')])
  })

  it('carries a published piece from the library too: the source decides, not publish state', async () => {
    usePublished.setState({ ledger: { room: { at: 1, fp: '', pubkey: me() } } })
    const payload = await hide(placing('P', [addr(me(), 'room')]), { room: tri('Room') })
    expect(Object.keys(payload.objects as object)).toEqual([`33331:${me()}:room`])
  })

  it('keeps a live link (a relay hint, as FEED writes it) and anyone else\'s object as references', async () => {
    const root = placing('Mixed', [addr(me(), 'room', 'wss://relay.test'), addr(THEM, 'tile'), addr(me(), 'water')])
    const payload = await hide(root, { room: tri('Room'), water: tri('Water') })
    expect(Object.keys(payload.objects as object)).toEqual([`33331:${me()}:water`])
  })

  it('flattens: a piece placed by a piece is carried in the one table', async () => {
    const room = placing('Room', [addr(me(), 'column')])
    const payload = await hide(placing('Maze', [addr(me(), 'room')]), { room, column: tri('Column') })
    const objects = payload.objects as Record<string, Record<string, unknown>>
    expect(Object.keys(objects).sort()).toEqual([`33331:${me()}:column`, `33331:${me()}:room`])
    expect(objects[`33331:${me()}:room`].objects).toBeUndefined()
  })

  it('carries nothing when it places nothing of yours, and the payload is as before', async () => {
    const payload = await hide(tri('Plain'), {})
    expect(payload.objects).toBeUndefined()
  })

  it('refuses a hide whose carried pieces take it past the budget, in his words, and sends nothing', async () => {
    const big = { ...tri('Big'), vertices: Array.from({ length: 9000 }, (_, i) => ({ p: [i % 16, Math.floor(i / 16) % 16, Math.floor(i / 256) % 16] as [number, number, number], t: [1, 2, 3] as [number, number, number], c: [1, 1, 1] as [number, number, number] })) }
    await hide(placing('Too much', [addr(me(), 'big')]), { big })
    expect(useShards.getState().deployStatus).toBe('error')
    expect(useShards.getState().deployError).toMatch(/^\d+kb of 96kb may be larger than relays will accept\. Keep this part separate\.$/)
    expect(sent).toEqual([])
  })
})

describe('the budget', () => {
  it('holds only a shard that carries something, and rounds up', async () => {
    expect(CARRY_BUDGET_BYTES).toBe(96 * 1024)
    const plain = tri('Plain')
    expect(carryRefusal(plain)).toBeNull()
    useWorkshop.setState({ shards: [{ ...tri('W'), id: 'w' }], currentId: null })
    const carried = carryLibrary(placing('P', [addr(me(), 'w')]))
    expect(payloadBytes(carried)).toBeLessThan(CARRY_BUDGET_BYTES)
    expect(carryRefusal(carried)).toBeNull()
  })
})
