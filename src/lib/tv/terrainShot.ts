/**
 * terrainShot.ts: which Cyberspace TV beats are TERRAIN, and how a TERRAIN
 * shot is framed.
 *
 * TERRAIN is WALK with block tools (store/useTerrain.ts), so its moves are
 * plain movement actions with no mode flag (the tape cannot tell them from a
 * hop by the event alone). A beat is TERRAIN when both hold:
 *
 * - its step is small, at most TERRAIN_STEP_GIBSONS on every axis, in one
 *   plane, and not a hyperjump or a spawn (a walk is batched one action to a
 *   straight run, store/useWalk.ts);
 * - the chunk it lands in has a counted survey at or before its tape time,
 *   by the TV terrain reader (lib/tv/terrainReader.ts), so there is ground
 *   to show there.
 *
 * A shot is a TERRAIN shot when one of its beats is TERRAIN and every move in
 * it is small: it plays at a block's zoom (2^0, one block a cell) with the
 * blocks round its avatar drawn (store/useTvTerrain.ts, scene/TvTerrain.tsx).
 * A shot with a long hop in it plays as any trip does.
 *
 * The camera (owner, 2026-11-28, ruled A): an over-the-shoulder camera 1 to 6
 * blocks behind as space allows, first person as a variation on long runs,
 * and an "ant farm" cutaway that fades the blocks between the camera and the
 * player. Those come in a later change; for now a TERRAIN shot is a close
 * orbit (TerrainCamera 'orbit'), and the mode is the seam where the chase
 * camera plugs in (scene/tvTerrainCamera.ts).
 *
 * Pure: the store flags beats once the reader has their chunks.
 */

import { chunkInSpace, chunkOf, type ChunkBase } from '../terrain/coords'
import type { Beat, Framing, Shot } from './director'

/** The longest step, in gibsons on any axis, a TERRAIN move takes. */
export const TERRAIN_STEP_GIBSONS = 16n

/** The zoom a TERRAIN shot plays at: one block (a gibson) a cell. */
export const TERRAIN_SCALE_EXP = 0

/**
 * How the camera takes a TERRAIN shot. Only 'orbit' for now; the chase
 * camera ('chase', with 'first-person' on long runs) and the cutaway come
 * later (owner, 2026-11-28).
 */
export type TerrainCameraMode = 'orbit'

export interface TerrainCamera {
  mode: TerrainCameraMode
}

/** Whether a beat's step is a TERRAIN-sized one: in one plane, at most TERRAIN_STEP_GIBSONS on each axis, and not a jump or a spawn. */
export function terrainStep(b: Beat): boolean {
  const type = b.action.type
  if (type === 'spawn' || type === 'hyperjump' || b.from.plane !== b.action.plane) return false
  const p = b.action.position
  const q = b.from.position
  const near = (u: bigint, v: bigint): boolean => (u > v ? u - v : v - u) <= TERRAIN_STEP_GIBSONS
  return near(p.x, q.x) && near(p.y, q.y) && near(p.z, q.z)
}

/** The chunk a beat lands in. */
export function beatChunk(b: Beat): ChunkBase {
  const p = b.action.position
  return chunkOf(p.x, p.y, p.z, b.action.plane)
}

/** The chunks round `base` out to `ring` on each axis (1: the chunk and its 26 neighbours), inside the axes. */
export function neighbourhood(base: ChunkBase, ring = 1): ChunkBase[] {
  const out: ChunkBase[] = []
  for (let dy = -ring; dy <= ring; dy++) for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
    const b = { x: base.x + 32n * BigInt(dx), y: base.y + 32n * BigInt(dy), z: base.z + 32n * BigInt(dz), plane: base.plane }
    if (chunkInSpace(b)) out.push(b)
  }
  return out
}

/** Whether a shot could be a TERRAIN shot at all: a trip with a small step in it. Only those are read for. */
export function mayBeTerrain(shot: Shot): boolean {
  return shot.kind === 'trip' && shot.beats.some(terrainStep)
}

/**
 * Flag a shot's TERRAIN beats (Beat `terrain`), given whether a chunk was
 * surveyed as of a tape time (null while it is not read yet, which flags
 * nothing). Returns whether every beat's chunk was known.
 */
export function flagTerrainBeats(beats: Beat[], surveyedAsOf: (base: ChunkBase, t: number) => boolean | null): boolean {
  let known = true
  for (const b of beats) {
    const surveyed = terrainStep(b) ? surveyedAsOf(beatChunk(b), b.at) : false
    if (surveyed === null) known = false
    if (surveyed === true) b.terrain = true
    else delete b.terrain
  }
  return known
}

/** Whether a shot plays as TERRAIN: a trip with a TERRAIN beat, and every move in it small. */
export function isTerrainShot(shot: Shot): boolean {
  if (shot.kind !== 'trip' || !shot.beats.some((b) => b.terrain)) return false
  return shot.beats.every((b) => b.action.type === 'spawn' || terrainStep(b))
}

/** A number in [0, 1) from a hex id and a salt, the same every time (as director.ts frames a shot). */
function idFraction(id: string, salt: number): number {
  const n = parseInt(id.slice(salt * 8, salt * 8 + 8).padEnd(8, '0'), 16)
  return Number.isFinite(n) ? n / 2 ** 32 : 0
}

/**
 * A TERRAIN shot's framing: close, a few blocks out, looking down over the
 * avatar at a shoulder's angle, pushing in a little, either way round. Drawn
 * from the shot's id, so the same tape always cuts the same way.
 */
export function terrainFraming(id: string): Framing {
  return {
    from: 9,
    to: 7,
    polar: 0.85 + idFraction(id, 1) * 0.3,
    name: 'close',
    view: 'above',
    sun: false,
    spin: idFraction(id, 5) < 0.5 ? 1 : -1,
  }
}
