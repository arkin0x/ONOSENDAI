/**
 * budget.ts: how much room region keys and places may take, and what goes first.
 *
 * The budget is bytes, not a count (arkinox, 2026-10-03): 250 MB for the held
 * keys and the places together, measured as each row's serialized size. A
 * count cap treated a bought key and a place as the same size and the same
 * worth; neither is true.
 *
 * When the total passes the budget, rows go in this order until it is down
 * to EVICT_TO of the budget, in one pass, so the work is done once per few
 * megabytes of growth rather than on every write:
 *
 * 1. Scanned places, the one last stood on longest ago first, and with each
 *    place the cube keys no remaining place refers to. A place is a note of
 *    where you stood, and standing there again rebuilds it in milliseconds.
 * 2. Held keys that were opened by a scan or crossed by a hop, oldest first,
 *    the two kinds together. An opened key, and a crossed key whose region is
 *    no wider than 2^12 gibsons, comes back by standing in that region again,
 *    because the passive scan computes every cube up to 2^12 where you stand.
 *    A crossed key wider than that (2^13 to 2^20) comes back only by hopping
 *    across that region again, which is why every place goes before any key.
 * 3. Never a key bought from HOSAKA. It was paid for in sats, and this machine
 *    cannot compute it back. If bought keys alone pass the budget, they stay
 *    and the total stays over.
 *
 * The total itself is kept by secrets/db, which measures only the rows each
 * write touches. The places are evicted there, from the oldest end of their
 * time index; the held keys are chosen here, from memory, where they live.
 */

import type { HeldKey } from '../../store/useSecrets'

/** 250 MB, in the same 1024-based megabytes the panel shows. */
export const SECRETS_BUDGET_BYTES = 250 * 1024 * 1024

/** Once over the budget, evict down to this share of it. */
export const EVICT_TO = 0.95

/** Places taken per eviction transaction, so one pass never holds the database for long. */
export const EVICT_PLACES_PER_PASS = 500

/** What one row costs, measured as it is serialized. Every field is ASCII, so characters are bytes. */
export function bytesOf(row: unknown): number {
  return JSON.stringify(row).length
}

/** The total of a set of rows. */
export function bytesOfAll(rows: Iterable<unknown>): number {
  let n = 0
  for (const row of rows) n += bytesOf(row)
  return n
}

/**
 * The opened and crossed keys to drop to free `need` bytes, oldest first.
 * Never a bought key; fewer than `need` bytes when only bought keys are left.
 */
export function earnedToEvict(keys: Record<string, HeldKey>, need: number): HeldKey[] {
  if (need <= 0) return []
  const oldest = Object.values(keys)
    .filter((k) => k.source !== 'cloud')
    .sort((a, b) => a.at - b.at || (a.lookupId < b.lookupId ? -1 : 1))
  const out: HeldKey[] = []
  let freed = 0
  for (const k of oldest) {
    if (freed >= need) break
    out.push(k)
    freed += bytesOf(k)
  }
  return out
}

/**
 * The localStorage fallback's cap, by count as before this database: the
 * newest `max`, where only opened and crossed keys are ever dropped. Every
 * bought key stays, so with more than `max` of them the list holds them all.
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
