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

export interface InventoryRecord {
  devices: Record<string, DeviceInventory>
  /** Tools owned, by name, with the earliest date any device recorded (unix seconds). */
  tools: Record<string, number>
  /** Any other top-level field, carried through. */
  x?: Extra
}

export function emptyRecord(): InventoryRecord { return { devices: {}, tools: {} } }
export function emptyDevice(): DeviceInventory { return { a: {}, s: {}, u: 0 } }

/** A block kind's id, 1 to 255, or a named item or tool. */
const BLOCK_KEY = /^(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])$/
const NAME_KEY = /^[a-z][a-z0-9_]{0,31}$/
/** The most items kept per device and number, and tools per record, so a record never swells. */
const MAX_ITEMS = 512
const RECORD_FIELDS = new Set(['v', 'devices', 'tools'])
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
  const x = mergeExtra(a.x, b.x)
  if (x) out.x = x
  return out
}

function canonical(r: InventoryRecord): string {
  const sorted = (o: Record<string, unknown> | undefined): Array<[string, unknown]> => (o ? Object.keys(o).sort().map((k) => [k, o[k]]) : [])
  const devices = Object.keys(r.devices).sort().map((id) => [id, sorted(r.devices[id].a), sorted(r.devices[id].s), r.devices[id].u, JSON.stringify(sorted(r.devices[id].x))])
  return JSON.stringify([devices, sorted(r.tools), JSON.stringify(sorted(r.x))])
}

/** Whether two records say the same thing. */
export function sameRecord(a: InventoryRecord, b: InventoryRecord): boolean { return canonical(a) === canonical(b) }

// -- what you hold -------------------------------------------------------------

/** Every item's sum over the devices: added less spent. Below zero is a debt (THE HONOR SYSTEM above). */
export function totalsOf(r: InventoryRecord): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of Object.values(r.devices)) {
    for (const [k, n] of Object.entries(d.a)) out[k] = (out[k] ?? 0) + n
    for (const [k, n] of Object.entries(d.s)) out[k] = (out[k] ?? 0) - n
  }
  return out
}

/** How many of an item you hold: never below 0, whatever the debt. */
export function heldOf(totals: Readonly<Record<string, number>>, item: string): number { return Math.max(0, totals[item] ?? 0) }

/** Whether any device ever added or spent the item. */
export function knowsItem(r: InventoryRecord, item: string): boolean {
  return Object.values(r.devices).some((d) => (d.a[item] ?? 0) > 0 || (d.s[item] ?? 0) > 0)
}

/** Every block kind ever collected, on any device, and how many: what the game's own blueprints are granted by (gameBlueprint.ts). */
export function collectedKinds(r: InventoryRecord): Record<number, number> {
  const out: Record<number, number> = {}
  for (const d of Object.values(r.devices)) for (const [k, n] of Object.entries(d.a)) if (BLOCK_KEY.test(k)) out[Number(k)] = (out[Number(k)] ?? 0) + n
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
  return toBase64(deflateSync(strToU8(JSON.stringify({ ...r.x, v: 1, devices, tools: r.tools })), { level: 9 }))
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

/** The record's text, checked against MAX_RECORD_CHARS. */
export function planRecord(r: InventoryRecord): string {
  const text = encodeRecord(r)
  if (text.length > MAX_RECORD_CHARS) throw new InventoryTooLarge()
  return text
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
