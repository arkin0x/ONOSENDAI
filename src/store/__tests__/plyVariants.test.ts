/**
 * plyVariants.test.ts - every PLY variant the parser reads, through the path
 * the workshop's IMPORT button takes (lib/meshImport, inline here where there
 * is no Worker) and put down in a fresh shard (useWorkshop insertImport).
 *
 * arkinox, 2026-11-16: "can you make sure we can import PLY files in the
 * workshop?" Each fixture is written here, a few rows each, in the layouts
 * the writers people use put out: ASCII, binary either way round, colors per
 * vertex or per face as bytes or floats, a point cloud, quads and longer
 * polygons, Blender's exporters (4.x and the older one) and MagicaVoxel's.
 * The geometry is a hexagonal lantern and an obelisk, made up for this.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT as T, ticksOf } from 'sno-core/shards'
import { BUILT_IN, indexOf, toBytes } from 'sno-core/snoPalette'
import { importFitFor } from 'sno-core/meshToShard'
import { useWorkshop } from '../useWorkshop'
import { importFiles } from '../../lib/meshImport'
import { routeImport } from '../useShardImport'

const w = () => useWorkshop.getState()

type Format = 'ascii' | 'binary_little_endian' | 'binary_big_endian'
/** A property: a scalar `type name`, or a list `list count item name`. */
type Prop = string
interface El { name: string; props: Prop[]; rows: Array<Array<number | number[]>> }

const WRITE: Record<string, [keyof DataView, number]> = {
  char: ['setInt8', 1], uchar: ['setUint8', 1], short: ['setInt16', 2], ushort: ['setUint16', 2],
  int: ['setInt32', 4], uint: ['setUint32', 4], float: ['setFloat32', 4], double: ['setFloat64', 8],
}

/** A PLY file from its elements, in any of the three encodings. */
function plyFile(format: Format, elements: El[], comments: string[] = [], eol = '\n'): Uint8Array {
  const head = ['ply', `format ${format} 1.0`, ...comments.map((c) => `comment ${c}`)]
  for (const e of elements) head.push(`element ${e.name} ${e.rows.length}`, ...e.props.map((p) => `property ${p}`))
  head.push('end_header')
  const header = new TextEncoder().encode(head.join(eol) + eol)
  if (format === 'ascii') {
    const body = elements.flatMap((e) => e.rows.map((r) => r.map((v) => (Array.isArray(v) ? `${v.length} ${v.join(' ')}` : String(v))).join(' ')))
    return new TextEncoder().encode(head.join(eol) + eol + body.join(eol) + eol)
  }
  const little = format === 'binary_little_endian'
  const out: Array<[string, number]> = []
  for (const e of elements) for (const r of e.rows) r.forEach((v, k) => {
    const words = e.props[k].split(/\s+/)
    if (words[0] === 'list') { out.push([words[1], (v as number[]).length]); for (const x of v as number[]) out.push([words[2], x]) } else out.push([words[0], v as number])
  })
  const size = out.reduce((t, [type]) => t + WRITE[type][1], 0)
  const bytes = new Uint8Array(header.length + size)
  bytes.set(header)
  const view = new DataView(bytes.buffer)
  let at = header.length
  for (const [type, v] of out) {
    const [fn, n] = WRITE[type]
    ;(view[fn] as (o: number, v: number, l?: boolean) => void).call(view, at, v, little)
    at += n
  }
  return bytes
}

const XYZ = ['float x', 'float y', 'float z']
const RGB = ['uchar red', 'uchar green', 'uchar blue']

/** A hexagonal lantern, Y up, base on y = 0: two hexagon caps (six corners each) and six quad sides. */
const LANTERN = (() => {
  const points: number[][] = []
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    points.push([+(0.5 * Math.cos(a)).toFixed(5), ring * 1.5, +(0.5 * Math.sin(a)).toFixed(5)])
  }
  const faces = [[5, 4, 3, 2, 1, 0], [6, 7, 8, 9, 10, 11]]
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; faces.push([i, j, 6 + j, 6 + i]) }
  // Bottom ring purple, top ring yellow.
  const colors = points.map((p) => (p[1] ? [255, 200, 0] : [200, 0, 255]))
  return { points, faces, colors }
})()
/** Two hexagons and six quads: 4 + 4 + 12 triangles. */
const LANTERN_TRIANGLES = 20

/** The lantern with a color per vertex, as bytes. */
const lanternEls = (faceList = 'list uchar int vertex_indices'): El[] => [
  { name: 'vertex', props: [...XYZ, ...RGB], rows: LANTERN.points.map((p, i) => [...p, ...LANTERN.colors[i]]) },
  { name: 'face', props: [faceList], rows: LANTERN.faces.map((f) => [f]) },
]

/**
 * An obelisk as Blender holds it, Z up: a 1 x 1 base, a 0.5 x 0.5 top at
 * height 2, an apex at 2.6, and a fin on its front (Blender's -Y) whose tip
 * is the one point that far forward, so which way it faces can be told.
 * `yUp` is the file Blender writes with Up set to Y and Forward to -Z,
 * (x, y, z) to (x, z, -y); otherwise the default, Forward Y and Up Z.
 */
function obelisk(yUp: boolean): { points: number[][]; faces: number[][]; colors: number[][] } {
  const raw = [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.25, -0.25, 2], [0.25, -0.25, 2], [0.25, 0.25, 2], [-0.25, 0.25, 2], [0, 0, 2.6], [0, -0.9, 0.3]]
  return {
    points: raw.map(([x, y, z]) => (yUp ? [x, z, 0 - y] : [x, y, z])),
    faces: [[3, 2, 1, 0], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 8], [5, 6, 8], [6, 7, 8], [7, 4, 8], [1, 0, 9]],
    colors: raw.map(([, , z]) => (z === 0 ? [30, 30, 220, 255] : z === 2 ? [220, 220, 220, 255] : [255, 40, 40, 255])),
  }
}

/**
 * Blender 4.x's PLY exporter, as it lays a file out (source/blender/io/ply,
 * ply_export_header.cc): x y z, normals, colors as uchar red green blue alpha,
 * UVs as s t, then every other attribute, faces as `list uchar uint
 * vertex_indices`, and loose edges as their own element.
 */
function blender4(yUp: boolean, format: Format = 'binary_little_endian', comments = ['Created in Blender version 4.2.3 LTS']): Uint8Array {
  const o = obelisk(yUp)
  return plyFile(format, [
    { name: 'vertex', props: [...XYZ, 'float nx', 'float ny', 'float nz', ...RGB, 'uchar alpha', 'float s', 'float t', 'float bevel_weight_vert'], rows: o.points.map((p, i) => [...p, 0, 0, 1, ...o.colors[i], i / 10, 1 - i / 10, 0]) },
    { name: 'face', props: ['list uchar uint vertex_indices'], rows: o.faces.map((f) => [f]) },
    { name: 'edge', props: ['int vertex1', 'int vertex2'], rows: [[0, 8]] },
  ], comments)
}

const file = (name: string, bytes: Uint8Array): File => new File([bytes as Uint8Array<ArrayBuffer>], name)

/** A file through IMPORT into a new, empty shard; the shard it became. */
async function imported(name: string, bytes: Uint8Array) {
  w().create()
  const s = w().current()!
  const picked = file(name, bytes)
  // The route the workshop sends a picked or dropped file down: a PLY is IMPORT's 3D reader, not bulk import.
  expect((await routeImport([picked])).to).toBe('mesh')
  const res = await importFiles([picked], { fit: importFitFor(s.extent), unit: s.unit, palette: s.palette ?? BUILT_IN, color: w().color })
  if (!res.ok) throw new Error(res.error)
  expect(w().insertImport(res.shard, `${res.report.summary}.`)).toBe(true)
  return w().current()!
}

/** How far the shard reaches along each axis, in grid units. */
function size(s: { vertices: Parameters<typeof ticksOf>[0][] }): number[] {
  const at = s.vertices.map((v) => ticksOf(v))
  return [0, 1, 2].map((k) => (Math.max(...at.map((p) => p[k])) - Math.min(...at.map((p) => p[k]))) / T)
}

/** The palette index each vertex color snapped to. */
const swatches = (s: { vertices: Array<{ c: [number, number, number] }> }): Set<number> => new Set(s.vertices.map((v) => indexOf(BUILT_IN, toBytes(v.c))))
/** The palette index a byte color snaps to: an exact entry, else the nearest in OKLab, as the importer snaps. */
const nearest = (rgb: number[]): number => indexOf(BUILT_IN, [rgb[0], rgb[1], rgb[2]])

describe('PLY variants through IMPORT', () => {
  beforeEach(() => {
    useWorkshop.setState({ shards: [], currentId: null, selection: [], partSel: [], selectedFaces: [], facePick: [], clip: null, level: 0, plane: 1, past: [], future: [], notice: null, tool: 'select', color: [0, 0.9, 1] })
  })

  it('ASCII with a color per vertex: the shard is the file, named after it, SOLID, its longest side half of GRID SIZE, resting on the floor', async () => {
    const s = await imported('lantern.ply', plyFile('ascii', lanternEls()))
    expect(s.name).toBe('lantern')
    expect(s.mode).toBe('solid')
    expect(s.unit).toBe(0)
    expect(s.vertices).toHaveLength(12)
    expect(s.faces).toHaveLength(LANTERN_TRIANGLES)
    // Y up as it was written: tallest along Y, its longest side half of GRID SIZE, resting on the floor.
    const [x, y, z] = size(s)
    expect(y).toBe(s.extent / 2)
    expect(x).toBeLessThan(y)
    expect(z).toBeLessThan(y)
    expect(Math.min(...s.vertices.map((v) => ticksOf(v)[1]))).toBe(0)
    expect(swatches(s)).toEqual(new Set([nearest([200, 0, 255]), nearest([255, 200, 0])]))
    // The bottom ring is the purple one.
    const low = s.vertices.filter((v) => ticksOf(v)[1] === 0)
    expect(new Set(low.map((v) => indexOf(BUILT_IN, toBytes(v.c))))).toEqual(new Set([nearest([200, 0, 255])]))
    expect(w().notice).toBe(`Imported ${LANTERN_TRIANGLES} faces.`)
  })

  it('stands on the level the grid is at, as a pasted shard does', async () => {
    useWorkshop.setState({ level: 2 * T })
    const s = await imported('lantern.ply', plyFile('ascii', lanternEls()))
    expect(Math.min(...s.vertices.map((v) => ticksOf(v)[1]))).toBe(2 * T)
  })

  it('binary little endian and big endian read the same as ASCII', async () => {
    const ascii = await imported('a.ply', plyFile('ascii', lanternEls()))
    for (const format of ['binary_little_endian', 'binary_big_endian'] as const) {
      const s = await imported('b.ply', plyFile(format, lanternEls('list uchar uint vertex_indices')))
      expect(s.vertices).toEqual(ascii.vertices)
      expect(s.faces).toEqual(ascii.faces)
    }
  })

  it('splits quads and longer polygons into triangles, each in its own winding', async () => {
    // One face of eight corners (an octagon) and one quad.
    const oct = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2), 0, Math.sin((i / 8) * Math.PI * 2)].map((n) => +n.toFixed(5)))
    const bytes = plyFile('ascii', [
      { name: 'vertex', props: XYZ, rows: [...oct, [3, 0, 0], [4, 0, 0], [4, 1, 0], [3, 1, 0]] },
      { name: 'face', props: ['list uchar int vertex_indices'], rows: [[[0, 1, 2, 3, 4, 5, 6, 7]], [[8, 9, 10, 11]]] },
    ])
    const s = await imported('shapes.ply', bytes)
    expect(s.faces).toHaveLength(6 + 2)
    expect(s.faces.every((f) => new Set(f).size === 3)).toBe(true)
  })

  it('a color per face (uchar) comes in as seams', async () => {
    const hues = [[255, 0, 0], [255, 128, 0], [255, 255, 0], [0, 200, 0], [0, 120, 255], [140, 0, 255], [255, 255, 255], [40, 40, 40]]
    const bytes = plyFile('binary_little_endian', [
      { name: 'vertex', props: XYZ, rows: LANTERN.points },
      { name: 'face', props: ['list uchar int vertex_indices', ...RGB], rows: LANTERN.faces.map((f, i) => [f, ...hues[i]]) },
    ])
    const s = await imported('hues.ply', bytes)
    expect(s.facecolors).toHaveLength(s.faces.length)
    expect(new Set(s.facecolors!.map((c) => indexOf(BUILT_IN, toBytes(c))))).toEqual(new Set(hues.map(nearest)))
  })

  it('float colors 0..1, float colors a writer put bytes in, and the r g b and diffuse_ names all read as uchar red green blue', async () => {
    const want = await imported('bytes.ply', plyFile('ascii', lanternEls()))
    const floats = (scale: number, names: string[]): El[] => [
      { name: 'vertex', props: [...XYZ, ...names.map((n) => `float ${n}`)], rows: LANTERN.points.map((p, i) => [...p, ...LANTERN.colors[i].map((c) => +(c * scale).toFixed(5))]) },
      lanternEls()[1],
    ]
    for (const els of [floats(1 / 255, ['red', 'green', 'blue']), floats(1, ['red', 'green', 'blue']), floats(1 / 255, ['r', 'g', 'b'])]) {
      expect((await imported('f.ply', plyFile('ascii', els))).vertices).toEqual(want.vertices)
    }
    const diffuse: El[] = [{ name: 'vertex', props: [...XYZ, 'uchar diffuse_red', 'uchar diffuse_green', 'uchar diffuse_blue'], rows: lanternEls()[0].rows }, lanternEls()[1]]
    expect((await imported('d.ply', plyFile('binary_big_endian', diffuse))).vertices).toEqual(want.vertices)
  })

  it('no faces: a point cloud, which an empty shard draws as POINTS', async () => {
    const helix = Array.from({ length: 60 }, (_, i) => { const a = i / 4; return [+Math.cos(a).toFixed(5), i / 15, +Math.sin(a).toFixed(5), i * 4, 80, 255 - i * 4] })
    const s = await imported('helix.ply', plyFile('binary_little_endian', [{ name: 'vertex', props: [...XYZ, ...RGB], rows: helix }]))
    expect(s.mode).toBe('points')
    expect(s.faces).toHaveLength(0)
    expect(s.vertices.length).toBeGreaterThan(50)
    expect(w().notice).toMatch(/^Imported \d+ points\.$/)
  })

  it('an empty face element is a point cloud too', async () => {
    const s = await imported('cloud.ply', plyFile('ascii', [{ name: 'vertex', props: XYZ, rows: LANTERN.points }, { name: 'face', props: ['list uchar int vertex_indices'], rows: [] }]))
    expect(s.mode).toBe('points')
    expect(s.vertices).toHaveLength(12)
  })

  it('reads Blender 4.x\'s layout (normals, alpha, UVs, attributes, loose edges), binary and ASCII', async () => {
    for (const format of ['binary_little_endian', 'ascii'] as const) {
      const s = await imported('obelisk.ply', blender4(false, format))
      expect(s.mode).toBe('solid')
      expect(s.vertices).toHaveLength(10)
      // A base quad and four side quads, two triangles each, four triangles to the apex, and the fin.
      expect(s.faces).toHaveLength(15)
      expect(swatches(s)).toEqual(new Set([nearest([30, 30, 220]), nearest([220, 220, 220]), nearest([255, 40, 40])]))
    }
  })

  /** The obelisk stands: half of GRID SIZE tall in Y, the apex alone on top, Blender's front (the fin) toward the viewer. */
  function expectStanding(s: Awaited<ReturnType<typeof imported>>): void {
    const [sx, sy, sz] = size(s)
    expect(sy).toBe(s.extent / 2)
    expect(sy).toBeGreaterThan(sx)
    expect(sy).toBeGreaterThan(sz)
    // The apex is the highest point, and the base is on the floor.
    const ys = s.vertices.map((v) => ticksOf(v)[1])
    expect(ys.filter((y) => y === Math.max(...ys))).toHaveLength(1)
    expect(ys.filter((y) => y === Math.min(...ys)).length).toBeGreaterThanOrEqual(4)
    // Blender's front comes to the viewer's side: wire +Z, which is the model's -Z (sno-core shards flipZ).
    // The fin's tip is the one point furthest that way; the two back corners of the base, the furthest the other.
    const zs = s.vertices.map((v) => ticksOf(v)[2])
    expect(zs.filter((z) => z === Math.min(...zs))).toHaveLength(1)
    expect(zs.filter((z) => z === Math.max(...zs))).toHaveLength(2)
  }

  it('a Blender PLY with the default export (Forward Y, Up Z) comes in standing, 4.x and the older exporter alike (arkinox, 2026-11-16)', async () => {
    expectStanding(await imported('obelisk.ply', blender4(false)))
    expectStanding(await imported('obelisk.ply', blender4(false, 'ascii')))
    expectStanding(await imported('obelisk-3x.ply', blender4(false, 'binary_big_endian', ['Created by Blender 3.6.0 - www.blender.org'])))
  })

  it('a Blender PLY exported with Up Y comes in on its back, which a quarter turn stands up; the same file from anyone else stands, read Y up', async () => {
    const lying = await imported('obelisk-y.ply', blender4(true))
    const [, ly, lz] = size(lying)
    expect(lz).toBe(lying.extent / 2)
    expect(ly).toBeLessThan(lz)
    // No Blender comment: PLY has no up axis of its own, and is read Y up.
    expectStanding(await imported('obelisk-y.ply', blender4(true, 'binary_little_endian', ['written by a scanner'])))
    // And a Z up file without the comment lies along Z, as before.
    const other = await imported('obelisk-z.ply', blender4(false, 'binary_little_endian', []))
    expect(size(other)[2]).toBe(other.extent / 2)
  })

  it('reads the older Blender exporter\'s layout (2.8 to 3.5: UVs before colors)', async () => {
    const o = obelisk(false)
    const bytes = plyFile('binary_little_endian', [
      { name: 'vertex', props: [...XYZ, 'float nx', 'float ny', 'float nz', 'float s', 'float t', ...RGB, 'uchar alpha'], rows: o.points.map((p, i) => [...p, 0, 0, 1, 0, 0, ...o.colors[i]]) },
      { name: 'face', props: ['list uchar uint vertex_indices'], rows: o.faces.map((f) => [f]) },
    ], ['Created by Blender 3.4.1 - www.blender.org'])
    const s = await imported('legacy.ply', bytes)
    expect(s.faces).toHaveLength(15)
    expect(swatches(s)).toEqual(new Set([nearest([30, 30, 220]), nearest([220, 220, 220]), nearest([255, 40, 40])]))
  })

  it('reads a MagicaVoxel point cloud (one point per voxel) and a voxel mesh of quads', async () => {
    const vox: number[][] = []
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) for (let z = 0; z < 6; z++) vox.push([x, y, z, z < 2 ? 120 : 30, z < 2 ? 70 : 180, z < 2 ? 20 : 60])
    const cloud = await imported('tree.ply', plyFile('ascii', [{ name: 'vertex', props: [...XYZ, ...RGB], rows: vox }], ['MagicaVoxel @ Ephtracy']))
    expect(cloud.mode).toBe('points')
    expect(cloud.vertices).toHaveLength(vox.length)
    // MagicaVoxel is Z up and PLY is read Y up, so its PLY lies along Z (its .vox comes in standing).
    const [cx, cy, cz] = size(cloud)
    expect(cz).toBeGreaterThan(cx)
    expect(cz).toBeGreaterThan(cy)
    const box = [[0, 0, 0], [3, 0, 0], [3, 1, 0], [0, 1, 0], [0, 0, 4], [3, 0, 4], [3, 1, 4], [0, 1, 4]]
    const quads = [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]]
    const mesh = await imported('column.ply', plyFile('ascii', [
      { name: 'vertex', props: [...XYZ, ...RGB], rows: box.map((p) => [...p, 200, 120, 40]) },
      { name: 'face', props: ['list uchar int vertex_indices'], rows: quads.map((q) => [q]) },
    ], ['MagicaVoxel @ Ephtracy']))
    expect(mesh.faces).toHaveLength(12)
  })

  it('reads the older vertex_index name, other lists on a face, and a header with Windows line ends', async () => {
    const want = await imported('w.ply', plyFile('ascii', lanternEls()))
    const els: El[] = [
      lanternEls()[0],
      { name: 'face', props: ['list uchar int vertex_index', 'list uchar float texcoord'], rows: LANTERN.faces.map((f) => [f, f.flatMap(() => [0.5, 0.5])]) },
    ]
    for (const bytes of [plyFile('binary_little_endian', els, [], '\r\n'), plyFile('ascii', els, ['made on Windows'], '\r\n')]) {
      const s = await imported('crlf.ply', bytes)
      expect(s.vertices).toEqual(want.vertices)
      expect(s.faces).toEqual(want.faces)
    }
  })

  it('a file too broken to read says so in one plain sentence, never with an em dash, and leaves the shard as it was', async () => {
    const good = plyFile('binary_little_endian', lanternEls())
    const cases: Array<[string, Uint8Array, RegExp]> = [
      ['cut.ply', good.slice(0, good.length - 7), /cut short/],
      ['nofmt.ply', new TextEncoder().encode('ply\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n'), /ASCII or binary/],
      ['noxyz.ply', new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 1\nproperty float u\nend_header\n0\n'), /no x, y and z/],
      ['bad.ply', plyFile('ascii', [{ name: 'vertex', props: XYZ, rows: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }, { name: 'face', props: ['list uchar int vertex_indices'], rows: [[[0, 1, 9]]] }]), /vertex 9/],
    ]
    for (const [name, bytes, why] of cases) {
      const res = await importFiles([file(name, bytes)], {})
      expect(res.ok).toBe(false)
      if (res.ok) continue
      expect(res.error).toMatch(why)
      expect(res.error).not.toMatch(/—/)
      expect(res.error).toMatch(/^[A-Z].*\.$/)
    }
  })

  it('a file over the size limit is refused before it is read, with the sizes in plain words', async () => {
    const huge = { name: 'scan.ply', size: 56 * 1048576, arrayBuffer: () => { throw new Error('read') } } as unknown as File
    expect(await importFiles([huge], {})).toEqual({ ok: false, error: 'That is 56 MB. Import reads files of up to 50 MB.' })
  })
})
