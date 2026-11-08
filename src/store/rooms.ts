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
 *
 * CLOSE (arkinox, 2026-11-01) shuts an opened door again, here only: the room
 * dissolves, every door of it closes (§3.7.5), and so does every door found inside
 * it, all the way down (§3.7.6). Nothing is published. The secret stays kept, so
 * OPEN opens it again with no key, and nothing else ever does: not a scan, a reload
 * or a relay (closeDoor, reopenClosedDoor). One room, one state: a door of a closed
 * room found later is closed too, and nothing opens a room while any door of it is
 * closed (store/closedDoors.ts). The doors inside a closed room start closed when it
 * opens again, those not loaded at the close included (`below`).
 */

import { BagUnreadable, HIDDEN_KIND, bagEntries, unbag, type Hidden } from '../lib/hidden'
import { bytesToHex, hexToBytes } from '../lib/events'
import { doorHeightOf } from '../lib/looks'
import { openerFor, type Opener } from '../lib/chests'
import { doorSecretWithKey, regionBase, roomKey, roomKeyOf, roomLookupId, roomOf } from '../lib/doors'
import { openingKeys } from '../lib/inventory'
import { query } from '../lib/relay'
import { resolveReference } from '../lib/references'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from './useCyberspace'
import { useInventory } from './useInventory'
import { positionOf, useShards } from './useShards'
import { openedByHand, rememberOpened, shutInSession } from './useOpenedChests'
import { belowPending, closeArriving, closedByMe, recordsOfRoom, refreshClosedDoors, roomShut, writeClosed, type ClosedRecord } from './closedDoors'
import { doorSecret, doorSecretOnlySaid, keepDoorSecret } from './doorSecrets'

export { doorSecret, doorSecretOnlySaid, keepDoorSecret, resetDoorSecrets } from './doorSecrets'

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

/** A door's own secret, read with a key this identity holds; null when none is held, or only a signer could say, which asks. */
function ownSecret(chest: NonNullable<Hidden['chest']>, opener: Opener): string | null {
  if (opener?.by !== 'key') return null
  try { return doorSecretWithKey(chest, opener.key.secretHex) } catch { return null }
}

/**
 * A door opened by hand, at once and before any relay is asked (his ruling: "OPEN
 * closes the modal", "WALK passes at once"), the secret kept. Fetching the room
 * comes after (fillRoom).
 *
 * The rest of its room opens with it (§3.7.5, R5), per secret: a door whose own seal
 * can be read here and holds another secret is another room and stays shut, and one
 * already opened by its own seal keeps its own. One that cannot be read opens as the
 * spec says, the secret only said (doorSecretOnlySaid), so OPEN stays on it for
 * whoever comes to hold its key (ownOpenOwed): its room is never lost to this door's
 * secret.
 */
export function openDoorNow(door: Hidden, secretHex: string, how?: { quiet: true }): void {
  const me = useCyberspace.getState().identity.pubkey
  // OPEN opens the room: every door of it closed with CLOSE, here or not, is closed no longer.
  if (!how?.quiet) openRoomRecords(me, door)
  keepDoorSecret(me, door.eventId, secretHex)
  if (door.chest) rememberOpened(me, door.eventId, door.chest.lockPubkey, [])
  const keys = openingKeys(useInventory.getState().items)
  for (const d of doorsOfRoom(door)) {
    if (d.eventId === door.eventId || !d.chest) continue
    // A reload's reopening never opens a door you closed (CLOSE): only OPEN does.
    if (how?.quiet && closedByMe(me, d.eventId, d.chest.lockPubkey)) continue
    const own = ownSecret(d.chest, openerFor(d.chest, keys, me))
    if (own !== null && own !== secretHex) continue
    if (own === null && doorSecret(me, d.eventId) && !doorSecretOnlySaid(me, d.eventId)) continue
    keepDoorSecret(me, d.eventId, secretHex, own === null ? { onlySaid: true } : undefined)
    rememberOpened(me, d.eventId, d.chest.lockPubkey, [])
  }
}

/**
 * Whether a door open only because another of its room was still has its own OPEN
 * to give: this identity can now read its seal, and it holds, or may hold, another
 * secret. A key says at once. A signer asks, so OPEN stays until it is tapped.
 */
export function ownOpenOwed(me: string, doorId: string, chest: NonNullable<Hidden['chest']>, opener: Opener): boolean {
  if (!opener || !doorSecretOnlySaid(me, doorId)) return false
  const own = ownSecret(chest, opener)
  return own === null || own !== doorSecret(me, doorId)
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
  // Closed while its room was on the way (CLOSE), this door or any of its room: the room stays dissolved.
  if (roomShutFor(me, door)) return null
  // The room had been closed: every door that comes in with it starts closed, until its own OPEN.
  const room = roomKeyOf(door)
  if (belowPending(me, room)) {
    void closeArriving(me, opened.items, { below: true })
    // Come back whole: what was still to close below is closed now.
    if (opened.found && room) void writeClosed(recordsOfRoom(me, room).filter((r) => r.below).map(({ below: _below, ...r }) => r))
  }
  if (opened.items.length > 0) {
    useShards.getState().addDiscovered(opened.items)
    mark?.(opened.items)
  }
  return opened
}

/** Both: the door open, then its room. `quiet`: a reload's reopening, which opens no door you closed. */
export async function enterRoom(door: Hidden, secretHex: string, mark?: (items: Hidden[]) => void, how?: { quiet: true }): Promise<OpenedRoom | null> {
  if (door.chestId) throw new Error('A door found inside a chest does not open a room.')
  openDoorNow(door, secretHex, how)
  return fillRoom(door, secretHex, mark)
}

/** Whether this door, or any door of its room, is closed by this identity (§3.7.5: one room, one state). */
export function roomShutFor(me: string, door: Hidden): boolean {
  return (!!door.chest && closedByMe(me, door.eventId, door.chest.lockPubkey)) || roomShut(me, roomKeyOf(door))
}

/** OPEN on a door: every record of its room closed no longer; what is still to close below stays so. */
function openRoomRecords(me: string, door: Hidden): void {
  const room = roomKeyOf(door)
  if (!room) return
  const reopen = recordsOfRoom(me, room).filter((r) => r.shut).map(({ shut: _shut, ...r }) => r)
  void writeClosed(reopen)
}

/** What a close reads of a thing found or hidden: enough to follow rooms and chests down. */
interface Held { eventId: string; room?: { doorId: string }; chestId?: string; door: boolean }

/** Everything this device holds in the world, found or hidden, as a close reads it. */
function heldThings(): Held[] {
  const s = useShards.getState()
  const out = new Map<string, Held>()
  for (const d of s.mine) out.set(d.eventId, { eventId: d.eventId, room: d.room, door: d.chest?.door !== undefined })
  for (const h of Object.values(s.discovered)) {
    if (out.has(h.eventId)) continue
    out.set(h.eventId, { eventId: h.eventId, room: h.room, chestId: h.chestId, door: h.type === 'chest' && heightOfDoor(h) !== null })
  }
  return [...out.values()]
}

/**
 * CLOSE on an opened door (arkinox, 2026-11-01): the door closes and its room
 * dissolves, here and nowhere else. Every door of the room closes with it, those
 * not found here yet too (§3.7.5: one room, one state; store/closedDoors roomShut),
 * and every door found inside the room, and inside theirs, all the way down
 * (§3.7.6), each kept closed for this identity, its doors below to close as they
 * arrive (`below`). What stood in those rooms, and what came out of a chest there,
 * goes from the finds; what you hid there yourself is left out of the world while
 * its door is closed (useShards worldOf).
 *
 * The closes are written before the world redraws them; one not kept says so in a
 * toast (store/closedDoors writeClosed), and holds until reload. Nothing is published
 * and no relay is asked. The secrets stay kept, so OPEN opens each again with no key
 * (reopenClosedDoor), and nothing else does. Resolves with the ids of the doors
 * closed and whether every close was kept.
 */
export async function closeDoor(door: Hidden): Promise<{ closed: string[]; kept: boolean }> {
  const me = useCyberspace.getState().identity.pubkey
  const things = heldThings()
  const top = doorsOfRoom(door)
  // The doors whose rooms dissolve: this room's, then each door standing in a dissolving room.
  const rooms = new Set(top.map((d) => d.eventId))
  const gone = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const t of things) {
      if (gone.has(t.eventId)) continue
      if ((t.room && rooms.has(t.room.doorId)) || (t.chestId && gone.has(t.chestId))) {
        gone.add(t.eventId)
        if (t.door) rooms.add(t.eventId)
        grew = true
      }
    }
  }
  const at = new Map(top.map((d) => [d.eventId, d]))
  const recs: ClosedRecord[] = []
  for (const id of rooms) {
    const d = at.get(id) ?? doorAsFound(id)
    if (!d?.chest) continue
    const lock = d.chest.lockPubkey
    // A door you opened, or whose secret is kept here (yours, sealed on this device): shut until OPEN.
    if (id !== door.eventId && !openedByHand(me, id, lock) && !doorSecret(me, id)) continue
    recs.push({ owner: me, doorId: id, lock, room: roomKeyOf(d) ?? '', shut: true, below: true })
    lastReopen.delete(`${me}/${id}`)
  }
  // Closed in memory at once (a room on its way is refused from now), on disk before the world redraws it.
  const kept = await writeClosed(recs)
  const closed = recs.map((r) => r.doorId)
  shutInSession(me, closed)
  const discovered = { ...useShards.getState().discovered }
  for (const id of gone) delete discovered[id]
  // A fresh record even when nothing left it, so everything drawn from it is drawn again.
  useShards.setState({ discovered })
  return { closed, kept }
}

/**
 * OPEN on a door closed with CLOSE: no key, since its secret is kept here, and
 * at once, as any OPEN (openDoorNow), which opens every door of its room closed by
 * the close (§3.7.5). A door inside the room stays closed until its own OPEN, and
 * one not found here at the close starts closed when it comes (fillRoom, `below`).
 * The room is then fetched as it is now (fillRoom), with no reveal of its own: the
 * card's caller plays the short one. The secret, or null when none is kept.
 */
export function reopenClosedDoor(door: Hidden): string | null {
  const me = useCyberspace.getState().identity.pubkey
  const secret = doorSecret(me, door.eventId)
  if (!secret || !door.chest) return null
  const room = doorsOfRoom(door)
  // Which of the room this close shut, before OPEN opens them.
  const shut = room.filter((d) => !!d.chest && closedByMe(me, d.eventId, d.chest.lockPubkey) && doorSecret(me, d.eventId) === secret)
  if (doorSecretOnlySaid(me, door.eventId)) {
    // Only said by another door of the room: that door opens it, as it did, so this
    // secret is never kept as this door's own.
    const owner = room.find((d) => d.eventId !== door.eventId && !!d.chest && doorSecret(me, d.eventId) === secret && !doorSecretOnlySaid(me, d.eventId))
    openRoomRecords(me, door)
    if (owner) openDoorNow(owner, secret)
    rememberOpened(me, door.eventId, door.chest.lockPubkey, [])
  } else openDoorNow(door, secret)
  // The rest of the room this close shut, a door of yours you never opened by hand included.
  for (const d of shut) rememberOpened(me, d.eventId, d.chest!.lockPubkey, [])
  // A fresh record, so what you hid in the room is drawn again (useShards worldOf).
  useShards.setState({ discovered: { ...useShards.getState().discovered } })
  return secret
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
  // Closed with CLOSE, this door or any of its room: never opened again by a reload or a
  // scan (arkinox, 2026-10-26), only by OPEN. Asked of the store as it stands now, another
  // tab's closes included, and never before it is read.
  await refreshClosedDoors(me)
  if (useCyberspace.getState().identity.pubkey !== me || roomShutFor(me, door)) return
  const secret = doorSecret(me, door.eventId)
  if (!secret) return
  // A secret only said is the room of the door that said it, which opens it
  // again itself. With no such door left here (it went, or is not found any
  // more), this one fills that room, and only fills it: opening it would keep
  // the secret as this door's own and say it to the rest of the room.
  const said = doorSecretOnlySaid(me, door.eventId)
  if (said && doorsOfRoom(door).some((d) => d.eventId !== door.eventId && doorSecret(me, d.eventId) === secret && !doorSecretOnlySaid(me, d.eventId))) return
  const key = `${me}/${door.eventId}`
  const was = lastReopen.get(key)
  if (was && Date.now() - was.at < (was.found ? REOPEN_FOUND_MS : REOPEN_MISSING_MS)) return
  // Claimed before the wait: scans do not stack up behind a slow relay.
  lastReopen.set(key, { at: Date.now(), found: was?.found ?? false })
  try {
    const opened = said ? await fillRoom(door, secret) : await enterRoom(door, secret, undefined, { quiet: true })
    if (opened) lastReopen.set(key, { at: Date.now(), found: opened.found })
  } catch (err) {
    // A room bag found that does not open with its key is found: asked again as seldom
    // as one that opened, since it will not open sooner. Anything else: unreachable now,
    // and the next scan asks again.
    if (err instanceof BagUnreadable) lastReopen.set(key, { at: Date.now(), found: true })
  }
}
