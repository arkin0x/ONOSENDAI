/**
 * meshImport.test.ts - IMPORT puts a 3D file down the way PASTE FLOOR puts a
 * copied shard down: resting on the working plane, selected, one UNDO from
 * gone, and the clipboard left as it was. In an empty shard it is the shard.
 *
 * The files are written here, a few lines each, and go through the same
 * path the workshop's IMPORT button does (lib/meshImport, which runs inline
 * where there is no Worker, as in these tests).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT as T, ticksOf } from 'sno-core/shards'
import { BUILT_IN, indexOf, toBytes } from 'sno-core/snoPalette'
import { useWorkshop } from '../useWorkshop'
import { importFiles, tooLarge } from '../../lib/meshImport'

const w = () => useWorkshop.getState()

/** A unit cube as an ASCII PLY: six quads, wound to look out, one color per side when `seams`. */
function cubePly(seams = false): string {
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]
  const colors = ['255 0 0', '0 0 255']
  return [
    'ply', 'format ascii 1.0', 'element vertex 8', 'property float x', 'property float y', 'property float z',
    'element face 6', 'property list uchar int vertex_indices', ...(seams ? ['property uchar red', 'property uchar green', 'property uchar blue'] : []), 'end_header',
    '0 0 0', '1 0 0', '1 1 0', '0 1 0', '0 0 1', '1 0 1', '1 1 1', '0 1 1',
    ...quads.map((q, i) => `4 ${q.join(' ')}${seams ? ' ' + colors[i % 2] : ''}`), '',
  ].join('\n')
}

const ply = (name: string, text: string): File => new File([text], name)

/** Read a file through the workshop's own path, fitted to the current shard, and put it down. */
async function importInto(file: File): Promise<boolean> {
  const s = w().current()!
  const res = await importFiles([file], { fit: s.extent * T, unit: s.unit, palette: s.palette ?? BUILT_IN, color: w().color })
  if (!res.ok) throw new Error(res.error)
  return w().insertImport(res.shard, `${res.report.summary}.`)
}

describe('IMPORT in the workshop', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], selectedFace: null, facePick: [], clip: null, level: 0, plane: 1, past: [], future: [], notice: null, tool: 'select', stampKind: 'block', stampSize: 2, stampFacing: 0, stampMode: 'shape', stampObject: null, color: [0, 0.9, 1] })
  })

  it('puts the file down selected on the working plane, says what it did, and one UNDO takes it all back', async () => {
    w().create('scene')
    w().addVertex([5 * T, 0, 5 * T])
    w().copySelection()
    const held = w().clip
    w().setLevel(2 * T)
    const before = w().current()!
    expect(await importInto(ply('cube.ply', cubePly()))).toBe(true)
    const s = w().current()!

    // Eight corners and twelve triangles after the point that was there.
    expect(s.vertices).toHaveLength(9)
    expect(s.faces).toHaveLength(12)
    expect(s.faces.every((f) => f.every((i) => i >= 1))).toBe(true)
    expect(s.mode).toBe('solid')
    // Fitted to the grid: its largest side is GRID SIZE units (as it was when
    // the file was read), resting on the level, centered; the grid grew to hold it.
    const ys = s.vertices.slice(1).map((v) => ticksOf(v)[1])
    const xs = s.vertices.slice(1).map((v) => ticksOf(v)[0])
    expect(Math.min(...ys)).toBe(2 * T)
    expect(Math.max(...ys) - Math.min(...ys)).toBe(before.extent * T)
    expect(s.extent).toBe(before.extent + 2)
    expect(Math.min(...xs) + Math.max(...xs)).toBe(0)
    // Selected, exactly the new points, ready for the nudges.
    expect(w().selection).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(w().notice).toBe('Imported 12 faces.')
    // The clipboard is the person's, not IMPORT's.
    expect(w().clip).toBe(held)

    w().undo()
    expect(w().current()).toEqual(before)
    w().redo()
    expect(w().current()!.vertices).toHaveLength(9)
  })

  it('in an empty shard, becomes the shard: the file\'s name, its faces, and SOLID', async () => {
    w().create('Object 1')
    await importInto(ply('teapot lid.ply', cubePly()))
    const s = w().current()!
    expect(s.name).toBe('teapot lid')
    expect(s.mode).toBe('solid')
    expect(s.faces).toHaveLength(12)
    w().undo()
    expect(w().current()!.name).toBe('Object 1')
    expect(w().current()!.vertices).toHaveLength(0)
  })

  it('draws a point cloud in an empty shard as POINTS, not one line through every point', async () => {
    w().create()
    const pts = Array.from({ length: 40 }, (_, i) => `${Math.cos(i)} ${i / 8} ${Math.sin(i)}`)
    const text = ['ply', 'format ascii 1.0', 'element vertex 40', 'property float x', 'property float y', 'property float z', 'end_header', ...pts, ''].join('\n')
    await importInto(ply('scan.ply', text))
    expect(w().current()!.mode).toBe('points')
    expect(w().current()!.vertices).toHaveLength(40)
    expect(w().notice).toBe('Imported 40 points.')
  })

  it('keeps a file\'s face colors as seams, and gives the faces already there their own look', async () => {
    w().create()
    w().placeStamp([4 * T, 0, 4 * T])
    const stamped = w().current()!.faces.length
    await importInto(ply('seams.ply', cubePly(true)))
    const s = w().current()!
    expect(s.facecolors).toHaveLength(s.faces.length)
    const imported = s.facecolors!.slice(stamped).map((c) => indexOf(BUILT_IN, toBytes(c)))
    expect(new Set(imported)).toEqual(new Set([238, 239]))
  })

  it('grows the grid when the level would carry the file past its edge, as a pasted shard does', async () => {
    w().create()
    w().setLevel(6 * T)
    await importInto(ply('cube.ply', cubePly()))
    const s = w().current()!
    expect(s.extent).toBe(14)
    expect(Math.max(...s.vertices.map((v) => ticksOf(v)[1]))).toBe(14 * T)
  })

  it('refuses a file over the size cap before reading it, and says why a bad file failed', async () => {
    expect(tooLarge([{ size: 60 * 1024 * 1024 }])).toMatch(/50 MB/)
    expect(tooLarge([{ size: 1024 }])).toBeNull()
    const bad = await importFiles([ply('broken.ply', 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nend_header\n')], {})
    expect(bad.ok).toBe(false)
    const none = await importFiles([], {})
    expect(none).toEqual({ ok: false, error: 'No file was picked.' })
  })
})
