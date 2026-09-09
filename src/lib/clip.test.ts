import { describe, expect, it } from 'vitest'
import { boxContains, clipMesh, clipPoints, regionBox, type Mesh } from './clip'

/** A unit square in the xy plane at z = 0, two triangles, red to blue across x. */
function square(): Mesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    colors: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0]),
    index: [0, 1, 2, 0, 2, 3],
  }
}

function area(m: Mesh): number {
  let a = 0
  for (let t = 0; t + 2 < m.index.length; t += 3) {
    const p = (i: number) => [m.positions[m.index[t + i] * 3], m.positions[m.index[t + i] * 3 + 1]]
    const [ax, ay] = p(0), [bx, by] = p(1), [cx, cy] = p(2)
    a += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
  }
  return a
}

const big = { min: [-9, -9, -9] as [number, number, number], max: [9, 9, 9] as [number, number, number] }

describe('clipping triangles to a box', () => {
  it('leaves a mesh inside the box untouched in area', () => {
    expect(area(clipMesh(square(), big))).toBeCloseTo(1)
  })

  it('cuts a square in half at a wall', () => {
    const half = clipMesh(square(), { min: [0.5, -9, -9], max: [9, 9, 9] })
    expect(area(half)).toBeCloseTo(0.5)
    for (let i = 0; i * 3 < half.positions.length; i++) expect(half.positions[i * 3]).toBeGreaterThanOrEqual(0.5)
  })

  it('interpolates colour along the cut', () => {
    const half = clipMesh(square(), { min: [0.5, -9, -9], max: [9, 9, 9] })
    // Every vertex on the cut at x = 0.5 is halfway from red to blue.
    for (let i = 0; i * 3 < half.positions.length; i++) {
      if (Math.abs(half.positions[i * 3] - 0.5) < 1e-6) {
        expect(half.colors[i * 3]).toBeCloseTo(0.5)
        expect(half.colors[i * 3 + 2]).toBeCloseTo(0.5)
      }
    }
  })

  it('drops a mesh entirely outside', () => {
    expect(clipMesh(square(), { min: [5, 5, 5], max: [6, 6, 6] }).index).toHaveLength(0)
  })

  it('a corner cut keeps the quarter', () => {
    expect(area(clipMesh(square(), { min: [0.5, 0.5, -1], max: [9, 9, 1] }))).toBeCloseTo(0.25)
  })
})

describe('points and containment', () => {
  it('keeps only the points inside, walls included', () => {
    const out = clipPoints(square().positions, square().colors, { min: [0.5, 0, 0], max: [1, 1, 0] })
    expect(out.positions.length / 3).toBe(2)
  })

  it('says when the box already holds everything', () => {
    expect(boxContains(big, square().positions)).toBe(true)
    expect(boxContains({ min: [0.5, -9, -9], max: [9, 9, 9] }, square().positions)).toBe(false)
  })
})

describe('the region box in a shard frame', () => {
  const axes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } } as const

  it('a shard at the low corner of its region sees the cube run from itself up 2^h', () => {
    // at is aligned to 2^4; unit 0 (one gibson per model unit); zoom 2^0, so the
    // frame's origin is at + half a gibson.
    const at = { x: 32n, y: 64n, z: 96n }
    const box = regionBox(at, 4, 0, 0, axes as never)
    expect(box.min[0]).toBeCloseTo(-0.5)
    expect(box.max[0]).toBeCloseTo(15.5)
    // The out axis points the other way: the range flips sign.
    expect(box.min[2]).toBeCloseTo(-15.5)
    expect(box.max[2]).toBeCloseTo(0.5)
  })

  it('scales with the model unit', () => {
    const at = { x: 32n, y: 64n, z: 96n }
    const box = regionBox(at, 4, 2, 0, axes as never)
    expect(box.max[0] - box.min[0]).toBeCloseTo(16 / 4)
  })

  it('a shard in the middle of its region sees walls on both sides', () => {
    const at = { x: 40n, y: 64n, z: 96n }
    const box = regionBox(at, 4, 0, 0, axes as never)
    expect(box.min[0]).toBeCloseTo(-8.5)
    expect(box.max[0]).toBeCloseTo(7.5)
  })
})
