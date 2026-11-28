/**
 * blockLayer.ts - DECK-0009's block layer (kind 33339) as plain functions:
 * its plaintext (one plane object per plane, the cells as palette runs, and
 * the author's co-builders), the event's tags and limits, builder key
 * validity, the home, and the Stack with co-builders, the rule every reader
 * uses to say which layer a cell shows. Written to the DECK at cyberspace
 * c4930ff, and to revision 3 and the base revision at f4d553f (#128), and
 * checked against its vectors.
 *
 * Nothing here talks to a relay, a signer or IndexedDB: the reader
 * (lib/terrain/layerReader.ts) and the store (store/terrainShare.ts) do.
 *
 * In short:
 *
 * - A layer is addressable: one per builder key per chunk, `d` the chunk's
 *   lookup id, `p` the author, the plaintext sealed with the chunk's region
 *   key in an `encrypted` tag, `version` 1, empty content (§5.1).
 * - A plane's base is the generated ground when it surveys, open space when
 *   not. In a `diff` every non-null cell is changed, even at the base value
 *   (how a layer removes a block another placed, or refills a hole another
 *   mined); in a `whole` a cell is changed when it differs from the base. A
 *   layer speaks only for the cells it changed (§5.4).
 * - A surveyed plane names its ground revision (`ground`, 2 or 3) and its
 *   first survey's date (`surveyed`); its cells are read against that
 *   revision's ground. The base a reader shows is the ground at the base
 *   revision (§7.5): the first counted survey by own rank, then the
 *   earliest `surveyed` (baseRevision), so a chunk keeps the revision it
 *   was first surveyed at (lib/terrain/groundRevision.ts).
 * - The Stack (§7): per cell, the first candidate in Stack order. Ranks: 1
 *   the home owner inside their home (the 3 by 3 by 3 chunks round the chunk
 *   of their spawn coordinate, in its plane, wrapping at the axis ends), 2
 *   the reader, 3 whom the reader follows, 4 everyone else; within a rank the
 *   newest first, then the lower author, builder key and event id.
 * - Co-builders (§8): a layer's author lists them; in a cell the author
 *   changed, the layers of the people on the author's newest list count at
 *   the author's own rank when that is better, never through a second hop.
 */

import { CELLS, type ChunkBase } from './coords'
import { coordToXyz } from 'cyberspace-core'
import { isGroundRevision, readSurveyed, type GroundRevision } from './groundRevision'

/** The block layer's kind (DECK-0009 §5.1; the owner confirmed 33339 on 2026-11-25). */
export const LAYER_KIND = 33339
/** The `version` tag's value (§5.1). */
export const LAYER_VERSION = '1'
/** The longest serialized layer anyone may sign or read (§5.5): the bag guard. */
export const LAYER_MAX_BYTES = 240_000
export const PALETTE_MAX = 256
/** The most bytes of UTF-8 in `content` and in the `alt` value (§5.5). */
export const FREE_TEXT_MAX = 280
/** The most co-builders a layer lists (§5.5). */
export const COBUILDERS_MAX = 64
/** A layer dated more than this many seconds past the reader's clock is not counted yet (§7.1). */
export const FUTURE_SLACK_SECONDS = 600
/** The most authors a reader counts in one chunk (§7.1). */
export const AUTHORS_MAX = 64

const HEX64 = /^[0-9a-f]{64}$/
const AXIS_MASK = (1n << 85n) - 1n

/** One plane object of the plaintext (§5.4). */
export interface PlaneObject {
  plane: 0 | 1
  survey: boolean
  /** With `survey` true: the created_at of the first version in which the plane was surveyed, carried forward (§5.4). Read with readSurveyed. */
  surveyed?: number
  ground?: number
  form: 'diff' | 'whole'
  pal: Array<number | null>
  cells: number[]
}

/** The plaintext (§5.4). */
export interface LayerPlaintext {
  planes: PlaneObject[]
  /** The author's co-builders (the Crew, §8). */
  cobuilders: string[]
}

// ---------------------------------------------------------------------------------------------------------------
// Runs (§5.3)

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
 * when it is malformed (§5.3): a first repeat, a value out of range, an entry
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
 * Whether every number in a JSON text is written as §5.3 requires: an
 * optional `-` and decimal digits, no leading zero, no fraction, no exponent,
 * not `-0`. JSON.parse reads `1.0` as `1`, so the text is checked first.
 */
export function canonicalNumbers(text: string): boolean {
  const bare = text.replace(/"(?:[^"\\]|\\.)*"/g, '""')
  const tokens = bare.match(/-?[0-9][0-9.eE+-]*/g) ?? []
  return tokens.every((t) => /^(0|-?[1-9][0-9]*)$/.test(t))
}

const CANONICAL = /^(0|-?[1-9][0-9]*)$/

/**
 * Whether every number in each plane's `cells` and `pal`, and its `plane` and
 * `ground`, is written as §5.3 requires (canonicalNumbers' rule), the other
 * numbers of the plaintext left to their own readers: a `surveyed` that is
 * not an integer reads as the layer's created_at, and never drops the layer
 * (§5.4). JSON.parse reads `1.0` as `1`, so the text is walked: a number is
 * checked when it sits in an array under `cells` or `pal`, or right under
 * `plane` or `ground`, of an object in the top-level `planes`. Each key is
 * decoded as JSON.parse decodes it, so an escaped duplicate (`"cell\u0073"`,
 * which JSON.parse reads as `cells` and lets win) is checked too.
 */
export function canonicalCells(text: string): boolean {
  // Each open container: what it is, and the key (or '#' for an array element) it sits under.
  const stack: Array<{ arr: boolean; under: string; key: string | null }> = []
  let i = 0
  let pendingKey: string | null = null
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      const raw = text.slice(i, j + 1)
      i = j + 1
      const top = stack[stack.length - 1]
      // A string in an object that a colon follows is a key: read as JSON.parse reads it.
      let k = i
      while (k < n && /\s/.test(text[k])) k++
      if (top && !top.arr && text[k] === ':') {
        let key: unknown
        try { key = JSON.parse(raw) } catch { return false }
        pendingKey = typeof key === 'string' ? key : null
      }
      continue
    }
    if (ch === '{' || ch === '[') {
      const top = stack[stack.length - 1]
      stack.push({ arr: ch === '[', under: top?.arr ? '#' : pendingKey ?? '', key: null })
      pendingKey = null
      i++
      continue
    }
    if (ch === '}' || ch === ']') { stack.pop(); pendingKey = null; i++; continue }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1
      while (j < n && /[0-9.eE+-]/.test(text[j])) j++
      const tok = text.slice(i, j)
      i = j
      const top = stack[stack.length - 1]
      const inPlane = stack.length >= 3 && stack[1].arr && stack[1].under === 'planes' && !stack[2].arr && stack[2].under === '#'
      const strict = inPlane && (
        (stack.length === 4 && top.arr && (top.under === 'cells' || top.under === 'pal'))
        || (stack.length === 3 && (pendingKey === 'plane' || pendingKey === 'ground'))
      )
      if (strict && !CANONICAL.test(tok)) return false
      pendingKey = null
      continue
    }
    i++
  }
  return true
}

// ---------------------------------------------------------------------------------------------------------------
// Planes (§5.4)

/** A decoded plane: every cell's value, and the cells it changed, in index order. */
export interface DecodedPlane {
  plane: 0 | 1
  survey: boolean
  /** The ground revision its cells were read against (surveyed planes; a plane that does not survey reads over open space). */
  ground: GroundRevision
  /** Its first survey's date as read (§5.4: readSurveyed); the layer's created_at for a plane that does not survey. */
  surveyed: number
  values: Int32Array
  changed: number[]
}

/** The revision whose ground a plane is read against: its own `ground` when it surveys and names one this client makes, else null (no ground needed, or set aside). */
export function planeGroundRevision(pl: Pick<PlaneObject, 'survey' | 'ground'>): GroundRevision | null {
  return pl.survey && isGroundRevision(pl.ground) ? pl.ground : null
}

/**
 * Decode a plane against its own revision's ground (`ground`: the chunk's
 * ground in its plane at planeGroundRevision(pl); unused when it does not
 * survey), `createdAt` the layer's, for `surveyed`. 'aside' for a surveyed
 * plane under a revision this reader does not implement (§3.10: a diff set
 * aside; a whole read for its values only, which takes no part in the
 * Stack); null when malformed.
 */
export function decodePlane(pl: PlaneObject, ground: Uint8Array | null, createdAt = 0): DecodedPlane | 'aside' | null {
  const idx = expandRuns(pl.cells, CELLS, pl.pal.length)
  if (!idx) return null
  const revision = planeGroundRevision(pl)
  if (pl.survey && revision === null) return 'aside'
  if (pl.survey && !ground) throw new Error('decodePlane: a surveyed plane needs its own revision\'s ground')
  const base = pl.survey ? ground! : new Uint8Array(CELLS)
  const values = new Int32Array(CELLS)
  const changed: number[] = []
  for (let o = 0; o < CELLS; o++) {
    const g = pl.pal[idx[o]]
    values[o] = g === null ? base[o] : g
    // A non-null cell of a diff is a change even at the base value; in a whole only a different value is.
    if (pl.form === 'diff' ? g !== null : values[o] !== base[o]) changed.push(o)
  }
  const ground2: GroundRevision = revision ?? (isGroundRevision(pl.ground) ? pl.ground : 2)
  return { plane: pl.plane, survey: pl.survey, ground: ground2, surveyed: pl.survey ? readSurveyed(pl, createdAt) : createdAt, values, changed }
}

/** What a writer names on a plane (§5.4, §3.10): the ground revision it is written against, and its first survey's date. */
export interface PlaneAt {
  revision: GroundRevision
  surveyed: number
}

/**
 * Write a plane (§5.4): the cells that differ from the base (`ground`, the
 * chunk's ground at `named.revision`, when it surveys), and `explicit` cells
 * written as changed at their base value (which only a diff can say), in the
 * shorter of the forms that can express them. A surveyed plane always names
 * `surveyed`.
 */
export function encodePlane(plane: 0 | 1, survey: boolean, values: ArrayLike<number>, ground: Uint8Array, named: PlaneAt, explicit: ReadonlySet<number> = new Set()): PlaneObject {
  const base = survey ? ground : new Uint8Array(CELLS)
  const make = (form: 'diff' | 'whole'): PlaneObject => {
    const pal: Array<number | null> = form === 'diff' ? [null] : []
    const at = new Map<number, number>()
    const idx = new Uint16Array(CELLS)
    for (let o = 0; o < CELLS; o++) {
      if (form === 'diff' && values[o] === base[o] && !explicit.has(o)) continue
      const v = values[o]
      let i = at.get(v)
      if (i === undefined) { i = pal.length; at.set(v, i); pal.push(v) }
      idx[o] = i
    }
    return { plane, survey, ...(survey ? { surveyed: named.surveyed } : {}), ground: named.revision, form, pal, cells: encodeRuns(idx) }
  }
  const d = make('diff')
  if (explicit.size > 0) return d
  const w = make('whole')
  return JSON.stringify(d).length <= JSON.stringify(w).length ? d : w
}

// ---------------------------------------------------------------------------------------------------------------
// The plaintext (§5.4)

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
  return Array.isArray(o.cells)
}

/**
 * The plaintext of a layer, read strictly (§5.4), or null: the cells and the
 * palettes' numbers as §5.3 writes them (canonicalCells), 1 or 2 plane
 * objects, at most one per plane, and an optional `cobuilders` of 0 to 64
 * pubkeys. Other fields are ignored, and a `surveyed` that is not an integer
 * never drops the layer (it reads as created_at: readSurveyed).
 */
export function parsePlaintext(text: string): LayerPlaintext | null {
  if (!canonicalCells(text)) return null
  let v: unknown
  try { v = JSON.parse(text) } catch { return null }
  const o = v as { planes?: unknown; cobuilders?: unknown } | null
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const planes = o.planes
  if (!Array.isArray(planes) || planes.length < 1 || planes.length > 2 || !planes.every(isPlaneObject)) return null
  if (planes.length === 2 && planes[0].plane === planes[1].plane) return null
  const cob = o.cobuilders === undefined ? [] : o.cobuilders
  if (!Array.isArray(cob) || cob.length > COBUILDERS_MAX || !cob.every((b) => typeof b === 'string' && HEX64.test(b))) return null
  return { planes: planes as PlaneObject[], cobuilders: cob as string[] }
}

/** The plaintext as compact JSON. */
export function plaintextJson(p: LayerPlaintext): string {
  return JSON.stringify({
    planes: [...p.planes].sort((a, b) => a.plane - b.plane).map((pl) => ({
      plane: pl.plane, survey: pl.survey, ...(pl.survey && pl.surveyed !== undefined ? { surveyed: pl.surveyed } : {}),
      ground: pl.ground ?? 2, form: pl.form, pal: pl.pal, cells: pl.cells,
    })),
    cobuilders: p.cobuilders,
  })
}

/**
 * A plane carried forward as it is (§5.6), but a surveyed plane always names
 * `surveyed` (§5.4): one written before the field existed names what a
 * reader already reads for it, its layer's `createdAt`.
 */
export function carriedPlane(pl: PlaneObject, createdAt: number): PlaneObject {
  if (!pl.survey) return pl
  const surveyed = readSurveyed(pl, createdAt)
  return pl.surveyed === surveyed ? pl : { ...pl, surveyed }
}

/**
 * The surveyed date a writer names on its plane (§5.4): the one `prev` (a
 * layer of `prevCreatedAt`) already names for it, carried forward, or, on
 * the plane's first survey, `createdAt`, the new version's own.
 */
export function surveyedToWrite(prev: LayerPlaintext | null, plane: 0 | 1, prevCreatedAt: number, createdAt: number): number {
  const was = prev?.planes.find((p) => p.plane === plane)
  return was?.survey ? readSurveyed(was, prevCreatedAt) : createdAt
}

/**
 * The next plaintext: this plane as `values` hold it now over `ground` (the
 * chunk's ground at `at.revision`), named as `at` says, its `explicit` cells
 * changed at their base value, the other plane carried as `prev` (a layer of
 * `prevCreatedAt`) holds it, unchanged (§5.6), and the Crew. Null when that
 * is what `prev` already says.
 */
export function nextPlaintext(prev: LayerPlaintext | null, plane: 0 | 1, values: ArrayLike<number>, ground: Uint8Array, at: PlaneAt, cobuilders: readonly string[] = [], explicit: ReadonlySet<number> = new Set(), prevCreatedAt = at.surveyed): LayerPlaintext | null {
  const mine = encodePlane(plane, true, values, ground, at, explicit)
  const was = prev?.planes.find((p) => p.plane === plane)
  const crew = [...cobuilders]
  if (prev && was && JSON.stringify(was) === JSON.stringify(mine) && JSON.stringify(prev.cobuilders) === JSON.stringify(crew)) return null
  const other = prev?.planes.find((p) => p.plane !== plane)
  return { planes: other ? [mine, carriedPlane(other, prevCreatedAt)].sort((a, b) => a.plane - b.plane) : [mine], cobuilders: crew }
}

// ---------------------------------------------------------------------------------------------------------------
// The event (§5.1, §5.5, §6 checks 2 and 3)

/** A layer's public tags, as §5.1 orders them. */
export function layerTags(o: { lookupId: string; author: string; encrypted: string }): string[][] {
  return [['d', o.lookupId], ['p', o.author], ['encrypted', 'aes-256-gcm', o.encrypted], ['version', LAYER_VERSION]]
}

/** What a layer's tags say, or null when they are not as §5.1 requires (check 2). */
export interface LayerShape {
  lookupId: string
  author: string
  encrypted: string
}

export function layerShape(ev: { kind: number; tags: string[][] }): LayerShape | null {
  if (ev.kind !== LAYER_KIND || !Array.isArray(ev.tags)) return null
  const all = (name: string): string[][] => ev.tags.filter((t) => Array.isArray(t) && t[0] === name)
  const d = all('d'), p = all('p'), enc = all('encrypted'), ver = all('version')
  if (d.length !== 1 || p.length !== 1 || enc.length !== 1 || ver.length !== 1 || all('alt').length > 1) return null
  if (ver[0][1] !== LAYER_VERSION) return null
  if (!HEX64.test(d[0][1] ?? '') || !HEX64.test(p[0][1] ?? '')) return null
  if (enc[0][1] !== 'aes-256-gcm' || typeof enc[0][2] !== 'string') return null
  return { lookupId: d[0][1], author: p[0][1], encrypted: enc[0][2] }
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length

/**
 * The free text within its limits (§5.5, §6 check 3): `content` and the
 * `alt` value at most 280 bytes of UTF-8 each, at most one `alt`. Relays that
 * escape characters count free text up to six times over; these bounds keep
 * any layer within 240,000 bytes inside the canonical relay's 262,144-byte
 * cap however it counts.
 */
export function freeTextWithinBounds(ev: { content: string; tags: string[][] }): boolean {
  if (typeof ev.content !== 'string' || utf8Bytes(ev.content) > FREE_TEXT_MAX) return false
  const alts = ev.tags.filter((t) => Array.isArray(t) && t[0] === 'alt')
  return alts.length <= 1 && alts.every((t) => typeof t[1] === 'string' && utf8Bytes(t[1]) <= FREE_TEXT_MAX)
}

/** The serialized length of an event as §5.5 measures it: compact JSON, the NIP-01 keys in order, UTF-8. */
export function serializedBytes(ev: { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }): number {
  const s = JSON.stringify({ id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig })
  return new TextEncoder().encode(s).length
}

// ---------------------------------------------------------------------------------------------------------------
// Builder keys (§4.4)

/**
 * Whether builder key `k` is valid for an author, from the author's own
 * authentic movement events (any chain): named by some `builder` tag, never
 * retired by `builder-retire` `k`, and named last after every
 * `builder-retire` `all` (by created_at; a naming in the same second as an
 * `all` is retired by it).
 */
export function builderKeyValid(k: string, events: ReadonlyArray<{ created_at: number; tags: string[][] }>): boolean {
  let named: number | null = null
  let retired = false
  let lastAll: number | null = null
  for (const e of events) for (const t of e.tags) {
    if (t[0] === 'builder' && t[1] === k) named = named === null ? e.created_at : Math.max(named, e.created_at)
    if (t[0] === 'builder-retire' && t[1] === k) retired = true
    if (t[0] === 'builder-retire' && t[1] === 'all') lastAll = lastAll === null ? e.created_at : Math.max(lastAll, e.created_at)
  }
  if (named === null || retired) return false
  return lastAll === null || named > lastAll
}

// ---------------------------------------------------------------------------------------------------------------
// The home (§7.2)

/**
 * Whether `chunk` is in the home of `pubkey`: the 27 chunks of a 3 by 3 by 3
 * cube centred on the chunk holding its spawn coordinate (the pubkey read as
 * a coordinate), in the plane its lowest bit names; on each axis the chunk's
 * base minus the spawn chunk's, modulo 2^85, is 0, 32 or 2^85 - 32.
 */
export function inHome(pubkey: string, chunk: ChunkBase): boolean {
  if (!HEX64.test(pubkey)) return false
  const c = coordToXyz(BigInt(`0x${pubkey}`))
  if (chunk.plane !== c.plane) return false
  const near = (a: bigint, s: bigint): boolean => {
    const d = (a - ((s >> 5n) << 5n)) & AXIS_MASK
    return d === 0n || d === 32n || d === AXIS_MASK + 1n - 32n
  }
  return near(chunk.x, c.x) && near(chunk.y, c.y) && near(chunk.z, c.z)
}

// ---------------------------------------------------------------------------------------------------------------
// The Stack (§7) and co-builders (§8)

/** A layer as the Stack counts it: who wrote it, with which key, its event id, when, whom it lists, and its decoded planes. */
export interface StackLayer {
  id: string
  author: string
  builder: string
  createdAt: number
  cobuilders: readonly string[]
  planes: ReadonlyArray<DecodedPlane>
}

/** Who ranks where for a reader in a chunk. */
export interface StackView {
  /** The reader, or null. */
  me: string | null
  /** Whom the reader follows (kind 3). */
  follows: ReadonlySet<string>
  /** Whether the chunk is in an author's home (inHome). */
  home: (author: string) => boolean
}

/** An author's own rank in a chunk (§7.3): 1 a home owner, 2 the reader, 3 whom the reader follows, 4 everyone else. */
export function ownRank(author: string, v: StackView): number {
  if (v.home(author)) return 1
  if (author === v.me) return 2
  if (v.follows.has(author)) return 3
  return 4
}

const lowerFirst = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Order within a rank (§7.3): the newer first, then the lower author, builder key and event id. */
export function withinRank(a: Pick<StackLayer, 'createdAt' | 'author' | 'builder' | 'id'>, b: Pick<StackLayer, 'createdAt' | 'author' | 'builder' | 'id'>): number {
  return b.createdAt - a.createdAt || lowerFirst(a.author, b.author) || lowerFirst(a.builder, b.builder) || lowerFirst(a.id, b.id)
}

/**
 * The counted layers (§7.1): mutes removed, then layers dated more than 600
 * seconds past `now` (Unix seconds), then at most AUTHORS_MAX authors, by own
 * rank, the newest layer of each, the lower pubkey.
 */
export function countedLayers<T extends Pick<StackLayer, 'author' | 'createdAt'>>(layers: readonly T[], v: StackView, mutes: ReadonlySet<string>, now: number, cap = AUTHORS_MAX): T[] {
  const kept = layers.filter((l) => !mutes.has(l.author) && l.createdAt <= now + FUTURE_SLACK_SECONDS)
  const newest = new Map<string, number>()
  for (const l of kept) newest.set(l.author, Math.max(newest.get(l.author) ?? -Infinity, l.createdAt))
  const authors = [...newest.keys()].sort((a, b) => ownRank(a, v) - ownRank(b, v) || newest.get(b)! - newest.get(a)! || lowerFirst(a, b))
  const allowed = new Set(authors.slice(0, cap))
  return kept.filter((l) => allowed.has(l.author))
}

/** One counted survey of a plane, as §7.5 orders them. */
export interface SurveyEntry {
  revision: GroundRevision
  /** The author's own rank (§7.3), never a co-builder's lift. */
  rank: number
  surveyed: number
  author: string
  builder: string
  id: string
}

/**
 * The base revision (§7.5): the revision of the first counted survey by own
 * rank, then the smaller `surveyed`, then the lower author, builder key and
 * event id; null when nothing surveys the plane. Rank comes first, so a
 * stranger who dates a survey early cannot force a revision past the people
 * a reader ranks above them; the earliest survey decides among equals, so a
 * chunk keeps the revision it was first surveyed at.
 */
export function baseRevision(surveys: readonly SurveyEntry[]): GroundRevision | null {
  const first = (a: SurveyEntry, b: SurveyEntry): number =>
    a.rank - b.rank || a.surveyed - b.surveyed || lowerFirst(a.author, b.author) || lowerFirst(a.builder, b.builder) || lowerFirst(a.id, b.id)
  let best: SurveyEntry | null = null
  for (const e of surveys) if (!best || first(e, best) < 0) best = e
  return best ? best.revision : null
}

/** The counted surveys of one plane over these layers (§7.5): inside a home, only a home owner's count. */
export function surveysOf(layers: readonly StackLayer[], plane: 0 | 1, v: StackView): SurveyEntry[] {
  const own = layers.map((l) => ownRank(l.author, v))
  const anyHome = own.some((r) => r === 1)
  const out: SurveyEntry[] = []
  layers.forEach((l, i) => {
    const pl = l.planes.find((p) => p.plane === plane)
    if (!pl?.survey || (anyHome && own[i] !== 1)) return
    out.push({ revision: pl.ground, rank: own[i], surveyed: pl.surveyed, author: l.author, builder: l.builder, id: l.id })
  })
  return out
}

/**
 * One plane of a chunk by the Stack (§7.4, §8), over counted layers. Per
 * cell: the candidates are the layers that changed it; a candidate whose
 * author is on the newest list of another placer in that cell takes the
 * better of its own rank and that placer's own rank; the first in Stack
 * order wins. `values` is -1 where no layer changed the cell (it shows the
 * base); `from` is the index in `layers` of the winner, or -1; `surveyed`
 * says whether the plane is surveyed (inside a home only a home owner's
 * surveys count, §7.5).
 */
export function resolveStack(layers: readonly StackLayer[], plane: 0 | 1, v: StackView): { values: Int32Array; from: Int32Array; rank: Int8Array; surveyed: boolean; baseRevision: GroundRevision | null } {
  const values = new Int32Array(CELLS).fill(-1)
  const from = new Int32Array(CELLS).fill(-1)
  const rank = new Int8Array(CELLS)
  const planes = layers.map((l) => l.planes.find((p) => p.plane === plane) ?? null)
  const own = layers.map((l) => ownRank(l.author, v))
  // Each author's list: the cobuilders of their newest counted layer here (§8).
  const lists = new Map<string, Set<string>>()
  const newestOf = new Map<string, StackLayer>()
  for (const l of layers) { const n = newestOf.get(l.author); if (!n || withinRank(l, n) < 0) newestOf.set(l.author, l) }
  for (const [a, l] of newestOf) lists.set(a, new Set(l.cobuilders.filter((c) => c !== a)))
  // Surveyed, and at which revision the base is (§7.5).
  const base = baseRevision(surveysOf(layers, plane, v))
  const surveyed = base !== null
  // Per cell, the layers that changed it.
  const touching = new Map<number, number[]>()
  planes.forEach((pl, i) => { if (pl) for (const c of pl.changed) { const t = touching.get(c); if (t) t.push(i); else touching.set(c, [i]) } })
  for (const [c, list] of touching) {
    let best = -1
    let bestRank = 9
    for (const i of list) {
      let r = own[i]
      for (const j of list) {
        const a = layers[j].author
        if (a !== layers[i].author && own[j] < r && lists.get(a)?.has(layers[i].author)) r = own[j]
      }
      if (best < 0 || r < bestRank || (r === bestRank && withinRank(layers[i], layers[best]) < 0)) { best = i; bestRank = r }
    }
    values[c] = planes[best]!.values[c]
    from[c] = best
    rank[c] = bestRank
  }
  return { values, from, rank, surveyed, baseRevision: base }
}

// ---------------------------------------------------------------------------------------------------------------
// A new builder key at a chunk (§5.6)

/** One plane's changed cells and their values, whether it surveys, and (when it does) its revision and first survey's date. */
export interface PlaneChanges {
  survey: boolean
  cells: Map<number, number>
  revision: GroundRevision
  surveyed: number
}

/** A chunk's ground in a plane at a revision, or null when not at hand. */
export type GroundAt = (plane: 0 | 1, revision: GroundRevision) => Uint8Array | null

/** The (plane, revision) grounds a plaintext's planes are read against. */
export function groundsNeeded(p: LayerPlaintext): Array<[0 | 1, GroundRevision]> {
  const out: Array<[0 | 1, GroundRevision]> = []
  for (const pl of p.planes) { const r = planeGroundRevision(pl); if (r !== null) out.push([pl.plane, r]) }
  return out
}

/**
 * A plaintext's changed cells, per plane, each read against its own
 * revision's ground; `createdAt` is the layer's (for `surveyed`). Planes this
 * reader sets aside, or whose ground is not given, are left out.
 */
export function changesOf(p: LayerPlaintext, groundOf: GroundAt, createdAt = 0): Map<0 | 1, PlaneChanges> {
  const out = new Map<0 | 1, PlaneChanges>()
  for (const pl of p.planes) {
    const r = planeGroundRevision(pl)
    if (pl.survey && r === null) continue
    const g = r === null ? null : groundOf(pl.plane, r)
    if (pl.survey && !g) continue
    const d = decodePlane(pl, g, createdAt)
    if (!d || d === 'aside') continue
    out.set(pl.plane, { survey: d.survey, cells: new Map(d.changed.map((c) => [c, d.values[c]])), revision: d.ground, surveyed: d.surveyed })
  }
  return out
}

/**
 * What a new key's layer names on each surveyed plane (§5.6): the base
 * revision of the plane in the writer's view among the author's layers there
 * (all of one rank, so the earliest `surveyed`, then the lower builder key
 * and event id), and that earliest `surveyed`. Null when no part surveys.
 */
export function startAt(parts: ReadonlyArray<{ changes: PlaneChanges; builder: string; id: string }>, view: WriterView | null = null): PlaneAt | null {
  const surveys = parts.filter((p) => p.changes.survey)
  if (surveys.length === 0) return null
  const rank = view?.rank ?? 0
  const own: SurveyEntry[] = surveys.map((p) => ({ revision: p.changes.revision, rank, surveyed: p.changes.surveyed, author: view?.author ?? '', builder: p.builder, id: p.id }))
  // Everyone else's counted surveys in the writer's view (§7.5): inside a home only a home owner's count, so the author's own count only when the author is one.
  const others = view?.others ?? []
  const homeOnly = others.some((e) => e.rank === 1) && rank !== 1
  const revision = baseRevision(homeOnly ? others : [...own, ...others])
  if (revision === null) return null
  return { revision, surveyed: Math.min(...surveys.map((p) => p.changes.surveyed)) }
}

/**
 * The rest of a writer's view of a plane, for a layer started from the
 * author's other keys (§5.6): the author's own rank there, and everyone
 * else's counted surveys (surveysOf over their counted layers).
 */
export interface WriterView {
  author: string
  rank: number
  others: readonly SurveyEntry[]
}

/**
 * Where a new key's layer at a chunk starts (§5.6): every plane of the
 * author's other keys' layers there, the twin included, with every changed
 * cell's value, the newer layer winning where two change one cell; then
 * this writer's own changes over them (`mine`, signed by `mineKey`). Each
 * surveyed plane names the base revision in the writer's view (`viewOf`:
 * inside a home, the home owner's) and the earliest of the author's
 * `surveyed` (startAt), and is written against that revision's ground; a
 * cell changed at its base value is written explicitly, so it stays a
 * change whichever revision the new layer names.
 */
export function startFrom(others: ReadonlyArray<{ changes: Map<0 | 1, PlaneChanges>; createdAt: number; builder: string; id: string }>, mine: Map<0 | 1, PlaneChanges>, groundOf: GroundAt, cobuilders: readonly string[], mineKey: { builder: string; id: string } = { builder: '', id: '' }, viewOf: (plane: 0 | 1) => WriterView | null = () => null): LayerPlaintext {
  // Oldest first, so the newer layer's value is the one left standing.
  const order = [...others].sort((a, b) => -withinRank({ ...a, author: '' }, { ...b, author: '' }))
  const planes: PlaneObject[] = []
  for (const plane of [0, 1] as const) {
    const sources = [...order.map((o) => ({ changes: o.changes.get(plane), builder: o.builder, id: o.id })), { changes: mine.get(plane), ...mineKey }]
      .filter((c): c is { changes: PlaneChanges; builder: string; id: string } => !!c.changes)
    if (sources.length === 0) continue
    const at = startAt(sources, viewOf(plane))
    const g = at ? groundOf(plane, at.revision) : null
    if (at && !g) continue
    const base = g ?? new Uint8Array(CELLS)
    const values = Int32Array.from(base)
    const touched = new Set<number>()
    for (const { changes } of sources) for (const [c, v] of changes.cells) { values[c] = v; touched.add(c) }
    const explicit = new Set([...touched].filter((c) => values[c] === base[c]))
    planes.push(encodePlane(plane, at !== null, values, base, at ?? { revision: 2, surveyed: 0 }, explicit))
  }
  return { planes, cobuilders: [...cobuilders] }
}

/**
 * A version of a layer (one of `createdAt`) that changes no cell (§5.6): each
 * plane keeps its `survey`, `ground` and `surveyed`; the Crew is the
 * writer's current one.
 */
export function emptiedPlaintext(p: LayerPlaintext, cobuilders: readonly string[] = [], createdAt = 0): LayerPlaintext {
  return {
    planes: p.planes.map((pl) => ({
      plane: pl.plane, survey: pl.survey, ...(pl.survey ? { surveyed: readSurveyed(pl, createdAt) } : {}),
      ground: pl.ground ?? 2, form: 'diff' as const, pal: [null], cells: [0, -(CELLS - 1)],
    })),
    cobuilders: [...cobuilders],
  }
}
