/**
 * shardZip.ts - what bulk import makes of a zip: which entries are shards,
 * what each is called, which folder it goes in, which are skipped and why,
 * and which already have a namesake in your shards.
 *
 * Pure: the zip's directory in (lib/zipRead), a plan out. Reading the bytes
 * and turning them into shards is store/useShardImport's, through the same
 * two doors one object comes in by: the PASTE box's wire form (a .json SNO
 * payload, DECK-0003 §1) and IMPORT's 3D file reader (sno-core importFile).
 *
 * A name in a zip is untrusted text. It never reaches a file system here, but
 * it becomes a shard's name and a folder's, so `..`, absolute paths and
 * drive letters are refused, empty and `.` segments dropped, control and
 * direction-override characters removed, and each segment cut to the length
 * a shard's name may have.
 */

import { IMPORT_MAX_FILE_BYTES } from 'sno-core/mesh'
import type { ZipEntry } from './zipRead'

/** The zip itself, before a byte of it is read. */
export const ZIP_MAX_BYTES = 100 * 1024 * 1024
/** Entries in its directory, folders and skipped files included. */
export const ZIP_MAX_ENTRIES = 2000
/** Shards one zip may bring. */
export const ZIP_MAX_SHARDS = 500
/** One entry, inflated: the same ceiling IMPORT puts on one file. */
export const ZIP_MAX_ENTRY_BYTES = IMPORT_MAX_FILE_BYTES
/** Everything the shards in one zip inflate to, together. */
export const ZIP_MAX_TOTAL_BYTES = 250 * 1024 * 1024
/** Folders deep, below the zip. */
export const ZIP_MAX_DEPTH = 8
/** A shard's name, as the workshop's rename keeps it. */
export const NAME_MAX = 64

/** The files a zip may hold, by how they come in. */
export const SNO_EXT = ['json'] as const
export const MESH_EXT = ['ply', 'stl', 'obj', 'glb', 'gltf', 'vox'] as const
/** Files read beside a model in the same folder, never on their own. */
export const COMPANION_EXT = ['mtl', 'bin'] as const

export type RowKind = 'sno' | 'mesh'

/** An MTL or .bin: read only when a model in its folder names it, or shares its base name. */
export interface Companion {
  /** Its entry's key (see PlannedRow.key). */
  key: string
  /** Its file name as written (cleaned), which is what the model's reader looks it up by. */
  file: string
  /** The same, lower case, for matching what a model names. */
  match: string
  /** Stated size, inflated, in bytes. */
  size: number
}

/** One shard to be. */
export interface PlannedRow {
  /** The entry's place in the zip's directory: unique even where two entries share a name. */
  key: string
  /** The cleaned path, folders and file, for showing. */
  path: string
  /**
   * The shard's id, and so its published `d`: its path in the zip without the
   * extension, under the kit's folder ("maze-kit/forest/hall-straight"). The
   * same zip imported again names the same shards, so they are updated in
   * place rather than doubled. See kitIds.
   */
  id: string
  /** The file's name without its extension. */
  name: string
  /** Folders from the zip's top, outermost first: ["maze-kit", "forest"]. */
  folder: string[]
  kind: RowKind
  /** Stated size, inflated, in bytes. */
  size: number
  /** Why it cannot come in, before a byte is read; null when it may. */
  error: string | null
}

/** A file in the zip that does not become a shard, and why, for the SKIPPED list. */
export interface SkippedFile {
  path: string
  reason: string
}

export interface ZipPlan {
  rows: PlannedRow[]
  skipped: SkippedFile[]
  /** MTL and .bin files by folder path ('/' joined), for OBJ and glTF models there. */
  companions: Record<string, Companion[]>
  /** What the rows without an error state they inflate to, together. */
  total: number
  /** The kit: the first segment of every id. */
  kit: string
}

/** Characters no name keeps: C0 and C1 controls, and the bidi overrides and isolates that make text read as something else. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

const extOf = (file: string): string => {
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(dot + 1).toLowerCase() : ''
}

/** A name for showing and keeping: unsafe characters out, outer space trimmed, cut to NAME_MAX. */
export function cleanSegment(s: string): string {
  return s.replace(UNSAFE_CHARS, '').trim().slice(0, NAME_MAX).trim()
}

export type PathVerdict =
  | { ok: true; folder: string[]; file: string }
  | { ok: false; reason: 'hidden' | 'unsafe' | 'deep' | 'empty' }

/**
 * An entry's name as folders and a file, or why it is not one. Hidden means
 * a dotfile, a dot-folder or macOS's __MACOSX shadow tree: never meant to be
 * imported, reported as skipped. Unsafe means it climbs out (`..`), starts
 * at a root or a drive, or is nothing once cleaned.
 */
export function splitPath(raw: string): PathVerdict {
  const name = raw.replace(/\\/g, '/')
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return { ok: false, reason: 'unsafe' }
  const parts = name.split('/').filter((s) => s !== '' && s !== '.')
  if (parts.length === 0) return { ok: false, reason: 'empty' }
  if (parts.some((s) => s === '..')) return { ok: false, reason: 'unsafe' }
  const cleaned = parts.map(cleanSegment)
  // Judged as written and as it will read: a dot behind a stripped character is still a dotfile.
  if ([...parts, ...cleaned].some((s) => (s.startsWith('.') && s !== '.' && s !== '..') || s === '__MACOSX')) return { ok: false, reason: 'hidden' }
  if (cleaned.some((s) => s === '' || s === '.' || s === '..')) return { ok: false, reason: 'unsafe' }
  if (cleaned.length - 1 > ZIP_MAX_DEPTH) return { ok: false, reason: 'deep' }
  return { ok: true, folder: cleaned.slice(0, -1), file: cleaned[cleaned.length - 1] }
}

/** The shard's name: the file's name without its extension. */
export function nameOf(file: string): string {
  const dot = file.lastIndexOf('.')
  return cleanSegment(dot > 0 ? file.slice(0, dot) : file)
}

const REASON: Record<'hidden' | 'unsafe' | 'deep' | 'empty', string> = {
  hidden: 'Hidden file',
  unsafe: 'Unsafe path',
  deep: `More than ${ZIP_MAX_DEPTH} folders deep`,
  empty: 'No name',
}

/**
 * The zip's directory as rows and skips. Folders listed as entries make no
 * row and no skip; companions are attached to every model in their folder
 * and listed as skipped only if no model there uses them.
 */
export function planZip(entries: readonly ZipEntry[], zipName = 'kit.zip'): ZipPlan {
  const rows: PlannedRow[] = []
  const skipped: SkippedFile[] = []
  const companions: Record<string, Companion[]> = {}
  const companionPaths: Array<{ folder: string; path: string }> = []
  let total = 0
  for (const entry of entries) {
    if (entry.dir) continue
    const split = splitPath(entry.name)
    if (!split.ok) {
      // A hidden file's name is shown as written, cleaned; it is not used for anything.
      skipped.push({ path: cleanSegment(entry.name.replace(/\\/g, '/')) || '(no name)', reason: REASON[split.reason] })
      continue
    }
    const path = [...split.folder, split.file].join('/')
    const ext = extOf(split.file)
    if ((COMPANION_EXT as readonly string[]).includes(ext)) {
      const folder = split.folder.join('/')
      ;(companions[folder] ??= []).push({ key: String(entry.index), file: split.file, match: split.file.toLowerCase(), size: entry.size })
      companionPaths.push({ folder, path })
      continue
    }
    const kind: RowKind | null = (SNO_EXT as readonly string[]).includes(ext) ? 'sno' : (MESH_EXT as readonly string[]).includes(ext) ? 'mesh' : null
    if (!kind) { skipped.push({ path, reason: 'Not a shard file' }); continue }
    const name = nameOf(split.file)
    if (!name) { skipped.push({ path, reason: REASON.empty }); continue }
    if (rows.length >= ZIP_MAX_SHARDS) { skipped.push({ path, reason: `Past ${ZIP_MAX_SHARDS} shards` }); continue }
    let error: string | null = null
    if (entry.encrypted) error = 'Encrypted'
    else if (entry.method !== 0 && entry.method !== 8) error = 'Compressed in a way import does not read'
    else if (entry.size > ZIP_MAX_ENTRY_BYTES) error = `Over ${ZIP_MAX_ENTRY_BYTES / 1048576} MB`
    else if (total + entry.size > ZIP_MAX_TOTAL_BYTES) error = `Past ${ZIP_MAX_TOTAL_BYTES / 1048576} MB for the zip`
    if (!error) total += entry.size
    rows.push({ key: String(entry.index), path, id: '', name, folder: split.folder, kind, size: entry.size, error })
  }
  // An MTL or .bin is read with an OBJ or glTF in its own folder that names
  // it (store/useShardImport), never on its own: one with no such model
  // beside it is listed as skipped.
  const users = new Set(rows.filter((r) => r.kind === 'mesh' && /\.(obj|gltf)$/i.test(r.path)).map((r) => r.folder.join('/')))
  for (const c of companionPaths) if (!users.has(c.folder)) skipped.push({ path: c.path, reason: 'Not a shard file' })
  const kit = kitIds(rows, zipName)
  return { rows, skipped, companions, total, kit }
}

/** A path without its file's extension. */
const stem = (path: string): string => path.replace(/\.[^./]+$/, '')

/**
 * Give each row its id. Every id is scoped to a kit, so it can never be the
 * id of an unrelated shard of yours (those are UUIDs): when every file sits
 * under one top folder, that folder is the kit and the id is the path without
 * its extension; otherwise the zip's own name, cleaned, goes in front. An id
 * with a colon would break the `kind:pubkey:d` address, so that row is an
 * error. The kit, for the caller.
 */
export function kitIds(rows: PlannedRow[], zipName: string): string {
  const tops = new Set(rows.map((r) => (r.folder.length ? r.folder[0] : '')))
  const shared = tops.size === 1 && !tops.has('') ? [...tops][0] : null
  const kit = shared ?? (nameOf(zipName.replace(/\\/g, '/').split('/').pop() ?? zipName).replace(/[:/]/g, '-') || 'kit')
  for (const r of rows) {
    r.id = shared ? stem(r.path) : `${kit}/${stem(r.path)}`
    if (r.id.includes(':') && !r.error) r.error = 'A colon in its path'
  }
  return kit
}

/** The pubkey a kit writes in a reference to one of its own pieces: whoever imports it. */
export const PLACEHOLDER_PUBKEY = '0'.repeat(64)
const PLACEHOLDER = new RegExp(`^33331:${PLACEHOLDER_PUBKEY}:(.+)$`)

/** The kit-internal piece a reference names (its `d`), or null for a reference to anything else. */
export function placeholderOf(ref: readonly unknown[]): string | null {
  if (ref[0] !== 'a' || typeof ref[1] !== 'string') return null
  return PLACEHOLDER.exec(ref[1])?.[1] ?? null
}

/**
 * Which id each name a kit may write in a reference stands for: a row's id,
 * and its path in the zip without the extension (the same thing when the kit
 * has a top folder).
 */
export function refTargets(rows: readonly Pick<PlannedRow, 'id' | 'path'>[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of rows) { out.set(r.id, r.id); if (!out.has(stem(r.path))) out.set(stem(r.path), r.id) }
  return out
}

/** The kit-internal references in a shard that name no piece of the zip. */
export function unresolved(refs: readonly (readonly unknown[])[] | undefined, targets: ReadonlyMap<string, string>): string[] {
  return (refs ?? []).map(placeholderOf).filter((d): d is string => d !== null && !targets.has(d))
}

/** The refs with each kit-internal one pointed at the importer's own piece; every other reference as it was. */
export function resolveRefs<R extends readonly unknown[]>(refs: readonly R[] | undefined, targets: ReadonlyMap<string, string>, pubkey: string): R[] | undefined {
  if (!refs) return refs
  return refs.map((r) => {
    const d = placeholderOf(r)
    const id = d === null ? undefined : targets.get(d)
    if (id === undefined) return r
    const out = [...r] as unknown as R
    ;(out as unknown as unknown[])[1] = `33331:${pubkey}:${id}`
    return out
  })
}

/**
 * The companions a model reads: those it names (an OBJ's mtllib, a glTF's
 * buffer URIs), matched by file name in its folder, one entry per name; else
 * the one sharing its base name. Never every file in the folder, so a zip of
 * a thousand aliases of one large MTL costs one read, not a thousand.
 */
export function companionsFor(modelFile: string, named: readonly string[], here: readonly Companion[]): Companion[] {
  const pick = new Map<string, Companion>()
  // A glTF's URIs are URI-encoded ("my%20tri.bin"), as its reader decodes them.
  const decode = (n: string): string => { try { return decodeURIComponent(n) } catch { return n } }
  const wanted = named.map((n) => (decode(n).replace(/\\/g, '/').split('/').pop() ?? n).trim().toLowerCase()).filter(Boolean)
  for (const w of wanted) {
    if (pick.has(w)) continue
    const c = here.find((x) => x.match === w)
    if (c) pick.set(w, c)
  }
  if (wanted.length === 0) {
    const base = modelFile.toLowerCase().replace(/\.[^.]+$/, '')
    const c = here.find((x) => x.match.replace(/\.[^.]+$/, '') === base)
    if (c) pick.set(c.match, c)
  }
  return [...pick.values()]
}

/** What happens to a piece that is already yours, or whose name is taken. */
export type DupMode = 'skip' | 'copy' | 'update'

/**
 * A row's match. `same`: a shard of yours already has its id, so it is this
 * piece, imported before. `name`: an unrelated shard of yours has its name.
 * `zip`: an earlier row of this zip has its id.
 */
export type Dup = { in: 'same'; id: string } | { in: 'name'; ids: string[] } | { in: 'zip'; first: string } | null

/** A shard of yours, as duplicate matching sees it. */
export interface MineShard {
  id: string
  name: string
  /** Its folder path, when folders exist; null when they do not or it has none known. */
  folder: string[] | null
}

/**
 * The key a name is matched under. With folders, a name is taken only in its
 * own folder; without, anywhere. Case and outer space are ignored, so
 * "Hall" and "hall " are one name.
 */
export function dupKey(name: string, folder: readonly string[] | null, foldersOn: boolean): string {
  const n = name.trim().toLowerCase()
  return foldersOn ? `${(folder ?? []).map((s) => s.toLowerCase()).join('/')}//${n}` : n
}

/**
 * Each row's match: an earlier row with its id, then your shard with its id,
 * then your shards with its name. A piece of the same kit (its id under
 * `<kit>/`) is never a name match: a kit's forest and cistern halls are
 * meant to stand side by side. A row with an error matches nothing.
 */
export function findDups(rows: readonly Pick<PlannedRow, 'key' | 'id' | 'name' | 'folder' | 'error'>[], mine: readonly MineShard[], foldersOn: boolean, kit: string): Map<string, Dup> {
  const ids = new Set(mine.map((s) => s.id))
  const byName = new Map<string, string[]>()
  for (const s of mine) {
    if (s.id.startsWith(`${kit}/`)) continue
    const k = dupKey(s.name, s.folder, foldersOn)
    byName.set(k, [...(byName.get(k) ?? []), s.id])
  }
  const seen = new Map<string, string>()
  const out = new Map<string, Dup>()
  for (const row of rows) {
    if (row.error) { out.set(row.key, null); continue }
    const first = seen.get(row.id)
    const named = byName.get(dupKey(row.name, row.folder, foldersOn))
    out.set(row.key, first ? { in: 'zip', first } : ids.has(row.id) ? { in: 'same', id: row.id } : named?.length ? { in: 'name', ids: named } : null)
    if (!first) seen.set(row.id, row.key)
  }
  return out
}

/**
 * What a row does. `new`: added under its own id (named "<name> copy" when
 * `copyName`, beside an unrelated namesake). `update`: your shard with its id
 * takes the new geometry and is published to the same address, so every
 * object placing it draws the new piece. `copy`: a separate copy under a
 * fresh id. `skip`: left out. An unrelated shard of yours is never replaced.
 */
export type DupAction = { act: 'new'; copyName: boolean } | { act: 'copy' } | { act: 'update'; id: string } | { act: 'skip' }

export function dupAction(dup: Dup, mode: DupMode): DupAction {
  if (!dup) return { act: 'new', copyName: false }
  if (mode === 'skip') return { act: 'skip' }
  if (dup.in === 'same') return mode === 'update' ? { act: 'update', id: dup.id } : { act: 'copy' }
  if (dup.in === 'name') return { act: 'new', copyName: true }
  // A second row with one id: only a copy can come in beside the first.
  return mode === 'copy' ? { act: 'copy' } : { act: 'skip' }
}

/** A copy's name, the way the workshop names one (useWorkshop importShard). */
export function copyName(name: string): string {
  return `${name.slice(0, NAME_MAX - 5)} copy`
}
