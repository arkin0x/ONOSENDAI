/**
 * workshopGroups.test.ts - GROUPS in SELECT (owner, 2026-11-23): named groups
 * of a shard's points, faces and placed objects, made from what is held or by
 * PASTE, kept right through every edit that renumbers geometry, through UNDO
 * and REDO and a reload, and never on the wire.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT as T, fromPayload, pointKey, ticksOf, toPayload, type ShardModel } from 'sno-core/shards'
import { groupKey, useWorkshop } from '../useWorkshop'
import { normalizeOne } from '../workshopStorage'
import { useCyberspace } from '../useCyberspace'
import { setLocalAuthor } from '../../lib/carried'
import { midpoint } from '../../lib/subdivide'
import { groupCounts, groupsOf, heldState, hiddenSets, hiddenView, saneGroups, withAppendedGroup, type ShardGroup } from '../../lib/shardGroups'

const w = () => useWorkshop.getState()
const cur = (): ShardModel => w().current()!
const groups = (): ShardGroup[] => groupsOf(cur())
const named = (name: string): ShardGroup => groups().find((g) => g.name === name)!
const PK = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const COLUMN = { v: 2, name: 'Column', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 4, 0]], colors: [5, 5, 5], faces: [[0, 1, 2]] }

/** Where a group's vertices stand, as point keys, sorted: what a group "is" whatever its indices. */
const spots = (s: ShardModel, g: ShardGroup): string[] => g.vertices.map((i) => pointKey(ticksOf(s.vertices[i]))).sort()
/** A group's faces as the three spots each stands on, sorted. */
const faceSpots = (s: ShardModel, g: ShardGroup): string[] => g.faces.map((k) => s.faces[k].map((i) => pointKey(ticksOf(s.vertices[i]))).sort().join('|')).sort()

function place(d: string, at: [number, number, number]): void {
  w().setStampObject({ ref: ['a', `33331:${PK}:${d}`], name: d, shard: fromPayload(COLUMN, d)! })
  w().placeObject(at)
}

/** Two blocks side by side, each its own group (A at the origin, B three units along X). */
function twoBlocks(): void {
  w().create('level')
  w().placeStamp([0, 0, 0])
  w().setSelection(cur().vertices.map((_, i) => i))
  w().createGroup('A')
  w().selectVertex(null)
  w().placeStamp([3 * T, 0, 0])
  const a = new Set(named('A').vertices)
  w().setSelection(cur().vertices.map((_, i) => i).filter((i) => !a.has(i)))
  w().createGroup('B')
  w().selectVertex(null)
}

beforeEach(() => {
  useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], selectedFaces: [], facePick: [], clip: null, level: 0, plane: 1, past: [], future: [], notice: null, tool: 'select', selectKind: 'points', stampKind: 'block', stampSize: 2, stampFacing: 0, stampMode: 'shape', stampObject: null, hiddenGroups: [], invert: false })
})

describe('making groups', () => {
  it('a group holds what is held, under a name, and takes Group 1, Group 2 when none is given', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    expect(w().createGroup()).toBeNull()
    expect(w().notice).toMatch(/Select something first/)
    w().setSelection([0, 1, 2])
    const id = w().createGroup()
    expect(id).toBeTruthy()
    expect(groups()).toHaveLength(1)
    expect(groups()[0].name).toBe('Group 1')
    w().setSelection([3])
    w().createGroup()
    expect(groups().map((g) => g.name)).toEqual(['Group 1', 'Group 2'])
    // A name already taken keeps itself and gets the first free number after it.
    w().createGroup('Group 1')
    expect(groups()[2].name).toBe('Group 1 2')
  })

  it('faces held in SELECT FACES make a group of faces; objects make a group of objects', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    place('column', [3 * T, 0, 0])
    w().selectVertex(null)
    w().selectFace(0)
    w().selectFace(1)
    w().createGroup('Faces')
    expect(named('Faces')).toMatchObject({ vertices: [], faces: [0, 1], parts: [] })
    w().selectFace(null); w().selectVertex(null)
    w().selectPart(0)
    w().createGroup('Obj')
    expect(named('Obj')).toMatchObject({ vertices: [], faces: [], parts: [0] })
    expect(groupCounts(cur(), named('Obj'))).toEqual({ points: 0, faces: 0, objects: 1 })
  })

  it('PASTE makes a new group of what it put down, named after what was copied, in the same UNDO', () => {
    w().create('src')
    w().placeStamp([0, 0, 0])
    const src = cur()
    w().copyShard(src)
    w().create('dst')
    w().addVertex([5 * T, 0, 0])
    const steps = w().past.length
    w().pasteClip('exact')
    expect(w().past.length).toBe(steps + 1)
    expect(groups()).toHaveLength(1)
    const g = groups()[0]
    expect(g.name).toBe('src')
    expect(g.vertices).toEqual(Array.from({ length: src.vertices.length }, (_, k) => k + 1))
    expect(g.faces).toEqual(Array.from({ length: src.faces.length }, (_, k) => k))
    expect(w().notice).toMatch(/New group: src\./)
    // The pasted group is what is held.
    expect(heldState(cur(), g, w())).toBe('all')
    // Pasted again: a free name.
    w().pasteClip('floor')
    expect(groups().map((x) => x.name)).toEqual(['src', 'src 2'])
    w().undo()
    expect(groups().map((x) => x.name)).toEqual(['src'])
    w().undo()
    expect(groups()).toHaveLength(0)
  })

  it('a selection that is exactly one group pastes as that group\'s copy name; anything else as Paste N', () => {
    twoBlocks()
    w().toggleGroupSelection(named('A').id)
    w().copySelection()
    w().pasteClip('exact')
    expect(groups().map((g) => g.name)).toEqual(['A', 'B', 'A 2'])
    w().setSelection([0, 1])
    w().copySelection()
    w().pasteClip('exact')
    expect(groups()[3].name).toBe('Paste 1')
  })

  it('withAppendedGroup is the stamp hook: one call groups whatever an edit appended', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    const before = cur()
    w().placeStamp([3 * T, 0, 0])
    const after = withAppendedGroup(before, cur(), 'Rock')
    const g = groupsOf(after)[0]
    expect(g.name).toBe('Rock')
    expect(g.vertices[0]).toBe(before.vertices.length)
    expect(g.vertices.length).toBe(cur().vertices.length - before.vertices.length)
    expect(withAppendedGroup(after, after, 'Nothing')).toBe(after)
  })
})

describe('groups stay right through edits', () => {
  it('a delete renumbers what is after it, and a group whose geometry is gone goes', () => {
    twoBlocks()
    const bSpots = spots(cur(), named('B'))
    const inB = new Set(named('B').vertices)
    const bFaces = faceSpots(cur(), { ...named('B'), faces: cur().faces.map((_, k) => k).filter((k) => cur().faces[k].every((i) => inB.has(i))) })
    w().toggleGroupSelection(named('A').id)
    w().deleteSelected()
    expect(groups().map((g) => g.name)).toEqual(['B'])
    expect(spots(cur(), named('B'))).toEqual(bSpots)
    expect(named('B').vertices).toEqual(cur().vertices.map((_, i) => i))
    // B never held faces by itself; its faces travel with its points.
    expect(faceSpots(cur(), { ...named('B'), faces: cur().faces.map((_, k) => k) })).toEqual(bFaces)
    w().undo()
    expect(groups().map((g) => g.name)).toEqual(['A', 'B'])
  })

  it('face groups follow a face delete, a flip and a stamp that buries faces', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    w().selectFace(4); w().selectFace(7)
    w().createGroup('F')
    const want = faceSpots(cur(), named('F'))
    w().selectFace(null); w().selectVertex(null)
    w().selectFace(2)
    w().deleteSelectedFace()
    expect(faceSpots(cur(), named('F'))).toEqual(want)
    w().selectFace(named('F').faces[0])
    w().flipSelectedFace()
    expect(faceSpots(cur(), named('F'))).toEqual(want)
    w().autoWind()
    expect(faceSpots(cur(), named('F'))).toEqual(want)
  })

  it('a block stamped against another buries the touching faces; the groups on the rest keep theirs', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    w().selectFace(null)
    // Every face of the first block in a group.
    for (let k = 0; k < cur().faces.length; k++) w().selectFace(k)
    w().createGroup('First')
    w().selectFace(null); w().selectVertex(null)
    const had = new Set(faceSpots(cur(), named('First')))
    w().placeStamp([2 * T, 0, 0])
    const g = named('First')
    const all = cur().faces.map((_, k) => k)
    const kept = faceSpots(cur(), { ...g, faces: all }).filter((f) => had.has(f))
    // The stamp buried some faces of the first block; the group holds exactly the ones still there, wherever they moved.
    expect(kept.length).toBeLessThan(had.size)
    expect(faceSpots(cur(), g)).toEqual(kept.sort())
  })

  it('WELD folds a stacked point into the one left, and its group follows', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    const n = cur().vertices.length
    w().setSelection(cur().vertices.map((_, i) => i))
    w().copySelection()
    w().pasteClip('exact')
    expect(named('Paste 1').vertices[0]).toBe(n)
    w().selectVertex(null)
    w().weld()
    expect(cur().vertices.length).toBe(n)
    // Every pasted vertex was folded into an original on its spot: the group holds those.
    expect(named('Paste 1').vertices).toEqual(cur().vertices.map((_, i) => i))
  })

  it('SUBDIVIDE gives a group the four faces its face was cut into', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    w().selectFace(0)
    w().createGroup('Top')
    const at = cur().faces[0].map((i) => ticksOf(cur().vertices[i]))
    const inside = new Set([...at.map(pointKey), ...at.map((p, a) => pointKey(midpoint(p, at[(a + 1) % 3])))])
    w().subdivideSelection()
    const g = named('Top')
    expect(g.faces).toHaveLength(4)
    // Every child stands inside the parent: on its corners or the middles of its edges.
    for (const k of g.faces) expect(cur().faces[k].every((i) => inside.has(pointKey(ticksOf(cur().vertices[i]))))).toBe(true)
    w().undo()
    expect(named('Top').faces).toEqual([0])
  })

  it('a pasted piece SUBDIVIDEd keeps its new midpoints: held again, all of it moves together', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    w().setSelection(cur().vertices.map((_, i) => i))
    w().copySelection()
    w().create('level')
    w().pasteClip('exact')
    const g0 = named('Paste 1')
    // Cut one face of the paste, and the neighbours around it split to match.
    w().selectVertex(null)
    w().selectFace(g0.faces[0])
    const facesBefore = cur().faces.length
    w().subdivideSelection()
    expect(cur().faces.length).toBeGreaterThan(facesBefore)
    const g = named('Paste 1')
    // Every vertex and every face of the shard is the paste's: the midpoints and the children joined it.
    expect(g.vertices).toEqual(cur().vertices.map((_, i) => i))
    expect(g.faces).toEqual(cur().faces.map((_, k) => k))
    // Held again and moved: nothing is left behind.
    w().selectVertex(null); w().selectFace(null)
    w().toggleGroupSelection(g.id)
    const before = cur().vertices.map((v) => ticksOf(v)[1])
    w().moveSelected(1, T)
    expect(cur().vertices.map((v) => ticksOf(v)[1])).toEqual(before.map((y) => y + T))
  })

  it('WELD of only some stacks folds each paste into the vertex WELD kept, never into another stack', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    const n = cur().vertices.length
    w().setSelection(cur().vertices.map((_, i) => i))
    w().copySelection()
    w().pasteClip('exact')
    w().selectVertex(null)
    w().setSelection(cur().vertices.map((_, i) => i).slice(0, n))
    w().copySelection()
    w().pasteClip('exact')
    // Three blocks on the same spots: the original (0..7), Paste 1 (8..15), Paste 2 (16..23). Weld the two pastes only.
    useWorkshop.setState({ selection: cur().vertices.map((_, i) => i).filter((i) => i >= n) })
    w().weld()
    expect(cur().vertices.length).toBe(2 * n)
    // Paste 2 folded into Paste 1's vertices, not the original's.
    expect(named('Paste 1').vertices).toEqual(Array.from({ length: n }, (_, k) => n + k))
    expect(named('Paste 2').vertices).toEqual(Array.from({ length: n }, (_, k) => n + k))
  })

  it('placed objects: a delete of one renumbers the rest, and a move or a turn keeps them', () => {
    w().create('s')
    place('column', [0, 0, 0])
    place('arch', [2 * T, 0, 0])
    place('column', [4 * T, 0, 0])
    w().selectPart(2)
    w().createGroup('Last')
    w().selectPart(1)
    w().moveSelected(0, T)
    w().rotateSelected(1)
    expect(named('Last').parts).toEqual([2])
    w().selectPart(0)
    w().deleteSelected()
    expect(named('Last').parts).toEqual([1])
    expect(cur().parts![1].at).toEqual([4 * T, 0, 0])
  })

  it('CLEAR empties every group, and UNDO brings them back', () => {
    twoBlocks()
    w().clearShard()
    expect(groups()).toHaveLength(0)
    w().undo()
    expect(groups().map((g) => g.name)).toEqual(['A', 'B'])
    w().redo()
    expect(groups()).toHaveLength(0)
  })

  it('a move keeps every group as the same object, so UNDO snapshots share it', () => {
    twoBlocks()
    const before = groups()
    w().toggleGroupSelection(named('B').id)
    w().moveSelected(1, T)
    expect(groups()[0]).toBe(before[0])
    expect(groups()[1]).toBe(before[1])
  })
})

describe('the panel\'s functions', () => {
  it('rename, toggle, add and remove', () => {
    twoBlocks()
    const a = named('A').id
    w().renameGroup(a, '  Big   rock ')
    expect(groups()[0].name).toBe('Big rock')
    w().renameGroup(a, '   ')
    expect(groups()[0].name).toBe('Big rock')
    // Toggle: all in hand, then all out.
    w().toggleGroupSelection(a)
    expect(heldState(cur(), groups()[0], w())).toBe('all')
    expect(w().selection).toEqual(groups()[0].vertices)
    w().toggleGroupSelection(a)
    expect(w().selection).toEqual([])
    // Partly held: a tap takes the rest.
    w().setSelection([groups()[0].vertices[0]])
    expect(heldState(cur(), groups()[0], w())).toBe('some')
    w().toggleGroupSelection(a)
    expect(heldState(cur(), groups()[0], w())).toBe('all')
    // Add B's first point to A, then take it out again.
    const b0 = named('B').vertices[0]
    w().selectVertex(null)
    useWorkshop.setState({ selection: [b0] })
    w().addSelectionToGroup(a)
    expect(groups()[0].vertices).toContain(b0)
    w().removeSelectionFromGroup(a)
    expect(groups()[0].vertices).not.toContain(b0)
    // Taking out everything a group holds removes it; UNDO brings it back.
    w().selectVertex(null)
    w().toggleGroupSelection(named('B').id)
    w().removeSelectionFromGroup(named('B').id)
    expect(groups().map((g) => g.name)).toEqual(['Big rock'])
    expect(w().notice).toMatch(/so it went/)
    w().undo()
    expect(groups().map((g) => g.name)).toEqual(['Big rock', 'B'])
  })

  it('a pasted group is held alone, never widened to the original under it', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    const n = cur().vertices.length
    w().setSelection(cur().vertices.map((_, i) => i))
    w().copySelection()
    w().pasteClip('exact')
    w().selectVertex(null)
    w().toggleGroupSelection(named('Paste 1').id)
    expect(w().selection.every((i) => i >= n)).toBe(true)
  })

  it('duplicate puts a copy of the geometry down as its own group, held; the clipboard is left alone', () => {
    twoBlocks()
    const n = cur().vertices.length
    const id = w().duplicateGroup(named('A').id)
    expect(id).toBeTruthy()
    const copy = groups().find((g) => g.id === id)!
    expect(copy.name).toBe('A 2')
    expect(spots(cur(), copy)).toEqual(spots(cur(), named('A')))
    expect(copy.vertices.every((i) => i >= n)).toBe(true)
    expect(w().clip).toBeNull()
    expect(heldState(cur(), copy, w())).toBe('all')
    // A second duplicate counts on.
    w().duplicateGroup(named('A').id)
    expect(groups().map((g) => g.name)).toEqual(['A', 'B', 'A 2', 'A 3'])
  })

  it('delete keeps the geometry; delete with geometry takes it, in one UNDO', () => {
    twoBlocks()
    const n = cur().vertices.length
    const f = cur().faces.length
    w().deleteGroup(named('A').id)
    expect(groups().map((g) => g.name)).toEqual(['B'])
    expect(cur().vertices.length).toBe(n)
    w().undo()
    const bSpots = spots(cur(), named('B'))
    w().deleteGroupAndGeometry(named('A').id)
    expect(groups().map((g) => g.name)).toEqual(['B'])
    expect(cur().vertices.length).toBe(n - 8)
    expect(cur().faces.length).toBeLessThan(f)
    expect(spots(cur(), named('B'))).toEqual(bSpots)
    w().undo()
    expect(cur().vertices.length).toBe(n)
    expect(groups().map((g) => g.name)).toEqual(['A', 'B'])
  })

  it('delete with geometry takes a group\'s placed objects and its faces too', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    place('column', [3 * T, 0, 0])
    place('arch', [5 * T, 0, 0])
    w().selectPart(0)
    w().createGroup('Col')
    w().selectVertex(null)
    w().selectFace(0)
    w().createGroup('Face')
    w().selectFace(null); w().selectVertex(null)
    w().selectPart(1)
    w().createGroup('Arch')
    const faces = cur().faces.length
    w().deleteGroupAndGeometry(named('Col').id)
    expect(cur().parts).toHaveLength(1)
    expect(named('Arch').parts).toEqual([0])
    w().deleteGroupAndGeometry(named('Face').id)
    expect(cur().faces.length).toBe(faces - 1)
    expect(cur().vertices.length).toBe(8)
    expect(groups().map((g) => g.name)).toEqual(['Arch'])
  })

  it('hide lets go of what of it is held; selecting a hidden group shows it', () => {
    twoBlocks()
    const s = cur()
    const a = named('A').id
    w().toggleGroupSelection(a)
    w().setGroupHidden(a, true)
    expect(w().hiddenGroups).toEqual([groupKey(s.id, a)])
    expect(w().selection).toEqual([])
    w().toggleGroupSelection(a)
    expect(w().hiddenGroups).toEqual([])
    // Hiding is not an edit.
    const steps = w().past.length
    w().setGroupHidden(a, true)
    w().setGroupHidden(a, false)
    expect(w().past.length).toBe(steps)
  })

  it('nothing hidden is ever held, however it was gathered; the bench draws without it and maps a tap back', () => {
    twoBlocks()
    const s = cur()
    const a = named('A')
    w().setGroupHidden(a.id, true)
    w().selectAll()
    expect(w().selection.some((i) => a.vertices.includes(i))).toBe(false)
    expect(w().selection.length).toBe(named('B').vertices.length)
    const h = hiddenSets(s, [a])!
    const view = hiddenView(s, h)!
    expect(view.shard.vertices.length).toBe(s.vertices.length - a.vertices.length)
    // Every drawn face is a face of the shard on B's points, and maps back to it.
    for (let j = 0; j < view.shard.faces.length; j++) {
      const k = view.faceOf[j]
      expect(s.faces[k].some((i) => a.vertices.includes(i))).toBe(false)
      expect(view.shard.faces[j].map((i) => pointKey(ticksOf(view.shard.vertices[i])))).toEqual(s.faces[k].map((i) => pointKey(ticksOf(s.vertices[i]))))
    }
    expect(hiddenView(s, null)).toBeNull()
  })

  it('WELD that makes a pasted face the twin of its original keeps a group of those faces, on the face kept', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    const n = cur().vertices.length
    const f = cur().faces.length
    w().setSelection(cur().vertices.map((_, i) => i))
    w().copySelection()
    w().pasteClip('exact')
    w().selectVertex(null)
    // A group of the copy's faces alone, then everything welded: the copy's faces fold onto the originals.
    for (let k = f; k < 2 * f; k++) w().selectFace(k)
    w().createGroup('Copy faces')
    w().selectFace(null); w().selectVertex(null)
    w().weld()
    expect(cur().vertices.length).toBe(n)
    expect(cur().faces.length).toBe(f)
    expect(named('Copy faces').faces).toEqual(cur().faces.map((_, k) => k))
  })

  it('a face added to a group of points is held with it, corners and all', () => {
    twoBlocks()
    const a = named('A')
    const bFace = cur().faces.findIndex((f) => f.every((i) => !a.vertices.includes(i)))
    w().selectFace(bFace)
    w().addSelectionToGroup(a.id)
    expect(named('A').faces).toEqual([bFace])
    w().selectFace(null); w().selectVertex(null)
    w().toggleGroupSelection(a.id)
    for (const i of cur().faces[bFace]) expect(w().selection).toContain(i)
    expect(heldState(cur(), named('A'), w())).toBe('all')
  })

  it('a hidden group of faces hides the corners only its faces stand on, so nothing in sight can bend them', () => {
    w().create('s')
    w().placeStamp([0, 0, 0])
    w().selectFace(null)
    for (let k = 0; k < cur().faces.length; k++) w().selectFace(k)
    w().createGroup('Skin')
    w().selectFace(null); w().selectVertex(null)
    w().setGroupHidden(named('Skin').id, true)
    w().selectAll()
    expect(w().selection).toEqual([])
    const h = hiddenSets(cur(), [named('Skin')])!
    expect(h.vertices.size).toBe(cur().vertices.length)
  })

  it('a group made inside an opened LINK leaves its parent pointed at the link: only a real edit makes the copy the parent\'s', async () => {
    setLocalAuthor(() => useCyberspace.getState().identity.pubkey)
    const PK2 = 'b'.repeat(64)
    const statue = fromPayload({ v: 2, name: 'Statue', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 0, 1]], colors: [5, 5, 5], faces: [[0, 1, 2]] }, 'statue')!
    const link = ['a', `33331:${PK2}:statue`] as ['a', string]
    useWorkshop.setState({ shards: [{ ...fromPayload({ v: 2, name: 'Plaza', unit: 0, mode: 'solid', vertices: [], colors: [], faces: [] }, 'plaza')!, refs: [link], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }], currentId: 'plaza', backStack: [] })
    await w().enterPart(0, async () => toPayload(statue))
    expect(w().currentId).not.toBe('plaza')
    w().setSelection([0, 1, 2])
    w().createGroup('Head')
    w().renameGroup(named('Head').id, 'Face')
    expect(w().shards.find((x) => x.id === 'plaza')!.refs).toEqual([link])
    // A real edit does point it at the copy.
    w().addVertex([5, 5, 5])
    expect(w().shards.find((x) => x.id === 'plaza')!.refs).toEqual([['a', `33331:${useCyberspace.getState().identity.pubkey}:${w().currentId}`]])
  })

  it('every group change is one UNDO', () => {
    twoBlocks()
    const steps = w().past.length
    w().renameGroup(named('A').id, 'Rock')
    expect(w().past.length).toBe(steps + 1)
    w().undo()
    expect(groups()[0].name).toBe('A')
    w().redo()
    expect(groups()[0].name).toBe('Rock')
  })
})

describe('groups are local editor data', () => {
  it('never reach the payload', () => {
    twoBlocks()
    const p = toPayload(cur()) as unknown as Record<string, unknown>
    expect(p.groups).toBeUndefined()
    expect(JSON.stringify(p)).not.toContain('"A"')
  })

  it('survive a reload through storage, cleaned against the shard', () => {
    twoBlocks()
    const stored = JSON.parse(JSON.stringify(cur()))
    const back = normalizeOne(stored)!
    expect(groupsOf(back)).toEqual(groups())
    // Anything out of range or malformed is dropped on the way back.
    stored.groups.push({ id: 'x', name: 'Bad', vertices: [999], faces: [-1], parts: ['a'] }, { name: 'no id' }, 7)
    stored.groups[0].vertices.push(5000)
    const cleaned = groupsOf(normalizeOne(stored)!)
    expect(cleaned.map((g) => g.name)).toEqual(['A', 'B'])
    expect(cleaned[0].vertices).toEqual(groups()[0].vertices)
    expect(saneGroups({ ...cur(), groups: 'nope' } as unknown as ShardModel)).not.toHaveProperty('groups')
  })

  it('a shard with no groups is stored as it always was', () => {
    w().create('plain')
    w().placeStamp([0, 0, 0])
    expect(cur()).not.toHaveProperty('groups')
    w().setSelection([0])
    w().createGroup()
    w().deleteGroup(groups()[0].id)
    expect(cur()).not.toHaveProperty('groups')
  })

  it('a bulk import UPDATE starts the new geometry without the old groups', async () => {
    twoBlocks()
    const id = cur().id
    await w().replaceShard(id, { ...cur(), vertices: cur().vertices.slice(0, 8), faces: [] })
    expect(groups()).toHaveLength(0)
  })
})
