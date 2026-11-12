/**
 * relayPlacement.ts - where a speakeasy's relay places you: the last point of
 * your published chain its verifier accepts (cyberspace-relay
 * server/regiongate, strict mode, the mode every speakeasy runs).
 *
 * The relay walks the chain from the newest spawn and stops at the first event
 * it does not accept, or cannot judge, and places you where the event before
 * it left you. A frozen identity stays there until it respawns, so a speakeasy
 * admits you by that point, not by your head. ONOSENDAI lets you keep moving
 * on a chain only the relay has stopped (2026-11-12: the owner's chain stops
 * at a version 1 sidestep of 2026-09-04, one cube from midwest), so the
 * speakeasy line asks this module instead of reading the head.
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
 * | ride the relay's Bitcoin line has not reached | left unchecked, so strict mode stops there | not seen: a ride is taken as checked |
 * | the work itself: residues, openings, roots, price, entry proof | checked at Level 1 | not checked: too costly to redo for a whole chain in a phone's browser |
 *
 * So the two can differ only where an event has the right form but wrong work
 * (which no honest client signs; ONOSENDAI checks its own moves at Level 1
 * before it sends them), or on a ride published moments ago. Pure.
 */

import { isGrandfatheredV2Sidestep } from 'cyberspace-core'
import { firstBreak, type ActionEvent } from './events'
import { hopMaxHeight } from './cloudVerify'
import { GRANDFATHERED_V1_HYPERJUMPS } from './hyperspace/grandfathered'

/**
 * The tallest hop the relay verifies: regiongate DefaultMaxHopHeight, and
 * the max_hop_verify_height the speakeasies run with. A taller hop is left
 * unchecked, and in strict mode its mover stands before it.
 */
export const RELAY_MAX_HOP_HEIGHT = 24

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
  /** Why, in words, for the tests and the logs. */
  reason: string
}

export interface RelayPlacement {
  /** The coordinate the relay places you at. */
  coordHex: string
  /** Where it stopped reading, or null when it accepts the whole chain. */
  stop: RelayStop | null
}

/**
 * h_max of the hops already measured, by event id: the id fixes the hop's c,
 * C and previous event, so its height never changes, and a long chain is
 * measured once rather than at every move. Emptied when it grows past
 * HEIGHTS_KEPT.
 */
const heights = new Map<string, number>()
const HEIGHTS_KEPT = 50_000

type Chain = ReadonlyArray<Pick<ActionEvent, 'id' | 'coordHex'> & Partial<ActionEvent>>

/** Whether a chain has a version 1 hop before `end`, so the 5.13 list is needed to place it. */
export function needsV1HopList(chain: Chain, end: number = chain.length): boolean {
  for (let i = 0; i < end; i++) {
    const a = chain[i]
    if (a.type === 'hop' && a.mn === undefined && a.mp === undefined) return true
  }
  return false
}

/**
 * Why the relay does not accept one action by its proof's form, or null when
 * it does. `from`: where the action starts, the position of the action before
 * it, which buildChain does not keep on the action.
 */
function formStop(a: Chain[number], from: ActionEvent['position'] | undefined, listedV1Hops: ReadonlySet<string>): { kind: RelayStop['kind']; reason: string } | null {
  if (a.type === 'hop') {
    // A listed hop is accepted as audited, whatever it carries (5.13).
    if (listedV1Hops.has(a.id)) return null
    if (a.mn === undefined && a.mp === undefined) return { kind: 'broken', reason: 'a version 1 hop not on the 5.13 list' }
    if (a.mn === undefined || a.mp === undefined) return { kind: 'broken', reason: 'a hop with only one of mn and mp (5.11)' }
    if (from && a.position && a.plane !== undefined) {
      let h = heights.get(a.id)
      if (h === undefined) {
        if (heights.size >= HEIGHTS_KEPT) heights.clear()
        h = hopMaxHeight({ from, to: a.position, plane: a.plane })
        heights.set(a.id, h)
      }
      if (h > RELAY_MAX_HOP_HEIGHT) return { kind: 'tall', reason: `a hop of h${h}, above the h${RELAY_MAX_HOP_HEIGHT} the relay verifies` }
    }
    return null
  }
  if (a.type === 'sidestep' && a.mn === undefined && !isGrandfatheredV2Sidestep(a.id)) {
    return { kind: 'broken', reason: 'a sidestep with no mn, not on the 6.16 list (a version 1 sidestep is invalid since 2026-09-07, spec 6.15)' }
  }
  if (a.type === 'hyperjump' && a.mn === undefined && !GRANDFATHERED_V1_HYPERJUMPS.has(a.id)) {
    return { kind: 'broken', reason: 'a ride with no mn, not on the DECK-0001 5.8 list' }
  }
  return null
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
  let stop: RelayStop | null = null
  for (let i = 1; i < end && !stop; i++) {
    const a = chain[i]
    const before = chain[i - 1]
    const why = formStop(a, before.position, listedV1Hops)
    if (why) stop = { index: i, action: a as ActionEvent, lastValid: before as ActionEvent, ...why }
  }
  if (!stop && structural) {
    stop = { index: structural.index, action: structural.action, lastValid: structural.lastValid, kind: 'broken', reason: structural.action.breaks ?? 'it breaks a chain rule' }
  }
  if (!stop) return { coordHex: chain[chain.length - 1].coordHex, stop: null }
  // A broken spawn or a fork: buildChain froze every row at the spawn
  // coordinate, the place the relay leaves you too.
  return { coordHex: stop.lastValid ? stop.lastValid.coordHex : chain[0].coordHex, stop }
}

