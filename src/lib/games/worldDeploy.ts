/**
 * worldDeploy.ts - the tutorial dungeon's world, built for the game key: pure,
 * it sends nothing anywhere. Used only by the generator
 * (__tests__/tutorialDungeon.gen.test.ts) and its tests, never by the app.
 *
 * buildDungeon is the world with a real key item and door (owner, 2026-11-13,
 * ruled A; games-dungeon/DESIGN.md, "The key and the gate as Cyberspace
 * primitives"). Four events, published in this order:
 *
 * 1. the key's model: a PUBLIC kind 33331 object, the gold key, which the key
 *    item wears by address (DECK-0004 §2.5: a model is a public object);
 * 2. the key bag: a kind 33330 sealed to the small region around the top
 *    platform (tutorialGame.ts KEY_BAG), holding the key item, inline and
 *    signed by the game key. The world bag never names it: it is found as any
 *    bag is, by its region's lookup id;
 * 3. the room bag: the gate door's room (DECK-0004 §3.7.2), the region of
 *    height 5 that is the way out, sealed with the room key, holding the
 *    finish tile, inline and signed;
 * 4. the world bag, LAST, so no reader finds a gate before its key and its
 *    room exist: the entry point inline first (DECK-0002 §2.2), the door inline
 *    (spec §7.6: a door stays inline), sealed to the key item, wearing the
 *    hall gate as its looks, and the rest of the dungeon.
 *
 * The key bag and the world bag carry the sector hint (spec §7.7), as every new
 * bag ONOSENDAI hides; the room bag carries no hint, no sector tag and no
 * height, as DECK-0004 §3.7.2 requires of every room bag.
 *
 * The rest of the dungeon comes in one of two forms. `references`, the owner's
 * world: the eleven unchanged pieces by reference to the objects published
 * 2026-11-13 under the game key, at their addresses and coordinates, so none
 * of them is published again. `inline`, the DEV fixture: every piece an inline
 * shard signed by the DEV key, as the fixture has always been.
 *
 * The door and the key item are signed inside their bags, so the bags are
 * sealed over those signatures: building needs the game key's signer, and the
 * bags' own templates come out unsigned, to be signed as they are.
 *
 * unsignedWorld is the world published 2026-11-13 (LEGACY: game-only key and
 * gate), kept for the tests that publish it under a throwaway key and check
 * this client still plays it.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { fromPayload, type ShardModel } from 'sno-core/shards'
import { bagTemplate, newBagSettings, chestInnerTemplate, innerAuthentic, keyInnerTemplate, keyItemOf, KEY_KIND, objectTemplateOf, OBJECT_KIND, rumorOf, shardInnerTemplate, SHARD_KIND, HIDDEN_KIND, type BagEntry, type KeyItem, type Reference, type Rumor } from '../hidden'
import { BAG_SAFE_BYTES, signedBytes } from '../bagSize'
import { bytesToHex, hexToBytes, positionHex, type EventTemplate, type NostrEvent } from '../events'
import { forgeKey, sealEntries } from '../chests'
import { newDoorSecret, regionBase, roomEntries, roomKey, roomLookupId, ROOM_BAG_SETTINGS } from '../doors'
import { lookTags } from '../looks'
import { publicObjectTemplate } from '../published'
import { regionKeyAt } from '../shardCrypto'
import { DOOR_AT, GATE_AT, GATE_DOOR_HEIGHT, KEY_BAG, TUTORIAL_DEV_PUBKEY, TUTORIAL_DUNGEON_LAYOUT, TUTORIAL_ENTRY } from './tutorialGame'
import { bagList, ENTRY_TAG, worldKey } from './world'
import type { GameDef } from './types'
import type { Position } from '../space'

/** An event as nak signs it: everything but `id` and `sig`. */
export type UnsignedEvent = EventTemplate & { pubkey: string }

/** One file of the deploy folder: its name (the order to publish in) and its event. */
export interface WorldFile {
  name: string
  event: UnsignedEvent
}

const utf8 = new TextEncoder()

/** The pieces of the dungeon by name (TUTORIAL_DUNGEON_LAYOUT's, and `entry`), each its shard. */
export type Pieces = Readonly<Record<string, ShardModel>>

/**
 * The pieces, read from the published-form bag of the 2026-11-13 dungeon (the
 * v1 DEV fixture: the entry marker, then TUTORIAL_DUNGEON_LAYOUT in order,
 * each an inline shard signed by `signer`), so every build is made of the
 * very payloads every test has played.
 */
export async function piecesOf(v1Bag: NostrEvent, signer: string, game: Pick<GameDef, 'region'>): Promise<Pieces> {
  const list = await bagList(v1Bag, worldKey(game).key)
  if (!list || list.length !== TUTORIAL_DUNGEON_LAYOUT.length + 1) throw new Error('the v1 bag is not the 2026-11-13 dungeon')
  const names = ['entry', ...TUTORIAL_DUNGEON_LAYOUT.map((l) => l.piece)]
  const out: Record<string, ShardModel> = {}
  for (const [i, e] of list.entries()) {
    const item = e as Rumor
    if (!item || Array.isArray(item) || item.kind !== SHARD_KIND || !innerAuthentic(item, signer)) throw new Error(`v1 entry ${i} is not a shard signed by ${signer}`)
    const shard = fromPayload(JSON.parse(item.content), `tutorial-${names[i]}`)
    if (!shard) throw new Error(`v1 entry ${i} is not a shard`)
    out[names[i]] ??= shard
  }
  return out
}

/** The `d` of the key's public model: fixed, so a rebuild replaces it (DECK-0003 §3.1). */
export const KEY_MODEL_D = 'tutorial-dungeon-key'
/**
 * The key item as it is named and described (DECK-0004 §2.1). "Tutorial
 * Dungeon Key", so it has a fairly benign namespace among all items (owner,
 * 2026-11-14); it was "Dungeon Key" when the world went up that day, and the
 * published key item was renamed with renamedKeyBag, keeping its secret.
 */
export const KEY_NAME = 'Tutorial Dungeon Key'
export const KEY_ABOUT = 'Opens the gate of the tutorial dungeon.'
/**
 * The door as it is named, and what it says it asks for (DECK-0004 §3.1).
 * GATE_REQUIRES records ON PURPOSE the text of the door published 2026-11-14,
 * which still says "The Dungeon Key" after the key's rename: that text is
 * signed inside the world bag, and changing it there is a new door and a new
 * world bag, which shuts the gate on every run in progress. Kept so a rebuild
 * (and the DEV fixture) matches the live door; change it together with the
 * next world bag that goes up anyway.
 */
export const GATE_NAME = 'Dungeon Gate'
export const GATE_REQUIRES = 'The Dungeon Key'

/** The pieces the world bag carries in the world with a door: all but the key's look, the gate's two looks (now the door's) and the finish tile (now in the room). */
export const MOVED_PIECES: ReadonlySet<string> = new Set(['key', 'gate-closed', 'gate-open', 'finish'])

/** Where the finish tile stands: its place in the layout. */
export const FINISH_AT: Position = TUTORIAL_DUNGEON_LAYOUT.find((l) => l.piece === 'finish')!.at

/**
 * A piece moved along cyberspace Z by `dz` gibsons relative to its origin, for a
 * look whose door stands `dz` from where the piece stood: a model's +Z is
 * cyberspace -Z (lib/games/play.ts), and a unit-0 model unit is one gibson.
 */
export function shiftedZ(shard: ShardModel, dz: number): ShardModel {
  if (shard.unit !== 0 || !Number.isInteger(dz)) throw new Error('a whole-gibson shift of a unit-0 piece only')
  const vertices = shard.vertices.map((v) => ({ ...v, p: [v.p[0], v.p[1], v.p[2] - dz] as [number, number, number] }))
  const reach = Math.max(shard.extent, ...vertices.map((v) => Math.abs(v.p[2]) + 1))
  return { ...shard, vertices, extent: reach }
}

/** Signs one event as the game key: the generator's, holding the key's secret (lib/signers.ts is the app's only raw-key signer). */
export type SignAsGame = (template: EventTemplate) => NostrEvent

/** What a build made: its files in publish order (unsigned), and what is sealed inside them, for checks. */
export interface DungeonBuild {
  files: WorldFile[]
  /** The key item, signed, as sealed in the key bag. */
  keyItem: NostrEvent
  /** The door, signed, as stored in the world bag. */
  door: NostrEvent
  /** The door's secret (DECK-0004 §3.7.1). */
  doorSecret: string
}

/**
 * The world with a real key item and door (see the top of this file), for
 * the game key, every inner event signed by `sign` (the game key's signer, the
 * caller's), dated `createdAt`. `secrets` fixes the
 * key item's secret and the door secret, for tests; otherwise both are fresh
 * from the platform's secure source, as every key item and door is.
 */
export async function buildDungeon(game: Pick<GameDef, 'pubkey' | 'relayHint' | 'region'>, signAs: SignAsGame, pieces: Pieces, createdAt: number, form: 'references' | 'inline', secrets: { key?: string; door?: string } = {}): Promise<DungeonBuild> {
  const pk = game.pubkey
  const sign = (t: EventTemplate): NostrEvent => {
    const e = signAs(t)
    if (e.pubkey !== pk) throw new Error('the signer is not the game key')
    return e
  }
  if (form === 'references' && pk === TUTORIAL_DEV_PUBKEY) throw new Error('the DEV key\'s world is the bundled fixture; it is never published')
  const piece = (name: string): ShardModel => {
    const p = pieces[name]
    if (!p) throw new Error(`no piece ${name}`)
    return p
  }
  const { plane, height } = game.region
  const files: WorldFile[] = []
  const file = (name: string, t: EventTemplate): void => { files.push({ name, event: { ...t, pubkey: pk } }) }

  // 1. The key's model, public (DECK-0004 §2.5).
  const model = publicObjectTemplate({ ...piece('key'), id: KEY_MODEL_D }, createdAt)
  file(`01-key-model-${OBJECT_KIND}.json`, model)
  const address = `${OBJECT_KIND}:${pk}:${KEY_MODEL_D}`

  // 2. The key item, signed, in the key bag sealed to its small region (DECK-0004 §2, spec §7.6).
  const forged = forgeKey(KEY_NAME, KEY_ABOUT)
  const secretHex = secrets.key ?? forged.secretHex
  const key: KeyItem = { ...forged, secretHex, itemPubkey: getPublicKey(hexToBytes(secretHex)), model: { address, ...(game.relayHint ? { relay: game.relayHint } : {}) }, animation: ['bob', 'spin-y'] }
  const keyItem = sign(keyInnerTemplate(key, KEY_BAG.at, plane, createdAt))
  const kb = regionKeyAt(regionBase(KEY_BAG.at, KEY_BAG.height), KEY_BAG.height, 8)
  // With the sector hint, as every new bag ONOSENDAI hides (owner, 2026-11-13 and 2026-11-14; spec §7.7).
  file(`02-key-bag-${HIDDEN_KIND}.json`, await bagTemplate([keyItem as unknown as BagEntry], kb.key, kb.lookupId, KEY_BAG.height, createdAt, HIDDEN_KIND, newBagSettings(KEY_BAG.height), { at: KEY_BAG.at, plane }))

  // 3. The door, sealed to the key item, and its room holding the finish tile (DECK-0004 §3.7).
  const doorSecret = secrets.door ?? newDoorSecret()
  const sealed = sealEntries(roomEntries(doorSecret) as BagEntry[], key.itemPubkey)
  // At DOOR_AT, its looks shifted back by the same gibson, so the gate stands where it stood (tutorialGame.ts DOOR_AT).
  const dz = Number(DOOR_AT.z - GATE_AT.z)
  const look = lookTags(shiftedZ(piece('gate-closed'), dz), shiftedZ(piece('gate-open'), dz))
  const door = sign(chestInnerTemplate({ name: GATE_NAME, lockPubkey: key.itemPubkey, senderPubkey: sealed.senderPubkey, requires: GATE_REQUIRES, payload: sealed.payload, look, door: GATE_DOOR_HEIGHT }, DOOR_AT, plane, createdAt))
  const location = regionKeyAt(regionBase(DOOR_AT, GATE_DOOR_HEIGHT), GATE_DOOR_HEIGHT, 8).key
  const rk = roomKey(location, hexToBytes(doorSecret))
  const finish = sign(shardInnerTemplate(piece('finish'), FINISH_AT, plane, createdAt))
  file(`03-room-bag-${HIDDEN_KIND}.json`, await bagTemplate([finish as unknown as BagEntry], rk, roomLookupId(rk), GATE_DOOR_HEIGHT, createdAt, HIDDEN_KIND, ROOM_BAG_SETTINGS))

  // 4. The world bag, last: the entry point inline and first (DECK-0002 §2.2: the first with the tag counts), the door inline, the rest.
  const { key: wk, lookupId } = worldKey(game)
  const markerTemplate = shardInnerTemplate(piece('entry'), TUTORIAL_ENTRY, plane, createdAt)
  const markerTags = [...markerTemplate.tags, [ENTRY_TAG]]
  const kept = TUTORIAL_DUNGEON_LAYOUT.map((l, i) => ({ ...l, v1: i + 1 })).filter((l) => !MOVED_PIECES.has(l.piece))
  let entries: BagEntry[]
  if (form === 'references') {
    // The entry marker as the game key's rumor (vouched for by the bag, spec §7.6 Rumors), and its star by reference, as published 2026-11-13.
    const entry = rumorOf({ kind: SHARD_KIND, created_at: createdAt, tags: markerTags, content: markerTemplate.content }, pk)
    const refs: Reference[] = [{ v1: 0, at: TUTORIAL_ENTRY }, ...kept].map((l) => ['a', `${OBJECT_KIND}:${pk}:${objectD(game, l.v1)}`, game.relayHint, positionHex(l.at, plane)])
    entries = [entry, door as unknown as BagEntry, ...refs]
  } else {
    const entry = sign({ ...markerTemplate, tags: markerTags })
    const shards = kept.map((l, i) => sign(shardInnerTemplate(piece(l.piece), l.at, plane, createdAt + 1 + i)))
    entries = [entry, ...shards, door].map((e) => e as unknown as BagEntry)
  }
  // With the sector hint (owner, 2026-11-14), as the key bag. The room bag carries none: DECK-0004 §3.7.2 forbids it.
  const bag = await bagTemplate(entries, wk, lookupId, height, createdAt, HIDDEN_KIND, newBagSettings(height), { at: game.region.base, plane })
  if (signedBytes(bag) > BAG_SAFE_BYTES) throw new Error(`the world bag is ${signedBytes(bag)} bytes, over ${BAG_SAFE_BYTES}`)
  file(`99-world-bag-${HIDDEN_KIND}.json`, bag)
  return { files, keyItem, door, doorSecret }
}

/** What renamedKeyBag made: the new key bag (unsigned), and the key item sealed in it, signed. */
export interface RenamedKeyBag {
  file: WorldFile
  keyItem: NostrEvent
  /** The key item it replaces, as it was sealed in the published bag. */
  was: NostrEvent
}

/**
 * The published key bag `published`, with its key item renamed to KEY_NAME and
 * described as KEY_ABOUT, and NOTHING else changed: the same secret (so the
 * same item public key, the door's lock: the door, its secret, its room and
 * the world bag are untouched), the same place, model, motions and date on the
 * item; the same `d`, height, hint and sector tags on the bag, which is newer
 * (`createdAt`, after the published one's), so it replaces it at its address.
 * The key item is signed again by `signAs` (the game key: its title is under
 * its signature) and the bag sealed again with the region key. Throws unless
 * the published bag is the game key's key bag holding exactly one key item
 * signed by the game key.
 */
export async function renamedKeyBag(game: Pick<GameDef, 'pubkey' | 'region'>, signAs: SignAsGame, published: NostrEvent, createdAt: number): Promise<RenamedKeyBag> {
  const pk = game.pubkey
  const { plane } = game.region
  const kb = regionKeyAt(regionBase(KEY_BAG.at, KEY_BAG.height), KEY_BAG.height, 8)
  if (published.pubkey !== pk || published.kind !== HIDDEN_KIND || !verifyEvent(published) || published.tags.find((t) => t[0] === 'd')?.[1] !== kb.lookupId) throw new Error('that is not the game key\'s key bag')
  if (!(createdAt > published.created_at)) throw new Error('the renamed bag must be newer than the published one')
  const list = await bagList(published, kb.key)
  if (!list || list.length !== 1) throw new Error('the key bag does not open to exactly one entry')
  const was = list[0] as NostrEvent
  if (!was || Array.isArray(was) || was.kind !== KEY_KIND || !innerAuthentic(was, pk)) throw new Error('the key bag\'s entry is not a key item signed by the game key')
  const old = keyItemOf(was)
  if (!old) throw new Error('the key bag\'s key item does not read')
  if (old.name === KEY_NAME) throw new Error(`the key item is already named ${KEY_NAME}`)
  // The published item's own tags and date, with only its title and description changed.
  const template: EventTemplate = { kind: KEY_KIND, created_at: was.created_at, content: KEY_ABOUT, tags: was.tags.map((t) => t[0] === 'title' ? ['title', KEY_NAME] : [...t]) }
  // Exactly what buildDungeon writes for this item under its new name (keyInnerTemplate at KEY_BAG.at), so no tag was kept that a fresh build would not write, and the item stands where it stood.
  const fresh = keyInnerTemplate({ ...old, name: KEY_NAME, about: KEY_ABOUT }, KEY_BAG.at, plane, was.created_at)
  if (JSON.stringify(fresh) !== JSON.stringify(template)) throw new Error('the published key item is not one this builder would write: rename it by hand')
  const keyItem = signAs(template)
  if (keyItem.pubkey !== pk || !innerAuthentic(keyItem, pk)) throw new Error('the signer is not the game key')
  const now = keyItemOf(keyItem)
  if (!now || now.secretHex !== old.secretHex || now.itemPubkey !== old.itemPubkey || now.name !== KEY_NAME) throw new Error('the renamed key item is not the same key')
  const bag = await bagTemplate([keyItem as unknown as BagEntry], kb.key, kb.lookupId, KEY_BAG.height, createdAt, HIDDEN_KIND, newBagSettings(KEY_BAG.height), { at: KEY_BAG.at, plane })
  // Every tag of the bag but its ciphertext as published: the same address, height, hint and sector.
  const outside = (tags: string[][]): string => JSON.stringify(tags.filter((t) => t[0] !== 'encrypted'))
  if (outside(bag.tags) !== outside(published.tags) || bag.content !== published.content) throw new Error('the renamed bag\'s outside differs from the published one\'s')
  return { file: { name: `02-key-bag-${HIDDEN_KIND}.json`, event: { ...bag, pubkey: pk } }, keyItem, was }
}

/** The `d` of the object at place `i`: fixed, so a rebuild replaces it (32 hex, as placement ids are). */
export function objectD(game: Pick<GameDef, 'pubkey'>, i: number): string {
  return bytesToHex(sha256(utf8.encode(`ONOSENDAI tutorial dungeon object ${game.pubkey} ${i}`))).slice(0, 32)
}

/** A file-name word for a shard: its payload's name, lowercase letters, digits and dashes. */
function nameOf(content: string, i: number): string {
  let name = ''
  try { name = String((JSON.parse(content) as { name?: unknown }).name ?? '') } catch { /* unnamed */ }
  const word = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return word || `shard-${i}`
}

/**
 * LEGACY: the world published 2026-11-13 (game-only key and gate) for
 * `game`, built from the v1 DEV fixture's bag `source` (signed by
 * `sourceSigner`), dated `createdAt`: the objects in fixture order, then the
 * bag, every event unsigned (one signature each). Refuses the DEV key itself.
 * Its objects' addresses are the ones buildDungeon's `references` form names.
 */
export async function unsignedWorld(game: Pick<GameDef, 'pubkey' | 'relayHint' | 'region'>, source: NostrEvent, sourceSigner: string, createdAt: number): Promise<WorldFile[]> {
  if (!/^[0-9a-f]{64}$/.test(game.pubkey)) throw new Error('the game key is 64 lowercase hex')
  if (game.pubkey === TUTORIAL_DEV_PUBKEY) throw new Error('the DEV key\'s world is the bundled fixture; it is never published')
  const { key, lookupId } = worldKey(game)
  const list = await bagList(source, key)
  if (!list) throw new Error('the fixture bag does not open with the region key')
  const items = list.map((e, i) => {
    const item = e as Rumor
    if (!item || Array.isArray(item) || item.kind !== SHARD_KIND || !innerAuthentic(item, sourceSigner)) throw new Error(`fixture entry ${i} is not a shard signed by the fixture's key`)
    const at = item.tags.find((t) => t[0] === 'C')?.[1]
    if (!at) throw new Error(`fixture entry ${i} has no C`)
    return { item, at }
  })
  const files: WorldFile[] = []
  const refs: Reference[] = []
  for (const [i, { item, at }] of items.entries()) {
    const d = objectD(game, i)
    const object = await objectTemplateOf(item.content, key, d, createdAt)
    files.push({ name: `${String(i + 1).padStart(2, '0')}-${nameOf(item.content, i)}-${OBJECT_KIND}.json`, event: { ...object, pubkey: game.pubkey } })
    refs.push(['a', `${OBJECT_KIND}:${game.pubkey}:${d}`, game.relayHint, at])
  }
  // The entry point, inline and first (the first item with the tag counts, DECK-0002 §2.2): the fixture's marker, as the game key's rumor.
  const marker = items.find(({ item }) => item.tags.some((t) => t[0] === ENTRY_TAG))
  if (!marker) throw new Error('the fixture marks no entry point')
  const entry = rumorOf({ kind: marker.item.kind, created_at: createdAt, tags: marker.item.tags, content: marker.item.content }, game.pubkey)
  const entries: BagEntry[] = [entry, ...refs]
  const bag = await bagTemplate(entries, key, lookupId, game.region.height, createdAt, HIDDEN_KIND)
  if (signedBytes(bag) > BAG_SAFE_BYTES) throw new Error(`the bag is ${signedBytes(bag)} bytes, over ${BAG_SAFE_BYTES}`)
  files.push({ name: `99-bag-${HIDDEN_KIND}.json`, event: { ...bag, pubkey: game.pubkey } })
  return files
}
