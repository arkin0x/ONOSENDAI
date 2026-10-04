/**
 * places.test.ts: a place is the spot you stood on, kept once, and its cube
 * keys are kept once however many places share them (arkinox, 2026-10-03).
 */

import { describe, expect, it } from 'vitest'
import { mergePlace, orphanedBy, placeId, placeList, placeOf, placeRefs, type Place, type PlaceKey, type ScanKey } from '../places'

/**
 * The thirteen keys a scan computes at a position. The lookup id names the
 * cube (its height and aligned corner), as the real one does through sha256:
 * the same cube always has the same id, and nearby positions share the high ones.
 */
function scanAt(p: { x: bigint; y: bigint; z: bigint }): ScanKey[] {
  return Array.from({ length: 13 }, (_, h) => {
    const b = (v: bigint): bigint => (v >> BigInt(h)) << BigInt(h)
    return { lookupId: `h${h}:${b(p.x)},${b(p.y)},${b(p.z)}`, keyHex: `k${h}:${b(p.x)}`, height: h }
  })
}

const here = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const nextDoor = { ...here, x: here.x + 1n }

function fold(places: Record<string, Place>, placeKeys: Record<string, PlaceKey>, at: typeof here, now: number, plane: 0 | 1 = 0): void {
  const merged = mergePlace(places, placeKeys, placeOf(at, plane, scanAt(at), now)!)
  places[merged.place.id] = merged.place
  for (const k of merged.newKeys) placeKeys[k.lookupId] = k
}

describe('a place', () => {
  it('is named by the 2^0 cube it stood in, in its plane, with every height in order', () => {
    const got = placeOf(here, 1, [...scanAt(here)].reverse(), 5)!
    expect(got.place.id).toBe(placeId(1, scanAt(here)[0].lookupId))
    expect(got.place.keys).toEqual(scanAt(here).map((k) => k.lookupId))
    expect(got.keys[12].base).toEqual({ x: String(here.x), y: String(here.y), z: String(here.z) })
    expect(got.place.position.x).toBe(String(here.x))
  })

  it('is nothing without a 2^0 key to name it by', () => {
    expect(placeOf(here, 0, scanAt(here).slice(1), 5)).toBeNull()
  })
})

describe('standing on the same spot again', () => {
  it('moves the time and keeps the first, never a second row', () => {
    const places: Record<string, Place> = {}
    const placeKeys: Record<string, PlaceKey> = {}
    fold(places, placeKeys, here, 100)
    fold(places, placeKeys, here, 250)
    expect(Object.keys(places)).toHaveLength(1)
    const p = Object.values(places)[0]
    expect(p.at).toBe(250)
    expect(p.first).toBe(100)
  })

  it('stores no keys the second time', () => {
    const places: Record<string, Place> = {}
    const placeKeys: Record<string, PlaceKey> = {}
    fold(places, placeKeys, here, 100)
    const again = mergePlace(places, placeKeys, placeOf(here, 0, scanAt(here), 200)!)
    expect(again.newKeys).toEqual([])
    expect(again.previous).not.toBeNull()
  })

  it('in the other plane is another place, with the same keys stored once', () => {
    const places: Record<string, Place> = {}
    const placeKeys: Record<string, PlaceKey> = {}
    fold(places, placeKeys, here, 100, 0)
    fold(places, placeKeys, here, 200, 1)
    expect(Object.keys(places)).toHaveLength(2)
    expect(Object.keys(placeKeys)).toHaveLength(13)
  })
})

describe('keys nearby places share', () => {
  it('are stored once: two neighbors one gibson apart differ only in the cubes that split them', () => {
    const places: Record<string, Place> = {}
    const placeKeys: Record<string, PlaceKey> = {}
    fold(places, placeKeys, here, 100)
    fold(places, placeKeys, nextDoor, 200)
    // here.x is a multiple of 2^40 and nextDoor.x is one past it, so only the
    // 2^0 cube differs: every cube of side 2^1 and up holds both.
    expect(Object.keys(places)).toHaveLength(2)
    expect(Object.keys(placeKeys)).toHaveLength(13 + 1)
    expect(placeRefs(places).get(scanAt(here)[12].lookupId)).toBe(2)
  })

  it('stay while another place still refers to them', () => {
    const places: Record<string, Place> = {}
    const placeKeys: Record<string, PlaceKey> = {}
    fold(places, placeKeys, here, 100)
    fold(places, placeKeys, nextDoor, 200)
    const gone = places[placeId(0, scanAt(here)[0].lookupId)]
    expect(orphanedBy([gone], places)).toEqual([scanAt(here)[0].lookupId])
  })
})

describe('the list', () => {
  it('is last stood on first', () => {
    const places: Record<string, Place> = {}
    const placeKeys: Record<string, PlaceKey> = {}
    fold(places, placeKeys, here, 100)
    fold(places, placeKeys, nextDoor, 200)
    fold(places, placeKeys, here, 300)
    expect(placeList(places).map((p) => p.at)).toEqual([300, 200])
  })
})
