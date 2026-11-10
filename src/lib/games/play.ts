/**
 * play.ts - the tutorial game's movement, as game logic (DECK-0002 §6, §8).
 *
 * Inside a game nothing is a hop: a press moves the player one gibson by the
 * game's own rules, on this device, and nothing is signed for it. These are
 * the rules of the games this client implements today:
 *
 * - No gravity: the Maze Kit's dungeons are built to be flown through, up and
 *   down shafts as well as along halls.
 * - The world's walls are solid: a step that would cross a face of a world
 *   shard is not taken. The faces are the ones WALK stops at (DECK-0003 §1.12,
 *   lib/walkConstrain.ts), measured the same way, so a shard set to `off`
 *   stops nobody here either. Only the game's own world: nothing of anyone
 *   else's is drawn or solid inside a game (DECK-0002 §5.1).
 * - Standing on a pad sends you to its destination: the mechanic cyberspace
 *   does not have. That is a `teleport` on the chain (DECK-0002 §4.1).
 * - A step never leaves the region.
 *
 * Known limit (review of #660): walls are built from each shard's own faces,
 * without the objects it places by reference and without the stand-on-Earth
 * pose a dataspace shard can carry. The tutorial dungeon has neither (inline
 * pieces, in ideaspace). A game whose world uses them needs walkWalls' part
 * resolution and placedPose here first, or its walls will not hold.
 */

import type { ShardModel } from 'sno-core/shards'
import { regionBox, type Box } from '../clip'
import { placedPose } from '../pose'
import type { AxisName, Position, ViewAxes } from '../space'
import { firstHit, wallMesh, type WallMesh } from '../walkConstrain'
import type { GameDef, GamePad } from './types'

/** One shard of the world, where it stands: an item of the game key's bag. */
export interface WorldShard {
  key: string
  shard: ShardModel
  at: Position
  /** Its bag's height: it is cut to that region, as everywhere. */
  height: number
}

/** The frame the walls are measured in, walkWalls WALL_AXES: screen right +X, up +Y, out of the screen -Z. */
const WALL_AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }

interface Walls { mesh: WallMesh; clip: Box }

/** Each world shard's walls, built once per model. */
const built = new WeakMap<ShardModel, Map<string, Walls>>()

function wallsOf(w: WorldShard): Walls {
  let byPlace = built.get(w.shard)
  if (!byPlace) { byPlace = new Map(); built.set(w.shard, byPlace) }
  const k = `${w.at.x},${w.at.y},${w.at.z},${w.height}`
  let walls = byPlace.get(k)
  if (!walls) {
    walls = { mesh: wallMesh(w.shard, [], placedPose(WALL_AXES)), clip: regionBox(w.at, w.height, w.shard.unit, WALL_AXES) }
    byPlace.set(k, walls)
  }
  return walls
}

/** A face nearer than this, in gibsons, is the one you stand on, and lets you go (walkWalls ON_FACE). */
const ON_FACE = 1e-6
/** The slack of the measure at a dungeon's sizes: far under a gibson, far over a double's error. */
const TOLERANCE = 1e-6

/** Whether a face of any world shard lies in the way of one gibson from `from` along `axis`. */
export function blocked(from: Position, axis: AxisName, dir: 1 | -1, world: readonly WorldShard[]): boolean {
  const i = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  for (const w of world) {
    const { mesh, clip } = wallsOf(w)
    if (!mesh.min || !mesh.max) continue
    const g = 2 ** w.shard.unit
    // In the shard's own model units from its origin, render frame (cyberspace Z flipped), as walkWalls stepLimit measures.
    const o: [number, number, number] = [Number(from.x - w.at.x) / g, Number(from.y - w.at.y) / g, -Number(from.z - w.at.z) / g]
    // Nothing of the shard within a gibson of the walker on the other two axes, or along the step: skipped before any triangle.
    const reach = 1 / g + TOLERANCE
    if ([0, 1, 2].some((a) => o[a] < mesh.min![a] - reach || o[a] > mesh.max![a] + reach)) continue
    const s = (i === 2 ? -dir : dir) as 1 | -1
    if (firstHit(mesh, o, i, s, (1 + TOLERANCE) / g, ON_FACE / g, clip) !== null) return true
  }
  return false
}

/** Whether `p` lies inside the game's region (spec §8.11.1's test). */
export function inRegion(game: Pick<GameDef, 'region'>, p: Position): boolean {
  const h = BigInt(game.region.height)
  const b = game.region.base
  return p.x >> h === b.x >> h && p.y >> h === b.y >> h && p.z >> h === b.z >> h
}

/** One step's result: where the player is now, and the pad it brought them onto, if any. */
export interface GameStep {
  at: Position
  moved: boolean
  pad: GamePad | null
}

/** The pad `p` stands on: one gibson above it, within one gibson of it on X and Z (a 2-gibson pad drawn at its gibson's centre). */
export function padUnder(game: Pick<GameDef, 'pads'>, p: Position): GamePad | null {
  for (const pad of game.pads) {
    const dx = p.x - pad.at.x, dz = p.z - pad.at.z
    if (p.y - pad.at.y === 1n && dx >= -1n && dx <= 1n && dz >= -1n && dz <= 1n) return pad
  }
  return null
}

/** One press: a gibson along `axis` unless a wall or the region's edge is in the way. */
export function stepIn(game: Pick<GameDef, 'region' | 'pads'>, from: Position, axis: AxisName, dir: 1 | -1, world: readonly WorldShard[]): GameStep {
  const to = { ...from, [axis]: from[axis] + BigInt(dir) }
  if (!inRegion(game, to) || blocked(from, axis, dir, world)) return { at: from, moved: false, pad: null }
  return { at: to, moved: true, pad: padUnder(game, to) }
}
