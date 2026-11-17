/**
 * levelWorld.ts - an imported level (package.ts) as the world a game session
 * holds: the same shape lib/games/world.ts loadWorld gives for a world read
 * from bags (shards where they stand, the entry point, no door), built
 * straight from the level and its payloads on this device. Nothing is signed,
 * sealed or sent: an imported level is never published.
 *
 * As the built-in field's world (level/build.ts): the entry marker first, at
 * the level's entry point, then every placement in the level's order. Only
 * pieces inside the region are kept, as loadWorld keeps them (readLevel has
 * already refused a placement outside it).
 */

import { fromPayload, type ShardModel } from 'sno-core/shards'
import { inRegion, type WorldShard } from '../../play'
import type { World } from '../../world'
import type { GameDef } from '../../types'
import type { Position } from '../../../space'
import { ENTRY_MARKER_PAYLOAD } from './build'
import type { Level, Local } from './level'

/** A region-local point of `game` as a position. */
function placeOf(game: Pick<GameDef, 'region'>, p: Local): Position {
  const b = game.region.base
  return { x: b.x + BigInt(p[0]), y: b.y + BigInt(p[1]), z: b.z + BigInt(p[2]) }
}

/**
 * The world of an imported level for `game`. `key` names the level in each
 * shard's key (one level's shards never share a key with another's).
 * Throws when a placed piece has no payload or its payload is not an SNO object.
 */
export function worldFromLevel(game: Pick<GameDef, 'region'>, key: string, level: Level, payloads: Readonly<Record<string, unknown>>): World {
  const height = game.region.height
  const shards = new Map<string, ShardModel>()
  const shardOf = (name: string, raw: unknown): ShardModel => {
    const have = shards.get(name)
    if (have) return have
    const s = fromPayload(raw, `drone-run-${name}`)
    if (!s) throw new Error(`The level's piece ${name} is not an SNO object.`)
    shards.set(name, s)
    return s
  }
  const entry = placeOf(game, level.entry)
  const out: WorldShard[] = [{ key: `${key}:entry`, shard: shardOf('entry marker', ENTRY_MARKER_PAYLOAD), at: entry, height }]
  for (const p of level.pieces) {
    if (!(p.piece in payloads)) throw new Error(`The level places ${p.piece}, but has no payload for it.`)
    const at = placeOf(game, p.at)
    if (!inRegion(game, at)) continue
    out.push({ key: `${key}:${p.piece}`, shard: shardOf(p.piece, payloads[p.piece]), at, height })
  }
  return { shards: out, entry, door: null }
}
