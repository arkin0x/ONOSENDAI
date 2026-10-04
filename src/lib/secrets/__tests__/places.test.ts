/**
 * places.test.ts: a place is the spot you stood on, kept once, and its cube
 * keys are kept once however many places share them (arkinox, 2026-10-03).
 *
 * The rules, and the in-memory store that keeps places before IndexedDB
 * opens and for a session without it. The same rules in IndexedDB are in
 * db.test.ts and secretsStorage.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { MemoryPlaces } from '../memoryPlaces'
import { newestFirst, pastCursor, placeId, placeOf, restood, type ScanKey } from '../places'

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

function stand(m: MemoryPlaces, at: typeof here, now: number, plane: 0 | 1 = 0): void {
  const p = placeOf(at, plane, scanAt(at), now)!
  m.record(p.place, p.keys)
}

describe('a place', () => {
  it('is named by the 2^0 cube it stood in, in its plane, with every height in order', () => {
    const got = placeOf(here, 1, [...scanAt(here)].reverse(), 5)!
    expect(got.place.id).toBe(placeId(1, scanAt(here)[0].lookupId))
    expect(got.place.keys).toEqual(scanAt(here).map((k) => k.lookupId))
    expect(got.keys[12].base).toEqual({ x: String(here.x), y: String(here.y), z: String(here.z) })
    expect(got.keys.every((k) => k.plane === 1)).toBe(true)
  })

  it('is nothing without a 2^0 key to name it by', () => {
    expect(placeOf(here, 0, scanAt(here).slice(1), 5)).toBeNull()
  })

  it('stood on again moves its time and keeps the first; the same second changes nothing', () => {
    const was = placeOf(here, 0, scanAt(here), 100)!.place
    expect(restood(was, { ...was, at: 250 })).toMatchObject({ first: 100, at: 250 })
    expect(restood(was, { ...was, at: 100 })).toBeNull()
  })

  it('pages newest first, a page starting just past the last row of the one before', () => {
    const a = { ...placeOf(here, 0, scanAt(here), 300)!.place, id: 'a' }
    const b = { ...a, id: 'b' }
    const c = { ...a, id: 'c', at: 200 }
    expect([c, a, b].sort(newestFirst).map((p) => p.id)).toEqual(['b', 'a', 'c'])
    expect(pastCursor(a, { at: 300, id: 'b' })).toBe(true)
    expect(pastCursor(b, { at: 300, id: 'b' })).toBe(false)
    expect(pastCursor(c, { at: 300, id: 'a' })).toBe(true)
  })
})

describe('places in memory', () => {
  it('the same spot is one place with its time moved, and stores no keys again', () => {
    const m = new MemoryPlaces()
    stand(m, here, 100)
    const before = m.totals()
    stand(m, here, 250)
    expect(m.totals().places).toBe(1)
    expect(m.totals().placeKeys).toBe(before.placeKeys)
    expect(m.page(null, 10)[0]).toMatchObject({ first: 100, at: 250 })
  })

  it('neighbors one gibson apart differ only in the cube that splits them, so their keys are stored once', () => {
    const m = new MemoryPlaces()
    stand(m, here, 100)
    stand(m, nextDoor, 200)
    // here.x is a multiple of 2^40 and nextDoor.x one past it: every cube of
    // side 2^1 and up holds both.
    expect(m.totals()).toMatchObject({ places: 2, placeKeys: 14 })
  })

  it('the same spot in the other plane is another place, with the same keys stored once', () => {
    const m = new MemoryPlaces()
    stand(m, here, 100, 0)
    stand(m, here, 200, 1)
    expect(m.totals()).toMatchObject({ places: 2, placeKeys: 13 })
    // Stood in plane 1 last: that is the plane its keys are read in.
    expect(m.keysOf([scanAt(here)[12].lookupId])[0].plane).toBe(1)
  })

  it('forgetting a place keeps the keys another place still uses', () => {
    const m = new MemoryPlaces()
    stand(m, here, 100)
    stand(m, nextDoor, 200)
    m.forget(placeId(0, scanAt(here)[0].lookupId))
    expect(m.totals()).toMatchObject({ places: 1, placeKeys: 13 })
    expect(m.keysOf([scanAt(here)[0].lookupId])).toEqual([])
  })

  it('forgets up to a time, and pages the rest', () => {
    const m = new MemoryPlaces()
    stand(m, here, 100)
    stand(m, nextDoor, 200)
    m.forgetUpTo(150)
    expect(m.page(null, 10).map((p) => p.at)).toEqual([200])
  })

  it('hands everything over once, oldest first, and is empty after', () => {
    const m = new MemoryPlaces()
    stand(m, nextDoor, 200)
    stand(m, here, 100)
    const out = m.drain()
    expect(out.map((o) => o.place.at)).toEqual([100, 200])
    expect(out[0].keys).toHaveLength(13)
    expect(m.totals()).toEqual({ bytes: 0, places: 0, placeKeys: 0 })
  })
})
