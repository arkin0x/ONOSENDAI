/**
 * shards.test.ts - the wire form round-trips, and refuses what would crash a
 * drawer.
 */

import { describe, it, expect } from 'vitest'
import { flatten, fromPayload, newShard, toPayload, validFace, validPoint, type ShardModel, TICKS_PER_UNIT, packTicks, unpackTicks, unitsLabel, toRender, ticksOf, vertexAt, normalizeStored } from './shards'

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
    expect(validPoint([TICKS_PER_UNIT, -8 * TICKS_PER_UNIT, 8 * TICKS_PER_UNIT])).toBe(true)
    expect(validPoint([9 * TICKS_PER_UNIT, 0, 0])).toBe(false)
    expect(validPoint([40, 30, -24])).toBe(true)     // a third, a quarter, a fifth
    expect(validPoint([0.5, 0, 0])).toBe(false)
    expect(validFace([0, 1, 2], 3)).toBe(true)
    expect(validFace([0, 1, 1], 3)).toBe(false)
    expect(validFace([0, 1, 3], 3)).toBe(false)
  })
})

describe('ticks', () => {
  it('carries thirds, quarters and fifths exactly, with the run shorthand, and reads an old payload as whole units', () => {
    const v = (total: [number, number, number]) => vertexAt(total, [1, 0, 0])
    const s = { ...newShard('t'), vertices: [v([0, 0, 0]), v([TICKS_PER_UNIT, 0, 0]), v([40, -30, 24 + 2 * TICKS_PER_UNIT]), v([0, 0, 0])] }
    expect(s.vertices[2]).toEqual({ p: [0, -1, 2], t: [40, 90, 24], c: [1, 0, 0] })
    expect(s.vertices[1]).toEqual({ p: [1, 0, 0], c: [1, 0, 0] })
    const wire = toPayload(s)
    expect(wire.vertices).toEqual([[0, 0, 0], [1, 0, 0], [0, -1, 2], [0, 0, 0]])
    expect(wire.ticks).toEqual([-2, [40, 90, 24], -1])
    const back = fromPayload(wire, 'x')!
    expect(back.vertices).toEqual(s.vertices)
    const old = { ...wire, ticks: undefined }
    expect(fromPayload(old, 'y')!.vertices.map((x) => ticksOf(x))).toEqual([[0, 0, 0], [TICKS_PER_UNIT, 0, 0], [0, -TICKS_PER_UNIT, 2 * TICKS_PER_UNIT], [0, 0, 0]])
    expect(unpackTicks([-3], 4)).toBeNull()
    expect(unpackTicks([[120, 0, 0]], 1)).toBeNull()
    expect(packTicks([])).toEqual([])
  })
  it('draws model +Z along render -Z, as the world draws cyberspace', () => {
    expect(toRender([TICKS_PER_UNIT, 2 * TICKS_PER_UNIT, 3 * TICKS_PER_UNIT])).toEqual([1, 2, -3])
    const one = { ...newShard('z'), vertices: [{ p: [0, 0, 1] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
    expect(Array.from(flatten(one).positions)).toEqual([0, 0, -1])
  })
  it('normalizes a model saved while positions were kept in ticks, and leaves a unit model alone', () => {
    const units = { ...newShard('u'), vertices: [{ p: [3, 0, -2] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
    expect(normalizeStored(units)).toBe(units)
    const interim = { ...newShard('i'), vertices: [{ p: [360, 40, -240] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
    expect(normalizeStored(interim).vertices[0]).toEqual({ p: [3, 0, -2], t: [0, 40, 0], c: [1, 1, 1] })
  })
  it('prints ticks as units', () => {
    expect(unitsLabel(0)).toBe('0')
    expect(unitsLabel(240)).toBe('2')
    expect(unitsLabel(40)).toBe('1/3')
    expect(unitsLabel(-30)).toBe('-1/4')
    expect(unitsLabel(2 * 120 + 90)).toBe('2 3/4')
  })
})
