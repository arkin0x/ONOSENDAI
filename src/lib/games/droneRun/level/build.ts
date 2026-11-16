/**
 * build.ts - DRONE RUN's world from a level (level.ts), built for the game
 * key exactly as a real publish would put it on a relay. Pure: it signs with
 * the signer it is handed and sends nothing anywhere. Used only by the
 * generator (__tests__/droneRun.gen.test.ts), which signs the built-in field
 * (placeholderField.ts) with the DEV key and writes the bundled fixture; never
 * by the app. A level imported on a device is never built into events: it is
 * played from the device as it is (levelWorld.ts).
 *
 * The events, in the order a publish would send them:
 *
 * 1. One kind 33331 object per distinct piece the level places by reference
 *    (DECK-0003 §3.4, spec §7.6 References): the piece's payload sealed with
 *    the region key, a public preview, a fixed `d` (objectD), and nothing that
 *    says where it is. One object serves every placement of that piece: a
 *    reference is an address plus a coordinate, and the same address may stand
 *    at many coordinates of one bag (lib/hidden.ts unbag keeps each placement,
 *    firstOfEach). ONOSENDAI's BUILD gives every placement a fresh `d` because
 *    two placements may be sealed to two different regions; here every one is
 *    sealed to the same region key, so sharing loses nothing and saves a copy
 *    of the payload per extra placement.
 * 2. The world bag (kind 33330), LAST, so no reader finds a reference before
 *    its object: sealed to the region key, `d` its lookup id, height 8 and the
 *    sector hint (as a new bag ONOSENDAI hides has by default, and as the
 *    tutorial dungeon's world bag has). Its list: the entry marker inline and
 *    FIRST, carrying ["entry"] at the level's entry point (DECK-0002 §2.2: the
 *    first inline authentic item with the tag counts; a reference never does),
 *    then every placement in the level's order.
 *
 * Inline or by reference, per piece, as ONOSENDAI decides it for a shard
 * (lib/hidden.ts REFERENCE_THRESHOLD_BYTES, 16 KB): a piece small enough and
 * placed once is carried inline, signed by the game key; anything larger, or
 * placed more than once, goes by reference (one object instead of a copy per
 * placement). Ground slabs and walls are placed many times, so a battlefield
 * is mostly references and its bag stays small.
 *
 * Inline items (the marker, small pieces) are signed by the game key, as the
 * tutorial dungeon's DEV fixture signs them, not rumors: DECK-0002 rules
 * (cyberspace PR #105) want the entry marker signed.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { fromPayload, toPayload, type ShardModel } from 'sno-core/shards'
import { bagTemplate, newBagSettings, objectTemplate, shardInnerTemplate, HIDDEN_KIND, OBJECT_KIND, REFERENCE_THRESHOLD_BYTES, type BagEntry, type Reference } from '../../../hidden'
import { BAG_SAFE_BYTES, signedBytes } from '../../../bagSize'
import { bytesToHex, positionHex, type EventTemplate, type NostrEvent } from '../../../events'
import { withAuthoredConstrain } from '../../../walkConstrain'
import { ENTRY_TAG, worldKey } from '../../world'
import type { GameDef } from '../../types'
import type { Position } from '../../../space'
import { pieceNames, type Level, type Local } from './level'

/** Signs one event as the game key: the generator's, holding the key's secret. */
export type SignAsGame = (template: EventTemplate) => NostrEvent

/** What a build made: the events in publish order, signed, and what is in them. */
export interface DroneRunBuild {
  /** The objects, then the world bag. */
  events: NostrEvent[]
  /** Pieces carried by reference (one object each) and inline. */
  referenced: string[]
  inline: string[]
  /** The world bag's size as signed, against BAG_SAFE_BYTES. */
  bagBytes: number
}

const utf8 = new TextEncoder()

/** The `d` of the object for piece `name`: fixed, so a rebuild replaces it (32 hex, as placement ids are). */
export function objectD(pubkey: string, name: string): string {
  return bytesToHex(sha256(utf8.encode(`ONOSENDAI drone run object ${pubkey} ${name}`))).slice(0, 32)
}

/**
 * The entry marker: a flat 2 by 2 plate lifted a twentieth of a gibson off the
 * ground, so it never fights the ground's own faces, in a pale cyan of its own
 * palette, front up and back down, stopping no walker (`constrain` off). It
 * marks where a player appears, nothing more.
 */
export const ENTRY_MARKER_PAYLOAD = {
  v: 2,
  name: 'DRONE RUN entry',
  unit: 0,
  extent: 2,
  mode: 'solid',
  vertices: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]],
  ticks: [[0, 6, 0], [0, 6, 0], [0, 6, 0], [0, 6, 0]],
  // A palette holds 2 to 256 colours (DECK-0003 §1.3a); the second, a deeper cyan, is unused.
  palette: [[90, 220, 255], [20, 120, 160]],
  colors: [0, 0, 0, 0],
  faces: [[0, 2, 1], [0, 3, 2], [0, 1, 2], [0, 2, 3]],
  opacity: 70,
  constrain: 'off',
}

function shardOf(raw: unknown, name: string): ShardModel {
  const shard = fromPayload(raw, `drone-run-${name}`)
  if (!shard) throw new Error(`piece ${name} is not a shard payload (DECK-0003)`)
  return shard
}

/** A region-local point as a game position. */
function placeOf(game: Pick<GameDef, 'region'>, p: Local): Position {
  const b = game.region.base
  return { x: b.x + BigInt(p[0]), y: b.y + BigInt(p[1]), z: b.z + BigInt(p[2]) }
}

/**
 * The world of `level` for `game`, every event signed by `signAs` (the game
 * key's signer), dated `createdAt`. `payloads` holds each piece's payload by
 * name (payloads/<name>.json, parsed). Throws on a piece with no payload, a
 * payload that is not a shard, or a bag over BAG_SAFE_BYTES.
 */
export async function buildDroneRunWorld(game: Pick<GameDef, 'pubkey' | 'relayHint' | 'region'>, signAs: SignAsGame, level: Level, payloads: Readonly<Record<string, unknown>>, createdAt: number): Promise<DroneRunBuild> {
  const pk = game.pubkey
  const sign = (t: EventTemplate): NostrEvent => {
    const e = signAs(t)
    if (e.pubkey !== pk) throw new Error('the signer is not the game key')
    return e
  }
  const { plane, height } = game.region
  const { key, lookupId } = worldKey(game)

  // Each piece once: its shard, how many times it is placed, and whether it goes inline.
  const placed = new Map<string, number>()
  for (const p of level.pieces) placed.set(p.piece, (placed.get(p.piece) ?? 0) + 1)
  const shards = new Map<string, ShardModel>()
  const inline = new Set<string>()
  for (const name of pieceNames(level)) {
    if (!(name in payloads)) throw new Error(`no payload for piece ${name} (payloads/${name}.json)`)
    const shard = shardOf(payloads[name], name)
    shards.set(name, shard)
    const bytes = utf8.encode(JSON.stringify(toPayload(withAuthoredConstrain(shard)))).length
    if (bytes <= REFERENCE_THRESHOLD_BYTES && placed.get(name) === 1) inline.add(name)
  }

  // 1. The objects, one per piece that goes by reference.
  const events: NostrEvent[] = []
  const addressOf = new Map<string, string>()
  for (const [name, shard] of shards) {
    if (inline.has(name)) continue
    const d = objectD(pk, name)
    events.push(sign(await objectTemplate(shard, key, d, createdAt)))
    addressOf.set(name, `${OBJECT_KIND}:${pk}:${d}`)
  }

  // 2. The world bag: the entry marker inline and first, then every placement in the level's order.
  const marker = shardInnerTemplate(shardOf(ENTRY_MARKER_PAYLOAD, 'entry'), placeOf(game, level.entry), plane, createdAt)
  const entries: BagEntry[] = [sign({ ...marker, tags: [...marker.tags, [ENTRY_TAG]] }) as unknown as BagEntry]
  for (const p of level.pieces) {
    const at = placeOf(game, p.at)
    const address = addressOf.get(p.piece)
    if (address) entries.push(['a', address, game.relayHint, positionHex(at, plane)] satisfies Reference)
    else entries.push(sign(shardInnerTemplate(shards.get(p.piece)!, at, plane, createdAt)) as unknown as BagEntry)
  }
  const bag = await bagTemplate(entries, key, lookupId, height, createdAt, HIDDEN_KIND, newBagSettings(height), { at: game.region.base, plane })
  const bagBytes = signedBytes(bag)
  if (bagBytes > BAG_SAFE_BYTES) throw new Error(`the world bag is ${bagBytes} bytes, over ${BAG_SAFE_BYTES}`)
  events.push(sign(bag))
  return { events, referenced: [...addressOf.keys()], inline: [...inline], bagBytes }
}
