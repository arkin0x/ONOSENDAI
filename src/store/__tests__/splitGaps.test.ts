/**
 * splitGaps.test.ts: the gaps a split build (lib/pieces.ts) left after #868 and
 * #877, closed: TAKE brings its sealed pieces as shards of your own; PUT IN
 * CHEST carries them inside it, sealed with the chest; a move never skips a
 * piece no relay answers for; a copy only looked at is never stored. Relays are
 * a map in memory. No network.
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
  query: vi.fn(async (f: object) => relay.filter((e) => matches(e, f as never))),
  queryAny: vi.fn(async (_urls: string[], f: object) => relay.filter((e) => matches(e, f as never))),
  queryEach: vi.fn(async (f: object) => [{ url: 'wss://relay.test', outcome: 'answered', events: relay.filter((e) => matches(e, f as never)) }]),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { objectTemplateOf } from '../../lib/hidden'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { fetchRef, forgetRef } from '../../lib/parts'
import { forgetPieceKeys, notePieceKeys } from '../../lib/pieceKeys'
import { forgetReferences } from '../../lib/references'
import { cameSealed, setLocalAuthor } from '../../lib/carried'
import { useStash } from '../../hud/stash'
import type { Position } from '../../lib/space'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useToast } from '../useToast'
import { PIECE_NOT_FETCHED, chestShardRefusal, useShards, type ChestDraft } from '../useShards'
import { kept, untouchedLookCopy, useWorkshop } from '../useWorkshop'
import { saveLedger } from '../../lib/published'

const S = () => useShards.getState()
const W = () => useWorkshop.getState()
const me = (): string => useCyberspace.getState().identity.pubkey
const theirKey = generateSecretKey()
const THEM = getPublicKey(theirKey)
const BAG_KEY = new Uint8Array(32).fill(4)
const BASE: Position = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const at = (dx: bigint): Position => ({ x: BASE.x + dx, y: BASE.y, z: BASE.z })

function tri(name: string, id: string): ShardModel {
  return { ...newShard(name), id, unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}
function placing(name: string, id: string, refs: Ref[]): ShardModel {
  return { ...newShard(name), id, unit: 0, mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [i * 240, 0, 0], turn: [0, 0, 0], step: 0 })) }
}
async function sealedPiece(model: ShardModel, d: string): Promise<string> {
  relay.push(finalizeEvent(await objectTemplateOf(JSON.stringify(toPayload(model)), BAG_KEY, d, 1_800_000_000), theirKey) as unknown as Ev)
  return `33331:${THEM}:${d}`
}

beforeEach(() => {
  relay.length = 0
  forgetPieceKeys()
  forgetReferences()
  setLocalAuthor(() => useCyberspace.getState().identity.pubkey)
  useToast.getState().dismiss()
  useWorkshop.setState({ shards: [], currentId: null, backStack: [], past: [], future: [] })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  useBuilder.setState({ itemDraft: null, messageDraft: null })
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, scaleExp: 0, buildStep: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('TAKE brings a split build\'s pieces', () => {
  it('each sealed piece becomes a shard of yours, and your copy places them', async () => {
    const north = await sealedPiece(tri('North half', 'n'), 'a'.repeat(32))
    const south = await sealedPiece(tri('South half', 's'), 'b'.repeat(32))
    const found = { ...placing('Split arch', 'arch-event', [['a', north], ['a', south]]), author: THEM }
    notePieceKeys(found, THEM, bytesToHex(BAG_KEY))
    const r = await W().takeShard(found, fetchRef)
    expect(r).toMatchObject({ pieces: 2, missing: 0 })
    const copy = W().shards.find((s) => s.id === r.id)!
    const names = copy.refs!.map((ref) => W().shards.find((s) => `33331:${me()}:${s.id}` === ref[1])?.name)
    expect(names).toEqual(['North half', 'South half'])
    // Under your key, no relay hint: a hide of the copy seals each piece again.
    expect(copy.refs!.every((ref) => ref[1].startsWith(`33331:${me()}:`) && ref.length === 2)).toBe(true)
    // Each came sealed: PUBLISH asks before any goes out in the clear.
    for (const ref of copy.refs!) expect(cameSealed(W().shards.find((s) => `33331:${me()}:${s.id}` === ref[1])!)).toBe(true)
    expect(cameSealed(copy)).toBe(true)
  })

  it('a second TAKE of the same shard makes new pieces, never touching the first', async () => {
    const north = await sealedPiece(tri('North half', 'n'), 'a'.repeat(32))
    const found = { ...placing('Split arch', 'arch-event', [['a', north]]), author: THEM }
    notePieceKeys(found, THEM, bytesToHex(BAG_KEY))
    const first = await W().takeShard(found, fetchRef)
    const second = await W().takeShard(found, fetchRef)
    expect(second.id).not.toBe(first.id)
    const refOf = (id: string) => W().shards.find((s) => s.id === id)!.refs![0][1]
    expect(refOf(second.id)).not.toBe(refOf(first.id))
    expect(W().shards).toHaveLength(4)
  })

  it('another identity signed in while the relays answered: nothing lands in its workshop, and nothing under the old key', async () => {
    const north = await sealedPiece(tri('North half', 'n'), 'a'.repeat(32))
    const found = { ...placing('Split arch', 'arch-event', [['a', north]]), author: THEM }
    notePieceKeys(found, THEM, bytesToHex(BAG_KEY))
    const other = 'e'.repeat(64)
    const r = await W().takeShard(found, async (ref) => { const got = await fetchRef(ref); setLocalAuthor(() => other); return got })
    expect(r.pieces).toBe(0)
    expect(W().shards).toHaveLength(0)
  })

  it('a piece that cannot be opened stays a placeholder, and says so', async () => {
    const north = await sealedPiece(tri('North half', 'n'), 'a'.repeat(32))
    const gone = `33331:${THEM}:${'c'.repeat(32)}`
    const found = { ...placing('Split arch', 'arch-event', [['a', north], ['a', gone]]), author: THEM }
    notePieceKeys(found, THEM, bytesToHex(BAG_KEY))
    const r = await W().takeShard(found, fetchRef)
    expect(r).toMatchObject({ pieces: 1, missing: 1 })
    expect(useToast.getState().toast?.label).toBe('PART OF IT STAYED BEHIND')
    expect(W().shards.find((s) => s.id === r.id)!.refs![1]).toEqual(['a', gone])
  })

  it('a public object it links to stays a link', async () => {
    const tile = `33331:${THEM}:tile`
    relay.push(finalizeEvent({ kind: 33331, created_at: 1, tags: [['d', 'tile']], content: JSON.stringify(toPayload(tri('Tile', 't'))) }, theirKey) as unknown as Ev)
    forgetRef(['a', tile])
    const found = { ...placing('Floor', 'floor-event', [['a', tile]]), author: THEM }
    const r = await W().takeShard(found, fetchRef)
    expect(r.pieces).toBe(0)
    expect(W().shards.find((s) => s.id === r.id)!.refs).toEqual([['a', tile]])
  })
})

describe('PUT IN CHEST carries a split build\'s pieces inside it', () => {
  it('the pieces go into its table, under addresses that say nothing, sealed with the chest', async () => {
    const pieceA = tri('Quiet north', 'quiet-kit/north')
    const parent = placing('Split gate', 'gate', [['a', `33331:${me()}:quiet-kit/north`]])
    useWorkshop.setState({ shards: [pieceA, parent], currentId: parent.id })
    const draft: ChestDraft = { name: 'Wind Chest', lock: null, requires: '', contents: [{ kind: 'shard', shardId: parent.id }] }
    useStash.getState().aimIntoChest(draft, 0)
    await S().deploy()
    expect(S().deployError).toBeNull()
    const back = useBuilder.getState().takeItemDraft('chest') as Extract<ReturnType<ReturnType<typeof useBuilder.getState>['takeItemDraft']>, { type: 'chest' }>
    const c = back.contents[0]
    if (c.kind !== 'shard' || !c.aimed) throw new Error('not aimed')
    const payload = JSON.parse(c.aimed.signed.content) as { refs: string[][]; objects: Record<string, { name: string }> }
    const key = payload.refs[0][1]
    expect(key).toMatch(new RegExp(`^33331:${me()}:[0-9a-f]{32}$`))
    expect(payload.objects[key].name).toBe('Quiet north')
    expect(c.aimed.signed.content).not.toContain('quiet-kit')
  })
})

describe('a chest says when a split build is too big to carry', () => {
  it('refuses, in words, a shard whose pieces carried inside it pass one event', () => {
    const big = { ...placing('Huge gate', 'huge', []), objects: { [`33331:${me()}:x`]: { pad: 'x'.repeat(250_000) } } } as unknown as ShardModel
    const template = { kind: 3330, created_at: 1, tags: [], content: JSON.stringify(big) }
    expect(chestShardRefusal(tri('Small', 'small'), { kind: 3330, created_at: 1, tags: [], content: '{}' })).toBeNull()
    expect(chestShardRefusal({ ...tri('Huge gate', 'huge') }, template)).toMatch(/^Huge gate is too big to carry inside a chest with its parts \([\d,]+ of 240,000 bytes\)\. Hide it on its own instead\.$/)
  })
})

describe('a move never skips a piece', () => {
  it('a piece no relay answers for stops a move into another key, in plain words, and nothing moves', async () => {
    useCyberspace.setState({ cursor: { ...at(1n) } })
    const piece = tri('North half', 'piece-n')
    const parent = placing('Split arch', 'arch', [['a', `33331:${me()}:piece-n`]])
    useWorkshop.setState({ shards: [piece, parent], currentId: parent.id })
    S().startDeployShard(parent.id)
    useCyberspace.setState({ cursor: { ...at(1n) } })
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    expect(S().deployError).toBeNull()
    const row = S().mine[0]
    // As a row learned from the relays: no list of its pieces. And the piece is gone from every relay.
    const { pieces: _p, ...learned } = row
    void _p
    useShards.setState({ mine: [learned as typeof row] })
    relay.splice(0, relay.length, ...relay.filter((e) => e.kind !== 33331))
    forgetReferences()
    S().startEditShard(row.eventId)
    useCyberspace.setState({ cursor: { ...at(9n) } })
    await S().deploy()
    expect(S().deployError).toBe(PIECE_NOT_FETCHED)
    expect(S().mine.map((d) => d.eventId)).toEqual([row.eventId])
  })

  it('a row that knows its pieces is not stopped by a live link whose object is gone', async () => {
    useCyberspace.setState({ cursor: { ...at(1n) } })
    const piece = tri('North half', 'piece-n')
    const parent = placing('Split arch', 'arch', [['a', `33331:${me()}:piece-n`], ['a', `33331:${me()}:deleted-public`, 'wss://relay.test']])
    useWorkshop.setState({ shards: [piece, parent], currentId: parent.id })
    S().startDeployShard(parent.id)
    useCyberspace.setState({ cursor: { ...at(1n) } })
    useShards.setState({ deployHeight: 3 })
    await S().deploy()
    expect(S().deployError).toBeNull()
    const row = S().mine[0]
    expect(row.pieces).toHaveLength(1)
    S().startEditShard(row.eventId)
    useCyberspace.setState({ cursor: { ...at(9n) } })
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().mine[0].pieces).toHaveLength(1)
    expect(S().mine[0].pieces![0]).not.toBe(row.pieces![0])
  })
})

describe('a copy only looked at is never stored', () => {
  it('kept out of storage until it changes; then stored like any shard', async () => {
    useWorkshop.setState({ shards: [placing('Plaza', 'plaza', [['a', `33331:${THEM}:statue`, 'wss://relay.test']])], currentId: 'plaza' })
    await W().enterPart(0, async () => toPayload(tri('Statue', 'statue')))
    const copy = W().shards.find((s) => s.id === W().currentId)!
    expect(untouchedLookCopy(copy)).toBe(true)
    expect(kept(W().shards).map((s) => s.id)).toEqual(['plaza'])
    W().addVertex([5, 5, 5])
    const edited = W().shards.find((s) => s.id === copy.id)!
    expect(untouchedLookCopy(edited)).toBe(false)
    expect(kept(W().shards).map((s) => s.id).sort()).toEqual(['plaza', copy.id].sort())
  })

  it('a copy published while only looked at is stored', async () => {
    useWorkshop.setState({ shards: [placing('Plaza', 'plaza', [['a', `33331:${THEM}:statue`, 'wss://relay.test']])], currentId: 'plaza' })
    await W().enterPart(0, async () => toPayload(tri('Statue', 'statue')))
    const id = W().currentId!
    expect(kept(W().shards).map((s) => s.id)).not.toContain(id)
    saveLedger({ [id]: { at: 1, fp: '', pubkey: me() } })
    expect(kept(W().shards).map((s) => s.id)).toContain(id)
    saveLedger({})
  })

  it('a rename alone is a change: the copy is stored', async () => {
    useWorkshop.setState({ shards: [placing('Plaza', 'plaza', [['a', `33331:${THEM}:statue`, 'wss://relay.test']])], currentId: 'plaza' })
    await W().enterPart(0, async () => toPayload(tri('Statue', 'statue')))
    const id = W().currentId!
    W().rename(id, 'My statue')
    expect(kept(W().shards).map((s) => s.id)).toContain(id)
  })
})

void ({} as NostrEvent)
