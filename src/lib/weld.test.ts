/**
 * weld.test.ts - stacked points become one, and nothing changes how the
 * object looks: faces that disagreed on colour keep their own, faces that
 * collapsed or doubled go, and the real 516-vertex floor comes back under
 * the format's limit and through fromPayload.
 */

import { describe, expect, it } from 'vitest'
import { BUILT_IN, hexAt } from 'sno-core/snoPalette'
import { MAX_VERTICES, fromPayload, hexToRgb, newShard, toPayload, unpackTicks, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { stackedCount, weld } from './weld'
import floorPayload from '../store/fixtures/disco-floor-516.json'

type P3 = [number, number, number]
type Rgb = [number, number, number]
const RED: Rgb = [1, 0, 0]
const BLUE: Rgb = [0, 0, 1]

/** A unit square on the floor at (x, z), with its own four corners and two faces, in one colour. */
function square(x: number, z: number, c: Rgb, base: number): { vertices: ShardModel['vertices']; faces: P3[] } {
  const corners: P3[] = [[x, 0, z], [x + 1, 0, z], [x + 1, 0, z + 1], [x, 0, z + 1]]
  return {
    vertices: corners.map((p) => ({ p, c })),
    faces: [[base, base + 1, base + 2], [base, base + 2, base + 3]],
  }
}

function twoSquares(a: Rgb, b: Rgb): ShardModel {
  const A = square(0, 0, a, 0)
  const B = square(1, 0, b, 4) // shares the edge x = 1 with A: two stacked corners
  return { ...newShard('two'), vertices: [...A.vertices, ...B.vertices], faces: [...A.faces, ...B.faces] }
}

/** What each face looks like: its own colour, else its corners blended. */
function look(s: ShardModel): Rgb[] {
  return s.faces.map((f, i) => {
    if (s.facecolors) return s.facecolors[i]
    const sum: Rgb = [0, 0, 0]
    for (const j of f) { const v = s.vertices[j]; sum[0] += v.c[0]; sum[1] += v.c[1]; sum[2] += v.c[2] }
    return [sum[0] / 3, sum[1] / 3, sum[2] / 3]
  })
}

describe('weld', () => {
  it('folds stacked corners of different colours into one and gives the faces their own colours, so nothing changes how it looks', () => {
    const s = twoSquares(RED, BLUE)
    expect(stackedCount(s)).toBe(2)
    const res = weld(s)!
    expect(res.merged).toBe(2)
    expect(res.colored).toBe(true)
    expect(res.shard.vertices).toHaveLength(6)
    expect(res.shard.faces).toHaveLength(4)
    expect(look(res.shard)).toEqual([RED, RED, BLUE, BLUE])
    expect(stackedCount(res.shard)).toBe(0)
  })

  it('does not invent face colours when the merged corners agree', () => {
    const res = weld(twoSquares(RED, RED))!
    expect(res.shard.vertices).toHaveLength(6)
    expect(res.shard.facecolors).toBeUndefined()
    expect(res.colored).toBe(false)
  })

  it('is null when nothing stands on anything', () => {
    const s: ShardModel = { ...newShard('one'), ...square(0, 0, RED, 0) }
    expect(weld(s)).toBeNull()
  })

  it('welds only the selection when given one, never merging into a point outside it', () => {
    const s = twoSquares(RED, BLUE)
    // The stacked pairs are (1, 4) at (1,0,0) and (2, 7) at (1,0,1).
    // Square A's corners alone stand on nothing selected: nothing folds.
    expect(weld(s, new Set([0, 1, 2, 3]))).toBeNull()
    // Both members of one pair: that pair folds, the other stays stacked.
    const res = weld(s, new Set([1, 4]))!
    expect(res.merged).toBe(1)
    expect(res.shard.vertices).toHaveLength(7)
    expect(stackedCount(res.shard)).toBe(1)
    // One member of a pair, with its twin outside the selection: nothing folds.
    expect(weld(s, new Set([1, 5]))).toBeNull()
  })

  it('drops faces that collapsed to a line or doubled another', () => {
    const s = twoSquares(RED, RED)
    // Stack B entirely onto A: every B corner lands on an A corner.
    s.vertices = s.vertices.map((v, i) => (i >= 4 ? { ...v, p: s.vertices[i - 4].p } : v))
    const res = weld(s)!
    expect(res.shard.vertices).toHaveLength(4)
    expect(res.shard.faces).toHaveLength(2)
  })

  it('takes arkinox\'s 516-vertex floor to 291 vertices, 258 faces, through fromPayload, looking the same', () => {
    const p = floorPayload as unknown as ShardPayload
    const ticks = unpackTicks(p.ticks, p.vertices.length)!
    const model: ShardModel = {
      ...newShard(p.name),
      unit: p.unit,
      extent: p.extent ?? 8,
      mode: p.mode,
      vertices: p.vertices.map((pos, i) => {
        const t = ticks[i]
        const c = hexToRgb(hexAt(BUILT_IN, (p.colors as number[])[i]))
        return t[0] === 0 && t[1] === 0 && t[2] === 0 ? { p: pos as P3, c } : { p: pos as P3, t, c }
      }),
      faces: p.faces as P3[],
    }
    expect(model.vertices).toHaveLength(516)
    expect(fromPayload(toPayload(model), 'floor')).toBeNull()

    const res = weld(model)!
    expect(res.merged).toBe(516 - 291)
    expect(res.shard.vertices).toHaveLength(291)
    expect(res.shard.faces).toHaveLength(258)
    // Its squares touch only at their corners, and corners that meet share a
    // colour, so this floor needs no face colours to keep its look.
    expect(res.colored).toBe(false)
    expect(res.shard.facecolors).toBeUndefined()
    expect(res.shard.vertices.length).toBeLessThanOrEqual(MAX_VERTICES)
    // Every face still shows the colour it showed.
    expect(look(res.shard)).toEqual(look(model))
    // And every reader now takes it.
    const back = fromPayload(toPayload(res.shard), 'floor')
    expect(back).not.toBeNull()
    expect(back!.vertices).toHaveLength(291)
    expect(back!.faces).toHaveLength(258)
  })
})
