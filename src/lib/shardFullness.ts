/**
 * shardFullness.ts: how full a shard is against what one hide holds whole
 * (owner, 2026-11-23: "add a bar indicating how 'full' your shard is getting
 * to where it says in the shard panel 'X bytes on the wire' so we have a
 * visual").
 *
 * A shard past REFERENCE_THRESHOLD_BYTES is hidden by reference: its payload
 * sealed as one kind 33331 object (lib/hidden.ts objectTemplate), and every
 * hidden object here is held to one event of BAG_SAFE_BYTES as signed
 * (lib/bagSize.ts). Since #865 a remote signer takes any request its relay
 * carries (524,288 bytes), so that event is the limit that binds: about
 * 179,900 bytes of payload. This is the same measure the hide (lib/pieces.ts
 * pieceRefusal) and the shard optimizer use: the object as signed, around a
 * stand-in ciphertext of exactly the length the payload seals to
 * (lib/bagFit.ts sealedLength), with the client tag and the tutorial's tag
 * (signedBytes). Not a guess: AES-GCM's output length follows its input's.
 *
 * Pure, and cheap: the event around the ciphertext is measured once per call
 * with an empty ciphertext, and the ciphertext's length is added, since a
 * base64 string adds its own length to the JSON and nothing else.
 */

import { BAG_SAFE_BYTES, signedBytes } from './bagSize'
import { OBJECT_KIND, OBJECT_PREVIEW, REGION_KEY_DERIVATION } from './hidden'
import { ALGO } from './shardCrypto'

/** The most one hidden object may be, as signed: the limit for hiding a shard whole. */
export const HIDE_WHOLE_BYTES = BAG_SAFE_BYTES

/** A `d` as the hide writes one (placementId: 32 hex characters). */
const D = '0'.repeat(32)

/** The hidden object's signed size with an empty ciphertext: everything but the sealed payload. */
function envelopeBytes(): number {
  return signedBytes({ kind: OBJECT_KIND, created_at: 9_999_999_999, content: OBJECT_PREVIEW, tags: [['d', D], ['alt', OBJECT_PREVIEW], ['encrypted', ALGO, '', REGION_KEY_DERIVATION]] })
}

/** The signed size of the hidden object a payload of this many UTF-8 bytes seals into. */
export function hiddenObjectBytes(payloadBytes: number): number {
  // lib/bagFit.ts sealedLength, from the byte count: base64 of nonce (12), ciphertext and tag (16).
  return envelopeBytes() + 4 * Math.ceil((12 + payloadBytes + 16) / 3)
}

/**
 * The most payload bytes one hidden object holds: the largest payload whose
 * object, as signed, is still within HIDE_WHOLE_BYTES. What the bar's "of"
 * says, in the same bytes as BYTES ON THE WIRE.
 */
export function wholePayloadLimit(): number {
  // sealedLength grows by 4 for every 3 bytes, so step back from the exact answer of the inverse.
  const room = HIDE_WHOLE_BYTES - envelopeBytes()
  let n = Math.floor((room * 3) / 4) - 28
  while (hiddenObjectBytes(n + 1) <= HIDE_WHOLE_BYTES) n++
  while (n > 0 && hiddenObjectBytes(n) > HIDE_WHOLE_BYTES) n--
  return n
}

/** How the bar reads: calm until close to full (owner's taste: nothing shouts until it matters). */
export type FullnessLevel = 'calm' | 'near' | 'over'

/** From this share on the bar turns amber: close to full, still fits. */
export const NEAR_FULL = 0.85

export interface Fullness {
  /** The payload, in UTF-8 bytes: BYTES ON THE WIRE. */
  payload: number
  /** The most payload one hide holds whole (wholePayloadLimit). */
  limit: number
  /** The hidden object it seals into, as signed, against HIDE_WHOLE_BYTES. */
  signed: number
  /** signed / HIDE_WHOLE_BYTES: 1 is exactly full. */
  share: number
  /** A whole percent for the words, never 100 while it still fits nor 0 for a shard with anything in it. */
  percent: number
  level: FullnessLevel
}

/** How full a payload of this many bytes is against one hide. */
export function fullnessOf(payloadBytes: number): Fullness {
  const signed = hiddenObjectBytes(payloadBytes)
  const share = signed / HIDE_WHOLE_BYTES
  const over = signed > HIDE_WHOLE_BYTES
  const raw = (share * 100)
  const percent = over ? Math.max(101, Math.floor(raw)) : Math.min(99, Math.max(payloadBytes > 0 ? 1 : 0, Math.round(raw)))
  return { payload: payloadBytes, limit: wholePayloadLimit(), signed, share, percent: signed === HIDE_WHOLE_BYTES ? 100 : percent, level: over ? 'over' : share >= NEAR_FULL ? 'near' : 'calm' }
}

/** A shard's payload as the hide writes it, in UTF-8 bytes (lib/hidden.ts wantsReference's measure). */
export function payloadBytesOf(payloadJson: string): number {
  return new TextEncoder().encode(payloadJson).length
}

/**
 * How many objects a shard places that go out on their own rather than inside
 * its payload: every placement but one drawn from its own objects table
 * (DECK-0003 §1.10). A shard of yours in the workshop is sealed beside it as
 * its own hidden object when it is hidden (lib/pieces.ts, #868), and a link
 * is fetched from its author's relays, so neither counts against this
 * shard's own limit. A table entry is carried inside the payload and does.
 */
export function placedApart(shard: { refs?: unknown[]; parts?: Array<{ ref: number }>; objects?: Record<string, unknown> }): number {
  const table = shard.objects
  let n = 0
  for (const q of shard.parts ?? []) {
    const r = shard.refs?.[q.ref]
    const key = Array.isArray(r) && r[0] === 'a' && typeof r[1] === 'string' ? r[1] : null
    if (!(key && table && Object.prototype.hasOwnProperty.call(table, key))) n++
  }
  return n
}

/** The words under the bar. */
export function fullnessWords(f: Fullness): string {
  const of = `${f.payload.toLocaleString('en-US')} of ${f.limit.toLocaleString('en-US')} bytes`
  if (f.level === 'over') return `Too big to hide in one piece: ${of}. Move part of it into its own shard and place that.`
  return `${f.percent}% of what one hide holds: ${of}`
}
