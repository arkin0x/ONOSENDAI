/**
 * index.ts - the DRONE RUN simulation's public face, for the view and the
 * game definition.
 *
 * Build the solids once per world (solidsFromShards, or buildSolids from
 * triangles), make a run (createRun), then call stepRun once per fixed step
 * of STEP_S with that step's RunInput (advance does the accumulator for a
 * frame), and draw from the state and its `events`. restart and nextWave
 * return new states. stateHash fingerprints a state for replay checks.
 */

import { trianglesFromShards, type PlacedShard } from './fromShards'
import { buildSolids, type Solids } from './solids'

export type * from '../types'
export type { RunEvent } from './events'
export {
  STEP_S, createRun, stepRun, aimDir, restart, nextWave, nextWaveIndex, advance, dronesLeft, readLevel, zoneBox, bodyBox, overlaps,
  type RunState, type RunOptions, type RunLevel, type Phase, type Box3,
} from './run'
export { stateHash } from './hash'
export { buildSolids, segmentCast, segmentClear, sphereHits, groundBelow, ceilingAbove, type Solids, type Hit } from './solids'
export { trianglesFromShards, piecesFromWorld, type PlacedShard } from './fromShards'
export { eyeOf, stepPlayer, type Body } from './player'
export { lookDir, forwardOf, rightOf } from './fluid'
export type { Drone, DroneShot, DroneMode } from './drones'
export { castHitscan } from './weapons'
export type { Arsenal, GunState, Projectile, Target } from './weapons'

/** The solids of shards placed where they stand (sim/fromShards.ts), indexed. */
export function solidsFromShards(pieces: readonly PlacedShard[]): Solids {
  return buildSolids(trianglesFromShards(pieces))
}

