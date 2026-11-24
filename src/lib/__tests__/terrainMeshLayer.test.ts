/**
 * terrainMeshLayer.test.ts - a chunk's mesh (lib/terrain/mesh.ts: only open
 * faces, merged greedily, borders read from the neighbours) and its layer
 * (lib/terrain/layer.ts: the diff from the generated ground, or the whole
 * chunk when smaller, as plain JSON runs).
 */

import { describe, expect, it } from 'vitest'
import { CELLS, idx } from '../terrain/coords'
import { borderSlab, meshChunk, slabIndex, FLOATS_PER_VERTEX, type Borders } from '../terrain/mesh'
import { tileTable } from '../terrain/blocks'

const SLATE = 2
const CHROME = 6
import { applyLayer, diffLayer, emptyLayer, encodeLayer, wholeLayer } from '../terrain/layer'
import { generate } from '../terrain/generate'

const NONE: Borders = [null, null, null, null, null, null]
const colours = tileTable()

describe('the greedy mesh', () => {
  it('draws one block as six faces', () => {
    const b = new Uint8Array(CELLS)
    b[idx(5, 6, 7)] = SLATE
    const m = meshChunk(b, NONE, colours)
    expect(m.quads).toBe(6)
    expect(m.vertices.length).toBe(24 * FLOATS_PER_VERTEX)
    expect(m.indices.length).toBe(36)
  })

  it('merges a solid chunk into one rectangle a face', () => {
    const b = new Uint8Array(CELLS).fill(SLATE)
    expect(meshChunk(b, NONE, colours).quads).toBe(6)
  })

  it('keeps kinds apart: two kinds side by side are not one rectangle', () => {
    const b = new Uint8Array(CELLS)
    b[idx(0, 0, 0)] = SLATE
    b[idx(1, 0, 0)] = CHROME
    // Each block shows five faces; the two between them are hidden.
    expect(meshChunk(b, NONE, colours).quads).toBe(10)
  })

  it('hides a border face behind a solid neighbour, and draws it where the neighbour is open', () => {
    const b = new Uint8Array(CELLS).fill(SLATE)
    const solid = new Uint8Array(1024).fill(CHROME)
    const all: Borders = [solid, solid, solid, solid, solid, solid]
    expect(meshChunk(b, all, colours).quads).toBe(0)
    const open = new Uint8Array(1024)
    expect(meshChunk(b, [open, solid, solid, solid, solid, solid], colours).quads).toBe(1)
  })

  it('reads a neighbour\'s border layer from the face that touches', () => {
    const b = new Uint8Array(CELLS)
    b[idx(31, 3, 4)] = SLATE
    const plusX = borderSlab(b, 1)
    // The +x face's cells are indexed by y then z.
    expect(plusX[slabIndex(3, 4)]).toBe(SLATE)
    expect(borderSlab(b, 0)[slabIndex(3, 4)]).toBe(0)
  })

  it('every rectangle faces out: its winding agrees with the side it is on', () => {
    const b = new Uint8Array(CELLS)
    b[idx(10, 10, 10)] = SLATE
    const m = meshChunk(b, NONE, colours)
    const v = (i: number): number[] => [m.vertices[i * FLOATS_PER_VERTEX], m.vertices[i * FLOATS_PER_VERTEX + 1], m.vertices[i * FLOATS_PER_VERTEX + 2]]
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, bb, c] = [v(m.indices[t]), v(m.indices[t + 1]), v(m.indices[t + 2])]
      const u = [bb[0] - a[0], bb[1] - a[1], bb[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
      const centre = [(a[0] + bb[0] + c[0]) / 3 - 10.5, (a[1] + bb[1] + c[1]) / 3 - 10.5, (a[2] + bb[2] + c[2]) / 3 - 10.5]
      expect(n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2]).toBeGreaterThan(0)
    }
  })
})

describe('the layer', () => {
  const base = { x: 0x40000n, y: 0x80000n, z: 0xc0000n, plane: 0 }
  const gen = generate(base).blocks

  it('of an untouched chunk is a few dozen bytes, and changes nothing', () => {
    const l = encodeLayer(gen, gen.slice())
    expect(emptyLayer(l)).toBe(true)
    expect(JSON.stringify(l).length).toBeLessThan(96)
    expect(applyLayer(gen, l)).toEqual(gen)
  })

  it('holds a few changes as a small diff, and gives them back exactly', () => {
    const cur = gen.slice()
    cur[idx(1, 2, 3)] = 0
    cur[idx(4, 5, 6)] = CHROME
    cur[idx(4, 5, 7)] = CHROME
    const l = encodeLayer(gen, cur)
    expect(l.form).toBe('diff')
    expect(JSON.stringify(l).length).toBeLessThan(140)
    expect(applyLayer(gen, l)).toEqual(cur)
  })

  it('is written whole when that is smaller, as when the ground is cleared and built over', () => {
    const cur = new Uint8Array(CELLS)
    for (let y = 0; y < 8; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) cur[idx(x, y, z)] = SLATE
    const l = encodeLayer(gen, cur)
    expect(l.form).toBe('whole')
    expect(JSON.stringify(l).length).toBeLessThan(JSON.stringify(diffLayer(gen, cur)).length)
    expect(applyLayer(gen, l)).toEqual(cur)
    expect(applyLayer(gen, wholeLayer(cur))).toEqual(cur)
  })

  it('refuses what it cannot read rather than guessing', () => {
    const plane = { plane: 0, survey: true } as const
    expect(applyLayer(gen, { ...plane, form: 'diff', pal: [null], cells: [0, -5] })).toBeNull()
    expect(applyLayer(gen, { ...plane, ground: 999, form: 'diff', pal: [null], cells: [0, -(CELLS - 1)] })).toBeNull()
    expect(applyLayer(gen, { ...plane, form: 'diff', pal: [null, 3], cells: [2, -(CELLS - 1)] })).toBeNull()
    expect(applyLayer(gen, { ...plane, form: 'diff', pal: [5], cells: [0, -(CELLS - 1)] })).toBeNull()
  })
})
