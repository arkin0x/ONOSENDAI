/**
 * layerReader.ts - whether a kind 33339 layer counts (DECK-0009 §6), and
 * what it says when it does.
 *
 * The checks, in the DECK's order, each dropping the layer alone when it
 * fails: authentic; its tags as §5.1 requires (one `d`, one `p`, one
 * `encrypted`, one `version` of 1, at most one `alt`); within the limits of
 * §5.5 (240,000 bytes serialized, `content` and `alt` 280 bytes each);
 * signed by a builder key valid for its author (§4.4: named on one of the
 * author's movement actions, never retired, named after any `all`
 * retirement); it opens with the chunk's region key; and its plaintext well
 * formed. A key whose status cannot be learned yet leaves the layer pending,
 * read again later. There is no presence requirement.
 */

import { decryptForRegion } from '../shardCrypto'
import {
  LAYER_MAX_BYTES, decodePlane, freeTextWithinBounds, layerShape, parsePlaintext, planeGroundRevision, serializedBytes,
  type DecodedPlane, type LayerPlaintext, type StackLayer,
} from './blockLayer'
import type { GroundRevision } from './groundRevision'
import type { NostrEvent } from '../events'

/** What the author's movement actions say of a builder key: valid, void (retired or never named), or not known yet. */
export type KeyStatus = 'valid' | 'void' | 'unknown'

export interface ReadDeps {
  verify: (ev: NostrEvent) => boolean
  /** The chunk's region key and lookup id. */
  key: Uint8Array
  lookupId: string
  /** The chunk's ground in a plane at a revision (each surveyed plane is read against its own: DECK-0009 §3.10). */
  ground: (plane: 0 | 1, revision: GroundRevision) => Promise<Uint8Array>
  /** Whether `builder` is valid for `author` (§4.4). */
  keyStatus: (author: string, builder: string) => Promise<KeyStatus>
}

export type ReadResult =
  | { status: 'counted'; layer: StackLayer; plaintext: LayerPlaintext }
  | { status: 'pending'; why: string }
  | { status: 'dropped'; why: string }

/** Read one layer event by §6. */
export async function readLayer(ev: NostrEvent, d: ReadDeps): Promise<ReadResult> {
  const drop = (why: string): ReadResult => ({ status: 'dropped', why })
  if (!d.verify(ev)) return drop('not authentic')
  const shape = layerShape(ev)
  if (!shape) return drop('tags')
  if (shape.lookupId !== d.lookupId) return drop('another chunk')
  if (serializedBytes(ev) > LAYER_MAX_BYTES || !freeTextWithinBounds(ev)) return drop('past its limits')
  const status = await d.keyStatus(shape.author, ev.pubkey)
  if (status === 'unknown') return { status: 'pending', why: 'builder key not checked yet' }
  if (status === 'void') return drop('builder key not valid')
  const text = await decryptForRegion(d.key, shape.encrypted)
  if (text === null) return drop('does not open')
  const plain = parsePlaintext(text)
  if (!plain) return drop('plaintext')
  const planes: DecodedPlane[] = []
  for (const pl of plain.planes) {
    const r = planeGroundRevision(pl)
    const dp = decodePlane(pl, r === null ? null : await d.ground(pl.plane, r), ev.created_at)
    if (dp === null) return drop('plane')
    if (dp !== 'aside') planes.push(dp)
  }
  return { status: 'counted', plaintext: plain, layer: { id: ev.id, author: shape.author, builder: ev.pubkey, createdAt: ev.created_at, cobuilders: plain.cobuilders, planes } }
}
