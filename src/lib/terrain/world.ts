/**
 * world.ts - the blocks this device holds: the chunks loaded round you, in
 * one frame, and the rules for changing them.
 *
 * The frame. A world has a fixed origin, the corner of a chunk (the one your
 * avatar was in when it was made), and every cell is named by its offset
 * from it in cyberspace axes (cs offsets): small integers, exact as numbers.
 * Its view axes (`axes`) turn cs offsets into the scene's frame for TERRAIN:
 * Y is always cyberspace +Y, the ground's up (terrainAxes, ruled
 * 2026-11-24), turned about Y to keep the heading the view had.
 *
 * Open air. Chunks are kept in a map by their chunk offset. A cell in a
 * chunk that is not loaded, or not surveyed, is open space: no invisible
 * ceilings or walls at any chunk border (the owner's report of 2026-11-24:
 * "the roof blocks my jumps"). Which chunks are loaded is the store's
 * (store/useTerrain.ts): the 3 by 3 by 3 round the body in TERRAIN,
 * following it as it moves, and the surveyed chunks near your avatar
 * everywhere else, so the blocks are drawn in every mode.
 *
 * The reach rule (decision D7; DECK-0009 §6.2): a chunk may be surveyed,
 * mined and built in only when your chain's head is within REACH = 16
 * gibsons of the chunk's box, Chebyshev: on each axis 0 inside the chunk,
 * else the gap to its nearer face, the largest of the three.
 */

import { CELLS, chunkInSpace, chunkKey, idx, type ChunkBase } from './coords'
import type { GroundRevision } from './groundRevision'
import { EMPTY } from './blocks'
import { FOOT, aroundIndex, lightReaches } from './light'
import type { AxisDirection, ViewAxes, AxisName } from '../space'
import type { GroundFacts } from './assay'

/** Blocks of reach past the chunk's walls, on each axis (DECK-0009 §6.2). */
export const REACH = 16
/** How far the block cursor reaches from the eye, in blocks. */
export const CURSOR_REACH = 5
/** Chunks on each side of the body's chunk that TERRAIN keeps loaded: 1 makes 3 by 3 by 3. */
export const RING = 1

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

/** One chunk the world holds. */
export interface ChunkSlot {
  base: ChunkBase
  key: string
  /** Its chunk offset from the world's origin. */
  off: [number, number, number]
  /** Inside the axes. A chunk past an axis end is never surveyed. */
  inSpace: boolean
  surveyed: boolean
  /** The generated ground, once surveyed and generated: at the chunk's own revision where you surveyed, else at the base revision you are shown (store/useTerrain.ts). */
  generated: Uint8Array | null
  /** The ground revision `generated` is (DECK-0009 §3.10). */
  revision?: GroundRevision
  /** What stands: the ground with your layer and log over it, and everyone else's shared layers merged under them (store/terrainShare.ts). Null until generated. */
  blocks: Uint8Array | null
  /** Your own blocks alone: the ground with your layer and log over it, what your layer is written from. Null where you have not surveyed. */
  own?: Uint8Array | null
  /** What the generator said of its ground (its type and hardness), for the survey card (assay.ts); absent until generated. */
  ground?: GroundFacts | null
  /** Changed since it was last meshed. */
  dirty: boolean
  /** Its light (light.ts) may have changed since it was last worked out: a block within its reach changed, or a chunk came or went. */
  lightDirty?: boolean
  /** Bumped by every change to its blocks: the walls built from it (lib/terrain/walls.ts) follow it. */
  version: number
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

/** A chunk's key in TerrainWorld.chunks, by chunk offset. */
export const offKey = (cx: number, cy: number, cz: number): string => `${cx},${cy},${cz}`

/** The six neighbours' offsets, in the order of mesh.ts Borders: -x, +x, -y, +y, -z, +z. */
export const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]]

export class TerrainWorld {
  readonly origin: ChunkBase
  axes: ViewAxes
  /** Loaded chunks, by chunk offset. */
  readonly chunks = new Map<string, ChunkSlot>()
  /** For each view axis: which cs axis it shows and the sign. */
  private map: Array<{ cs: 0 | 1 | 2; dir: 1 | -1 }>

  constructor(origin: ChunkBase, axes: ViewAxes) {
    this.origin = origin
    this.axes = axes
    this.map = this.mapOf(axes)
  }

  private mapOf(axes: ViewAxes): Array<{ cs: 0 | 1 | 2; dir: 1 | -1 }> {
    return [axes.right, axes.up, axes.out].map((a) => ({ cs: AXIS_INDEX[a.axis], dir: a.dir }))
  }

  /** Turn the view axes (TERRAIN opens with the view as it is then). */
  setAxes(axes: ViewAxes): void {
    this.axes = axes
    this.map = this.mapOf(axes)
  }

  /** The chunk at a chunk offset, made (empty, not surveyed) when `create`. */
  slotAt(cx: number, cy: number, cz: number, create = false): ChunkSlot | null {
    const k = offKey(cx, cy, cz)
    let s = this.chunks.get(k)
    if (!s && create) {
      const o = this.origin
      const base = { x: o.x + BigInt(32 * cx), y: o.y + BigInt(32 * cy), z: o.z + BigInt(32 * cz), plane: o.plane }
      s = { base, key: chunkKey(base), off: [cx, cy, cz], inSpace: chunkInSpace(base), surveyed: false, generated: null, blocks: null, dirty: false, lightDirty: false, version: 0 }
      this.chunks.set(k, s)
    }
    return s ?? null
  }

  /** Every chunk held. */
  get slots(): ChunkSlot[] {
    return [...this.chunks.values()]
  }

  /** The chunk offset of a cs offset. */
  static chunkOf(dx: number, dy: number, dz: number): [number, number, number] {
    return [Math.floor(dx / 32), Math.floor(dy / 32), Math.floor(dz / 32)]
  }

  /** The chunk holding a cs offset (if held), and the cell in it. */
  locate(dx: number, dy: number, dz: number): { slot: ChunkSlot | null; cell: number } {
    const cx = Math.floor(dx / 32), cy = Math.floor(dy / 32), cz = Math.floor(dz / 32)
    return { slot: this.slotAt(cx, cy, cz), cell: idx(dx - 32 * cx, dy - 32 * cy, dz - 32 * cz) }
  }

  /** The block at a cs offset: open space in a chunk not held or not surveyed. */
  blockCs(dx: number, dy: number, dz: number): number {
    const { slot, cell } = this.locate(dx, dy, dz)
    return slot?.blocks ? slot.blocks[cell] : EMPTY
  }

  /** Whether the block at a cs offset is natural ground: the generated block, unchanged (a placed or a mined cell is not). */
  naturalCs(dx: number, dy: number, dz: number): boolean {
    const { slot, cell } = this.locate(dx, dy, dz)
    const g = slot?.generated
    return !!g && !!slot?.blocks && g[cell] !== EMPTY && slot.blocks[cell] === g[cell]
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
   * (DECK-0009 §6.2), the head given as its cs offset from the origin.
   */
  static inReach(dx: number, dy: number, dz: number, head: readonly [number, number, number]): boolean {
    const d = [dx, dy, dz].map((v, a) => {
      const lo = 32 * Math.floor(v / 32), hi = lo + 31, h = head[a]
      return h < lo ? lo - h : h > hi ? h - hi : 0
    })
    return Math.max(d[0], d[1], d[2]) <= REACH
  }

  /** The chunk a key names, if held. */
  slotByKey(key: string): ChunkSlot | null {
    for (const s of this.chunks.values()) if (s.key === key) return s
    return null
  }

  /** Let a chunk go (it is far away now). */
  drop(slot: ChunkSlot): void {
    this.chunks.delete(offKey(slot.off[0], slot.off[1], slot.off[2]))
    // Its neighbours' borders read open space now.
    for (const [ax, ay, az] of NEIGHBOURS) {
      const n = this.slotAt(slot.off[0] + ax, slot.off[1] + ay, slot.off[2] + az)
      if (n) n.dirty = true
    }
    if (slot.blocks) this.markLight(slot, null)
  }

  /** Set a chunk's blocks once generated (and its layer and log applied); marks it and its neighbours to be meshed again. */
  setBlocks(key: string, generated: Uint8Array, blocks: Uint8Array): void {
    const slot = this.slotByKey(key)
    if (!slot || blocks.length !== CELLS) return
    slot.generated = generated
    slot.blocks = blocks
    slot.surveyed = true
    slot.version++
    this.markAround(slot, null)
    this.markLight(slot, null)
  }

  /**
   * Mark the chunks whose light a change in `slot` can reach (light.ts
   * lightReaches): at `cell`, or anywhere in it when null (it came or went).
   */
  private markLight(slot: ChunkSlot, cell: number | null): void {
    const x = cell === null ? 0 : cell & 31, z = cell === null ? 0 : (cell >> 5) & 31, y = cell === null ? 0 : cell >> 10
    for (const n of this.chunks.values()) {
      if (!n.blocks) continue
      const d: [number, number, number] = [n.off[0] - slot.off[0], n.off[1] - slot.off[1], n.off[2] - slot.off[2]]
      const reach = cell === null ? Math.abs(d[0]) <= 1 && Math.abs(d[2]) <= 1 && d[1] <= 1 : lightReaches(d, x, y, z)
      if (reach) n.lightDirty = true
    }
  }

  /**
   * What a chunk's light is worked out from (light.ts computeLight): its own
   * blocks and its 26 neighbours' (null where open space), and which columns
   * of their footprint a chunk higher up shades (null when none does).
   * `shaded` gives a chunk's shaded columns (light.ts shadedColumns), so the
   * caller can keep them between calls.
   */
  lightInputs(slot: ChunkSlot, shaded: (s: ChunkSlot) => Uint8Array): { around: Array<Uint8Array | null>; skyTop: Uint8Array | null } {
    const around: Array<Uint8Array | null> = new Array(27).fill(null)
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      around[aroundIndex(dx, dy, dz)] = this.slotAt(slot.off[0] + dx, slot.off[1] + dy, slot.off[2] + dz)?.blocks ?? null
    }
    let skyTop: Uint8Array | null = null
    for (const n of this.chunks.values()) {
      const dx = n.off[0] - slot.off[0], dz = n.off[2] - slot.off[2]
      if (!n.blocks || n.off[1] - slot.off[1] < 2 || Math.abs(dx) > 1 || Math.abs(dz) > 1) continue
      const cols = shaded(n)
      skyTop ??= new Uint8Array(FOOT * FOOT).fill(1)
      for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if (cols[x + 32 * z]) skyTop[(dx + 1) * 32 + x + FOOT * ((dz + 1) * 32 + z)] = 0
    }
    return { around, skyTop }
  }

  /** Chunks generated whose light needs working out again. */
  lightDirtySlots(): ChunkSlot[] {
    return this.slots.filter((s) => s.lightDirty && s.blocks)
  }

  /** Mark a chunk dirty, and the neighbours whose border faces it touches (all six when `cell` is null). */
  private markAround(slot: ChunkSlot, cell: number | null): void {
    slot.dirty = true
    const x = cell === null ? -1 : cell & 31, z = cell === null ? -1 : (cell >> 5) & 31, y = cell === null ? -1 : cell >> 10
    const near = (v: number, d: -1 | 1): boolean => cell === null || (d < 0 ? v === 0 : v === 31)
    const touch = [near(x, -1), near(x, 1), near(y, -1), near(y, 1), near(z, -1), near(z, 1)]
    NEIGHBOURS.forEach(([ax, ay, az], f) => {
      if (!touch[f]) return
      const n = this.slotAt(slot.off[0] + ax, slot.off[1] + ay, slot.off[2] + az)
      if (n) n.dirty = true
    })
  }

  /**
   * Change one cell at a cs offset. Null, and nothing changes, in a chunk not
   * held or not generated, or when the cell already holds `id`. Reach and the
   * inventory are the caller's to check first.
   */
  setCs(dx: number, dy: number, dz: number, id: number): Change | null {
    const { slot, cell } = this.locate(dx, dy, dz)
    if (!slot?.blocks) return null
    const was = slot.blocks[cell]
    if (was === id) return null
    slot.blocks[cell] = id
    slot.version++
    this.markAround(slot, cell)
    this.markLight(slot, cell)
    return { chunk: slot.key, cell, id, was }
  }

  /** The chunk at a cs offset, if held. */
  slotAtCs(dx: number, dy: number, dz: number): ChunkSlot | null {
    return this.locate(dx, dy, dz).slot
  }

  /** Chunks generated and in need of a new mesh. */
  dirtySlots(): ChunkSlot[] {
    return this.slots.filter((s) => s.dirty && s.blocks)
  }
}

/** Cells in a chunk, for callers that size buffers. */
export const CHUNK_CELLS = CELLS
