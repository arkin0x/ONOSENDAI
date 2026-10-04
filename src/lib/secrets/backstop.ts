/**
 * backstop.ts: a second copy of every bought key, and a note that the
 * localStorage fallback wrote keys, both in localStorage.
 *
 * A bought key cannot be computed again; losing it loses sats. IndexedDB can
 * fail for a session (a private window, a browser that refuses it, a
 * connection another tab closed), and a key held then would live only in
 * memory or only in the fallback's localStorage list, which the next session
 * on IndexedDB never read: the copy from localStorage runs once. So:
 *
 * - Every bought key is also written here, in every mode, always. It leaves
 *   only when you forget it yourself (the ✕ on its row, or FORGET ALL KEYS
 *   after the confirmation that counts the bought keys). Nothing else ever
 *   clears it. A few hundred bytes a key, and there are few.
 * - A session that writes held keys to the localStorage fallback sets
 *   FALLBACK_MARKER. The next session that opens IndexedDB merges in the
 *   fallback's keys it does not have, then clears the marker.
 *
 * Every write here reads the current value first, so two tabs adding keys
 * do not undo each other.
 */

import type { HeldKey } from '../../store/useSecrets'
import { parseLegacy } from './db'

export const BOUGHT_KEY = 'onosendai:secrets:bought'
export const FALLBACK_MARKER = 'onosendai:secrets:fallbackWrote'

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** The bought keys kept here, by lookup id. */
export function readBought(): Record<string, HeldKey> {
  try { return parseLegacy(storage()?.getItem(BOUGHT_KEY) ?? null) } catch { return {} }
}

/**
 * Add bought keys and drop forgotten ones. Keys that are not bought are
 * ignored, so a caller can pass everything it holds or forgets.
 */
export function updateBought(add: HeldKey[], remove: string[] = []): void {
  const bought = add.filter((k) => k.source === 'cloud')
  if (bought.length === 0 && remove.length === 0) return
  const s = storage()
  if (!s) return
  try {
    const kept = parseLegacy(s.getItem(BOUGHT_KEY))
    let changed = false
    for (const k of bought) if (!kept[k.lookupId]) { kept[k.lookupId] = k; changed = true }
    for (const id of remove) if (kept[id]) { delete kept[id]; changed = true }
    if (changed) s.setItem(BOUGHT_KEY, JSON.stringify(kept))
  } catch { /* full or refused: IndexedDB or the fallback list still has it */ }
}

/** Note that the fallback wrote keys IndexedDB may not have. */
export function markFallbackWrote(): void {
  try { storage()?.setItem(FALLBACK_MARKER, String(Math.floor(Date.now() / 1000))) } catch { /* refused */ }
}

export function fallbackWrote(): boolean {
  try { return !!storage()?.getItem(FALLBACK_MARKER) } catch { return false }
}

/** Once IndexedDB has the fallback's keys. */
export function clearFallbackMarker(): void {
  try { storage()?.removeItem(FALLBACK_MARKER) } catch { /* refused */ }
}
