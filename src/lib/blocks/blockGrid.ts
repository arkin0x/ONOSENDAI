/**
 * blockGrid.ts: a block build as the importer holds it once a file is read,
 * whatever format it came in (lib/blocks/formats.ts reads .schem, .litematic
 * and structure .nbt into this).
 *
 * A build is one or more regions (a Litematica file can hold several; the
 * other formats hold one), each a box of cells. A cell is an index into the
 * build's palette of block states, one palette for the whole build, so a
 * colour chosen for a block applies everywhere it appears. Index 0 is always
 * empty air. Cells run x fastest, then z, then y (y is up), the order Sponge
 * and Litematica both use.
 *
 * Nothing here knows any game's blocks: a state is a string from the person's
 * file, and lib/blocks/colourTable.ts decides what it becomes.
 *
 * Pure.
 */

export type BlockFormat = 'schem' | 'litematic' | 'structure'

/** What the person sees the format called. */
export const FORMAT_LABEL: Readonly<Record<BlockFormat, string>> = {
  schem: 'Sponge schematic (.schem)',
  litematic: 'Litematica (.litematic)',
  structure: 'Structure file (.nbt)',
}

export type V3 = [number, number, number]

export interface BlockRegion {
  /** The region's name in the file ("Main" for formats that hold one). */
  name: string
  /** Where its lowest corner stands in the build, in blocks. */
  origin: V3
  /** Its size in blocks, each at least 1. */
  size: V3
  /** One palette index per cell, x fastest, then z, then y. 0 is empty. */
  cells: Uint16Array
}

export interface BlockGrid {
  format: BlockFormat
  /** The build's name: from the file when it carries one, else the file's name. */
  name: string
  /** Block states as written in the file, normalized by normalizeState. Entry 0 is air. */
  palette: string[]
  regions: BlockRegion[]
}

/** The most cells a build may span, summed over its regions (two bytes each in memory). */
export const MAX_CELLS = 16 * 1024 * 1024
/** The most block states one palette may hold. */
export const MAX_PALETTE = 65_535
/** The most regions a Litematica file may have read. */
export const MAX_REGIONS = 64

/** A file the importer cannot read, with a sentence for the person who chose it. */
export class BlockImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockImportError'
  }
}

/** States that are nothing at all. Structure void marks cells a structure leaves as they were. */
const EMPTY = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:structure_void', 'air', 'cave_air', 'void_air', 'structure_void'])

/** Whether a normalized state is empty air. */
export function isEmptyState(state: string): boolean {
  return EMPTY.has(blockName(state))
}

/**
 * A state as one string: `namespace:name[key=value,...]` with the properties
 * sorted, since Sponge says their order is not fixed and two spellings of one
 * state must be one palette entry. A name without a namespace gets
 * `minecraft:`.
 */
export function normalizeState(name: string, props?: Record<string, string>): string {
  let base = name.trim().toLowerCase()
  let inline: Record<string, string> = {}
  const open = base.indexOf('[')
  if (open >= 0) {
    const body = base.slice(open + 1, base.endsWith(']') ? -1 : undefined)
    base = base.slice(0, open)
    for (const pair of body.split(',')) {
      const eq = pair.indexOf('=')
      if (eq > 0) inline[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
    }
  }
  if (!base.includes(':')) base = `minecraft:${base}`
  if (props) inline = { ...inline, ...Object.fromEntries(Object.entries(props).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()])) }
  const keys = Object.keys(inline).sort()
  return keys.length ? `${base}[${keys.map((k) => `${k}=${inline[k]}`).join(',')}]` : base
}

/** The block's name without its properties: `minecraft:oak_stairs`. */
export function blockName(state: string): string {
  const open = state.indexOf('[')
  return open >= 0 ? state.slice(0, open) : state
}

/** The name without its namespace, for matching: `oak_stairs`. */
export function shortName(state: string): string {
  const name = blockName(state)
  const colon = name.indexOf(':')
  return colon >= 0 ? name.slice(colon + 1) : name
}

/** A state's properties: `{ facing: 'north', half: 'bottom' }`. */
export function stateProps(state: string): Record<string, string> {
  const open = state.indexOf('[')
  if (open < 0) return {}
  const out: Record<string, string> = {}
  for (const pair of state.slice(open + 1, -1).split(',')) {
    const eq = pair.indexOf('=')
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return out
}

/** The box every region spans together: its lowest corner and its size, in blocks. */
export function gridBounds(grid: Pick<BlockGrid, 'regions'>, include?: ReadonlySet<number>): { min: V3; size: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity]
  const max: V3 = [-Infinity, -Infinity, -Infinity]
  grid.regions.forEach((r, i) => {
    if (include && !include.has(i)) return
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], r.origin[a])
      max[a] = Math.max(max[a], r.origin[a] + r.size[a])
    }
  })
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], size: [0, 0, 0] }
  return { min, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}

/** How many cells of each palette entry the build holds (over the regions included). */
export function stateCounts(grid: BlockGrid, include?: ReadonlySet<number>): Uint32Array {
  const counts = new Uint32Array(grid.palette.length)
  grid.regions.forEach((r, i) => {
    if (include && !include.has(i)) return
    const c = r.cells
    for (let k = 0; k < c.length; k++) counts[c[k]]++
  })
  counts[0] = 0
  return counts
}
