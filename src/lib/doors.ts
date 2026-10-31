/**
 * doors.ts: a door and its room (DECK-0004 §3.7, cyberspace PR #82, held
 * until it merges; chest and door design, section 4).
 *
 * A door is a chest (kind 3341) with one `["door", "<height>"]` tag. What it
 * locks is its room: the aligned region of the door's height that holds its
 * `C`, in its plane. Its sealed plaintext is one entry, `["room", "<door
 * secret, 64 lowercase hex>"]`. Whatever its author hides in the room at the
 * room's height goes into a room bag: an ordinary kind 33330 keyed by
 *
 *   room_key       = SHA-256( UTF-8("cyberspace:door") || location_key || door_secret )
 *   room_lookup_id = SHA-256( room_key )
 *
 * where location_key is the 32-byte key of the room's region (spec §7.2) and
 * door_secret the secret's 32 bytes: 79 bytes in, two-factor (presence and
 * the lock). The room bag carries no height, hint, sector or contents tag
 * and an empty content (ROOM_BAG_SETTINGS), and is signed by the door's
 * signer, who is the only author a reader fetches it from.
 *
 * Pure: no relay, no store. Opening a door and fetching its room is
 * store/rooms.ts.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { bytesToHex, hexToBytes } from './events'
import type { BagSettings, ChestItem } from './hidden'
import { doorHeightOf } from './looks'
import type { Position } from './space'

/** The domain prefix of a room key (§3.7.2): 15 ASCII bytes. */
export const DOOR_KDF_PREFIX = 'cyberspace:door'

/** A room's key: SHA-256 of the prefix, the room region's location key and the door secret (§3.7.2). */
export function roomKey(locationKey: Uint8Array, doorSecret: Uint8Array): Uint8Array {
  if (locationKey.length !== 32 || doorSecret.length !== 32) throw new Error('A room key needs a 32-byte location key and a 32-byte door secret.')
  const prefix = new TextEncoder().encode(DOOR_KDF_PREFIX)
  const input = new Uint8Array(prefix.length + 64)
  input.set(prefix, 0)
  input.set(locationKey, prefix.length)
  input.set(doorSecret, prefix.length + 32)
  return sha256(input)
}

/** A room bag's `d`: SHA-256 of its key, 64 lowercase hex (§3.7.2). */
export function roomLookupId(key: Uint8Array): string {
  return bytesToHex(sha256(key))
}

/** A room bag as it is published (§3.7.2): no height, no hint, no sector, no contents, an empty content. */
export const ROOM_BAG_SETTINGS: BagSettings = { heightTag: false, hint: null, riddle: '', contents: false, money: false }

const HEX64 = /^[0-9a-f]{64}$/

/** A new door secret: 32 bytes from the platform's secure source, as hex. One per room (§3.7.5). */
export function newDoorSecret(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return bytesToHex(b)
}

/** A door's plaintext entries (§3.7.1): exactly one room entry. */
export function roomEntries(secretHex: string): unknown[] {
  if (!HEX64.test(secretHex)) throw new Error('A door secret is 64 lowercase hex characters.')
  return [['room', secretHex]]
}

/**
 * The door secret in a door's decrypted plaintext (§3.7.1): the first
 * well-formed room entry, every other entry ignored; null when there is
 * none or the plaintext is not a list.
 */
export function doorSecretOf(plaintext: string): string | null {
  let parsed: unknown
  try { parsed = JSON.parse(plaintext) } catch { return null }
  if (!Array.isArray(parsed)) return null
  for (const e of parsed) {
    if (Array.isArray(e) && e[0] === 'room' && typeof e[1] === 'string' && HEX64.test(e[1])) return e[1]
  }
  return null
}

/** Open a door with an item's secret: its door secret, or null. Throws on the wrong key, as a chest does. */
export function doorSecretWithKey(door: Pick<ChestItem, 'senderPubkey' | 'payload'>, itemSecretHex: string): string | null {
  return doorSecretOf(nip44.decrypt(door.payload, nip44.utils.getConversationKey(hexToBytes(itemSecretHex), door.senderPubkey)))
}

/** Open a door sealed to a person with that person's signer. */
export async function doorSecretWithSigner(door: Pick<ChestItem, 'senderPubkey' | 'payload'>, decrypt: (sender: string, payload: string) => Promise<string>): Promise<string | null> {
  return doorSecretOf(await decrypt(door.senderPubkey, door.payload))
}

/** The aligned base of the region of height `h` holding a point. */
export function regionBase(at: Position, h: number): Position {
  const s = BigInt(h)
  return { x: (at.x >> s) << s, y: (at.y >> s) << s, z: (at.z >> s) << s }
}

/** Whether a point is inside the room of a door standing at `door` with height `h` (same plane is the caller's to check). */
export function inRoom(door: Position, h: number, p: Position): boolean {
  const s = BigInt(h)
  return (p.x >> s) === (door.x >> s) && (p.y >> s) === (door.y >> s) && (p.z >> s) === (door.z >> s)
}

/** A room, as a string: plane, height and aligned base. Two doors are doors of one room when these and their signer agree (§3.7.5). */
export function roomOf(at: Position, plane: number, h: number): string {
  const b = regionBase(at, h)
  return `${plane}:${h}:${b.x}:${b.y}:${b.z}`
}

/**
 * Whether a door may stand where it was found (§3.7.1), or why not: its
 * height must be well formed, at most the height of the bag holding it, and,
 * inside a room, lower than the room's. A reader MUST drop a door that breaks
 * any of these.
 */
export function doorRefusal(tags: readonly unknown[], bagHeight: number, inRoomOf: number | null): string | null {
  const h = doorHeightOf(tags)
  if (h === null) return null
  if (h === 'malformed') return 'Its door height is not a height.'
  if (h > bagHeight) return 'Its door is higher than the bag it was found in.'
  if (inRoomOf !== null && h >= inRoomOf) return 'A door inside a room must be lower than the room.'
  return null
}

/** A door of yours, as a placement asks about it: where it stands, its height, and its secret when this device knows it. */
export interface OwnDoor {
  eventId: string
  name: string
  at: Position
  plane: number
  /** Its `door` height: its room is the region of this height holding `at`. */
  height: number
  secret: string | null
}

/**
 * The door whose room a placement falls in (chest and door design, 4.3, 4.5,
 * R1, the owner's height clarification): the point inside its room, in its
 * plane, and hidden at exactly its height, which is what "a door locks one
 * height" comes to. Heights never compete, so at most one room answers; two
 * doors of one room are one answer. A door whose secret is not known here comes
 * first, secret null, for the placement to refuse (useShards deploy): it may
 * have rotated since this device last saw it, and sealing to a sibling's old
 * secret would hide this in a room nobody opens.
 */
export function roomDoorAt(doors: readonly OwnDoor[], at: Position, plane: number, height: number): OwnDoor | null {
  const here = doors.filter((d) => d.height === height && d.plane === plane && inRoom(d.at, d.height, at))
  return here.find((d) => !d.secret) ?? here[0] ?? null
}
