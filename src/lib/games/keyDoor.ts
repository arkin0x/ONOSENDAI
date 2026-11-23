/**
 * keyDoor.ts - a game's key and gate as Cyberspace primitives (DECK-0004), not
 * game-only things (owner, 2026-11-13: "the key and lock should be cyberspace
 * primitives, not special game-based implementations of a key and lock").
 *
 * - The key is a key item (kind 3340) the game key signed, in a bag of its
 *   own sealed to a small region around where it lies (GameDef keyBag): not
 *   to the game's region, so the world bag alone never opens it (owner: "cant
 *   the key still be encrypted to its location?"). Reaching that region in
 *   the game derives its key, the work of being there, and opens it
 *   (readKeyBag). TAKE holds the key item like any other: into ITEMS
 *   (store/useInventory holdFinds), on this device, publishing nothing.
 * - The gate is a door (kind 3341 with a `door` tag), stored inline in the
 *   world bag (spec §7.6: a door stays inline), sealed to the key item's
 *   public key. OPEN opens it with the key held, exactly as any door is opened
 *   (lib/chests.ts openerFor, lib/doors.ts doorSecretWithKey), and its room
 *   bag is read with the room key (readRoom). Its closed and open looks are
 *   its own `look` tags (DECK-0004 §3.6), drawn and solid as the door stands.
 *
 * A world whose newest bag holds no door is the LEGACY world (the game-only
 * key and gate, lib/games/progress.ts legacyThings, worldNow): sceneNow and
 * thingsNow choose by the world, so this client plays either.
 *
 * Every event is read where the game's world is read (lib/games/source.ts):
 * the relays for a live game, the bundled fixture for the DEV game.
 */

import { verifyEvent } from 'nostr-tools/pure'
import { HIDDEN_KIND, dOf, itemLineage, unbag, type Hidden } from '../hidden'
import { hexToBytes, type NostrEvent } from '../events'
import { regionKeyAt } from '../shardCrypto'
import { doorSecretWithKey, inRoom, regionBase, roomKey, roomLookupId } from '../doors'
import { drawnLook, lookOf } from '../looks'
import { openerFor, type OpeningKey } from '../chests'
import { holdsItem, inItems, openingKeys, type HeldItem } from '../inventory'
import { askGame, resolverOf } from './source'
import { inRegion, type WorldShard } from './play'
import { legacyThings, worldNow, type Progress, type Things } from './progress'
import type { GameDef } from './types'
import type { Position } from '../space'

/** The highest region a key bag or a room is read at: as for the world (world.ts WORLD_MAX_HEIGHT, DECK-0002 §5.2). */
const MAX_HEIGHT = 8

/**
 * The world's door (DECK-0004 §3.7): the first door of the newest world bag
 * that the bag reader kept (lib/hidden.ts unbag: well-formed height, no higher
 * than the bag, never from a sealed entry or a chest), stored inline, signed by
 * the game key, inside the region in its plane. Null for the LEGACY world.
 */
export function worldDoorOf(game: Pick<GameDef, 'pubkey' | 'region'>, items: readonly Hidden[]): Hidden | null {
  return items.find((h) => h.type === 'chest' && h.chest?.door !== undefined && !h.ref && !h.sealedRef && !h.chestId
    && h.inner?.pubkey === game.pubkey && !!h.inner.sig && h.plane === game.region.plane && inRegion(game, h.at)) ?? null
}

/** Whether `p` stands in the region the key bag is sealed to (same plane: the game's). */
export function inKeyBag(game: Pick<GameDef, 'keyBag'>, p: Position): boolean {
  return !!game.keyBag && inRoom(game.keyBag.at, game.keyBag.height, p)
}

/** The newest of the game key's bags at `d` by `author`, verified: a bag is addressable (spec §7.6). */
async function newestBag(game: Pick<GameDef, 'world' | 'relayHint'>, author: string, d: string): Promise<NostrEvent | null> {
  const bags = (await askGame(game, { kinds: [HIDDEN_KIND], authors: [author], '#d': [d] }))
    .filter((e) => e.kind === HIDDEN_KIND && e.pubkey === author && dOf(e) === d && verifyEvent(e))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))
  return bags[0] ?? null
}

/**
 * The key bag opened (spec §7.2, §7.6): the region of the key bag's height
 * holding its place, its key derived here (trivial at a small height), the
 * game key's newest bag with that region's lookup id, and the key items in it
 * that stand inside that region, in the game's plane. Empty when there is no
 * such bag; throws when the bag does not open.
 */
export async function readKeyBag(game: Pick<GameDef, 'pubkey' | 'region' | 'world' | 'relayHint' | 'keyBag'>): Promise<Hidden[]> {
  const kb = game.keyBag
  if (!kb || kb.height < 1 || kb.height > MAX_HEIGHT) return []
  const base = regionBase(kb.at, kb.height)
  const { key, lookupId } = regionKeyAt(base, kb.height, MAX_HEIGHT)
  const bag = await newestBag(game, game.pubkey, lookupId)
  if (!bag) return []
  const items = await unbag(bag, key, resolverOf(game), { at: base, plane: game.region.plane }, kb.height)
  return items.filter((h) => h.type === 'key' && !!h.key && !!h.inner && h.plane === game.region.plane && inRoom(base, kb.height, h.at))
}

/** Whether this identity holds the key item `h` (in ITEMS, archived included): by its id, its lineage or its keypair, as everywhere. */
export function keyItemHeld(items: Record<string, HeldItem>, h: Pick<Hidden, 'eventId' | 'inner' | 'key'>): boolean {
  return holdsItem(inItems(items), h.eventId, itemLineage(h.inner), h.inner?.pubkey, undefined, h.key?.itemPubkey ?? null)
}

/** The held key item that opens `door`, or null (DECK-0004 §3.3: a held item whose public key is the lock). */
export function doorKey(door: Pick<Hidden, 'chest'>, items: Record<string, HeldItem>, me: string): OpeningKey | null {
  if (!door.chest) return null
  const opener = openerFor(door.chest, openingKeys(inItems(items)), me)
  return opener?.by === 'key' ? opener.key : null
}

/** The door's secret, read with a held key item (DECK-0004 §3.7.3 step 1), or null when that key does not open it. */
export function doorSecretWith(door: Pick<Hidden, 'chest'>, key: OpeningKey): string | null {
  if (!door.chest) return null
  try { return doorSecretWithKey(door.chest, key.secretHex) } catch { return null }
}

/** What opening the door's room read: its shards, and whether its bag was found at all (§3.7.3: say so when it was not). */
export interface GameRoom {
  shards: WorldShard[]
  found: boolean
}

/**
 * The room behind the door, read with its secret (DECK-0004 §3.7.2, §3.7.3):
 * the location key of the room's region, the room key from it and the
 * secret, the door signer's newest bag with the room's lookup id, opened with
 * the room key. Its shards in the door's plane and inside the game's region.
 */
export async function readRoom(game: Pick<GameDef, 'region' | 'world' | 'relayHint'>, door: Hidden, secretHex: string): Promise<GameRoom> {
  const h = door.chest?.door
  const signer = door.inner?.pubkey
  if (h === undefined || !signer || h > MAX_HEIGHT) return { shards: [], found: false }
  const base = regionBase(door.at, h)
  const key = roomKey(regionKeyAt(base, h, MAX_HEIGHT).key, hexToBytes(secretHex))
  const bag = await newestBag(game, signer, roomLookupId(key))
  if (!bag) return { shards: [], found: false }
  const items = await unbag(bag, key, resolverOf(game), { at: base, plane: door.plane }, h, undefined, { doorId: door.eventId })
  const shards = items
    .filter((it) => it.type === 'shard' && it.shard && it.plane === door.plane && inRegion(game, it.at))
    .map((it) => ({ key: it.eventId, shard: it.shard!, at: it.at, height: it.height }))
  return { shards, found: true }
}

/**
 * The door as it is drawn and walked into (DECK-0004 §3.6): its closed look
 * until opened, its open look after, at its coordinate, cut to the bag that
 * holds it. Nothing for an opened door with no open look.
 */
export function doorLooks(door: Hidden, opened: boolean): WorldShard[] {
  const look = lookOf({ type: 'chest', event: door.inner })
  const model = look ? drawnLook(look, opened) : null
  return model ? [{ key: `${door.eventId}:${opened ? 'open' : 'closed'}`, shard: model, at: door.at, height: door.height }] : []
}

/** A game's scene as it was read: the world's shards, its door, and its room once opened. */
export interface Scene {
  shards: readonly WorldShard[]
  door: Hidden | null
  room: readonly WorldShard[] | null
}

/**
 * What is drawn and what holds a walker. With a door: the world, the door's
 * look as it stands, and its room once opened. Without one: the LEGACY world
 * (lib/games/progress.ts worldNow).
 */
export function sceneNow(game: Pick<GameDef, 'key' | 'door' | 'exit'>, scene: Scene, pr: Progress): { drawn: WorldShard[]; solid: WorldShard[] } {
  if (!scene.door) return worldNow(game, scene.shards, pr)
  const all = [...scene.shards, ...doorLooks(scene.door, pr.doorOpen), ...(pr.doorOpen ? scene.room ?? [] : [])]
  return { drawn: all, solid: all }
}

/**
 * What a tap can act on (lib/games/progress.ts offerHere). With a door: the
 * key items revealed from the key bag that this identity does not hold, and
 * the door, which a held key item opens or not. Without one: the LEGACY key
 * and gate.
 */
export function thingsNow(game: Pick<GameDef, 'key' | 'door' | 'exit'>, scene: { door: Hidden | null; keys: readonly Hidden[] }, pr: Progress, items: Record<string, HeldItem>, me: string): Things {
  if (!scene.door) return legacyThings(game, pr)
  return {
    keys: scene.keys.filter((k) => !keyItemHeld(items, k)).map((k) => k.at),
    door: { at: scene.door.at, opens: doorKey(scene.door, items, me) !== null },
  }
}
