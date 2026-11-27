/**
 * prizeViews.test.ts: the prize's pictures (lib/blueprint/prizeViews.ts),
 * their projection math, in world axes as the spec names the views:
 * x from +X looking along -X, y from above, z from the sun looking along -Z,
 * iso from the +X, +Y, +Z corner. The shard's render positions have Z negated
 * (sno-core toRender), and come back to world axes before projecting.
 */
import { describe, expect, it, vi } from 'vitest'

// The scene module pulls in all of three.js; the math under test does not need it.
vi.mock('../../../scene/ShardMesh', () => ({ shardGeometry: () => ({ positions: new Float32Array(0), colors: new Float32Array(0), index: [] }) }))

import { faceLight, fitView, prizeImages, projectGeometry, projectPrizePoint, renderToWorld } from '../prizeViews'

describe('projectPrizePoint', () => {
  it('along X: +Z on the left, +Y up, +X nearest', () => {
    expect(projectPrizePoint([0, 0, 1], 'x')[0]).toBeLessThan(0)
    expect(projectPrizePoint([0, 1, 0], 'x')[1]).toBeLessThan(0)
    expect(projectPrizePoint([1, 0, 0], 'x')[2]).toBeGreaterThan(projectPrizePoint([-1, 0, 0], 'x')[2])
  })

  it('along Y: X across, +Z at the bottom, the top nearest', () => {
    expect(projectPrizePoint([1, 0, 0], 'y')[0]).toBe(1)
    expect(projectPrizePoint([0, 0, 1], 'y')[1]).toBe(1)
    expect(projectPrizePoint([0, 1, 0], 'y')[2]).toBe(1)
  })

  it('along Z: X across, +Y up, the sun side nearest', () => {
    expect(projectPrizePoint([1, 0, 0], 'z')[0]).toBe(1)
    expect(projectPrizePoint([0, 1, 0], 'z')[1]).toBe(-1)
    expect(projectPrizePoint([0, 0, 1], 'z')[2]).toBe(1)
  })

  it('isometric: +X right and down, +Z left and down, +Y up', () => {
    const [ux, vx] = projectPrizePoint([1, 0, 0], 'iso')
    const [uz, vz] = projectPrizePoint([0, 0, 1], 'iso')
    const [uy, vy] = projectPrizePoint([0, 1, 0], 'iso')
    expect(ux).toBeGreaterThan(0); expect(vx).toBeGreaterThan(0)
    expect(uz).toBeLessThan(0); expect(vz).toBeGreaterThan(0)
    expect(uy).toBe(0); expect(vy).toBe(-1)
  })

  it('a render position comes back with its Z negated', () => {
    expect(renderToWorld(1, 2, 3)).toEqual([1, 2, -3])
  })
})

describe('projectGeometry', () => {
  // Two triangles: one at world z = -1 (render z = +1), one at world z = +1 (render z = -1), red and blue.
  const g = {
    positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, -1, 1, 0, -1, 0, 1, -1]),
    colors: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    index: [3, 4, 5, 0, 1, 2],
  }

  it('sorts back to front: from the sun, the face toward the sun is drawn last', () => {
    const p = projectGeometry(g, 'z')
    expect(p.tris).toHaveLength(2)
    expect(p.tris[0].color).toEqual([1, 0, 0])
    expect(p.tris[1].color).toEqual([0, 0, 1])
    expect(p.tris[0].depth).toBeCloseTo(-1)
    expect(p.tris[1].depth).toBeCloseTo(1)
  })

  it('a shard with no faces gives its points', () => {
    const p = projectGeometry({ positions: g.positions, colors: g.colors, index: [] }, 'y')
    expect(p.tris).toHaveLength(0)
    expect(p.points).toHaveLength(6)
  })
})

describe('fitView', () => {
  it('fits and centres, keeping the aspect', () => {
    const f = fitView([[-1, -0.5], [1, 0.5]], 256, 16)
    expect(f.s).toBeCloseTo(112)
    expect(-1 * f.s + f.ox).toBeCloseTo(16)
    expect(1 * f.s + f.ox).toBeCloseTo(240)
    expect(0 * f.s + f.oy).toBeCloseTo(128)
  })

  it('a single point sits in the middle', () => {
    const f = fitView([[3, 4]], 100, 8)
    expect(3 * f.s + f.ox).toBeCloseTo(50)
    expect(4 * f.s + f.oy).toBeCloseTo(50)
  })
})

describe('faceLight', () => {
  it('a face toward the light is brighter than one edge on, and never black', () => {
    const up = faceLight([0, 0, 0], [1, 0, 0], [0, 0, 1])
    const side = faceLight([0, 0, 0], [0, 1, 0], [0, 0, 1])
    expect(up).toBeGreaterThan(side)
    expect(side).toBeGreaterThanOrEqual(0.42)
    expect(up).toBeLessThanOrEqual(1)
  })
})

describe('prizeImages', () => {
  it('makes nothing where there is no canvas', () => {
    expect(prizeImages({} as never, 'render', ['x', 'iso'])).toEqual({})
  })
})
