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
 *   piece at import time (markKitPieces), by its id and by its model's
 *   fingerprint (its geometry and colours, whatever it is called or keyed:
 *   kitPrint), and a kit piece is never a prize, whatever else is said. The
 *   fingerprint follows the piece wherever it goes: a workshop DUPLICATE (a
 *   new id; the id mark is carried too, so an edited copy stays barred), or
 *   a piece hidden in a chest and taken back into ITEMS (keyed by the bag
 *   item's event id), both checked when picking and again at SEAL (review of
 *   #943, 2026-11-27);
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
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { kvGet, kvSet } from '../kvStore'
import { ticksOf, toPayload } from 'sno-core/shards'
import { turnDirection, turnShard, type Turns } from '../turn'
import { CONSTRAIN_FIELD } from '../walkConstrain'
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

const prints = new WeakMap<ShardModel, string | null>()

/**
 * A model's kit fingerprint: its shape alone, whatever it is called, keyed,
 * sized or turned (review of #943: a kit piece AIMed into a chest goes out
 * resized and turned, and came back into ITEMS unrecognised). Name, id, size
 * (unit), Earth up, spin and the WALK setting are set aside; of the 24
 * quarter-turns (lib/turn.ts, as the deploy bar turns a copy) the one whose
 * payload sorts first stands for all of them; SHA-256 of that. Null for
 * something that cannot be read as a model.
 */
export function kitPrint(shard: ShardModel): string | null {
  const known = prints.get(shard)
  if (known !== undefined) return known
  let out: string | null = null
  try {
    // The WALK setting lives in `extra` (lib/walkConstrain.ts CONSTRAIN_FIELD): set aside with the rest of the pose.
    const extra = shard.extra ? Object.fromEntries(Object.entries(shard.extra).filter(([k]) => k !== CONSTRAIN_FIELD)) : undefined
    const bare = { ...shard, id: '', name: '', unit: 0, up: false, spin: 0, extra: extra && Object.keys(extra).length ? extra : undefined } as ShardModel
    // The turn: the one whose turned points sort first (cheap: points only); the points fix the rest of the payload.
    const ticks = shard.vertices.map((v) => ticksOf(v))
    let best: string | null = null
    let turns: Turns = [0, 0, 0]
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
      const t: Turns = [a, b, c]
      const text = ticks.map((p) => turnDirection(p, t).join(',')).join(';')
      if (best === null || text < best) { best = text; turns = t }
    }
    out = `shape:${bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(toPayload(turnShard(bare, turns))))))}`
  } catch { out = null }
  prints.set(shard, out)
  return out
}

/**
 * Mark objects as kit pieces (a zip import with PUBLISH off): by id at once, and by shape fingerprint when the model
 * is given. Never unmarked. `later` (the import) leaves the fingerprints to a quiet moment just after, in small
 * batches, so a big import never waits on them; the id mark bars the piece meanwhile.
 */
export function markKitPieces(pieces: ReadonlyArray<string | ShardModel>, { later = false }: { later?: boolean } = {}): void {
  if (!pieces.length) return
  const s = readSet(KIT_KEY)
  const models: ShardModel[] = []
  for (const p of pieces) {
    if (typeof p === 'string') { s.add(p); continue }
    s.add(p.id)
    models.push(p)
  }
  if (!later) for (const m of models) { const print = kitPrint(m); if (print) s.add(print) }
  writeSet(KIT_KEY, s)
  if (later) { pending.push(...models); schedulePrints() }
}

/** Kit pieces whose fingerprints are still to be kept (markKitPieces `later`). */
const pending: ShardModel[] = []
let printing: ReturnType<typeof setTimeout> | null = null

function schedulePrints(): void {
  if (printing !== null) return
  printing = setTimeout(() => {
    printing = null
    const batch = pending.splice(0, 8)
    const add = batch.map((m) => kitPrint(m)).filter((p): p is string => !!p)
    if (add.length) { const s = readSet(KIT_KEY); for (const p of add) s.add(p); writeSet(KIT_KEY, s) }
    if (pending.length) schedulePrints()
  }, 0)
}

/** Keep every fingerprint still waiting now (before a guard reads the marks, and in tests). */
export function flushKitPrints(): void {
  if (printing !== null) { clearTimeout(printing); printing = null }
  const all = pending.splice(0)
  const add = all.map((m) => kitPrint(m)).filter((p): p is string => !!p)
  if (add.length) { const s = readSet(KIT_KEY); for (const p of add) s.add(p); writeSet(KIT_KEY, s) }
}

/**
 * Kit pieces marked by id before fingerprints were kept: add their
 * fingerprints from the workshop's models, so a copy of one is barred too.
 * Cheap when there is nothing to add.
 */
export function backfillKitPrints(shards: readonly ShardModel[]): void {
  const s = readSet(KIT_KEY)
  const add = shards.filter((m) => s.has(m.id)).map((m) => kitPrint(m)).filter((p): p is string => !!p && !s.has(p))
  if (!add.length) return
  for (const p of add) s.add(p)
  writeSet(KIT_KEY, s)
}

/** A workshop DUPLICATE of a kit piece is a kit piece too, by id as well as by model (so editing the copy keeps it barred). */
export function carryKitMark(fromId: string, toId: string): void {
  const s = readSet(KIT_KEY)
  if (!s.has(fromId) || s.has(toId)) return
  s.add(toId)
  writeSet(KIT_KEY, s)
}

/** The objects marked as kit pieces. */
export function kitPieces(): ReadonlySet<string> {
  if (pending.length) flushKitPrints()
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
export function prizeBar(shard: Pick<ShardModel, 'id' | 'objects'> & Partial<ShardModel>, g: GuardInput): 'kit' | 'carries' | 'unpublished' | null {
  if (g.kit.has(shard.id)) return 'kit'
  // The same model under another id: a duplicate, or a kit piece hidden and taken back into ITEMS.
  if (shard.vertices) { const print = kitPrint(shard as ShardModel); if (print && g.kit.has(print)) return 'kit' }
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
