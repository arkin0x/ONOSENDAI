/**
 * arrangement.ts - what a smash takes, and whether it can be a blueprint
 * (DECK-0010 §4; the owner's rulings of 2026-11-26).
 *
 * A smash reaches n cells (16 with the Compiler, 3 bare: smash.ts). The group
 * is every occupied cell reachable from the hit through faces, edges or
 * corners, placed or natural ground alike, searched far enough that a build
 * of at most n on every axis is found whole wherever it is hit (owner,
 * 2026-11-27). It is isolated when it touches no other block on faces, edges
 * or corners (the owner's ruling; DECK-0010 §4.2 as cyberspace #129 words
 * it): the group is the whole 26-connected component. A block elsewhere in
 * its box grown by one that touches nothing does not count (the Compiler
 * repro, 2026-11-28: the old rule failed a T beside such a block). Ground
 * under it, or a block at an edge or corner, leaves it not isolated. Only an
 * isolated group of at most n on every axis is an arrangement, with a key and
 * a lookup; any other group is smashed with nothing compiled (gather).
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
  /** No block outside the group touches it on a face, edge or corner (it is its whole 26-connected component). */
  isolated: boolean
  /** The arrangement in its box when isolated, else null. */
  arrangement: Arrangement | null
}

function boxOf(cells: ReadonlyArray<Cell>): { lo: [number, number, number]; size: [number, number, number] } {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const c of cells) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c[a]); hi[a] = Math.max(hi[a], c[a]) }
  return { lo, size: [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1] }
}

/**
 * What a smash at `hit` takes (the hit cell must hold a block), and whether it is an isolated arrangement, for a reach
 * of `n` cells (owner, 2026-11-27: "you shouldn't have to strike a specific block in your construction to compile it
 * properly. if the construction is correct, hitting any block should succeed"):
 *
 * 1. The group is flood-filled from the hit through faces, edges and corners within (2n - 1) cells on each axis
 *    centred on the hit, so a group at most n on every axis is found whole wherever it is hit.
 * 2. Isolated (no other block touches it on a face, edge or corner, so it is its whole 26-connected component) and at
 *    most n on every axis: a construction, with an arrangement, as if struck in its middle. A block the window's edge
 *    cut it off from counts as touching: the component goes on past what was looked at.
 * 3. Otherwise the group is smashed all the same, with nothing compiled: too long (isolated, but more than n on an
 *    axis), or touching something (not isolated). DECK-0010 §4 (9e806b1) and its gather vectors.
 */
export function gather(read: (x: number, y: number, z: number) => number, hit: Cell, n: number = WINDOW_BELOW + WINDOW_ABOVE + 1): Gathered {
  if (read(hit[0], hit[1], hit[2]) === 0) return { cells: [], lo: [hit[0], hit[1], hit[2]], size: [0, 0, 0], isolated: false, arrangement: null }
  const far = n - 1
  const group = flood(read, hit, far, far)
  const { lo, size } = boxOf(group.cells)
  // Inside the window every touching block joined the group, so it is isolated unless one touched it from past the edge.
  const isolated = !group.cut
  // An arrangement only when it is isolated and fits the reach on every axis.
  const arrangement = isolated && size.every((v) => v <= n) ? arrangementOf(read, group.cells, lo, size) : null
  return { cells: group.cells, lo, size, isolated, arrangement }
}

/**
 * What a smash deletes (the owner's ruling of 2026-11-27, "smash up to the box"; DECK-0010 leaves this to the
 * client): a construction (gather's arrangement) whole, wherever it was struck; anything else, only the connected
 * blocks inside the n by n by n box round the hit (hit - floor(n/2) to the rest above: hit - 8 to + 7 for 16, hit - 1
 * to + 1 for 3), so a smash never deletes more than n along any axis.
 */
/**
 * Whether the group at `hit` is isolated and at most `n` on every axis, as gather's `arrangement !== null` would say,
 * without making the arrangement and stopping as soon as the answer is no: once the group passes `n` on an axis, or a
 * block past the window touches it. For nearMiss.ts tooBigBare, which asks it with the Compiler's reach while a bare
 * hand digs, so a smash into the ground floods only until the group is longer than the reach, never the whole window.
 * `reads` counts the cells it read (tests).
 */
export function fitsIsolated(read: (x: number, y: number, z: number) => number, hit: Cell, n: number = WINDOW_BELOW + WINDOW_ABOVE + 1, reads?: { count: number }): boolean {
  if (read(hit[0], hit[1], hit[2]) === 0) return false
  return !flood(read, hit, n - 1, n - 1, n, reads).cut
}

export function smashCells(read: (x: number, y: number, z: number) => number, hit: Cell, n: number, g: Gathered): Array<[number, number, number]> {
  if (g.arrangement) return g.cells
  if (read(hit[0], hit[1], hit[2]) === 0) return []
  const below = Math.floor(n / 2), above = n - 1 - below
  return flood(read, hit, below, above).cells
}

/**
 * The occupied cells reachable from `hit` through faces, edges and corners, never more than `below` under or `above`
 * over it on any axis; `cut` when a block past the window's edge touches one of them (the component goes on past what
 * was looked at, so it is not isolated: gather). With `maxExtent` it stops at the first cut, or as soon as the cells
 * found pass `maxExtent` on an axis (also `cut`: it cannot be a construction of that reach), and its cells are then
 * only those found so far (fitsIsolated).
 */
function flood(read: (x: number, y: number, z: number) => number, hit: Cell, below: number, above: number, maxExtent = Infinity, reads?: { count: number }): { cells: Array<[number, number, number]>; cut: boolean } {
  // What was looked at, in a grid over the window (one byte a cell: 1 looked at, 2 in the group), not a set of strings:
  // the Compiler's window is 31 by 31 by 31, and the smash preview works it out each time the aim rests on a new block.
  // A reach under one looks at the struck block alone, as the set of strings did (review of #948: a reach of 0 threw).
  below = Math.max(0, below)
  above = Math.max(0, above)
  const w = below + above + 1
  const x0 = hit[0] - below, y0 = hit[1] - below, z0 = hit[2] - below
  const grid = new Uint8Array(w * w * w)
  const at = (x: number, y: number, z: number): number => ((x - x0) * w + (y - y0)) * w + (z - z0)
  const inside = (x: number, y: number, z: number): boolean =>
    x >= x0 && x <= hit[0] + above && y >= y0 && y <= hit[1] + above && z >= z0 && z <= hit[2] + above
  grid[at(hit[0], hit[1], hit[2])] = 2
  const cells: Array<[number, number, number]> = [[hit[0], hit[1], hit[2]]]
  let cut = false
  const bounded = maxExtent !== Infinity
  const lo = [hit[0], hit[1], hit[2]], hi = [hit[0], hit[1], hit[2]]
  const look = (x: number, y: number, z: number): number => { if (reads) reads.count++; return read(x, y, z) }
  for (let i = 0; i < cells.length; i++) {
    const [x, y, z] = cells[i]
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy && !dz) continue
      const nx = x + dx, ny = y + dy, nz = z + dz
      if (!inside(nx, ny, nz)) {
        if (!cut && look(nx, ny, nz) !== 0) { cut = true; if (bounded) return { cells, cut } }
        continue
      }
      const k = at(nx, ny, nz)
      if (grid[k]) continue
      grid[k] = 1
      if (look(nx, ny, nz) !== 0) {
        cells.push([nx, ny, nz]); grid[k] = 2
        if (bounded) {
          const c = [nx, ny, nz]
          for (let a = 0; a < 3; a++) { if (c[a] < lo[a]) lo[a] = c[a]; if (c[a] > hi[a]) hi[a] = c[a] }
          if (hi[0] - lo[0] >= maxExtent || hi[1] - lo[1] >= maxExtent || hi[2] - lo[2] >= maxExtent) return { cells, cut: true }
        }
      }
    }
  }
  return { cells, cut }
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
