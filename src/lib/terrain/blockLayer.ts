/**
 * blockLayer.ts - DECK-0009 §5 to §7 as plain functions: the block layer
 * (kind 33339), its settles, its planes with their per-placement times, the
 * reader's checks of a layer's shape and plaintext, and the Cell Rule.
 *
 * Nothing here talks to a relay, a signer or IndexedDB: the writer
 * (lib/terrain/layerWriter.ts), the reader (lib/terrain/layerReader.ts) and
 * the store (store/terrainShare.ts) do. Everything is checked against the
 * DECK's vectors (lib/__tests__/fixtures/deck0009-layer-vectors.json, from
 * the draft's blocks-vectors.json at cyberspace 1389b22).
 *
 * The rules, in short:
 *
 * - A layer is addressable: one per builder key per chunk, `d` the chunk's
 *   lookup id, `p` the author, one `e` reach tag per plane, one `settle` tag
 *   per settle, the plaintext sealed with the chunk's region key in an
 *   `encrypted` tag, and `version` 1. Nothing else public: no C, no height,
 *   no hint, no sector, no client tag (§5.1).
 * - A settle is `[height, block hash, nonce, claims]`; its id binds the
 *   author, the chunk and the claims (§5.3). Claims are the cells it first
 *   placed in, as two runs arrays of 0 and 1.
 * - A plane is the diff from its base or the whole chunk, whichever is
 *   shorter, with `t0` and `t1` naming, for each placement, the settle that
 *   first placed it and the settle of its latest change (§5.5).
 * - The Cell Rule: the earliest first placement owns a cell; only the owner
 *   and the builders it lists change it, the latest change winning; a home
 *   chunk is its spawner's (§7.3). Order is by the witness's time
 *   T = max(h, W), unwitnessed after witnessed, then work, then pubkeys (§7.2).
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { CELLS } from './coords'

/** The block layer's kind (DECK-0009 §5.1; the owner confirmed 33339 on 2026-11-24). */
export const LAYER_KIND = 33339
/** The `version` tag's value (§5.1). */
export const LAYER_VERSION = '1'
/** The ground revision this client writes and reads (§3.10). */
export const GROUND_REVISION = 2
/** The settle id's domain (§5.3), 27 ASCII bytes. */
export const SETTLE_DOMAIN = new TextEncoder().encode('CYBERSPACE_BLOCKS_SETTLE_V1')
/** The longest serialized layer anyone may sign or read (§5.6): the bag guard. */
export const LAYER_MAX_BYTES = 240_000
export const SETTLES_MAX = 32
export const BUILDERS_MAX = 64
export const PALETTE_MAX = 256
/** How deep a writer commits its block (§5.3), and how deep a reader confirms one (§6.1). */
export const SETTLE_DEPTH = 6
/** The most authors a reader counts in one chunk (§7.1). */
export const AUTHORS_MAX = 64

const HEX64 = /^[0-9a-f]{64}$/
const HEX16 = /^[0-9a-f]{16}$/

/** Two runs arrays of 0 and 1: the cells a settle claims, in plane 0 and plane 1 (§5.3). */
export type Claims = [number[], number[]]
/** `[height, block hash, nonce, claims]` (§5.3). */
export type Settle = [number, string, string, Claims]

/** One plane object of the plaintext (§5.5). */
export interface PlaneObject {
  plane: 0 | 1
  survey: boolean
  ground?: number
  form: 'diff' | 'whole'
  pal: Array<number | null>
  cells: number[]
  t0: number[]
  t1: number[]
}

/** The plaintext (§5.5). */
export interface LayerPlaintext {
  settles: Settle[]
  builders: string[]
  planes: PlaneObject[]
}

/** A plane with nothing claimed: every cell 0 (§5.3). */
export const NO_CLAIMS: number[] = [0, -(CELLS - 1)]

// ---------------------------------------------------------------------------------------------------------------
// Runs (§5.4)

/** Runs of `values`, the shortest form: a value, then -N for N more of it. */
export function encodeRuns(values: ArrayLike<number>): number[] {
  const out: number[] = []
  let i = 0
  while (i < values.length) {
    const v = values[i]
    let j = i + 1
    while (j < values.length && values[j] === v) j++
    out.push(v)
    if (j - i > 1) out.push(-(j - i - 1))
    i = j
  }
  return out
}

/**
 * Expand a runs array to exactly `length` values, each below `limit`, or null
 * when it is malformed (§5.4): a first repeat, a value out of range, an entry
 * that is not an integer from -32768 to 65535, or the wrong length. The
 * length is checked as it expands, so `[0, -1000000000]` costs nothing.
 */
export function expandRuns(runs: unknown, length: number, limit: number): Int32Array | null {
  if (!Array.isArray(runs)) return null
  const out = new Int32Array(length)
  let n = 0
  let last = -1
  for (const e of runs) {
    if (typeof e !== 'number' || !Number.isInteger(e) || Object.is(e, -0) || e < -32768 || e > 65535) return null
    if (e >= 0) {
      if (e >= limit || n >= length) return null
      out[n++] = e
      last = e
    } else {
      if (last < 0 || n - e > length) return null
      out.fill(last, n, n - e)
      n -= e
    }
  }
  return n === length ? out : null
}

/**
 * Whether every number in a JSON text is written as §5.4 requires: an
 * optional `-` and decimal digits, no leading zero, no fraction, no exponent,
 * not `-0`. JSON.parse reads `1.0` as `1`, so the text is checked first.
 */
export function canonicalNumbers(text: string): boolean {
  const bare = text.replace(/"(?:[^"\\]|\\.)*"/g, '""')
  const tokens = bare.match(/-?[0-9][0-9.eE+-]*/g) ?? []
  return tokens.every((t) => /^(0|-?[1-9][0-9]*)$/.test(t))
}

// ---------------------------------------------------------------------------------------------------------------
// Settles (§5.3)

const hexBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** A plane's claims as 4,096 bytes: cell i is bit i mod 8 of byte floor(i / 8); null when malformed. */
export function claimsBitmap(runs: unknown): Uint8Array | null {
  const bits = expandRuns(runs, CELLS, 2)
  if (!bits) return null
  const b = new Uint8Array(CELLS / 8)
  for (let i = 0; i < CELLS; i++) if (bits[i]) b[i >> 3] |= 1 << (i & 7)
  return b
}

/** Claims runs for sets of cells, per plane. */
export function claimsOf(p0: ReadonlySet<number>, p1: ReadonlySet<number>): Claims {
  const one = (s: ReadonlySet<number>): number[] => {
    if (s.size === 0) return NO_CLAIMS.slice()
    const v = new Uint8Array(CELLS)
    for (const c of s) v[c] = 1
    return encodeRuns(v)
  }
  return [one(p0), one(p1)]
}

/** The settle id (§5.3), or null when the settle is malformed. */
export function settleId(author: string, lookupId: string, s: Settle): string | null {
  if (!isSettle(s) || !HEX64.test(author) || !HEX64.test(lookupId)) return null
  const b0 = claimsBitmap(s[3][0])
  const b1 = claimsBitmap(s[3][1])
  if (!b0 || !b1) return null
  const digest = sha256(new Uint8Array([...b0, ...b1]))
  const h = new Uint8Array(4)
  new DataView(h.buffer).setUint32(0, s[0])
  const parts = [SETTLE_DOMAIN, hexBytes(author), hexBytes(lookupId), h, hexBytes(s[1]), hexBytes(s[2]), digest]
  const msg = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { msg.set(p, o); o += p.length }
  return toHex(sha256(msg))
}

/** A settle's work: the leading zero bits of its id (NIP-13's measure). */
export function workOf(id: string): number {
  let n = 0
  for (let i = 0; i < id.length; i++) {
    const v = parseInt(id[i], 16)
    if (v === 0) { n += 4; continue }
    return n + Math.clz32(v) - 28
  }
  return n
}

/** Whether a value has a settle's shape (its claims are checked by settleId). */
export function isSettle(s: unknown): s is Settle {
  if (!Array.isArray(s) || s.length !== 4) return false
  const [h, hash, nonce, claims] = s
  return Number.isInteger(h) && h >= 0 && h < 2 ** 32 && typeof hash === 'string' && HEX64.test(hash)
    && typeof nonce === 'string' && HEX16.test(nonce) && Array.isArray(claims) && claims.length === 2
}

// ---------------------------------------------------------------------------------------------------------------
// Planes (§5.5)

/** A decoded plane: every cell's value, its placements in index order, and their settles. */
export interface DecodedPlane {
  plane: 0 | 1
  survey: boolean
  values: Int32Array
  placements: number[]
  t0: Int32Array
  t1: Int32Array
}

/**
 * Decode a plane against its ground (the revision 2 ground of its chunk in its
 * plane). 'aside' for a plane this reader does not implement (a revision
 * other than 2: §3.10; a whole plane under one is drawn by its author's own
 * client, and takes no part in the Cell Rule here); null when malformed.
 */
export function decodePlane(pl: PlaneObject, ground: Uint8Array, settleCount: number): DecodedPlane | 'aside' | null {
  if (pl.ground !== GROUND_REVISION) return 'aside'
  const pal = pl.pal
  const base = pl.survey ? ground : new Uint8Array(CELLS)
  const idx = expandRuns(pl.cells, CELLS, pal.length)
  if (!idx) return null
  const values = new Int32Array(CELLS)
  const placements: number[] = []
  for (let o = 0; o < CELLS; o++) {
    const g = pal[idx[o]]
    values[o] = g === null ? base[o] : g
    if (values[o] !== base[o]) placements.push(o)
  }
  const t0 = expandRuns(pl.t0, placements.length, settleCount)
  const t1 = expandRuns(pl.t1, placements.length, settleCount)
  if (!t0 || !t1) return null
  return { plane: pl.plane, survey: pl.survey, values, placements, t0, t1 }
}

/**
 * Write a plane in whichever form is shorter as compact JSON (§5.5), with the
 * settle index of each placement's first and latest change. `values` may hold
 * ids above 255 (the extension space); the base is the ground when surveyed.
 */
export function encodePlane(plane: 0 | 1, survey: boolean, values: ArrayLike<number>, ground: Uint8Array, t0: ReadonlyMap<number, number>, t1: ReadonlyMap<number, number>): PlaneObject {
  const base = survey ? ground : new Uint8Array(CELLS)
  const placements: number[] = []
  for (let o = 0; o < CELLS; o++) if (values[o] !== base[o]) placements.push(o)
  const r0 = encodeRuns(placements.map((o) => t0.get(o) ?? 0))
  const r1 = encodeRuns(placements.map((o) => t1.get(o) ?? 0))
  const make = (form: 'diff' | 'whole'): PlaneObject => {
    const pal: Array<number | null> = form === 'diff' ? [null] : []
    const at = new Map<number, number>()
    const idx = new Uint16Array(CELLS)
    for (let o = 0; o < CELLS; o++) {
      if (form === 'diff' && values[o] === base[o]) continue
      const v = values[o]
      let i = at.get(v)
      if (i === undefined) { i = pal.length; at.set(v, i); pal.push(v) }
      idx[o] = i
    }
    return { plane, survey, ground: GROUND_REVISION, form, pal, cells: encodeRuns(idx), t0: r0, t1: r1 }
  }
  const d = make('diff')
  const w = make('whole')
  return JSON.stringify(w).length < JSON.stringify(d).length ? w : d
}

// ---------------------------------------------------------------------------------------------------------------
// The plaintext (§5.5)

function isPlaneObject(p: unknown): p is PlaneObject {
  const o = p as PlaneObject | null
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false
  if ((o.plane !== 0 && o.plane !== 1) || typeof o.survey !== 'boolean' || (o.form !== 'diff' && o.form !== 'whole')) return false
  if (o.ground !== undefined && !Number.isInteger(o.ground)) return false
  if (!Array.isArray(o.pal) || o.pal.length < 1 || o.pal.length > PALETTE_MAX) return false
  for (let i = 0; i < o.pal.length; i++) {
    const g = o.pal[i]
    if (o.form === 'diff' && i === 0) { if (g !== null) return false; continue }
    if (typeof g !== 'number' || !Number.isInteger(g) || g < 0 || g > 65535) return false
  }
  return Array.isArray(o.cells) && Array.isArray(o.t0) && Array.isArray(o.t1)
}

/**
 * The plaintext of a layer, read strictly (§5.5, check 5 of §6.1 short of
 * decoding the planes), or null: numbers as §5.4 writes them, 1 to 32
 * settles, 0 to 64 builders of 64 hex, 1 or 2 planes, at most one per plane.
 * Other fields are ignored, as the DECK says.
 */
export function parsePlaintext(text: string): LayerPlaintext | null {
  if (!canonicalNumbers(text)) return null
  let v: unknown
  try { v = JSON.parse(text) } catch { return null }
  const o = v as LayerPlaintext | null
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  if (!Array.isArray(o.settles) || o.settles.length < 1 || o.settles.length > SETTLES_MAX || !o.settles.every(isSettle)) return null
  if (!Array.isArray(o.builders) || o.builders.length > BUILDERS_MAX || !o.builders.every((b) => typeof b === 'string' && HEX64.test(b))) return null
  if (!Array.isArray(o.planes) || o.planes.length < 1 || o.planes.length > 2 || !o.planes.every(isPlaneObject)) return null
  if (o.planes.length === 2 && o.planes[0].plane === o.planes[1].plane) return null
  return { settles: o.settles, builders: o.builders, planes: o.planes }
}

/** The plaintext as compact JSON, its fields in the DECK's order. */
export function plaintextJson(p: LayerPlaintext): string {
  return JSON.stringify({
    settles: p.settles,
    builders: p.builders,
    planes: p.planes.map((pl) => ({ plane: pl.plane, survey: pl.survey, ground: pl.ground, form: pl.form, pal: pl.pal, cells: pl.cells, t0: pl.t0, t1: pl.t1 })),
  })
}

// ---------------------------------------------------------------------------------------------------------------
// The event (§5.1, §5.6, §6.1 checks 2 and 3)

/** A layer's public tags, as §5.1 orders them. `reach` is one event id per plane, at most two. */
export function layerTags(o: { lookupId: string; author: string; reach: string[]; settleIds: string[]; encrypted: string }): string[][] {
  return [
    ['d', o.lookupId],
    ['p', o.author],
    ...o.reach.slice(0, 2).map((id) => ['e', id, '', 'reach']),
    ...o.settleIds.map((id) => ['settle', id]),
    ['encrypted', 'aes-256-gcm', o.encrypted],
    ['version', LAYER_VERSION],
  ]
}

/** What a layer's tags say, or null when they are not as §5.1 requires (check 2). */
export interface LayerShape {
  lookupId: string
  author: string
  reach: string[]
  settleIds: string[]
  encrypted: string
}

export function layerShape(ev: { kind: number; tags: string[][] }): LayerShape | null {
  if (ev.kind !== LAYER_KIND || !Array.isArray(ev.tags)) return null
  const all = (name: string): string[][] => ev.tags.filter((t) => Array.isArray(t) && t[0] === name)
  const d = all('d'), p = all('p'), enc = all('encrypted'), ver = all('version')
  const reach = ev.tags.filter((t) => Array.isArray(t) && t[0] === 'e' && t[3] === 'reach')
  const settles = all('settle')
  if (d.length !== 1 || p.length !== 1 || enc.length !== 1 || ver.length !== 1) return null
  if (ver[0][1] !== LAYER_VERSION) return null
  if (!HEX64.test(d[0][1] ?? '') || !HEX64.test(p[0][1] ?? '')) return null
  if (enc[0][1] !== 'aes-256-gcm' || typeof enc[0][2] !== 'string') return null
  if (reach.length < 1 || reach.length > 2 || !reach.every((t) => HEX64.test(t[1] ?? ''))) return null
  if (settles.length < 1 || settles.length > SETTLES_MAX || !settles.every((t) => HEX64.test(t[1] ?? ''))) return null
  return { lookupId: d[0][1], author: p[0][1], reach: reach.map((t) => t[1]), settleIds: settles.map((t) => t[1]), encrypted: enc[0][2] }
}

/** The serialized length of an event as §5.6 measures it: compact JSON, the NIP-01 keys in order, UTF-8. */
export function serializedBytes(ev: { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }): number {
  const s = JSON.stringify({ id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig })
  return new TextEncoder().encode(s).length
}

// ---------------------------------------------------------------------------------------------------------------
// The Cell Rule (§7)

/** One settle's place in time, as the order reads it: its committed height, the witness's height or null, its work. */
export interface SettleTime {
  height: number
  witness: number | null
  work: number
}

/** One placement of one cell, from one counted layer. */
export interface Placement {
  author: string
  builder: string
  value: number
  first: SettleTime
  last: SettleTime
}

function orderKey(t: SettleTime): [number, number] {
  const witnessed = t.witness !== null
  return [witnessed ? 0 : 1, witnessed ? Math.max(t.height, t.witness as number) : t.height]
}

function tieBreak(a: SettleTime & { author: string; builder: string }, b: SettleTime & { author: string; builder: string }): number {
  if (a.work !== b.work) return b.work - a.work
  if (a.author !== b.author) return a.author < b.author ? -1 : 1
  if (a.builder !== b.builder) return a.builder < b.builder ? -1 : 1
  return 0
}

type Timed = SettleTime & { author: string; builder: string }

/** Below 0 when `a` is earlier (§7.2): witnessed first, then the smaller T, then work, then pubkeys. */
export function earlier(a: Timed, b: Timed): number {
  const ka = orderKey(a), kb = orderKey(b)
  if (ka[0] !== kb[0]) return ka[0] - kb[0]
  if (ka[1] !== kb[1]) return ka[1] - kb[1]
  return tieBreak(a, b)
}

/** Below 0 when `a` is the later change (§7.2): unwitnessed after witnessed, the greater T, then ties as `earlier`. */
export function later(a: Timed, b: Timed): number {
  const ka = orderKey(a), kb = orderKey(b)
  if (ka[0] !== kb[0]) return kb[0] - ka[0]
  if (ka[1] !== kb[1]) return kb[1] - ka[1]
  return tieBreak(a, b)
}

/**
 * One cell by §7.3: its owner (the home chunk's spawner, else the author of
 * the earliest first placement), and the value of the latest of the
 * placements that count (the owner's and those of the authors it lists), or
 * null when none counts and the cell shows its base.
 */
export function resolveCell(placements: readonly Placement[], builders: ReadonlyMap<string, ReadonlySet<string>>, homeOwner: string | null = null): { value: number; owner: string; from: string } | null {
  if (placements.length === 0) return null
  const firstOf = (p: Placement): Timed => ({ ...p.first, author: p.author, builder: p.builder })
  const lastOf = (p: Placement): Timed => ({ ...p.last, author: p.author, builder: p.builder })
  let owner = homeOwner
  if (owner === null) {
    let best = placements[0]
    for (const p of placements) if (earlier(firstOf(p), firstOf(best)) < 0) best = p
    owner = best.author
  }
  const listed = builders.get(owner)
  let win: Placement | null = null
  for (const p of placements) {
    if (p.author !== owner && !listed?.has(p.author)) continue
    if (!win || later(lastOf(p), lastOf(win)) < 0) win = p
  }
  return win ? { value: win.value, owner, from: win.author } : null
}

/** A layer as the Cell Rule counts it: who wrote it, whom it lists, its settles' times, and its decoded planes. */
export interface CountedLayer {
  author: string
  builder: string
  builders: readonly string[]
  /** Signed by a key its author has retired (either form, any chain): it cannot list builders (§7.3 rule 3). */
  retiredKey: boolean
  times: readonly SettleTime[]
  planes: ReadonlyArray<DecodedPlane>
}

/**
 * Resolve one plane of a chunk by §7.3 and §7.5: per cell the value the Cell
 * Rule gives, or -1 where no placement decides and the cell shows its base;
 * `surveyed` says whether that base is the ground (some counted survey; in a
 * home chunk only the owner's and its builders').
 */
export function resolvePlane(layers: readonly CountedLayer[], plane: 0 | 1, homeOwner: string | null): { values: Int32Array; surveyed: boolean } {
  const builders = new Map<string, Set<string>>()
  for (const l of layers) {
    if (l.retiredKey) continue
    const set = builders.get(l.author) ?? new Set<string>()
    for (const b of l.builders) if (b !== l.author) set.add(b)
    builders.set(l.author, set)
  }
  const planes = layers.map((l) => l.planes.find((p) => p.plane === plane) ?? null)
  const listedByHome = homeOwner ? builders.get(homeOwner) ?? new Set<string>() : null
  const surveyed = layers.some((l, i) => planes[i]?.survey && (!listedByHome || l.author === homeOwner || listedByHome.has(l.author)))
  // Per cell, the placements: built by walking each layer's placements once.
  const byCell = new Map<number, Placement[]>()
  layers.forEach((l, i) => {
    const pl = planes[i]
    if (!pl) return
    pl.placements.forEach((cell, k) => {
      const list = byCell.get(cell) ?? []
      list.push({ author: l.author, builder: l.builder, value: pl.values[cell], first: l.times[pl.t0[k]], last: l.times[pl.t1[k]] })
      byCell.set(cell, list)
    })
  })
  const values = new Int32Array(CELLS).fill(-1)
  for (const [cell, list] of byCell) {
    const r = resolveCell(list, builders, homeOwner)
    if (r) values[cell] = r.value
  }
  return { values, surveyed }
}

/**
 * Which authors a reader counts in a chunk (§7.1): mutes removed first, then
 * at most AUTHORS_MAX, in the order: yourself, whom you follow, the home
 * chunk's owner, then the rest by their earliest settle.
 */
export function countedAuthors(authors: Iterable<string>, o: { me: string | null; follows: ReadonlySet<string>; muted: ReadonlySet<string>; home: string | null; earliest: (author: string) => Timed }): Set<string> {
  const left = [...new Set(authors)].filter((a) => !o.muted.has(a))
  const rank = (a: string): number => (a === o.me ? 0 : o.follows.has(a) ? 1 : a === o.home ? 2 : 3)
  left.sort((a, b) => rank(a) - rank(b) || (rank(a) === 3 ? earlier(o.earliest(a), o.earliest(b)) : 0) || (a < b ? -1 : a > b ? 1 : 0))
  return new Set(left.slice(0, AUTHORS_MAX))
}
