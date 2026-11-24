/**
 * blockMesh.test.ts: the Colour Table, culling and merging, and the cut into
 * pieces, on builds made here cell by cell and on the fixture castle.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TICKS_PER_UNIT as T, fromPayload, posed, ticksOf, toPayload, toRender } from 'sno-core/shards'
import { payloadBytes } from 'sno-core/meshToShard'
import { BUILT_IN, indexOf, toBytes } from 'sno-core/snoPalette'
import type { BlockGrid, V3 } from '../blockGrid'
import { buildImport, parentOf, MAX_PIECES } from '../blockBuild'
import { culledFaceCount, fieldOf, materialsFor, meshBox, mergeRects, type Quad } from '../blockMesh'
import { DEFAULT_CHOICES, colourFor, drawn, lookOf } from '../colourTable'
import { readBlockFile } from '../readBlockFile'
import { wholePayloadLimit } from '../../shardFullness'
import { reachTicks } from '../../deployFit'

/** A build of one region from a function of x, y, z to a state (or null for air). */
function gridOf(size: V3, at: (x: number, y: number, z: number) => string | null, name = 'Test'): BlockGrid {
  const palette = ['minecraft:air']
  const index = new Map<string, number>()
  const cells = new Uint16Array(size[0] * size[1] * size[2])
  for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    const s = at(x, y, z)
    if (!s) continue
    let i = index.get(s)
    if (i === undefined) { i = palette.length; palette.push(s); index.set(s, i) }
    cells[x + size[0] * (z + size[2] * y)] = i
  }
  return { format: 'schem', name, palette, regions: [{ name: 'Main', origin: [0, 0, 0], size, cells }] }
}

const BUDGET = wholePayloadLimit()
const all = (g: BlockGrid) => ({ min: [0, 0, 0] as V3, max: fieldOf(g).size })
const meshOf = (g: BlockGrid, choices = DEFAULT_CHOICES) => meshBox(fieldOf(g), materialsFor(g.palette, choices), all(g))

describe('the Colour Table', () => {
  it('gives a block our own colour, family and shape', () => {
    const stone = lookOf('minecraft:stone')
    expect(stone).toMatchObject({ family: 'stone', layer: 'solid', shape: 'cube', decor: false, hidden: false })
    expect(stone.colour).toBeGreaterThanOrEqual(192) // our steels
    expect(lookOf('minecraft:oak_stairs[facing=north,half=bottom]')).toMatchObject({ family: 'wood:oak', shape: 'stairs' })
    expect(lookOf('minecraft:stone_brick_slab[type=top]')).toMatchObject({ family: 'stone', shape: 'slab-top' })
    expect(lookOf('minecraft:stone_brick_slab[type=double]').shape).toBe('cube')
    expect(lookOf('minecraft:white_stained_glass_pane[east=true]')).toMatchObject({ layer: 'glass', shape: 'pane', family: 'dye:white' })
    expect(lookOf('minecraft:glass_pane').shape).toBe('pane')
    expect(lookOf('minecraft:water[level=0]').layer).toBe('water')
    expect(lookOf('minecraft:ice').layer).toBe('ice')
    expect(lookOf('minecraft:packed_ice').layer).toBe('solid')
    expect(lookOf('minecraft:red_carpet')).toMatchObject({ family: 'dye:red', shape: 'carpet' })
    expect(lookOf('minecraft:snow[layers=3]').shape).toBe('layer')
    expect(lookOf('minecraft:cobblestone_wall[north=low]').shape).toBe('wall')
    expect(lookOf('minecraft:oak_door[facing=north,half=lower]').shape).toBe('door')
  })

  it('skips decorations unless they are asked for, and never draws a barrier block', () => {
    for (const s of ['minecraft:torch', 'minecraft:wall_torch[facing=north]', 'minecraft:poppy', 'minecraft:rail', 'minecraft:oak_sign', 'minecraft:short_grass']) {
      const look = lookOf(s)
      expect(look.decor, s).toBe(true)
      expect(drawn(look, { showDecor: false })).toBe(false)
      expect(drawn(look, { showDecor: true })).toBe(true)
    }
    expect(drawn(lookOf('minecraft:barrier'), { showDecor: true })).toBe(false)
  })

  it('merges a family into one colour under MERGE SIMILAR, and the person\'s choice wins over both', () => {
    const states = ['minecraft:stone', 'minecraft:cobblestone', 'minecraft:andesite', 'minecraft:mossy_stone_bricks']
    const plain = states.map((s) => colourFor(s, lookOf(s), DEFAULT_CHOICES))
    const merged = states.map((s) => colourFor(s, lookOf(s), { ...DEFAULT_CHOICES, mergeSimilar: true }))
    expect(new Set(plain).size).toBeGreaterThan(1)
    expect(new Set(merged).size).toBe(1)
    expect(colourFor('minecraft:stone', lookOf('minecraft:stone'), { ...DEFAULT_CHOICES, mergeSimilar: true, overrides: { 'minecraft:stone': 77 } })).toBe(77)
  })

  it('maps every one of the sixteen dyes to its own colour', () => {
    const dyes = ['white', 'light_gray', 'gray', 'black', 'brown', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'light_blue', 'blue', 'purple', 'magenta', 'pink']
    const wool = dyes.map((d) => lookOf(`minecraft:${d}_wool`).colour)
    expect(new Set(wool).size).toBe(16)
    expect(dyes.every((d) => lookOf(`minecraft:${d}_concrete`).family === `dye:${d}`)).toBe(true)
  })

  it('draws a block it does not know in a neutral steel, never nothing', () => {
    expect(lookOf('somemod:strange_block')).toMatchObject({ family: 'other', shape: 'cube', hidden: false, decor: false })
  })
})

describe('culling and merging', () => {
  it('meshes a solid cube of one colour as six rectangles', () => {
    const g = gridOf([8, 8, 8], () => 'minecraft:stone')
    const f = fieldOf(g)
    const m = materialsFor(g.palette, DEFAULT_CHOICES)
    // 3,072 faces drawn naively, 384 after culling, 6 after merging (Lysenko's example).
    expect(culledFaceCount(f, m, all(g))).toBe(384)
    expect(meshOf(g).get('solid')).toHaveLength(6)
  })

  it('keeps one rectangle per face of a checkerboard, where colours defeat merging', () => {
    const g = gridOf([4, 1, 4], (x, _y, z) => ((x + z) % 2 ? 'minecraft:white_wool' : 'minecraft:black_wool'))
    const quads = meshOf(g).get('solid')!
    // Top and bottom: 16 each, one per block. Sides: 4 per edge, 4 edges.
    expect(quads).toHaveLength(16 + 16 + 16)
  })

  it('draws a hollow room\'s walls inside and out, and nothing inside the walls', () => {
    const g = gridOf([5, 5, 5], (x, y, z) => (x === 0 || x === 4 || y === 0 || y === 4 || z === 0 || z === 4 ? 'minecraft:stone' : null))
    // Six outside faces and six inside faces, each one rectangle.
    expect(meshOf(g).get('solid')).toHaveLength(12)
  })

  it('merges a row of slabs into one top, and hides the sides where slabs meet', () => {
    const g = gridOf([4, 1, 1], () => 'minecraft:oak_slab[type=bottom]')
    const quads = meshOf(g).get('solid')!
    expect(quads).toHaveLength(6)
    const top = quads.find((q) => q.d === 1 && q.side === 1)!
    expect([top.plane, top.u0, top.u1, top.v0, top.v1]).toEqual([60, 0, T, 0, 4 * T])
  })

  it('draws a lone stair as exactly its outside, with no face inside it', () => {
    const g = gridOf([1, 1, 1], () => 'minecraft:oak_stairs[facing=north,half=bottom]')
    const quads = meshOf(g).get('solid')!
    const area = quads.reduce((a, q) => a + (q.u1 - q.u0) * (q.v1 - q.v0), 0)
    // Bottom 1, back 1, two tops of a half, front and riser of a half each, two L-shaped sides of three quarters.
    expect(area).toBe(5.5 * T * T)
  })

  it('keeps the stone behind a window and drops the glass faces against stone', () => {
    const g = gridOf([3, 1, 1], (x) => (x === 1 ? 'minecraft:glass' : 'minecraft:stone'))
    const m = meshOf(g)
    // The glass shows only its four open sides; each stone keeps its face toward the glass.
    expect(m.get('glass')).toHaveLength(4)
    expect(m.get('solid')!.filter((q) => q.d === 0)).toHaveLength(4)
  })

  it('merges rectangles that share a whole edge, and no others', () => {
    const q = (u0: number, u1: number, v0: number, v1: number): Quad => ({ d: 1, side: 1, plane: 0, u0, u1, v0, v1, colour: 1 })
    expect(mergeRects([q(0, 1, 0, 1), q(1, 2, 0, 1), q(0, 1, 1, 2), q(1, 2, 1, 2)])).toHaveLength(1)
    expect(mergeRects([q(0, 1, 0, 1), q(2, 3, 0, 1)])).toHaveLength(2)
  })
})

describe('shards and pieces', () => {
  it('writes a small solid build as one shard that every reader reads, wound to look out', () => {
    const g = gridOf([3, 2, 3], () => 'minecraft:stone_bricks', 'Block')
    const r = buildImport(g, { choices: DEFAULT_CHOICES, unit: 0, budget: BUDGET })
    expect(r.single).toBe(true)
    expect(r.objects).toHaveLength(1)
    const s = r.objects[0].shard
    expect(fromPayload(JSON.parse(JSON.stringify(toPayload(s))), s.id)).not.toBeNull()
    expect(s.extra?.constrain).toBe('all')
    // Every triangle faces away from the middle of the block, as drawn (sno-core toRender).
    const centre = [0.5, 1, 0.5]
    for (const f of s.faces) {
      const [a, b, c] = f.map((i) => toRender(posed(ticksOf(s.vertices[i]))))
      const n = cross(sub(b, a), sub(c, a))
      const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
      expect(dot(n, sub(mid, centre))).toBeGreaterThan(0)
    }
    // Centred across, standing on its bottom.
    const ys = s.vertices.map((v) => ticksOf(v)[1])
    expect(Math.min(...ys)).toBe(0)
    expect(Math.max(...ys)).toBe(2 * T)
    const colour = indexOf(BUILT_IN, toBytes(s.facecolors![0]))
    expect(colour).toBe(lookOf('minecraft:stone_bricks').colour)
  })

  it('makes glass and water their own pieces, see-through, and water walkable', () => {
    const g = gridOf([3, 2, 1], (x, y) => (y === 0 ? 'minecraft:stone' : x === 1 ? 'minecraft:glass' : 'minecraft:water'))
    const r = buildImport(g, { choices: DEFAULT_CHOICES, unit: 0, budget: BUDGET })
    expect(r.single).toBe(false)
    const by = Object.fromEntries(r.objects.map((o) => [o.layer, o.shard]))
    expect(Object.keys(by).sort()).toEqual(['glass', 'solid', 'water'])
    expect(by.glass.opacity).toBe(40)
    expect(by.water.opacity).toBe(60)
    expect(by.water.extra?.constrain).toBe('off')
    expect(by.solid.opacity).toBeUndefined()
  })

  it('cuts the castle into aligned pieces that each fit one hidden object, placed by a parent', async () => {
    const g = await readBlockFile('castle.schem', new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'castle.schem'))))
    const r = buildImport(g, { choices: DEFAULT_CHOICES, unit: 0, budget: BUDGET })
    const solid = r.objects.filter((o) => o.layer === 'solid')
    expect(solid.length).toBeGreaterThan(1)
    expect(r.objects.length).toBeLessThanOrEqual(MAX_PIECES)
    for (const o of r.objects) {
      expect(o.bytes).toBe(payloadBytes(o.shard))
      expect(o.bytes).toBeLessThanOrEqual(BUDGET)
      // Cut by place: each piece's corner on a whole block, on a power-of-two grid across.
      expect(o.at.every((n) => n % T === 0)).toBe(true)
    }
    const parent = parentOf(r, 'a'.repeat(64))
    expect(parent.vertices).toHaveLength(0)
    expect(parent.refs).toHaveLength(r.objects.length)
    expect(parent.refs!.every((ref, i) => ref[0] === 'a' && ref[1] === `33331:${'a'.repeat(64)}:${r.objects[i].shard.id}`)).toBe(true)
    expect(parent.parts!.map((p) => p.at)).toEqual(r.objects.map((o) => o.at))
    // BUILD sizes the hiding place by the parent's reach, which counts each piece at its anchor: anchored at far corners, it reaches the build's corners.
    const corner = Math.hypot(24 * T, 20 * T, 24 * T)
    expect(reachTicks(parent)).toBeGreaterThanOrEqual(Math.floor(corner))
    expect(fromPayload(JSON.parse(JSON.stringify(toPayload(parent))), parent.id)).not.toBeNull()
    // Every piece id is its own.
    expect(new Set(r.objects.map((o) => o.shard.id)).size).toBe(r.objects.length)
  })

  it('cuts into more pieces under a smaller budget, and MERGE SIMILAR draws fewer rectangles', async () => {
    const g = await readBlockFile('castle.schem', new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'castle.schem'))))
    const big = buildImport(g, { choices: DEFAULT_CHOICES, unit: 0, budget: BUDGET })
    const small = buildImport(g, { choices: { ...DEFAULT_CHOICES, mergeSimilar: true }, unit: 0, budget: 60_000 })
    expect(small.objects.every((o) => o.bytes <= 60_000)).toBe(true)
    const merged = buildImport(g, { choices: { ...DEFAULT_CHOICES, mergeSimilar: true }, unit: 0, budget: BUDGET })
    expect(merged.rects).toBeLessThan(big.rects / 2)
    expect(merged.objects.length).toBeLessThanOrEqual(big.objects.length)
  })

  it('scales by unit alone: 1, 2 or 4 gibsons a block, the same geometry', () => {
    const g = gridOf([2, 2, 2], () => 'minecraft:stone')
    const a = buildImport(g, { choices: DEFAULT_CHOICES, unit: 0, budget: BUDGET }).objects[0].shard
    const b = buildImport(g, { choices: DEFAULT_CHOICES, unit: 2, budget: BUDGET }).objects[0].shard
    expect(b.unit).toBe(2)
    expect(b.vertices).toEqual(a.vertices)
  })

  it('keeps every object within 4,096 units of its origin: a build too tall is refused, a long one is cut', () => {
    expect(() => buildImport(gridOf([1, 4100, 1], () => 'minecraft:stone'), { choices: DEFAULT_CHOICES, unit: 0, budget: BUDGET })).toThrow(/blocks tall/)
    const long = buildImport(gridOf([6000, 1, 1], (x) => (x % 2 ? 'minecraft:stone' : 'minecraft:glass')), { choices: DEFAULT_CHOICES, unit: 0, budget: BUDGET })
    expect(long.single).toBe(false)
    for (const o of long.objects) {
      expect(o.shard.extent).toBeLessThanOrEqual(4096)
      expect(o.at.every((n) => Math.abs(n) <= 4096 * T)).toBe(true)
    }
  })

  it('says so when nothing would be drawn', () => {
    const g = gridOf([1, 1, 1], () => 'minecraft:torch')
    expect(() => buildImport(g, { choices: DEFAULT_CHOICES, unit: 0, budget: BUDGET })).toThrow(/Turn on decorations/)
    expect(buildImport(g, { choices: { ...DEFAULT_CHOICES, showDecor: true }, unit: 0, budget: BUDGET }).objects).toHaveLength(1)
  })

  it('refuses a build that would need too many pieces, in words', () => {
    // Random colours on a large block: every face its own rectangle.
    let seed = 7
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const wools = ['white', 'black', 'red', 'blue', 'lime', 'yellow', 'cyan', 'pink']
    const g = gridOf([40, 40, 40], () => (rnd() < 0.3 ? `minecraft:${wools[Math.floor(rnd() * 8)]}_wool` : null))
    expect(() => buildImport(g, { choices: DEFAULT_CHOICES, unit: 0, budget: 4_000 })).toThrow(/more than 48 pieces/)
  })
})

function sub(a: number[], b: number[]): number[] { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function cross(a: number[], b: number[]): number[] { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function dot(a: number[], b: number[]): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
