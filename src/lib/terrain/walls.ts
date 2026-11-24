/**
 * walls.ts - the field's blocks as walls WALK walks on (owner, 2026-11-24:
 * "WALK should also collide with those blocks, so you can walk on them").
 *
 * WALK's walls (store/walkWalls.ts) are the faces of placed shards. Each
 * loaded chunk's blocks are given to it as shards of their own: one per 8 by
 * 8 by 8 cube that has a face, holding exactly the faces between a block and
 * open space (across cube and chunk borders too), as unit boxes centred on
 * their gibsons, the way WALK's walker stands on gibson points. Placed at
 * the cube's corner at height 3, so WALK only ever asks the cubes a step can
 * reach (regionReached). A cube's shard is made again only when what it is
 * made from changed (its cells and the layer round it), so mining one block
 * remakes one cube or a few, and WALK builds only those walls again
 * (entryFor keys on the shard object).
 *
 * Nothing is drawn from these: the scene draws the chunks' own meshes
 * (scene/TerrainLayer.tsx). Only WALK's collision reads them.
 */

import { newShard, type ShardModel, type ShardVertex } from 'sno-core/shards'
import type { WallItem } from '../../store/walkWalls'
import { solid } from './blocks'
import type { ChunkSlot, TerrainWorld } from './world'

const CUBE = 8
const PER_CHUNK = 32 / CUBE

/** One chunk's walls, as last made: its version and neighbours, its items, and each cube's solidity and item. */
const made = new WeakMap<ChunkSlot, { version: number; neighbours: string; items: WallItem[]; cubes: Array<{ solid: Uint8Array; item: WallItem | null } | null> }>()

/** Which cells a cube's faces are made from are solid: its 8 cubed cells and the layer of cells round its six sides. */
function cubeSolidity(world: TerrainWorld, slot: ChunkSlot, cx: number, cy: number, cz: number): Uint8Array {
  const out = new Uint8Array(CUBE * CUBE * CUBE + 6 * CUBE * CUBE)
  const ox = 32 * slot.off[0] + CUBE * cx, oy = 32 * slot.off[1] + CUBE * cy, oz = 32 * slot.off[2] + CUBE * cz
  let n = 0
  for (let y = 0; y < CUBE; y++) for (let z = 0; z < CUBE; z++) for (let x = 0; x < CUBE; x++) out[n++] = solid(world.blockCs(ox + x, oy + y, oz + z)) ? 1 : 0
  for (let a = 0; a < CUBE; a++) for (let b = 0; b < CUBE; b++) {
    out[n++] = solid(world.blockCs(ox - 1, oy + a, oz + b)) ? 1 : 0
    out[n++] = solid(world.blockCs(ox + CUBE, oy + a, oz + b)) ? 1 : 0
    out[n++] = solid(world.blockCs(ox + a, oy - 1, oz + b)) ? 1 : 0
    out[n++] = solid(world.blockCs(ox + a, oy + CUBE, oz + b)) ? 1 : 0
    out[n++] = solid(world.blockCs(ox + a, oy + b, oz - 1)) ? 1 : 0
    out[n++] = solid(world.blockCs(ox + a, oy + b, oz + CUBE)) ? 1 : 0
  }
  return out
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** A half-integer model coordinate as whole units and ticks (120 a unit). */
function vertex(x: number, y: number, z: number): ShardVertex {
  const p: [number, number, number] = [Math.floor(x), Math.floor(y), Math.floor(z)]
  const t: [number, number, number] = [Math.round((x - p[0]) * 120), Math.round((y - p[1]) * 120), Math.round((z - p[2]) * 120)]
  return t.some((v) => v !== 0) ? { p, t, c: [1, 1, 1] } : { p, c: [1, 1, 1] }
}

/** The faces of one 8-cube of a chunk as a shard: two triangles per open face, unit boxes centred on the cells. */
function cubeShard(world: TerrainWorld, slot: ChunkSlot, cx: number, cy: number, cz: number): ShardModel | null {
  const blocks = slot.blocks
  if (!blocks) return null
  const vertices: ShardVertex[] = []
  const faces: Array<[number, number, number]> = []
  const ox = 32 * slot.off[0] + CUBE * cx, oy = 32 * slot.off[1] + CUBE * cy, oz = 32 * slot.off[2] + CUBE * cz
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    const n = vertices.length
    vertices.push(vertex(a[0], a[1], a[2]), vertex(b[0], b[1], b[2]), vertex(c[0], c[1], c[2]), vertex(d[0], d[1], d[2]))
    faces.push([n, n + 1, n + 2], [n, n + 2, n + 3])
  }
  for (let y = 0; y < CUBE; y++) for (let z = 0; z < CUBE; z++) for (let x = 0; x < CUBE; x++) {
    const lx = CUBE * cx + x, ly = CUBE * cy + y, lz = CUBE * cz + z
    if (!solid(blocks[lx | (lz << 5) | (ly << 10)])) continue
    const gx = ox + x, gy = oy + y, gz = oz + z
    const open = (dx: number, dy: number, dz: number): boolean => !solid(world.blockCs(gx + dx, gy + dy, gz + dz))
    // Model coordinates from the cube's corner: the cell (x, y, z) spans x - 0.5 .. x + 0.5.
    const x0 = x - 0.5, x1 = x + 0.5, y0 = y - 0.5, y1 = y + 0.5, z0 = z - 0.5, z1 = z + 0.5
    if (open(-1, 0, 0)) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0])
    if (open(1, 0, 0)) quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])
    if (open(0, -1, 0)) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1])
    if (open(0, 1, 0)) quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0])
    if (open(0, 0, -1)) quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0])
    if (open(0, 0, 1)) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])
  }
  if (faces.length === 0) return null
  // A plain solid object at a gibson's unit, blocking walkers: WALK's walls read its faces.
  return { ...newShard('Blocks'), unit: 0, extent: 16, mode: 'solid', vertices, faces, up: false, spin: 0, extra: { constrain: 'all' } }
}

/** What a chunk's neighbours are now (whether each is loaded and its version): a neighbour changing changes this chunk's border faces. */
function neighbourStamp(world: TerrainWorld, slot: ChunkSlot): string {
  const out: string[] = []
  for (const [ax, ay, az] of [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]]) {
    const n = world.slotAt(slot.off[0] + ax, slot.off[1] + ay, slot.off[2] + az)
    out.push(n?.blocks ? String(n.version) : '-')
  }
  return out.join(',')
}

/** One chunk's walls, looked at again only when it or a neighbour changed, and each cube made again only when its solidity did. */
export function chunkWallItems(world: TerrainWorld, slot: ChunkSlot): WallItem[] {
  if (!slot.blocks) return []
  const stamp = neighbourStamp(world, slot)
  const had = made.get(slot)
  if (had && had.version === slot.version && had.neighbours === stamp) return had.items
  const items: WallItem[] = []
  const cubes: Array<{ solid: Uint8Array; item: WallItem | null } | null> = []
  for (let cy = 0; cy < PER_CHUNK; cy++) for (let cz = 0; cz < PER_CHUNK; cz++) for (let cx = 0; cx < PER_CHUNK; cx++) {
    const c = cubes.length
    const solidity = cubeSolidity(world, slot, cx, cy, cz)
    const was = had?.cubes[c]
    let item: WallItem | null
    if (was && same(was.solid, solidity)) item = was.item
    else {
      const shard = cubeShard(world, slot, cx, cy, cz)
      const at = { x: slot.base.x + BigInt(CUBE * cx), y: slot.base.y + BigInt(CUBE * cy), z: slot.base.z + BigInt(CUBE * cz) }
      item = shard ? { key: `terrain:${slot.key}:${cx}${cy}${cz}`, at, height: 3, plane: slot.base.plane as WallItem['plane'], shard, mine: true, terrain: true } : null
    }
    cubes.push({ solid: solidity, item })
    if (item) items.push(item)
  }
  made.set(slot, { version: slot.version, neighbours: stamp, items, cubes })
  return items
}

/** Every loaded chunk's walls. */
export function terrainWallItems(world: TerrainWorld): WallItem[] {
  const out: WallItem[] = []
  for (const slot of world.slots) if (slot.blocks) out.push(...chunkWallItems(world, slot))
  return out
}
