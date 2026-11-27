/**
 * prizeGuard.ts - which of your workshop objects may become a blueprint's
 * prize.
 *
 * A prize is sealed into a record that will be public once blueprints go
 * live, so anyone who builds the shape gets the object. The owner's private
 * kits must never become prizes (his standing rule: kits stay local and reach
 * others only as files he hands out). Kits come in through a zip import with
 * PUBLISH off, so:
 *
 * - every object a zip import brings in with PUBLISH off is marked as a kit
 *   piece at import time (markKitPieces), and a kit piece is never a prize,
 *   whatever else is said;
 * - an object you never published under the identity on screen (the publish
 *   ledger, lib/published.ts) is left out by default, which covers kit pieces
 *   imported before the mark existed; you can include one by name
 *   (setIncluded), unless it is a kit piece;
 * - an object that carries pieces inside it (DECK-0003 §1.10 carried
 *   objects) is left out when any piece is a kit piece or was never published
 *   by you, since the pieces travel with the prize;
 * - your published objects are fine.
 *
 * Kept on this device, as the publish ledger is (lib/kvStore.ts).
 */

import type { ShardModel } from 'sno-core/shards'
import { kvGet, kvSet } from '../kvStore'
import type { Ledger } from '../published'

const KIT_KEY = 'onosendai:kit-pieces'
const INCLUDE_KEY = 'onosendai:prize-include'

function readSet(key: string): Set<string> {
  try {
    const raw = JSON.parse(kvGet(key) ?? '[]') as unknown
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [])
  } catch { return new Set() }
}

function writeSet(key: string, s: ReadonlySet<string>): void {
  try { kvSet(key, JSON.stringify([...s])) } catch { /* quota or private mode: the default (left out) still holds */ }
}

/** Mark objects as kit pieces (a zip import with PUBLISH off). Never unmarked. */
export function markKitPieces(ids: readonly string[]): void {
  if (!ids.length) return
  const s = readSet(KIT_KEY)
  for (const id of ids) s.add(id)
  writeSet(KIT_KEY, s)
}

/** The objects marked as kit pieces. */
export function kitPieces(): ReadonlySet<string> {
  return readSet(KIT_KEY)
}

/** Objects you chose to include as prizes though you never published them. */
export function includedPrizes(): ReadonlySet<string> {
  return readSet(INCLUDE_KEY)
}

/** Include an unpublished object as a prize, or leave it out again. A kit piece is never included. */
export function setIncluded(id: string, on: boolean): void {
  const s = readSet(INCLUDE_KEY)
  if (on && !kitPieces().has(id)) s.add(id)
  else s.delete(id)
  writeSet(INCLUDE_KEY, s)
}

/** What the guard reads, so tests can stand in for the device. */
export interface GuardInput {
  me: string
  ledger: Ledger
  kit: ReadonlySet<string>
  included: ReadonlySet<string>
}

/** Why an object can never be a prize ('kit'), why it is left out unless you include it ('unpublished'), or null when it may be one. */
export function prizeBar(shard: Pick<ShardModel, 'id' | 'objects'>, g: GuardInput): 'kit' | 'carries' | 'unpublished' | null {
  if (g.kit.has(shard.id)) return 'kit'
  // Pieces carried inside it travel with the prize: each must be a published object of yours, or someone else's.
  for (const address of Object.keys(shard.objects ?? {})) {
    const m = /^\d+:([0-9a-f]{64}):(.+)$/.exec(address)
    const d = m ? m[2] : address
    if (g.kit.has(d)) return 'carries'
    if (m && m[1] === g.me && g.ledger[d]?.pubkey !== g.me) return 'carries'
  }
  const published = g.ledger[shard.id]?.pubkey === g.me
  if (!published && !g.included.has(shard.id)) return 'unpublished'
  return null
}

/** The words for a left-out object, in the picker. */
export const BAR_WORDS: Record<'kit' | 'carries' | 'unpublished', string> = {
  kit: 'From a kit: never a prize',
  carries: 'Carries kit or unpublished pieces',
  unpublished: 'Not published',
}
