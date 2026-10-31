/**
 * rooms.ts: opening a door's room (DECK-0004 §3.7.3, cyberspace PR #82,
 * held; chest and door design, 4.9, R5, R17).
 *
 * OPEN on a door, always a tap (R17): the door is opened as a chest and its
 * secret read (lib/doors.ts). Then the room region's location key is taken (the bag
 * key in hand when the door was found in a bag of its own height, else
 * computed for the door's height), the room key derived, and the room bag
 * fetched by its `d` from the door's signer alone, then opened as a bag.
 * Its entries stand where they were hidden: they are finds like any other,
 * each marked with the door whose room it is. Opening publishes nothing.
 *
 * Every door of one signer, height and region is a door to one room (R5,
 * §3.7.5): opening one opens all of them, for you.
 *
 * A door is opened the moment its secret is read, and its room fetched after, so
 * no relay ever holds up the card, the ceremony or the walker.
 *
 * The secret is kept on this device, per identity, once known: a finder's
 * reload opens the room again as it was (store/useShards addDiscovered),
 * and the sealing device keeps its own door's secret from the moment it
 * seals it (DOOR authoring). It is knowledge, as an item is; nothing else
 * remembers it.
 */

import { HIDDEN_KIND, bagEntries, unbag, type Hidden } from '../lib/hidden'
import { bytesToHex, hexToBytes } from '../lib/events'
import { doorHeightOf } from '../lib/looks'
import { regionBase, roomKey, roomLookupId, roomOf } from '../lib/doors'
import { query } from '../lib/relay'
import { resolveReference } from '../lib/references'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'
import { positionOf, useShards } from './useShards'
import { rememberOpened } from './useOpenedChests'
import { doorSecret, keepDoorSecret } from './doorSecrets'

export { doorSecret, keepDoorSecret, resetDoorSecrets } from './doorSecrets'

/** A door's height (its `door` tag), or null for a chest or a malformed door. */
export function heightOfDoor(door: Pick<Hidden, 'inner'>): number | null {
  const h = doorHeightOf(door.inner?.tags)
  return typeof h === 'number' ? h : null
}

/**
 * The location key of a door's room (§3.7.3 step 2): the key of the bag it
 * was found in when that bag is of the door's height and not itself a room
 * bag; otherwise the key of the door's height at its point, computed here.
 */
export async function roomLocationKey(door: Pick<Hidden, 'at' | 'height' | 'keyHex' | 'room' | 'inner'>): Promise<Uint8Array> {
  const h = heightOfDoor(door)
  if (h === null) throw new Error('This is not a door.')
  if (!door.room && door.height === h && door.keyHex) return hexToBytes(door.keyHex)
  return (await regionKeyOffThread(door.at, h, MAX_COMPUTE_HEIGHT)).key
}

/** What opening a room found: its entries as finds, or that its bag could not be retrieved. */
export interface OpenedRoom {
  items: Hidden[]
  /** False when no room bag was found: the reader says the room could not be retrieved, not that it is empty (§3.7.3). */
  found: boolean
  lookupId: string
  keyHex: string
}

/**
 * Fetch and open a door's room with its secret: the room bag by its `d`,
 * signed by the door's signer and no one else, its entries as finds where
 * they stand, each marked with the door.
 */
export async function openRoom(door: Hidden, secretHex: string): Promise<OpenedRoom> {
  const h = heightOfDoor(door)
  const signer = door.inner?.pubkey
  if (h === null || !signer) throw new Error('This is not a door.')
  // §3.7.1: a chest's contents are taken, not placed.
  if (door.chestId) throw new Error('A door found inside a chest does not open a room.')
  const key = roomKey(await roomLocationKey(door), hexToBytes(secretHex))
  const lookupId = roomLookupId(key)
  const keyHex = bytesToHex(key)
  const events = (await query({ kinds: [HIDDEN_KIND], authors: [signer], '#d': [lookupId] })).filter((e) => e.pubkey === signer)
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return { items: [], found: false, lookupId, keyHex }
  const items = await unbag(newest, key, resolveReference, { at: regionBase(door.at, h), plane: door.plane }, h, undefined, { doorId: door.eventId })
  return { items, found: true, lookupId, keyHex }
}

/** The room's entries as they are written, for its author's rewrites (DOOR authoring). */
export async function roomBagEntries(signer: string, key: Uint8Array): Promise<ReturnType<typeof bagEntries>> {
  const events = (await query({ kinds: [HIDDEN_KIND], authors: [signer], '#d': [roomLookupId(key)] })).filter((e) => e.pubkey === signer)
  const newest = events.sort((a, b) => b.created_at - a.created_at)[0]
  return newest ? bagEntries(newest, key) : []
}

/** A door as a find: the one this device found, or one it hid, as the scan would have read it. */
export function doorAsFound(doorId: string): Hidden | null {
  const s = useShards.getState()
  const found = s.discovered[doorId]
  if (found) return found
  const d = s.mine.find((m) => m.eventId === doorId)
  if (!d?.chest) return null
  return { eventId: d.eventId, inner: d.inner, keyHex: d.keyHex, bagId: d.bagId, lookupId: d.lookupId, author: d.inner.pubkey, at: positionOf(d), plane: d.plane, height: d.height, bag: d.bag, createdAt: d.createdAt, type: 'chest', chest: d.chest }
}

/** Every door of the same room (§3.7.5): the same signer, height, region and plane, this one included. */
export function doorsOfRoom(door: Hidden): Hidden[] {
  const h = heightOfDoor(door)
  if (h === null) return [door]
  const room = roomOf(door.at, door.plane, h)
  const s = useShards.getState()
  const seen = new Map<string, Hidden>([[door.eventId, door]])
  const candidates = [...Object.values(s.discovered), ...s.mine.map((d) => doorAsFound(d.eventId)).filter((x): x is Hidden => x !== null)]
  for (const c of candidates) {
    if (c.type !== 'chest' || c.inner?.pubkey !== door.inner?.pubkey) continue
    const ch = heightOfDoor(c)
    if (ch === h && roomOf(c.at, c.plane, ch) === room) seen.set(c.eventId, c)
  }
  return [...seen.values()]
}

/**
 * A door opened by hand, at once and before any relay is asked (his ruling: "OPEN
 * closes the modal", "WALK passes at once"): every door of its room open for this
 * identity (R5), the secret kept. Fetching the room comes after (fillRoom).
 */
export function openDoorNow(door: Hidden, secretHex: string): void {
  const me = useCyberspace.getState().identity.pubkey
  for (const d of doorsOfRoom(door)) {
    keepDoorSecret(me, d.eventId, secretHex)
    if (d.chest) rememberOpened(me, d.eventId, d.chest.lockPubkey, [])
  }
}

/**
 * The room behind a door opened (openDoorNow): its entries found where they
 * stand. `mark` marks them for the reveal, a first OPEN; a reload's reopening shows
 * them as they were. Null when the identity changed meanwhile: what one identity
 * opened is never filed under another.
 */
export async function fillRoom(door: Hidden, secretHex: string, mark?: (items: Hidden[]) => void): Promise<OpenedRoom | null> {
  const me = useCyberspace.getState().identity.pubkey
  const opened = await openRoom(door, secretHex)
  if (useCyberspace.getState().identity.pubkey !== me) return null
  if (opened.items.length > 0) {
    useShards.getState().addDiscovered(opened.items)
    mark?.(opened.items)
  }
  return opened
}

/** Both: the door open, then its room. */
export async function enterRoom(door: Hidden, secretHex: string, mark?: (items: Hidden[]) => void): Promise<OpenedRoom | null> {
  if (door.chestId) throw new Error('A door found inside a chest does not open a room.')
  openDoorNow(door, secretHex)
  return fillRoom(door, secretHex, mark)
}

/** How soon an opened door's room is asked for again by a scan: a found room rarely, one not found soon, since it may only be missing from the relays asked. */
const REOPEN_FOUND_MS = 5 * 60_000
const REOPEN_MISSING_MS = 30_000
const lastReopen = new Map<string, { at: number; found: boolean }>()

/** For tests: forget when each room was last asked for. */
export function resetReopens(): void { lastReopen.clear() }

/**
 * A door opened by hand before, after a reload or a later scan: its room opened
 * again with the secret kept here, quietly. A scan finds a bag again and again, so
 * a room that was found is not asked for again soon, and one that was not is.
 */
export async function reopenRoom(door: Hidden): Promise<void> {
  const me = useCyberspace.getState().identity.pubkey
  const secret = doorSecret(me, door.eventId)
  if (!secret) return
  const key = `${me}/${door.eventId}`
  const was = lastReopen.get(key)
  if (was && Date.now() - was.at < (was.found ? REOPEN_FOUND_MS : REOPEN_MISSING_MS)) return
  // Claimed before the wait: scans do not stack up behind a slow relay.
  lastReopen.set(key, { at: Date.now(), found: was?.found ?? false })
  try {
    const opened = await enterRoom(door, secret)
    if (opened) lastReopen.set(key, { at: Date.now(), found: opened.found })
  } catch { /* unreachable now: the next scan asks again */ }
}
