/**
 * useWorkshop.test.ts - edits keep the shard consistent: hand-added vertices
 * never stack, stamped ones may and then move as one point, faces follow
 * their vertices through deletions, every edit undoes, and a shard survives
 * the clipboard.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_PALETTE, useWorkshop } from './useWorkshop'

const w = () => useWorkshop.getState()

describe('workshop', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], selectedFace: null, facePick: [], palette: [...DEFAULT_PALETTE], level: 0, color: [0, 0.9, 1], past: [], future: [], aim: null, notice: null, tool: 'stamp', stampKind: 'block', stampSize: 1, stampFacing: 0 })
    w().create('t')
  })

  it('starts a new shard in LINES with the stamp tool', () => {
    expect(w().current()!.mode).toBe('lines')
    expect(w().tool).toBe('stamp')
  })

  it('adds vertices at the level, never twice on one point by hand, and selects them', () => {
    w().setLevel(2)
    w().addVertex([1, 2, 3])
    w().addVertex([1, 2, 3])
    expect(w().current()!.vertices).toHaveLength(1)
    expect(w().current()!.vertices[0].p).toEqual([1, 2, 3])
    expect(w().selection).toEqual([0])
    w().addVertex([9, 0, 0])
    expect(w().current()!.vertices).toHaveLength(1)
  })

  it('nudges the selection, may land on another vertex, and never leaves the grid', () => {
    w().addVertex([0, 0, 0]); w().addVertex([1, 0, 0])
    w().selectVertex(0)
    w().moveSelected(1, 1)
    expect(w().current()!.vertices[0].p).toEqual([0, 1, 0])
    w().moveSelected(1, -1); w().moveSelected(0, 1)
    expect(w().current()!.vertices[0].p).toEqual([1, 0, 0])
    w().selectVertex(1)
    for (let i = 0; i < 20; i++) w().moveSelected(0, 1)
    expect(w().current()!.vertices[1].p[0]).toBe(8)
  })

  it('stamps a shape, and the first faces switch LINES to SOLID once', () => {
    w().placeStamp([0, 0, 0])
    const s = w().current()!
    expect(s.vertices).toHaveLength(8)
    expect(s.faces).toHaveLength(12)
    expect(s.mode).toBe('solid')
    expect(w().notice).toMatch(/SOLID/)
    // Back to LINES on purpose: the next stamp respects it.
    w().setMode('lines')
    w().placeStamp([3, 0, 0])
    expect(w().current()!.mode).toBe('lines')
    expect(w().current()!.vertices).toHaveLength(16)
  })

  it('a ring has no faces and leaves the mode alone', () => {
    w().setStampKind('ring')
    w().placeStamp([0, 0, 0])
    expect(w().current()!.faces).toHaveLength(0)
    expect(w().current()!.mode).toBe('lines')
    expect(w().notice).toBeNull()
  })

  it('moves, colors and deletes every vertex on the selected point together', () => {
    w().placeStamp([0, 0, 0])
    w().setColor([1, 0, 0])
    w().placeStamp([1, 0, 0])
    const s = w().current()!
    const shared = s.vertices.map((v, i) => (v.p.join() === '1,0,0' ? i : -1)).filter((i) => i >= 0)
    expect(shared).toHaveLength(2)
    w().selectVertex(shared[0])
    // Off to a free point: landing on the blocks' top corners would join those too.
    w().moveSelected(2, -1)
    for (const i of shared) expect(w().current()!.vertices[i].p).toEqual([1, 0, -1])
    w().colorSelected([0, 1, 0])
    for (const i of shared) expect(w().current()!.vertices[i].c).toEqual([0, 1, 0])
    const facesBefore = w().current()!.faces.length
    w().deleteSelected()
    const after = w().current()!
    expect(after.vertices).toHaveLength(14)
    expect(after.faces.length).toBeLessThan(facesBefore)
    for (const f of after.faces) for (const i of f) expect(i).toBeLessThan(14)
    expect(w().selection).toEqual([])
  })

  it('selects many points: tap toggles, a box replaces, whole points always', () => {
    w().placeStamp([0, 0, 0])          // a block: 8 corners
    w().addVertex([5, 0, 5])
    const s = w().current()!
    const corner = s.vertices.findIndex((v) => v.p.join() === '0,0,0')
    w().selectVertex(null)
    w().toggleVertex(corner); w().toggleVertex(s.vertices.length - 1)
    expect(new Set(w().selection.map((i) => s.vertices[i].p.join()))).toEqual(new Set(['0,0,0', '5,0,5']))
    w().toggleVertex(corner)
    expect(w().selection.map((i) => s.vertices[i].p.join())).toEqual(['5,0,5'])
    w().setSelection([corner])
    expect(w().selection).toEqual([corner])
  })

  it('nudges, colors and deletes a whole selection at once, refusing a move that would leave the grid', () => {
    w().addVertex([0, 0, 0]); w().addVertex([8, 0, 0]); w().addVertex([3, 0, 3])
    w().setSelection([0, 1, 2])
    w().moveSelected(0, 1)               // 8 -> 9 is off the grid: nothing moves
    expect(w().current()!.vertices.map((v) => v.p[0])).toEqual([0, 8, 3])
    w().moveSelected(2, 1)
    expect(w().current()!.vertices.map((v) => v.p[2])).toEqual([1, 1, 4])
    w().colorSelected([1, 0, 0])
    expect(w().current()!.vertices.every((v) => v.c.join() === '1,0,0')).toBe(true)
    w().setSelection([0, 2]); w().deleteSelected()
    expect(w().current()!.vertices.map((v) => v.p.join())).toEqual(['8,0,1'])
    expect(w().selection).toEqual([])
  })

  it('CONNECTED grows the selection along faces and shared points, and no further', () => {
    w().placeStamp([0, 0, 0])            // one block, 8 corners joined by faces
    w().placeStamp([5, 0, 5])            // another, apart
    w().addVertex([-4, 0, -4])           // a lone point
    const s = w().current()!
    const a = s.vertices.findIndex((v) => v.p.join() === '0,0,0')
    w().setSelection([a]); w().selectConnected()
    const points = new Set(w().selection.map((i) => s.vertices[i].p.join()))
    expect(points.size).toBe(8)
    expect(points.has('5,0,5')).toBe(false)
    expect(points.has('-4,0,-4')).toBe(false)
    w().setSelection([s.vertices.length - 1]); w().selectConnected()
    expect(w().selection).toEqual([s.vertices.length - 1])
  })

  it('keeps a grid scale per shard, never below what its points need, and carries it in the payload', () => {
    w().addVertex([5, 0, 0])
    expect(w().current()!.extent).toBe(8)
    w().setExtent(3)
    expect(w().current()!.extent).toBe(5)        // the point at x=5 holds it
    w().setExtent(999)
    expect(w().current()!.extent).toBe(64)
    w().setLevel(50); expect(w().level).toBe(50)
    w().setExtent(6)
    expect(w().level).toBe(6)                    // the level follows the grid down
    expect(w().addVertex([7, 0, 0]), 'outside the grid').toBeUndefined()
    expect(w().current()!.vertices).toHaveLength(1)
    const text = w().exportCurrent()!
    expect(JSON.parse(text).extent).toBe(6)
    const id = w().importText(text)!
    expect(w().shards.find((s) => s.id === id)!.extent).toBe(6)
    expect(w().importText(JSON.stringify({ ...JSON.parse(text), extent: undefined }))).not.toBeNull()
    expect(w().current()!.extent).toBe(8)        // an older payload lands on the default
  })

  it('fills a loop of picked corners, closing on the first pick or by FILL', () => {
    w().setTool('add')
    w().addVertex([0, 0, 0]); w().addVertex([2, 0, 0]); w().addVertex([2, 0, 2]); w().addVertex([0, 0, 2])
    w().setTool('face')
    w().pickForFace(0); w().pickForFace(1); w().pickForFace(2); w().pickForFace(3)
    expect(w().facePick).toEqual([0, 1, 2, 3])
    w().pickForFace(0)
    expect(w().current()!.faces).toHaveLength(2)
    expect(w().current()!.mode).toBe('solid')
    expect(w().facePick).toEqual([])
    // The same loop again adds nothing.
    w().pickForFace(0); w().pickForFace(1); w().pickForFace(2); w().pickForFace(3); w().fill()
    expect(w().current()!.faces).toHaveLength(2)
    // A second pick of a corner unpicks it; CANCEL drops the rest.
    w().pickForFace(0); w().pickForFace(1); w().pickForFace(2); w().pickForFace(1)
    expect(w().facePick).toEqual([0, 2])
    w().clearFacePick()
    expect(w().facePick).toEqual([])
  })

  it('refuses a fill that is not a polygon and keeps the picks', () => {
    w().setTool('add')
    w().addVertex([0, 0, 0]); w().addVertex([1, 0, 0]); w().addVertex([2, 0, 0])
    w().setTool('face')
    w().pickForFace(0); w().pickForFace(1); w().pickForFace(2)
    w().fill()
    expect(w().current()!.faces).toHaveLength(0)
    expect(w().facePick).toHaveLength(3)
    expect(w().notice).toMatch(/corners/)
  })

  it('undoes and redoes every edit, and switching shards forgets the history', () => {
    w().placeStamp([0, 0, 0])
    w().colorAll([1, 0, 0])
    w().setUnit(3)
    expect(w().current()!.unit).toBe(3)
    w().undo()
    expect(w().current()!.unit).toBe(0)
    expect(w().current()!.vertices[0].c).toEqual([1, 0, 0])
    w().undo()
    expect(w().current()!.vertices[0].c).toEqual([0, 0.9, 1])
    w().undo()
    expect(w().current()!.vertices).toHaveLength(0)
    expect(w().current()!.mode).toBe('lines')
    w().undo()
    expect(w().current()!.vertices).toHaveLength(0)
    w().redo(); w().redo(); w().redo()
    expect(w().current()!.unit).toBe(3)
    expect(w().current()!.vertices).toHaveLength(8)
    w().redo()
    expect(w().current()!.unit).toBe(3)
    w().undo()
    w().placeStamp([2, 0, 2])
    w().redo()
    expect(w().current()!.unit).toBe(0)
    const other = w().create('u')
    expect(w().past).toEqual([])
    w().select(other); w().undo()
    expect(w().current()!.id).toBe(other)
  })

  it('colors the selection or everything', () => {
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

  it('exports wire form and imports it as a new shard; garbage is refused', () => {
    w().setStampKind('pyramid'); w().placeStamp([0, 0, 0]); w().setUnit(5)
    const text = w().exportCurrent()!
    const before = w().currentId
    const id = w().importText(text)!
    expect(id).not.toBe(before)
    expect(w().currentId).toBe(id)
    const s = w().current()!
    expect(s.vertices).toHaveLength(5)
    expect(s.faces).toHaveLength(6)
    expect(s.unit).toBe(5)
    expect(s.mode).toBe('solid')
    expect(w().importText('not json')).toBeNull()
    expect(w().importText('{"v":1,"type":"note"}')).toBeNull()
    expect(w().shards).toHaveLength(2)
    // A found shard copies in as a model, renamed if the name is taken.
    const found = w().importShard(s)
    expect(found).not.toBe(id)
    expect(w().shards).toHaveLength(3)
    expect(w().shards.find((x) => x.id === found)!.name).toBe(`${s.name} copy`)
  })

  it('stamps that cannot fit leave a notice and the shard alone', () => {
    w().setStampSize(4)
    for (let i = 0; i < 70; i++) w().placeStamp([(i % 5) * 3 - 6, 0, (Math.floor(i / 5) % 5) * 3 - 6])
    const n = w().current()!.vertices.length
    expect(n).toBeLessThanOrEqual(512)
    expect(w().notice).toMatch(/No room/)
  })
})

describe('faces and palette', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], selectedFace: null, facePick: [], palette: [...DEFAULT_PALETTE], past: [], future: [], tool: 'stamp', stampKind: 'block', stampSize: 1, stampFacing: 0, color: [0, 0.9, 1] })
    w().create('t')
    w().placeStamp([0, 0, 0])
    w().setTool('face')
  })

  it('selects a tapped face instead of the point, and DELETE FACE removes just that face, undoably', () => {
    const before = w().current()!.faces.length
    w().selectVertex(0)
    w().selectFace(3)
    expect(w().selection).toEqual([])
    expect(w().selectedFace).toBe(3)
    const gone = w().current()!.faces[3]
    w().deleteSelectedFace()
    expect(w().selectedFace).toBeNull()
    expect(w().current()!.faces).toHaveLength(before - 1)
    expect(w().current()!.faces).not.toContainEqual(gone)
    w().undo()
    expect(w().current()!.faces).toHaveLength(before)
  })

  it('drops the face when a point is selected, a corner picked, or the tool changes', () => {
    w().selectFace(0); w().selectVertex(1); expect(w().selectedFace).toBeNull()
    w().selectFace(0); w().pickForFace(2); expect(w().selectedFace).toBeNull()
    w().clearFacePick()
    w().selectFace(0); w().setTool('select'); expect(w().selectedFace).toBeNull()
  })

  it('remembers a picked color at the front once, moves a repeat forward, ignores junk, forgets on request', () => {
    w().rememberColor('#123456')
    expect(w().palette[0]).toBe('#123456')
    expect(w().palette).toHaveLength(DEFAULT_PALETTE.length + 1)
    w().rememberColor('#FFFFFF')
    expect(w().palette[0]).toBe('#ffffff')
    expect(w().palette.filter((h) => h === '#ffffff')).toHaveLength(1)
    w().rememberColor('nonsense')
    expect(w().palette).toHaveLength(DEFAULT_PALETTE.length + 1)
    w().forgetColor('#123456')
    expect(w().palette).not.toContain('#123456')
  })

  it('keeps 24 colors, the oldest falling off the end', () => {
    for (let i = 0; i < 30; i++) w().rememberColor('#' + i.toString(16).padStart(6, '0'))
    expect(w().palette).toHaveLength(24)
    expect(w().palette[0]).toBe('#00001d')
    expect(w().palette).not.toContain('#ffffff')
  })
})
