/**
 * smashConfirm.ts - a smash asks first when it would waste recipe materials
 * (owner's lost Glowcore, 2026-11-28): when the hold completes and the smash
 * will NOT compile, but would delete a rare recipe material (the rare band,
 * Glowcore or Cinderrock: nearMiss.ts RARE_MATERIALS) or is one of the
 * game's own recipes built wrong (nearMiss.ts), a confirm comes up instead of
 * the swing: "This won't compile. It breaks 5 blocks, including your
 * Glowcore. Smash anyway?" with SMASH and CANCEL.
 *
 * - CANCEL spends nothing: no block is cleared, nothing swings.
 * - SMASH swings and deletes, as any smash does (a smash always deletes when
 *   confirmed); the blocks are read again at the impact (smashRun.ts strike).
 * - A smash that compiles never asks.
 * - "Don't ask again", OFF by default, is kept per identity (owner,
 *   2026-11-19: "all local data per npub, in IndexedDB"): one record per
 *   pubkey, `onosendai:smash-ask-off:<pubkey>`, through lib/kvStore.ts (the
 *   prefix is in its MOVED_PREFIXES). `1` is off (never ask); anything else,
 *   or no record, asks. Saved only with SMASH, so a CANCEL never turns the
 *   question off. Settings > Interface > Ask before a wasted smash turns it
 *   back on. The same shape as store/airSwitch.ts.
 */

import { create } from 'zustand'
import { kvGet, kvSet } from '../kvStore'
import { useCyberspace } from '../../store/useCyberspace'
import { compiles, smashGroup } from './smash'
import { confirmWords, nearMiss, rareLost, type NearMiss } from './nearMiss'
import type { Cell } from './arrangement'

/** The record's prefix; the pubkey follows. */
export const SMASH_ASK_OFF_PREFIX = 'onosendai:smash-ask-off:'

/** What the confirm asks about one smash. */
export interface SmashAsk {
  /** The question, in full. */
  words: string
  /** How many blocks it would delete. */
  count: number
  /** The rare recipe materials among them, by name. */
  rare: string[]
  /** The game recipe built wrong, if it is one. */
  miss: NearMiss | null
}

/**
 * Whether a smash at `target` should ask first, and what: null when it compiles, has nothing to delete, or would
 * destroy no rare material and is no recipe built wrong.
 */
export function smashAsk(read: (x: number, y: number, z: number) => number, target: Cell, bare: boolean, natural?: (x: number, y: number, z: number) => boolean): SmashAsk | null {
  const g = smashGroup(read, target, bare)
  if (!g.smash.length || compiles(g.arrangement, bare)) return null
  const miss = nearMiss(read, target, bare, natural)
  const rare = rareLost(g.blocks.map((b) => b.id))
  if (!miss && !rare.length) return null
  return { words: confirmWords(g.smash.length, rare, miss), count: g.smash.length, rare, miss }
}

/** The confirm on screen: the question and what SMASH does, or null. */
export const useSmashConfirm = create<{ ask: (SmashAsk & { go: () => void }) | null }>(() => ({ ask: null }))

/** Put the question up; `go` swings and smashes, run only on SMASH. */
export function askBeforeSmash(ask: SmashAsk, go: () => void): void {
  useSmashConfirm.setState({ ask: { ...ask, go } })
}

/** Whether a confirm is up. */
export const smashAsking = (): boolean => useSmashConfirm.getState().ask !== null

/** The answer: SMASH (with "Don't ask again" saved for this identity when ticked) or CANCEL, which spends nothing. */
export function answerSmash(smash: boolean, dontAsk = false): void {
  const ask = useSmashConfirm.getState().ask
  if (!ask) return
  useSmashConfirm.setState({ ask: null })
  if (!smash) return
  if (dontAsk) setSmashAsking(false)
  ask.go()
}

/** Take the question down with nothing done (TERRAIN left, the identity changed). */
export function dropSmashAsk(): void {
  if (useSmashConfirm.getState().ask) useSmashConfirm.setState({ ask: null })
}

/** Choices that did not read back once written (storage refused, or none at all): kept for this page's life. */
const unsaved = new Map<string, boolean>()

/** Ticks when the choice changes, so the Settings row draws again. */
export const useSmashAskTick = create<{ flips: number }>(() => ({ flips: 0 }))

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e: StorageEvent) => { if (e.key?.startsWith(SMASH_ASK_OFF_PREFIX)) useSmashAskTick.setState((s) => ({ flips: s.flips + 1 })) })
}

const identity = (): string => useCyberspace.getState().identity.pubkey

/** Whether `pubkey` is asked before a wasted smash: yes unless it chose "Don't ask again". */
export function smashAskingFor(pubkey: string): boolean {
  const kept = unsaved.get(pubkey)
  if (kept !== undefined) return kept
  return kvGet(SMASH_ASK_OFF_PREFIX + pubkey) !== '1'
}

/** Ask (true) or never ask (false) before a wasted smash, for `pubkey` (the identity on screen), kept in IndexedDB. */
export function setSmashAsking(ask: boolean, pubkey: string = identity()): void {
  const key = SMASH_ASK_OFF_PREFIX + pubkey
  const value = ask ? '0' : '1'
  try { kvSet(key, value) } catch { /* refused: kept below */ }
  if (kvGet(key) === value) unsaved.delete(pubkey)
  else unsaved.set(pubkey, ask)
  useSmashAskTick.setState((s) => ({ flips: s.flips + 1 }))
}

/** The choice for the identity on screen, kept current, for the Settings row. */
export function useSmashAsking(): boolean {
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  useSmashAskTick((s) => s.flips)
  return smashAskingFor(pubkey)
}

/** For tests: forget the refused choices and any question up, as a reload does. */
export function forgetSmashAsk(): void {
  unsaved.clear()
  useSmashConfirm.setState({ ask: null })
}
