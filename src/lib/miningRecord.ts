/**
 * miningRecord.ts: your MINING stats, the same on every device signed in as
 * you (owner, 2026-11-27: "Add a Mining panel in the menu. track how many
 * surveys we've done. think of other helpful stats we could track. track them
 * in 30078 so they are accessible on any device").
 *
 * THE EVENT. NIP-78 app data, as the hidden list's record is
 * (lib/hidesRecord.ts): kind 30078, addressable, `d` = `onosendai/mining`.
 * One event: a record of counts and dates stays small. Not a Cyberspace kind,
 * and the spec does not change.
 *
 * THE CONTENT. `1:<wrapped>:<body>`, exactly the hidden list's: `body` is
 * the record's JSON, deflated and base64'd, sealed with NIP-44 v2 under a
 * random 32-byte record key; `wrapped` is that key sealed with NIP-44 from you
 * to you through your signer. One signer decrypt per load, and a signer
 * encrypt only the first time (to wrap a new key). Only the `d` tag is public.
 *
 * WHAT IT HOLDS. Counts and dates, nothing else: never a coordinate, a chunk,
 * a lookup id or a key. Unique chunks are deduped on the device that
 * surveyed them (store/miningStats.ts), and only the count leaves it.
 *
 * MERGING: a G-counter per device. Each device has its own entry, under a
 * random id it keeps per identity, and only ever raises its own numbers. The
 * total shown is the sum over devices. Two copies merge by taking, per
 * device and per number, the larger; firsts (first survey, the Compiler
 * crafted) take the earlier, bests (longest streak) the larger, and the days
 * you were active are a union. Commutative, associative and idempotent, so
 * two devices can never write over each other's counts: whatever one
 * device's write missed, that device's next write brings back.
 */

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import type { EventTemplate, NostrEvent } from './events'
import { fromBase64, newRecordKey, openShard, sealShard, shardContent, toBase64 } from './hidesRecord'
import { FEATURES, MAXK_AT_LEAST, RARE_TARGET } from './terrain/generate'

export { newRecordKey, openShard as openRecord, sealShard as sealRecord, shardContent as recordContent }

/** NIP-78 application-specific data. */
export const MINING_KIND = 30078
export const MINING_D = 'onosendai/mining'
/** The longest the sealed text may be, as one hidden-list shard (hidesRecord MAX_SHARD_CHARS): an event under 56 KB. */
export const MAX_RECORD_CHARS = 40_000
/** The most runs of active days kept: the newest stay (some years of play even for every other day). */
export const MAX_DAY_RUNS = 2000

/** Every number a device counts. */
export const COUNTERS = [
  /** Surveys completed. */
  'surveys',
  /** Unique chunks surveyed on that device (deduped there, never published). */
  'chunks',
  /** Blocks mined, every kind. */
  'mined',
  /** Blocks placed. */
  'placed',
  /** Of those, placed in open air. */
  'placedAir',
  /** Smashes. */
  'smashes',
  /** Of those, bare-handed. */
  'smashBare',
  /** Of those, with the Compiler. */
  'smashCompiler',
  /** Blocks a smash cleared. */
  'smashed',
  /** Smashes that compiled. */
  'compiles',
  /** Prizes taken. */
  'prizes',
  /** Blueprints made (sealed). */
  'bpMade',
  /** Blueprint cards left in the world (here or in a chest). */
  'bpPlaced',
  /** Blueprints found. */
  'bpFound',
  /** Seconds in TERRAIN with the tab on screen. */
  'terrainSec',
] as const
export type Counter = (typeof COUNTERS)[number]

/** One device's own numbers. Only that device ever raises them. */
export interface DeviceStats {
  /** The counters; a zero is left out. */
  c: Partial<Record<Counter, number>>
  /** Blocks mined by kind: the block's DECK id to how many. */
  k: Record<string, number>
  /** When it last changed, unix seconds. */
  u: number
}

export interface MiningRecord {
  devices: Record<string, DeviceStats>
  /** Firsts, unix seconds: the earliest stands. */
  first: { survey?: number; compiler?: number }
  /** Bests: the largest stands. */
  best: { streak?: number }
  /** Days with any mining, as runs [first, last] of local day numbers (days since 1970 in the player's time zone). */
  days: Array<[number, number]>
}

export function emptyRecord(): MiningRecord { return { devices: {}, first: {}, best: {}, days: [] } }
export function emptyDevice(): DeviceStats { return { c: {}, k: {}, u: 0 } }

const DEVICE_ID = /^[0-9a-f]{16}$/
const KIND_KEY = /^(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])$/

/** A new device id: 8 random bytes, hex. */
export function newDeviceId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export function isDeviceId(id: unknown): id is string { return typeof id === 'string' && DEVICE_ID.test(id) }

function okCount(n: unknown): n is number { return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 }
function okTime(t: unknown): t is number { return typeof t === 'number' && Number.isInteger(t) && t > 0 && t < 1e11 }
function okDay(d: unknown): d is number { return typeof d === 'number' && Number.isInteger(d) && d >= 0 && d < 1e6 }

/** A device's entry as read, or null: one malformed number is dropped alone. */
export function validDevice(o: unknown): DeviceStats | null {
  if (!o || typeof o !== 'object') return null
  const v = o as Record<string, unknown>
  const out = emptyDevice()
  const c = v.c && typeof v.c === 'object' ? (v.c as Record<string, unknown>) : {}
  for (const name of COUNTERS) if (okCount(c[name]) && c[name] > 0) out.c[name] = c[name] as number
  const k = v.k && typeof v.k === 'object' ? (v.k as Record<string, unknown>) : {}
  for (const [id, n] of Object.entries(k)) if (KIND_KEY.test(id) && okCount(n) && n > 0) out.k[id] = n
  out.u = okTime(v.u) ? v.u : 0
  return out
}

/** Runs of days, sorted, overlapping and touching runs joined, the newest MAX_DAY_RUNS kept. */
export function normalDays(days: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const list = days.filter((r) => okDay(r[0]) && okDay(r[1]) && r[0] <= r[1]).map((r) => [r[0], r[1]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const out: Array<[number, number]> = []
  for (const r of list) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else out.push(r)
  }
  return out.length > MAX_DAY_RUNS ? out.slice(out.length - MAX_DAY_RUNS) : out
}

/** The record as read: anything malformed in it dropped, piece by piece. */
export function validRecord(o: unknown): MiningRecord {
  const out = emptyRecord()
  if (!o || typeof o !== 'object') return out
  const v = o as Record<string, unknown>
  const devices = v.devices && typeof v.devices === 'object' ? (v.devices as Record<string, unknown>) : {}
  for (const [id, d] of Object.entries(devices)) {
    if (!isDeviceId(id)) continue
    const dev = validDevice(d)
    if (dev) out.devices[id] = dev
  }
  const first = v.first && typeof v.first === 'object' ? (v.first as Record<string, unknown>) : {}
  if (okTime(first.survey)) out.first.survey = first.survey
  if (okTime(first.compiler)) out.first.compiler = first.compiler
  const best = v.best && typeof v.best === 'object' ? (v.best as Record<string, unknown>) : {}
  if (okCount(best.streak) && best.streak > 0) out.best.streak = best.streak
  if (Array.isArray(v.days)) out.days = normalDays(v.days.filter((r): r is [number, number] => Array.isArray(r) && r.length === 2))
  return out
}

function maxOf(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined ? b : b === undefined ? a : Math.max(a, b)
}
function minOf(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined ? b : b === undefined ? a : Math.min(a, b)
}

/** Two entries for one device as one: every number the larger. */
export function mergeDevice(a: DeviceStats, b: DeviceStats): DeviceStats {
  const out = emptyDevice()
  for (const name of COUNTERS) {
    const n = maxOf(a.c[name], b.c[name])
    if (n) out.c[name] = n
  }
  for (const id of new Set([...Object.keys(a.k), ...Object.keys(b.k)])) {
    const n = maxOf(a.k[id], b.k[id])
    if (n) out.k[id] = n
  }
  out.u = Math.max(a.u, b.u)
  return out
}

/** Two records as one (see MERGING above). Nothing either holds is lost. */
export function mergeRecords(a: MiningRecord, b: MiningRecord): MiningRecord {
  const out = emptyRecord()
  for (const id of new Set([...Object.keys(a.devices), ...Object.keys(b.devices)])) {
    const da = a.devices[id]
    const db = b.devices[id]
    out.devices[id] = da && db ? mergeDevice(da, db) : (da ?? db)!
  }
  const survey = minOf(a.first.survey, b.first.survey)
  const compiler = minOf(a.first.compiler, b.first.compiler)
  if (survey !== undefined) out.first.survey = survey
  if (compiler !== undefined) out.first.compiler = compiler
  const streak = maxOf(a.best.streak, b.best.streak)
  if (streak !== undefined) out.best.streak = streak
  out.days = normalDays([...a.days, ...b.days])
  return out
}

function canonical(r: MiningRecord): string {
  const sortObj = (o: Record<string, number | undefined>): Array<[string, number]> => Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => [k, o[k] as number])
  const devices = Object.keys(r.devices).sort().map((id) => [id, sortObj(r.devices[id].c), sortObj(r.devices[id].k), r.devices[id].u])
  return JSON.stringify([devices, sortObj(r.first), sortObj(r.best), normalDays(r.days)])
}

/** Whether two records say the same thing. */
export function sameRecord(a: MiningRecord, b: MiningRecord): boolean { return canonical(a) === canonical(b) }

// -- what the panel shows ----------------------------------------------------

/** Every device's numbers added up: what you have done, everywhere. */
export interface MiningTotals {
  c: Record<Counter, number>
  /** Blocks mined by kind id. */
  k: Record<number, number>
}

export function totalsOf(r: MiningRecord): MiningTotals {
  const c = Object.fromEntries(COUNTERS.map((n) => [n, 0])) as Record<Counter, number>
  const k: Record<number, number> = {}
  for (const d of Object.values(r.devices)) {
    for (const name of COUNTERS) c[name] += d.c[name] ?? 0
    for (const [id, n] of Object.entries(d.k)) k[Number(id)] = (k[Number(id)] ?? 0) + n
  }
  return { c, k }
}

/** Today's local day number: days since 1970 in this device's time zone. */
export function dayNumber(ms: number = Date.now(), offsetMin: number = new Date(ms).getTimezoneOffset()): number {
  return Math.floor((ms - offsetMin * 60_000) / 86_400_000)
}

/** `days` with `day` in it. */
export function withDay(days: ReadonlyArray<readonly [number, number]>, day: number): Array<[number, number]> {
  return normalDays([...days, [day, day]])
}

/** How many days you were active. */
export function daysActive(r: Pick<MiningRecord, 'days'>): number {
  return r.days.reduce((n, [a, b]) => n + (b - a + 1), 0)
}

/** The run of days ending today, or yesterday (today's not over yet): 0 when neither was active. */
export function currentStreak(r: Pick<MiningRecord, 'days'>, today: number): number {
  for (const [a, b] of r.days) if (b === today || b === today - 1) return b - a + 1
  return 0
}

/** The longest run of active days: the longest kept, or longer when runs were let go. */
export function longestStreak(r: Pick<MiningRecord, 'days' | 'best'>): number {
  return r.days.reduce((n, [a, b]) => Math.max(n, b - a + 1), r.best.streak ?? 0)
}

/**
 * How rare a block is, as the generator places it (lib/terrain/generate.ts):
 * the chance a surveyed chunk holds one. The rare band by the owner's targets,
 * the veins by their chance and the share of chunks rich enough for them;
 * null for the ground's own kinds, which every chunk has plenty of.
 */
export function rarityOf(id: number): number | null {
  const rare = RARE_TARGET[id]
  if (rare !== undefined) return rare
  const vein = ({ 40: FEATURES.ferrovein, 41: FEATURES.cobaltine, 8: FEATURES.prismite, 42: FEATURES.glowcore } as Record<number, { t: number; minK: number }>)[id]
  if (vein) return (vein.t / 2 ** 32) * MAXK_AT_LEAST[vein.minK]
  return null
}

/** The rarest kind mined, or null when nothing mined is rare. */
export function rarestMined(k: Readonly<Record<number, number>>): number | null {
  let best: number | null = null
  let chance = Infinity
  for (const [id, n] of Object.entries(k)) {
    const p = rarityOf(Number(id))
    if (n > 0 && p !== null && p < chance) { chance = p; best = Number(id) }
  }
  return best
}

/** The kinds mined most, most first: [id, count]. */
export function topMined(k: Readonly<Record<number, number>>, n: number): Array<[number, number]> {
  return Object.entries(k).map(([id, c]) => [Number(id), c] as [number, number]).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, n)
}

// -- the event ---------------------------------------------------------------

/** The record's text before sealing: its JSON, deflated, base64. */
export function encodeRecord(r: MiningRecord): string {
  const devices = Object.fromEntries(Object.keys(r.devices).sort().map((id) => [id, r.devices[id]]))
  return toBase64(deflateSync(strToU8(JSON.stringify({ v: 1, devices, first: r.first, best: r.best, days: normalDays(r.days) })), { level: 9 }))
}

/** The record's text, read back. Throws when it is not a mining record at all. */
export function decodeRecord(text: string): MiningRecord {
  const raw = JSON.parse(strFromU8(inflateSync(fromBase64(text)))) as { v?: unknown }
  if (raw.v !== 1) throw new Error('not a mining record this client reads')
  return validRecord(raw)
}

export class MiningTooLarge extends Error {
  constructor() { super('Your mining stats are too large to save to the relay.') }
}

/** The record's text, checked against MAX_RECORD_CHARS. */
export function planRecord(r: MiningRecord): string {
  const text = encodeRecord(r)
  if (text.length > MAX_RECORD_CHARS) throw new MiningTooLarge()
  return text
}

/** The record's event, unsigned. Only the `d`: nothing else about it is public. */
export function recordTemplate(content: string, createdAt: number): EventTemplate {
  return { kind: MINING_KIND, created_at: createdAt, tags: [['d', MINING_D]], content }
}

/** The newest record event of this author's (a replaceable event: the newest, ties to the lowest id), or null. */
export function newestRecord(events: readonly NostrEvent[], me: string): NostrEvent | null {
  let out: NostrEvent | null = null
  for (const ev of events) {
    if (ev.pubkey !== me || ev.kind !== MINING_KIND) continue
    if (ev.tags.find((t) => t[0] === 'd')?.[1] !== MINING_D) continue
    if (!out || ev.created_at > out.created_at || (ev.created_at === out.created_at && ev.id < out.id)) out = ev
  }
  return out
}
