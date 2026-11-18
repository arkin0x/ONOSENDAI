/**
 * randomCoord.test.ts - the View panel's dice (arkinox, 2026-11-18): a
 * completely random 256-bit coordinate from the cryptographic generator.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { coordToXyz } from 'cyberspace-core'
import { COORD_BYTES, randomCoordHex } from '../randomCoord'
import { parseViewAt } from '../viewAt'

afterEach(() => { vi.restoreAllMocks() })

/** Make the generator hand back these bytes, and count its calls. */
function fixBytes(bytes: number[]) {
  return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
    ;(a as unknown as Uint8Array).set(bytes)
    return a
  })
}

describe('randomCoordHex', () => {
  it('asks crypto.getRandomValues for one 32-byte array, never Math.random', () => {
    const spy = fixBytes(Array.from({ length: 32 }, (_, i) => i))
    const math = vi.spyOn(Math, 'random')
    randomCoordHex()
    expect(spy).toHaveBeenCalledTimes(1)
    const arg = spy.mock.calls[0][0] as unknown as Uint8Array
    expect(arg).toBeInstanceOf(Uint8Array)
    expect(arg.length).toBe(COORD_BYTES)
    expect(COORD_BYTES).toBe(32)
    expect(math).not.toHaveBeenCalled()
  })

  it('writes the bytes as 64 lowercase hex characters, in order, small bytes padded', () => {
    fixBytes([0x00, 0x0a, 0xab, 0xff, ...Array.from({ length: 28 }, () => 0x01)])
    const hex = randomCoordHex()
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
    expect(hex).toBe('000aabff' + '01'.repeat(28))
  })

  it('the real generator gives 64 lowercase hex characters, a new one each time', () => {
    const a = randomCoordHex()
    const b = randomCoordHex()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})

describe('every roll is a place View accepts (no bit of a coordinate is reserved)', () => {
  it('the extremes and both planes read as the point they name', () => {
    for (const hex of ['0'.repeat(64), 'f'.repeat(64), '0'.repeat(63) + '1', 'f'.repeat(63) + 'e']) {
      const c = coordToXyz(BigInt('0x' + hex))
      // The plane given here is ignored: a coordinate carries its own.
      expect(parseViewAt(hex, 0), hex).toMatchObject({ position: { x: c.x, y: c.y, z: c.z }, plane: c.plane })
      expect(parseViewAt(hex, 1)?.plane, hex).toBe(c.plane)
    }
    expect(parseViewAt('0'.repeat(63) + '1', 0)?.plane).toBe(1)
    expect(parseViewAt('f'.repeat(63) + 'e', 1)?.plane).toBe(0)
  })

  it('a thousand real rolls all parse', () => {
    for (let i = 0; i < 1000; i++) {
      const hex = randomCoordHex()
      expect(parseViewAt(hex, 0), hex).not.toBeNull()
    }
  })
})
