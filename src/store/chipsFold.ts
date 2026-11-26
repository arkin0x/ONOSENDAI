/**
 * chipsFold.ts: the top-left chips put away or on show (owner, 2026-11-26:
 * "tapping it swipes all the chips off the left of the screen and unloads
 * them. only the arrow chip remains ... pressing it again will load and
 * slide all the chips back onto the screen"). The arrow chip is
 * hud/ChipFold.tsx; App unmounts the chips while they are put away.
 *
 * KEPT PER IDENTITY IN INDEXEDDB (owner, 2026-11-19: "all local data per
 * npub, in IndexedDB"): one record per pubkey, `onosendai:chips-folded:<pubkey>`,
 * through lib/kvStore.ts (the prefix is in its MOVED_PREFIXES), read
 * synchronously from memory. `1` is put away; anything else, or no record, is
 * on show. Switching identity reads that identity's own record and deletes
 * nothing. The same shape as store/sfxSwitch.ts.
 *
 * Nothing the chips show lives in them: the chain, notifications, finds and
 * toasts are in their stores, so a chip mounted again draws what is true now.
 */

import { create } from 'zustand'
import { kvGet, kvSet } from '../lib/kvStore'
import { useCyberspace } from './useCyberspace'

/** The record's prefix; the pubkey follows. */
export const CHIPS_FOLD_PREFIX = 'onosendai:chips-folded:'

/** Choices that did not read back once written (storage refused, or none at all): kept for this page's life. */
const unsaved = new Map<string, boolean>()

/** Ticks when the chips are put away or brought back, here or in another tab, so whatever reads it draws again. */
export const useChipsFoldTick = create<{ flips: number }>(() => ({ flips: 0 }))

function flipped(): void {
  useChipsFoldTick.setState((s) => ({ flips: s.flips + 1 }))
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e: StorageEvent) => { if (e.key?.startsWith(CHIPS_FOLD_PREFIX)) flipped() })
}

function identity(): string {
  return useCyberspace.getState().identity.pubkey
}

/** Whether `pubkey` has the chips put away: its stored choice, on show when it has made none. */
export function chipsFoldedFor(pubkey: string): boolean {
  const kept = unsaved.get(pubkey)
  if (kept !== undefined) return kept
  return kvGet(CHIPS_FOLD_PREFIX + pubkey) === '1'
}

/** Whether the identity on screen has the chips put away. */
export function chipsFolded(): boolean {
  return chipsFoldedFor(identity())
}

/** Put the chips away or bring them back for `pubkey` (the identity on screen), kept in IndexedDB. */
export function setChipsFolded(folded: boolean, pubkey: string = identity()): void {
  const key = CHIPS_FOLD_PREFIX + pubkey
  const value = folded ? '1' : '0'
  try { kvSet(key, value) } catch { /* refused: kept below */ }
  if (kvGet(key) === value) unsaved.delete(pubkey)
  else unsaved.set(pubkey, folded)
  flipped()
}

/** The arrow chip's tap, and U on a keyboard. */
export function toggleChipsFolded(): void {
  setChipsFolded(!chipsFolded())
}

/** Whether the identity on screen has the chips put away, kept current. */
export function useChipsFolded(): boolean {
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  useChipsFoldTick((s) => s.flips)
  return chipsFoldedFor(pubkey)
}

/** For tests: forget the choices whose write was refused, as a reload does. */
export function forgetChipsFold(): void {
  unsaved.clear()
}
