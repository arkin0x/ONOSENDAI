/**
 * inventoryRecord.ts: your TERRAIN inventory, the same on every device signed
 * in as you (owner, 2026-11-28: "oh man. we gotta sync inventory across
 * devices. yeah. please make that happen."). This overrules ADR-0001's note
 * that the inventory stays on the device; the addendum there records it.
 *
 * THE EVENT. NIP-78 app data, as MINING's record is (lib/miningRecord.ts):
 * kind 30078, addressable, `d` = `onosendai/inventory`. One event. Not a
 * Cyberspace kind, and the spec does not change.
 *
 * THE CONTENT. `1:<wrapped>:<body>`, exactly MINING's and the hidden list's:
 * `body` is the record's JSON, deflated and base64'd, sealed with NIP-44 v2
 * under a random 32-byte record key; `wrapped` is that key sealed with NIP-44
 * from you to you through your signer. Only the `d` tag is public.
 *
 * WHAT IT HOLDS. How many of each thing you carry, as counts per device, and
 * the tools you own with the date each was first made. Never a coordinate, a
 * chunk, a hotbar or a floating drop: those stay on the device.
 *
 * MERGING: a PN-counter per device. Each device has its own entry, under a
 * random id it keeps per identity (as MINING's), with two numbers per item:
 * `a`, how many it added, and `s`, how many it spent. A device only ever
 * raises its own numbers. Two copies merge by taking, per device, per item
 * and per number, the larger, so the merge is commutative, associative and
 * idempotent, and no device's gain or spend is ever lost however the writes
 * cross. What you hold is the sum of every `a` less the sum of every `s`.
 *
 * THE HONOR SYSTEM. Two devices that spend the same blocks before either has
 * synced spend more than there was, and the sum goes below zero. Then 0 is
 * shown, play is never blocked, and the debt is kept: later gains pay it off
 * before they show. Nothing stops a player from doing this on purpose, and
 * nothing tries to: it is a game inventory, not money.
 *
 * TOOLS are grow-only: a tool is owned once any device recorded it, and the
 * earliest date stands (the Compiler's crafted date). Quarry Charges are an
 * item like the blocks (`charge`), gained 7 a compile and spent 1 a placing.
 *
 * ITEM NAMES. An item is named by a string, the same in `a` and `s`:
 *   - a block kind: its DECK id in decimal, "1" to "255", no leading zero;
 *   - a named item: a lowercase letter, then up to 31 lowercase letters,
 *     digits or underscores (`charge` is the Quarry Charges).
 * A tool is named the same way as a named item (`compiler`). Anything else
 * is dropped as read. At most MAX_ITEMS items per number per device, and
 * MAX_ITEMS tools.
 *
 * RETIRED DEVICES. Every device keeps an entry forever, so a record could in
 * time outgrow one event. Before it would (RETIRE_AT), the device writing
 * folds the devices idle longest (nothing changed for RETIRE_IDLE_S, never
 * itself, never one another device already folded) into its own entry in
 * `retired`, keyed by its own id: the ids it folded (with when each last
 * changed) and their added and spent summed, so every total stays the same.
 * Only that device ever raises its entry there (it only adds devices and
 * their numbers), so two copies of it merge by the larger, per id and per
 * number, exactly as a device's own entry does; entries of different
 * folders are never taken whole over one another. A device listed in any
 * folder's entry is dropped from `devices` wherever it shows up again.
 * A fold reaches other devices only through the relay: it is written into
 * the event and never into this device's own copy, which takes it from the
 * relay like any other change. So every fold is made on top of every fold
 * already on the relay (a write reads first, and reads again after signing),
 * and two folders never fold the same device. A device that finds itself
 * folded takes a new id and starts it with what it had not yet written
 * (store/inventorySync.ts): it may count a little less, never twice.
 *
 * WHAT A NEWER CLIENT ADDS is carried through, never dropped: an item this
 * version does not know merges as a PN-counter like the rest, a tool by the
 * earlier date, and any other field (at the top or in a device's entry) is
 * kept as read, the copy just read standing over the one held.
 */

import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate'
import type { EventTemplate, NostrEvent } from './events'
import { fromBase64, newRecordKey, openShard, sealShard, shardContent, toBase64 } from './hidesRecord'
import { extrasOf, isDeviceId, mergeExtra, newDeviceId, type Extra } from './miningRecord'
import { HOTBAR_SLOTS, withCharges, withCompiler, type Inventory } from './terrain/terrainDb'

export { newDeviceId, isDeviceId, newRecordKey, openShard as openRecord, sealShard as sealRecord, shardContent as recordContent }

/** NIP-78 application-specific data. */
export const INVENTORY_KIND = 30078
export const INVENTORY_D = 'onosendai/inventory'
/** The longest the sealed text may be, as one hidden-list shard (hidesRecord MAX_SHARD_CHARS): an event under 56 KB. */
export const MAX_RECORD_CHARS = 40_000
/** The Quarry Charges, as an item. */
export const CHARGE = 'charge'
/** The Compiler, as a tool. */
export const COMPILER = 'compiler'

/** One device's own numbers. Only that device ever raises them. */
export interface DeviceInventory {
  /** Added, by item: a block kind's id ("1" to "255") or a named item ("charge"). A zero is left out. */
  a: Record<string, number>
  /** Spent, by item. A zero is left out. */
  s: Record<string, number>
  /** When it last changed, unix seconds. */
  u: number
  /** Any other field of the entry, carried through. */
  x?: Extra
}

/** Devices one folder folded together (RETIRED DEVICES above): their ids, each with when it last changed, and their numbers summed. */
export interface RetiredDevices {
  ids: Record<string, number>
  a: Record<string, number>
  s: Record<string, number>
}

export interface InventoryRecord {
  devices: Record<string, DeviceInventory>
  /** Tools owned, by name, with the earliest date any device recorded (unix seconds). */
  tools: Record<string, number>
  /** Devices folded together, by the id of the device that folded them; absent until a record first nears the size limit. */
  retired?: Record<string, RetiredDevices>
  /** Any other top-level field, carried through. */
  x?: Extra
}

/** A record's text past this many characters folds the idlest devices (RETIRED DEVICES above), */
export const RETIRE_AT = 36_000
/** down to this many, */
export const RETIRE_TO = 30_000
/** folding only devices with nothing changed in this long (seconds). */
export const RETIRE_IDLE_S = 30 * 86_400

export function emptyRecord(): InventoryRecord { return { devices: {}, tools: {} } }
export function emptyDevice(): DeviceInventory { return { a: {}, s: {}, u: 0 } }

/** A block kind's id, 1 to 255, or a named item or tool. */
const BLOCK_KEY = /^(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])$/
const NAME_KEY = /^[a-z][a-z0-9_]{0,31}$/
/** The most items kept per device and number, and tools per record, so a record never swells. */
const MAX_ITEMS = 512
const RECORD_FIELDS = new Set(['v', 'devices', 'tools', 'retired'])
const DEVICE_FIELDS = new Set(['a', 's', 'u'])

export const isItem = (k: string): boolean => BLOCK_KEY.test(k) || NAME_KEY.test(k)
function okCount(n: unknown): n is number { return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 }
function okTime(t: unknown): t is number { return typeof t === 'number' && Number.isInteger(t) && t > 0 && t < 1e11 }

function countsOf(o: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!o || typeof o !== 'object') return out
  let n = 0
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (!isItem(k) || !okCount(v) || v === 0) continue
    if (++n > MAX_ITEMS) break
    out[k] = v
  }
  return out
}

function validFold(o: unknown): RetiredDevices | undefined {
  if (!o || typeof o !== 'object') return undefined
  const v = o as Record<string, unknown>
  const ids: Record<string, number> = {}
  if (v.ids && typeof v.ids === 'object') for (const [id, t] of Object.entries(v.ids as Record<string, unknown>)) if (isDeviceId(id) && okCount(t)) ids[id] = t
  if (!Object.keys(ids).length) return undefined
  return { ids, a: countsOf(v.a), s: countsOf(v.s) }
}

function validRetired(o: unknown): Record<string, RetiredDevices> | undefined {
  if (!o || typeof o !== 'object') return undefined
  const out: Record<string, RetiredDevices> = {}
  for (const [folder, f] of Object.entries(o as Record<string, unknown>)) {
    if (!isDeviceId(folder)) continue
    const fold = validFold(f)
    if (fold) out[folder] = fold
  }
  return Object.keys(out).length ? out : undefined
}

/** Every folder's entry. */
const foldsOf = (r: Pick<InventoryRecord, 'retired'>): RetiredDevices[] => Object.values(r.retired ?? {})

/** `devices` without the ones any folder folded. */
function withoutRetired(devices: Record<string, DeviceInventory>, retired: Record<string, RetiredDevices> | undefined): Record<string, DeviceInventory> {
  if (!retired) return devices
  const folds = Object.values(retired)
  const out: Record<string, DeviceInventory> = {}
  for (const [id, d] of Object.entries(devices)) if (!folds.some((f) => f.ids[id] !== undefined)) out[id] = d
  return out
}

/** Two copies' retired devices as one (RETIRED DEVICES above): per folder, per id and per number, the larger. */
export function mergeRetired(a: Record<string, RetiredDevices> | undefined, b: Record<string, RetiredDevices> | undefined): Record<string, RetiredDevices> | undefined {
  if (!a || !b) return a ?? b
  const out: Record<string, RetiredDevices> = {}
  for (const folder of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const fa = a[folder]
    const fb = b[folder]
    out[folder] = fa && fb ? { ids: maxCounts(fa.ids, fb.ids), a: maxCounts(fa.a, fb.a), s: maxCounts(fa.s, fb.s) } : (fa ?? fb)!
  }
  return out
}

/** A device's entry as read, or null: one malformed number is dropped alone. */
export function validDevice(o: unknown): DeviceInventory | null {
  if (!o || typeof o !== 'object') return null
  const v = o as Record<string, unknown>
  const out: DeviceInventory = { a: countsOf(v.a), s: countsOf(v.s), u: okTime(v.u) ? v.u : 0 }
  const x = extrasOf(v, DEVICE_FIELDS)
  if (x) out.x = x
  return out
}

/** The record as read: anything malformed in it dropped, piece by piece. */
export function validRecord(o: unknown): InventoryRecord {
  const out = emptyRecord()
  if (!o || typeof o !== 'object') return out
  const v = o as Record<string, unknown>
  const devices = v.devices && typeof v.devices === 'object' ? (v.devices as Record<string, unknown>) : {}
  for (const [id, d] of Object.entries(devices)) {
    if (!isDeviceId(id)) continue
    const dev = validDevice(d)
    if (dev) out.devices[id] = dev
  }
  const tools = v.tools && typeof v.tools === 'object' ? (v.tools as Record<string, unknown>) : {}
  let n = 0
  for (const [name, t] of Object.entries(tools)) {
    if (!NAME_KEY.test(name) || !okTime(t)) continue
    if (++n > MAX_ITEMS) break
    out.tools[name] = t
  }
  const retired = validRetired(v.retired)
  if (retired) { out.retired = retired; out.devices = withoutRetired(out.devices, retired) }
  const x = extrasOf(v, RECORD_FIELDS)
  if (x) out.x = x
  return out
}

function maxCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const n = Math.max(a[k] ?? 0, b[k] ?? 0)
    if (n) out[k] = n
  }
  return out
}

/** Two entries for one device as one: every number the larger. */
export function mergeDevice(a: DeviceInventory, b: DeviceInventory): DeviceInventory {
  const out: DeviceInventory = { a: maxCounts(a.a, b.a), s: maxCounts(a.s, b.s), u: Math.max(a.u, b.u) }
  const x = mergeExtra(a.x, b.x)
  if (x) out.x = x
  return out
}

/** Two records as one (see MERGING above). Nothing either holds is lost; of fields this version does not read, `b`'s stand. */
export function mergeRecords(a: InventoryRecord, b: InventoryRecord): InventoryRecord {
  const out = emptyRecord()
  for (const id of new Set([...Object.keys(a.devices), ...Object.keys(b.devices)])) {
    const da = a.devices[id]
    const db = b.devices[id]
    out.devices[id] = da && db ? mergeDevice(da, db) : (da ?? db)!
  }
  for (const name of new Set([...Object.keys(a.tools), ...Object.keys(b.tools)])) {
    const ta = a.tools[name]
    const tb = b.tools[name]
    out.tools[name] = ta === undefined ? tb : tb === undefined ? ta : Math.min(ta, tb)
  }
  const retired = mergeRetired(a.retired, b.retired)
  if (retired) { out.retired = retired; out.devices = withoutRetired(out.devices, retired) }
  const x = mergeExtra(a.x, b.x)
  if (x) out.x = x
  return out
}

/**
 * Fold the idlest devices into `folder`'s own entry in `retired` until the
 * record's text is at most `to` characters (RETIRED DEVICES above): never the
 * folder itself, never one changed within RETIRE_IDLE_S of `nowS`, never one
 * another folder already folded, and at most `most` of them. Every total
 * stays the same. The record back unchanged when it already fits, or with no
 * folder named.
 */
export function foldIdle(r: InventoryRecord, folder: string, nowS: number, to = RETIRE_TO, most = Infinity): InventoryRecord {
  if (!isDeviceId(folder) || encodeRecord(r).length <= to) return r
  const idle = Object.entries(r.devices).filter(([id, d]) => id !== folder && nowS - d.u >= RETIRE_IDLE_S && !isRetired(r, id)).sort((x, y) => x[1].u - y[1].u || (x[0] < y[0] ? -1 : 1)).slice(0, most)
  let out = r
  // A few at a time: each text costs a deflate.
  const step = Math.max(1, Math.ceil(idle.length / 16))
  for (let i = 0; i < idle.length; i += step) {
    const was = out.retired?.[folder]
    const fold: RetiredDevices = was ? { ids: { ...was.ids }, a: { ...was.a }, s: { ...was.s } } : { ids: {}, a: {}, s: {} }
    const devices = { ...out.devices }
    for (const [id, d] of idle.slice(i, i + step)) {
      fold.ids[id] = d.u
      for (const [k, n] of Object.entries(d.a)) fold.a[k] = (fold.a[k] ?? 0) + n
      for (const [k, n] of Object.entries(d.s)) fold.s[k] = (fold.s[k] ?? 0) + n
      delete devices[id]
    }
    out = { ...out, devices, retired: { ...out.retired, [folder]: fold } }
    if (encodeRecord(out).length <= to) break
  }
  return out
}

/** Whether this device's id was folded into `retired` by any folder (it then takes a new one). */
export const isRetired = (r: Pick<InventoryRecord, 'retired'>, id: string): boolean => foldsOf(r).some((f) => f.ids[id] !== undefined)

function canonical(r: InventoryRecord): string {
  const sorted = (o: Record<string, unknown> | undefined): Array<[string, unknown]> => (o ? Object.keys(o).sort().map((k) => [k, o[k]]) : [])
  const devices = Object.keys(r.devices).sort().map((id) => [id, sorted(r.devices[id].a), sorted(r.devices[id].s), r.devices[id].u, JSON.stringify(sorted(r.devices[id].x))])
  const retired = r.retired ? Object.keys(r.retired).sort().map((f) => [f, sorted(r.retired![f].ids), sorted(r.retired![f].a), sorted(r.retired![f].s)]) : null
  return JSON.stringify([devices, sorted(r.tools), retired, JSON.stringify(sorted(r.x))])
}

/** Whether two records say the same thing. */
export function sameRecord(a: InventoryRecord, b: InventoryRecord): boolean { return canonical(a) === canonical(b) }

// -- what you hold -------------------------------------------------------------

/** Every item's sum over the devices: added less spent. Below zero is a debt (THE HONOR SYSTEM above). */
export function totalsOf(r: InventoryRecord): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of [...Object.values(r.devices), ...foldsOf(r)]) {
    for (const [k, n] of Object.entries(d.a)) out[k] = (out[k] ?? 0) + n
    for (const [k, n] of Object.entries(d.s)) out[k] = (out[k] ?? 0) - n
  }
  return out
}

/** How many of an item you hold: never below 0, whatever the debt. */
export function heldOf(totals: Readonly<Record<string, number>>, item: string): number { return Math.max(0, totals[item] ?? 0) }

/** Whether any device ever added or spent the item. */
export function knowsItem(r: InventoryRecord, item: string): boolean {
  return [...Object.values(r.devices), ...foldsOf(r)].some((d) => (d.a[item] ?? 0) > 0 || (d.s[item] ?? 0) > 0)
}

/** Every block kind ever collected, on any device, and how many: what the game's own blueprints are granted by (gameBlueprint.ts). */
export function collectedKinds(r: InventoryRecord): Record<number, number> {
  const out: Record<number, number> = {}
  for (const d of [...Object.values(r.devices), ...foldsOf(r)]) for (const [k, n] of Object.entries(d.a)) if (BLOCK_KEY.test(k)) out[Number(k)] = (out[Number(k)] ?? 0) + n
  return out
}

/** What one change to the inventory did, as gains and spends by item, and a tool made. */
export interface InventoryDelta {
  add: Record<string, number>
  spend: Record<string, number>
  /** The Compiler made by hand (a preview's grant never counts). */
  compiler: boolean
}

/** What changed from `prev` to `next`: the blocks and the charges up or down, and the Compiler made. */
export function deltaOf(prev: Inventory, next: Inventory): InventoryDelta {
  const out: InventoryDelta = { add: {}, spend: {}, compiler: next.compiler === 'made' && prev.compiler !== 'made' }
  const note = (item: string, d: number): void => { if (d > 0) out.add[item] = d; else if (d < 0) out.spend[item] = -d }
  for (const id of new Set([...Object.keys(prev.counts), ...Object.keys(next.counts)])) note(id, (next.counts[Number(id)] ?? 0) - (prev.counts[Number(id)] ?? 0))
  note(CHARGE, (next.charges ?? 0) - (prev.charges ?? 0))
  return out
}

export const emptyDelta = (d: InventoryDelta): boolean => !d.compiler && !Object.keys(d.add).length && !Object.keys(d.spend).length

/** `delta` on device `id`'s entry, at `nowS`: only ever raising its numbers. The Compiler's date the earlier of `madeAt` and what was there. */
export function withDelta(r: InventoryRecord, id: string, delta: InventoryDelta, nowS: number, madeAt: number = nowS): InventoryRecord {
  const dev = r.devices[id] ?? emptyDevice()
  const a = { ...dev.a }
  const s = { ...dev.s }
  for (const [k, n] of Object.entries(delta.add)) if (isItem(k) && n > 0) a[k] = (a[k] ?? 0) + n
  for (const [k, n] of Object.entries(delta.spend)) if (isItem(k) && n > 0) s[k] = (s[k] ?? 0) + n
  const tools = delta.compiler ? { ...r.tools, [COMPILER]: Math.min(r.tools[COMPILER] ?? madeAt, madeAt) } : r.tools
  return { ...r, devices: { ...r.devices, [id]: { ...dev, a, s, u: Math.max(dev.u, nowS) } }, tools }
}

/** What a device held before it ever synced, as its first gains (the Compiler, made by hand, with it). */
export function deltaFromInventory(inv: Inventory): InventoryDelta {
  return deltaOf({ counts: {}, hotbar: [], slot: 0 }, inv)
}

/**
 * The inventory as the record says: each block kind's count and the charges
 * from the totals (0 shown for a debt), the Compiler in slot 1 once any device
 * made it. The hotbar and the chosen slot stay this device's own: a kind newly
 * held takes the first empty slot (as carrying one does), and one gone keeps
 * its slot (as placing the last one does). The same inventory back when
 * nothing changes.
 */
export function inventoryFrom(inv: Inventory, r: InventoryRecord): Inventory {
  const totals = totalsOf(r)
  const counts: Record<number, number> = {}
  for (const k of Object.keys(totals)) {
    if (!BLOCK_KEY.test(k) || Number(k) >= 255) continue
    const n = heldOf(totals, k)
    if (n > 0) counts[Number(k)] = n
  }
  let hotbar = inv.hotbar
  for (const id of Object.keys(counts).map(Number).sort((x, y) => x - y)) {
    // Only a kind newly held: one taken off the bar by hand stays off (the hotbar is this device's own).
    if ((inv.counts[id] ?? 0) > 0 || hotbar.includes(id)) continue
    const free = hotbar.indexOf(0)
    if (free < 0 || free >= HOTBAR_SLOTS) continue
    hotbar = [...hotbar]
    hotbar[free] = id
  }
  const sameCounts = Object.keys(counts).length === Object.keys(inv.counts).length && Object.entries(counts).every(([k, n]) => inv.counts[Number(k)] === n)
  let out: Inventory = sameCounts && hotbar === inv.hotbar ? inv : { ...inv, counts: sameCounts ? inv.counts : counts, hotbar }
  if (r.tools[COMPILER] !== undefined && out.compiler !== 'made') out = withCompiler(out, 'made')
  // The charges once any device had any, or this one shows them: their slot is theirs for good (terrainDb.ts withCharges).
  if (out.charges !== undefined || knowsItem(r, CHARGE)) out = withCharges(out, heldOf(totals, CHARGE))
  return out
}

/**
 * After a change made here: the items it touched shown as the totals say
 * (a gain while in debt pays the debt and shows 0), everything else as it is.
 * The same inventory back when the totals agree.
 */
export function heldAfter(next: Inventory, r: InventoryRecord, delta: InventoryDelta): Inventory {
  const totals = totalsOf(r)
  let out = next
  for (const k of new Set([...Object.keys(delta.add), ...Object.keys(delta.spend)])) {
    if (k === CHARGE) {
      if (out.charges !== undefined && out.charges !== heldOf(totals, CHARGE)) out = withCharges(out, heldOf(totals, CHARGE))
      continue
    }
    const id = Number(k)
    const n = heldOf(totals, k)
    if ((out.counts[id] ?? 0) === n) continue
    const counts = { ...out.counts }
    if (n > 0) counts[id] = n
    else delete counts[id]
    out = { ...out, counts }
  }
  return out
}

// -- the event -----------------------------------------------------------------

/** The record's text before sealing: its JSON, deflated, base64. */
export function encodeRecord(r: InventoryRecord): string {
  // Carried fields first, so this version's own always stand.
  const devices = Object.fromEntries(Object.keys(r.devices).sort().map((id) => {
    const { x, ...d } = r.devices[id]
    return [id, { ...x, ...d }]
  }))
  return toBase64(deflateSync(strToU8(JSON.stringify({ ...r.x, v: 1, devices, tools: r.tools, ...(r.retired ? { retired: r.retired } : {}) })), { level: 9 }))
}

/** The record's text, read back. Throws when it is not an inventory record at all. */
export function decodeRecord(text: string): InventoryRecord {
  const raw = JSON.parse(strFromU8(inflateSync(fromBase64(text)))) as { v?: unknown }
  if (raw.v !== 1) throw new Error('not an inventory record this client reads')
  return validRecord(raw)
}

export class InventoryTooLarge extends Error {
  constructor() { super('Your inventory is too large to save to the relay.') }
}

/**
 * The record's text to write, and the record it says: past RETIRE_AT, the
 * idlest devices folded first into `folder`'s entry (the device writing).
 * Throws only when even then it is past MAX_RECORD_CHARS.
 */
export function planRecord(r: InventoryRecord, folder = '', nowS = Math.floor(Date.now() / 1000)): { text: string; rec: InventoryRecord } {
  let rec = r
  let text = encodeRecord(rec)
  if (text.length > RETIRE_AT) { rec = foldIdle(rec, folder, nowS); text = encodeRecord(rec) }
  if (text.length > MAX_RECORD_CHARS) throw new InventoryTooLarge()
  return { text, rec }
}

/** The record's event, unsigned. Only the `d`: nothing else about it is public. */
export function recordTemplate(content: string, createdAt: number): EventTemplate {
  return { kind: INVENTORY_KIND, created_at: createdAt, tags: [['d', INVENTORY_D]], content }
}

/** The newest record event of this author's (a replaceable event: the newest, ties to the lowest id), or null. */
export function newestRecord(events: readonly NostrEvent[], me: string): NostrEvent | null {
  let out: NostrEvent | null = null
  for (const ev of events) {
    if (ev.pubkey !== me || ev.kind !== INVENTORY_KIND) continue
    if (ev.tags.find((t) => t[0] === 'd')?.[1] !== INVENTORY_D) continue
    if (!out || ev.created_at > out.created_at || (ev.created_at === out.created_at && ev.id < out.id)) out = ev
  }
  return out
}
