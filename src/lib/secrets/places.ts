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

/**
 * A cube key some place refers to, stored once however many places share it.
 *
 * No plane: a region key is computed from the coordinate alone (the worker
 * is never told the plane), so the same cube in either plane has the same
 * key. The places that refer to it carry the plane.
 */
export interface PlaceKey {
  lookupId: string
  keyHex: string
  height: number
  /** The cube's aligned corner, as decimal strings. */
  base: { x: string; y: string; z: string }
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
    keys: sorted.map((k) => ({ lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, base: alignedBase(position, k.height) })),
  }
}

/**
 * Fold a place into what is kept: what changes, and which rows to write.
 *
 * Standing on a place already kept moves its time and keeps when you first
 * stood there; its keys are already stored. A new place stores the keys no
 * other place has stored yet, and refers to the rest.
 */
export function mergePlace(
  places: Record<string, Place>,
  placeKeys: Record<string, PlaceKey>,
  next: { place: Place; keys: PlaceKey[] },
): { place: Place; newKeys: PlaceKey[]; previous: Place | null } {
  const previous = places[next.place.id] ?? null
  if (previous) return { place: { ...previous, at: Math.max(previous.at, next.place.at) }, newKeys: [], previous }
  return { place: next.place, newKeys: next.keys.filter((k) => !placeKeys[k.lookupId]), previous: null }
}

/** How many kept places refer to each place key. */
export function placeRefs(places: Record<string, Place>): Map<string, number> {
  const refs = new Map<string, number>()
  for (const p of Object.values(places)) {
    for (const id of p.keys) refs.set(id, (refs.get(id) ?? 0) + 1)
  }
  return refs
}

/** The place keys no place but these refers to: what goes when these places go. */
export function orphanedBy(gone: Place[], places: Record<string, Place>): string[] {
  const leaving = new Set(gone.map((p) => p.id))
  const candidates = new Set(gone.flatMap((p) => p.keys))
  for (const p of Object.values(places)) {
    if (leaving.has(p.id)) continue
    for (const id of p.keys) candidates.delete(id)
    if (candidates.size === 0) break
  }
  return [...candidates]
}

/** The places, last stood on first. */
export function placeList(places: Record<string, Place>): Place[] {
  return Object.values(places).sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))
}
