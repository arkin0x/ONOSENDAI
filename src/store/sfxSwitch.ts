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
 * Read on every sound (sfxOn), so it is a lookup in memory and nothing more;
 * the identity is asked for when a sound plays, never as this module loads.
 */

import { create } from 'zustand'
import { kvGet, kvSet } from '../lib/kvStore'
import { useCyberspace } from './useCyberspace'

/** The record's prefix; the pubkey follows. */
export const SFX_PREFIX = 'onosendai:sfx:'

/** Each identity's switch, as read or set in this page's life. */
const known = new Map<string, boolean>()

/** Ticks when a switch is flipped here, so the Settings row draws again. */
export const useSfxSwitch = create<{ flips: number }>(() => ({ flips: 0 }))

function identity(): string {
  return useCyberspace.getState().identity.pubkey
}

/** Whether `pubkey` has sound effects on: its stored choice, on when it has made none. */
export function sfxOnFor(pubkey: string): boolean {
  let on = known.get(pubkey)
  if (on === undefined) {
    on = kvGet(SFX_PREFIX + pubkey) !== '0'
    known.set(pubkey, on)
  }
  return on
}

/** Whether the identity on screen has sound effects on. */
export function sfxOn(): boolean {
  return sfxOnFor(identity())
}

/** Turn sound effects on or off for `pubkey` (the identity on screen), kept in IndexedDB. */
export function setSfxOn(on: boolean, pubkey: string = identity()): void {
  known.set(pubkey, on)
  try { kvSet(SFX_PREFIX + pubkey, on ? '1' : '0') } catch { /* storage full or refused: this page's life only */ }
  useSfxSwitch.setState((s) => ({ flips: s.flips + 1 }))
}

/** The switch for the identity on screen, for the Settings row. */
export function useSfxOn(): boolean {
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  useSfxSwitch((s) => s.flips)
  return sfxOnFor(pubkey)
}

/** For tests: forget what was read. */
export function forgetSfxSwitch(): void {
  known.clear()
}
