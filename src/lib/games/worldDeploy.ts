/**
 * worldDeploy.ts - the tutorial dungeon's world for the owner's game key, as
 * UNSIGNED events he signs and publishes himself, one nak command per event
 * (onosendai/games-dungeon/DEPLOY.md). Pure: it signs nothing, holds no
 * secret and sends nothing anywhere. Used only by the generator
 * (__tests__/tutorialDungeon.gen.test.ts) and its test, never by the app.
 *
 * It is built from the DEV fixture's own items, so the owner's world is the
 * dungeon every test plays: the same payloads at the same coordinates, the
 * entry point at the same place. Only its form differs, so that every event
 * needs one signature and nothing else:
 *
 * - Every shard goes BY REFERENCE, as a kind 33331 object sealed with the
 *   region key (DECK-0003 §3.4, the form spec §7.6 prefers for shards; the
 *   one lib/bagFit.ts already writes): the object is its own event, and the
 *   bag names it by address, `33331:<game key>:<d>`, which needs the game key
 *   but no signature. Inline shards would each need their own signature
 *   before the bag could be sealed, so a signer would have to sign twice
 *   over, with a build step between.
 * - The entry point (DECK-0002 §2.2) stays INLINE, as it must: a rumor of the
 *   game key carrying the `entry` tag, which the bag's one signature vouches
 *   for (spec §7.6 Rumors), whatever its kind. It is the fixture's entry
 *   marker, so its star is also placed by reference, to be drawn: ONOSENDAI,
 *   as the spec allows, draws no rumor of a shard.
 * - The bag goes last: every object it names is on the relay before it is
 *   (the file names sort that way), so no reader finds a reference to an
 *   object not yet published.
 *
 * Each object's `d` is fixed by its place in the list, so building and
 * publishing again replaces the same objects rather than adding new ones.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bagTemplate, innerAuthentic, objectTemplateOf, OBJECT_KIND, rumorOf, SHARD_KIND, HIDDEN_KIND, type BagEntry, type Reference, type Rumor } from '../hidden'
import { BAG_SAFE_BYTES, signedBytes } from '../bagSize'
import { bytesToHex, type EventTemplate, type NostrEvent } from '../events'
import { TUTORIAL_DEV_PUBKEY } from './tutorialGame'
import { bagList, ENTRY_TAG, worldKey } from './world'
import type { GameDef } from './types'

/** An event as nak signs it: everything but `id` and `sig`. */
export type UnsignedEvent = EventTemplate & { pubkey: string }

/** One file of the deploy folder: its name (the order to publish in) and its event. */
export interface WorldFile {
  name: string
  event: UnsignedEvent
}

const utf8 = new TextEncoder()

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
 * The world of `game` (the owner's key, its relay hint), built from the DEV
 * fixture's bag `source` (signed by `sourceSigner`), dated `createdAt`: the
 * objects in fixture order, then the bag. Refuses the DEV key itself: its
 * world is the fixture, and nothing of it is ever published.
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
