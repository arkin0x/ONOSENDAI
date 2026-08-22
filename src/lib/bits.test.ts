/**
 * bits.test.ts: pins the XOR readout to the protocol.
 *
 * The readout exists to make LCA height legible, so the failure that matters is
 * not a crash, it is a picture that quietly disagrees with what the mover
 * actually charges. Every test here compares the drawn window against
 * findLcaHeight, which is the function the proof worker itself uses.
 */

import { describe, it, expect } from 'vitest'
import { AXIS_MAX, findLcaHeight } from 'cyberspace-core'
import { WINDOW_BITS, axisReadout, xorReadout } from './bits'
import { canonicalQuaternion, viewAxes, type Position } from './space'

/** The readout for one pair, on an arbitrary axis, at a given window floor. */
function read(a: bigint, b: bigint, scaleExp = 0) {
  return axisReadout('x', a, b, scaleExp)
}

/**
 * Deterministic 85-bit pairs. A seeded LCG rather than Math.random so a failure
 * is reproducible, and built from three 32-bit draws because the range is wider
 * than a double can address exactly.
 */
function* randomPairs(count: number): Generator<[bigint, bigint]> {
  let seed = 0x9e3779b9
  const next32 = (): bigint => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return BigInt(seed)
  }
  const draw = (): bigint => ((next32() << 64n) | (next32() << 32n) | next32()) % (AXIS_MAX + 1n)
  for (let i = 0; i < count; i++) yield [draw(), draw()]
}

describe('the wall is the LCA height', () => {
  it('puts the wall at findLcaHeight - 1 across the whole 85-bit range', () => {
    for (const [a, b] of randomPairs(400)) {
      const h = findLcaHeight(a, b)
      // Anchor the window so the wall lands inside it, which is the case the
      // property is about; the out-of-window cases have their own tests.
      const scaleExp = Math.max(0, Math.min(h - 1, 85 - WINDOW_BITS))
      const r = read(a, b, scaleExp)
      expect(r.height).toBe(h)
      expect(r.wallBit).toBe(h === 0 ? null : h - 1)
      if (h > 0) expect(r.wall).toBe('1')
    }
  })

  it('reports no wall at all when the coordinates are identical', () => {
    for (const v of [0n, 1n, 12345n, AXIS_MAX]) {
      const r = read(v, v)
      expect(findLcaHeight(v, v)).toBe(0)
      expect(r.wallBit).toBeNull()
      expect(r.height).toBe(0)
      expect(r.wall).toBe('')
      expect(r.xor).toBe('0'.repeat(WINDOW_BITS))
      // Nothing differs anywhere, so the entire window is shared structure.
      expect(r.matched.length).toBe(WINDOW_BITS)
    }
  })

  it('finds a wall at bit 0', () => {
    const r = read(1n << 40n, (1n << 40n) | 1n)
    expect(r.wallBit).toBe(0)
    expect(r.height).toBe(findLcaHeight(1n << 40n, (1n << 40n) | 1n))
    expect(r.height).toBe(1)
    expect(r.matched).toBe('0'.repeat(WINDOW_BITS - 1))
    expect(r.rest).toBe('')
  })

  it('finds a wall at bit 84, the top of the axis', () => {
    const a = 5n
    const b = (1n << 84n) | 5n
    // The window has to be lifted to see it; at scale 0 the wall is far above.
    const r = read(a, b, 84 - WINDOW_BITS + 1)
    expect(r.wallBit).toBe(84)
    expect(r.height).toBe(findLcaHeight(a, b))
    expect(r.height).toBe(85)
    expect(r.wall).toBe('1')
    expect(r.matched).toBe('')
  })

  it('teaches 4 -> 5 against 7 -> 8', () => {
    const cheap = read(4n, 5n)
    const dear = read(7n, 8n)

    // One step each. The bits are the explanation the numbers cannot give.
    expect(cheap.xor.endsWith('0001')).toBe(true)
    expect(dear.xor.endsWith('1111')).toBe(true)
    expect(cheap.height).toBe(1)
    expect(dear.height).toBe(4)
    // A tree sixteen times the size: 1 pairing against 15.
    expect(2 ** cheap.height - 1).toBe(1)
    expect(2 ** dear.height - 1).toBe(15)

    // Only the top bit of 0b1111 is the wall. The three below it are inside the
    // differing region: drawing them as shared would say the two coordinates
    // agree on three bits they do not agree on.
    expect(dear.matched.length).toBe(WINDOW_BITS - 4)
    expect(dear.wall).toBe('1')
    expect(dear.rest).toBe('111')
  })

  it('keeps interior zeroes out of the matched run', () => {
    // 0b1001: h is 4, and the two interior bits are zero without being shared.
    const r = read(0n, 0b1001n)
    expect(r.height).toBe(findLcaHeight(0n, 0b1001n))
    expect(r.matched.length).toBe(WINDOW_BITS - 4)
    expect(r.rest).toBe('001')
    expect(r.matched.includes('1')).toBe(false)
  })
})

describe('window edges', () => {
  const scaleExp = 10
  const low = scaleExp
  const high = scaleExp + WINDOW_BITS - 1

  it('shows a wall sitting exactly on the window floor', () => {
    const a = 0n
    const b = 1n << BigInt(low)
    const r = read(a, b, scaleExp)
    expect(findLcaHeight(a, b)).toBe(low + 1)
    expect(r.wallBit).toBe(low)
    expect(r.matched.length).toBe(WINDOW_BITS - 1)
    expect(r.wall).toBe('1')
    expect(r.hiddenBelow).toBe(false)
  })

  it('shows a wall sitting exactly on the window ceiling', () => {
    const a = 0n
    const b = 1n << BigInt(high)
    const r = read(a, b, scaleExp)
    expect(findLcaHeight(a, b)).toBe(high + 1)
    expect(r.wallBit).toBe(high)
    expect(r.matched).toBe('')
    expect(r.wall).toBe('1')
    expect(r.hiddenAbove).toBe(false)
  })

  it('marks a wall one bit above the ceiling as out of frame', () => {
    // Above the window is above MAX_COMPUTE_HEIGHT relative to the floor, so
    // this is a sidestep, and the window would otherwise read as a clean match.
    const a = 0n
    const b = 1n << BigInt(high + 1)
    const r = read(a, b, scaleExp)
    expect(r.wallBit).toBe(high + 1)
    expect(r.hiddenAbove).toBe(true)
    expect(r.xor).toBe('0'.repeat(WINDOW_BITS))
    // Not one bit of it is shared structure, despite being all zeroes.
    expect(r.matched).toBe('')
    expect(r.rest).toBe('0'.repeat(WINDOW_BITS))
  })

  it('marks a wall one bit below the floor as out of frame', () => {
    const a = 0n
    const b = 1n << BigInt(low - 1)
    const r = read(a, b, scaleExp)
    expect(r.wallBit).toBe(low - 1)
    expect(r.hiddenBelow).toBe(true)
    expect(r.hiddenAbove).toBe(false)
    expect(r.xor).toBe('0'.repeat(WINDOW_BITS))
    // Every drawn bit really is above the divergence, so the run is genuine.
    expect(r.matched.length).toBe(WINDOW_BITS)
  })
})

describe('divergence hidden below the window', () => {
  it('catches the nudge-then-zoom case', () => {
    // One gibson apart at scale 0, then zoomed out to 2^10: bit 0 is set and
    // the window starts at bit 10, so nothing of the difference is drawable.
    const a = 4096n
    const b = 4097n
    expect(read(a, b, 0).hiddenBelow).toBe(false)
    const zoomed = read(a, b, 10)
    expect(zoomed.hiddenBelow).toBe(true)
    // The cost is unchanged by zooming. Only the visibility changed.
    expect(zoomed.height).toBe(findLcaHeight(a, b))
    expect(zoomed.height).toBe(1)
  })

  it('does not change the height when a taller wall is in frame', () => {
    const a = 0n
    const b = (1n << 15n) | 1n
    const r = read(a, b, 10)
    expect(r.hiddenBelow).toBe(true)
    expect(r.height).toBe(findLcaHeight(a, b))
    expect(r.height).toBe(16)
    expect(r.wall).toBe('1')
  })

  it('never fires when the window is anchored at bit 0', () => {
    for (const [a, b] of randomPairs(60)) {
      expect(read(a, b, 0).hiddenBelow).toBe(false)
    }
  })

  it('fires exactly once the window floor rises past the difference', () => {
    const a = 0n
    const b = 1n << 5n
    for (let scaleExp = 0; scaleExp <= 12; scaleExp++) {
      expect(read(a, b, scaleExp).hiddenBelow).toBe(scaleExp > 5)
    }
  })
})

describe('readout invariants', () => {
  it('draws exactly WINDOW_BITS columns, whatever the values', () => {
    for (const [a, b] of randomPairs(120)) {
      for (const scaleExp of [0, 7, 40, 84]) {
        const r = read(a, b, scaleExp)
        expect(r.avatar.length).toBe(WINDOW_BITS)
        expect(r.cursor.length).toBe(WINDOW_BITS)
        expect(r.xor.length).toBe(WINDOW_BITS)
        expect(r.matched + r.wall + r.rest).toBe(r.xor)
      }
    }
  })

  it('renders rows that XOR back to the XOR row', () => {
    for (const [a, b] of randomPairs(120)) {
      const scaleExp = 12
      const r = read(a, b, scaleExp)
      const bits = (s: string): bigint => BigInt(`0b${s}`)
      expect(bits(r.avatar) ^ bits(r.cursor)).toBe(bits(r.xor))
    }
  })

  it('ties the matched run to the height: matched = scaleExp + WINDOW_BITS - h', () => {
    for (const [a, b] of randomPairs(400)) {
      for (const scaleExp of [0, 13, 44, 65]) {
        const h = findLcaHeight(a, b)
        const r = read(a, b, scaleExp)
        const inWindow = h - 1 >= scaleExp && h - 1 <= scaleExp + WINDOW_BITS - 1
        if (!inWindow) continue
        expect(r.matched.length).toBe(scaleExp + WINDOW_BITS - h)
        // And it really is the run of leading zeroes, not just a count.
        expect(r.matched).toBe('0'.repeat(r.matched.length))
        expect(r.wall).toBe('1')
      }
    }
  })

  it('never claims shared structure above a wall that is out of frame', () => {
    for (const [a, b] of randomPairs(200)) {
      const r = read(a, b, 0)
      if (r.hiddenAbove) expect(r.matched).toBe('')
    }
  })
})

describe('column order', () => {
  const avatar: Position = { x: 1n, y: 2n, z: 3n }
  const cursor: Position = { x: 9n, y: 9n, z: 9n }

  it('follows the screen axes, each labelled with its own letter', () => {
    // Canonical view (spec section 11.3): +X right, +Y up, -Z out.
    const cols = xorReadout(avatar, cursor, viewAxes(canonicalQuaternion()), 0)
    expect(cols.map((c) => c.axis)).toEqual(['x', 'y', 'z'])
    // Each column reads the axis it is labelled with, not the one at its index.
    for (const c of cols) {
      expect(c.height).toBe(findLcaHeight(avatar[c.axis], cursor[c.axis]))
    }
  })

  it('reshuffles when the view rotates, which is why the labels exist', () => {
    const rotated = viewAxes(canonicalQuaternion())
    const swapped = { right: rotated.up, up: rotated.right, out: rotated.out }
    const cols = xorReadout(avatar, cursor, swapped, 0)
    expect(cols.map((c) => c.axis)).toEqual(['y', 'x', 'z'])
  })
})
