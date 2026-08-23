/**
 * useWorkshop.test.ts - edits keep the shard consistent: no two vertices on a
 * point, faces follow their vertices through deletions, duplicates are copies.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkshop } from './useWorkshop'

const w = () => useWorkshop.getState()

describe('workshop', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selected: null, facePick: [], level: 0 })
    w().create('t')
  })

  it('adds vertices at the level, never twice on one point, and selects them', () => {
    w().setLevel(2)
    w().addVertex([1, 2, 3])
    w().addVertex([1, 2, 3])
    expect(w().current()!.vertices).toHaveLength(1)
    expect(w().current()!.vertices[0].p).toEqual([1, 2, 3])
    expect(w().selected).toBe(0)
    w().addVertex([9, 0, 0])
    expect(w().current()!.vertices).toHaveLength(1)
  })

  it('nudges the selection and refuses to land on another vertex or leave the grid', () => {
    w().addVertex([0, 0, 0]); w().addVertex([1, 0, 0])
    w().selectVertex(0)
    w().moveSelected(0, 1)
    expect(w().current()!.vertices[0].p).toEqual([0, 0, 0])
    w().moveSelected(1, 1)
    expect(w().current()!.vertices[0].p).toEqual([0, 1, 0])
    w().selectVertex(1)
    for (let i = 0; i < 20; i++) w().moveSelected(0, 1)
    expect(w().current()!.vertices[1].p[0]).toBe(8)
  })

  it('builds a face from three picks, ignores duplicates, and reindexes on delete', () => {
    w().addVertex([0, 0, 0]); w().addVertex([1, 0, 0]); w().addVertex([0, 0, 1]); w().addVertex([2, 0, 2])
    w().setTool('face')
    w().pickForFace(1); w().pickForFace(2); w().pickForFace(3)
    expect(w().current()!.faces).toEqual([[1, 2, 3]])
    w().pickForFace(3); w().pickForFace(1); w().pickForFace(2)
    expect(w().current()!.faces).toHaveLength(1)
    w().pickForFace(0); w().pickForFace(1); w().pickForFace(2)
    expect(w().current()!.faces).toHaveLength(2)
    // Delete vertex 0: the face using it goes, the other shifts down.
    w().setTool('select'); w().selectVertex(0); w().deleteSelected()
    expect(w().current()!.vertices).toHaveLength(3)
    expect(w().current()!.faces).toEqual([[0, 1, 2]])
    expect(w().selected).toBeNull()
  })

  it('colours the selection or everything', () => {
    w().addVertex([0, 0, 0]); w().addVertex([1, 0, 0])
    w().selectVertex(1); w().colorSelected([1, 0, 0])
    expect(w().current()!.vertices[1].c).toEqual([1, 0, 0])
    expect(w().current()!.vertices[0].c).not.toEqual([1, 0, 0])
    w().colorAll([0, 1, 0])
    expect(w().current()!.vertices.every((v) => v.c.join() === '0,1,0')).toBe(true)
  })

  it('duplicates as an independent copy and removes', () => {
    w().addVertex([0, 0, 0])
    const src = w().currentId!
    const copy = w().duplicate(src)
    expect(copy).not.toBe(src)
    w().addVertex([1, 1, 1])
    expect(w().shards.find((s) => s.id === src)!.vertices).toHaveLength(1)
    expect(w().shards.find((s) => s.id === copy)!.vertices).toHaveLength(2)
    w().remove(copy)
    expect(w().shards.map((s) => s.id)).toEqual([src])
    expect(w().currentId).toBe(src)
  })
})
