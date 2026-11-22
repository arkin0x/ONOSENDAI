/**
 * deploySplit.test.ts: a SPLIT BUILD through the store (lib/pieces.ts): a small
 * parent shard placing pieces from the workshop is hidden as one build, each
 * piece its own sealed hidden object under the bag's key, signed on its own and
 * under the remote signer limit (#835). Finders with the bag's key draw every
 * piece; with the wrong key, nothing. Nothing goes out in the clear. MOVE seals
 * the pieces again under a new key and retracts the old ones; DELETE retracts
 * every piece. Relays are a map in memory: what was published is what a query
 * finds. No network.
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
/** The newest version at each address, as a relay keeps an addressable event. */
const current = (f: object): Ev[] => {
  const hits = relay.filter((e) => matches(e, f as never))
  const newest = new Map<string, Ev>()
  for (const e of hits) {
    const d = e.tags.find((t) => t[0] === 'd')?.[1]
    const k = e.kind >= 30000 && e.kind < 40000 ? `${e.kind}:${e.pubkey}:${d}` : e.id
    const was = newest.get(k)
    if (!was || e.created_at >= was.created_at) newest.set(k, e)
  }
  return [...newest.values()]
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_urls: string[], e: Ev) => { relay.push(e); return { ok: true } }),
  query: vi.fn(async (f: object) => current(f)),
  queryAny: vi.fn(async (_urls: string[], f: object) => current(f)),
  queryEach: vi.fn(async (f: object) => [{ url: 'wss://relay.test', outcome: 'answered', events: current(f) }]),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { HIDDEN_KIND, OBJECT_KIND, bagEntries, isReference, unbag, type Hidden } from '../../lib/hidden'
import { forgetReferences, resolveReference } from '../../lib/references'
import { forgetRef, resolvePartsShared } from '../../lib/parts'
import { forgetPieceKeys, notePieceKeys } from '../../lib/pieceKeys'
import { largestRemotePiece, signerBytes } from '../../lib/pieces'
import { NIP44_MAX_PLAINTEXT_BYTES } from '../../lib/signerRequestSize'
import { withAuthoredConstrain } from '../../lib/walkConstrain'
import { decryptForRegion } from '../../lib/shardCrypto'
import { publishMany } from '../../lib/relay'
import { bytesToHex, hexToBytes, type NostrEvent } from '../../lib/events'
import type { Position } from '../../lib/space'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
/** A corner of a 2^3 region well inside the space: one gibson over is the same bag, nine over another. */
const BASE: Position = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const at = (dx: bigint): Position => ({ x: BASE.x + dx, y: BASE.y, z: BASE.z })
const aim = (p: Position): void => { useCyberspace.setState({ cursor: { ...p } }) }

/** Workshop ids the way an import names pieces: a path that must never reach a relay. */
const NORTH = 'quiet-split/north-half'
const SOUTH = 'quiet-split/south-half'

/** A piece of at least `bytes` bytes of payload, and not much more. Built once for each size: finding its vertex count is the slow part. */
const built = new Map<string, ShardModel>()
function piece(name: string, bytes: number, id: string): ShardModel {
  const key = `${name}|${bytes}|${id}`
  const held = built.get(key)
  if (held) return held
  const made = buildPiece(name, bytes, id)
  built.set(key, made)
  return made
}
function buildPiece(name: string, bytes: number, id: string): ShardModel {
  const base: ShardModel = { ...newShard(name), id, unit: 0, mode: 'solid', vertices: [], faces: [[0, 1, 2]] }
  const withN = (count: number): ShardModel => ({ ...base, vertices: Array.from({ length: count }, (_, i) => ({ p: [i % 64, (i >> 6) % 64, (i >> 12) % 64] as [number, number, number], c: [1, 0.5, 0] as [number, number, number] })) })
  const size = (count: number): number => JSON.stringify(toPayload(withN(count))).length
  let lo = 3
  let hi = 3
  while (size(hi) < bytes) hi *= 2
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (size(mid) < bytes) lo = mid + 1
    else hi = mid
  }
  return withN(lo)
}

const ref = (d: string, relayHint?: string): Ref => (relayHint ? ['a', `33331:${me()}:${d}`, relayHint] : ['a', `33331:${me()}:${d}`])

function parentOf(refs: Ref[]): ShardModel {
  return { ...newShard('Split arch'), unit: 0, mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [i * 240, 0, 0], turn: [0, 0, 0], step: 0 })) }
}

/** Hide `parent` from the workshop, which holds `pieces` too, at `p`. */
async function hide(parent: ShardModel, pieces: ShardModel[], p: Position = at(1n)): Promise<void> {
  useWorkshop.setState({ shards: [...pieces, parent], currentId: parent.id })
  S().startDeployShard(parent.id)
  aim(p)
  useShards.setState({ deployHeight: 3 })
  await S().deploy()
}

async function move(eventId: string, p: Position): Promise<void> {
  S().startEditShard(eventId)
  aim(p)
  await S().deploy()
}

const sent = () => vi.mocked(publishMany).mock.calls.map((c) => c[1] as unknown as Ev)
const lastBag = () => [...sent()].reverse().find((e) => e.kind === HIDDEN_KIND) as unknown as NostrEvent
const dOf = (e: { tags: string[][] }) => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
const addressOf = (e: Ev) => `${e.kind}:${e.pubkey}:${dOf(e)}`
const retracted = () => sent().filter((e) => e.kind === 5).flatMap((e) => e.tags.filter((t) => t[0] === 'a').map((t) => t[1]))
const splitRow = () => S().mine.find((d) => d.type === 'shard')!

/** The parent as the newest bag carries it: its payload. */
async function parentInBag(): Promise<{ refs: string[][]; parts: number[][] }> {
  const row = splitRow()
  const entries = await bagEntries(lastBag(), hexToBytes(row.keyHex))
  const item = entries.find((e) => !isReference(e)) as NostrEvent
  return JSON.parse(item.content)
}

/** Read a bag as a finder does: opened with a key, its references fetched, its items noted (the store's subscription). */
async function find(bag: NostrEvent, keyHex: string): Promise<Hidden[]> {
  const items = await unbag(bag, hexToBytes(keyHex), resolveReference)
  useShards.setState({ discovered: Object.fromEntries(items.map((h) => [h.eventId, h])) })
  return items
}

/** A finder's device: nothing this one sealed or opened is held. */
function freshReader(addresses: string[]): void {
  forgetPieceKeys()
  for (const a of addresses) forgetRef(['a', a])
  forgetReferences()
  useShards.setState({ discovered: {} })
}

const realSign = useCyberspace.getState().signEvent

beforeEach(() => {
  relay.length = 0
  vi.mocked(publishMany).mockClear()
  forgetPieceKeys()
  forgetReferences()
  useCyberspace.setState({ signEvent: realSign, live: true, scaleExp: 0, buildStep: null, signerKind: 'local' })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, workshopBack: null })
  useBuilder.setState({ active: false, via: null, leftAvatar: false })
  useWorkshop.setState({ open: false, shards: [] })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('hiding a split build', () => {
  it('each piece goes first as its own sealed hidden object, then the bag, whose parent names them', { timeout: 30_000 }, async () => {
    const limit = largestRemotePiece()
    const north = piece('North half', limit - 3000, NORTH)
    const south = piece('South half', limit - 3000, SOUTH)
    await hide(parentOf([ref(NORTH), ref(SOUTH)]), [north, south])
    expect(S().deployError).toBeNull()
    expect(S().deployStatus).toBe('done')
    const kinds = sent().map((e) => e.kind)
    expect(kinds).toEqual([OBJECT_KIND, OBJECT_KIND, HIDDEN_KIND])
    const pieces = sent().filter((e) => e.kind === OBJECT_KIND)
    const row = splitRow()
    expect(row.pieces).toEqual(pieces.map(addressOf))
    // The parent in the bag places exactly those objects, where it placed the workshop's pieces.
    const parent = await parentInBag()
    expect(parent.refs).toEqual(pieces.map((e) => ['a', addressOf(e)]))
    expect(parent.parts).toEqual([[0, 0, 0, 0, 0, 0, 0, 0], [1, 240, 0, 0, 0, 0, 0, 0]])
    // Each opens with the bag's key to the workshop piece, geometry and all.
    for (const [i, e] of pieces.entries()) {
      const plain = await decryptForRegion(hexToBytes(row.keyHex), e.tags.find((t) => t[0] === 'encrypted')![2])
      expect(JSON.parse(plain!)).toEqual(toPayload(withAuthoredConstrain([north, south][i])))
    }
  })

  it('every signature stays under the remote signer limit, and a remote signer is asked for nothing too big', { timeout: 30_000 }, async () => {
    useCyberspace.setState({ signerKind: 'nip46' })
    const limit = largestRemotePiece()
    await hide(parentOf([ref(NORTH), ref(SOUTH)]), [piece('North half', limit - 3000, NORTH), piece('South half', limit - 3000, SOUTH)])
    expect(S().deployError).toBeNull()
    for (const e of sent().filter((x) => x.kind !== HIDDEN_KIND)) {
      const { id: _id, pubkey: _pk, sig: _sig, ...template } = e
      expect(signerBytes(template)).toBeLessThanOrEqual(NIP44_MAX_PLAINTEXT_BYTES)
    }
  })

  it('a piece too big for a remote signer is refused in words before anything is signed', { timeout: 30_000 }, async () => {
    useCyberspace.setState({ signerKind: 'nip46' })
    const signs = vi.fn(realSign)
    useCyberspace.setState({ signEvent: signs })
    const limit = largestRemotePiece()
    await hide(parentOf([ref(NORTH), ref(SOUTH)]), [piece('North half', limit + 4000, NORTH), piece('South half', 2000, SOUTH)])
    expect(S().deployStatus).toBe('error')
    expect(S().deployError).toMatch(/^The piece North half is too big for your signer app to sign \(it can take about 65 KB, this needs \d+ KB\)\. Split it smaller, or sign in with a key on this device\.$/)
    expect(signs).not.toHaveBeenCalled()
    expect(sent()).toEqual([])
  })

  it('nothing goes out in the clear: no piece name, no geometry, no workshop id, no ref tag', async () => {
    await hide(parentOf([ref(NORTH), ref(SOUTH)]), [piece('North half', 3000, NORTH), piece('South half', 3000, SOUTH)])
    expect(S().deployError).toBeNull()
    for (const e of sent()) {
      const wire = JSON.stringify(e)
      expect(wire).not.toContain('North half')
      expect(wire).not.toContain('South half')
      expect(wire).not.toContain('Split arch')
      expect(wire).not.toContain('quiet-split')
      expect(wire).not.toContain('"vertices"')
      if (e.kind === OBJECT_KIND) expect(e.tags.filter((t) => t[0] === 'a' || t[0] === 'e')).toEqual([])
    }
  })

  it('a live link (a relay hint) stays a reference to your public object, and is never sealed', async () => {
    const tile = piece('Tile', 500, 'public-tile')
    await hide(parentOf([ref('public-tile', 'wss://relay.test'), ref(NORTH)]), [tile, piece('North half', 2000, NORTH)])
    expect(S().deployError).toBeNull()
    expect(sent().filter((e) => e.kind === OBJECT_KIND)).toHaveLength(1)
    const parent = await parentInBag()
    expect(parent.refs[0]).toEqual(ref('public-tile', 'wss://relay.test'))
  })
})

describe('finding a split build', () => {
  it('a finder with the bag\'s key draws every piece; with the wrong key, nothing', async () => {
    await hide(parentOf([ref(NORTH), ref(SOUTH)]), [piece('North half', 3000, NORTH), piece('South half', 3000, SOUTH)])
    const row = splitRow()
    const bag = lastBag()
    freshReader(row.pieces!)
    const [found] = await find(bag, row.keyHex)
    expect(found.shard?.refs?.map((r) => r[1])).toEqual(row.pieces)
    const placed = await resolvePartsShared(found.shard!)
    expect(placed.map((p) => p.missing)).toEqual([undefined, undefined])
    expect(placed.map((p) => p.model?.name)).toEqual(['North half', 'South half'])

    // Another reader: the bag does not open with another key, and a piece does not either.
    freshReader(row.pieces!)
    const wrong = bytesToHex(new Uint8Array(32).fill(3))
    await expect(unbag(bag, hexToBytes(wrong), resolveReference)).rejects.toThrow()
    notePieceKeys(found.shard!, found.author, wrong)
    const blind = await resolvePartsShared(found.shard!)
    expect(blind.every((p) => p.missing !== undefined && !p.model)).toBe(true)
  })
})

describe('moving and deleting a split build', () => {
  it('DELETE retracts every piece once no bag names the parent', async () => {
    await hide(parentOf([ref(NORTH), ref(SOUTH)]), [piece('North half', 3000, NORTH), piece('South half', 3000, SOUTH)])
    const row = splitRow()
    vi.mocked(publishMany).mockClear()
    await S().deleteInstance(row.eventId)
    for (const a of row.pieces!) expect(retracted()).toContain(a)
  })

  it('DELETE never takes down your public object a live link places', async () => {
    const tile = piece('Tile', 500, 'public-tile')
    relay.push({ id: 'f'.repeat(64), kind: OBJECT_KIND, pubkey: me(), created_at: 1, content: JSON.stringify(toPayload(tile)), tags: [['d', 'public-tile']], sig: '0'.repeat(128) })
    await hide(parentOf([ref('public-tile', 'wss://relay.test'), ref(NORTH)]), [tile, piece('North half', 2000, NORTH)])
    const row = splitRow()
    vi.mocked(publishMany).mockClear()
    await S().deleteInstance(row.eventId)
    expect(retracted()).toContain(row.pieces![0])
    expect(retracted()).not.toContain(`33331:${me()}:public-tile`)
  })

  it('a move inside its own bag keeps every piece: nothing sealed again, nothing retracted', async () => {
    await hide(parentOf([ref(NORTH), ref(SOUTH)]), [piece('North half', 3000, NORTH), piece('South half', 3000, SOUTH)])
    const row = splitRow()
    vi.mocked(publishMany).mockClear()
    await move(row.eventId, at(2n))
    expect(S().deployError).toBeNull()
    expect(sent().map((e) => e.kind)).toEqual([HIDDEN_KIND])
    expect(splitRow().pieces).toEqual(row.pieces)
    expect((await parentInBag()).refs.map((r) => r[1])).toEqual(row.pieces)
  })

  it('a move into another bag seals every piece again under the new key, and retracts the old ones', async () => {
    await hide(parentOf([ref(NORTH), ref(SOUTH)]), [piece('North half', 3000, NORTH), piece('South half', 3000, SOUTH)])
    const old = splitRow()
    vi.mocked(publishMany).mockClear()
    await move(old.eventId, at(9n))
    expect(S().deployError).toBeNull()
    const moved = splitRow()
    expect(moved.lookupId).not.toBe(old.lookupId)
    expect(moved.pieces).toHaveLength(2)
    for (const a of moved.pieces!) expect(old.pieces).not.toContain(a)
    // The new pieces went out before the new bag, and open with the new key only.
    const kinds = sent().map((e) => e.kind)
    expect(kinds.slice(0, 3)).toEqual([OBJECT_KIND, OBJECT_KIND, HIDDEN_KIND])
    const fresh = sent().filter((e) => e.kind === OBJECT_KIND)
    for (const e of fresh) {
      const ct = e.tags.find((t) => t[0] === 'encrypted')![2]
      expect(await decryptForRegion(hexToBytes(moved.keyHex), ct)).not.toBeNull()
      expect(await decryptForRegion(hexToBytes(old.keyHex), ct)).toBeNull()
    }
    expect((await parentInBag()).refs.map((r) => r[1])).toEqual(moved.pieces)
    // The old place no longer names them: retracted.
    for (const a of old.pieces!) expect(retracted()).toContain(a)
    for (const a of moved.pieces!) expect(retracted()).not.toContain(a)
    // A finder of the new place draws the whole build.
    freshReader([...old.pieces!, ...moved.pieces!])
    const [found] = await find(lastBag(), moved.keyHex)
    const placed = await resolvePartsShared(found.shard!)
    expect(placed.map((p) => p.model?.name)).toEqual(['North half', 'South half'])
  })
})

describe('a split build hidden while LOCAL', () => {
  it('keeps its pieces here, draws them, and BROADCAST sends them before the bag', async () => {
    useCyberspace.setState({ live: false })
    await hide(parentOf([ref(NORTH), ref(SOUTH)]), [piece('North half', 3000, NORTH), piece('South half', 3000, SOUTH)])
    expect(S().deployError).toBeNull()
    expect(sent()).toEqual([])
    const row = splitRow()
    expect(row.pieceObjects).toHaveLength(2)
    // Drawn here from what was sealed, with no relay holding anything.
    freshReader(row.pieces!)
    useShards.setState({ mine: [...S().mine] })
    notePieceKeys(row.shard!, row.inner.pubkey, row.keyHex)
    const placed = await resolvePartsShared(row.shard!)
    expect(placed.map((p) => p.model?.name)).toEqual(['North half', 'South half'])
    expect(await S().broadcast(row.lookupId)).toBe(true)
    const kinds = sent().map((e) => e.kind)
    expect(kinds.filter((k) => k === OBJECT_KIND)).toHaveLength(2)
    expect(kinds.lastIndexOf(OBJECT_KIND)).toBeLessThan(kinds.indexOf(HIDDEN_KIND))
  })
})
