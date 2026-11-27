/**
 * arrangement.ts - what a smash takes, and whether it can be a blueprint
 * (DECK-0010 §4; the owner's rulings of 2026-11-26).
 *
 * The window is the hit's minus 8 to plus 7 on each axis: 16 cells, the hit
 * at offset 8. The group is every occupied cell reachable from the hit
 * through faces, edges or corners without leaving the window, placed or
 * natural ground alike; the smash takes all of it and nothing else. The group
 * is isolated when every other cell of its box grown by one is empty (the
 * grown box may reach one cell past the window, and those are read too): a
 * block that touches it, one that sits in a notch, or a build the window cut
 * all leave it not isolated. Only an isolated group is an arrangement, with a
 * key and a lookup. A build of 8 cells or fewer on every axis comes away
 * whole wherever it is hit; one of 16 only when hit in its ninth cell.
 *
 * Cells are cyberspace offsets (any integer frame whose axes are
 * cyberspace's); `read` gives the block id at one, 0 for open space.
 */

import { WINDOW_ABOVE, WINDOW_BELOW, MAX_SIDE, cellIndex, type Arrangement } from './format'

export type Cell = readonly [number, number, number]

/** What one smash takes. */
export interface Gathered {
  /** Every cell smashed, in the read frame. */
  cells: Array<[number, number, number]>
  /** The group's box: its low corner in the read frame and its size. */
  lo: [number, number, number]
  size: [number, number, number]
  /** Nothing else in the box grown by one: an arrangement, with a key. */
  isolated: boolean
  /** The arrangement in its box when isolated, else null. */
  arrangement: Arrangement | null
}

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`

function boxOf(cells: ReadonlyArray<Cell>): { lo: [number, number, number]; size: [number, number, number] } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const c of cells) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c[a]); hi[a] = Math.max(hi[a], c[a]) }
  return { lo, size: [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1] }
}

/** How far a smash reaches from the hit on each axis: the spec's window by default, smaller for a bare hand (smash.ts BARE_REACH). */
export interface Reach { below: number; above: number }

/** What a smash at `hit` takes (the hit cell must hold a block), and whether it is an isolated arrangement. */
export function gather(read: (x: number, y: number, z: number) => number, hit: Cell, reach: Reach = { below: WINDOW_BELOW, above: WINDOW_ABOVE }): Gathered {
  if (read(hit[0], hit[1], hit[2]) === 0) return { cells: [], lo: [hit[0], hit[1], hit[2]], size: [0, 0, 0], isolated: false, arrangement: null }
  const below = reach.below, above = reach.above
  const inWindow = (x: number, y: number, z: number): boolean =>
    x >= hit[0] - below && x <= hit[0] + above && y >= hit[1] - below && y <= hit[1] + above && z >= hit[2] - below && z <= hit[2] + above
  const seen = new Set<string>([key(...hit)])
  const cells: Array<[number, number, number]> = [[hit[0], hit[1], hit[2]]]
  for (let i = 0; i < cells.length; i++) {
    const [x, y, z] = cells[i]
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy && !dz) continue
      const nx = x + dx, ny = y + dy, nz = z + dz
      const k = key(nx, ny, nz)
      if (seen.has(k) || !inWindow(nx, ny, nz)) continue
      seen.add(k)
      if (read(nx, ny, nz) !== 0) cells.push([nx, ny, nz])
    }
  }
  const { lo, size } = boxOf(cells)
  // Isolated: the box grown by one holds nothing but the group.
  for (let y = lo[1] - 1; y <= lo[1] + size[1]; y++) for (let z = lo[2] - 1; z <= lo[2] + size[2]; z++) for (let x = lo[0] - 1; x <= lo[0] + size[0]; x++) {
    // Every occupied cell seen was taken into the group, so an occupied cell not seen is someone else's.
    if (read(x, y, z) !== 0 && !seen.has(key(x, y, z))) return { cells, lo, size, isolated: false, arrangement: null }
  }
  return { cells, lo, size, isolated: true, arrangement: arrangementOf(read, cells, lo, size) }
}

/** The arrangement of a group in its box: the group's own blocks, every other cell empty. */
export function arrangementOf(read: (x: number, y: number, z: number) => number, cells: ReadonlyArray<Cell>, lo: Cell, size: readonly [number, number, number]): Arrangement {
  const out = new Uint16Array(size[0] * size[1] * size[2])
  for (const c of cells) out[cellIndex(size, c[0] - lo[0], c[1] - lo[1], c[2] - lo[2])] = read(c[0], c[1], c[2])
  return { size: [size[0], size[1], size[2]], cells: out }
}

/** An arrangement from a list of blocks at offsets (any frame): boxed tight, in scan order. */
export function arrangementFrom(blocks: ReadonlyArray<{ at: Cell; id: number }>): Arrangement | null {
  const filled = blocks.filter((b) => b.id > 0)
  if (filled.length === 0) return null
  const { lo, size } = boxOf(filled.map((b) => b.at))
  if (!size.every((n) => n <= MAX_SIDE)) return null
  const out = new Uint16Array(size[0] * size[1] * size[2])
  for (const b of filled) out[cellIndex(size, b.at[0] - lo[0], b.at[1] - lo[1], b.at[2] - lo[2])] = b.id
  return { size, cells: out }
}

/** How many blocks an arrangement holds. */
export function blockCount(a: Arrangement): number {
  let n = 0
  for (const id of a.cells) if (id) n++
  return n
}

/** Whether an arrangement's blocks are one group through faces, edges and corners: a smash takes it whole only then (DECK-0010 §5.4 check 8). */
export function connected(a: Arrangement): boolean {
  const occ: number[] = []
  a.cells.forEach((id, i) => { if (id) occ.push(i) })
  if (!occ.length) return false
  const [sx, sy, sz] = a.size
  const seen = new Set<number>([occ[0]])
  const q = [occ[0]]
  for (let n = 0; n < q.length; n++) {
    const i = q[n]
    const x = i % sx, rest = Math.floor(i / sx), z = rest % sz, y = Math.floor(rest / sz)
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, nz = z + dz
      if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue
      const j = cellIndex(a.size, nx, ny, nz)
      if (a.cells[j] && !seen.has(j)) { seen.add(j); q.push(j) }
    }
  }
  return seen.size === occ.length
}
