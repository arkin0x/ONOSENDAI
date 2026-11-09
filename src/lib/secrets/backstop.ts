/**
 * backstop.ts: what localStorage keeps beside IndexedDB, and why.
 *
 * Two records (and REFUSED_KEY, below), neither of them the old list (`onosendai:secrets`), which from
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
 *   and only that: the keys it held and the keys it forgot, each forget with
 *   the time it was made. The next session that opens IndexedDB applies it
 *   and then removes what it applied (review of #219, S2). A fallback session
 *   that does nothing writes nothing, so it can never bring back a key
 *   forgotten in IndexedDB that it did not hold itself.
 *
 * Every write here reads the current value first, so two tabs adding keys do
 * not undo each other, and says whether it landed: localStorage is a few
 * megabytes shared with the action chain, and a full one refuses.
 */

import type { HeldKey } from '../../store/useSecrets'
import { describeError, parseLegacy } from './db'

export const BOUGHT_KEY = 'onosendai:secrets:bought'
export const FALLBACK_KEY = 'onosendai:secrets:fallback'
/**
 * Keys HOSAKA sold that failed a check at purchase (lib/regionKeyCheck.ts),
 * set aside rather than destroyed: they were paid for, and a refusal could be
 * wrong. Nothing reads this as a held key, so a key here never seals, opens
 * or is offered anywhere; it is only kept, so a false refusal can be put
 * right. Nothing clears it.
 */
export const REFUSED_KEY = 'onosendai:secrets:refused'

/** A refused key, as it was set aside: the key, the cube it was bought for, and why it was refused. */
export interface RefusedKey {
  lookupId: string
  keyHex: string
  height: number
  /** The cube asked for, computed from where it was bought, as decimal strings. */
  base: { x: string; y: string; z: string }
  plane: number
  /** Why it was refused, in the words the purchase showed. */
  why: string
  /** HOSAKA's job, when known. */
  jobId?: string
  /** When it was set aside, in seconds since the epoch. */
  at: number
}

/** The keys set aside so far, oldest first. */
export function readRefused(): RefusedKey[] {
  try {
    const parsed: unknown = JSON.parse(storage()?.getItem(REFUSED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((r): r is RefusedKey => !!r && typeof r === 'object' && typeof (r as RefusedKey).keyHex === 'string') : []
  } catch {
    return []
  }
}

/**
 * Set a refused key aside (REFUSED_KEY), once per key. Returns null when it
 * landed, else why it did not.
 */
export function setAsideRefused(key: RefusedKey): string | null {
  const s = storage()
  if (!s) return 'localStorage is not available here'
  try {
    const kept = readRefused()
    if (kept.some((r) => r.keyHex.toLowerCase() === key.keyHex.toLowerCase() && r.lookupId.toLowerCase() === key.lookupId.toLowerCase())) return null
    s.setItem(REFUSED_KEY, JSON.stringify([...kept, key]))
    return null
  } catch (err) {
    return describeError(err)
  }
}

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

/**
 * A forget made without IndexedDB, and when, in seconds. The time decides
 * whether it still applies: a key first held after it was held again since,
 * and is kept.
 */
export interface FallbackForget { id: string; at: number }

/** What fallback sessions did to the held keys since IndexedDB last applied it. */
export interface FallbackRecord {
  held: Record<string, HeldKey>
  forgotten: FallbackForget[]
}

function parseForgets(v: unknown): FallbackForget[] {
  if (!Array.isArray(v)) return []
  const out: FallbackForget[] = []
  for (const x of v) {
    // A bare id is from a build before forgets carried a time: it applies as it did then.
    if (typeof x === 'string') out.push({ id: x, at: Number.MAX_SAFE_INTEGER })
    else if (x && typeof x === 'object' && typeof (x as FallbackForget).id === 'string' && typeof (x as FallbackForget).at === 'number') out.push({ id: (x as FallbackForget).id, at: (x as FallbackForget).at })
  }
  return out
}

export function readFallback(): FallbackRecord {
  try {
    const raw = storage()?.getItem(FALLBACK_KEY) ?? null
    if (!raw) return { held: {}, forgotten: [] }
    const parsed = JSON.parse(raw) as { held?: unknown; forgotten?: unknown }
    return { held: parseLegacy(JSON.stringify(parsed.held ?? {})), forgotten: parseForgets(parsed.forgotten) }
  } catch {
    return { held: {}, forgotten: [] }
  }
}

function writeFallback(s: Storage, rec: FallbackRecord): void {
  if (Object.keys(rec.held).length === 0 && rec.forgotten.length === 0) s.removeItem(FALLBACK_KEY)
  else s.setItem(FALLBACK_KEY, JSON.stringify(rec))
}

/** Record a fallback session's holds and forgets. Null when it landed, else why not. */
export function noteFallback(held: HeldKey[], forgotten: string[]): string | null {
  if (held.length === 0 && forgotten.length === 0) return null
  const s = storage()
  if (!s) return 'localStorage is not available here'
  try {
    const rec = readFallback()
    const now = Math.floor(Date.now() / 1000)
    for (const k of held) { rec.held[k.lookupId] = k; rec.forgotten = rec.forgotten.filter((f) => f.id !== k.lookupId) }
    for (const id of forgotten) {
      delete rec.held[id]
      rec.forgotten = [...rec.forgotten.filter((f) => f.id !== id), { id, at: now }]
    }
    writeFallback(s, rec)
    return null
  } catch (err) {
    return describeError(err)
  }
}

/**
 * These keys were held again: a recorded forget of any of them no longer
 * applies. Called on every hold in every mode, so a key held again before a
 * record is applied, or after a load whose write failed and left the record,
 * is not forgotten by it later. Reads nothing more than one getItem when no
 * record exists, which is the usual case.
 */
export function clearForgets(ids: string[]): void {
  const s = storage()
  if (!s || ids.length === 0) return
  try {
    if (!s.getItem(FALLBACK_KEY)) return
    const rec = readFallback()
    const drop = new Set(ids)
    const left = rec.forgotten.filter((f) => !drop.has(f.id))
    if (left.length === rec.forgotten.length) return
    writeFallback(s, { ...rec, forgotten: left })
  } catch { /* refused: the times on the forgets still guard a key held again */ }
}

/**
 * Remove from the record what a load applied, and nothing else: a fallback
 * tab still open may have added to it while the load was writing (review of
 * #219, N1). An entry goes only if it is still exactly what was applied.
 */
export function dropApplied(applied: FallbackRecord): void {
  const s = storage()
  if (!s) return
  try {
    const rec = readFallback()
    for (const [id, k] of Object.entries(applied.held)) {
      if (rec.held[id] && JSON.stringify(rec.held[id]) === JSON.stringify(k)) delete rec.held[id]
    }
    const done = new Set(applied.forgotten.map((f) => `${f.id}@${f.at}`))
    rec.forgotten = rec.forgotten.filter((f) => !done.has(`${f.id}@${f.at}`))
    writeFallback(s, rec)
  } catch { /* refused: applied again at the next load, where every rule above holds again */ }
}
