/**
 * stamps.test.ts - every stamp is a valid shard at every size, stays inside
 * the grid wherever it is tapped, turns with FACING, and two stamps that
 * touch lose the wall between them rather than paying for it.
 */

import { describe, it, expect } from 'vitest'
import { GRID_HALF, MAX_VERTICES, newShard, validFace, validPoint, type ShardModel } from './shards'
import { STAMPS, FACED, compile, preview, stamp, type Facing, type StampKind } from './stamps'

const red: [number, number, number] = [1, 0, 0]
const empty = (): ShardModel => ({ ...newShard('t'), mode: 'solid' })

describe('stamps', () => {
  it('every kind at every size is integer, inside the grid, with faces that exist', () => {
    for (const kind of STAMPS) for (let size = 1; size <= 4; size++) {
      const s = compile(kind, size, 0, [0, 0, 0])
      expect(s.points.length, `${kind} ${size}`).toBeGreaterThan(0)
      for (const p of s.points) expect(validPoint(p), `${kind} ${size} ${p}`).toBe(true)
      for (const f of s.faces) expect(validFace(f, s.points.length), `${kind} ${size} ${f}`).toBe(true)
    }
  })

  it('has the expected budgets', () => {
    const count = (k: StampKind, s = 1) => { const c = compile(k, s, 0, [0, 0, 0]); return [c.points.length, c.faces.length] }
    expect(count('block')).toEqual([8, 12])
    expect(count('column')).toEqual([8, 12])
    expect(count('pyramid')).toEqual([5, 6])
    expect(count('wedge')).toEqual([6, 8])
    expect(count('ring')).toEqual([9, 0])
    expect(count('arrow')).toEqual([8, 5])
    expect(count('star')[1]).toBeGreaterThanOrEqual(6)
  })

  it('ring and flat shapes end where they start so LINES closes the loop', () => {
    for (const kind of ['ring', 'star', 'arrow'] as StampKind[]) {
      const { points } = compile(kind, 2, 0, [0, 0, 0])
      expect(points[points.length - 1]).toEqual(points[0])
    }
  })

  it('stands on the level and centres on the tap', () => {
    const { points } = compile('block', 2, 0, [3, -2, 1])
    expect(Math.min(...points.map((p) => p[1]))).toBe(-2)
    expect(Math.max(...points.map((p) => p[1]))).toBe(0)
    expect(Math.min(...points.map((p) => p[0]))).toBe(2)
    expect(Math.max(...points.map((p) => p[0]))).toBe(4)
  })

  it('is pushed back inside the grid when tapped at the edge', () => {
    for (const kind of STAMPS) {
      const { points } = compile(kind, 4, 0, [GRID_HALF, GRID_HALF, GRID_HALF])
      for (const p of points) expect(validPoint(p), `${kind} ${p}`).toBe(true)
    }
  })

  it('turns the faced shapes a quarter turn about Y and leaves the rest alone', () => {
    const tip = (f: Facing) => { const { points } = compile('arrow', 1, f, [0, 0, 0]); return points.reduce((a, b) => (Math.hypot(b[0], b[2]) > Math.hypot(a[0], a[2]) ? b : a)) }
    expect(tip(0)).toEqual([3, 0, 0])
    expect(tip(1)).toEqual([0, 0, 3])
    expect(tip(2)).toEqual([-3, 0, 0])
    expect(tip(3)).toEqual([0, 0, -3])
    for (const kind of STAMPS) if (!FACED[kind]) expect(compile(kind, 2, 3, [0, 0, 0])).toEqual(compile(kind, 2, 0, [0, 0, 0]))
  })

  it('appends its own vertices in the given colour and keeps the shard valid', () => {
    const one = stamp(empty(), 'pyramid', 1, 0, [0, 0, 0], red)!
    expect(one.shard.vertices).toHaveLength(5)
    expect(one.shard.vertices.every((v) => v.c.join() === '1,0,0')).toBe(true)
    expect(one.shard.faces).toHaveLength(6)
    expect(one.culled).toBe(0)
    for (const f of one.shard.faces) expect(validFace(f, 5)).toBe(true)
  })

  it('drops the wall between two blocks that touch, on both sides', () => {
    const a = stamp(empty(), 'block', 1, 0, [0, 0, 0], red)!
    const b = stamp(a.shard, 'block', 1, 0, [1, 0, 0], [0, 0, 1])!
    expect(b.shard.vertices).toHaveLength(16)
    expect(b.culled).toBe(4)
    expect(b.shard.faces).toHaveLength(24 - 4)
    // Stacked, the same: the top of one and the bottom of the other.
    const c = stamp(a.shard, 'block', 1, 0, [0, 1, 0], red)!
    expect(c.culled).toBe(4)
    // Diagonal neighbours share an edge, not a wall: nothing to drop.
    const d = stamp(a.shard, 'block', 1, 0, [1, 1, 0], red)!
    expect(d.culled).toBe(0)
  })

  it('never merges vertices, so a seam between colours stays crisp', () => {
    const a = stamp(empty(), 'block', 1, 0, [0, 0, 0], red)!
    const b = stamp(a.shard, 'block', 1, 0, [1, 0, 0], [0, 0, 1])!
    const at = b.shard.vertices.filter((v) => v.p.join() === '1,0,0')
    expect(at).toHaveLength(2)
    expect(at.map((v) => v.c.join()).sort()).toEqual(['0,0,1', '1,0,0'])
  })

  it('refuses a stamp that would not fit the budget', () => {
    const full: ShardModel = { ...empty(), vertices: Array.from({ length: MAX_VERTICES - 4 }, (_, i) => ({ p: [i % 17 - 8, 0, 0] as [number, number, number], c: red })) }
    expect(stamp(full, 'pyramid', 1, 0, [0, 0, 0], red)).toBeNull()
    expect(stamp(full, 'block', 1, 0, [0, 0, 0], red)).toBeNull()
  })

  it('previews as a solid when it has faces and as lines when it does not', () => {
    expect(preview('block', 1, 0, [0, 0, 0], red).mode).toBe('solid')
    expect(preview('ring', 1, 0, [0, 0, 0], red).mode).toBe('lines')
  })
})
