/**
 * sfxSwitch.ts: Settings > Effects > Sound effects (owner, 2026-11-24: a
 * "Sound effects" switch, on by default, kept per npub in IndexedDB, which
 * every sound played through lib/sfx.ts obeys; MUTE ALL still silences them
 * too).
 *
 * KEPT PER IDENTITY IN INDEXEDDB (owner, 2026-11-19: "all local data per
 * npub, in IndexedDB"): one record per pubkey, `onosendai:sfx:<pubkey>`,
 * through lib/kvStore.ts (the prefix is in its MOVED_PREFIXES), read
 * synchronously from memory. `0` is off; anything else, or no record, is on.
 * Switching identity reads that identity's own record and deletes nothing.
 *
 * Read on every sound (sfxOn) straight from kvStore's memory, so another
 * tab's flip (kvStore refreshes its copy and fires `storage`) is heard at
 * once, and the Settings row draws again on that event. Nothing is read as
 * this module loads: the identity is asked for when a sound plays.
 */

import { create } from 'zustand'
import { kvGet, kvSet } from '../lib/kvStore'
import { useCyberspace } from './useCyberspace'

/** The record's prefix; the pubkey follows. */
export const SFX_PREFIX = 'onosendai:sfx:'

/** Choices that did not read back once written (localStorage full, or no storage at all): kept for this page's life. */
const unsaved = new Map<string, boolean>()

/** Ticks when a switch is flipped, here or in another tab, so the Settings row draws again. */
export const useSfxSwitch = create<{ flips: number }>(() => ({ flips: 0 }))

function flipped(): void {
  useSfxSwitch.setState((s) => ({ flips: s.flips + 1 }))
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e: StorageEvent) => { if (e.key?.startsWith(SFX_PREFIX)) flipped() })
}

function identity(): string {
  return useCyberspace.getState().identity.pubkey
}

/** Whether `pubkey` has sound effects on: its stored choice, on when it has made none. */
export function sfxOnFor(pubkey: string): boolean {
  const kept = unsaved.get(pubkey)
  if (kept !== undefined) return kept
  return kvGet(SFX_PREFIX + pubkey) !== '0'
}

/** Whether the identity on screen has sound effects on. */
export function sfxOn(): boolean {
  return sfxOnFor(identity())
}

/** Turn sound effects on or off for `pubkey` (the identity on screen), kept in IndexedDB. */
export function setSfxOn(on: boolean, pubkey: string = identity()): void {
  const key = SFX_PREFIX + pubkey
  const value = on ? '1' : '0'
  try { kvSet(key, value) } catch { /* refused: kept below */ }
  // Kept where it reads back; where it does not (refused, or no storage at all), for this page's life.
  if (kvGet(key) === value) unsaved.delete(pubkey)
  else unsaved.set(pubkey, on)
  flipped()
}

/** The switch for the identity on screen, for the Settings row. */
export function useSfxOn(): boolean {
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  useSfxSwitch((s) => s.flips)
  return sfxOnFor(pubkey)
}

/** For tests: forget the choices whose write was refused, as a reload does. */
export function forgetSfxSwitch(): void {
  unsaved.clear()
}
