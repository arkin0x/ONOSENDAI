import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { destinationHeights, holdCloudDestinationKeys, holdDestinationCubes } from './destinationKeys'
import { regionKeyAt } from './shardCrypto'
import { bytesToHex } from './events'
import { useSecrets } from '../store/useSecrets'

describe('which cubes a hop earns', () => {
  it('none when the hop is no taller than the passive scan reaches', () => {
    expect(destinationHeights(12, 20)).toEqual([])
  })

  it('from just above the scan up to the hop, capped by this machine', () => {
    expect(destinationHeights(20, 17)).toEqual([13, 14, 15, 16, 17])
    expect(destinationHeights(15, 20)).toEqual([13, 14, 15])
    expect(destinationHeights(30, 20)).toEqual([13, 14, 15, 16, 17, 18, 19, 20])
  })
})

describe('holding the cubes', () => {
  beforeEach(() => { useSecrets.setState({ keys: {} }) })

  it('holds one cube per height at the destination, aligned, and it is the region key anyone standing there would compute', async () => {
    const at = { x: (1n << 40n) + 12345n, y: (1n << 41n) + 777n, z: (1n << 39n) + 9n }
    const n = await holdDestinationCubes(at, 0, [13, 14], 20, 'hop', 'e'.repeat(64))
    expect(n).toBe(2)
    const keys = Object.values(useSecrets.getState().keys)
    expect(keys.map((k) => k.height).sort()).toEqual([13, 14])
    const k13 = keys.find((k) => k.height === 13)!
    expect(k13.base.x).toBe(String((at.x >> 13n) << 13n))
    expect(k13.source).toBe('hop')
    const direct = regionKeyAt(at, 13, 20)
    expect(k13.lookupId).toBe(direct.lookupId)
    expect(k13.keyHex).toBe(bytesToHex(direct.key))
  })

  it('holds what HOSAKA sent as bought keys', () => {
    const at = { x: 1n << 30n, y: 1n << 30n, z: 1n << 30n }
    const n = holdCloudDestinationKeys([{ height: 18, secret_key: 'ab'.repeat(32), lookup_id: 'cd'.repeat(32) }, { height: 19, secret_key: '', lookup_id: 'x' }], at, 0)
    expect(n).toBe(1)
    const k = useSecrets.getState().keys['cd'.repeat(32)]
    expect(k.height).toBe(18)
    expect(k.source).toBe('cloud')
    expect(k.base.x).toBe(String(1n << 30n))
  })
})
