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

import { MAX_PART_DEPTH } from 'sno-core/parts'
import type { ShardModel } from 'sno-core/shards'
import { BAG_SAFE_BYTES, signedBytes } from './bagSize'
import { sealedLength } from './bagFit'
import { attributed } from './client'
import type { EventTemplate, NostrEvent } from './events'
import { OBJECT_KIND, OBJECT_PREVIEW, REGION_KEY_DERIVATION } from './hidden'
import { ALGO } from './shardCrypto'
import { SIGNER_RELAY_EVENT_BYTES, nip46EventBytes, nip46PlaintextBytes, signerRequestTooBigMessage } from './signerRequestSize'
import { withNoBroadcast } from './noBroadcast'
import { isSealedObject, openPiece, pieceAddresses } from './pieceKeys'

import { hasKey, planPiecesNow, type Payload, type PiecePlan, type PlannedPiece } from './piecePlan'
export { planPieces, planPiecesNow, type PiecePlan, type PlannedPiece } from './piecePlan'

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

/** A `d` that says nothing about what it names (DECK-0003 §1.10, "What an older reader asks relays for"). */
function quietD(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The pieces a planned split build places carried INSIDE the parent instead,
 * in its objects table (DECK-0003 §1.10), for a shard put in a chest: the
 * chest seals its contents to its lock (NIP-44), so the pieces are as sealed
 * as the shard that carries them, and every finder who opens the chest draws
 * them from the table. One table, at the root: a piece's own table is flattened
 * into it (keys under the owner only), and no entry keeps an `objects` field.
 * The keys come back in code point order (§1.2).
 */
export function carriedInline(plan: PiecePlan): ShardModel {
  if (plan.pieces.length === 0) return plan.parent
  const table: Record<string, unknown> = { ...((plan.parent.objects as Record<string, unknown> | undefined) ?? {}) }
  for (const p of plan.pieces) {
    const payload = JSON.parse(p.payload) as Payload
    const { objects: own, ...entry } = payload
    if (own && typeof own === 'object' && !Array.isArray(own)) for (const [k, v] of Object.entries(own as Record<string, unknown>)) if (!(k in table)) table[k] = v
    table[p.address] = entry
  }
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return { ...plan.parent, objects: sorted as ShardModel['objects'] }
}

/** planPiecesNow for a chest: the same pieces, each under a `d` that says nothing, carried inline (carriedInline). */
export function carryPiecesInline(parent: ShardModel, owner: string, lookup: (address: string) => Payload | undefined): ShardModel {
  return carriedInline(planPiecesNow(parent, owner, lookup, quietD))
}
