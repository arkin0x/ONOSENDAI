/**
 * fromShards.ts - the battlefield's collision triangles from ONOSENDAI
 * shards placed where they stand, measured the way WALK measures walls
 * (lib/walkConstrain.ts wallMesh, as lib/games/play.ts wallsOf calls it):
 *
 * - Only faces that hold a walker are solid: `constrain` all, or opaque on a
 *   solid, fully opaque object; `off` is never solid. An object at opacity 0
 *   with `constrain` all IS solid (ZERO_OPACITY_STOPS_WALKERS, ruled
 *   2026-11-15: invisible walls are a building tool). An object with `anim`
 *   stops nothing yet, as in WALK.
 * - The objects a shard places by reference are included, each by its own
 *   setting (pass sno-core resolveParts' `placed`).
 * - Units: a model unit is 2^shard.unit gibsons.
 * - Frame: wallMesh works in the render frame (cyberspace Z flipped, sno-core
 *   toRender); this turns it back, so the triangles are in region-local
 *   gibsons on cyberspace axes. A shard's origin is the centre of the gibson
 *   it is placed at, which is the whole number itself in this frame (see
 *   types.ts).
 * - The region cut (lib/clip.ts regionBox): a shard's own faces are cut to
 *   the region of its bag's height, WALK_CUT_MARGIN outside the walls, as
 *   WALK cuts them, so only what is drawn is solid. Placed objects' faces are
 *   not cut, as walkConstrain firstHit does not cut them.
 *
 * Known limit, as play.ts: no stand-on-Earth pose (a dataspace shard's). The
 * drone run is in ideaspace.
 */

import type { ShardModel } from 'sno-core/shards'
import type { Placed } from 'sno-core/parts'
import { WALK_CUT_MARGIN, clipMesh } from '../../../clip'
import { placedPose } from '../../../pose'
import type { Position, ViewAxes } from '../../../space'
import { wallMesh } from '../../../walkConstrain'
import type { Vec3 } from '../types'

/** The frame walls are measured in, as play.ts WALL_AXES: screen right +X, up +Y, out of the screen -Z. */
const WALL_AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }

/** One shard where it stands. */
export interface PlacedShard {
  shard: ShardModel
  /** Region-local gibsons (whole numbers for a shard in a bag). */
  at: Vec3
  /** The height of the bag that holds it: its faces are cut to that region. Default 8, the drone run's region. */
  height?: number
  /** The objects it places by reference (sno-core resolveParts). Default none. */
  placed?: readonly Placed[]
}

/** The drone run's region height. */
export const RUN_REGION_HEIGHT = 8

/**
 * Every solid triangle of `pieces`, 9 numbers each (three corners x, y, z),
 * region-local gibsons, ready for buildSolids.
 */
export function trianglesFromShards(pieces: readonly PlacedShard[]): Float32Array {
  const out: number[] = []
  const pose = placedPose(WALL_AXES)
  for (const piece of pieces) {
    const mesh = wallMesh(piece.shard, piece.placed ?? [], pose)
    if (!mesh.min) continue
    const g = 2 ** piece.shard.unit
    const [ax, ay, az] = piece.at
    // Render frame, model units, to region-local gibsons.
    const put = (r0: number, r1: number, r2: number, into: number[]): void => { into.push(ax + r0 * g, ay + r1 * g, az - r2 * g) }
    if (mesh.own > 0) {
      const own: number[] = []
      for (let q = 0; q < mesh.tris.length; q += 3) put(mesh.tris[q], mesh.tris[q + 1], mesh.tris[q + 2], own)
      const h = piece.height ?? RUN_REGION_HEIGHT
      const side = 2 ** h
      const min: [number, number, number] = [0, 0, 0], max: [number, number, number] = [0, 0, 0]
      for (let a = 0; a < 3; a++) {
        const base = Math.floor(piece.at[a] / side) * side
        min[a] = base - 0.5 - WALK_CUT_MARGIN
        max[a] = base + side - 0.5 + WALK_CUT_MARGIN
      }
      const positions = Float32Array.from(own)
      const index = Array.from({ length: positions.length / 3 }, (_, i) => i)
      const cut = clipMesh({ positions, colors: new Float32Array(positions.length), index }, { min, max })
      for (const i of cut.index) out.push(cut.positions[i * 3], cut.positions[i * 3 + 1], cut.positions[i * 3 + 2])
    }
    for (const p of mesh.placements) {
      const { corners, tris } = p.walls
      const f = p.f
      for (let n = 0; n < tris.length; n++) {
        const q = tris[n] * 3
        const r0 = corners[q], r1 = corners[q + 1], r2 = corners[q + 2]
        put(f[0] * r0 + f[4] * r1 + f[8] * r2 + f[12], f[1] * r0 + f[5] * r1 + f[9] * r2 + f[13], f[2] * r0 + f[6] * r1 + f[10] * r2 + f[14], out)
      }
    }
  }
  return Float32Array.from(out)
}

/**
 * The game's WorldShards (lib/games/play.ts: absolute positions, each with its
 * bag's height) as pieces in region-local gibsons from the region's `base`.
 */
export function piecesFromWorld(world: readonly { shard: ShardModel; at: Position; height: number }[], base: Position): PlacedShard[] {
  return world.map((w) => ({ shard: w.shard, at: [Number(w.at.x - base.x), Number(w.at.y - base.y), Number(w.at.z - base.z)] as Vec3, height: w.height }))
}
