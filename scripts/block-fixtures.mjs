#!/usr/bin/env node
/**
 * block-fixtures.mjs: writes the block importer's test files, a house and a
 * castle in each format it reads, built here block by block. Nothing is
 * downloaded and no one else's build is used: every file in
 * src/lib/blocks/__tests__/fixtures/ comes from this script.
 *
 *   node scripts/block-fixtures.mjs
 *
 * | File | What it tests |
 * |---|---|
 * | house.schem (Sponge v2), house-v3.schem (Sponge v3) | both Sponge layouts, varints, a palette in any order |
 * | castle.schem (Sponge v2) | a build too big for one hidden object, cut into pieces |
 * | house.litematic | one region, 5-bit indices that span two longs |
 * | castle.litematic | two regions, one with a negative size, indices spanning longs |
 * | house.nbt, castle.nbt | structure files: a block list, air listed and not |
 *
 * The same builds go in every format, so a test can compare what each reads.
 * Deterministic: the castle's stone texture comes from a fixed seed.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { write, Int16, Int32 } from 'nbtify'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, '..', 'src', 'lib', 'blocks', '__tests__', 'fixtures')
const DATA_VERSION = 3465

/** A build: size, and a map from "x,y,z" to a block state string. */
class Build {
  constructor(sx, sy, sz) { this.size = [sx, sy, sz]; this.blocks = new Map() }
  set(x, y, z, state) {
    if (x < 0 || y < 0 || z < 0 || x >= this.size[0] || y >= this.size[1] || z >= this.size[2]) return
    if (state === null) this.blocks.delete(`${x},${y},${z}`)
    else this.blocks.set(`${x},${y},${z}`, state)
  }
  get(x, y, z) { return this.blocks.get(`${x},${y},${z}`) ?? 'minecraft:air' }
  fill(x0, y0, z0, x1, y1, z1, state) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, typeof state === 'function' ? state(x, y, z) : state) }
  /** Walls of a box, one block thick, floor and roof left open. */
  ring(x0, y0, z0, x1, y1, z1, state) { for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (x === x0 || x === x1 || z === z0 || z === z1) this.set(x, y, z, typeof state === 'function' ? state(x, y, z) : state) }
}

/** A small seeded random, so the castle is the same every run. */
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** A cottage: stone footing, plank walls with log corners, glass windows, a door, a stair roof, a fence, a torch inside, a carpet. */
function house() {
  const b = new Build(11, 9, 9)
  b.fill(0, 0, 0, 10, 0, 8, 'minecraft:cobblestone')
  b.ring(0, 1, 0, 10, 4, 8, (x, y, z) => ((x === 0 || x === 10) && (z === 0 || z === 8) ? 'minecraft:oak_log[axis=y]' : 'minecraft:oak_planks'))
  for (const x of [3, 7]) b.set(x, 2, 0, 'minecraft:glass')
  for (const x of [3, 7]) b.set(x, 2, 8, 'minecraft:glass_pane[east=true,north=false,south=false,west=true]')
  b.set(5, 1, 0, 'minecraft:oak_door[facing=north,half=lower,hinge=left,open=false,powered=false]')
  b.set(5, 2, 0, 'minecraft:oak_door[facing=north,half=upper,hinge=left,open=false,powered=false]')
  // A roof of stairs from both long sides, a ridge of slabs.
  for (let i = 0; i < 4; i++) {
    for (let x = 0; x <= 10; x++) {
      b.set(x, 5 + i, i, 'minecraft:spruce_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]')
      b.set(x, 5 + i, 8 - i, 'minecraft:spruce_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]')
    }
  }
  for (let x = 0; x <= 10; x++) b.set(x, 8, 4, 'minecraft:spruce_slab[type=bottom,waterlogged=false]')
  b.fill(1, 1, 1, 9, 1, 7, 'minecraft:red_carpet')
  b.set(5, 2, 6, 'minecraft:wall_torch[facing=north]')
  b.set(1, 1, 7, 'minecraft:crafting_table')
  // Outside the back wall: a fence, a bush, a flower and a path of slabs (enough kinds of block for 5-bit indices).
  b.set(2, 0, 8, 'minecraft:oak_fence[east=true,north=false,south=false,waterlogged=false,west=false]')
  b.set(8, 1, 8, 'minecraft:oak_leaves[distance=1,persistent=true,waterlogged=false]')
  b.set(9, 1, 8, 'minecraft:poppy')
  b.set(4, 0, 0, 'minecraft:stone_brick_slab[type=top,waterlogged=false]')
  return b
}

/** A castle: textured stone walls with battlements, four towers, a keep with windows, a pond in the yard, stairs up the wall. */
function castle(side = 48, height = 20) {
  const b = new Build(side, height, side)
  const r = rng(0x5eed)
  const stone = () => { const v = r(); return v < 0.45 ? 'minecraft:stone_bricks' : v < 0.7 ? 'minecraft:cobblestone' : v < 0.85 ? 'minecraft:andesite' : v < 0.95 ? 'minecraft:mossy_stone_bricks' : 'minecraft:cracked_stone_bricks' }
  const s = side - 1
  b.fill(0, 0, 0, s, 0, s, 'minecraft:grass_block[snowy=false]')
  // Curtain walls, two thick, 10 high, with battlements.
  b.ring(0, 1, 0, s, 10, s, stone)
  b.ring(1, 1, 1, s - 1, 10, s - 1, stone)
  for (let i = 0; i <= s; i += 2) for (const [x, z] of [[i, 0], [i, s], [0, i], [s, i]]) b.set(x, 11, z, stone())
  // Four towers, hollow, 16 high, with walls on top.
  for (const [tx, tz] of [[0, 0], [s - 7, 0], [0, s - 7], [s - 7, s - 7]]) {
    b.ring(tx, 1, tz, tx + 7, 16, tz + 7, stone)
    b.fill(tx + 1, 1, tz + 1, tx + 6, 15, tz + 6, null)
    b.fill(tx + 1, 8, tz + 1, tx + 6, 8, tz + 6, 'minecraft:spruce_planks')
    b.ring(tx, 17, tz, tx + 7, 17, tz + 7, 'minecraft:cobblestone_wall[east=low,north=low,south=low,up=true,waterlogged=false,west=low]')
    for (const y of [5, 12]) { b.set(tx + 3, y, tz, 'minecraft:glass_pane[east=true,west=true]'); b.set(tx + 4, y, tz, 'minecraft:glass_pane[east=true,west=true]') }
  }
  // A gate.
  const mid = Math.floor(side / 2)
  b.fill(mid - 2, 1, 0, mid + 1, 5, 1, null)
  b.fill(mid - 2, 1, 0, mid + 1, 1, 0, 'minecraft:oak_trapdoor[facing=north,half=bottom,open=true]')
  // The keep: 14 across, 16 high, a floor of quartz, windows of glass, a slab roof.
  const k0 = mid - 7, k1 = mid + 6
  b.ring(k0, 1, k0, k1, 15, k1, stone)
  b.fill(k0 + 1, 1, k0 + 1, k1 - 1, 1, k1 - 1, 'minecraft:smooth_quartz')
  b.fill(k0, 16, k0, k1, 16, k1, 'minecraft:stone_brick_slab[type=bottom]')
  for (let y = 4; y <= 12; y += 4) for (let i = k0 + 2; i <= k1 - 2; i += 3) { b.set(i, y, k0, 'minecraft:light_blue_stained_glass'); b.set(i, y, k1, 'minecraft:light_blue_stained_glass') }
  // A pond in the yard, and torches around it.
  b.fill(6, 0, mid + 9, 12, 0, mid + 14, 'minecraft:water[level=0]')
  for (const [x, z] of [[5, mid + 8], [13, mid + 8], [5, mid + 15], [13, mid + 15]]) b.set(x, 1, z, 'minecraft:torch')
  // Stairs up the inside of the east wall.
  for (let i = 0; i < 9; i++) b.set(s - 2, 1 + i, 10 + i, 'minecraft:stone_brick_stairs[facing=south,half=bottom,shape=straight]')
  // Banners of colour: wool stripes on the keep.
  for (let y = 2; y <= 14; y++) b.set(mid, y, k0 - 0, y % 2 ? 'minecraft:red_wool' : 'minecraft:yellow_wool')
  return b
}

/** The palette of a build, air first, in the order states are first met, and the index of every cell (x fastest, then z, then y). */
function indexed(b) {
  const palette = ['minecraft:air']
  const at = new Map([['minecraft:air', 0]])
  const [sx, sy, sz] = b.size
  const cells = new Uint32Array(sx * sy * sz)
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const s = b.get(x, y, z)
    let i = at.get(s)
    if (i === undefined) { i = palette.length; palette.push(s); at.set(s, i) }
    cells[x + sx * (z + sz * y)] = i
  }
  return { palette, cells }
}

const varints = (cells) => {
  const out = []
  for (const v of cells) { let n = v; while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n >>>= 7 } out.push(n) }
  return Int8Array.from(out.map((n) => (n << 24) >> 24))
}

/** A state string as Litematica's and the structure format's {Name, Properties}. */
function stateTag(s) {
  const open = s.indexOf('[')
  if (open < 0) return { Name: s }
  const Properties = {}
  for (const pair of s.slice(open + 1, -1).split(',')) { const [k, v] = pair.split('='); Properties[k] = v }
  return { Name: s.slice(0, open), Properties }
}

async function nbt(root, rootName) {
  return gzipSync(await write(root, { rootName, endian: 'big', compression: null, bedrockLevel: false }))
}

/** Sponge v2, with the palette written in reverse so a reader cannot lean on its order. */
async function spongeV2(b, name) {
  const { palette, cells } = indexed(b)
  const Palette = {}
  for (let i = palette.length - 1; i >= 0; i--) Palette[palette[i]] = new Int32(i)
  return nbt({
    Version: new Int32(2), DataVersion: new Int32(DATA_VERSION),
    Metadata: { Name: name, Author: 'ONOSENDAI test fixture' },
    Width: new Int16(b.size[0]), Height: new Int16(b.size[1]), Length: new Int16(b.size[2]),
    Offset: Int32Array.from([0, 0, 0]), PaletteMax: new Int32(palette.length),
    Palette, BlockData: varints(cells), BlockEntities: [],
  }, 'Schematic')
}

async function spongeV3(b, name) {
  const { palette, cells } = indexed(b)
  const Palette = {}
  palette.forEach((s, i) => { Palette[s] = new Int32(i) })
  return nbt({
    Schematic: {
      Version: new Int32(3), DataVersion: new Int32(DATA_VERSION),
      Metadata: { Name: name },
      Width: new Int16(b.size[0]), Height: new Int16(b.size[1]), Length: new Int16(b.size[2]),
      Offset: Int32Array.from([0, 0, 0]),
      Blocks: { Palette, Data: varints(cells), BlockEntities: [] },
    },
  }, '')
}

/** Litematica's packing: `bits` per entry, low bit first, entries allowed to run on into the next long. */
function packSpanning(values, bits) {
  const longs = new BigInt64Array(Math.ceil((values.length * bits) / 64))
  const u = new BigUint64Array(longs.buffer)
  values.forEach((v, i) => {
    const start = i * bits
    const li = Math.floor(start / 64), off = start % 64
    u[li] |= (BigInt(v) << BigInt(off)) & 0xffffffffffffffffn
    if (off + bits > 64) u[li + 1] |= BigInt(v) >> BigInt(64 - off)
  })
  return longs
}

/** One Litematica region: the cells of `b` inside [min, min + size), written with a negative size when `negative`. */
function region(b, min, size, negative) {
  const palette = ['minecraft:air']
  const at = new Map([['minecraft:air', 0]])
  const values = []
  for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) {
    const s = b.get(min[0] + x, min[1] + y, min[2] + z)
    let i = at.get(s)
    if (i === undefined) { i = palette.length; palette.push(s); at.set(s, i) }
    values.push(i)
  }
  const bits = Math.max(2, Math.ceil(Math.log2(palette.length)))
  // A negative size runs back from the position: the box's far corner is the position.
  const pos = negative ? min.map((n, a) => n + size[a] - 1) : min
  const sz = negative ? size.map((n) => -n) : size
  return {
    Position: { x: new Int32(pos[0]), y: new Int32(pos[1]), z: new Int32(pos[2]) },
    Size: { x: new Int32(sz[0]), y: new Int32(sz[1]), z: new Int32(sz[2]) },
    BlockStatePalette: palette.map(stateTag),
    BlockStates: packSpanning(values, bits),
    TileEntities: [], Entities: [], PendingBlockTicks: [], PendingFluidTicks: [],
    bits,
  }
}

async function litematic(b, name, regions) {
  const Regions = {}
  let total = 0
  for (const [rname, min, size, negative] of regions) {
    const r = region(b, min, size, negative)
    delete r.bits
    Regions[rname] = r
    total += size[0] * size[1] * size[2]
  }
  return nbt({
    Version: new Int32(6), MinecraftDataVersion: new Int32(DATA_VERSION),
    Metadata: {
      Name: name, Author: 'ONOSENDAI test fixture', Description: '', RegionCount: new Int32(regions.length),
      TotalVolume: new Int32(total), TotalBlocks: new Int32(b.blocks.size), TimeCreated: 0n, TimeModified: 0n,
      EnclosingSize: { x: new Int32(b.size[0]), y: new Int32(b.size[1]), z: new Int32(b.size[2]) },
    },
    Regions,
  }, '')
}

/** A structure file: every non-air block listed, and a few air blocks too, as the game writes them. */
async function structure(b) {
  const { palette, cells } = indexed(b)
  const blocks = []
  const [sx, sy, sz] = b.size
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = cells[x + sx * (z + sz * y)]
    if (i !== 0 || (x + y + z) % 7 === 0) blocks.push({ state: new Int32(i), pos: [new Int32(x), new Int32(y), new Int32(z)] })
  }
  return nbt({
    DataVersion: new Int32(DATA_VERSION),
    size: [new Int32(sx), new Int32(sy), new Int32(sz)],
    palette: palette.map(stateTag),
    blocks,
    entities: [],
  }, '')
}

await mkdir(OUT, { recursive: true })
const h = house()
const c = castle()
const files = {
  'house.schem': await spongeV2(h, 'Cottage'),
  'house-v3.schem': await spongeV3(h, 'Cottage'),
  'castle.schem': await spongeV2(c, 'Castle'),
  'house.litematic': await litematic(h, 'Cottage', [['Cottage', [0, 0, 0], h.size, false]]),
  // Two regions, the north half written with a negative size; together they cover the castle.
  'castle.litematic': await litematic(c, 'Castle', [['North half', [0, 0, 0], [48, 20, 24], true], ['South half', [0, 0, 24], [48, 20, 24], false]]),
  'house.nbt': await structure(h),
  'castle.nbt': await structure(c),
}
for (const [name, bytes] of Object.entries(files)) {
  await writeFile(join(OUT, name), bytes)
  console.log(`${name}: ${bytes.length} bytes`)
}
// What a test compares against: each build's blocks, by state.
const census = (b) => { const out = {}; for (const s of b.blocks.values()) out[s] = (out[s] ?? 0) + 1; return { size: b.size, blocks: b.blocks.size, states: out } }
await writeFile(join(OUT, 'census.json'), JSON.stringify({ house: census(h), castle: census(c) }, null, 1) + '\n')
console.log('census.json')
