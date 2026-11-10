/**
 * world.ts - read a game's world (DECK-0002 §5.1): the bags the game key
 * signed and sealed with the region key of the game's region, opened with that
 * key, their shards placed where they stand. Nobody else's bags, whoever put
 * them in the same region.
 *
 * The region key costs the work of its height (§5.2); a dungeon's height of 6
 * is a few hundred Cantor steps per axis.
 */

import { verifyEvent } from 'nostr-tools/pure'
import { HIDDEN_KIND, dOf, unbag } from '../hidden'
import { resolveReference } from '../references'
import { query, queryAny } from '../relay'
import { regionKeyAt } from '../shardCrypto'
import type { NostrEvent } from '../events'
import type { GameDef } from './types'
import type { WorldShard } from './play'
import type { Position } from '../space'

/** A game's world as read (DECK-0002 §5.1, §2.2): its shards, and the entry point. */
export interface World {
  shards: WorldShard[]
  /** Where a player appears by virtue of entering. */
  entry: Position
}

/** The tag that marks the world item whose `C` is the entry point (DECK-0002 §2.2). */
export const ENTRY_TAG = 'entry'

/** The centre of the region, the entry point of a world that marks none: its base plus 2^(H-1) on each axis. */
export function regionCentre(game: Pick<GameDef, 'region'>): Position {
  const { base, height } = game.region
  const half = height === 0 ? 0n : 1n << BigInt(height - 1)
  return { x: base.x + half, y: base.y + half, z: base.z + half }
}

/** The highest region this reads a key for: the cap DECK-0002 §5.2 suggests, so no game can ask a phone for a key it cannot compute. */
export const WORLD_MAX_HEIGHT = 8

/** The region's key and lookup id (spec §7.2). */
export function worldKey(game: Pick<GameDef, 'region'>): { key: Uint8Array; lookupId: string } {
  const { base, height } = game.region
  if (height > WORLD_MAX_HEIGHT) throw new Error(`This game's region is too large to read here (height ${height}, at most ${WORLD_MAX_HEIGHT}).`)
  const rk = regionKeyAt(base, height, WORLD_MAX_HEIGHT)
  return { key: rk.key, lookupId: rk.lookupId }
}

/** The game key's bags for the region, from where the game says its world comes from. */
async function worldBags(game: GameDef, lookupId: string): Promise<NostrEvent[]> {
  if (game.world.kind === 'fixture') return game.world.load()
  const filter = { kinds: [HIDDEN_KIND], authors: [game.pubkey], '#d': [lookupId] }
  const [ours, hinted] = await Promise.all([
    query(filter),
    game.relayHint ? queryAny([game.relayHint], filter).catch(() => []) : Promise.resolve([]),
  ])
  return [...ours, ...hinted]
}

/**
 * The world: its shards and its entry point. A bag is addressable, so of the bags with the region's
 * `d` only the game key's newest counts, as for any author's place (spec
 * §7.6). Every bag is checked here whatever its source: signed by the game
 * key, a valid signature, the region's `d`.
 */
export async function loadWorld(game: GameDef): Promise<World> {
  const { key, lookupId } = worldKey(game)
  const bags = (await worldBags(game, lookupId))
    .filter((e) => e.kind === HIDDEN_KIND && e.pubkey === game.pubkey && dOf(e) === lookupId && verifyEvent(e))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))
  const newest = bags[0]
  if (!newest) return { shards: [], entry: regionCentre(game) }
  const { base, height, plane } = game.region
  const items = (await unbag(newest, key, resolveReference, { at: base, plane }, height)).filter((it) => it.plane === plane)
  // The first item in the bag's list that carries the entry tag (unbag keeps the list's order); the region's centre when none does.
  const marked = items.find((it) => it.inner?.tags.some((t) => t[0] === ENTRY_TAG))
  return {
    shards: items.filter((it) => it.type === 'shard' && it.shard).map((it) => ({ key: it.eventId, shard: it.shard!, at: it.at, height: it.height })),
    entry: marked ? { ...marked.at } : regionCentre(game),
  }
}
