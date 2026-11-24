/**
 * formats.ts: the three block formats people share, read from an NBT tree
 * (lib/blocks/nbtRead.ts) into one BlockGrid (lib/blocks/blockGrid.ts).
 *
 * | Format | How the cells are written |
 * |---|---|
 * | Sponge `.schem` v1 and v2 | `Width`, `Height`, `Length` (unsigned shorts), `Palette` {state: index}, `BlockData` as varints, x + z*W + y*W*L |
 * | Sponge `.schem` v3 | the same under `Schematic`, with `Palette` and `Data` under `Blocks` |
 * | Litematica `.litematic` | named `Regions`, each with `Position`, `Size` (either may be negative), its own `BlockStatePalette` and `BlockStates`, indices packed into longs at max(2, bits) bits, an index allowed to span two longs |
 * | Structure `.nbt` | `size`, `palette` (or the first of `palettes`), and `blocks`, a list of {state, pos}; cells not listed are empty |
 *
 * Entities, block entities, biomes and every other piece of block data are
 * read past: they are not geometry.
 *
 * Each reader checks what the file says against what is there, and every
 * loop runs on the import's clock, so a hostile file fails with a sentence.
 */

import { BlockImportError, MAX_CELLS, MAX_PALETTE, MAX_REGIONS, isEmptyState, normalizeState, type BlockFormat, type BlockGrid, type BlockRegion, type V3 } from './blockGrid'

/** A checkpoint called in every loop: throws once the import's time is up. */
export type Clock = () => void
const noClock: Clock = () => undefined

type Compound = Record<string, unknown>

const isCompound = (v: unknown): v is Compound => !!v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)
/** An NBT number (NBTify wraps bytes, shorts and ints in Number objects) as a plain number, or NaN. */
const num = (v: unknown): number => (typeof v === 'number' || v instanceof Number ? Number(v) : typeof v === 'bigint' ? Number(v) : NaN)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : v instanceof String ? String(v) : null)

/** Which format an NBT root is, or null. */
export function detectBlockFormat(root: Compound): BlockFormat | null {
  if (isCompound(root.Regions) && (isCompound(root.Metadata) || 'Version' in root)) return 'litematic'
  if (isCompound(root.Schematic) && isCompound((root.Schematic as Compound).Blocks)) return 'schem'
  if ('Width' in root && 'Height' in root && 'Length' in root) return 'schem'
  if (Array.isArray(root.size) && Array.isArray(root.blocks) && (Array.isArray(root.palette) || Array.isArray(root.palettes))) return 'structure'
  return null
}

/** The build in an NBT root, or a BlockImportError saying why not. */
export function decodeGrid(root: Compound, fileName: string, clock: Clock = noClock): BlockGrid {
  const format = detectBlockFormat(root)
  const fallback = fileName.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '') || 'Imported build'
  switch (format) {
    case 'schem': return readSponge(root, fallback, clock)
    case 'litematic': return readLitematic(root, fallback, clock)
    case 'structure': return readStructure(root, fallback, clock)
    default: throw new BlockImportError('That file is not a .schem, .litematic or .nbt build import knows.')
  }
}

/** Sizes checked: whole, at least 1 each, and the cells within MAX_CELLS together with `already`. */
function checkSize(size: V3, already = 0): void {
  if (!size.every((n) => Number.isInteger(n) && n >= 1)) throw new BlockImportError('That build says it has no size.')
  const cells = size[0] * size[1] * size[2]
  if (cells + already > MAX_CELLS) throw new BlockImportError(`That build spans ${(cells + already).toLocaleString('en-US')} cells. Import reads up to ${MAX_CELLS.toLocaleString('en-US')}: save a smaller part of it.`)
}

/** A palette under construction: each normalized state once, air always at 0. */
class PaletteBuilder {
  readonly states: string[] = ['minecraft:air']
  private readonly index = new Map<string, number>([['minecraft:air', 0]])
  add(state: string): number {
    if (isEmptyState(state)) return 0
    const got = this.index.get(state)
    if (got !== undefined) return got
    if (this.states.length >= MAX_PALETTE) throw new BlockImportError('That build has more kinds of block than import reads.')
    this.index.set(state, this.states.length)
    this.states.push(state)
    return this.states.length - 1
  }
}

/** A {Name, Properties} compound as a normalized state. */
function stateOf(entry: unknown): string {
  if (!isCompound(entry)) throw new BlockImportError('That build has a palette entry that is not a block.')
  const name = str(entry.Name)
  if (!name) throw new BlockImportError('That build has a palette entry with no name.')
  const props: Record<string, string> = {}
  if (isCompound(entry.Properties)) for (const [k, v] of Object.entries(entry.Properties)) { const s = str(v); if (s !== null) props[k] = s }
  return normalizeState(name, props)
}

// ---------------------------------------------------------------- Sponge

function readSponge(top: Compound, fallback: string, clock: Clock): BlockGrid {
  // v3 nests the schematic in a compound of its own name, and the blocks in `Blocks`.
  const v3 = isCompound(top.Schematic) ? (top.Schematic as Compound) : null
  const root = v3 ?? top
  const blocks = v3 && isCompound(v3.Blocks) ? (v3.Blocks as Compound) : root
  // Width, Height and Length are unsigned shorts; NBT has only signed ones.
  const size: V3 = [num(root.Width) & 0xffff, num(root.Height) & 0xffff, num(root.Length) & 0xffff]
  checkSize(size)
  const palette = blocks.Palette
  const data = v3 ? blocks.Data : root.BlockData
  if (!isCompound(palette)) throw new BlockImportError('That .schem file has no palette.')
  if (!(data instanceof Int8Array || data instanceof Uint8Array)) throw new BlockImportError('That .schem file has no block data.')
  const builder = new PaletteBuilder()
  const remap = new Map<number, number>()
  for (const [state, id] of Object.entries(palette)) {
    clock()
    const n = num(id)
    if (!Number.isInteger(n) || n < 0) throw new BlockImportError('That .schem file has a palette index that is not a number.')
    remap.set(n, builder.add(normalizeState(state)))
  }
  const cells = new Uint16Array(size[0] * size[1] * size[2])
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  let at = 0
  for (let i = 0; i < cells.length; i++) {
    clock()
    // A varint: seven bits a byte, low first, the top bit saying another follows.
    let value = 0, shift = 0, b: number
    do {
      if (at >= bytes.length) throw new BlockImportError('That .schem file is cut short: it has fewer blocks than its size says.')
      b = bytes[at++]
      value |= (b & 0x7f) << shift
      shift += 7
      if (shift > 28) throw new BlockImportError('That .schem file has block data import cannot read.')
    } while (b & 0x80)
    const mapped = remap.get(value)
    if (mapped === undefined) throw new BlockImportError('That .schem file names a block its palette does not have.')
    cells[i] = mapped
  }
  const meta = isCompound(root.Metadata) ? (root.Metadata as Compound) : null
  const name = str(meta?.Name)?.trim() || fallback
  return { format: 'schem', name, palette: builder.states, regions: [{ name: 'Main', origin: [0, 0, 0], size, cells }] }
}

// ---------------------------------------------------------------- Litematica

/** Whether this platform lays typed arrays out little-endian (every browser that matters does). */
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

/**
 * Litematica's packed indices, unpacked: `count` entries of `bits` bits each,
 * read as one bit stream through the longs, low bit first. Unlike the game's
 * own chunk format, an entry may start in one long and end in the next, so
 * the stream is read as 32-bit words and an entry may take bits from two.
 */
export function unpackSpanning(longs: BigInt64Array, bits: number, count: number, clock: Clock = noClock): Uint32Array {
  if (bits < 1 || bits > 31) throw new BlockImportError('That .litematic file packs its blocks in a way import cannot read.')
  if (longs.length * 64 < count * bits) throw new BlockImportError('That .litematic file is cut short: it has fewer blocks than its size says.')
  let words: Uint32Array
  if (LITTLE) words = new Uint32Array(longs.buffer, longs.byteOffset, longs.length * 2)
  else {
    words = new Uint32Array(longs.length * 2)
    for (let k = 0; k < longs.length; k++) { const u = BigInt.asUintN(64, longs[k]); words[2 * k] = Number(u & 0xffffffffn); words[2 * k + 1] = Number(u >> 32n) }
  }
  const mask = (1 << bits) - 1
  const out = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    clock()
    const bit = i * bits
    const w = bit >>> 5
    const off = bit & 31
    let v = words[w] >>> off
    if (off + bits > 32) v |= words[w + 1] << (32 - off)
    out[i] = v & mask
  }
  return out
}

function readLitematic(root: Compound, fallback: string, clock: Clock): BlockGrid {
  const regions = root.Regions as Compound
  const entries = Object.entries(regions).filter(([, r]) => isCompound(r))
  if (entries.length === 0) throw new BlockImportError('That .litematic file has no regions.')
  if (entries.length > MAX_REGIONS) throw new BlockImportError(`That .litematic file has ${entries.length} regions. Import reads up to ${MAX_REGIONS}.`)
  const builder = new PaletteBuilder()
  const out: BlockRegion[] = []
  let cellsSoFar = 0
  for (const [regionName, raw] of entries) {
    const r = raw as Compound
    const pos = isCompound(r.Position) ? (r.Position as Compound) : {}
    const sz = isCompound(r.Size) ? (r.Size as Compound) : {}
    const p: V3 = [num(pos.x), num(pos.y), num(pos.z)]
    const s: V3 = [num(sz.x), num(sz.y), num(sz.z)]
    if (![...p, ...s].every(Number.isInteger) || s.some((n) => n === 0)) throw new BlockImportError(`The region "${regionName}" in that .litematic file has no size.`)
    // A negative size runs the other way from its position: the box starts size + 1 below it.
    const size = s.map(Math.abs) as V3
    const origin = p.map((n, a) => (s[a] < 0 ? n + s[a] + 1 : n)) as V3
    checkSize(size, cellsSoFar)
    const count = size[0] * size[1] * size[2]
    cellsSoFar += count
    const pal = r.BlockStatePalette
    if (!Array.isArray(pal) || pal.length === 0) throw new BlockImportError(`The region "${regionName}" in that .litematic file has no palette.`)
    if (pal.length > MAX_PALETTE) throw new BlockImportError('That build has more kinds of block than import reads.')
    const local = pal.map((e) => { clock(); return builder.add(stateOf(e)) })
    const cells = new Uint16Array(count)
    const states = r.BlockStates
    if (states instanceof BigInt64Array || states instanceof BigUint64Array) {
      const bits = Math.max(2, Math.ceil(Math.log2(pal.length)))
      const longs = states instanceof BigInt64Array ? states : new BigInt64Array(states.buffer, states.byteOffset, states.length)
      const idx = unpackSpanning(longs, bits, count, clock)
      for (let i = 0; i < count; i++) {
        const v = idx[i]
        if (v >= local.length) throw new BlockImportError('That .litematic file names a block its palette does not have.')
        cells[i] = local[v]
      }
    } else if (pal.length > 1) {
      throw new BlockImportError(`The region "${regionName}" in that .litematic file has no block data.`)
    } else if (local[0]) {
      // One kind of block and no data: every cell is that block.
      cells.fill(local[0])
    }
    out.push({ name: regionName, origin, size, cells })
  }
  // Moved so the lowest corner of everything is at 0, 0, 0.
  const min = [0, 1, 2].map((a) => Math.min(...out.map((r) => r.origin[a])))
  for (const r of out) r.origin = r.origin.map((n, a) => n - min[a]) as V3
  const meta = isCompound(root.Metadata) ? (root.Metadata as Compound) : null
  const name = str(meta?.Name)?.trim() || fallback
  return { format: 'litematic', name, palette: builder.states, regions: out }
}

// ---------------------------------------------------------------- Structure

function readStructure(root: Compound, fallback: string, clock: Clock): BlockGrid {
  const sizeList = root.size as unknown[]
  const size = sizeList.map(num) as V3
  if (sizeList.length !== 3) throw new BlockImportError('That .nbt structure has no size.')
  checkSize(size)
  // Several palettes are variants of one structure (a shipwreck's woods); the first is read.
  const pal = Array.isArray(root.palette) ? root.palette : Array.isArray(root.palettes) && Array.isArray((root.palettes as unknown[])[0]) ? (root.palettes as unknown[][])[0] : null
  if (!pal || pal.length === 0) throw new BlockImportError('That .nbt structure has no palette.')
  if (pal.length > MAX_PALETTE) throw new BlockImportError('That build has more kinds of block than import reads.')
  const builder = new PaletteBuilder()
  const local = pal.map((e) => { clock(); return builder.add(stateOf(e)) })
  const cells = new Uint16Array(size[0] * size[1] * size[2])
  for (const b of root.blocks as unknown[]) {
    clock()
    if (!isCompound(b) || !Array.isArray(b.pos) || b.pos.length !== 3) throw new BlockImportError('That .nbt structure has a block with no place.')
    const [x, y, z] = (b.pos as unknown[]).map(num)
    const state = num(b.state)
    if (!Number.isInteger(state) || state < 0 || state >= local.length) throw new BlockImportError('That .nbt structure names a block its palette does not have.')
    if (!(x >= 0 && y >= 0 && z >= 0 && x < size[0] && y < size[1] && z < size[2]) || ![x, y, z].every(Number.isInteger)) throw new BlockImportError('That .nbt structure has a block outside its size.')
    cells[x + size[0] * (z + size[2] * y)] = local[state]
  }
  return { format: 'structure', name: fallback, palette: builder.states, regions: [{ name: 'Main', origin: [0, 0, 0], size, cells }] }
}
