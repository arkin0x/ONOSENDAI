/**
 * memoryPlaces.ts: places kept in memory, for while IndexedDB is not there.
 *
 * Two cases: the moments before the database opens (what is recorded then is
 * moved into it when it does), and a whole session on the localStorage
 * fallback, where places are not kept past the page because localStorage is a
 * few megabytes and the held keys need it. Small either way, so plain maps;
 * the same operations as secrets/db, so the list and RESCAN ALL do not care
 * which one they read.
 */

import { bytesOf } from './budget'
import type { Totals } from './db'
import { newestFirst, pastCursor, restood, type Place, type PlaceCursor, type PlaceKey } from './places'

export class MemoryPlaces {
  private places = new Map<string, Place>()
  private keys = new Map<string, PlaceKey>()
  /** How many places refer to each key. */
  private refs = new Map<string, number>()
  private bytes = 0

  totals(): Totals {
    return { bytes: this.bytes, places: this.places.size, placeKeys: this.keys.size }
  }

  record(place: Place, keys: PlaceKey[]): void {
    const was = this.places.get(place.id)
    if (was) {
      const next = restood(was, place)
      if (next) { this.places.set(place.id, next); this.bytes += bytesOf(next) - bytesOf(was) }
    } else {
      this.places.set(place.id, place)
      this.bytes += bytesOf(place)
      for (const id of new Set(place.keys)) this.refs.set(id, (this.refs.get(id) ?? 0) + 1)
    }
    for (const k of keys) {
      const had = this.keys.get(k.lookupId)
      if (!had) { this.keys.set(k.lookupId, k); this.bytes += bytesOf(k) } else if (had.plane !== k.plane) this.keys.set(k.lookupId, { ...had, plane: k.plane })
    }
  }

  forget(id: string): void {
    const p = this.places.get(id)
    if (!p) return
    this.places.delete(id)
    this.bytes -= bytesOf(p)
    for (const key of new Set(p.keys)) {
      const n = (this.refs.get(key) ?? 1) - 1
      if (n > 0) { this.refs.set(key, n); continue }
      this.refs.delete(key)
      const k = this.keys.get(key)
      if (k) { this.keys.delete(key); this.bytes -= bytesOf(k) }
    }
  }

  forgetUpTo(at: number): void {
    for (const p of [...this.places.values()]) if (p.at <= at) this.forget(p.id)
  }

  page(after: PlaceCursor | null, limit: number): Place[] {
    return [...this.places.values()].filter((p) => pastCursor(p, after)).sort(newestFirst).slice(0, limit)
  }

  get(id: string): Place | null {
    return this.places.get(id) ?? null
  }

  keysOf(ids: string[]): PlaceKey[] {
    return ids.map((id) => this.keys.get(id)).filter((k): k is PlaceKey => !!k)
  }

  *keyPages(size: number): Generator<PlaceKey[]> {
    const all = [...this.keys.values()]
    for (let i = 0; i < all.length; i += size) yield all.slice(i, i + size)
  }

  /** Everything recorded, oldest first, emptied: for moving into IndexedDB once it opens. */
  drain(): Array<{ place: Place; keys: PlaceKey[] }> {
    const out = [...this.places.values()].sort((a, b) => a.at - b.at).map((place) => ({ place, keys: this.keysOf(place.keys) }))
    this.places.clear()
    this.keys.clear()
    this.refs.clear()
    this.bytes = 0
    return out
  }
}
