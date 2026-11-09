/**
 * regionKeyCheck.test.ts: a key HOSAKA sold is checked before it is used.
 *
 * Heights are small (4), so the inline derivation the test runner falls back
 * to is cheap; the ceiling cases lower the calibrated ceiling instead of
 * deriving anything high, and the worker path is a spy that says when it ran.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../regionKeyOffThread', async (orig) => {
  const real = await orig() as typeof import('../regionKeyOffThread')
  return { ...real, regionKeyOffThread: vi.fn(real.regionKeyOffThread) }
})

import { WRONG_KEY, boughtKeyProblem, checkBoughtKey, keyFitsLookup, lookupIdOf, wrongKeyMessage } from '../regionKeyCheck'
import { regionKeyOffThread } from '../regionKeyOffThread'
import { regionKeyAt } from '../shardCrypto'
import { useCalibration } from '../calibration'
import { bytesToHex } from '../events'
import type { HosakaRegionKeyResult } from '../hosaka'
import type { Position } from '../space'

const HEIGHT = 4
const AT: Position = { x: (1n << 40n) + 0x35n, y: (1n << 39n) + 0x12n, z: (1n << 38n) + 0x2an }
const ELSEWHERE: Position = { x: AT.x + 1000n, y: AT.y, z: AT.z }
const h = BigInt(HEIGHT)
const BASE = { x: ((AT.x >> h) << h).toString(), y: ((AT.y >> h) << h).toString(), z: ((AT.z >> h) << h).toString() }

/** What HOSAKA returns for a cube: its real key, unless told otherwise. */
function sold(over: Partial<HosakaRegionKeyResult> = {}, at: Position = AT): HosakaRegionKeyResult {
  const rk = regionKeyAt(at, HEIGHT, 20)
  return { secret_key: bytesToHex(rk.key), lookup_id: rk.lookupId, height: HEIGHT, base: BASE, ...over }
}

beforeEach(() => {
  useCalibration.setState({ hopHeight: 17 })
  vi.mocked(regionKeyOffThread).mockClear()
})

describe('lookupIdOf and keyFitsLookup (spec §7.2: lookup_id = sha256(key))', () => {
  it('agree with the region key the coordinate gives', () => {
    const rk = regionKeyAt(AT, HEIGHT, 20)
    expect(lookupIdOf(rk.key)).toBe(rk.lookupId)
    expect(keyFitsLookup(bytesToHex(rk.key), rk.lookupId)).toBe(true)
    expect(keyFitsLookup(bytesToHex(rk.key).toUpperCase(), rk.lookupId.toUpperCase())).toBe(true)
  })

  it('refuse a lookup id that is not the key\'s, and anything not 32 bytes of hex', () => {
    const rk = regionKeyAt(AT, HEIGHT, 20)
    expect(keyFitsLookup(bytesToHex(rk.key), 'ee'.repeat(32))).toBe(false)
    expect(keyFitsLookup('11'.repeat(31), rk.lookupId)).toBe(false)
    expect(keyFitsLookup('zz'.repeat(32), rk.lookupId)).toBe(false)
  })
})

describe('boughtKeyProblem: what HOSAKA returned, on its own', () => {
  it('passes the right key for the cube asked for', () => {
    expect(boughtKeyProblem(sold(), { at: AT, height: HEIGHT })).toBeNull()
    // Base as numbers, as hosaka-api sends them, is read the same.
    expect(boughtKeyProblem(sold({ base: { x: Number(BASE.x), y: Number(BASE.y), z: Number(BASE.z) } }), { at: AT, height: HEIGHT })).toBeNull()
  })

  it('refuses a lookup id that is not sha256 of the key', () => {
    expect(boughtKeyProblem(sold({ lookup_id: 'ee'.repeat(32) }), { at: AT, height: HEIGHT })).toMatch(/not the sha256 of its key/)
  })

  it('refuses a key that is not 32 bytes of hex', () => {
    expect(boughtKeyProblem(sold({ secret_key: 'abc' }), { at: AT, height: HEIGHT })).toMatch(/not 32 bytes/)
  })

  it('refuses a key for another height or another cube', () => {
    expect(boughtKeyProblem(sold({ height: HEIGHT + 1 }), { at: AT, height: HEIGHT })).toMatch(/height 5, not 4/)
    expect(boughtKeyProblem(sold({ base: { ...BASE, x: (BigInt(BASE.x) + 16n).toString() } }), { at: AT, height: HEIGHT })).toMatch(/another cube/)
  })

  it('refuses a key that does not hash to the lookup id of the bag it was bought for, and passes one that does', () => {
    const rk = regionKeyAt(AT, HEIGHT, 20)
    expect(boughtKeyProblem(sold(), { at: AT, height: HEIGHT, lookupId: rk.lookupId })).toBeNull()
    expect(boughtKeyProblem(sold(), { at: AT, height: HEIGHT, lookupId: 'ee'.repeat(32) })).toMatch(/not the key to the bag/)
  })
})

describe('checkBoughtKey: and the key this device derives, where it can', () => {
  it('within the ceiling: derives off the main thread, and passes the right key', async () => {
    expect(await checkBoughtKey(sold(), { at: AT, height: HEIGHT })).toBeNull()
    expect(regionKeyOffThread).toHaveBeenCalledWith(AT, HEIGHT, 20)
  })

  it('within the ceiling: refuses a well-formed key of another cube, base and all as asked', async () => {
    // Self-consistent (lookup id is its sha256) and labelled with this cube: only the derivation catches it.
    const other = sold({ base: BASE }, ELSEWHERE)
    expect(boughtKeyProblem(other, { at: AT, height: HEIGHT })).toBeNull()
    expect(await checkBoughtKey(other, { at: AT, height: HEIGHT })).toMatch(/not the key this device derives/)
  })

  it('above this device\'s ceiling: derives nothing, and the shape checks still refuse', async () => {
    useCalibration.setState({ hopHeight: HEIGHT - 1 })
    expect(await checkBoughtKey(sold({ base: BASE }, ELSEWHERE), { at: AT, height: HEIGHT })).toBeNull()
    expect(await checkBoughtKey(sold({ lookup_id: 'ee'.repeat(32) }), { at: AT, height: HEIGHT })).toMatch(/not the sha256/)
    expect(regionKeyOffThread).not.toHaveBeenCalled()
  })

  it('above 20 on any device: derives nothing', async () => {
    useCalibration.setState({ hopHeight: 30 })
    const r = sold({ height: 25, base: undefined as never })
    expect(await checkBoughtKey(r, { at: AT, height: 25 })).toBeNull()
    expect(regionKeyOffThread).not.toHaveBeenCalled()
  })

  it('a derivation that fails proves nothing either way, and does not refuse the key', async () => {
    vi.mocked(regionKeyOffThread).mockRejectedValueOnce(new Error('worker crashed'))
    expect(await checkBoughtKey(sold(), { at: AT, height: HEIGHT })).toBeNull()
  })
})

describe('wrongKeyMessage', () => {
  it('says HOSAKA returned a wrong key, why, and that it was not used, with no em dash', () => {
    const m = wrongKeyMessage('it is for another cube')
    expect(m.startsWith(`${WRONG_KEY}: it is for another cube.`)).toBe(true)
    expect(m).toContain('not kept or used')
    expect(m).not.toContain(String.fromCharCode(0x2014))
  })
})
