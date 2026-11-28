/**
 * chunkWall.ts - the edge of the chunk you stand in, as numbers (owner,
 * 2026-11-28: "while I'm digging through multiple surveyed chunks I
 * accidentally pass from one chunk to another ... like maybe a green glowing
 * wall that indicates I'm about to leave the chunk I'm currently in").
 *
 * Two things live here, both pure:
 *
 * - The glow wall's faces (scene/ChunkWall.tsx draws them): for each axis the
 *   nearer of the chunk's two faces, how many steps you are from crossing it,
 *   and how strongly it shows: nothing WALL_FAR steps away, fully clear at
 *   WALL_NEAR (standing on the chunk's last gibson, one step from crossing).
 *   One face per axis, so up to three at once at an edge or a corner.
 * - STAY IN THIS CHUNK's wall (terrain/chunkStay.ts): the chunk's six faces as
 *   one shard WALK's walls read (store/walkWalls.ts), the same way the field's
 *   blocks are given to it (lib/terrain/walls.ts), so every way WALK moves
 *   (a step, a fluid glide, a fall, a jump, gravity on or off) is held at the
 *   chunk's edge by the walls' own rules and nothing in WALK changes. Each face
 *   is a square of its own reaching a gibson past the chunk's edges, never
 *   sharing an edge with the next face, so the hull is open (walkConstrain.ts
 *   solidsOf) and never counts as a solid the walker is inside.
 *
 * The chunk is h5: 32 gibsons a side. In the field's frame (scene/TerrainLayer
 * Marks) a gibson q spans q to q + 1, so its middle is q + 0.5 and the chunk's
 * faces stand at its two corners.
 */

import { newShard, type ShardModel, type ShardVertex } from 'sno-core/shards'
import type { WallItem } from '../../store/walkWalls'
import type { ChunkBase } from './coords'

/** A chunk's side, in gibsons. */
export const CHUNK_SIDE = 32
/** Steps from crossing at which the glow wall starts to show, and at which it is fully clear. */
export const WALL_FAR = 4
export const WALL_NEAR = 1
/** The patch of wall lit round the point nearest you: its radius in gibsons, and where its soft edge starts. */
export const PATCH_RADIUS = 4.5
export const PATCH_SOFT_FROM = 1.2
/** What WALK's WALL chip says when the lock holds you (store/useWalk.ts wallChip shows the shard's name). */
export const STAY_WALL_NAME = 'STAY IN THIS CHUNK is on'

/** One face of the chunk near you. */
export interface WallFace {
  /** The axis it stands across: 0 x, 1 y, 2 z. */
  axis: 0 | 1 | 2
  /** Its side: -1 the chunk's low face, 1 its high face. */
  side: -1 | 1
  /** Steps from crossing it: 1 standing on the chunk's last gibson that way. */
  steps: number
  /** How strongly it shows, 0 to 1. */
  strength: number
}

/** How strongly a face `steps` from crossing shows: 0 at WALL_FAR or more, 1 at WALL_NEAR or less, smooth between. */
export function wallStrength(steps: number): number {
  const t = (WALL_FAR - steps) / (WALL_FAR - WALL_NEAR)
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}

/** Three faces, made once by the caller and filled every frame. */
export function makeFaces(): [WallFace, WallFace, WallFace] {
  return [0, 1, 2].map((axis) => ({ axis: axis as 0 | 1 | 2, side: -1 as const, steps: Infinity, strength: 0 })) as [WallFace, WallFace, WallFace]
}

/**
 * The nearer face on each axis to `p`, where you are in the chunk (the
 * field's frame less the chunk's low corner: a gibson's middle is at whole
 * plus a half, so the chunk's first gibson is 0.5 and its last 31.5), written
 * into `out` (nothing made). Returns how many show at all (0 to 3).
 */
export function nearFaces(p: readonly [number, number, number], out: [WallFace, WallFace, WallFace]): number {
  let shown = 0
  for (let a = 0; a < 3; a++) {
    const lo = p[a], hi = CHUNK_SIDE - p[a]
    const f = out[a]
    f.axis = a as 0 | 1 | 2
    f.side = lo <= hi ? -1 : 1
    // From the middle of the last gibson, half a gibson to the face: one step to cross.
    f.steps = Math.max(0, Math.min(lo, hi)) + 0.5
    f.strength = wallStrength(f.steps)
    if (f.strength > 0) shown++
  }
  return shown
}

/** A model coordinate (whole and a half) as whole units and ticks (120 a unit), as lib/terrain/walls.ts writes them. */
function vertex(x: number, y: number, z: number): ShardVertex {
  const p: [number, number, number] = [Math.floor(x), Math.floor(y), Math.floor(z)]
  const t: [number, number, number] = [Math.round((x - p[0]) * 120), Math.round((y - p[1]) * 120), Math.round((z - p[2]) * 120)]
  return t.some((v) => v !== 0) ? { p, t, c: [1, 1, 1] } : { p, c: [1, 1, 1] }
}

/**
 * STAY IN THIS CHUNK's wall: the chunk's six faces, in model coordinates from
 * its low corner gibson, half a gibson outside its first and last gibsons
 * (where the blocks' own faces would be), each a square reaching a gibson past
 * the chunk's edges so no two share an edge (an open hull: never a solid you
 * are inside). Wound as the faces of solid cells just outside the chunk would
 * be (lib/terrain/walls.ts cubeShard), facing in.
 */
export function stayHull(): ShardModel {
  const lo = -0.5, hi = CHUNK_SIDE - 0.5
  const a0 = lo - 1, a1 = hi + 1
  const vertices: ShardVertex[] = []
  const faces: Array<[number, number, number]> = []
  const quad = (q: number[][]): void => {
    const n = vertices.length
    for (const v of q) vertices.push(vertex(v[0], v[1], v[2]))
    faces.push([n, n + 1, n + 2], [n, n + 2, n + 3])
  }
  // Low x: a solid cell beyond it shows its +x face; high x its -x face; and so on (cubeShard's windings).
  quad([[lo, a0, a0], [lo, a1, a0], [lo, a1, a1], [lo, a0, a1]])
  quad([[hi, a0, a0], [hi, a0, a1], [hi, a1, a1], [hi, a1, a0]])
  quad([[a0, lo, a0], [a0, lo, a1], [a1, lo, a1], [a1, lo, a0]])
  quad([[a0, hi, a0], [a1, hi, a0], [a1, hi, a1], [a0, hi, a1]])
  quad([[a0, a0, lo], [a1, a0, lo], [a1, a1, lo], [a0, a1, lo]])
  quad([[a0, a0, hi], [a0, a1, hi], [a1, a1, hi], [a1, a0, hi]])
  return { ...newShard(STAY_WALL_NAME), unit: 0, extent: 64, mode: 'solid', vertices, faces, up: false, spin: 0, extra: { constrain: 'all' } }
}

/** The hull, made once: every lock shares it, placed at its own chunk. */
let hull: ShardModel | null = null

/** STAY IN THIS CHUNK's wall for the chunk `base` (its key `key`), as one of WALK's walls: region the chunk itself (height 5). */
export function stayWallItem(base: ChunkBase, key: string): WallItem {
  hull ??= stayHull()
  return { key: `stay:${key}`, at: { x: base.x, y: base.y, z: base.z }, height: 5, plane: base.plane as WallItem['plane'], shard: hull, mine: true, terrain: true }
}
