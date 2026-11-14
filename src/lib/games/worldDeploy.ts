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
 * 3. the room bag: the gate door's room (DECK-0004 §3.7.2), sealed with the
 *    room key, holding the finish tile, inline and signed;
 * 4. the world bag, LAST, so no reader finds a gate before its key and its
 *    room exist: the entry point inline first (DECK-0002 §2.2), the door inline
 *    (spec §7.6: a door stays inline), sealed to the key item, wearing the
 *    hall gate as its looks, and the rest of the dungeon.
 *
 * The rest of the dungeon comes in one of two forms. `references`, the owner's
 * world: the eleven unchanged pieces by reference to the objects published
 * 2026-11-13 under the game key, at their addresses and coordinates, so none
 * of them is published again. `inline`, the DEV fixture: every piece an inline
 * shard signed by the DEV key, as the fixture has always been.
 *
 * The door and the key item are signed inside their bags, so the bags are
 * sealed over those signatures: building needs the game key's secret, and the
 * bags' own templates come out unsigned, to be signed as they are.
 *
 * unsignedWorld is the world published 2026-11-13 (LEGACY: game-only key and
 * gate), kept for the tests that publish it under a throwaway key and check
 * this client still plays it.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { fromPayload, type ShardModel } from 'sno-core/shards'
import { bagTemplate, chestInnerTemplate, innerAuthentic, keyInnerTemplate, objectTemplateOf, OBJECT_KIND, rumorOf, shardInnerTemplate, SHARD_KIND, HIDDEN_KIND, type BagEntry, type KeyItem, type Reference, type Rumor } from '../hidden'
import { BAG_SAFE_BYTES, signedBytes } from '../bagSize'
import { bytesToHex, hexToBytes, positionHex, type EventTemplate, type NostrEvent } from '../events'
import { forgeKey, sealEntries } from '../chests'
import { newDoorSecret, regionBase, roomEntries, roomKey, roomLookupId, ROOM_BAG_SETTINGS } from '../doors'
import { lookTags } from '../looks'
import { publicObjectTemplate } from '../published'
import { regionKeyAt } from '../shardCrypto'
import { GATE_AT, GATE_DOOR_HEIGHT, KEY_BAG, TUTORIAL_DEV_PUBKEY, TUTORIAL_DUNGEON_LAYOUT, TUTORIAL_ENTRY } from './tutorialGame'
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
/** The key item as it is named and described (DECK-0004 §2.1). */
export const KEY_NAME = 'Dungeon Key'
export const KEY_ABOUT = 'Opens the gate of the tutorial dungeon.'
/** The door as it is named, and what it says it asks for (DECK-0004 §3.1). */
export const GATE_NAME = 'Dungeon Gate'
export const GATE_REQUIRES = 'The Dungeon Key'

/** The pieces the world bag carries in the world with a door: all but the key's look, the gate's two looks (now the door's) and the finish tile (now in the room). */
export const MOVED_PIECES: ReadonlySet<string> = new Set(['key', 'gate-closed', 'gate-open', 'finish'])

/** Where the finish tile stands: its place in the layout. */
export const FINISH_AT: Position = TUTORIAL_DUNGEON_LAYOUT.find((l) => l.piece === 'finish')!.at

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
 * the game key whose secret is `sk`, dated `createdAt`. `secrets` fixes the
 * key item's secret and the door secret, for tests; otherwise both are fresh
 * from the platform's secure source, as every key item and door is.
 */
export async function buildDungeon(game: Pick<GameDef, 'pubkey' | 'relayHint' | 'region'>, sk: Uint8Array, pieces: Pieces, createdAt: number, form: 'references' | 'inline', secrets: { key?: string; door?: string } = {}): Promise<DungeonBuild> {
  const pk = getPublicKey(sk)
  if (pk !== game.pubkey) throw new Error('the secret is not the game key\'s')
  if (form === 'references' && pk === TUTORIAL_DEV_PUBKEY) throw new Error('the DEV key\'s world is the bundled fixture; it is never published')
  const piece = (name: string): ShardModel => {
    const p = pieces[name]
    if (!p) throw new Error(`no piece ${name}`)
    return p
  }
  const { plane, height } = game.region
  const sign = (t: EventTemplate): NostrEvent => finalizeEvent(t, sk) as NostrEvent
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
  file(`02-key-bag-${HIDDEN_KIND}.json`, await bagTemplate([keyItem as unknown as BagEntry], kb.key, kb.lookupId, KEY_BAG.height, createdAt, HIDDEN_KIND))

  // 3. The door, sealed to the key item, and its room holding the finish tile (DECK-0004 §3.7).
  const doorSecret = secrets.door ?? newDoorSecret()
  const sealed = sealEntries(roomEntries(doorSecret) as BagEntry[], key.itemPubkey)
  const door = sign(chestInnerTemplate({ name: GATE_NAME, lockPubkey: key.itemPubkey, senderPubkey: sealed.senderPubkey, requires: GATE_REQUIRES, payload: sealed.payload, look: lookTags(piece('gate-closed'), piece('gate-open')), door: GATE_DOOR_HEIGHT }, GATE_AT, plane, createdAt))
  const location = regionKeyAt(regionBase(GATE_AT, GATE_DOOR_HEIGHT), GATE_DOOR_HEIGHT, 8).key
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
  const bag = await bagTemplate(entries, wk, lookupId, height, createdAt, HIDDEN_KIND)
  if (signedBytes(bag) > BAG_SAFE_BYTES) throw new Error(`the world bag is ${signedBytes(bag)} bytes, over ${BAG_SAFE_BYTES}`)
  file(`99-world-bag-${HIDDEN_KIND}.json`, bag)
  return { files, keyItem, door, doorSecret }
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
