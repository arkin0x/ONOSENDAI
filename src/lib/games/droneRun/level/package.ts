/**
 * package.ts - a DRONE RUN level package: a zip the player imports on their
 * own device, read and checked. Pure; nothing here stores, signs or sends.
 *
 * A package is `level.json` (the format in level.ts) and `payloads/<piece>.json`
 * for every piece it places, each an SNO object payload (DECK-0003 §1). The
 * files may sit at the zip's top or inside one folder (what a desktop "compress
 * folder" makes); anything else in the zip is ignored. For example (made up):
 *
 *   level.json
 *   payloads/field-berm-a.json
 *   payloads/field-crate.json
 *
 * The zip is untrusted: it is read with the workshop bulk import's reader
 * (lib/zipRead.ts listZip and readEntry, which never trust a stated size),
 * every payload read as PASTE and bulk import read one (sno-core fromPayload,
 * which store/useWorkshop shardFromText wraps) and refused as they refuse one
 * (lib/hidden.ts shardRefusal), under the size limits below. Refusals are
 * plain sentences the GAMES panel shows as they are.
 */

import { fromPayload } from 'sno-core/shards'
import { listZip, readEntry, ZipError, type ZipEntry } from '../../../zipRead'
import { shardRefusal } from '../../../hidden'
import { pieceNames, readLevel, type Level } from './level'
import baseVariant from '../variants/drone-run-base.json'

/** The spawn point ids the game's waves name (the base variant's wave scripts): an imported level must have each. */
export const WAVE_SPAWN_IDS: readonly string[] = [...new Set(
  (baseVariant as { spec: { waves: Array<{ spawns: Array<{ at: unknown }> }> } }).spec.waves.flatMap((w) => w.spawns.map((sp) => sp.at)).filter((at): at is string => typeof at === 'string'),
)].sort()

/** The zip itself, at most. */
export const PACKAGE_MAX_BYTES = 16 * 1024 * 1024
/** Entries in its directory, folders and ignored files included. */
export const PACKAGE_MAX_ENTRIES = 1000
/** level.json, inflated. */
export const LEVEL_JSON_MAX_BYTES = 512 * 1024
/** One payload, inflated. */
export const PIECE_MAX_BYTES = 128 * 1024
/** Everything read, inflated, together. */
export const PACKAGE_MAX_TOTAL_BYTES = 16 * 1024 * 1024
/** Faces drawn, every placement counted: what a phone can still draw and collide with. */
export const LEVEL_MAX_FACES = 200_000

/** A level package read and checked: the level, each piece's payload as parsed, and what it costs. */
export interface LevelPackage {
  level: Level
  payloads: Record<string, unknown>
  /** Bytes read, inflated (level.json and the payloads). */
  bytes: number
  /** Faces drawn, every placement counted. */
  faces: number
}

const kb = (n: number): string => `${Math.round(n / 1024)} KB`
const text = new TextDecoder('utf-8', { fatal: true })

/** The entries by name, a single top folder taken off when every file is inside it; folders and macOS extras left out. */
function filesOf(entries: ZipEntry[]): Map<string, ZipEntry> {
  const files = entries.filter((e) => !e.dir && !/(^|[\\/])__MACOSX[\\/]/.test(e.name) && !/(^|[\\/])\._/.test(e.name))
  const norm = (n: string): string => n.replace(/\\/g, '/').replace(/^\.\//, '')
  const tops = new Set(files.map((e) => (norm(e.name).includes('/') ? norm(e.name).split('/')[0] : '')))
  const strip = tops.size === 1 && !tops.has('') ? `${[...tops][0]}/` : ''
  const out = new Map<string, ZipEntry>()
  for (const e of files) {
    const n = norm(e.name)
    out.set(strip && n.startsWith(strip) ? n.slice(strip.length) : n, e)
  }
  return out
}

/** JSON from an entry, at most `cap` bytes, or an Error naming the file. */
function jsonOf(bytes: Uint8Array, entry: ZipEntry, name: string, cap: number): { value: unknown; size: number } {
  let raw: Uint8Array
  try { raw = readEntry(bytes, entry, cap) } catch (err) {
    if (err instanceof ZipError && /too large/.test(err.message)) throw new Error(`${name} is over ${kb(cap)}.`)
    throw new Error(`${name} could not be read: ${err instanceof Error ? err.message : String(err)}`)
  }
  try { return { value: JSON.parse(text.decode(raw)), size: raw.length } } catch {
    throw new Error(`${name} is not JSON.`)
  }
}

/**
 * The level package in `bytes`, read and checked, or an Error whose message
 * says what is wrong in plain words: not a zip, too large, no level.json, a
 * level that does not read (zones or entry outside the region, the entry not
 * in the start zone), a piece with no payload, a payload that is not an SNO
 * object or is over the size limit, or a level with too many faces to draw.
 */
export function readLevelPackage(bytes: Uint8Array): LevelPackage {
  if (bytes.length > PACKAGE_MAX_BYTES) throw new Error(`That zip is over ${Math.round(PACKAGE_MAX_BYTES / 1024 / 1024)} MB.`)
  let entries: ZipEntry[]
  try { entries = listZip(bytes, PACKAGE_MAX_ENTRIES) } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err))
  }
  const files = filesOf(entries)
  const top = files.get('level.json')
  if (!top) throw new Error('There is no level.json in that zip.')
  const read = jsonOf(bytes, top, 'level.json', LEVEL_JSON_MAX_BYTES)
  let level: Level
  try { level = readLevel(read.value) } catch (err) {
    throw new Error(`level.json: ${err instanceof Error ? err.message : String(err)}.`)
  }
  // Every spawn point the game's waves name must be in the level, or the first wave would stop on it after ENTER.
  const have = new Set(level.spawns.map((sp) => sp.id))
  const missing = WAVE_SPAWN_IDS.filter((id) => !have.has(id))
  if (missing.length > 0) throw new Error(`level.json has no spawn point ${missing.join(', ')}, which the waves use.`)
  let total = read.size
  const payloads: Record<string, unknown> = {}
  const facesOf = new Map<string, number>()
  for (const name of pieceNames(level)) {
    const file = `payloads/${name}.json`
    const entry = files.get(file)
    if (!entry) throw new Error(`The level places ${name}, but ${file} is not in the zip.`)
    const got = jsonOf(bytes, entry, file, PIECE_MAX_BYTES)
    total += got.size
    if (total > PACKAGE_MAX_TOTAL_BYTES) throw new Error(`That level is over ${Math.round(PACKAGE_MAX_TOTAL_BYTES / 1024 / 1024)} MB unzipped.`)
    const shard = fromPayload(got.value, `drone-run-${name}`)
    if (!shard) throw new Error(`${file} is not an SNO object.`)
    const why = shardRefusal(shard)
    if (why) throw new Error(`${file}: ${why}`)
    payloads[name] = got.value
    facesOf.set(name, shard.mode === 'solid' ? shard.faces.length : 0)
  }
  const faces = level.pieces.reduce((n, p) => n + (facesOf.get(p.piece) ?? 0), 0)
  if (faces > LEVEL_MAX_FACES) throw new Error(`That level draws ${faces} faces. The most a level may draw is ${LEVEL_MAX_FACES}.`)
  return { level, payloads, bytes: total, faces }
}
