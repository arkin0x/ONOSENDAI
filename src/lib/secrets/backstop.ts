/**
 * backstop.ts: what localStorage keeps beside IndexedDB, and why.
 *
 * Two records, neither of them the old list (`onosendai:secrets`), which from
 * this build on is only ever read: by the one-time copy into IndexedDB, and
 * by db.syncLegacy, which takes in keys a tab still on an older build adds.
 *
 * - BOUGHT_KEY: a second copy of every bought key, in every mode, always. A
 *   bought key cannot be computed again; losing it loses sats. IndexedDB can
 *   fail for a session, and a key held then would otherwise live only in
 *   memory. A key leaves only when you forget it yourself (the ✕ on its row,
 *   or FORGET ALL KEYS after the confirmation that counts the bought keys).
 *   Nothing else ever clears it. A few hundred bytes a key, and there are few.
 * - FALLBACK_KEY: what a session without IndexedDB did to the held keys,
 *   and only that: the keys it held and the keys it forgot. The next session
 *   that opens IndexedDB applies it and clears it (review of #219, S2). A
 *   fallback session that does nothing writes nothing, so it can never bring
 *   back a key forgotten in IndexedDB that it did not hold itself.
 *
 * Every write here reads the current value first, so two tabs adding keys do
 * not undo each other, and says whether it landed: localStorage is a few
 * megabytes shared with the action chain, and a full one refuses.
 */

import type { HeldKey } from '../../store/useSecrets'
import { describeError, parseLegacy } from './db'

export const BOUGHT_KEY = 'onosendai:secrets:bought'
export const FALLBACK_KEY = 'onosendai:secrets:fallback'

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** The bought keys kept here, by lookup id. */
export function readBought(): Record<string, HeldKey> {
  try { return parseLegacy(storage()?.getItem(BOUGHT_KEY) ?? null) } catch { return {} }
}

/**
 * Add bought keys and drop forgotten ones. Keys that are not bought are
 * ignored, so a caller can pass everything it holds or forgets. Returns null
 * when it landed or there was nothing to do, else why it did not.
 */
export function updateBought(add: HeldKey[], remove: string[] = []): string | null {
  const bought = add.filter((k) => k.source === 'cloud')
  if (bought.length === 0 && remove.length === 0) return null
  const s = storage()
  if (!s) return bought.length > 0 ? 'localStorage is not available here' : null
  try {
    const kept = parseLegacy(s.getItem(BOUGHT_KEY))
    let changed = false
    for (const k of bought) if (!kept[k.lookupId]) { kept[k.lookupId] = k; changed = true }
    for (const id of remove) if (kept[id]) { delete kept[id]; changed = true }
    if (changed) s.setItem(BOUGHT_KEY, JSON.stringify(kept))
    return null
  } catch (err) {
    return describeError(err)
  }
}

/** What fallback sessions did to the held keys since IndexedDB last loaded. */
export interface FallbackRecord {
  held: Record<string, HeldKey>
  forgotten: string[]
}

export function readFallback(): FallbackRecord {
  try {
    const raw = storage()?.getItem(FALLBACK_KEY) ?? null
    if (!raw) return { held: {}, forgotten: [] }
    const parsed = JSON.parse(raw) as { held?: unknown; forgotten?: unknown }
    return {
      held: parseLegacy(JSON.stringify(parsed.held ?? {})),
      forgotten: Array.isArray(parsed.forgotten) ? parsed.forgotten.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return { held: {}, forgotten: [] }
  }
}

/** Record a fallback session's holds and forgets. Null when it landed, else why not. */
export function noteFallback(held: HeldKey[], forgotten: string[]): string | null {
  if (held.length === 0 && forgotten.length === 0) return null
  const s = storage()
  if (!s) return 'localStorage is not available here'
  try {
    const rec = readFallback()
    for (const k of held) { rec.held[k.lookupId] = k; rec.forgotten = rec.forgotten.filter((id) => id !== k.lookupId) }
    for (const id of forgotten) { delete rec.held[id]; if (!rec.forgotten.includes(id)) rec.forgotten.push(id) }
    s.setItem(FALLBACK_KEY, JSON.stringify(rec))
    return null
  } catch (err) {
    return describeError(err)
  }
}

/** Once IndexedDB has applied it. */
export function clearFallback(): void {
  // Refused: the record is applied again at the next load. Its holds only
  // fill gaps; its forgets would take again a key held again since.
  try { storage()?.removeItem(FALLBACK_KEY) } catch { /* see above */ }
}
