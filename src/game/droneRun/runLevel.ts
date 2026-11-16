/**
 * runLevel.ts - what a run plays, for the canvas: the variant a game names,
 * its client fog, a game position as region-local gibsons, a stand-in
 * level for when the session has none, and which world shards the game
 * draws. Pure.
 */

import type { DroneRunVariant, LevelInfo, Vec3 } from '../../lib/games/droneRun/sim'
import baseVariant from '../../lib/games/droneRun/variants/drone-run-base.json'
import type { WorldShard } from '../../lib/games/play'
import type { Position } from '../../lib/space'

/** The variants this client knows, by id. */
const BASE = baseVariant as unknown as DroneRunVariant
const VARIANTS: Record<string, DroneRunVariant> = { [BASE.id]: BASE }

/** The variant a game plays (GameDef play.variant), or the base. */
export function variantFor(id: string | undefined): DroneRunVariant {
  return (id && VARIANTS[id]) || BASE
}

/** The variant's client fog (near, far), with the base's numbers when it gives none. */
export function fogOf(v: DroneRunVariant): { near: number; far: number } {
  const f = (v.client?.fog ?? {}) as { near?: number; far?: number }
  return { near: f.near ?? 20, far: f.far ?? 55 }
}

/** A game position as region-local gibsons. */
export function localOf(p: Position, base: Position): Vec3 {
  return [Number(p.x - base.x), Number(p.y - base.y), Number(p.z - base.z)]
}

/**
 * A level to play until the level import hands one over: the variant's zones,
 * the session's entry point, and a spawn point for every one the waves name,
 * spread above the far half of the field. A stand-in: the real level's
 * spawn points replace it.
 */
export function standInLevel(v: DroneRunVariant, entry: Vec3 | null): LevelInfo {
  const zones = v.spec.zones
  if (!zones) throw new Error('This variant has no zones to play.')
  const ids = [...new Set(v.spec.waves.flatMap((w) => w.spawns.map((s) => s.at)).filter((a): a is string => typeof a === 'string'))].sort()
  const s = zones.start, f = zones.finish
  const x0 = Math.min(s.lo[0], f.lo[0]), x1 = Math.max(s.hi[0], f.hi[0])
  const zNear = Math.min(s.lo[2], s.hi[2]), zFar = Math.max(f.lo[2], f.hi[2])
  const floor = Math.min(s.lo[1], f.lo[1])
  const spawns = ids.map((id, i) => {
    const across = ids.length > 1 ? i / (ids.length - 1) : 0.5
    const depth = 0.15 + 0.55 * ((i * 7) % ids.length) / Math.max(1, ids.length)
    return { id, at: [Math.round(x0 + (x1 - x0) * across), floor + 24, Math.round(zFar + (zNear - zFar) * depth)] as Vec3 }
  })
  const mid: Vec3 = [Math.round((s.lo[0] + s.hi[0]) / 2), s.lo[1], Math.round((s.lo[2] + s.hi[2]) / 2)]
  return { zones, entry: entry ?? mid, spawns }
}

/**
 * The world shards DRONE RUN draws: all but the entry marker. A world's
 * first item is its entry marker, standing exactly at the entry point
 * (DECK-0002 §2.2; level/build.ts and level/levelWorld.ts put it there). It
 * marks where a player appears; here the safe zone is marked already (Zones),
 * and the pale plate made a cyan patch on the ground at the start. The marker
 * stays in the world as published; it is only not drawn.
 */
export function drawnWorld(world: readonly WorldShard[], entry: Position | null): WorldShard[] {
  const first = world[0]
  const marker = !!first && !!entry && first.at.x === entry.x && first.at.y === entry.y && first.at.z === entry.z
  return marker ? world.slice(1) : [...world]
}
