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
  it('says HOSAKA returned a wrong key, why, that it was not used, and whether it was set aside, with no em dash', () => {
    const aside = wrongKeyMessage('it is for another cube', null)
    expect(aside).toBe(`${WRONG_KEY}: it is for another cube. It was set aside, not used: nothing was hidden or opened with it.`)
    expect(wrongKeyMessage('x', 'quota exceeded')).toContain('could not be set aside on this device (quota exceeded)')
    expect(wrongKeyMessage('x')).toContain('It was not used: nothing was hidden')
    for (const m of [aside, wrongKeyMessage('x'), wrongKeyMessage('x', 'q')]) expect(m).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('a corner near 2^84, as Python sends it (review of #626)', () => {
  // Every axis past 2^84, with low bits a double cannot hold, aligned to h20.
  const FAR: Position = { x: (1n << 84n) + (1n << 83n) + 12_345_678_901_234_567n, y: (1n << 84n) + 987_654_321_987_654_321n, z: (1n << 84n) + 55_555_555_555n }
  const H20 = 20n
  const corner = { x: ((FAR.x >> H20) << H20).toString(), y: ((FAR.y >> H20) << H20).toString(), z: ((FAR.z >> H20) << H20).toString() }
  const rk = regionKeyAt(AT, HEIGHT, 20)
  const key = { secret_key: bytesToHex(rk.key), lookup_id: rk.lookupId, height: 20 }
  /** Python's json.dumps text for the answer, its corner bare integers. */
  const python = `{"secret_key": "${key.secret_key}", "lookup_id": "${key.lookup_id}", "height": 20, "base": {"x": ${corner.x}, "y": ${corner.y}, "z": ${corner.z}}}`

  it('a corner JSON.parse rounded is not compared, and never refuses the right cube\'s key', () => {
    const parsed = JSON.parse(python) as HosakaRegionKeyResult
    expect(String(parsed.base.x)).not.toBe(corner.x)
    expect(boughtKeyProblem(parsed, { at: FAR, height: 20 })).toBeNull()
  })

  it('an exact corner, as a decimal string, is compared: the right cube passes, another is refused', () => {
    expect(boughtKeyProblem({ ...key, base: corner }, { at: FAR, height: 20 })).toBeNull()
    const off = { ...corner, z: (BigInt(corner.z) + (1n << 20n)).toString() }
    expect(boughtKeyProblem({ ...key, base: off }, { at: FAR, height: 20 })).toMatch(/another cube/)
  })

  it('a rounded axis is skipped while an exact one is still compared', () => {
    const mixed = { x: Number(corner.x), y: (BigInt(corner.y) + (1n << 20n)).toString(), z: Number(corner.z) }
    expect(boughtKeyProblem({ ...key, base: mixed }, { at: FAR, height: 20 })).toMatch(/another cube/)
  })
})
