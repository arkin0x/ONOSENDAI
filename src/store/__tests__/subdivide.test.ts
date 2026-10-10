/**
 * subdivide.test.ts - SUBDIVIDE in the workshop: one undoable edit, the
 * corners and the new points left selected so a second press cuts again, and
 * one line about what happened (arkinox, 2026-10-10, ruling B). The geometry
 * itself is lib/__tests__/subdivide.test.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TICKS_PER_UNIT as T, ticksOf } from 'sno-core/shards'
import { DEFAULT_PALETTE, useWorkshop } from '../useWorkshop'

const w = () => useWorkshop.getState()

/** A two-unit square on the floor as two triangles sharing the diagonal 0-2. */
const QUAD = JSON.stringify({ v: 1, type: 'shard', name: 'q', unit: 0, extent: 8, mode: 'solid', vertices: [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]], colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], faces: [[0, 1, 2], [0, 2, 3]] })

describe('SUBDIVIDE', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], selectedFace: null, facePick: [], palette: [...DEFAULT_PALETTE], level: 0, color: [0, 0.9, 1], past: [], future: [], aim: null, notice: null, tool: 'select' })
    const id = w().importText(QUAD)
    expect(id).not.toBeNull()
    w().select(id!)
  })

  it('cuts the selected face into four and the neighbor in two, leaves corners and midpoints selected, and says so', () => {
    w().setSelection([0, 1, 2])
    w().subdivideSelection()
    const s = w().current()!
    expect(s.vertices).toHaveLength(7)
    expect(s.faces).toHaveLength(6)
    expect(w().selection).toEqual([0, 1, 2, 4, 5, 6])
    expect(w().selectedFace).toBeNull()
    expect(w().notice).toBe('1 face cut into 4, 1 neighbor split. 3 new points.')
  })

  it('is one undoable edit', () => {
    w().setSelection([0, 1, 2])
    w().subdivideSelection()
    expect(w().past).toHaveLength(1)
    w().undo()
    const s = w().current()!
    expect(s.vertices).toHaveLength(4)
    expect(s.faces).toEqual([[0, 1, 2], [0, 2, 3]])
    w().redo()
    expect(w().current()!.faces).toHaveLength(6)
    expect(w().current()!.vertices).toHaveLength(7)
  })

  it('a second press cuts the children again', () => {
    w().setSelection([0, 1, 2])
    w().subdivideSelection()
    w().subdivideSelection()
    const s = w().current()!
    // Four children cut into sixteen; the neighbor's two children each share one cut edge and split once.
    expect(s.faces).toHaveLength(20)
    expect(s.vertices).toHaveLength(16)
    expect(w().notice).toBe('4 faces cut into 16, 2 neighbors split. 9 new points.')
    expect(w().past).toHaveLength(2)
  })

  it('cuts an edge when exactly its two ends are selected', () => {
    w().setSelection([0, 2])
    w().subdivideSelection()
    const s = w().current()!
    expect(s.vertices).toHaveLength(5)
    expect(ticksOf(s.vertices[4])).toEqual([T, 0, T])
    expect(s.faces).toHaveLength(4)
    expect(w().selection).toEqual([0, 2, 4])
    expect(w().notice).toBe('2 faces cut in two. 1 new point.')
  })

  it('refuses with a notice and no edit when the two points are not joined, or no whole face is selected', () => {
    w().setSelection([1, 3])
    w().subdivideSelection()
    expect(w().notice).toBe('Those two points are not joined by an edge.')
    expect(w().past).toHaveLength(0)
    expect(w().selection).toEqual([1, 3])
    w().setSelection([0, 1, 3])
    w().subdivideSelection()
    expect(w().notice).toBe('Select a whole face, or the two ends of an edge.')
    expect(w().past).toHaveLength(0)
    expect(w().current()!.faces).toHaveLength(2)
  })

  it('does nothing with nothing selected', () => {
    w().subdivideSelection()
    expect(w().notice).toBeNull()
    expect(w().past).toHaveLength(0)
  })
})
