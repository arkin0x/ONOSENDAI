/**
 * relayPlacement.ts - where a speakeasy's relay places you: the last point of
 * your published chain its verifier accepts (cyberspace-relay
 * server/regiongate, strict mode, the mode every speakeasy runs).
 *
 * The relay walks the chain from the newest spawn and stops at the first event
 * it does not accept, or cannot judge, and places you where the event before
 * it left you. A frozen identity stays there until it respawns, so a speakeasy
 * admits you by that point, not by your head (2026-11-12: the owner's chain
 * stops at a version 1 sidestep of 2026-09-04, one cube from midwest), so the
 * speakeasy line asks this module instead of reading the head.
 *
 * The same form rules are ONOSENDAI's own since the owner's ruling of
 * 2026-11-12 ("make our chain checks match the relay's, app-wide"):
 * lib/chainStop.ts runs scanFormStops over your chain, kept as it grows, for
 * the broken-chain chip, its notice, RESPAWN and every move (store whyNoMove).
 *
 * What the relay checks, and what this client checks of it:
 *
 * | Rule | Relay | Here |
 * |---|---|---|
 * | chain structure (links, sectors, brackets, rides, forks) | revision 2026-10-08-residue-openings: 2026-09-28-virtual-brackets plus hop proof version 2 | buildChain and firstBreak, the same rules |
 * | hop with no mn and no mp (version 1) | stands only when on the 5.13 list | the same list (lib/v1HopList) |
 * | hop with only one of mn and mp | invalid | the same |
 * | hop taller than max_hop_verify_height (h_max, 5.9) | left unchecked, and strict mode stops there: default h24 | the same, at RELAY_MAX_HOP_HEIGHT |
 * | sidestep with no mn | stands only when on the 6.16 list; a version 1 sidestep is invalid since 2026-09-07 (spec 6.15) | the same list |
 * | ride with no mn | stands only when on the DECK-0001 5.8 list | the same list |
 * | ride the relay's Bitcoin line has not reached | left unchecked, so strict mode stops there; the line is built again in the background after every relay restart, so for a while after one this is every ride | not seen: a ride is taken as checked |
 * | the work itself: residues, openings, roots, price, entry proof | checked at Level 1 | not checked: too costly to redo for a whole chain in a phone's browser |
 *
 * So the two can differ only where an event has the right form but wrong work
 * (which no honest client signs; ONOSENDAI checks its own moves at Level 1
 * before it sends them), or on a ride the relay's Bitcoin line has not
 * reached: one published moments ago, or any ride while the line is still
 * loading after a relay restart. Pure.
 */

import { findLcaHeight, isGrandfatheredV2Sidestep } from 'cyberspace-core'
import { firstBreak, type ActionEvent } from './events'
import { GRANDFATHERED_V1_HYPERJUMPS } from './hyperspace/grandfathered'

/**
 * The tallest hop the relay verifies: regiongate DefaultMaxHopHeight, and
 * the max_hop_verify_height the speakeasies run with. A taller hop is left
 * unchecked, and in strict mode its mover stands before it. The relay's own
 * config sets it, and its discovery answer does not say it, so this follows
 * the relay by hand: change both together.
 */
export const RELAY_MAX_HOP_HEIGHT = 24

/**
 * The largest terrain K (5.9): a popcount of four 4-bit nibbles. h_max is the
 * largest of the three axis heights and K, so while the ceiling is at least
 * this, K never takes a hop over it, and only the axis heights, which cost no
 * hashing, need measuring.
 */
export const MAX_TERRAIN_K = 16

/** Where the relay stops reading a chain, and why. */
export interface RelayStop {
  /** The index of the first event the relay does not accept. */
  index: number
  action: ActionEvent
  /** The event before it, where the relay places you; null when not even the spawn stands. */
  lastValid: ActionEvent | null
  /**
   * `broken`: the relay rejects the event, for good; only a respawn moves
   * you. `tall`: a hop above RELAY_MAX_HOP_HEIGHT, which the relay does not
   * check, so it stands before it until its ceiling is raised.
   */
  kind: 'broken' | 'tall'
  /** Which rule, for the words the person reads (lib/chainBreak.ts relayStopWords). */
  rule: RelayRule
  /** Why, in words, for the tests and the logs. */
  reason: string
}

/**
 * The rule a stop is for: one of the form rules this module adds, or
 * `chain-rule`, a structural break buildChain found (its `breaks` says which).
 */
export type RelayRule = 'v1-hop' | 'partial-hop' | 'tall-hop' | 'v1-sidestep' | 'v1-ride' | 'chain-rule'

export interface RelayPlacement {
  /** The coordinate the relay places you at. */
  coordHex: string
  /** Where it stopped reading, or null when it accepts the whole chain. */
  stop: RelayStop | null
}

type Chain = ReadonlyArray<Pick<ActionEvent, 'id' | 'coordHex'> & Partial<ActionEvent>>

/** Whether a chain has a version 1 hop before `end`, so the 5.13 list is needed to place it. */
export function needsV1HopList(chain: Chain): boolean {
  return chain.some((a) => a.type === 'hop' && a.mn === undefined && a.mp === undefined)
}

type FormStop = Pick<RelayStop, 'kind' | 'rule' | 'reason'>

/**
 * Why the relay does not accept one action by its proof's form, null when it
 * does, or `unknown` when only the 5.13 list can say and `listedV1Hops` is
 * null (not loaded yet). `from`: where the action starts, the position of the
 * action before it, which buildChain does not keep on the action.
 */
function formStop(a: Chain[number], from: ActionEvent['position'] | undefined, listedV1Hops: ReadonlySet<string> | null): FormStop | null | 'unknown' {
  if (a.type === 'hop') {
    // A listed hop is accepted as audited, whatever it carries (5.13), so
    // a hop missing either tag waits for the list rather than be judged.
    if (listedV1Hops === null && (a.mn === undefined || a.mp === undefined)) return 'unknown'
    if (listedV1Hops?.has(a.id)) return null
    if (a.mn === undefined && a.mp === undefined) return { kind: 'broken', rule: 'v1-hop', reason: 'a version 1 hop not on the 5.13 list' }
    if (a.mn === undefined || a.mp === undefined) return { kind: 'broken', rule: 'partial-hop', reason: 'a hop with only one of mn and mp (5.11)' }
    if (from && a.position) {
      // Above MAX_TERRAIN_K this is h_max itself (MAX_TERRAIN_K says why).
      const h = Math.max(findLcaHeight(from.x, a.position.x), findLcaHeight(from.y, a.position.y), findLcaHeight(from.z, a.position.z))
      if (h > RELAY_MAX_HOP_HEIGHT) return { kind: 'tall', rule: 'tall-hop', reason: `a hop of h${h}, above the h${RELAY_MAX_HOP_HEIGHT} the relay verifies` }
    }
    return null
  }
  if (a.type === 'sidestep' && a.mn === undefined && !isGrandfatheredV2Sidestep(a.id)) {
    return { kind: 'broken', rule: 'v1-sidestep', reason: 'a sidestep with no mn, not on the 6.16 list (a version 1 sidestep is invalid since 2026-09-07, spec 6.15)' }
  }
  if (a.type === 'hyperjump' && a.mn === undefined && !GRANDFATHERED_V1_HYPERJUMPS.has(a.id)) {
    return { kind: 'broken', rule: 'v1-ride', reason: 'a ride with no mn, not on the DECK-0001 5.8 list' }
  }
  return null
}

/** What scanFormStops found. */
export interface FormScan {
  /** The first form stop in the stretch, or null. */
  stop: RelayStop | null
  /** Where the scan ended: at the stop, at the first event only the 5.13 list can judge, or at `end`. */
  scanned: number
  /** True when it ended at an event only the 5.13 list can judge (the list was null). */
  unknown: boolean
}

/**
 * The first form stop among `chain[start]` to `chain[end - 1]` (start at 1:
 * the spawn has no proof). `listedV1Hops` null means the 5.13 list is not
 * loaded: the scan then ends, `unknown`, at the first hop only the list can
 * judge, and says nothing about it or anything after it. Resumable: a later
 * scan from `scanned` over the same chain, or one that extends it, goes on
 * where this one ended. Pure.
 */
export function scanFormStops(chain: Chain, listedV1Hops: ReadonlySet<string> | null, start: number, end: number): FormScan {
  for (let i = Math.max(1, start); i < end; i++) {
    const a = chain[i]
    const before = chain[i - 1]
    const why = formStop(a, before.position, listedV1Hops)
    if (why === 'unknown') return { stop: null, scanned: i, unknown: true }
    if (why) return { stop: { index: i, action: a as ActionEvent, lastValid: before as ActionEvent, ...why }, scanned: i, unknown: false }
  }
  return { stop: null, scanned: Math.max(1, end), unknown: false }
}

/**
 * Where the relay places the published chain `chain` (spawn first, as the
 * store builds it). `listedV1Hops` is the 5.13 list; it may be empty when
 * needsV1HopList says the chain has no version 1 hop. Null for an empty chain.
 */
export function relayPlacement(chain: Chain, listedV1Hops: ReadonlySet<string>): RelayPlacement | null {
  if (chain.length === 0) return null
  const structural = firstBreak(chain as ActionEvent[])
  const end = structural ? structural.index : chain.length
  let stop = scanFormStops(chain, listedV1Hops, 1, end).stop
  if (!stop && structural) {
    stop = { index: structural.index, action: structural.action, lastValid: structural.lastValid, kind: 'broken', rule: 'chain-rule', reason: structural.action.breaks ?? 'it breaks a chain rule' }
  }
  if (!stop) return { coordHex: chain[chain.length - 1].coordHex, stop: null }
  // A broken spawn or a fork: buildChain froze every row at the spawn
  // coordinate, the place the relay leaves you too.
  return { coordHex: stop.lastValid ? stop.lastValid.coordHex : chain[0].coordHex, stop }
}

