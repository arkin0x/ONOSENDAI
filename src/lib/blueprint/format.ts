/**
 * format.ts - every blueprint format in one place, as DECK-0010 (Blueprints,
 * draft) §3 to §7 says, so a revision of the spec changes only this file:
 * the encoding of an arrangement, the key and the lookup, the record (kind
 * 33343) and its sheet, the sealed prize, and the card (kind 3343).
 *
 * The encoding (§3.3): the 23 ASCII bytes of CYBERSPACE_BLUEPRINT_V1, the
 * box's size along X, Z and Y (one byte each), then every cell's block id in
 * scan order (Y outermost, then Z, then X fastest) as an unsigned 16-bit
 * big-endian integer, 0 for empty. A location lock appends the 32-byte region
 * key of the region of the record's height that holds the whole box (§3.5).
 *
 * The key (§3.4): PBKDF2-HMAC-SHA256 over the encoding, salted with the
 * domain label, 500,000 rounds, 32 bytes. The lookup: SHA-256 of the key, as
 * hex. The prize (§5.5) is AES-256-GCM under the key, nonce || ciphertext ||
 * tag in base64, carried in the record's `encrypted` tag.
 *
 * Publishing: the relay does not accept kind 33343 yet (the whitelist needs
 * the owner's go), so BLUEPRINT_RELAY_READY is false and records stay on this
 * device (store/useBlueprints.ts). Cards travel inside bags and chests, which
 * the relay already takes, sealed; until the go they are placed LOCAL only.
 */

import { bytesToHex } from '../events'

/** The domain label and version (§3.3): also the PBKDF2 salt. */
export const DOMAIN = 'CYBERSPACE_BLUEPRINT_V1'
/** PBKDF2 rounds (owner, 2026-11-26), fixed by the version. */
export const PBKDF2_ROUNDS = 500_000
/** The most cells a box has on one axis (owner, 2026-11-26). */
export const MAX_SIDE = 16
/** The smash window: the hit's minus 8 to plus 7 on each axis (§4.1). */
export const WINDOW_BELOW = 8
export const WINDOW_ABOVE = 7
/** The record, addressable, `d` = lookup (§5). */
export const BLUEPRINT_RECORD_KIND = 33343
/** The card: an item in a bag, room bag or chest, never published alone (§7). */
export const BLUEPRINT_CARD_KIND = 3343
/** A record longer than this, serialized, is refused by writers and dropped by readers (§5.2). */
export const RECORD_MAX_BYTES = 98_304
export const TITLE_MAX = 64
export const TEXT_MAX = 280
export const VIEW_MAX_CHARS = 16_384
/** The `encrypted` tag's mark: the key is made by building, never fetched (§5.1). */
export const PRIZE_MARK = 'cyberspace:blueprint'
/** The relay whitelist needs the owner's go: until then records stay on this device and cards are placed LOCAL only. */
export const BLUEPRINT_RELAY_READY = false

/** An arrangement in its box: its size and every cell's block id in scan order (cellIndex); 0 is empty. */
export interface Arrangement {
  /** Size along X, Y and Z, each 1 to MAX_SIDE. */
  size: readonly [number, number, number]
  cells: Uint16Array
}

/** A cell's place in scan order (§3.2). */
export function cellIndex(size: readonly [number, number, number], x: number, y: number, z: number): number {
  return x + size[0] * (z + size[2] * y)
}

/** A scan-order index back to (x, y, z) in the box. */
export function cellAt(size: readonly [number, number, number], i: number): [number, number, number] {
  const x = i % size[0]
  const rest = Math.floor(i / size[0])
  return [x, Math.floor(rest / size[2]), rest % size[2]]
}

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s)

/** The encoding (§3.3), with the region key's 32 bytes at the end for a location lock. */
export function encodeArrangement(a: Arrangement, regionKey?: Uint8Array | null): Uint8Array {
  const [sx, sy, sz] = a.size
  if (![sx, sy, sz].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE)) throw new Error('blueprint box out of range')
  if (a.cells.length !== sx * sy * sz) throw new Error('blueprint cells do not fill the box')
  if (regionKey && regionKey.length !== 32) throw new Error('region key must be 32 bytes')
  const label = ascii(DOMAIN)
  const out = new Uint8Array(label.length + 3 + 2 * a.cells.length + (regionKey ? 32 : 0))
  out.set(label, 0)
  let o = label.length
  out[o++] = sx; out[o++] = sz; out[o++] = sy
  for (let i = 0; i < a.cells.length; i++) { out[o++] = a.cells[i] >> 8; out[o++] = a.cells[i] & 0xff }
  if (regionKey) out.set(regionKey, o)
  return out
}

/** A copy backed by its own ArrayBuffer, as WebCrypto wants. */
function plain(b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(b.length))
  out.set(b)
  return out
}

/** The key (§3.4): PBKDF2-HMAC-SHA256 of the encoding, salted with the domain label. WebCrypto; lib/blueprint/keyClient.ts runs it in a worker. */
export async function deriveKey(encoding: Uint8Array, rounds: number = PBKDF2_ROUNDS): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle
  const base = await subtle.importKey('raw', plain(encoding), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: plain(ascii(DOMAIN)), iterations: rounds }, base, 256)
  return new Uint8Array(bits)
}

/** The lookup: SHA-256 of the key, 64 lowercase hex. */
export async function lookupOf(key: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', plain(key))))
}

// ---------- the prize (§5.5) ----------

/** A prize as sealed: a SNO object payload, or a tool (only the Compiler in this revision). */
export type Prize = { type: 'sno'; payload: Record<string, unknown> } | { type: 'tool'; tool: 'compiler' }

/** Whether an opened prize is one this client can show. A reader still keeps one it cannot (§5.5). */
export function isPrize(v: unknown): v is Prize {
  const p = v as Prize | null
  if (!p || typeof p !== 'object') return false
  if (p.type === 'tool') return p.tool === 'compiler'
  return p.type === 'sno' && !!p.payload && typeof p.payload === 'object' && !Array.isArray(p.payload)
}

export function toBase64(b: Uint8Array): string {
  let s = ''
  for (const c of b) s += String.fromCharCode(c)
  return btoa(s)
}

export function fromBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch { return null }
}

async function aesKey(key: Uint8Array, use: KeyUsage): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey('raw', plain(key), 'AES-GCM', false, [use])
}

/** Seal a prize with the key: AES-256-GCM, a fresh 12-byte nonce, nonce || ciphertext || tag in base64. */
export async function sealPrize(key: Uint8Array, prize: unknown, nonce: Uint8Array = globalThis.crypto.getRandomValues(new Uint8Array(12))): Promise<string> {
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: plain(nonce) }, await aesKey(key, 'encrypt'), plain(ascii(JSON.stringify(prize)))))
  const out = new Uint8Array(12 + ct.length)
  out.set(nonce, 0)
  out.set(ct, 12)
  return toBase64(out)
}

/** Open a sealed prize with the key; null when the key is not its key or it does not parse. */
export async function openPrize(key: Uint8Array, payload: string): Promise<unknown> {
  const b = fromBase64(payload)
  if (!b || b.length < 28) return null
  try {
    const pt = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: plain(b.subarray(0, 12)) }, await aesKey(key, 'decrypt'), plain(b.subarray(12)))
    return JSON.parse(new TextDecoder().decode(pt))
  } catch { return null }
}

// ---------- the sheet (§5.3) ----------

/** How much of the prize a finder sees (owner, 2026-11-27). */
export type PrizeReveal = 'hidden' | 'description' | 'silhouette' | 'render'
/** A 2D prize reveal's views: from +X, from above (+Y), from the sun (+Z), isometric. */
export type PrizeView = 'x' | 'y' | 'z' | 'iso'
export const PRIZE_VIEWS: readonly PrizeView[] = ['x', 'y', 'z', 'iso']
/** The order pictures are shown in, as the EXAMINE sheet's views: isometric, facing the sun, from above, from +X. */
export const PRIZE_VIEWS_SHOWN: readonly PrizeView[] = ['iso', 'z', 'y', 'x']
export const PRIZE_REVEALS: readonly PrizeReveal[] = ['hidden', 'description', 'silhouette', 'render']
/** What locks it: the blocks alone, or the blocks built inside a region of the record's height. */
export type LockKind = 'standard' | 'location'

export interface SheetPrize {
  reveal: PrizeReveal
  text?: string
  views?: Partial<Record<PrizeView, string>>
  /**
   * The prize's own name, present only when its maker chose to show it (not in DECK-0010 yet: a reader ignores a
   * field it does not know, §5.3, so this is safe to write and is proposed to the spec as prize.name).
   */
  name?: string
}

/** A record's content (§5.3). */
export interface Sheet {
  size: { x: number; y: number; z: number }
  /** 0 empty, null hidden (smoke), else a revealed block id. */
  pal: Array<number | null>
  /** Palette indices in scan order, as a runs array. */
  cells: number[]
  lock: LockKind
  height?: number
  prize: SheetPrize
}

/** A runs array (DECK-0003 §1.4a): a value, then -N for N more copies of it. */
export function toRuns(values: readonly number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < values.length;) {
    let j = i + 1
    while (j < values.length && values[j] === values[i]) j++
    out.push(values[i])
    if (j - i > 1) out.push(-(j - i - 1))
    i = j
  }
  return out
}

/** A runs array expanded to exactly `length` values below `palLength`, or null when it breaks the rules. */
export function expandRuns(runs: unknown, length: number, palLength: number): number[] | null {
  if (!Array.isArray(runs) || runs.length === 0) return null
  const out: number[] = []
  for (const e of runs) {
    if (!Number.isInteger(e) || Object.is(e, -0)) return null
    if (e >= 0) {
      if (e >= palLength || out.length + 1 > length) return null
      out.push(e)
    } else {
      if (!out.length || out.length - e > length) return null
      const v = out[out.length - 1]
      for (let i = 0; i < -e; i++) out.push(v)
    }
  }
  return out.length === length ? out : null
}

/** The sheet's shape for an arrangement: `shown` says which occupied cells are revealed (scan index). Palette: 0, null, then revealed ids ascending. */
export function sheetShape(a: Arrangement, shown: (index: number) => boolean): Pick<Sheet, 'size' | 'pal' | 'cells'> {
  const vals: Array<number | null> = Array.from(a.cells, (id, i) => (id === 0 ? 0 : shown(i) ? id : null))
  const ids = [...new Set(vals.filter((v): v is number => v !== null && v !== 0))].sort((x, y) => x - y)
  const pal: Array<number | null> = [...(vals.includes(0) ? [0] : []), ...(vals.includes(null) ? [null] : []), ...ids]
  const at = new Map(pal.map((v, i) => [v, i]))
  return { size: { x: a.size[0], y: a.size[1], z: a.size[2] }, pal, cells: toRuns(vals.map((v) => at.get(v)!)) }
}

/** Every cell of a sheet's box: 0 empty, null hidden, or the revealed id; null when the shape is malformed (§5.4 checks 5 to 8). */
export function readSheetShape(sheet: Partial<Sheet>): Array<number | null> | null {
  const size = sheet.size
  if (!size || ![size.x, size.y, size.z].every((n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE)) return null
  const pal = sheet.pal
  if (!Array.isArray(pal) || pal.length < 1 || pal.length > 256) return null
  for (const v of pal) if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 65535)) return null
  if (new Set(pal.map(String)).size !== pal.length) return null
  const n = size.x * size.y * size.z
  const idx = expandRuns(sheet.cells, n, pal.length)
  if (!idx) return null
  const vals = idx.map((i) => pal[i])
  const used = new Set(vals.map(String))
  if (pal.some((v) => !used.has(String(v)))) return null
  const s: [number, number, number] = [size.x, size.y, size.z]
  const occ: Array<[number, number, number]> = []
  vals.forEach((v, i) => { if (v !== 0) occ.push(cellAt(s, i)) })
  if (!occ.length) return null
  // The box is the smallest: every face holds an occupied cell.
  for (let a = 0; a < 3; a++) if (!occ.some((c) => c[a] === 0) || !occ.some((c) => c[a] === s[a] - 1)) return null
  // Connected through faces, edges and corners.
  const k = (c: readonly number[]): string => c.join(',')
  const set = new Set(occ.map(k))
  const seen = new Set([k(occ[0])])
  const q = [occ[0]]
  for (let i = 0; i < q.length; i++) {
    const [x, y, z] = q[i]
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c: [number, number, number] = [x + dx, y + dy, z + dz]
      if (set.has(k(c)) && !seen.has(k(c))) { seen.add(k(c)); q.push(c) }
    }
  }
  return seen.size === occ.length ? vals : null
}

// ---------- the record (§5) ----------

/** A signed or unsigned nostr event, as the record helpers see it. */
export interface RecordEvent { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig?: string }

/** A record's template (§5.1): the sheet as content; d, version, the sealed prize, the title and alt as tags. */
export function recordTemplate(o: { lookup: string; sheet: Sheet; sealed: string; title: string; createdAt: number; noBroadcast?: boolean }): { kind: number; created_at: number; tags: string[][]; content: string } {
  const title = [...o.title.trim()].slice(0, TITLE_MAX).join('')
  return {
    kind: BLUEPRINT_RECORD_KIND,
    created_at: o.createdAt,
    tags: [
      ['d', o.lookup],
      ['version', '1'],
      ['encrypted', 'aes-256-gcm', o.sealed, PRIZE_MARK],
      ...(title ? [['title', title]] : []),
      ['alt', 'A Cyberspace blueprint. Build it to find out what it makes: https://onosendai.tech'],
      ...(o.noBroadcast ? [['no-broadcast']] : []),
    ],
    content: JSON.stringify(o.sheet),
  }
}

/** The serialized length of an event (§5.2). */
export function serializedLength(ev: RecordEvent): number {
  return new TextEncoder().encode(JSON.stringify({ id: ev.id, pubkey: ev.pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig: ev.sig ?? '' })).length
}

const HEX64 = /^[0-9a-f]{64}$/
const DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

/**
 * Whether every number in a JSON text, outside its strings, is written as a
 * plain integer (§5.3: no fraction, no exponent, not -0). JSON.parse reads
 * 1.0 and 1e0 as 1, so the text itself is read.
 */
export function integersOnly(json: string): boolean {
  for (let i = 0; i < json.length; i++) {
    const c = json[i]
    if (c === '"') {
      for (i++; i < json.length && json[i] !== '"'; i++) if (json[i] === '\\') i++
      continue
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      let j = i + 1
      while (j < json.length && /[0-9.eE+-]/.test(json[j])) j++
      const tok = json.slice(i, j)
      if (!/^-?(0|[1-9][0-9]*)$/.test(tok) || tok === '-0') return false
      i = j - 1
    }
  }
  return true
}

/** Why a record fails §5.4 (apart from its id and signature, which the caller checks), or null when it passes. */
export function recordRefusal(ev: RecordEvent): string | null {
  if (ev.kind !== BLUEPRINT_RECORD_KIND) return 'kind'
  if (serializedLength(ev) > RECORD_MAX_BYTES) return 'too large'
  const tags = (n: string): string[][] => ev.tags.filter((t) => t[0] === n)
  const d = tags('d'), v = tags('version'), e = tags('encrypted'), ti = tags('title')
  if (d.length !== 1 || !HEX64.test(d[0][1] ?? '')) return 'd'
  if (v.length !== 1 || v[0][1] !== '1') return 'version'
  if (e.length !== 1 || e[0][1] !== 'aes-256-gcm' || typeof e[0][2] !== 'string' || e[0][3] !== PRIZE_MARK) return 'encrypted'
  if (ti.length > 1 || (ti.length && [...(ti[0][1] ?? '')].length > TITLE_MAX)) return 'title'
  for (const bad of ['C', 'H', 'h', 'hint', '-', 'contents', 'X', 'Y', 'Z', 'S']) if (tags(bad).length) return `forbidden tag ${bad}`
  let sheet: Sheet
  try { sheet = JSON.parse(ev.content) as Sheet } catch { return 'content' }
  if (!integersOnly(ev.content)) return 'number form'
  if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) return 'content'
  if (!readSheetShape(sheet)) return 'shape'
  if (sheet.lock === 'location') {
    if (!Number.isInteger(sheet.height) || sheet.height! < 1 || sheet.height! > 85) return 'height'
  } else if (sheet.lock !== 'standard' || 'height' in sheet) return 'lock'
  const p = sheet.prize
  if (!p || !PRIZE_REVEALS.includes(p.reveal)) return 'prize reveal'
  if ('text' in p && (typeof p.text !== 'string' || [...p.text].length > TEXT_MAX)) return 'prize text'
  if ('name' in p && (typeof p.name !== 'string' || [...p.name].length > TITLE_MAX)) return 'prize name'
  if (p.reveal === 'hidden' && ('text' in p || 'views' in p)) return 'hidden prize shows something'
  if (p.reveal === 'description' && (typeof p.text !== 'string' || !p.text.trim() || 'views' in p)) return 'description'
  if ((p.reveal === 'silhouette' || p.reveal === 'render') && (!p.views || typeof p.views !== 'object' || !Object.keys(p.views).length || Object.keys(p.views).some((k) => !PRIZE_VIEWS.includes(k as PrizeView)))) return 'views'
  return null
}

/** A record as a reader draws it: checked (§5.4, apart from the signature), its parts read. */
export interface RecordView {
  lookup: string
  title: string
  sheet: Sheet
  /** Every cell: 0 empty, null hidden, else the revealed id. */
  cells: Array<number | null>
  /** The sealed prize (the `encrypted` tag's payload). */
  sealed: string
  /** The prize's views that keep the rules (a broken one reads as absent). */
  views: Partial<Record<PrizeView, string>>
  /** The prize's name, only when its maker chose to show it. */
  prizeName: string | null
}

/** A record read, or null when it fails §5.4. */
export function readRecord(ev: RecordEvent): RecordView | null {
  if (recordRefusal(ev)) return null
  const sheet = JSON.parse(ev.content) as Sheet
  const cells = readSheetShape(sheet)!
  const views: Partial<Record<PrizeView, string>> = {}
  for (const [k, uri] of Object.entries(sheet.prize.views ?? {})) if (typeof uri === 'string' && uri.length <= VIEW_MAX_CHARS && DATA_URI.test(uri)) views[k as PrizeView] = uri
  const title = ev.tags.find((t) => t[0] === 'title')?.[1]?.trim()
  const prizeName = typeof sheet.prize.name === 'string' && sheet.prize.name.trim() ? sheet.prize.name.trim() : null
  return { lookup: ev.tags.find((t) => t[0] === 'd')![1], title: title || 'blueprint', sheet, cells, sealed: ev.tags.find((t) => t[0] === 'encrypted')![2], views, prizeName }
}

/** The lookup a record answers to, or null. */
export function recordLookup(ev: Pick<RecordEvent, 'kind' | 'tags'>): string | null {
  if (ev.kind !== BLUEPRINT_RECORD_KIND) return null
  const d = ev.tags.filter((t) => t[0] === 'd')
  return d.length === 1 && HEX64.test(d[0][1] ?? '') ? d[0][1] : null
}

/** A blueprint's address (§7.2): one blueprint however many cards of it are held. */
export const recordAddress = (ev: Pick<RecordEvent, 'pubkey' | 'tags' | 'kind'>): string => `${BLUEPRINT_RECORD_KIND}:${ev.pubkey}:${recordLookup(ev) ?? ''}`

// ---------- what a finder sees ----------

/** What a finder sees of a blueprint: the box, which cells are occupied (always shown, as smoke), and the revealed blocks. */
export interface FinderView {
  size: readonly [number, number, number]
  /** One per cell in scan order (cellIndex): occupied or not. */
  occupied: readonly boolean[]
  /** Revealed cells: scan index to block id. Occupied cells not here are hidden (smoke). */
  revealed: ReadonlyMap<number, number>
}

/** A finder's view of a record. */
export function finderView(r: Pick<RecordView, 'sheet' | 'cells'>): FinderView {
  const revealed = new Map<number, number>()
  r.cells.forEach((v, i) => { if (v !== null && v !== 0) revealed.set(i, v) })
  return { size: [r.sheet.size.x, r.sheet.size.y, r.sheet.size.z], occupied: r.cells.map((v) => v !== 0), revealed }
}

/** The view of an arrangement (its maker's, or a starter recipe's): every block revealed, or only the cells `shown` lets through. */
export function fullView(a: Arrangement, shown?: (index: number, id: number) => boolean): FinderView {
  const occupied = Array.from(a.cells, (id) => id > 0)
  const revealed = new Map<number, number>()
  a.cells.forEach((id, i) => { if (id > 0 && (!shown || shown(i, id))) revealed.set(i, id) })
  return { size: a.size, occupied, revealed }
}

// ---------- the card (§7) ----------

/** A card's template: the creator's whole signed record as content, the card's coordinate and the protected marker. */
export function cardTemplate(record: RecordEvent, coordHex: string, createdAt: number, lineage?: string): { kind: number; created_at: number; tags: string[][]; content: string } {
  return {
    kind: BLUEPRINT_CARD_KIND,
    created_at: createdAt,
    tags: [['C', coordHex], ['-'], ...(lineage ? [['d', lineage]] : [])],
    content: JSON.stringify({ id: record.id, pubkey: record.pubkey, created_at: record.created_at, kind: record.kind, tags: record.tags, content: record.content, sig: record.sig }),
  }
}

/** The record a card carries, parsed and checked by §5.4 (the caller verifies its signature), or null. */
export function cardRecord(card: Pick<RecordEvent, 'kind' | 'content'>): RecordEvent | null {
  if (card.kind !== BLUEPRINT_CARD_KIND) return null
  let r: RecordEvent
  try { r = JSON.parse(card.content) as RecordEvent } catch { return null }
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.pubkey !== 'string' || typeof r.sig !== 'string' || !Array.isArray(r.tags) || typeof r.content !== 'string') return null
  return recordRefusal(r) ? null : r
}

/** An arrangement's cells as bytes (two per cell, big-endian), for keeping on the device. */
export function bytesFromCells(cells: Uint16Array): Uint8Array {
  const out = new Uint8Array(cells.length * 2)
  cells.forEach((id, i) => { out[2 * i] = id >> 8; out[2 * i + 1] = id & 0xff })
  return out
}

/** The cells back from those bytes. */
export function cellsFromBytes(b: Uint8Array): Uint16Array {
  const out = new Uint16Array(b.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = (b[2 * i] << 8) | b[2 * i + 1]
  return out
}
