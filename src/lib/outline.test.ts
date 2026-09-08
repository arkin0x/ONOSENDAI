import { describe, expect, it } from 'vitest'
import { faceEdges } from './outline'
import { DIVISIONS, TICKS_PER_UNIT } from './shards'

/** Edges as unordered pairs, so a test does not care which way one is written. */
const pairs = (idx: number[]): string[] => {
  const out: string[] = []
  for (let i = 0; i < idx.length; i += 2) out.push([idx[i], idx[i + 1]].sort((a, b) => a - b).join('-'))
  return out.sort()
}

describe('faceEdges', () => {
  it('draws a triangle as its three edges', () => {
    expect(pairs(faceEdges([[0, 1, 2]]))).toEqual(['0-1', '0-2', '1-2'])
  })

  it('draws a quad as four edges, with no diagonal', () => {
    expect(pairs(faceEdges([[0, 1, 2, 3]]))).toEqual(['0-1', '0-3', '1-2', '2-3'])
  })

  it('draws an edge two faces share exactly once', () => {
    // Two triangles meeting along 1-2: five edges, not six.
    const e = faceEdges([[0, 1, 2], [1, 3, 2]])
    expect(pairs(e)).toEqual(['0-1', '0-2', '1-2', '1-3', '2-3'])
  })

  it('a closed box has twelve edges however its faces were cut', () => {
    const box = [
      [0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1],
      [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3],
    ]
    expect(pairs(faceEdges(box))).toHaveLength(12)
  })

  it('ignores degenerate faces and repeated points', () => {
    expect(faceEdges([])).toEqual([])
    expect(faceEdges([[5]])).toEqual([])
    expect(pairs(faceEdges([[0, 0, 1]]))).toEqual(['0-1'])
    // A two-point face is one edge, not the same edge there and back.
    expect(faceEdges([[2, 3]])).toEqual([2, 3])
  })
})

describe('grid divisions', () => {
  it('every division divides a unit into whole ticks', () => {
    for (const d of DIVISIONS) {
      expect(TICKS_PER_UNIT % d).toBe(0)
      expect(Number.isInteger(TICKS_PER_UNIT / d)).toBe(true)
    }
  })

  it('offers 6, 8 and 10 and not the ones that would land between ticks', () => {
    expect([...DIVISIONS]).toEqual([1, 2, 3, 4, 5, 6, 8, 10])
    expect(DIVISIONS).not.toContain(7 as never)
    expect(DIVISIONS).not.toContain(9 as never)
  })
})
