/**
 * pieces.test.ts: planning, measuring and opening a split build's sealed pieces
 * (lib/pieces.ts, lib/pieceKeys.ts; DECK-0003 §1.10 with §3.4). Pure: no relay,
 * no store. The relays a reader asks are a map in memory where needed.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { objectTemplateOf } from '../hidden'
import { bytesToHex, type NostrEvent } from '../events'
import { NIP44_MAX_PLAINTEXT_BYTES, SIGNER_RELAY_EVENT_BYTES, nip46EventBytes, nip46PlaintextBytes } from '../signerRequestSize'
import { BAG_SAFE_BYTES, signedBytes } from '../bagSize'
import { attributed } from '../client'
import { largestRemotePiece, openOnePiece, pieceRefusal, pieceShape, planPieces, sealedPiecesOf, signerBytes } from '../pieces'
import { forgetPieceKeys, notePieceKey, notePieceKeys, pieceAddresses, pieceKeysFor, readSealedPiece } from '../pieceKeys'

const sk = generateSecretKey()
const ME = getPublicKey(sk)
const THEM = 'b'.repeat(64)
const KEY = new Uint8Array(32).fill(7)
const OTHER = new Uint8Array(32).fill(9)
const addr = (pubkey: string, d: string, relay?: string): Ref => (relay ? ['a', `33331:${pubkey}:${d}`, relay] : ['a', `33331:${pubkey}:${d}`])

/** A piece of at least `bytes` bytes of payload, and not much more: its vertex count found by halving. */
function piece(name: string, bytes: number, extra: Partial<ShardModel> = {}): ShardModel {
  const base: ShardModel = { ...newShard(name), mode: 'solid', vertices: [], faces: [[0, 1, 2]], ...extra }
  const withN = (count: number): ShardModel => ({ ...base, vertices: Array.from({ length: count }, (_, i) => ({ p: [i % 64, (i >> 6) % 64, (i >> 12) % 64] as [number, number, number], c: [1, 1, 1] as [number, number, number] })) })
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

function placing(name: string, refs: Ref[], extra: Partial<ShardModel> = {}): ShardModel {
  return { ...newShard(name), mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [i * 120, 0, 0], turn: [0, 0, 0], step: 0 })), ...extra }
}

let n = 0
const freshD = (): string => (++n).toString(16).padStart(32, '0')

beforeEach(() => {
  n = 0
  forgetPieceKeys()
})

describe('planning a split build', () => {
  it('each piece placed from the workshop gets a fresh address, and the parent names those, in order', async () => {
    const pieces: Record<string, ShardModel> = { 'quiet-north': piece('North', 400), 'quiet-south': piece('South', 400) }
    const parent = placing('Arch', [addr(ME, 'quiet-north'), addr(ME, 'quiet-south')])
    const plan = await planPieces(parent, ME, (a) => { const d = a.split(':')[2]; return pieces[d] ? (toPayload(pieces[d]) as unknown as Record<string, unknown>) : undefined }, freshD)
    expect(plan.pieces.map((p) => p.from)).toEqual([`33331:${ME}:quiet-north`, `33331:${ME}:quiet-south`])
    expect(plan.parent.refs).toEqual(plan.pieces.map((p) => ['a', p.address]))
    expect(plan.parent.parts).toEqual(parent.parts)
    // The workshop's ids say nothing to anyone: they are in no address that goes out.
    expect(JSON.stringify(plan.parent.refs)).not.toContain('quiet-')
    expect(plan.pieces.every((p) => /^33331:[0-9a-f]{64}:[0-9a-f]{32}$/.test(p.address))).toBe(true)
    // Each piece's payload is the workshop piece's, byte for byte, once its refs are renamed.
    expect(JSON.parse(plan.pieces[0].payload)).toEqual(toPayload(pieces['quiet-north']))
  })

  it('a live link (a relay hint), anyone else\'s object and what the root\'s table carries stay as they are', async () => {
    const carried = `33331:${ME}:carried-one`
    const parent = placing('Mixed', [addr(ME, 'linked', 'wss://relay.test'), addr(THEM, 'theirs'), ['a', carried], addr(ME, 'mine')], { objects: { [carried]: toPayload(piece('Carried', 100)) } })
    const plan = await planPieces(parent, ME, () => toPayload(piece('Any', 100)) as unknown as Record<string, unknown>, freshD)
    expect(plan.pieces.map((p) => p.from)).toEqual([`33331:${ME}:mine`])
    expect(plan.parent.refs!.slice(0, 3)).toEqual(parent.refs!.slice(0, 3))
  })

  it('a piece placed by a piece is sealed too, and its parent piece names the new address', async () => {
    const pieces: Record<string, ShardModel> = { column: placing('Column', [addr(ME, 'base')]), base: piece('Base', 200) }
    const plan = await planPieces(placing('Hall', [addr(ME, 'column')]), ME, (a) => { const d = a.split(':')[2]; return pieces[d] ? (toPayload(pieces[d]) as unknown as Record<string, unknown>) : undefined }, freshD)
    expect(plan.pieces).toHaveLength(2)
    const column = JSON.parse(plan.pieces[0].payload) as { refs: string[][] }
    expect(column.refs).toEqual([['a', plan.pieces[1].address]])
  })

  it('a piece\'s own table keeps only keys under the owner', async () => {
    const own = `33331:${ME}:x`
    const theirs = `33331:${THEM}:y`
    const p = piece('Tabled', 100, { objects: { [own]: toPayload(piece('A', 50)), [theirs]: toPayload(piece('B', 50)) } })
    const plan = await planPieces(placing('P', [addr(ME, 'tabled')]), ME, () => toPayload(p) as unknown as Record<string, unknown>, freshD)
    expect(Object.keys(JSON.parse(plan.pieces[0].payload).objects)).toEqual([own])
  })

  it('places nothing of yours from the workshop: the same parent, and no pieces', async () => {
    const parent = placing('Plain', [addr(THEM, 'theirs')])
    const plan = await planPieces(parent, ME, () => undefined, freshD)
    expect(plan.pieces).toEqual([])
    expect(plan.parent).toBe(parent)
  })
})

describe('the size of a piece: one event, and what a remote signer\'s relay carries (#865)', () => {
  it('measures a piece exactly as it is signed: the stand-in has the sealed length of the real one', async () => {
    const payload = JSON.stringify(toPayload(piece('Exact', 20_000)))
    const real = await objectTemplateOf(payload, KEY, freshD(), 9_999_999_999)
    const shape = pieceShape(payload, real.tags[0][1])
    expect(JSON.stringify(shape).length).toBe(JSON.stringify(real).length)
    expect(signerBytes(real)).toBe(nip46PlaintextBytes('sign_event', [JSON.stringify(attributed(real))], 'xxxxxxxxxxxx-99999'))
  })

  it('a request past 65,535 bytes is no reason to refuse a piece: a remote signer takes it', () => {
    const payload = 'x'.repeat(70_000)
    expect(signerBytes(pieceShape(payload, freshD()))).toBeGreaterThan(NIP44_MAX_PLAINTEXT_BYTES)
    expect(pieceRefusal({ payload, d: freshD(), name: 'Wide' }, true)).toBeNull()
  })

  it('the largest piece is held by the tighter cap: one event (240,000 bytes as signed), under the signer relay\'s 512 KB', () => {
    const limit = largestRemotePiece()
    const d = freshD()
    const at = pieceShape('x'.repeat(limit), d)
    expect(signedBytes(at)).toBeLessThanOrEqual(BAG_SAFE_BYTES)
    expect(signedBytes(pieceShape('x'.repeat(limit + 3), d))).toBeGreaterThan(BAG_SAFE_BYTES)
    expect(nip46EventBytes(signerBytes(at))).toBeLessThanOrEqual(SIGNER_RELAY_EVENT_BYTES)
    // About 179 KB of payload: what a split aims each piece under.
    expect(limit).toBeGreaterThan(170_000)
    expect(limit).toBeLessThan(181_000)
    expect(pieceRefusal({ payload: 'x'.repeat(limit), d, name: 'Edge' }, true)).toBeNull()
    expect(pieceRefusal({ payload: 'x'.repeat(limit + 3), d, name: 'Over' }, true)).toMatch(/^The piece Over is too large to hide: [\d,]+ of 240,000 bytes\. Split it smaller\. Nothing was sent\.$/)
  })

  it('a key on this device is held to the same size of one event', () => {
    expect(pieceRefusal({ payload: 'x'.repeat(100_000), d: freshD(), name: 'Big' }, false)).toBeNull()
    expect(pieceRefusal({ payload: 'x'.repeat(200_000), d: freshD(), name: 'Huge' }, false)).toMatch(/too large to hide/)
  })
})

describe('a sealed piece, opened', () => {
  async function sealed(payload: string, key: Uint8Array, d = freshD(), secret = sk): Promise<NostrEvent> {
    return finalizeEvent(await objectTemplateOf(payload, key, d, 1_800_000_000), secret) as unknown as NostrEvent
  }

  it('says nothing in the clear: preview, d, alt and the sealed payload, and no ref tag (§3.4)', async () => {
    const p = placing('Inner', [addr(ME, 'deeper')])
    const payload = JSON.stringify(toPayload(p))
    const ev = await sealed(payload, KEY)
    expect(ev.tags.map((t) => t[0]).sort()).toEqual(['alt', 'd', 'encrypted'])
    expect(JSON.stringify(ev)).not.toContain('Inner')
    expect(JSON.stringify(ev)).not.toContain('deeper')
  })

  it('opens with the bag key noted for its address; with no key, or the wrong one, it is nothing', async () => {
    const payload = JSON.stringify(toPayload(piece('Kept', 200)))
    const d = freshD()
    const address = `33331:${ME}:${d}`
    const ev = await sealed(payload, KEY, d)
    expect(await readSealedPiece(ev, address)).toBeNull()
    notePieceKey(address, bytesToHex(OTHER))
    expect(await readSealedPiece(ev, address)).toBeNull()
    notePieceKey(address, bytesToHex(KEY))
    expect(await readSealedPiece(ev, address)).toEqual(JSON.parse(payload))
  })

  it('a public object is not a sealed piece: read as before', async () => {
    const ev = finalizeEvent({ kind: 33331, created_at: 1, tags: [['d', 'pub']], content: JSON.stringify(toPayload(piece('Pub', 50))) }, sk) as unknown as NostrEvent
    expect(await readSealedPiece(ev, `33331:${ME}:pub`)).toBeUndefined()
  })

  it('refuses an event that is not the one the address names, or another author\'s', async () => {
    const d = freshD()
    const ev = await sealed('{}', KEY, d)
    notePieceKey(`33331:${ME}:other`, bytesToHex(KEY))
    expect(await readSealedPiece(ev, `33331:${ME}:other`)).toBeNull()
    const theirs = await sealed('{}', KEY, d, generateSecretKey())
    notePieceKey(`33331:${ME}:${d}`, bytesToHex(KEY))
    expect(await readSealedPiece(theirs, `33331:${ME}:${d}`)).toBeNull()
  })

  it('a piece that places pieces passes its key on to them', async () => {
    const deeper = `33331:${ME}:${freshD()}`
    const d = freshD()
    const ev = await sealed(JSON.stringify(toPayload(placing('Column', [['a', deeper]]))), KEY, d)
    notePieceKey(`33331:${ME}:${d}`, bytesToHex(KEY))
    await readSealedPiece(ev, `33331:${ME}:${d}`)
    expect(pieceKeysFor(deeper)).toEqual([bytesToHex(KEY)])
  })

  it('only addresses under the parent\'s author are noted, and none its table carries', () => {
    const carried = `33331:${ME}:carried`
    const parent = placing('P', [addr(ME, 'a1'), addr(THEM, 't1'), ['a', carried]], { objects: { [carried]: {} } })
    expect(pieceAddresses(parent, ME)).toEqual([`33331:${ME}:a1`])
    expect(notePieceKeys(parent, ME, bytesToHex(KEY))).toBe(1)
    expect(pieceKeysFor(`33331:${THEM}:t1`)).toEqual([])
  })

  it('finds every sealed piece of a build that opens with its key, and never a public object or another key\'s', async () => {
    const relay = new Map<string, NostrEvent>()
    const put = (ev: NostrEvent) => relay.set(`33331:${ev.pubkey}:${ev.tags.find((t) => t[0] === 'd')![1]}`, ev)
    const dBase = freshD()
    const dColumn = freshD()
    const dForeign = freshD()
    put(await sealed(JSON.stringify(toPayload(piece('Base', 100))), KEY, dBase))
    put(await sealed(JSON.stringify(toPayload(placing('Column', [['a', `33331:${ME}:${dBase}`]]))), KEY, dColumn))
    put(await sealed(JSON.stringify(toPayload(piece('Foreign', 100))), OTHER, dForeign))
    put(finalizeEvent({ kind: 33331, created_at: 1, tags: [['d', 'pub']], content: '{}' }, sk) as unknown as NostrEvent)
    const parent = placing('Hall', [['a', `33331:${ME}:${dColumn}`], addr(ME, 'pub'), ['a', `33331:${ME}:${dForeign}`], addr(ME, 'gone')])
    const fetch = async (ref: string[]) => relay.get(ref[1]) ?? null
    const found = await sealedPiecesOf(parent, ME, bytesToHex(KEY), fetch)
    expect(found.pieces.map((p) => p.address).sort()).toEqual([`33331:${ME}:${dBase}`, `33331:${ME}:${dColumn}`].sort())
    expect(found.missing).toEqual([`33331:${ME}:gone`])
    expect(await openOnePiece(`33331:${ME}:pub`, bytesToHex(KEY), fetch)).toBe('public')
    expect(await openOnePiece(`33331:${ME}:${dForeign}`, bytesToHex(KEY), fetch)).toBe('other')
  })
})
