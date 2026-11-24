/**
 * layerReader.ts - whether a kind 33339 layer counts, by DECK-0009 §6.1, and
 * what it says when it does.
 *
 * The checks, in the DECK's order, each dropping the layer alone when it
 * fails: authentic; its tags as §5.1 requires; no longer than 240,000 bytes;
 * it opens with the chunk's region key; its plaintext well formed; its
 * settles hash to its settle tags; its planes decode against their base;
 * every placement's first settle claims its cell; its builder key valid for
 * a reach event (the author's own chain names it, and nothing retires it);
 * and, per plane, a reach event in that plane within REACH of the chunk.
 * Then the settles' blocks against the reader's Bitcoin headers: a wrong hash
 * at a confirmed height drops the layer, and a height not yet 6 deep leaves
 * it pending (not counted, asked again later).
 *
 * What the chain says (is the reach event a real, valid position of the
 * author's, and is the key named in its ancestry and not retired) is the
 * caller's (store/terrainShare.ts, from the author's chain), handed in as
 * `reach`.
 */

import { decryptForRegion } from '../shardCrypto'
import { CELLS, type ChunkBase } from './coords'
import { reachDistance, REACH } from './world'
import {
  LAYER_MAX_BYTES, decodePlane, expandRuns, layerShape, parsePlaintext, serializedBytes, settleId, workOf,
  type CountedLayer, type DecodedPlane, type LayerPlaintext, type SettleTime,
} from './blockLayer'
import type { NostrEvent } from '../events'

/** A reach event as the author's chain places it: only events that may be reach events (§6.2) and for which the key is valid (§4.4). */
export interface ReachPlace {
  x: bigint
  y: bigint
  z: bigint
  plane: number
}

/** What a header check says about a settle's block (§6.1): the hash is right, the height is not 6 deep yet, or the hash is wrong. */
export type HeaderVerdict = 'ok' | 'pending' | 'bad'

export interface ReadDeps {
  /** The event's id and signature (check 1). */
  verify: (ev: NostrEvent) => boolean
  /** The chunk's region key and lookup id. */
  key: Uint8Array
  lookupId: string
  /** The chunk's base (its x, y, z: both planes share them). */
  chunk: Pick<ChunkBase, 'x' | 'y' | 'z'>
  /** The revision 2 ground of the chunk in a plane. */
  ground: (plane: 0 | 1) => Promise<Uint8Array>
  /**
   * The reach events, of those the layer names, that its builder key is valid
   * for (§4.4) and that are real positions on a valid line of the author's
   * chain (§6.2), each with its place; empty when none is.
   */
  reach: (author: string, builder: string, ids: string[]) => Promise<Map<string, ReachPlace>>
  /** The header check of a settle's block. */
  header: (height: number, hash: string) => Promise<HeaderVerdict>
  /** The witness height of a settle for this exact version, or null (unwitnessed). */
  witness?: (eventId: string, settleId: string) => number | null
}

export type ReadResult =
  | { status: 'counted'; layer: CountedLayer; plaintext: LayerPlaintext }
  | { status: 'pending'; why: string }
  | { status: 'dropped'; why: string }

/** Read one layer event by §6.1. */
export async function readLayer(ev: NostrEvent, d: ReadDeps): Promise<ReadResult> {
  const drop = (why: string): ReadResult => ({ status: 'dropped', why })
  if (!d.verify(ev)) return drop('not authentic')
  const shape = layerShape(ev)
  if (!shape) return drop('tags')
  if (shape.lookupId !== d.lookupId) return drop('another chunk')
  if (serializedBytes(ev) > LAYER_MAX_BYTES) return drop('too long')
  const text = await decryptForRegion(d.key, shape.encrypted)
  if (text === null) return drop('does not open')
  const plain = parsePlaintext(text)
  if (!plain) return drop('plaintext')
  // Check 6: the settles hash, in order, to the settle tags.
  if (plain.settles.length !== shape.settleIds.length) return drop('settles')
  const ids: string[] = []
  for (let i = 0; i < plain.settles.length; i++) {
    const id = settleId(shape.author, shape.lookupId, plain.settles[i])
    if (id === null || id !== shape.settleIds[i]) return drop('settles')
    ids.push(id)
  }
  // Checks 7 and 8, per plane: decode against its base, and every placement's first settle claims its cell.
  const decoded: DecodedPlane[] = []
  for (const pl of plain.planes) {
    const g = await d.ground(pl.plane)
    const dp = decodePlane(pl, g, plain.settles.length)
    if (dp === null) return drop('plane')
    if (dp === 'aside') continue
    const claims = plain.settles.map((s) => s[3][pl.plane])
    const bits = new Map<number, Int32Array | null>()
    for (let k = 0; k < dp.placements.length; k++) {
      const s = dp.t0[k]
      if (!bits.has(s)) bits.set(s, expandBits(claims[s]))
      const b = bits.get(s)
      if (!b || !b[dp.placements[k]]) return drop('claims')
    }
    decoded.push(dp)
  }
  // Check 9: the builder key is valid for at least one reach event.
  const places = await d.reach(shape.author, ev.pubkey, shape.reach)
  if (places.size === 0) return drop('builder key or reach')
  // Check 10: each plane needs a reach event in it, within reach of the chunk.
  const near = (plane: number): boolean => [...places.values()].some((p) => reachDistance(p, { ...d.chunk, plane }) <= REACH)
  const planes = decoded.filter((p) => near(p.plane))
  // The settles' blocks against our headers.
  for (const s of plain.settles) {
    const v = await d.header(s[0], s[1])
    if (v === 'bad') return drop('block hash')
    if (v === 'pending') return { status: 'pending', why: `block ${s[0]} not confirmed here yet` }
  }
  const times: SettleTime[] = plain.settles.map((s, i) => ({ height: s[0], witness: d.witness?.(ev.id, ids[i]) ?? null, work: workOf(ids[i]) }))
  return {
    status: 'counted',
    plaintext: plain,
    layer: { author: shape.author, builder: ev.pubkey, builders: plain.builders, retiredKey: false, times, planes },
  }
}

function expandBits(runs: unknown): Int32Array | null {
  return expandRuns(runs, CELLS, 2)
}
