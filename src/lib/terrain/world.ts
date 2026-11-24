/**
 * world.ts - the blocks of one TERRAIN visit: 3 by 3 by 3 chunks round the
 * chunk your chain's head is in, and the rules for changing them.
 *
 * The frame. The view is built when TERRAIN opens: its origin is the corner
 * of the head's chunk, and its Y is always cyberspace +Y, the ground's up
 * (terrainAxes: ruled 2026-11-24, gravity in TERRAIN is cyberspace -Y, the
 * compass rule staying WALK's), turned about Y to keep the heading the view
 * had. Inside, everything is a
 * small integer: a cell is named by its offset from the origin in cyberspace
 * axes (cs offsets, -32 to 63 on each axis), and drawn at the view cell its
 * axes turn it to. Your chain does not move while you build (decision D7),
 * so the frame holds for the whole visit.
 *
 * The budget. Only these 27 chunks are ever kept, generated or drawn, which
 * keeps a phone smooth, and the builder's body stays among them: the box's
 * outer faces stop it like a wall.
 *
 * The reach rule (decision D7, the owner's chain-based design; DECK-0009
 * §6.2): a chunk may be surveyed, mined and built in only when your chain's
 * head is within REACH = 16 gibsons of the chunk's box, Chebyshev: on each
 * axis 0 inside the chunk, else the gap to its nearer face, the largest of
 * the three. So the head's own chunk always, and a neighbour only on the
 * side the head is near. It is the presence proof: to build somewhere you
 * must have hopped your chain near it.
 */

import { CHUNK_BITS, CELLS, chunkInSpace, chunkKey, idx, type ChunkBase } from './coords'
import { EMPTY } from './blocks'
import type { AxisDirection, ViewAxes, AxisName } from '../space'

/** Blocks of reach past the head chunk's walls, on each axis. */
export const REACH = 16
/** How far the block cursor reaches from the eye, in blocks. */
export const CURSOR_REACH = 5
/** Chunks on each side of the head's chunk that a visit keeps: 1 makes 3 by 3 by 3. */
export const RING = 1
const SIDE = 2 * RING + 1
/** The box's extent in cs offsets: [LO, HI). */
export const LO = -32 * RING
export const HI = 32 * (RING + 1)

/** The four views with cyberspace +Y up, as [right, out]: the default view turned about Y by quarter turns. */
const UPRIGHT: ReadonlyArray<readonly [AxisDirection, AxisDirection]> = [
  [{ axis: 'x', dir: 1 }, { axis: 'z', dir: -1 }],
  [{ axis: 'z', dir: 1 }, { axis: 'x', dir: 1 }],
  [{ axis: 'x', dir: -1 }, { axis: 'z', dir: 1 }],
  [{ axis: 'z', dir: -1 }, { axis: 'x', dir: -1 }],
]

/**
 * TERRAIN's frame for a view: up is always cyberspace +Y, the ground's up
 * (ruled 2026-11-24), and the heading is the view's as near as it can be: the
 * view's right where that is level, else its out. In the default view, and
 * any view turned only left or right, it is the view itself.
 */
export function terrainAxes(view: ViewAxes): ViewAxes {
  const same = (a: AxisDirection, b: AxisDirection): boolean => a.axis === b.axis && a.dir === b.dir
  const pick = view.right.axis !== 'y'
    ? UPRIGHT.find(([r]) => same(r, view.right))
    : UPRIGHT.find(([, o]) => same(o, view.out))
  const [right, out] = pick ?? UPRIGHT[0]
  return { right, up: { axis: 'y', dir: 1 }, out }
}

/**
 * DECK-0009 §6.2: the Chebyshev distance in gibsons from a chain coordinate
 * to a chunk's box; Infinity across planes.
 */
export function reachDistance(at: { x: bigint; y: bigint; z: bigint; plane: number }, chunk: ChunkBase): number {
  if (at.plane !== chunk.plane) return Infinity
  const d = (v: bigint, b: bigint): bigint => (v < b ? b - v : v > b + 31n ? v - (b + 31n) : 0n)
  const m = [d(at.x, chunk.x), d(at.y, chunk.y), d(at.z, chunk.z)].reduce((a, b) => (a > b ? a : b))
  return m > BigInt(Number.MAX_SAFE_INTEGER) ? Infinity : Number(m)
}

/** A cell outside the box: solid to the body, nothing to the cursor. */
export const EDGE = -1

/** One chunk of the visit. */
export interface ChunkSlot {
  base: ChunkBase
  key: string
  /** Inside the axes. A chunk past an axis end is never surveyed. */
  inSpace: boolean
  surveyed: boolean
  /** The generated ground, once surveyed and generated. */
  generated: Uint8Array | null
  /** What stands: the ground with your layer and log over it. Null until generated. */
  blocks: Uint8Array | null
  /** Changed since it was last meshed. */
  dirty: boolean
  /** The family's skin, as tile rows (blocks.ts index), for the drawn-only chunk skin; null until generated. */
  skin: { top: number; rind: number } | null
}

/** A change, as the log keeps it. */
export interface Change {
  chunk: string
  cell: number
  /** What the cell holds after it: 0 for a mine. */
  id: number
  /** What it held before. */
  was: number
}

/** The axis index of a cyberspace axis name. */
const AXIS_INDEX: Record<AxisName, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

export class TerrainWorld {
  readonly origin: ChunkBase
  readonly axes: ViewAxes
  readonly slots: ChunkSlot[]
  /** For each view axis: which cs axis it shows and the sign. */
  private readonly map: Array<{ cs: 0 | 1 | 2; dir: 1 | -1 }>

  constructor(head: ChunkBase, axes: ViewAxes) {
    this.origin = head
    this.axes = axes
    this.map = [axes.right, axes.up, axes.out].map((a) => ({ cs: AXIS_INDEX[a.axis], dir: a.dir }))
    this.slots = []
    for (let cy = -RING; cy <= RING; cy++) for (let cz = -RING; cz <= RING; cz++) for (let cx = -RING; cx <= RING; cx++) {
      const s = 32n
      const base = { x: head.x + BigInt(cx) * s, y: head.y + BigInt(cy) * s, z: head.z + BigInt(cz) * s, plane: head.plane }
      this.slots.push({ base, key: chunkKey(base), inSpace: chunkInSpace(base), surveyed: false, generated: null, blocks: null, dirty: false, skin: null })
    }
  }

  /** The slot index of the chunk at chunk offsets (cx, cy, cz), each -RING..RING. */
  static slotIndex(cx: number, cy: number, cz: number): number {
    return (cx + RING) + SIDE * ((cz + RING) + SIDE * (cy + RING))
  }

  /** The slot holding a cs offset, and the cell in it; null outside the box. */
  locate(dx: number, dy: number, dz: number): { slot: ChunkSlot; cell: number; s: number } | null {
    if (dx < LO || dy < LO || dz < LO || dx >= HI || dy >= HI || dz >= HI) return null
    const cx = Math.floor(dx / 32), cy = Math.floor(dy / 32), cz = Math.floor(dz / 32)
    const s = TerrainWorld.slotIndex(cx, cy, cz)
    return { slot: this.slots[s], cell: idx(dx - 32 * cx, dy - 32 * cy, dz - 32 * cz), s }
  }

  /** The block at a cs offset: EDGE outside the box, open space in a chunk not surveyed. */
  blockCs(dx: number, dy: number, dz: number): number {
    const at = this.locate(dx, dy, dz)
    if (!at) return EDGE
    return at.slot.blocks ? at.slot.blocks[at.cell] : EMPTY
  }

  /** A view cell's cs offsets. */
  toCs(i: number, j: number, k: number): [number, number, number] {
    const out: [number, number, number] = [0, 0, 0]
    const v = [i, j, k]
    for (let a = 0; a < 3; a++) out[this.map[a].cs] = v[a] * this.map[a].dir
    return out
  }

  /** A cs offset's view cell. */
  toView(dx: number, dy: number, dz: number): [number, number, number] {
    const d = [dx, dy, dz]
    return [d[this.map[0].cs] * this.map[0].dir, d[this.map[1].cs] * this.map[1].dir, d[this.map[2].cs] * this.map[2].dir]
  }

  /** The view axis (0 right, 1 up, 2 out) and sign that show a cs axis. */
  viewAxisOf(cs: 0 | 1 | 2): { axis: 0 | 1 | 2; dir: 1 | -1 } {
    const a = this.map.findIndex((m) => m.cs === cs) as 0 | 1 | 2
    return { axis: a, dir: this.map[a].dir }
  }

  /** The cs axis and sign a view axis shows. */
  csAxisOf(view: 0 | 1 | 2): { cs: 0 | 1 | 2; dir: 1 | -1 } {
    return this.map[view]
  }

  /** The block at a view cell. */
  blockView(i: number, j: number, k: number): number {
    const [dx, dy, dz] = this.toCs(i, j, k)
    return this.blockCs(dx, dy, dz)
  }

  /**
   * Whether the chunk holding a cs offset is within reach of the chain's head
   * (DECK-0009 §6.2), the head given as its cs offset from the origin (0..31
   * on each axis, since the origin is the head's chunk).
   */
  static inReach(dx: number, dy: number, dz: number, head: readonly [number, number, number]): boolean {
    const d = [dx, dy, dz].map((v, a) => {
      const lo = 32 * Math.floor(v / 32), hi = lo + 31, h = head[a]
      return h < lo ? lo - h : h > hi ? h - hi : 0
    })
    return Math.max(d[0], d[1], d[2]) <= REACH
  }

  /** The slot a key names in this visit, or null. */
  slotByKey(key: string): ChunkSlot | null {
    return this.slots.find((s) => s.key === key) ?? null
  }

  /** Set a chunk's blocks once generated (and its layer and log applied); marks it and its neighbours to be meshed again. */
  setBlocks(key: string, generated: Uint8Array, blocks: Uint8Array, skin: { top: number; rind: number } | null = null): void {
    const slot = this.slotByKey(key)
    if (!slot || blocks.length !== CELLS) return
    slot.skin = skin
    slot.generated = generated
    slot.blocks = blocks
    slot.surveyed = true
    this.markAround(this.slots.indexOf(slot), null)
  }

  /** Mark a slot dirty, and the neighbours whose border faces it touches (all six when `cell` is null). */
  private markAround(s: number, cell: number | null): void {
    this.slots[s].dirty = true
    const cx = (s % SIDE) - RING, cz = (Math.floor(s / SIDE) % SIDE) - RING, cy = Math.floor(s / (SIDE * SIDE)) - RING
    const x = cell === null ? -1 : cell & 31, z = cell === null ? -1 : (cell >> 5) & 31, y = cell === null ? -1 : cell >> 10
    const near = (v: number, d: -1 | 1): boolean => cell === null || (d < 0 ? v === 0 : v === 31)
    const around: Array<[number, number, number, boolean]> = [
      [cx - 1, cy, cz, near(x, -1)], [cx + 1, cy, cz, near(x, 1)],
      [cx, cy - 1, cz, near(y, -1)], [cx, cy + 1, cz, near(y, 1)],
      [cx, cy, cz - 1, near(z, -1)], [cx, cy, cz + 1, near(z, 1)],
    ]
    for (const [ax, ay, az, touch] of around) {
      if (!touch || Math.abs(ax) > RING || Math.abs(ay) > RING || Math.abs(az) > RING) continue
      this.slots[TerrainWorld.slotIndex(ax, ay, az)].dirty = true
    }
  }

  /**
   * Change one cell at a cs offset. Null, and nothing changes, outside the
   * box, in a chunk not generated, or when the cell already holds `id`.
   * Reach and the inventory are the caller's to check first.
   */
  setCs(dx: number, dy: number, dz: number, id: number): Change | null {
    const at = this.locate(dx, dy, dz)
    if (!at || !at.slot.blocks) return null
    const was = at.slot.blocks[at.cell]
    if (was === id) return null
    at.slot.blocks[at.cell] = id
    this.markAround(at.s, at.cell)
    return { chunk: at.slot.key, cell: at.cell, id, was }
  }

  /** The chunk slot at a cs offset, or null outside the box. */
  slotAtCs(dx: number, dy: number, dz: number): ChunkSlot | null {
    return this.locate(dx, dy, dz)?.slot ?? null
  }

  /** Slots generated, surveyed and in need of a new mesh. */
  dirtySlots(): ChunkSlot[] {
    return this.slots.filter((s) => s.dirty && s.blocks)
  }

  /** The chunk offsets of a slot. */
  static chunkOffset(s: number): [number, number, number] {
    return [(s % SIDE) - RING, Math.floor(s / (SIDE * SIDE)) - RING, (Math.floor(s / SIDE) % SIDE) - RING]
  }
}

/** Cells in a chunk, for callers that size buffers. */
export const CHUNK_CELLS = CELLS
export { CHUNK_BITS }
