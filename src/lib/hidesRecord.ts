/**
 * hidesRecord.ts: the private record of your own hides, so every device signed
 * in as you lists them and can open them (owner ruling, 2026-11-15, option A).
 *
 * Until now the device that hid something held the only list of your bags and
 * the keys that open them; another device found them only by going there or
 * scanning. The record carries, for each bag of yours, what it takes to find
 * and open it from anywhere: its lookup id (its `d`, so with your pubkey its
 * address, which names its newest envelope), the region key (or room key) that
 * opens it, its height, plane and a coordinate inside it, a name and a count
 * for the list, the door it stands behind when it is a room, and a time.
 *
 * THE EVENT. NIP-78 app data: kind 30078, addressable, `d` =
 * `onosendai/hides/<i>`, i from 0 to 15. Not a Cyberspace kind, and the spec
 * does not change. Most players need one; more shards are used only when one
 * would pass MAX_SHARD_CHARS. A bag goes in the shard its lookup id picks
 * (shardOf), so a new hide changes one shard, and a reader reads every shard.
 *
 * THE CONTENT. `1:<wrapped>:<body>`. `body` is the shard's JSON, deflated and
 * base64'd, sealed with NIP-44 v2 under a random 32-byte record key. `wrapped`
 * is that record key, sealed with NIP-44 from you to you, through your signer.
 * So the whole record, however many shards, costs one signer decrypt per load
 * and at most one signer encrypt (only the first time, to wrap a new record
 * key): an extension or a bunker is never asked once per shard. Nothing in the
 * event is readable without your key: not a lookup id, not a count of bags
 * beyond what the shard sizes suggest.
 *
 * MERGING. Merge, never replace (mergeRecords). Entries are keyed by lookup
 * id. A bag taken off your list leaves a tombstone, `{ l, t }`, so another
 * device's older copy does not bring it back; the newer of an entry and a
 * tombstone stands, and an entry wins a tie. Tombstones are bounded (pruneGone):
 * the newest MAX_TOMBSTONES, none older than TOMBSTONE_MAX_AGE_S. A tombstone
 * pruned away can let an old entry come back into the record; it only ever
 * points at a bag, and a bag no longer on the relay opens nothing.
 */

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import { v2 as nip44 } from 'nostr-tools/nip44'
import type { EventTemplate, NostrEvent } from './events'

/** NIP-78 application-specific data. */
export const HIDES_KIND = 30078
export const HIDES_D_PREFIX = 'onosendai/hides/'
/** The most shards a record may use: 16 shards hold thousands of bags. */
export const MAX_SHARDS = 16
export const HIDES_D_TAGS: readonly string[] = Array.from({ length: MAX_SHARDS }, (_, i) => `${HIDES_D_PREFIX}${i}`)
/**
 * The longest a shard's sealed text may be before it is split further, in
 * characters of base64. Older NIP-44 v2 libraries refuse a plaintext over
 * 65,535 bytes (newer ones carry more with the extended length prefix), and
 * strfry's default and many relays cap an event near 64 KB: 40,000 characters
 * pad to 40,960 and seal to some 54,700, so a whole event stays under 56 KB.
 */
export const MAX_SHARD_CHARS = 40_000
export const MAX_TOMBSTONES = 1000
/** Some 400 days. */
export const TOMBSTONE_MAX_AGE_S = 400 * 86_400
/** A name in the list is a label, never the item. */
export const MAX_NAME = 48
const FORMAT = '1'

/** One bag of yours. Short keys: there may be hundreds. */
export interface HideEntry {
  /** Lookup id, the bag's `d`: with your pubkey, its address. The key of the record. */
  l: string
  /** The key that opens it, hex: the region key, or the room key behind a door. */
  k: string
  /** Height of its region (or room). */
  h: number
  /** Plane: 0 dataspace, 1 ideaspace. */
  p: 0 | 1
  /** A coordinate inside it (any item's), decimal strings. */
  x: string
  y: string
  z: string
  /** A name for the list: its newest item's. */
  n: string
  /** How many of your items it held. */
  c: number
  /** When it last changed, unix seconds: the newer of an entry and a tombstone stands. */
  t: number
  /** The door it stands behind, when it is a room bag (DECK-0004 §3.7). */
  r?: string
}

/** The record: entries and tombstones, each by lookup id. */
export interface HidesRecord {
  e: Record<string, HideEntry>
  /** Tombstones: lookup id to when it left the list. */
  x: Record<string, number>
}

/** One shard as read: its place among the shards, and its part of the record. */
export interface HidesShard {
  i: number
  /** How many shards its writer used. */
  k: number
  rec: HidesRecord
}

export function emptyRecord(): HidesRecord { return { e: {}, x: {} } }

const HEX64 = /^[0-9a-f]{64}$/
const DECIMAL = /^-?\d{1,80}$/

function okTime(t: unknown): t is number { return typeof t === 'number' && Number.isInteger(t) && t >= 0 && t < 1e11 }

/** An entry as read, or null: one malformed entry is dropped alone. */
export function validEntry(o: unknown): HideEntry | null {
  if (!o || typeof o !== 'object') return null
  const v = o as Record<string, unknown>
  if (typeof v.l !== 'string' || !HEX64.test(v.l)) return null
  if (typeof v.k !== 'string' || !HEX64.test(v.k)) return null
  if (typeof v.h !== 'number' || !Number.isInteger(v.h) || v.h < 0 || v.h > 96) return null
  if (v.p !== 0 && v.p !== 1) return null
  for (const c of ['x', 'y', 'z'] as const) if (typeof v[c] !== 'string' || !DECIMAL.test(v[c] as string)) return null
  if (!okTime(v.t)) return null
  if (v.r !== undefined && (typeof v.r !== 'string' || !HEX64.test(v.r))) return null
  const n = typeof v.n === 'string' ? v.n.slice(0, MAX_NAME) : ''
  const c = typeof v.c === 'number' && Number.isInteger(v.c) && v.c >= 0 ? v.c : 0
  return { l: v.l, k: v.k, h: v.h, p: v.p, x: v.x as string, y: v.y as string, z: v.z as string, n, c, t: v.t, ...(v.r ? { r: v.r as string } : {}) }
}

/** A stable order for a tie between two entries for one bag, so a merge is the same whichever side is which. */
function laterOf(a: HideEntry, b: HideEntry): HideEntry {
  if (a.t !== b.t) return a.t > b.t ? a : b
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b
}

/**
 * Two records as one. Nothing either holds is dropped unless the other holds
 * something newer for the same bag: the newer entry, or a tombstone newer than
 * the entry (an entry wins a tie). Commutative, associative and idempotent, so
 * the order devices read and write in never matters.
 */
export function mergeRecords(a: HidesRecord, b: HidesRecord, now?: number): HidesRecord {
  const out = emptyRecord()
  const keys = new Set([...Object.keys(a.e), ...Object.keys(b.e), ...Object.keys(a.x), ...Object.keys(b.x)])
  for (const l of keys) {
    const ea = a.e[l]
    const eb = b.e[l]
    const entry = ea && eb ? laterOf(ea, eb) : ea ?? eb
    const gone = Math.max(a.x[l] ?? -1, b.x[l] ?? -1)
    if (entry && entry.t >= gone) out.e[l] = entry
    else if (gone >= 0) out.x[l] = gone
  }
  out.x = pruneGone(out.x, now)
  return out
}

/** The newest MAX_TOMBSTONES tombstones, none older than TOMBSTONE_MAX_AGE_S before `now` (when given). */
export function pruneGone(x: Record<string, number>, now?: number): Record<string, number> {
  let list = Object.entries(x)
  if (now !== undefined) list = list.filter(([, t]) => t >= now - TOMBSTONE_MAX_AGE_S)
  if (list.length > MAX_TOMBSTONES) list = list.sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)).slice(0, MAX_TOMBSTONES)
  return Object.fromEntries(list)
}

/** Whether two records say the same thing. */
export function sameRecord(a: HidesRecord, b: HidesRecord): boolean {
  return canonical(a) === canonical(b)
}

function canonical(r: HidesRecord): string {
  const e = Object.keys(r.e).sort().map((l) => r.e[l])
  const x = Object.keys(r.x).sort().map((l) => [l, r.x[l]])
  return JSON.stringify([e, x])
}

/** The shard a bag goes in when the record uses `k` shards. */
export function shardOf(lookupId: string, k: number): number {
  return parseInt(lookupId.slice(0, 6), 16) % k
}

/** The part of a record one shard of `k` carries. */
export function shardPart(r: HidesRecord, i: number, k: number): HidesRecord {
  const out = emptyRecord()
  for (const [l, e] of Object.entries(r.e)) if (shardOf(l, k) === i) out.e[l] = e
  for (const [l, t] of Object.entries(r.x)) if (shardOf(l, k) === i) out.x[l] = t
  return out
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** One shard's text before sealing: its JSON, deflated, base64. */
export function encodeShard(rec: HidesRecord, i: number, k: number): string {
  const e = Object.keys(rec.e).sort().map((l) => rec.e[l])
  const x = Object.keys(rec.x).sort().map((l) => [l, rec.x[l]])
  return toBase64(deflateSync(strToU8(JSON.stringify({ v: 1, i, k, e, x })), { level: 9 }))
}

/** A shard's text, read back. Throws when it is not a shard at all; drops malformed entries one by one. */
export function decodeShard(text: string): HidesShard {
  const raw = JSON.parse(strFromU8(inflateSync(fromBase64(text)))) as { v?: unknown; i?: unknown; k?: unknown; e?: unknown; x?: unknown }
  if (raw.v !== 1) throw new Error('not a hides shard this client reads')
  const k = typeof raw.k === 'number' && Number.isInteger(raw.k) && raw.k >= 1 && raw.k <= MAX_SHARDS ? raw.k : 1
  const i = typeof raw.i === 'number' && Number.isInteger(raw.i) && raw.i >= 0 && raw.i < MAX_SHARDS ? raw.i : 0
  const rec = emptyRecord()
  for (const o of Array.isArray(raw.e) ? raw.e : []) {
    const e = validEntry(o)
    if (e) rec.e[e.l] = rec.e[e.l] ? laterOf(rec.e[e.l], e) : e
  }
  for (const o of Array.isArray(raw.x) ? raw.x : []) {
    if (!Array.isArray(o) || typeof o[0] !== 'string' || !HEX64.test(o[0]) || !okTime(o[1])) continue
    rec.x[o[0]] = Math.max(rec.x[o[0]] ?? 0, o[1])
  }
  return { i, k, rec }
}

export class HidesTooLarge extends Error {
  constructor() { super(`Your list of hidden things is too large to save to the relay in ${MAX_SHARDS} parts.`) }
}

/**
 * The shards a record is written as: the fewest (at least `minK`, a power of
 * two) for which every shard's text fits MAX_SHARD_CHARS. `minK` is the most
 * the relay's copy used, so a record never shrinks into fewer shards while an
 * older shard past them still stands (it would still be read, but never
 * rewritten).
 */
export function planShards(r: HidesRecord, minK = 1): { k: number; texts: string[] } {
  let k = 1
  while (k < minK) k *= 2
  for (; k <= MAX_SHARDS; k *= 2) {
    const texts = Array.from({ length: k }, (_, i) => encodeShard(shardPart(r, i, k), i, k))
    if (texts.every((t) => t.length <= MAX_SHARD_CHARS)) return { k, texts }
  }
  throw new HidesTooLarge()
}

/** A fresh record key. */
export function newRecordKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

/** A shard's content: the wrapped record key and the shard sealed under it. */
export function sealShard(text: string, recordKey: Uint8Array, wrapped: string): string {
  return `${FORMAT}:${wrapped}:${nip44.encrypt(text, recordKey)}`
}

/** A shard's content, taken apart; null when it is not one this client reads. */
export function shardContent(content: string): { wrapped: string; body: string } | null {
  const parts = content.split(':')
  if (parts.length !== 3 || parts[0] !== FORMAT || !parts[1] || !parts[2]) return null
  return { wrapped: parts[1], body: parts[2] }
}

/** A shard's sealed text, opened with the record key. Throws when it does not open. */
export function openShard(body: string, recordKey: Uint8Array): string {
  return nip44.decrypt(body, recordKey)
}

/** Shard `i`'s event, unsigned. Only the `d`: nothing else about the record is public. */
export function shardTemplate(i: number, content: string, createdAt: number): EventTemplate {
  return { kind: HIDES_KIND, created_at: createdAt, tags: [['d', `${HIDES_D_PREFIX}${i}`]], content }
}

/** Which shard an event is, or -1. */
export function shardIndexOf(ev: Pick<NostrEvent, 'kind' | 'tags'>): number {
  if (ev.kind !== HIDES_KIND) return -1
  const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  const i = HIDES_D_TAGS.indexOf(d)
  return i
}

/** The newest event for each shard, of this author's only (a replaceable event: the newest, ties to the lowest id). */
export function newestShards(events: readonly NostrEvent[], me: string): Map<number, NostrEvent> {
  const out = new Map<number, NostrEvent>()
  for (const ev of events) {
    if (ev.pubkey !== me) continue
    const i = shardIndexOf(ev)
    if (i < 0) continue
    const was = out.get(i)
    if (!was || ev.created_at > was.created_at || (ev.created_at === was.created_at && ev.id < was.id)) out.set(i, ev)
  }
  return out
}
