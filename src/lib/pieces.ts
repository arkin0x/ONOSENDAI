/**
 * pieces.ts: hiding a SPLIT BUILD, a shard whose pieces each go as a sealed
 * hidden object of their own (DECK-0003 §1.10 with §3.4, "Sealed parts";
 * reading is lib/pieceKeys.ts).
 *
 * A shard too big for one event (a hidden object is held to BAG_SAFE_BYTES,
 * lib/bagSize.ts) cannot be hidden whole, and compressing it is off the
 * table. So it is split: two or more piece shards, each under the limit, and
 * a small parent shard that places them by address. Hiding the parent hides
 * the build. Each piece the parent places from your workshop is sealed with
 * the key of the bag the parent goes into, as a kind 33331 hidden object under
 * a fresh random `d`, signed on its own; the parent's refs are rewritten to
 * name those objects. A remote signer signs each piece as any request, up to
 * what its relay carries (lib/signerRequestSize.ts, #865). Nothing of a piece
 * is ever published in the clear: its event carries the preview, its `d`,
 * `alt` and the sealed payload, and no tag naming what it places (§3.4, "No
 * ref tags in the clear").
 *
 * Only what needs it is sealed (owner, 2026-11-22): a placement by an `a` ref
 * under your key with no relay hint, naming a shard in your workshop that is
 * unpublished or edited since it was published, is a piece. One published
 * under your key and unedited stays a plain link to the public object (the
 * store's lookup leaves it out); kit pieces are never published, so they are
 * always sealed. A ref with a relay hint
 * is a live link (the feed, an address) and stays as it is, as does anyone
 * else's object and whatever the root's table carries. A piece placed by a
 * piece is sealed too, to the depth a reader follows (§1.10's four).
 *
 * A move into a bag with another key seals every piece again under the new
 * key, at fresh addresses, and retracts the old ones once no bag names them
 * (as a sealed look moves, DECK-0004 §3.6).
 *
 * Pure: the store signs, sends and retracts (store/useShards.ts).
 */

import { MAX_PART_DEPTH, parseAddress } from 'sno-core/parts'
import type { Ref, ShardModel } from 'sno-core/shards'
import { BAG_SAFE_BYTES, signedBytes } from './bagSize'
import { sealedLength } from './bagFit'
import { attributed } from './client'
import type { EventTemplate, NostrEvent } from './events'
import { OBJECT_KIND, OBJECT_PREVIEW, REGION_KEY_DERIVATION } from './hidden'
import { ALGO } from './shardCrypto'
import { SIGNER_RELAY_EVENT_BYTES, nip46EventBytes, nip46PlaintextBytes, signerRequestTooBigMessage } from './signerRequestSize'
import { withNoBroadcast } from './noBroadcast'
import { isSealedObject, openPiece, pieceAddresses } from './pieceKeys'

/** A payload as JSON reads it: the fields this file touches are `refs` and `objects`. */
type Payload = Record<string, unknown>

/** One piece to seal: the address it was placed by, the address it goes out under, its `d`, and its payload as it is sealed. */
export interface PlannedPiece {
  from: string
  address: string
  d: string
  payload: string
  /** Its name, for the words when it is too big. */
  name: string
}

/** The parent with its refs naming the sealed pieces, and every piece to seal. */
export interface PiecePlan {
  parent: ShardModel
  pieces: PlannedPiece[]
}

const hasKey = (table: unknown, key: string): boolean =>
  !!table && typeof table === 'object' && !Array.isArray(table) && Object.prototype.hasOwnProperty.call(table, key)

/** A ref that may name a piece: an `a` ref of a kind 33331 object under `owner`. With `noHint`, only one without a relay hint (a ref with one is a live link). */
function pieceRef(r: unknown, owner: string, noHint: boolean): string | null {
  if (!Array.isArray(r) || r[0] !== 'a' || typeof r[1] !== 'string') return null
  if (noHint && typeof r[2] === 'string' && r[2].length > 0) return null
  const a = parseAddress(r[1])
  return a && a.kind === OBJECT_KIND && a.pubkey === owner ? r[1] : null
}

/** Refs with each renamed address replaced; a ref's relay hint goes with the old address, since the new object is on no relay yet. */
function renamed<T>(refs: T[], names: ReadonlyMap<string, string>): T[] {
  return refs.map((r) => (Array.isArray(r) && r[0] === 'a' && typeof r[1] === 'string' && names.has(r[1]) ? (['a', names.get(r[1])] as unknown as T) : r))
}

/** A payload's table with only keys under `owner`: a key under anyone else's would be dropped by every reader (§1.10), and it is not yours to seal. */
function ownTable(payload: Payload, owner: string): Payload {
  const table = payload.objects
  if (!table || typeof table !== 'object' || Array.isArray(table)) return payload
  const kept = Object.entries(table as Record<string, unknown>).filter(([k]) => k.startsWith(`${OBJECT_KIND}:${owner}:`))
  const { objects: _all, ...rest } = payload
  void _all
  return kept.length ? { ...rest, objects: Object.fromEntries(kept) } : rest
}

/**
 * The pieces `parent` places, found by `lookup` and planned for sealing:
 * breadth first from the parent's refs, to MAX_PART_DEPTH. `lookup` gives the
 * payload at an address (a workshop piece's), or undefined when that address
 * is not a piece to seal. `noHint` keeps refs with a relay hint out (live
 * links, for a hide from the workshop). An address the root's table holds is
 * drawn from there and is never a piece, nor one a piece's own table holds for
 * it. Each piece gets `newD()`; every ref naming it, in the parent and in the
 * pieces, is rewritten. Synchronous, so a hide plans before it awaits anything
 * (one hide at a time: a second press must find it working).
 */
export function planPiecesNow(
  parent: ShardModel,
  owner: string,
  lookup: (address: string) => Payload | undefined,
  newD: () => string,
  noHint = true,
): PiecePlan {
  const names = new Map<string, string>()
  const found: Array<{ from: string; d: string; payload: Payload }> = []
  let level: Array<{ refs: unknown; table: unknown }> = [{ refs: parent.refs, table: parent.objects }]
  for (let depth = 1; depth <= MAX_PART_DEPTH && level.length > 0; depth++) {
    const next: typeof level = []
    for (const holder of level) {
      if (!Array.isArray(holder.refs)) continue
      for (const r of holder.refs) {
        const address = pieceRef(r, owner, noHint)
        if (!address || names.has(address) || hasKey(parent.objects, address) || hasKey(holder.table, address)) continue
        const got = lookup(address)
        if (!got || typeof got !== 'object' || Array.isArray(got)) continue
        const payload = ownTable(got, owner)
        const d = newD()
        names.set(address, `${OBJECT_KIND}:${owner}:${d}`)
        found.push({ from: address, d, payload })
        next.push({ refs: payload.refs, table: payload.objects })
      }
    }
    level = next
  }
  if (found.length === 0) return { parent, pieces: [] }
  const pieces = found.map(({ from, d, payload }): PlannedPiece => {
    const written = Array.isArray(payload.refs) ? { ...payload, refs: renamed(payload.refs as unknown[], names) } : payload
    return { from, address: names.get(from)!, d, payload: JSON.stringify(written), name: typeof payload.name === 'string' ? payload.name : 'piece' }
  })
  return { parent: { ...parent, refs: renamed(parent.refs ?? [], names) as Ref[] }, pieces }
}

/**
 * planPiecesNow with a lookup that waits (a move opens each piece with its old
 * key, from the relays): each pass asks for the addresses the one before could
 * not answer yet, one depth further each time, until nothing new is asked.
 */
export async function planPieces(
  parent: ShardModel,
  owner: string,
  lookup: (address: string) => Promise<Payload | undefined> | Payload | undefined,
  newD: () => string,
  noHint = true,
): Promise<PiecePlan> {
  const known = new Map<string, Payload | undefined>()
  for (let pass = 0; pass <= MAX_PART_DEPTH; pass++) {
    const asked: string[] = []
    const plan = planPiecesNow(parent, owner, (a) => {
      if (known.has(a)) return known.get(a)
      asked.push(a)
      return undefined
    }, newD, noHint)
    if (asked.length === 0) return plan
    for (const a of asked) known.set(a, await lookup(a))
  }
  return planPiecesNow(parent, owner, (a) => known.get(a), newD, noHint)
}

/** A piece's hidden object as lib/hidden.ts objectTemplateOf writes it, around a stand-in ciphertext of exactly the length its payload seals to. */
export function pieceShape(payload: string, d: string): EventTemplate {
  return { kind: OBJECT_KIND, created_at: 9_999_999_999, content: OBJECT_PREVIEW, tags: [['d', d], ['alt', OBJECT_PREVIEW], ['encrypted', ALGO, 'A'.repeat(sealedLength(payload)), REGION_KEY_DERIVATION]] }
}

/** The request id a NIP-46 request is sent with, as long as nostr-tools makes one late in a session. */
const REQUEST_ID = 'xxxxxxxxxxxx-99999'

/** The NIP-44 plaintext a remote signer needs to sign this template (lib/signerRequestSize.ts), as the store sends it: with the client tag and the tutorial's tag. */
export function signerBytes(template: EventTemplate): number {
  return nip46PlaintextBytes('sign_event', [JSON.stringify(attributed(withNoBroadcast(template)))], REQUEST_ID)
}

/**
 * Why a piece cannot be hidden, or null: an event of its own larger than a bag
 * may be (BAG_SAFE_BYTES, what every hidden object here is held to), or, for
 * a remote signer (`remote`), a signing request past what the signer relay
 * carries in one event (SIGNER_RELAY_EVENT_BYTES), in the words every such
 * request gets (#865). What it can take, what this needs, and what to do.
 */
export function pieceRefusal(piece: Pick<PlannedPiece, 'payload' | 'd' | 'name'>, remote: boolean): string | null {
  const shape = pieceShape(piece.payload, piece.d)
  const bytes = signedBytes(shape)
  if (bytes > BAG_SAFE_BYTES) return `The piece ${piece.name} is too large to hide: ${bytes.toLocaleString('en-US')} of ${BAG_SAFE_BYTES.toLocaleString('en-US')} bytes. Split it smaller. Nothing was sent.`
  if (!remote) return null
  const need = signerBytes(shape)
  if (nip46EventBytes(need) <= SIGNER_RELAY_EVENT_BYTES) return null
  return signerRequestTooBigMessage('sign_event', [JSON.stringify(attributed(withNoBroadcast(shape)))], need)
}

/** Whether a piece of this payload is hidden as it is: under one event's size, and, for a remote signer, under what its relay carries. */
function fits(payload: string, d: string, remote: boolean): boolean {
  const shape = pieceShape(payload, d)
  if (signedBytes(shape) > BAG_SAFE_BYTES) return false
  return !remote || nip46EventBytes(signerBytes(shape)) <= SIGNER_RELAY_EVENT_BYTES
}

/**
 * The largest piece payload, in UTF-8 bytes of plain JSON (no character JSON
 * escapes), that a remote signer can still hide: under one event's size
 * (BAG_SAFE_BYTES) and under what the signer relay carries
 * (SIGNER_RELAY_EVENT_BYTES), whichever binds. What a split aims each piece
 * under (the kit's shard optimizer). Measured on the template as signed, with
 * a `d` of 32 hex characters, not guessed.
 */
export function largestRemotePiece(): number {
  const d = '0'.repeat(32)
  let lo = 0
  let hi = SIGNER_RELAY_EVENT_BYTES
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits('x'.repeat(mid), d, true)) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** One sealed piece of a build, as fetched and opened: its address, its event, and its payload. */
export interface OpenedPiece {
  address: string
  event: NostrEvent
  payload: Payload
}

/** What a sealed piece's address answers: the event, or null when no relay has it. */
export type FetchPiece = (ref: string[]) => Promise<NostrEvent | null>

/**
 * The payload at a piece's address opened with `keyHex`: the event must be the
 * one the address names, signed, sealed in the form of §3.4, and open with the
 * key. `missing` when it cannot be fetched, `public` when it is a public object
 * (a live link, never a piece), `other` when it is sealed and does not open
 * with this key (another bag's object, or none of this build's).
 */
export async function openOnePiece(address: string, keyHex: string, fetch: FetchPiece): Promise<OpenedPiece | 'missing' | 'public' | 'other'> {
  const ev = await fetch(['a', address, '']).catch(() => null)
  if (!ev) return 'missing'
  if (!isSealedObject(ev)) return 'public'
  const plain = await openPiece(ev, address, [keyHex])
  if (plain === null) return 'other'
  try {
    const payload = JSON.parse(plain) as unknown
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? { address, event: ev, payload: payload as Payload } : 'other'
  } catch {
    return 'other'
  }
}

/**
 * Every sealed piece a build places that opens with `keyHex` (the key of the
 * bag its parent is in), at any depth a reader follows: what a DELETE retracts
 * once no bag names the parent, and what a move seals again. Only addresses
 * under `owner`, and only hidden objects that open with the key: a public
 * object of yours placed by a live link is never one, and is never taken down.
 * An address that cannot be fetched is in `missing`.
 */
export async function sealedPiecesOf(parent: Pick<ShardModel, 'refs' | 'objects'>, owner: string, keyHex: string, fetch: FetchPiece): Promise<{ pieces: OpenedPiece[]; missing: string[] }> {
  const pieces: OpenedPiece[] = []
  const missing: string[] = []
  const seen = new Set<string>()
  let level: Array<{ refs: unknown; table: unknown }> = [{ refs: parent.refs, table: parent.objects }]
  for (let depth = 1; depth <= MAX_PART_DEPTH && level.length > 0; depth++) {
    const next: typeof level = []
    for (const holder of level) {
      for (const address of pieceAddresses({ refs: holder.refs, objects: holder.table }, owner)) {
        if (seen.has(address) || hasKey(parent.objects, address)) continue
        seen.add(address)
        const got = await openOnePiece(address, keyHex, fetch)
        if (got === 'missing') { missing.push(address); continue }
        if (typeof got === 'string') continue
        pieces.push(got)
        next.push({ refs: got.payload.refs, table: got.payload.objects })
      }
    }
    level = next
  }
  return { pieces, missing }
}
