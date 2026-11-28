/**
 * airSwitch.ts: air placing on or off (owner, 2026-11-27: "Tapping the middle
 * of the place distance button should toggle it off so you can't see the
 * place cube. Tap again to toggle it on."). Off, the ghost block at arm's
 * length (lib/terrain/airPlace.ts) is never drawn, PLACE with no block at
 * the cross does nothing, and the wheel picks hotbar slots as it does when
 * you look at a block. On, as before. On by default.
 *
 * KEPT PER IDENTITY IN INDEXEDDB (owner, 2026-11-19: "all local data per
 * npub, in IndexedDB"): one record per pubkey, `onosendai:air-place:<pubkey>`,
 * through lib/kvStore.ts (the prefix is in its MOVED_PREFIXES), read
 * synchronously from memory. `0` is off; anything else, or no record, is on.
 * Switching identity reads that identity's own record and deletes nothing.
 * The same shape as store/sfxSwitch.ts and store/chipsFold.ts.
 *
 * The scene asks every frame (scene/TerrainLayer.tsx), so the answer is kept
 * until the identity changes or a switch is flipped, here or in another tab.
 */

import { create } from 'zustand'
import { kvGet, kvSet } from '../lib/kvStore'
import { useCyberspace } from './useCyberspace'

/** The record's prefix; the pubkey follows. */
export const AIR_PLACE_PREFIX = 'onosendai:air-place:'

/** The words the first time PLACE finds nothing to do with air placing off (once a page). */
export const AIR_OFF_HINT = 'Air Placement: off. Tap the number under PLACE.'

/** Choices that did not read back once written (storage refused, or none at all): kept for this page's life. */
const unsaved = new Map<string, boolean>()

/** Ticks when air placing is switched, here or in another tab, so whatever reads it draws again. */
export const useAirSwitchTick = create<{ flips: number }>(() => ({ flips: 0 }))

/** The last answer, for the frame loop: good while the pubkey and the flips are the same. */
const memo = { pubkey: '', flips: -1, on: true }

function flipped(): void {
  useAirSwitchTick.setState((s) => ({ flips: s.flips + 1 }))
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e: StorageEvent) => { if (e.key?.startsWith(AIR_PLACE_PREFIX)) flipped() })
}

function identity(): string {
  return useCyberspace.getState().identity.pubkey
}

/** Whether `pubkey` has air placing on: its stored choice, on when it has made none. */
export function airPlacingFor(pubkey: string): boolean {
  const kept = unsaved.get(pubkey)
  if (kept !== undefined) return kept
  return kvGet(AIR_PLACE_PREFIX + pubkey) !== '0'
}

/** Whether the identity on screen has air placing on (asked every frame: kept until something changes). */
export function airPlacing(): boolean {
  const pubkey = identity()
  const flips = useAirSwitchTick.getState().flips
  if (memo.pubkey !== pubkey || memo.flips !== flips) {
    memo.pubkey = pubkey; memo.flips = flips; memo.on = airPlacingFor(pubkey)
  }
  return memo.on
}

/** Turn air placing on or off for `pubkey` (the identity on screen), kept in IndexedDB. */
export function setAirPlacing(on: boolean, pubkey: string = identity()): void {
  const key = AIR_PLACE_PREFIX + pubkey
  const value = on ? '1' : '0'
  try { kvSet(key, value) } catch { /* refused: kept below */ }
  if (kvGet(key) === value) unsaved.delete(pubkey)
  else unsaved.set(pubkey, on)
  flipped()
}

/** The stepper's middle (a tap, a click, or Enter and Space). Returns whether it is on now. */
export function toggleAirPlacing(): boolean {
  const on = !airPlacing()
  setAirPlacing(on)
  return on
}

/** Whether the identity on screen has air placing on, kept current. */
export function useAirPlacing(): boolean {
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  useAirSwitchTick((s) => s.flips)
  return airPlacingFor(pubkey)
}

let hinted = false

/**
 * PLACE found nothing at the cross with air placing off: the first time a
 * page, a quiet word on how to turn it back on (through `say`, the message
 * slot under the cross); after that, nothing, so a press never spams.
 */
export function hintAirOff(say: (message: string) => void): void {
  if (hinted) return
  hinted = true
  say(AIR_OFF_HINT)
}

/** For tests: forget the refused choices and the hint, as a reload does. */
export function forgetAirSwitch(): void {
  unsaved.clear()
  hinted = false
  memo.flips = -1
}
