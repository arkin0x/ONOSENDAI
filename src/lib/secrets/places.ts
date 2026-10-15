/**
 * places.ts: the places you have stood on, and the cube keys each one had.
 *
 * Every position is inside thirteen aligned cubes the passive scan computes,
 * of side 2^0 up to 2^SCAN_MAX_HEIGHT. Holding all thirteen as region keys
 * made the key list a record of where the camera had been, so the list keeps
 * only the keys that opened something. A place is the other half: a record of
 * where YOU stood, at your own chain head, with the thirteen keys you had
 * there, kept apart from the key list so RESCAN ALL can look there again
 * later without the keys crowding the list or the scene.
 *
 * Two rules keep it small:
 * - A place is the cube of side 2^0 you stood in, which is the coordinate
 *   itself. Standing on it again moves its time; it is never added twice.
 * - The keys are stored once, by lookup id, however many places share them.
 *   The higher cubes are the widest (2^12 gibsons on a side), so places near
 *   each other share them, and a place carries only the thirteen lookup ids
 *   that point at its keys.
 *
 * The shapes and the rules are here; where they are kept is secrets/db
 * (IndexedDB, the usual case) or secrets/memoryPlaces (before the database
 * opens, and for the session when it cannot).
 */

import type { Plane } from 'cyberspace-core'
import type { Position } from '../space'

/** A key the scan computed: what the region worker sends back, per height. */
export interface ScanKey { lookupId: string; keyHex: string; height: number }

/** A place you stood on at your own head. */
export interface Place {
  /** `plane:lookupId` of the 2^0 cube you stood in: the coordinate, in the space it is in. */
  id: string
  /** Where you stood, as decimal strings. */
  position: { x: string; y: string; z: string }
  plane: Plane
  /** The lookup ids of the cubes you stood in, lowest height first. */
  keys: string[]
  /** First stood here, in seconds since the epoch. */
  first: number
  /** Last stood here: standing here again moves it. */
  at: number
}

/** Where the next page of places starts: just past the last row shown. */
export interface PlaceCursor { at: number; id: string }

/**
 * A cube key some place refers to, stored once however many places share it.
 *
 * A region key is computed from the coordinate alone (the worker is never
 * told the plane), so the same cube in either plane has the same key. `plane`
 * is the plane it was last stood in, which is where RESCAN ALL draws what it
 * opens and the plane it is held in if it opens something.
 */
export interface PlaceKey {
  lookupId: string
  keyHex: string
  height: number
  /** The cube's aligned corner, as decimal strings. */
  base: { x: string; y: string; z: string }
  plane: Plane
}

/** The place's id: the 2^0 cube's lookup id, in its plane. */
export function placeId(plane: Plane, h0LookupId: string): string {
  return `${plane}:${h0LookupId}`
}

function alignedBase(at: Position, height: number): PlaceKey['base'] {
  const h = BigInt(height)
  return { x: String((at.x >> h) << h), y: String((at.y >> h) << h), z: String((at.z >> h) << h) }
}

/**
 * The place a scan stood on, and its cube keys, or null without a 2^0 key
 * (a scan that failed partway has nothing to name the place by).
 */
export function placeOf(position: Position, plane: Plane, scan: ScanKey[], now: number): { place: Place; keys: PlaceKey[] } | null {
  const sorted = [...scan].sort((a, b) => a.height - b.height)
  const h0 = sorted.find((k) => k.height === 0)
  if (!h0) return null
  return {
    place: {
      id: placeId(plane, h0.lookupId),
      position: { x: String(position.x), y: String(position.y), z: String(position.z) },
      plane,
      keys: sorted.map((k) => k.lookupId),
      first: now,
      at: now,
    },
    keys: sorted.map((k) => ({ lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, base: alignedBase(position, k.height), plane })),
  }
}

/**
 * Standing on a place again: the same row with its time moved and its first
 * time kept. Null when nothing changes (the same spot in the same second).
 */
export function restood(was: Place, now: Place): Place | null {
  const at = Math.max(was.at, now.at)
  return at === was.at ? null : { ...was, at }
}

/** Newest first, the order the list shows and the time index reads backwards: by time, then by id. */
export function newestFirst(a: Place, b: Place): number {
  return b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
}

/** Whether a place comes after the cursor in newest-first order, so it belongs on the next page. */
export function pastCursor(p: Place, after: PlaceCursor | null): boolean {
  return after === null || p.at < after.at || (p.at === after.at && p.id < after.id)
}
