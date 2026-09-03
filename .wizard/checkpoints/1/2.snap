/**
 * shardCrypto.test.ts - the round trip, and the location gate.
 *
 * A shard hidden at a region must come back only to the same region key, and
 * the key must be a stable function of the coordinate and height so that
 * anyone who computes that region, however they got there, opens it. The
 * lookup_id must reveal nothing: seeing it must not let you derive the key.
 */

import { describe, it, expect } from 'vitest'
import { deriveRegionKeys, deriveRegionN } from 'cyberspace-core'
import { decryptForRegion, encryptForRegion, regionKeyAt } from './shardCrypto'
import { bytesToHex } from './events'

const here = { x: 123456n, y: 654321n, z: 999n }

describe('region key (spec 7.2)', () => {
  it('is sha256(region_bytes) with lookup = sha256(key), matching the primitives', () => {
    const rk = regionKeyAt(here, 8, 20)
    const rn = deriveRegionN(here.x, here.y, here.z, 8, 20)
    const direct = deriveRegionKeys(rn)
    expect(rk.regionN).toBe(rn)
    expect(bytesToHex(rk.key)).toBe(bytesToHex(direct.locationDecryptionKey))
    expect(rk.lookupId).toBe(direct.lookupIdHex)
  })

  it('is the same for any coordinate inside the aligned cube at that height', () => {
    const a = regionKeyAt({ x: (5n << 8n), y: 0n, z: 0n }, 8, 20)
    const b = regionKeyAt({ x: (5n << 8n) + 200n, y: 0n, z: 0n }, 8, 20)
    expect(a.lookupId).toBe(b.lookupId)
    const outside = regionKeyAt({ x: (6n << 8n), y: 0n, z: 0n }, 8, 20)
    expect(outside.lookupId).not.toBe(a.lookupId)
  })

  it('does not leak the key through the lookup id', () => {
    const rk = regionKeyAt(here, 8, 20)
    expect(rk.lookupId).not.toBe(bytesToHex(rk.key))
  })
})

describe('encrypt / decrypt', () => {
  it('round-trips through the region key', async () => {
    const rk = regionKeyAt(here, 6, 20)
    const ct = await encryptForRegion(rk.key, 'chalk on the sidewalk')
    expect(await decryptForRegion(rk.key, ct)).toBe('chalk on the sidewalk')
  })

  it('is unreadable to the wrong region', async () => {
    const mine = regionKeyAt(here, 6, 20)
    const other = regionKeyAt({ x: here.x + (1n << 6n), y: here.y, z: here.z }, 6, 20)
    const ct = await encryptForRegion(mine.key, 'secret')
    expect(await decryptForRegion(other.key, ct)).toBeNull()
  })

  it('uses a fresh nonce each time', async () => {
    const rk = regionKeyAt(here, 4, 20)
    const a = await encryptForRegion(rk.key, 'x')
    const b = await encryptForRegion(rk.key, 'x')
    expect(a).not.toBe(b)
  })
})
