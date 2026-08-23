/**
 * shardEvents.ts — a deployed shard on the wire.
 *
 * Spec §8.6: an encrypted content event is kind 33330 with a `d` tag holding
 * the lookup_id and an optional `h` height hint. The ciphertext carrier is the
 * CLI's `encrypted` tag. Nothing here reveals the coordinate: the whole point
 * is that only someone who has computed the region key can read where it is.
 */

import { ALGO, decryptForRegion, encryptForRegion, regionKeyAt } from './shardCrypto'
import { fromPayload, toPayload, type ShardModel } from './shards'
import type { DeployedPayload } from './shardCrypto'
import type { EventTemplate, NostrEvent } from './events'
import type { Plane } from 'cyberspace-core'
import type { Position } from './space'

export const ENCRYPTED_KIND = 33330

export interface DeployInput {
  shard: ShardModel
  at: Position
  plane: Plane
  height: number
  createdAt: number
  maxComputeHeight: number
}

export interface DeployResult {
  template: EventTemplate
  lookupId: string
  key: Uint8Array
  regionN: bigint
}

/** Build the kind 33330 template for a shard hidden at a location. */
export async function deployTemplate(i: DeployInput): Promise<DeployResult> {
  const { key, lookupId, regionN } = regionKeyAt(i.at, i.height, i.maxComputeHeight)
  const payload: DeployedPayload = {
    shard: toPayload(i.shard),
    at: { x: i.at.x.toString(), y: i.at.y.toString(), z: i.at.z.toString() },
    plane: i.plane,
  }
  const ciphertext = await encryptForRegion(key, JSON.stringify(payload))
  const template: EventTemplate = {
    kind: ENCRYPTED_KIND,
    created_at: i.createdAt,
    content: '',
    tags: [
      ['d', lookupId],
      ['encrypted', ALGO, ciphertext],
      ['version', '2'],
      ['h', String(i.height)],
    ],
  }
  return { template, lookupId, key, regionN }
}

export interface DecodedShard {
  id: string
  shard: ShardModel
  at: Position
  plane: Plane
  /** The event that carried it, for dedup and the head time. */
  eventId: string
  height: number
}

function tag(ev: NostrEvent, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1]
}

/** The ciphertext out of a kind 33330 event, or null if it is not one. */
export function ciphertextOf(ev: NostrEvent): string | null {
  if (ev.kind !== ENCRYPTED_KIND) return null
  const enc = ev.tags.find((t) => t[0] === 'encrypted')
  if (!enc || enc[1] !== ALGO || !enc[2]) return null
  return enc[2]
}

export function heightHint(ev: NostrEvent): number | null {
  const h = tag(ev, 'h')
  if (h === undefined) return null
  const n = Number(h)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** Decrypt and parse one event with a region key; null on any mismatch. */
export async function decodeShard(ev: NostrEvent, key: Uint8Array): Promise<DecodedShard | null> {
  const ct = ciphertextOf(ev)
  if (!ct) return null
  const json = await decryptForRegion(key, ct)
  if (!json) return null
  try {
    const raw = JSON.parse(json) as DeployedPayload
    const shard = fromPayload(raw.shard, ev.id)
    if (!shard || !raw.at) return null
    const at = { x: BigInt(raw.at.x), y: BigInt(raw.at.y), z: BigInt(raw.at.z) }
    return { id: ev.id, shard, at, plane: raw.plane === 1 ? 1 : 0, eventId: ev.id, height: heightHint(ev) ?? 0 }
  } catch {
    return null
  }
}
