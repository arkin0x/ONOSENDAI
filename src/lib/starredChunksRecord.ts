/**
 * starredChunksRecord.ts: your saved (starred) TERRAIN chunks, the same on
 * every device signed in as you (owner, 2026-11-28: "I just found a chunk that
 * has two glowcore in it ... How can we provide a UI UX to save and star this
 * chunk so that I can find it later").
 *
 * THE EVENT. NIP-78 app data, as the hidden list's and MINING's records are
 * (lib/hidesRecord.ts, lib/miningRecord.ts): kind 30078, addressable, `d` =
 * `onosendai/starred`. One event: a saved chunk is a few hundred bytes before
 * deflating, and MAX_STARRED_CHUNKS of them fit with room to spare. Not a
 * Cyberspace kind, and the spec does not change.
 *
 * THE CONTENT. `1:<wrapped>:<body>`, exactly the hidden list's: `body` is the
 * record's JSON, deflated and base64'd, sealed with NIP-44 v2 under a random
 * 32-byte record key; `wrapped` is that key sealed with NIP-44 from you to you
 * through your signer. Only the `d` tag is public. A chunk's key names where
 * it is (its plane and corner), so it is only ever inside the sealed body:
 * never a tag, never the event's plaintext.
 *
 * WHAT IT HOLDS. For each saved chunk, keyed by its chunk key
 * (lib/terrain/coords.ts chunkKey: plane, then the corner in hex): when it was
 * starred, your note for it, and a snapshot of its survey card (ground type,
 * hardness, every kind with how many are left and how many you mined, the core
 * sample), so the saved card reads anywhere, even far from the chunk.
 *
 * MERGING. Merge, never replace (mergeRecords), as the hidden list does: a
 * chunk taken off your list leaves a tombstone `{ c, t }`, so another device's
 * older copy does not bring it back; the newer of an entry and a tombstone
 * stands, and an entry wins a tie. An entry's time (`t`) is when it was last
 * starred, restored or renamed, never when its card was counted again, so a
 * visit on a device that has not heard of a removal yet never brings the chunk
 * back. Inside an entry each part is its own: the note by when it was written
 * (`nt`), the snapshot by when it was taken (`st`), so a rename on one device
 * and a fresh snapshot on another both survive. Commutative, associative and idempotent. Tombstones are bounded
 * (pruneGone): the newest MAX_TOMBSTONES, none older than TOMBSTONE_MAX_AGE_S.
 */

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import type { EventTemplate, NostrEvent } from './events'
import { fromBase64, newRecordKey, openShard, sealShard, shardContent, toBase64 } from './hidesRecord'
import { parseChunkKey } from './terrain/coords'

export { newRecordKey, openShard as openRecord, sealShard as sealRecord, shardContent as recordContent }

/** NIP-78 application-specific data. */
export const STARRED_KIND = 30078
export const STARRED_D = 'onosendai/starred'
/** The longest the sealed text may be, as one hidden-list shard (hidesRecord MAX_SHARD_CHARS): an event under 56 KB. */
export const MAX_RECORD_CHARS = 40_000
/** The most chunks kept on the list. */
export const MAX_STARRED_CHUNKS = 150
export const MAX_TOMBSTONES = 500
/** Some 400 days, as the hidden list's. */
export const TOMBSTONE_MAX_AGE_S = 400 * 86_400
/** A note is a name for the list, not a diary. */
export const MAX_NOTE = 48
/** The most kinds a snapshot carries: the rarest first, so a card's finds are always kept (a chunk rarely holds more). */
export const MAX_ROWS = 16
const FORMAT = 1

/** One kind on a saved card: [block id, how many are left, how many you mined, how many of those left you could see without digging]. */
export type SnapRow = [number, number, number, number]

/** A survey card as it was last seen: enough to draw the saved card. */
export interface ChunkSnapshot {
  /** The ground's family ("volcanic"), or null when not known. */
  g: string | null
  /** Hardness: terrain K of the costliest cube, and the mean, 0 to 16; null when not known. */
  k: number | null
  m: number | null
  /** Every kind, rarest first, as the card lists them. */
  r: SnapRow[]
  /** The core sample: the kind each layer is mostly made of, bottom to top, as 64 hex characters (32 bytes). */
  d: string
  /** When the chunk was first surveyed, unix seconds, or 0 when not known. */
  v: number
}

/** One saved chunk. Short keys: there may be a couple of hundred. */
export interface StarEntry {
  /** The chunk key: plane, then the corner in hex. The key of the record. */
  c: string
  /** When it was starred, unix seconds. */
  a: number
  /** When it was last starred, restored or renamed, unix seconds (never a fresh snapshot): the newer of an entry and a tombstone stands. */
  t: number
  /** Your note for it, when you wrote one. */
  n?: string
  /** When the note was written (an empty note is a cleared one). */
  nt?: number
  /** Its survey card as last seen. */
  s?: ChunkSnapshot
  /** When the snapshot was taken. */
  st?: number
}

/** The record: entries and tombstones, each by chunk key. */
export interface StarredRecord {
  e: Record<string, StarEntry>
  /** Tombstones: chunk key to when it left the list. */
  x: Record<string, number>
}

export function emptyRecord(): StarredRecord { return { e: {}, x: {} } }

function okTime(t: unknown): t is number { return typeof t === 'number' && Number.isInteger(t) && t >= 0 && t < 1e11 }
function okCount(n: unknown): n is number { return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 }
function okK(n: unknown): n is number { return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 16 }
const HEX64 = /^[0-9a-f]{64}$/
const FAMILY = /^[a-z][a-z0-9_-]{0,23}$/

/** Whether a string is a chunk key this client reads. */
export function isChunkKey(c: unknown): c is string {
  return typeof c === 'string' && c.length <= 80 && parseChunkKey(c) !== null
}

/** A note as typed, made fit to keep: spaces and line breaks made one space, the ends trimmed, cut to MAX_NOTE. */
export function cleanNote(typed: string): string {
  return typed.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE).trim()
}

/** A snapshot as read, or undefined: one malformed row is dropped alone. */
export function validSnapshot(o: unknown): ChunkSnapshot | undefined {
  if (!o || typeof o !== 'object') return undefined
  const v = o as Record<string, unknown>
  const rows: SnapRow[] = []
  for (const r of Array.isArray(v.r) ? v.r : []) {
    if (rows.length >= MAX_ROWS) break
    if (!Array.isArray(r) || r.length < 3) continue
    const [id, left, mined, seen] = r as unknown[]
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > 255 || !okCount(left) || !okCount(mined)) continue
    if (rows.some((x) => x[0] === id)) continue
    // How many show, never more than are left (a 0/1 from before the card counted them reads as none or one).
    rows.push([id, left, mined, okCount(seen) ? Math.min(seen, left) : 0])
  }
  return {
    g: typeof v.g === 'string' && FAMILY.test(v.g) ? v.g : null,
    k: okK(v.k) ? v.k : null,
    m: okK(v.m) ? v.m : null,
    r: rows,
    d: typeof v.d === 'string' && HEX64.test(v.d) ? v.d : '0'.repeat(64),
    v: okTime(v.v) ? v.v : 0,
  }
}

/** An entry as read, or null: one malformed entry is dropped alone. */
export function validEntry(o: unknown): StarEntry | null {
  if (!o || typeof o !== 'object') return null
  const v = o as Record<string, unknown>
  if (!isChunkKey(v.c) || !okTime(v.a) || !okTime(v.t)) return null
  const out: StarEntry = { c: v.c, a: v.a, t: v.t }
  if (typeof v.n === 'string' && okTime(v.nt)) {
    const n = cleanNote(v.n)
    out.nt = v.nt
    if (n) out.n = n
  }
  if (okTime(v.st)) {
    const s = validSnapshot(v.s)
    if (s) { out.s = s; out.st = v.st }
  }
  // An entry is never older than its note. Its snapshot's time stays its own: a card counted again never brings back a
  // chunk another device took off the list (review of the starred-chunks PR).
  out.t = Math.max(out.t, out.nt ?? 0)
  return out
}

/** An entry as text in one fixed order, whatever order its fields were made in: for ties and comparisons. */
function entryText(e: StarEntry): string {
  const s = e.s ? [e.s.g, e.s.k, e.s.m, e.s.r, e.s.d, e.s.v] : null
  return JSON.stringify([e.c, e.a, e.t, e.n ?? null, e.nt ?? null, s, e.st ?? null])
}

/** A stable order for a tie, so a merge is the same whichever side is which. */
function laterBy<T>(a: T, b: T, ta: number, tb: number, text: (v: T) => string = (v) => JSON.stringify(v)): T {
  if (ta !== tb) return ta > tb ? a : b
  return text(a) >= text(b) ? a : b
}

const noteText = (v: { n?: string; nt: number }): string => JSON.stringify([v.n ?? null, v.nt])
const snapText = (v: { s: ChunkSnapshot; st: number }): string => JSON.stringify([v.s.g, v.s.k, v.s.m, v.s.r, v.s.d, v.s.v, v.st])

/** Two entries for one chunk as one: each part the newer, the starred date from the newer entry. */
export function mergeEntry(a: StarEntry, b: StarEntry): StarEntry {
  const base = laterBy(a, b, a.t, b.t, entryText)
  const out: StarEntry = { c: base.c, a: base.a, t: Math.max(a.t, b.t) }
  const na = a.nt !== undefined ? { n: a.n, nt: a.nt } : null
  const nb = b.nt !== undefined ? { n: b.n, nt: b.nt } : null
  const note = na && nb ? laterBy(na, nb, na.nt, nb.nt, noteText) : na ?? nb
  if (note) { out.nt = note.nt; if (note.n) out.n = note.n }
  const sa = a.st !== undefined && a.s ? { s: a.s, st: a.st } : null
  const sb = b.st !== undefined && b.s ? { s: b.s, st: b.st } : null
  const snap = sa && sb ? laterBy(sa, sb, sa.st, sb.st, snapText) : sa ?? sb
  if (snap) { out.s = snap.s; out.st = snap.st }
  return out
}

/** The newest MAX_TOMBSTONES tombstones, none older than TOMBSTONE_MAX_AGE_S before `now` (when given). */
export function pruneGone(x: Record<string, number>, now?: number): Record<string, number> {
  let list = Object.entries(x)
  if (now !== undefined) list = list.filter(([, t]) => t >= now - TOMBSTONE_MAX_AGE_S)
  if (list.length > MAX_TOMBSTONES) list = list.sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1)).slice(0, MAX_TOMBSTONES)
  return Object.fromEntries(list)
}

/**
 * Two records as one (see MERGING above). Nothing either holds is dropped
 * unless the other holds something newer for the same chunk.
 */
export function mergeRecords(a: StarredRecord, b: StarredRecord, now?: number): StarredRecord {
  const out = emptyRecord()
  const keys = new Set([...Object.keys(a.e), ...Object.keys(b.e), ...Object.keys(a.x), ...Object.keys(b.x)])
  for (const c of keys) {
    const ea = a.e[c]
    const eb = b.e[c]
    const entry = ea && eb ? mergeEntry(ea, eb) : ea ?? eb
    const gone = Math.max(a.x[c] ?? -1, b.x[c] ?? -1)
    if (entry && entry.t >= gone) out.e[c] = entry
    else if (gone >= 0) out.x[c] = gone
  }
  out.x = pruneGone(out.x, now)
  return out
}

function canonical(r: StarredRecord): string {
  const e = Object.keys(r.e).sort().map((c) => entryText(r.e[c]))
  const x = Object.keys(r.x).sort().map((c) => [c, r.x[c]])
  return JSON.stringify([e, x])
}

/** Whether two records say the same thing. */
export function sameRecord(a: StarredRecord, b: StarredRecord): boolean {
  return canonical(a) === canonical(b)
}

/** The saved chunks, newest starred first. */
export function entriesOf(r: StarredRecord): StarEntry[] {
  return Object.values(r.e).sort((p, q) => q.a - p.a || (p.c < q.c ? -1 : 1))
}

// -- the event ---------------------------------------------------------------

/** The record's text before sealing: its JSON, deflated, base64. */
export function encodeRecord(r: StarredRecord): string {
  const e = Object.keys(r.e).sort().map((c) => r.e[c])
  const x = Object.keys(r.x).sort().map((c) => [c, r.x[c]])
  return toBase64(deflateSync(strToU8(JSON.stringify({ v: FORMAT, e, x })), { level: 9 }))
}

/** The record's text, read back. Throws when it is not a starred record at all; drops malformed entries one by one. */
export function decodeRecord(text: string): StarredRecord {
  const raw = JSON.parse(strFromU8(inflateSync(fromBase64(text)))) as { v?: unknown; e?: unknown; x?: unknown }
  if (raw.v !== FORMAT) throw new Error('not a starred chunks record this client reads')
  const rec = emptyRecord()
  for (const o of Array.isArray(raw.e) ? raw.e : []) {
    const e = validEntry(o)
    if (e) rec.e[e.c] = rec.e[e.c] ? mergeEntry(rec.e[e.c], e) : e
  }
  for (const o of Array.isArray(raw.x) ? raw.x : []) {
    if (!Array.isArray(o) || !isChunkKey(o[0]) || !okTime(o[1])) continue
    rec.x[o[0]] = Math.max(rec.x[o[0]] ?? 0, o[1])
  }
  // A tombstone newer than its entry, as merging decides.
  return mergeRecords(rec, emptyRecord())
}

export class StarredTooLarge extends Error {
  constructor() { super('Your saved chunks are too many to save to the relay.') }
}

/** The record's text, checked against MAX_RECORD_CHARS. */
export function planRecord(r: StarredRecord): string {
  const text = encodeRecord(r)
  if (text.length > MAX_RECORD_CHARS) throw new StarredTooLarge()
  return text
}

/** The record's event, unsigned. Only the `d`: nothing else about it is public. */
export function recordTemplate(content: string, createdAt: number): EventTemplate {
  return { kind: STARRED_KIND, created_at: createdAt, tags: [['d', STARRED_D]], content }
}

/** The newest record event of this author's (a replaceable event: the newest, ties to the lowest id), or null. */
export function newestRecord(events: readonly NostrEvent[], me: string): NostrEvent | null {
  let out: NostrEvent | null = null
  for (const ev of events) {
    if (ev.pubkey !== me || ev.kind !== STARRED_KIND) continue
    if (ev.tags.find((t) => t[0] === 'd')?.[1] !== STARRED_D) continue
    if (!out || ev.created_at > out.created_at || (ev.created_at === out.created_at && ev.id < out.id)) out = ev
  }
  return out
}
