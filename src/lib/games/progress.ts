/**
 * progress.ts - the key door and the clear time, as game logic (DECK-0002 §8:
 * what an item of the world means, scores and results are the game's). Pure.
 *
 * - What a tap can do where you stand (offerHere): TAKE by a key lying within
 *   reach, OPEN or LOCKED by a shut door, never by walking into either (the
 *   owner's rule: nothing opens or is taken automatically, ever). What lies
 *   where comes from the world: for a world whose gate is a DECK-0004 door,
 *   the key items revealed from the key bag and the door (lib/games/keyDoor.ts
 *   thingsNow); for the LEGACY world, the game's own key and gate (legacyThings).
 * - The clear time: from entering the game to reaching its exit zone, kept
 *   on this device. It is not on the chain (DECK-0002 says nothing of
 *   results; the base protocol leaves them to the game, §8.11.7).
 *
 * LEGACY (the world published 2026-11-13, until the world with a real door is
 * live): there the key is a thing of this game only, not a key item of
 * cyberspace. A world shard at the game's `key.at` is its look, gone once
 * taken; the world shards at `door.at` are the gate's closed look (one that
 * holds a walker) and open look (one that does not); OPEN uses the key
 * (keyHeld false, doorOpen true). takeKey, openDoor, worldNow and offerAt are
 * that world's, and go with it.
 */

import { blocks } from '../walkConstrain'
import type { Position } from '../space'
import type { WorldShard } from './play'
import type { GameDef, GameZone } from './types'

export interface Progress {
  /** When the clock started (ms since the epoch): the entry. */
  startedAt: number
  /** LEGACY: the game-only key is in hand. A real key item is held in ITEMS instead (store/useInventory). */
  keyHeld: boolean
  /** The door is open: opened by OPEN in this run. */
  doorOpen: boolean
  /** The DECK-0004 door it was opened on (its event id); absent for the LEGACY gate. A world whose door is another starts shut. */
  doorId?: string
  /** The clear time, once the exit zone was reached. */
  clearedMs: number | null
}

/** How near the key you must stand to take it, in gibsons along every axis from the gibson above it. */
export const KEY_REACH = 2
/** How near the door you must stand to open it, in gibsons along every axis from the gibson above its sill. */
export const DOOR_REACH = 3

type Rules = Pick<GameDef, 'key' | 'door' | 'exit'>

export function startProgress(now: number): Progress {
  return { startedAt: now, keyHeld: false, doorOpen: false, clearedMs: null }
}

const abs = (n: bigint): bigint => (n < 0n ? -n : n)

/** Whether `p` is within `reach` of the gibson just above `item` on every axis (where a player stands by it). */
export function within(p: Position, item: Position, reach: number): boolean {
  const r = BigInt(reach)
  return abs(p.x - item.x) <= r && abs(p.y - (item.y + 1n)) <= r && abs(p.z - item.z) <= r
}

export function inZone(z: GameZone, p: Position): boolean {
  return p.x >= z.lo.x && p.x <= z.hi.x && p.y >= z.lo.y && p.y <= z.hi.y && p.z >= z.lo.z && p.z <= z.hi.z
}

/** LEGACY: the game-only key has been taken (in hand, or used on the door). */
export const keyTaken = (pr: Progress): boolean => pr.keyHeld || pr.doorOpen

/** What a tap could do where the player stands, if anything: the one action button shown. */
export type Offer = 'take' | 'open' | 'locked' | null

/** What lies in the world for a tap to act on: keys to TAKE, and the door with whether a key in hand opens it. */
export interface Things {
  /** Where each key lies that can be taken. */
  keys: readonly Position[]
  /** The door, and whether a key held opens it; null when there is none. */
  door: { at: Position; opens: boolean } | null
}

/** The one action a tap would do at `at`, given what lies in the world: TAKE first, then the shut door. */
export function offerHere(things: Things, pr: Progress, at: Position): Offer {
  if (pr.clearedMs !== null) return null
  if (things.keys.some((k) => within(at, k, KEY_REACH))) return 'take'
  if (things.door && !pr.doorOpen && within(at, things.door.at, DOOR_REACH)) return things.door.opens ? 'open' : 'locked'
  return null
}

/** LEGACY: the game-only key (until taken) and gate (opened by the key in hand). */
export function legacyThings(game: Rules, pr: Progress): Things {
  return {
    keys: game.key && !keyTaken(pr) ? [game.key.at] : [],
    door: game.door ? { at: game.door.at, opens: pr.keyHeld } : null,
  }
}

/** LEGACY: what a tap would do in the world with the game-only key and gate. */
export function offerAt(game: Rules, pr: Progress, at: Position): Offer {
  return offerHere(legacyThings(game, pr), pr, at)
}

/** LEGACY TAKE: the key into hand, when within reach. Null when there is nothing to take here. */
export function takeKey(game: Rules, pr: Progress, at: Position): Progress | null {
  return offerAt(game, pr, at) === 'take' ? { ...pr, keyHeld: true } : null
}

/** LEGACY OPEN: the door, with the key in hand and within reach; the key is used. Null otherwise. */
export function openDoor(game: Rules, pr: Progress, at: Position): Progress | null {
  return offerAt(game, pr, at) === 'open' ? { ...pr, keyHeld: false, doorOpen: true } : null
}

/** The clock stops at the exit zone, once. */
export function reachExit(game: Rules, pr: Progress, at: Position, now: number): Progress {
  if (pr.clearedMs !== null || !game.exit || !inZone(game.exit, at)) return pr
  return { ...pr, clearedMs: Math.max(0, now - pr.startedAt) }
}

/** The time on the clock: the clear time once cleared, else how long since entry. */
export function clockMs(pr: Progress, now: number): number {
  return pr.clearedMs ?? Math.max(0, now - pr.startedAt)
}

/** A clear time as M:SS.t (tenths), the way it is shown. */
export function formatClearTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`
}

const same = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y && a.z === b.z

/**
 * LEGACY: the world as it stands with this progress: what is drawn, and what holds a
 * walker. The key's look is gone once taken. At the door, the closed look
 * stands until it is opened and the open look after.
 */
export function worldNow(game: Rules, world: readonly WorldShard[], pr: Progress): { drawn: WorldShard[]; solid: WorldShard[] } {
  const drawn = world.filter((w) => {
    if (game.key && keyTaken(pr) && same(w.at, game.key.at)) return false
    if (game.door && same(w.at, game.door.at)) return blocks(w.shard) ? !pr.doorOpen : pr.doorOpen
    return true
  })
  return { drawn, solid: drawn }
}
