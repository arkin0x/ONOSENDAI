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

import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { usePublished } from '../usePublished'
import { bagEntries, HIDDEN_KIND, isReference, objectTemplate } from '../../lib/hidden'
import { CARRY_BUDGET_BYTES, carryRefusal, dOf, inTheClear, isQuietD, keepTable, ownKeysOnly, payloadBytes, rekeyTable, setLocalAuthor, tableFromBag, takenCopy } from '../../lib/carried'
import { attributed } from '../../lib/client'
import { carryLibrary } from '../localObjects'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { avatarTemplate } from '../../lib/avatar'
import { publicObjectTemplate, shardFingerprint } from '../../lib/published'

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
    const refs = payload.refs as string[][]
    expect(Object.keys(objects).sort()).toEqual(refs.map((r) => r[1]).sort())
    expect(objects[refs[0][1]].constrain).toBe('opaque')
    expect(objects[refs[1][1]]).toMatchObject({ name: 'Water', opacity: 40, constrain: 'off' })
  })

  it('never names a piece with no event of its own in a key: "room" goes in under a d that says nothing', async () => {
    const column = placing('Column', [addr(me(), 'kit/stone/base')])
    const payload = await hide(placing('Maze', [addr(me(), 'kit/stone/column')]), { 'kit/stone/column': column, 'kit/stone/base': tri('Base') })
    const objects = payload.objects as Record<string, { name: string; refs?: string[][] }>
    const keys = Object.keys(objects)
    expect(keys).toHaveLength(2)
    expect(JSON.stringify(keys)).not.toContain('kit/')
    expect(keys.every((k) => k.startsWith(`33331:${me()}:`) && isQuietD(dOf(k)))).toBe(true)
    // The refs say the same, at the root and inside the entry, and every placement still finds its entry.
    const top = (payload.refs as string[][])[0][1]
    expect(objects[top].name).toBe('Column')
    expect(objects[objects[top].refs![0][1]].name).toBe('Base')
    // Sorted as §1.2 requires.
    expect(keys).toEqual([...keys].sort())
    // The workshop's shard keeps its own refs.
    expect(useWorkshop.getState().shards.find((s) => s.name === 'Maze')!.refs![0][1]).toBe(`33331:${me()}:kit/stone/column`)
  })

  it('leaves a quiet d alone, so a uuid\'s or a random d\'s key is the address the ref already names', async () => {
    const id = '0d4b8f1e-2c97-4a35-8c6e-0123456789ab'
    const payload = await hide(placing('P', [addr(me(), id)]), { [id]: tri('Quiet') })
    expect(Object.keys(payload.objects as object)).toEqual([`33331:${me()}:${id}`])
  })

  it('a hidden object carries no a or e tag naming what it places or carries (§3.4)', async () => {
    const shard = carryLibrary(placing('P', [addr(me(), 'room'), addr(THEM, 'tile', 'wss://relay.test')]))
    const tmpl = await objectTemplate(shard, new Uint8Array(32).fill(1), 'f'.repeat(32), 1_800_000_000)
    expect(tmpl.tags.filter((t) => t[0] === 'a' || t[0] === 'e')).toEqual([])
    expect(tmpl.tags.map((t) => t[0]).sort()).toEqual(['alt', 'd', 'encrypted'])
  })

  it('carries a published piece from the library too: the source decides, not publish state', async () => {
    usePublished.setState({ ledger: { room: { at: 1, fp: '', pubkey: me() } } })
    const payload = await hide(placing('P', [addr(me(), 'room')]), { room: tri('Room') })
    expect(Object.keys(payload.objects as object)).toEqual([`33331:${me()}:room`])
  })

  it('keeps a live link (a relay hint, as FEED writes it) and anyone else\'s object as references', async () => {
    const root = placing('Mixed', [addr(me(), 'room', 'wss://relay.test'), addr(THEM, 'tile'), addr(me(), 'water')])
    const payload = await hide(root, { room: tri('Room'), water: tri('Water') })
    expect(Object.keys(payload.objects as object)).toEqual([(payload.refs as string[][])[2][1]])
    expect((payload.refs as string[][]).slice(0, 2)).toEqual([addr(me(), 'room', 'wss://relay.test'), addr(THEM, 'tile')])
  })

  it('flattens: a piece placed by a piece is carried in the one table', async () => {
    const room = placing('Room', [addr(me(), 'column')])
    const payload = await hide(placing('Maze', [addr(me(), 'room')]), { room, column: tri('Column') })
    const objects = payload.objects as Record<string, Record<string, unknown>>
    expect(Object.keys(objects)).toHaveLength(2)
    expect(objects[(payload.refs as string[][])[0][1]].objects).toBeUndefined()
  })

  it('a PASTE that forges a piece under your name is carried as your workshop holds it, never as pasted', async () => {
    useWorkshop.setState({ shards: [{ ...tri('Room'), id: 'room' }], currentId: null })
    const forged = { ...toPayload(placing('Pasted', [addr(me(), 'room')])), objects: { [`33331:${me()}:room`]: toPayload(tri('FORGED ROOM')) } }
    const id = useWorkshop.getState().importText(JSON.stringify(forged))!
    useShards.getState().startDeployShard(id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    const dep = useShards.getState().mine[0]
    const bag = [...sent].reverse().find((e) => e.kind === HIDDEN_KIND) as unknown as NostrEvent
    const item = (await bagEntries(bag, hexToBytes(dep.keyHex))).find((e) => !isReference(e)) as NostrEvent
    const objects = JSON.parse(item.content).objects as Record<string, { name: string }>
    expect(Object.values(objects).map((o) => o.name)).toEqual(['Room'])
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
  /** A shard whose whole hide payload is exactly `bytes`: it carries one piece, padded by name-free extra data. */
  const ofBytes = (bytes: number): ShardModel => {
    const parent = { ...placing('P', [addr(me(), 'a'.repeat(16))]), objects: { [`33331:${me()}:${'a'.repeat(16)}`]: { pad: '' } } as Record<string, unknown> }
    const short = bytes - payloadBytes(parent)
    return { ...parent, objects: { [`33331:${me()}:${'a'.repeat(16)}`]: { pad: 'x'.repeat(short) } } }
  }
  /** The bytes a relay sees for the hidden object this client publishes. */
  const eventBytes = async (s: ShardModel): Promise<number> => {
    const tmpl = attributed(await objectTemplate(s, new Uint8Array(32).fill(1), 'f'.repeat(32), 1_800_000_000))
    return new TextEncoder().encode(JSON.stringify({ id: '0'.repeat(64), pubkey: '0'.repeat(64), ...tmpl, sig: '0'.repeat(128) })).length
  }

  it('is what fits the real event on a relay that takes 131,072 bytes, and not a byte group more (§1.10 Size)', async () => {
    const at = ofBytes(CARRY_BUDGET_BYTES)
    expect(payloadBytes(at)).toBe(CARRY_BUDGET_BYTES)
    expect(await eventBytes(at)).toBeLessThanOrEqual(131_072)
    expect(await eventBytes(ofBytes(CARRY_BUDGET_BYTES + 1))).toBeGreaterThan(131_072)
    expect(carryRefusal(at)).toBeNull()
  })

  it('a payload just over never reads 96 of 96', () => {
    const over = carryRefusal(ofBytes(CARRY_BUDGET_BYTES + 1))
    expect(over).toBe('97kb of 96kb may be larger than relays will accept. Keep this part separate.')
    expect(carryRefusal(ofBytes(100 * 1024))).toMatch(/^100kb of 96kb/)
  })

  it('holds only a shard that carries something', async () => {
    const plain = tri('Plain')
    expect(carryRefusal(plain)).toBeNull()
    useWorkshop.setState({ shards: [{ ...tri('W'), id: 'w' }], currentId: null })
    const carried = carryLibrary(placing('P', [addr(me(), 'w')]))
    expect(payloadBytes(carried)).toBeLessThan(CARRY_BUDGET_BYTES)
    expect(carryRefusal(carried)).toBeNull()
  })
})

describe('every key under the signer (§1.10: a publisher MUST write only those)', () => {
  const OLD = 'c'.repeat(64)
  const built = (): ShardModel => ({
    ...placing('Built', [addr(OLD, 'x1')]),
    objects: { [`33331:${OLD}:x1`]: toPayload(placing('Inner', [addr(OLD, 'x2'), addr(THEM, 'live', 'wss://relay.test')])), [`33331:${OLD}:x2`]: toPayload(tri('Leaf')) },
  })
  const keysAreMine = (p: Record<string, unknown>): void => {
    const objects = p.objects as Record<string, { name: string; refs?: string[][] }>
    expect(Object.keys(objects).every((k) => k.startsWith(`33331:${me()}:`))).toBe(true)
    const top = objects[(p.refs as string[][])[0][1]]
    expect(top.name).toBe('Inner')
    expect(objects[top.refs![0][1]].name).toBe('Leaf')
    // A link stays a link, relay hint and all.
    expect(top.refs![1]).toEqual(addr(THEM, 'live', 'wss://relay.test'))
  }

  it('a shard built under another identity is hidden with its pieces re-keyed', async () => {
    keysAreMine(await hide(built(), {}))
  })

  it('and published the same way', async () => {
    await usePublished.getState().send(built())
    keysAreMine(JSON.parse(sent[sent.length - 1].content))
  })

  it('ownKeysOnly gives the same object back when every key is already the signer\'s', () => {
    const mine = { ...placing('P', [addr(me(), 'q')]), objects: { [`33331:${me()}:q`]: toPayload(tri('Q')) } }
    expect(ownKeysOnly(mine, me())).toBe(mine)
  })

  it('an entry re-keyed is written OPAQUE where nobody chose, an entry it leaves alone is carried as found (§1.12)', () => {
    const noWord = { ...toPayload(tri('Bare')) } as Record<string, unknown>
    delete noWord.constrain
    const m = { ...placing('P', [addr(OLD, 'a'), addr(me(), 'b')]), objects: { [`33331:${OLD}:a`]: noWord, [`33331:${me()}:b`]: noWord } }
    const out = ownKeysOnly(m, me()).objects as Record<string, Record<string, unknown>>
    const moved = Object.keys(out).find((k) => k !== `33331:${me()}:b`) as string
    expect(out[moved].constrain).toBe('opaque')
    expect(out[`33331:${me()}:b`].constrain).toBeUndefined()
  })

  it('a bad entry moves with its key and stays a bad entry', () => {
    const m = { ...placing('P', [addr(OLD, 'a')]), objects: { [`33331:${OLD}:a`]: 'not a payload' } } as ShardModel
    const out = rekeyTable(m, me(), () => true)
    expect(Object.values(out.objects as object)).toEqual(['not a payload'])
    expect(Object.keys(out.objects as object)[0]).toBe(out.refs![0][1])
  })
})

describe('a table taken from a bag (DECK-0004 §3.4, DECK-0003 §1.10)', () => {
  const found = (author: string | null): ShardModel => ({
    ...placing('Found', [addr(THEM, 'p'), addr(THEM, 'live', 'wss://relay.test')]),
    objects: { [`33331:${THEM}:p`]: toPayload(tri('Piece')) },
    ...(author ? { author } : {}),
  })

  it('comes with a taken copy, re-keyed under the taker, and every ref follows', () => {
    const copy = takenCopy(found(THEM), me())
    const key = Object.keys(copy.objects as object)[0]
    expect(key.startsWith(`33331:${me()}:`)).toBe(true)
    expect(isQuietD(dOf(key))).toBe(true)
    expect(copy.refs![0]).toEqual(['a', key])
    expect(copy.refs![1]).toEqual(addr(THEM, 'live', 'wss://relay.test'))
    expect(tableFromBag(copy)).toBe(true)
  })

  it('your own object taken back keeps its keys, and still remembers the bag', () => {
    const mine = { ...placing('Mine', [addr(me(), 'p')]), objects: { [`33331:${me()}:p`]: toPayload(tri('Piece')) }, author: me() }
    const copy = takenCopy(mine, me())
    expect(Object.keys(copy.objects as object)).toEqual([`33331:${me()}:p`])
    expect(tableFromBag(copy)).toBe(true)
  })

  it('an object read with no pubkey that counts brings nothing, and nothing to ask', () => {
    const copy = takenCopy(found(null), me())
    expect(copy.objects).toBeUndefined()
    expect(tableFromBag(copy)).toBe(false)
  })

  it('stays out of a public object and an avatar until its user keeps it', () => {
    const copy = takenCopy(found(THEM), me())
    expect(JSON.parse(publicObjectTemplate(copy, 1).content).objects).toBeUndefined()
    expect(JSON.parse(avatarTemplate(copy, 1).content).objects).toBeUndefined()
    expect(inTheClear(copy).objects).toBeUndefined()
    const kept = keepTable(copy)
    expect(tableFromBag(kept)).toBe(false)
    expect(Object.keys(JSON.parse(publicObjectTemplate(kept, 1).content).objects)).toHaveLength(1)
    expect(Object.keys(JSON.parse(avatarTemplate(kept, 1).content).objects)).toHaveLength(1)
  })

  it('what the publish state compares is what goes out, so leaving it out does not read as edited', () => {
    const copy = takenCopy(found(THEM), me())
    const out = publicObjectTemplate(copy, 1)
    expect(shardFingerprint(copy)).toBe(shardFingerprint({ ...copy, objects: undefined }))
    expect(JSON.parse(out.content).objects).toBeUndefined()
  })

  it('stays out through an edit, a save and a reload, in the workshop', () => {
    setLocalAuthor(() => me())
    const id = useWorkshop.getState().importShard(found(THEM), undefined, undefined, true)
    const held = useWorkshop.getState().shards.find((s) => s.id === id)!
    expect(tableFromBag(held)).toBe(true)
    // What the workshop stores: the model as JSON.
    const back = JSON.parse(JSON.stringify(held)) as ShardModel
    expect(tableFromBag(back)).toBe(true)
    useWorkshop.setState({ currentId: id })
    useWorkshop.getState().setMode('lines')
    expect(tableFromBag(useWorkshop.getState().current()!)).toBe(true)
    // The question's yes: asked once, and the shard is like any other after it.
    useWorkshop.getState().keepCarried(id)
    expect(tableFromBag(useWorkshop.getState().current()!)).toBe(false)
    setLocalAuthor(null)
  })

  it('a copy from the feed is not from a bag, and brings no table of its publisher\'s', () => {
    const id = useWorkshop.getState().importShard(found(THEM))
    const held = useWorkshop.getState().shards.find((s) => s.id === id)!
    expect(held.objects).toBeUndefined()
    expect(tableFromBag(held)).toBe(false)
  })
})
