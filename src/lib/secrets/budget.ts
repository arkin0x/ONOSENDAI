/**
 * budget.ts: how much room region keys and places may take, and what goes first.
 *
 * The budget is bytes, not a count (arkinox, 2026-10-03): 250 MB for the held
 * keys and the places together, measured as each row's serialized size. A
 * count cap treated a bought key and a place as the same size and the same
 * worth; neither is true.
 *
 * When a write takes the total past the budget, rows go in this order until
 * it fits again:
 *
 * 1. Scanned places, the one last stood on longest ago first, and with each
 *    place the cube keys no remaining place refers to. A place is a note of
 *    where you stood, and standing there again rebuilds it in milliseconds.
 * 2. Held keys that were opened by a scan or crossed by a hop, oldest first,
 *    the two kinds together. Standing in the region again computes them back.
 * 3. Never a key bought from HOSAKA. It was paid for in sats, and this machine
 *    cannot compute it back. If bought keys alone pass the budget, they stay
 *    and the total stays over.
 *
 * The caller keeps a running total and passes it in; this measures only the
 * rows it decides to drop, never the whole store.
 */

import type { HeldKey } from '../../store/useSecrets'
import { placeRefs, type Place, type PlaceKey } from './places'

/** 250 MB, in the same 1024-based megabytes the panel shows. */
export const SECRETS_BUDGET_BYTES = 250 * 1024 * 1024

/** What one row costs, measured as it is serialized. Every field is ASCII, so characters are bytes. */
export function bytesOf(row: unknown): number {
  return JSON.stringify(row).length
}

/** The total of a set of rows, for the one time a total is measured whole: at load. */
export function bytesOfAll(rows: Iterable<unknown>): number {
  let n = 0
  for (const row of rows) n += bytesOf(row)
  return n
}

export interface Eviction {
  places: string[]
  placeKeys: string[]
  keys: string[]
  /** The bytes these rows took, to take off the running total. */
  bytes: number
}

export interface Kept {
  keys: Record<string, HeldKey>
  places: Record<string, Place>
  placeKeys: Record<string, PlaceKey>
}

/** Which rows to drop to bring `total` under `budget`, in the order above. Empty when it already fits. */
export function planEviction(kept: Kept, total: number, budget: number = SECRETS_BUDGET_BYTES): Eviction {
  const out: Eviction = { places: [], placeKeys: [], keys: [], bytes: 0 }
  if (total <= budget) return out
  let over = total - budget
  const drop = (n: number): void => { out.bytes += n; over -= n }

  // How many places refer to each place key; a key goes when its count does.
  const refs = placeRefs(kept.places)

  // A key no place refers to is the cheapest thing to lose.
  for (const k of Object.values(kept.placeKeys)) {
    if (over <= 0) return out
    if (refs.has(k.lookupId)) continue
    out.placeKeys.push(k.lookupId)
    drop(bytesOf(k))
  }

  const oldestPlaces = Object.values(kept.places).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
  for (const p of oldestPlaces) {
    if (over <= 0) return out
    out.places.push(p.id)
    drop(bytesOf(p))
    for (const id of p.keys) {
      const n = (refs.get(id) ?? 0) - 1
      if (n > 0) { refs.set(id, n); continue }
      refs.delete(id)
      const k = kept.placeKeys[id]
      if (k) { out.placeKeys.push(id); drop(bytesOf(k)) }
    }
  }

  const oldestEarned = Object.values(kept.keys)
    .filter((k) => k.source !== 'cloud')
    .sort((a, b) => a.at - b.at || (a.lookupId < b.lookupId ? -1 : 1))
  for (const k of oldestEarned) {
    if (over <= 0) return out
    out.keys.push(k.lookupId)
    drop(bytesOf(k))
  }
  return out
}

/**
 * The localStorage fallback's cap, by count as before: the newest `max`, but
 * dropping opened and crossed keys before any bought one, as the budget does.
 */
export function trimByCount(keys: Record<string, HeldKey>, max: number): Record<string, HeldKey> {
  const all = Object.values(keys)
  if (all.length <= max) return keys
  const earned = all.filter((k) => k.source !== 'cloud').sort((a, b) => a.at - b.at || (a.lookupId < b.lookupId ? -1 : 1))
  const gone = new Set(earned.slice(0, all.length - max).map((k) => k.lookupId))
  const out: Record<string, HeldKey> = {}
  for (const k of all) if (!gone.has(k.lookupId)) out[k.lookupId] = k
  return out
}
