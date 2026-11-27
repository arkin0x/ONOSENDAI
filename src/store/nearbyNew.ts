/**
 * nearbyNew.ts: the finds NEARBY has not shown you yet, the orange "+12" on
 * the NEARBY chip (owner, 2026-11-26: "the found here chip is always too
 * long... can we get rid of it and instead just alter the NEARBY chip to say
 * NEARBY + 12 where the +12 would be orange to contrast with the blue. then
 * people know that new stuff has been discovered nearby without the
 * clutter").
 *
 * WHAT COUNTS. Every find the find ceremony marks (store/useCeremony mark:
 * here, in the view's plane, not muted, the tour's curators only) while the
 * Nearby list is shut. The chip shows how many of them are among what NEARBY
 * lists right now (freshAmong), so a find in a room closed since, or one
 * left behind when you move, drops out of the +N on its own and comes back
 * with OPEN or with you, without being counted twice.
 *
 * WHEN IT CLEARS. Opening the Nearby list clears what it lists, all at once.
 * Not item by item: the list shows everything around you together, so
 * having opened it is having seen them, and "opened Nearby" is something a
 * player can tell they did, where "viewed each item" would leave a +2
 * nobody can account for. A find made somewhere else and not listed here
 * stays new until you are back where NEARBY lists it and open the list.
 * Opening a hidden message's, item's or sound's own card (the item modal)
 * has seen that one too: it leaves the +N and stops pulsing NEW in the world
 * (hud/SecretModal; owner ruling, 2026-11-27, read and new states on every
 * hidden thing).
 *
 * KEPT PER IDENTITY IN INDEXEDDB (owner, 2026-11-19): one record per pubkey,
 * `onosendai:nearby-new:<pubkey>`, a JSON list of event ids (at most
 * NEARBY_NEW_MAX, the newest kept), through lib/kvStore.ts (the prefix is in
 * its MOVED_PREFIXES). Switching identity reads that identity's own record
 * and deletes nothing.
 */

import { create } from 'zustand'
import { kvGet, kvRemove, kvSet } from '../lib/kvStore'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { useSecrets } from './useSecrets'
import { nearbyItems } from '../lib/nearby'

/** The record's prefix; the pubkey follows. */
export const NEARBY_NEW_PREFIX = 'onosendai:nearby-new:'

/** The most finds kept unseen per identity: the newest stay. */
export const NEARBY_NEW_MAX = 500

/** Ticks on every change, here or in another tab, so the chip draws again. */
export const useNearbyNewTick = create<{ flips: number }>(() => ({ flips: 0 }))

/** Lists whose write did not read back (storage refused): kept for this page's life. */
const unsaved = new Map<string, readonly string[]>()
/** The last record read per identity, parsed once. */
const parsed = new Map<string, { raw: string | null; ids: ReadonlySet<string> }>()

function flipped(): void {
  useNearbyNewTick.setState((s) => ({ flips: s.flips + 1 }))
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e: StorageEvent) => { if (e.key?.startsWith(NEARBY_NEW_PREFIX)) flipped() })
}

function identity(): string {
  return useCyberspace.getState().identity.pubkey
}

function listOf(pubkey: string): readonly string[] {
  const kept = unsaved.get(pubkey)
  if (kept) return kept
  return [...nearbyNewFor(pubkey)]
}

/** The finds `pubkey` has not seen in the Nearby list yet. */
export function nearbyNewFor(pubkey: string): ReadonlySet<string> {
  const kept = unsaved.get(pubkey)
  if (kept) return new Set(kept)
  const raw = kvGet(NEARBY_NEW_PREFIX + pubkey)
  const was = parsed.get(pubkey)
  if (was && was.raw === raw) return was.ids
  let ids: ReadonlySet<string> = new Set()
  try {
    const list: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(list)) ids = new Set(list.filter((x): x is string => typeof x === 'string'))
  } catch { /* unreadable: nothing new */ }
  parsed.set(pubkey, { raw, ids })
  return ids
}

function write(pubkey: string, list: readonly string[]): void {
  const key = NEARBY_NEW_PREFIX + pubkey
  if (list.length === 0) {
    try { kvRemove(key) } catch { /* refused */ }
    if (kvGet(key) === null) unsaved.delete(pubkey)
    else unsaved.set(pubkey, [])
  } else {
    const value = JSON.stringify(list)
    try { kvSet(key, value) } catch { /* refused: kept below */ }
    if (kvGet(key) === value) unsaved.delete(pubkey)
    else unsaved.set(pubkey, list)
  }
  flipped()
}

/** New finds for `pubkey` (the identity on screen): counted on NEARBY until the list is opened. */
export function addNearbyNew(ids: readonly string[], pubkey: string = identity()): void {
  watchNearbyOpen()
  // Found with the list open: it is on screen in the list already.
  if (useShards.getState().nearbyOpen) return
  const list = listOf(pubkey)
  const have = new Set(list)
  const fresh = [...new Set(ids)].filter((id) => !have.has(id))
  if (fresh.length === 0) return
  write(pubkey, [...list, ...fresh].slice(-NEARBY_NEW_MAX))
}

/** Seen: these (or, with none named, every find) are off the +N. */
export function clearNearbyNew(pubkey: string = identity(), seen?: Iterable<string>): void {
  const list = listOf(pubkey)
  if (list.length === 0) return
  if (!seen) { write(pubkey, []); return }
  const gone = new Set(seen)
  const left = list.filter((id) => !gone.has(id))
  if (left.length !== list.length) write(pubkey, left)
}

/** What the Nearby list shows where the view stands now (hooks/useNearbyLoot.ts, read once). */
function listedNow(): string[] {
  const cs = useCyberspace.getState()
  return nearbyItems(useShards.getState().worldItems(), Object.values(useSecrets.getState().keys), cs.anchor, cs.anchorPlane).map((it) => it.key)
}

/** How many of `keys` (what NEARBY lists now) are new. */
export function freshAmong(keys: Iterable<string>, fresh: ReadonlySet<string>): number {
  if (fresh.size === 0) return 0
  let n = 0
  for (const k of keys) if (fresh.has(k)) n++
  return n
}

/** The identity on screen's unseen finds, kept current. */
export function useNearbyNew(): ReadonlySet<string> {
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  useNearbyNewTick((s) => s.flips)
  return nearbyNewFor(pubkey)
}

/** For tests: forget the lists whose write was refused and the parsed copies, as a reload does. */
export function forgetNearbyNew(): void {
  unsaved.clear()
  parsed.clear()
}

// Opening the Nearby list is seeing what is in it, from the chip, the menu's
// button or anywhere else that opens it.
let watching = false
export function watchNearbyOpen(): void {
  if (watching) return
  watching = true
  useShards.subscribe((s, prev) => { if (s.nearbyOpen && !prev.nearbyOpen) clearNearbyNew(identity(), listedNow()) })
}
