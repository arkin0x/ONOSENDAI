/**
 * Winding in the workshop: a face's front is its winding (DECK-0003 §1.4),
 * read on the wire. New faces land looking out, FLIP turns them, AUTO puts
 * them back, and every one of those is an edit that undo takes back.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { TICKS_PER_UNIT as T, type ShardModel } from 'sno-core/shards'
import { newell } from 'sno-core/triangulate'
import { wirePoints } from 'sno-core/winding'
import { DEFAULT_PALETTE, useWorkshop } from './useWorkshop'

const w = () => useWorkshop.getState()

/** Each face's normal, on the wire, as the sign along each axis. */
const fronts = (s: ShardModel): string[] => {
  const pts = wirePoints(s)
  return s.faces.map((f) => newell(f.map((i) => pts[i])).map((n) => (n > 1e-9 ? '+' : n < -1e-9 ? '-' : '0')).join(''))
}

/** How many faces look away from the shard's middle, on the wire. */
const outward = (s: ShardModel): number => {
  const pts = wirePoints(s)
  const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0])
  return s.faces.filter((f) => {
    const [a, b, d] = f.map((i) => pts[i])
    const n = newell([a, b, d])
    return n[0] * ((a[0] + b[0] + d[0]) / 3 - c[0]) + n[1] * ((a[1] + b[1] + d[1]) / 3 - c[1]) + n[2] * ((a[2] + b[2] + d[2]) / 3 - c[2]) > 1e-9
  }).length
}

const square = (): void => {
  w().setTool('add')
  for (const p of [[0, 0, 0], [2 * T, 0, 0], [2 * T, 0, 2 * T], [0, 0, 2 * T]] as Array<[number, number, number]>) w().addVertex(p)
}

describe('winding in the workshop', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], selectedFace: null, facePick: [], palette: [...DEFAULT_PALETTE], level: 0, color: [0, 0.9, 1], past: [], future: [], aim: null, notice: null, tool: 'stamp', stampKind: 'block', stampSize: 1, stampFacing: 0 })
    w().create('t')
  })

  it('FILL on a floor square faces up', () => {
    square()
    w().setSelection([0, 1, 2, 3])
    w().fillSelection()
    expect(fronts(w().current()!)).toEqual(['0+0', '0+0'])
  })

  it('corners picked either way round make a face that looks up', () => {
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0]]) {
      w().clearShard()
      square()
      w().setTool('face')
      for (const i of order) w().pickForFace(i)
      w().fill()
      expect(fronts(w().current()!), order.join()).toEqual(['0+0', '0+0'])
    }
  })

  it('a hull and a stamp land with every face looking out', () => {
    w().placeStamp([0, 0, 0])
    const block = w().current()!
    expect(outward(block)).toBe(block.faces.length)
    w().clearShard()
    for (const v of block.vertices) w().addVertex(v.p)
    w().setSelection(w().current()!.vertices.map((_, i) => i))
    w().fillSelection()
    expect(outward(w().current()!)).toBe(12)
  })

  it('FLIP FACE turns one face, FLIP SURFACE its whole surface, AUTO puts them back, undo takes each back', () => {
    square()
    w().setSelection([0, 1, 2, 3])
    w().fillSelection()
    w().setTool('face')
    w().selectFace(0)
    w().flipSelectedFace()
    expect(fronts(w().current()!)).toEqual(['0-0', '0+0'])
    w().undo()
    expect(fronts(w().current()!)).toEqual(['0+0', '0+0'])
    w().selectFace(1)
    w().flipSelectedSurface()
    expect(fronts(w().current()!)).toEqual(['0-0', '0-0'])
    w().autoWind()
    expect(fronts(w().current()!)).toEqual(['0+0', '0+0'])
    w().undo()
    expect(fronts(w().current()!)).toEqual(['0-0', '0-0'])
  })

  it('FLIP with no face in hand does nothing', () => {
    square()
    w().setSelection([0, 1, 2, 3])
    w().fillSelection()
    const before = w().current()!.faces
    w().selectFace(null)
    w().flipSelectedFace()
    w().flipSelectedSurface()
    expect(w().current()!.faces).toBe(before)
  })
})
