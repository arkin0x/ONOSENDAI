/**
 * levelSource.ts - where a DRONE RUN session's world and level come from: the
 * seam between the game's bracket (store/useGame, the same enter-virtual and
 * region whichever field is played) and the field the player chose on this
 * device (levelChoice.ts).
 *
 * - BUILT-IN FIELD (no choice, or a chosen level that is gone): the world read
 *   as any game's world is read (lib/games/world.ts loadWorld, from the bundled
 *   fixture signed by the DEV key), and the level it was built from, kept in
 *   the same fixture file (`level`).
 * - An IMPORTED level: the world built on this device from the level and its
 *   payloads as kept (levelDb.ts, level/levelWorld.ts). Nothing is read from a
 *   relay and nothing is signed for it.
 *
 * Either way the session gets the same things: the shards, the entry point
 * (the level's entry), and the Level itself (zones, entry, spawns, patrol)
 * for the simulation and the HUD. Loaded only when a DRONE RUN session reads
 * its world (useGame imports this lazily), so none of it is in the main bundle.
 */

import { loadWorld, type World } from '../world'
import type { GameDef } from '../types'
import { readLevel, type Level } from './level/level'
import { worldFromLevel } from './level/levelWorld'
import { chooseLevel, chosenLevel } from './levelChoice'
import { getLevel, openLevelsDb } from './levelDb'

/** Which field a session plays. */
export type FieldSource = { kind: 'built-in' } | { kind: 'imported'; id: string; name: string }

/** A DRONE RUN session's world: the shards and entry point, the level, and which field it is. */
export interface DroneRunWorld extends World {
  level: Level
  field: FieldSource
}

/** The built-in field's level, as the bundled fixture keeps it beside its world. */
export async function builtInLevel(): Promise<Level> {
  const fixture = (await import('./fixture/droneRun.fixture.json')).default as { level: unknown }
  return readLevel(fixture.level)
}

/** An imported level by id from this device, or null when it is not kept here (or storage cannot be opened). */
async function importedLevel(id: string): Promise<{ id: string; name: string; level: Level; payloads: Record<string, unknown> } | null> {
  let db: IDBDatabase
  try { db = await openLevelsDb() } catch { return null }
  try {
    const row = await getLevel(db, id)
    return row ? { id: row.id, name: row.name, level: readLevel(row.level), payloads: row.payloads } : null
  } finally { db.close() }
}

/**
 * The world and level `game` plays on this device: the imported level chosen
 * (`choice`, by default the remembered one), or the built-in field. A chosen
 * level that is no longer kept here falls back to the built-in field, and the
 * choice is cleared.
 */
export async function loadDroneRunWorld(game: GameDef, choice: string | null = chosenLevel()): Promise<DroneRunWorld> {
  if (choice) {
    const got = await importedLevel(choice)
    if (got) return { ...worldFromLevel(game, `drone-run-level:${got.id}`, got.level, got.payloads), level: got.level, field: { kind: 'imported', id: got.id, name: got.name } }
    chooseLevel(null)
  }
  const [world, level] = await Promise.all([loadWorld(game), builtInLevel()])
  return { ...world, level, field: { kind: 'built-in' } }
}
