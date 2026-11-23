/**
 * stampCopyGroup.test.ts - GROUPS, item 3 (owner, 2026-11-23): "when you
 * stamp a Copy, it's automatically added to a group." Each STAMP COPY makes a
 * group of exactly what it put in, named after the stamped shard, in the same
 * UNDO step; a LINK makes none. In STAMP's OBJECT, G stays SNAP's.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { newShard, ticksOf, TICKS_PER_UNIT, type ShardModel } from 'sno-core/shards'
import { toModel } from 'sno-core/snoPalette'
import { useWorkshop, type StampObject } from '../../store/useWorkshop'
import { bakeSource, stampedIndices } from '../../lib/stampCopy'
import { groupsOf, heldBy } from '../../lib/shardGroups'
import { stampTap } from '../stampTap'
import { gOpensGroups } from '../shell/Rail'

const T = TICKS_PER_UNIT
const PK = 'e'.repeat(64)
const RED = toModel([200, 30, 40])

/** A 16-unit square tile centred on its origin, as a kit piece is. */
function tile(name = 'Mountain 03'): ShardModel {
  const corners: Array<[number, number, number]> = [[-8, 0, -8], [8, 0, -8], [8, 0, 8], [-8, 0, 8]]
  return { ...newShard(name), mode: 'solid', extent: 9, vertices: corners.map((p) => ({ p, c: RED })), faces: [[0, 1, 2], [0, 2, 3]] }
}

function chosen(s: ShardModel): StampObject {
  const copy = bakeSource(s, [])!
  return { ref: ['a', `33331:${PK}:${s.id}`], name: s.name, shard: s, copy, size: { min: copy.min!, max: copy.max!, unit: copy.unit }, local: true }
}

const w = () => useWorkshop.getState()
const groups = () => groupsOf(w().current())

beforeEach(() => {
  useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], selectedFaces: [], tool: 'stamp', stampMode: 'object', stampObject: null, stampFacing: 0, stampForm: 'copy', stampSnap: true, lastCopy: null, past: [], future: [], level: 0, plane: 1, hiddenGroups: [] })
  w().create('level')
  useWorkshop.setState((st) => ({ shards: st.shards.map((s) => ({ ...s, extent: 40 })) }))
})

describe('STAMP COPY makes a group', () => {
  it('of exactly what it put in, named after the stamped shard, said in the line', () => {
    w().setStampObject(chosen(tile()))
    const range = stampTap([16 * T, 0, 0])!
    const [g] = groups()
    expect(g.name).toBe('Mountain 03')
    const want = stampedIndices(range)
    expect(g.vertices).toEqual(want.vertices)
    expect(g.faces).toEqual(want.faces)
    expect(g.parts).toEqual([])
    expect(w().notice).toMatch(/New group: Mountain 03\.$/)
  })

  it('each stamp its own group, under a free name that keeps the whole shard name, holding only its own points', () => {
    w().setStampObject(chosen(tile()))
    stampTap([0, 0, 0])
    const second = stampTap([16 * T, 0, 0])!
    expect(groups().map((g) => g.name)).toEqual(['Mountain 03', 'Mountain 03 2'])
    expect(groups()[1].vertices).toEqual(stampedIndices(second).vertices)
    // Selecting the second takes its four corners, which stand 16 units along from the first's.
    const held = heldBy(w().current()!, groups()[1])
    const xs = held.selection.map((i) => ticksOf(w().current()!.vertices[i])[0]).sort((a, b) => a - b)
    expect(xs).toEqual([8 * T, 8 * T, 24 * T, 24 * T])
  })

  it('in the same UNDO as the stamp: one UNDO takes both, REDO brings both', () => {
    w().setStampObject(chosen(tile()))
    stampTap([0, 0, 0])
    const steps = w().past.length
    stampTap([16 * T, 0, 0])
    expect(w().past.length).toBe(steps + 1)
    w().undo()
    expect(groups().map((g) => g.name)).toEqual(['Mountain 03'])
    expect(w().current()!.vertices).toHaveLength(4)
    w().redo()
    expect(groups().map((g) => g.name)).toEqual(['Mountain 03', 'Mountain 03 2'])
  })

  it('keeps the groups already there, and lastCopy still names the stamp', () => {
    w().setStampObject(chosen(tile()))
    stampTap([0, 0, 0])
    w().renameGroup(groups()[0].id, 'Base')
    const range = stampTap([16 * T, 0, 0])
    expect(groups().map((g) => g.name)).toEqual(['Base', 'Mountain 03'])
    expect(w().lastCopy).toEqual(range)
    expect(groups()[0].vertices).toEqual([0, 1, 2, 3])
    expect(groups()[1].vertices).toEqual([4, 5, 6, 7])
  })

  it('a LINK makes no group', () => {
    useWorkshop.setState({ stampForm: 'link' })
    w().setStampObject(chosen(tile()))
    stampTap([0, 0, 0])
    expect(w().current()!.parts).toHaveLength(1)
    expect(groups()).toEqual([])
  })
})

describe('names', () => {
  it('a DUPLICATE of a stamped "Mountain 03" is "Mountain 03 2", never another piece\'s number', () => {
    w().setStampObject(chosen(tile()))
    stampTap([0, 0, 0])
    w().duplicateGroup(groups()[0].id)
    expect(groups().map((g) => g.name)).toEqual(['Mountain 03', 'Mountain 03 2'])
  })
})

describe('G', () => {
  it('is SNAP in STAMP\'s OBJECT and GROUPS everywhere else', () => {
    expect(gOpensGroups({ tool: 'stamp', stampMode: 'object' })).toBe(false)
    expect(gOpensGroups({ tool: 'stamp', stampMode: 'shape' })).toBe(true)
    expect(gOpensGroups({ tool: 'select', stampMode: 'object' })).toBe(true)
  })
})
