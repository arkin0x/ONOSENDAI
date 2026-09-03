/**
 * shardCrypto.ts — hiding a shard at a place.
 *
 * Spec §7: a region's Cantor root is a secret you can only get by doing the
 * work of computing it, and the same work whether you walked there or computed
 * the coordinate directly. So a shard encrypted to a region is chalk on the
 * sidewalk: published in the open, readable only once you have paid the cost of
 * being (or computing) where it is.
 *
 * The derivation is spec §7.2 exactly, via cyberspace-core, so a shard this
 * client hides is one the reference CLI can find and open, and the reverse:
 * `key = sha256(int_to_bytes_be_min(region_n))`, `lookup_id = sha256(key)`.
 * The cipher is the CLI's: AES-256-GCM, a fresh 12-byte nonce prepended to the
 * ciphertext, the whole thing base64, in an `["encrypted","aes-256-gcm",…]`
 * tag. Only the lookup and the key are normative; the cipher is a convention
 * this shares with the CLI so the two interoperate.
 */

import { deriveRegionKeys, deriveRegionN } from 'cyberspace-core'
import { bytesToHex } from './events'
import type { Position } from './space'

/** The algorithm string in the `encrypted` tag; the CLI rejects any other. */
export const ALGO = 'aes-256-gcm'

/** What actually gets encrypted: the shard, where it sits, and in which plane. */
export interface DeployedPayload {
  shard: import('./shards').ShardPayload
  at: { x: string; y: string; z: string }
  plane: 0 | 1
}

export interface RegionKey {
  regionN: bigint
  key: Uint8Array
  lookupId: string
}

/** The region key at a coordinate and height (spec §7.2, §7.4). */
export function regionKeyAt(pos: Position, height: number, maxComputeHeight: number): RegionKey {
  const regionN = deriveRegionN(pos.x, pos.y, pos.z, height, maxComputeHeight)
  const { locationDecryptionKey, lookupIdHex } = deriveRegionKeys(regionN)
  return { regionN, key: locationDecryptionKey, lookupId: lookupIdHex }
}

function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const subtle = (): SubtleCrypto => {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto
  if (!c?.subtle) {
    throw new Error('WebCrypto unavailable - this test environment needs a polyfill or a Node.js version with WebCrypto support')
  }
  return c.subtle
}

/** Encrypt with a region key; returns the base64 `nonce||ciphertext||tag`. */
export async function encryptForRegion(key: Uint8Array, plaintext: string): Promise<string> {
  const cryptoKey = await subtle().importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt'])
  const nonce = new Uint8Array(12)
  ;(globalThis.crypto as Crypto).getRandomValues(nonce)
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, cryptoKey, new TextEncoder().encode(plaintext)))
  const payload = new Uint8Array(nonce.length + ct.length)
  payload.set(nonce, 0)
  payload.set(ct, nonce.length)
  return b64encode(payload)
}

/** Decrypt what encryptForRegion produced; null on any failure, including the
 * wrong key, which is the common case when a lookup_id happens to collide. */
export async function decryptForRegion(key: Uint8Array, b64: string): Promise<string | null> {
  try {
    const payload = b64decode(b64)
    if (payload.length < 12 + 16) return null
    const nonce = payload.slice(0, 12)
    const ct = payload.slice(12)
    const cryptoKey = await subtle().importKey('raw', key as BufferSource, 'AES-GCM', false, ['decrypt'])
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: nonce }, cryptoKey, ct as BufferSource)
    return new TextDecoder().decode(pt)
  } catch {
    return null
  }
}

/** For a lookup_id tag, lowercase hex. Re-exported so callers need one import. */
export { bytesToHex }
