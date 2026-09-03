/**
 * shards.test.ts - the wire form round-trips, and refuses what would crash a
 * drawer.
 */

import { describe, it, expect } from 'vitest'
import { flatten, fromPayload, newShard, toPayload, validFace, validPoint, type ShardModel } from './shards'

const tri: ShardModel = {
  ...newShard('tri'),
  mode: 'solid',
  unit: 3,
  vertices: [
    { p: [0, 0, 0], c: [1, 0, 0] },
    { p: [2, 0, 0], c: [0, 1, 0] },
    { p: [0, 2, 0], c: [0, 0, 1] },
  ],
  faces: [[0, 1, 2]],
}

describe('payload', () => {
  it('round-trips', () => {
    const back = fromPayload(JSON.parse(JSON.stringify(toPayload(tri))), 'x')
    expect(back).not.toBeNull()
    expect(back!.vertices).toEqual(tri.vertices)
    expect(back!.faces).toEqual(tri.faces)
    expect(back!.mode).toBe('solid')
    expect(back!.unit).toBe(3)
    expect(back!.name).toBe('tri')
  })

  it('refuses a face that points past the vertices', () => {
    const p = toPayload(tri)
    expect(fromPayload({ ...p, faces: [[0, 1, 9]] }, 'x')).toBeNull()
  })

  it('refuses mismatched colors, unknown modes, bad units and other types', () => {
    const p = toPayload(tri)
    expect(fromPayload({ ...p, colors: p.colors.slice(1) }, 'x')).toBeNull()
    expect(fromPayload({ ...p, mode: 'voxels' }, 'x')).toBeNull()
    expect(fromPayload({ ...p, unit: 99 }, 'x')).toBeNull()
    expect(fromPayload({ ...p, type: 'note' }, 'x')).toBeNull()
    expect(fromPayload('nope', 'x')).toBeNull()
  })

  it('clamps colors into 0..1', () => {
    const p = toPayload(tri)
    const back = fromPayload({ ...p, colors: [[2, -1, 0.5], [0, 0, 0], [0, 0, 0]] }, 'x')
    expect(back!.vertices[0].c).toEqual([1, 0, 0.5])
  })
})

describe('geometry', () => {
  it('flattens vertices and faces in order', () => {
    const f = flatten(tri)
    expect(Array.from(f.positions)).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0])
    expect(Array.from(f.colors)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
    expect(f.index).toEqual([0, 1, 2])
  })

  it('validates points and faces', () => {
    expect(validPoint([1, -8, 8])).toBe(true)
    expect(validPoint([9, 0, 0])).toBe(false)
    expect(validPoint([0.5, 0, 0])).toBe(false)
    expect(validFace([0, 1, 2], 3)).toBe(true)
    expect(validFace([0, 1, 1], 3)).toBe(false)
    expect(validFace([0, 1, 3], 3)).toBe(false)
  })
})
