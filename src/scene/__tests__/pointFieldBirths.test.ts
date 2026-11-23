/**
 * pointFieldBirths.test.ts: a terrain cell keeps its age across a rebuild of
 * the point field, found by the volume's shift rather than by a string key
 * per cell (owner's phone diag, 2026-11-22: thousands of strings at every
 * landing of a walk).
 */
import { describe, expect, it } from 'vitest'
import { bornAt } from '../ShaderPointField'

const N = 3
function grid(at: [number, number, number], fill: (c: number, r: number, d: number) => number) {
  const birth = new Float32Array(N * N * N).fill(NaN)
  for (let d = 0; d < N; d++) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) birth[(d * N + r) * N + c] = fill(c, r, d)
  return { at, birth }
}

describe('point field births', () => {
  it('the same cell of a volume that moved one step right reads the age it had', () => {
    const last = grid([10, 0, 0], (c, r, d) => 100 + c + 10 * r + 100 * d)
    // The volume moved +1 to the right: its col 0 is the last one's col 1.
    expect(bornAt(last, [11, 0, 0], 0, 1, 2, N)).toBe(100 + 1 + 10 + 200)
    expect(bornAt(last, [11, 0, 0], 1, 0, 0, N)).toBe(102)
    // Its last column is new: no age.
    expect(bornAt(last, [11, 0, 0], 2, 0, 0, N)).toBeNaN()
  })

  it('a cell the last volume did not draw, or no last volume, has no age', () => {
    const last = grid([0, 0, 0], () => NaN)
    expect(bornAt(last, [0, 0, 0], 1, 1, 1, N)).toBeNaN()
    expect(bornAt(null, [0, 0, 0], 1, 1, 1, N)).toBeNaN()
  })

  it('moves on every axis, either way', () => {
    const last = grid([5, 5, 5], (c, r, d) => c + 10 * r + 100 * d)
    expect(bornAt(last, [4, 6, 5], 1, 0, 1, N)).toBe(0 + 10 + 100)
    expect(bornAt(last, [5, 5, 7], 0, 0, 0, N)).toBe(200)
    expect(bornAt(last, [5, 5, 3], 0, 0, 0, N)).toBeNaN()
  })
})
