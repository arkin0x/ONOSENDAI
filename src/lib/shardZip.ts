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

/** One shard to be. */
export interface PlannedRow {
  /** The entry's name as the zip wrote it: unique in the zip, the key to its bytes. */
  key: string
  /** The cleaned path, folders and file, for showing. */
  path: string
  /** The file's name without its extension. */
  name: string
  /** Folders from the zip's top, outermost first: ["maze-kit", "forest"]. */
  folder: string[]
  kind: RowKind
  /** Stated size, inflated, in bytes. */
  size: number
  /** For a mesh: the companion files in its folder (an OBJ's MTL, a glTF's .bin), by entry key. */
  companions: string[]
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
}

/** Characters no name keeps: C0 and C1 controls, and the bidi overrides and isolates that make text read as something else. */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g

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
  if (parts.some((s) => s.startsWith('.') || s === '__MACOSX')) return { ok: false, reason: 'hidden' }
  const cleaned = parts.map(cleanSegment)
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
export function planZip(entries: readonly ZipEntry[]): ZipPlan {
  const rows: PlannedRow[] = []
  const skipped: SkippedFile[] = []
  const companions: Array<{ key: string; folder: string; path: string; used: boolean }> = []
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
      companions.push({ key: entry.name, folder: split.folder.join('/'), path, used: false })
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
    rows.push({ key: entry.name, path, name, folder: split.folder, kind, size: entry.size, companions: [], error })
  }
  // An OBJ's MTL and a glTF's .bin travel with the models in their own folder.
  for (const row of rows) {
    if (row.kind !== 'mesh' || !/\.(obj|gltf)$/i.test(row.path)) continue
    const here = row.folder.join('/')
    for (const c of companions) if (c.folder === here) { row.companions.push(c.key); c.used = true }
  }
  for (const c of companions) if (!c.used) skipped.push({ path: c.path, reason: 'Not a shard file' })
  return { rows, skipped }
}

/** What happens to a shard whose name is already taken. */
export type DupMode = 'skip' | 'copy' | 'update'

/** A row's namesake: shards of yours (by id), or an earlier row of this zip (by key). */
export type Dup = { in: 'mine'; ids: string[] } | { in: 'zip'; first: string } | null

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
 * Each row's namesake: a row above it in the zip first, then your shards. A
 * row with an error is not matched and matches nothing.
 */
export function findDups(rows: readonly Pick<PlannedRow, 'key' | 'name' | 'folder' | 'error'>[], mine: readonly MineShard[], foldersOn: boolean): Map<string, Dup> {
  const byKey = new Map<string, string[]>()
  for (const s of mine) {
    const k = dupKey(s.name, s.folder, foldersOn)
    byKey.set(k, [...(byKey.get(k) ?? []), s.id])
  }
  const seen = new Map<string, string>()
  const out = new Map<string, Dup>()
  for (const row of rows) {
    if (row.error) { out.set(row.key, null); continue }
    const k = dupKey(row.name, row.folder, foldersOn)
    const ids = byKey.get(k)
    const first = seen.get(k)
    // An earlier row first: two rows updating one shard of yours would be one lost.
    out.set(row.key, first ? { in: 'zip', first } : ids?.length ? { in: 'mine', ids } : null)
    if (!first) seen.set(k, row.key)
  }
  return out
}

/**
 * What a row does under a duplicate mode: `new` adds it under its own name,
 * `copy` adds it as "<name> copy", `update` replaces the one shard of yours
 * that has its name (PUBLISH AGAIN then sends it to the same address, so
 * every object placing it draws the new version), `skip` leaves it out.
 * UPDATE needs exactly one namesake of yours; with two or more it is a copy,
 * since replacing one of them would be a guess. A namesake inside the zip
 * is never updated: it does not exist yet.
 */
export type DupAction = { act: 'new' } | { act: 'copy' } | { act: 'update'; id: string } | { act: 'skip' }

export function dupAction(dup: Dup, mode: DupMode): DupAction {
  if (!dup) return { act: 'new' }
  if (mode === 'skip') return { act: 'skip' }
  if (mode === 'update' && dup.in === 'mine' && dup.ids.length === 1) return { act: 'update', id: dup.ids[0] }
  return { act: 'copy' }
}

/** A copy's name, the way the workshop names one (useWorkshop importShard). */
export function copyName(name: string): string {
  return `${name.slice(0, NAME_MAX - 5)} copy`
}
