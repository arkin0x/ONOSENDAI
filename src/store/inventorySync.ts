/**
 * inventorySync.ts: your TERRAIN inventory (the blocks by kind, the Compiler,
 * the Quarry Charges) saved to the relay, so every device signed in as you
 * holds the same (owner, 2026-11-28). The record, its format and its merge
 * are lib/inventoryRecord.ts; this is what a change records, how the record
 * meets TERRAIN's inventory, and when it is read and written. It follows
 * MINING's sync (store/miningStats.ts) step for step.
 *
 * ON THIS DEVICE FIRST. The record is kept per identity in IndexedDB
 * (lib/kvStore.ts, `onosendai:inventory:<pubkey>`; owner, 2026-11-19: all
 * local data per npub, and switching never deletes), with this device's
 * random id for that identity. TERRAIN's inventory (lib/terrain/terrainDb.ts)
 * keeps the hotbar and the chosen slot; its counts are the record's totals.
 *   - Every change TERRAIN saves (useTerrain saveInventory, a Quarry drop
 *     collected) is recorded at once as this device's gains and spends
 *     (noteInventory), whether or not sync is on, LIVE or LOCAL, in a
 *     tutorial run or not: they are real blocks, and they sync later.
 *   - Only once the field's saved inventory is read (#960's fieldLoaded): a
 *     change before that is the field before's, and the read overwrites it.
 *   - The first time a device's field loads for an identity, what it already
 *     held becomes its first gains (MIGRATION), once.
 *   - A merge that brings in another device's numbers puts the new totals in
 *     the bag (onInventoryMerged), the hotbar left as it is. Every change made
 *     here is in the record before any merge sees it, and the merge loses
 *     nothing, so a read landing mid-play never overwrites a change.
 *
 * TWO TABS, ONE DEVICE (review of #972). Every tab of a device shares its
 * device id, so two tabs raising "their own" numbers from their own copies
 * would write over each other. So the stored record is only ever changed in
 * one step (kvStore kvUpdate: a Web Lock, and one IndexedDB transaction):
 * each change is a function of the record as stored at that moment, never of
 * this tab's copy. This tab shows the stored record with its own changes not
 * yet stored applied on top (`pending`), so the bag answers at once. The
 * throttle's times live in the same record, and a write runs under a Web
 * Lock per identity that reads them again first, so the device's tabs ask
 * the signer once between them, not once each.
 *
 * NEVER COUNTED TWICE (review of #972). TERRAIN's inventory row keeps this
 * device's own entry beside the counts (`own`). It is the mark that the bag
 * is already counted: if the sync record is lost (cleared, or this load is
 * kvStore's `blind`), the entry comes back under its own id, never migrated
 * again under a new one, and the bag stays as kept until the relay answers.
 * The entry also brings back a change the record missed. While `blind`,
 * nothing is migrated and nothing is written to the relay.
 *
 * THE SIGNER'S COST. A remote signer (Amber on a tablet) asks for every
 * signature, and the inventory changes with every block mined, so:
 *   - a change marks the record dirty, and a dirty record is written at most
 *     once every WRITE_EVERY_MS (10 min), QUIET_MS after the last change;
 *   - the page going hidden or unloading writes when dirty, no sooner than
 *     HIDE_FLOOR_MS (10 min) after the last try;
 *   - the Compiler made or Quarry Charges gained (rare, and what a player
 *     would miss most) writes sooner: OWN_QUIET_MS after, no sooner than
 *     OWN_FLOOR_MS (1 min) after the last try; a try that fails falls back to
 *     the 10 minutes until the next such change, so a refusing signer is not
 *     asked every minute;
 *   - reads (never a signature) on load, when the field is ready, when the
 *     page comes back into view or focus, and when the bag opens, no more
 *     than once a READ_FLOOR_MS.
 * So six signatures an hour, plus one for each Compiler made or compile; a
 * write that loses a race to another device asks the signer again at most twice. One
 * encrypt only the first time ever (to wrap a new record key). A load costs
 * one decrypt, at its first read of a record.
 *
 * WRITING. Every write reads the relays first and merges. Nothing is written:
 *   - in LOCAL (nothing is read then either);
 *   - while a tutorial run is going (nor read: the run's bag stays as it is);
 *   - while kvStore runs `blind` (this load cannot see the stored record);
 *   - when the canonical relay did not answer, or the record on it did not
 *     open with your signer;
 *   - with Settings' "Sync inventory" off, or a signer without NIP-44.
 * After signing, the relays are read again, and if another device wrote
 * meanwhile, nothing is sent and the sync runs again. A read that finds the
 * relay behind on this device's own entry marks it dirty again.
 */

import { create } from 'zustand'
import { verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from '../lib/events'
import { kvMode, kvStorage, kvUpdate } from '../lib/kvStore'
import {
  INVENTORY_D, INVENTORY_KIND, collectedKinds, decodeRecord, deltaFromInventory, deltaOf, emptyDelta, emptyRecord, heldAfter, inventoryFrom, isDeviceId, isRetired,
  mergeRecords, newDeviceId, newRecordKey, newestRecord, openRecord, planRecord, recordContent, recordTemplate, sameRecord, sealRecord, validRecord, withDelta,
  type DeviceInventory, type InventoryDelta, type InventoryRecord,
} from '../lib/inventoryRecord'
import { emptyInventory, type Inventory, type OwnEntry } from '../lib/terrain/terrainDb'
import type { PublishResult } from '../lib/relay'

/** At most one write in this long, however much changes. */
export const WRITE_EVERY_MS = 10 * 60_000
/** A write waits this long after a change, so a burst of mining is one write. */
export const QUIET_MS = 20_000
/** After a sync that did not write (the relay did not answer, a refusal), the next waits at least this long. */
export const RETRY_MS = 2 * 60_000
/** A write because the page was hidden waits at least this long after the last try. */
export const HIDE_FLOOR_MS = WRITE_EVERY_MS
/** The Compiler made or charges gained: written this long after, */
export const OWN_QUIET_MS = 5_000
/** and no sooner than this after the last try. */
export const OWN_FLOOR_MS = 60_000
/** Reads (never writes) at most this often. */
export const READ_FLOOR_MS = 60_000
/** The furthest past this device's clock an event is dated (as MINING's). */
export const MAX_AHEAD_S = 60
/** How long after a write it is read back, in case another device wrote over it. */
const VERIFY_MS = 9000
/** A write that lost a race to another device's is tried again at most this many times. */
export const RACE_RETRIES = 2

const SETTING_KEY = 'onosendai:inventory-sync'
export const INVENTORY_PREFIX = 'onosendai:inventory:'
const recordKey = (me: string): string => `${INVENTORY_PREFIX}${me}`
/** An identity that can sync: a pubkey (TERRAIN's field with no identity is 'local'). */
const isPubkey = (me: string): boolean => /^[0-9a-f]{64}$/.test(me)

/** Signer's self-to-self NIP-44, as useCyberspace selfCrypto gives it. */
export interface SelfNip44 {
  nip44Encrypt?: (plaintext: string) => Promise<string>
  nip44Decrypt?: (payload: string) => Promise<string>
}

/** What the sync needs from the outside world; replaced in tests (setInventoryDeps). */
export interface InventoryDeps {
  self: () => string
  live: () => boolean
  tutorial: (me: string) => boolean
  crypto: () => SelfNip44
  fetch: (filter: Filter) => Promise<{ events: NostrEvent[]; trouble: boolean }>
  sign: (template: EventTemplate) => Promise<NostrEvent>
  publish: (event: NostrEvent) => Promise<PublishResult>
  /** Milliseconds. */
  now: () => number
  /** This tab's copy of the stored records, read at once (kvStore's memory). */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  /** A stored record changed in one step no other tab interleaves with, from the record as stored (kvStore kvUpdate). */
  update: (key: string, fn: (stored: string | null) => string | null) => Promise<string | null>
  /** A Web Lock held across the device's tabs while `fn` runs (navigator.locks), or `fn` run as it is where there are none. */
  lock: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  /** kvStore runs `blind`: this load cannot see what the database holds. */
  blind: () => boolean
  /** The device's own switch (localStorage, like MINING's). */
  prefs: Pick<Storage, 'getItem' | 'setItem'> | null
  verify: (ev: NostrEvent) => boolean
  /** When this identity made the Compiler, if MINING knows (unix seconds): the crafted date a migrated Compiler keeps. */
  crafted: (me: string) => number | undefined
}

/** This identity's side, as kept on this device. */
export interface InventoryLocal {
  v: 1
  /** This device's id for this identity. */
  device: string
  /** Everything known: this device's entry (only it raises it) and every other device's as last read. */
  rec: InventoryRecord
  /** What this device held before it ever synced is in its entry (MIGRATION). */
  migrated: boolean
  /** This device's entry came back from TERRAIN's row after the record was lost: the bag stays as kept until the relay answers. */
  restored: boolean
  /** Bumped on every change here. */
  real: number
  /** The `real` the relay holds: dirty while it is behind `real`. */
  syncedReal: number
  /** Bumped when the Compiler is made or charges are gained. */
  own: number
  /** The `own` the relay holds. */
  syncedOwn: number
  /** The `own` when a write was last tried: one fast try per change of it. */
  ownTried: number
  /** When a write was last tried (ms): the throttle, shared by the device's tabs. */
  triedAt: number
  /** When the relay last answered a read or took a write (ms), or 0. */
  syncedAt: number
  /** created_at of this device's last write: a read older than it is a stale copy. */
  wroteAt: number
}

export type InventorySyncStatus = 'idle' | 'syncing' | 'synced' | 'off' | 'local' | 'unsupported' | 'error'

interface InventorySyncState {
  enabled: boolean
  status: InventorySyncStatus
  note: string | null
  /** Ticks on every change, so the bag draws again. */
  flips: number
  setEnabled: (on: boolean) => void
}

function loadEnabled(prefs: InventoryDeps['prefs']): boolean {
  try { return prefs?.getItem(SETTING_KEY) !== '0' } catch { return true }
}

export const useInventorySync = create<InventorySyncState>((set) => ({
  enabled: true,
  status: 'idle',
  note: null,
  flips: 0,
  setEnabled: (on) => {
    try { deps.prefs?.setItem(SETTING_KEY, on ? '1' : '0') } catch { /* private mode */ }
    set({ enabled: on, status: on ? 'idle' : 'off', note: null })
    if (on) { failed.clear(); readAt = 0; nudgeInventory('read'); if (isDirty(deps.self())) schedule() }
    else cancelTimer()
  },
}))

function flip(): void { useInventorySync.setState((s) => ({ flips: s.flips + 1 })) }

// -- this device's side --------------------------------------------------------

type Change = (l: InventoryLocal) => InventoryLocal

function fresh(): InventoryLocal {
  return { v: 1, device: newDeviceId(), rec: emptyRecord(), migrated: false, restored: false, real: 0, syncedReal: 0, own: 0, syncedOwn: 0, ownTried: 0, triedAt: 0, syncedAt: 0, wroteAt: 0 }
}

function parse(raw: string | null): InventoryLocal | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<InventoryLocal>
    if (!isDeviceId(v.device)) return null
    const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0)
    return {
      v: 1, device: v.device, rec: validRecord(v.rec), migrated: v.migrated === true, restored: v.restored === true, real: num(v.real), syncedReal: num(v.syncedReal),
      own: num(v.own), syncedOwn: num(v.syncedOwn), ownTried: num(v.ownTried), triedAt: num(v.triedAt), syncedAt: num(v.syncedAt), wroteAt: num(v.wroteAt),
    }
  } catch { return null }
}

/** The stored record as this tab last read it, parsed once per text. */
const stored = new Map<string, { raw: string | null; local: InventoryLocal | null }>()
/** An identity with nothing stored yet: one fresh record (one device id) until the first change stores it. */
const unstored = new Map<string, InventoryLocal>()
/** This tab's changes not stored yet, in order, per identity. */
const pending = new Map<string, Change[]>()
/** The stored record with them applied, while it and they are the same. */
const view = new Map<string, { base: InventoryLocal; n: number; local: InventoryLocal }>()
/** Each identity's stores, one after another. */
const chains = new Map<string, Promise<unknown>>()

function storedFor(me: string, D: InventoryDeps): InventoryLocal | null {
  let raw: string | null = null
  try { raw = D.storage?.getItem(recordKey(me)) ?? null } catch { /* unreadable: as new */ }
  const was = stored.get(me)
  if (was && was.raw === raw) return was.local
  const local = parse(raw)
  stored.set(me, { raw, local })
  return local
}

function baseFor(me: string, D: InventoryDeps): InventoryLocal {
  const s = storedFor(me, D)
  if (s) return s
  let u = unstored.get(me)
  if (!u) { u = fresh(); unstored.set(me, u) }
  return u
}

/** This identity's side: the stored record with this tab's changes not stored yet applied. The third argument is kept for callers; nothing is stored by reading. */
export function localFor(me: string, D: InventoryDeps = deps, _create = true): InventoryLocal {
  const base = baseFor(me, D)
  const list = pending.get(me)
  if (!list?.length) return base
  const v = view.get(me)
  if (v && v.base === base && v.n === list.length) return v.local
  const local = list.reduce((l, f) => f(l), base)
  view.set(me, { base, n: list.length, local })
  return local
}

/**
 * Change this identity's record: shown at once, and stored in one step from
 * the record as stored then (TWO TABS above). Resolves once stored. A store
 * that fails keeps the change in this tab and tries it again with the next.
 */
function change(me: string, f: Change, D: InventoryDeps = deps): Promise<void> {
  const list = pending.get(me) ?? []
  list.push(f)
  pending.set(me, list)
  flip()
  const run = async (): Promise<void> => {
    const seen = stored.get(me)?.raw ?? null
    let other = false
    let unread: string | null = null
    const fallback = baseFor(me, D)
    // Every change still waiting (a store that failed before, and this one), applied to the record as stored now.
    const upto = list.indexOf(f) + 1
    const todo = list.slice(0, upto)
    await D.update(recordKey(me), (raw) => {
      other = raw !== seen
      const read = parse(raw)
      // A record that does not read is kept aside, never written over.
      if (raw && !read) unread = raw
      const start = read ?? (raw === null ? { ...fallback } : fresh())
      return JSON.stringify(todo.reduce((l, g) => g(l), start))
    })
    if (unread) try { D.storage?.setItem(`${recordKey(me)}:unread:${D.now()}`, unread) } catch { /* full */ }
    list.splice(0, upto)
    unstored.delete(me)
    view.delete(me)
    flip()
    // Another tab changed it meanwhile: its numbers in this tab's bag too.
    if (other) tellMerged(me)
  }
  const p = (chains.get(me) ?? Promise.resolve()).then(run, run)
  chains.set(me, p.catch(() => undefined))
  return p.catch(() => undefined)
}

/** Every store asked for so far has landed (tests, and before a write). */
export async function inventorySettled(me?: string): Promise<void> {
  const list = me ? [chains.get(me)] : [...chains.values()]
  await Promise.all(list)
}

/** The record as stored now, read in one step (another tab may have written since this one read it). */
function refresh(me: string, D: InventoryDeps): Promise<void> {
  return change(me, (l) => l, D)
}

/** Whether this identity has changes the relay does not hold yet. */
export function isDirty(me: string, D: InventoryDeps = deps): boolean {
  if (!me || !isPubkey(me)) return false
  const l = localFor(me, D, false)
  return l.real > l.syncedReal
}

/** Whether the Compiler made or charges gained wait for a write, and have not had their fast try yet. */
function ownDue(l: InventoryLocal): boolean { return l.own > l.syncedOwn && l.own > l.ownTried }

/** Too soon after the last try (by any tab of this device) for a throttled write. */
function tooSoon(l: InventoryLocal, now: number): boolean {
  return now - l.triedAt < (ownDue(l) ? OWN_FLOOR_MS : WRITE_EVERY_MS)
}

/** Whether the record says what the bag holds (migrated, and not waiting on the relay after a restore). */
const drives = (l: InventoryLocal): boolean => l.migrated && !l.restored

/** Everything known for this identity: every device's numbers. */
export function inventoryRecordFor(me: string): InventoryRecord {
  return me && isPubkey(me) ? localFor(me, deps, false).rec : emptyRecord()
}

/** Every block kind this identity ever collected, on any device (the game's own blueprints are granted by it: gameBlueprint.ts). */
export function collectedFor(me: string): Record<number, number> {
  return collectedKinds(inventoryRecordFor(me))
}

/** Listeners told when a merge changed an identity's record: TERRAIN puts the new totals in the bag (useTerrain). */
const merged = new Set<(owner: string) => void>()
export function onInventoryMerged(f: (owner: string) => void): () => void {
  merged.add(f)
  return () => { merged.delete(f) }
}
function tellMerged(me: string): void {
  for (const f of merged) { try { f(me) } catch { /* one listener failing never stops the sync */ } }
}

/** `delta` on this device's entry: only ever raising its numbers. */
function recordInto(l: InventoryLocal, delta: InventoryDelta, nowS: number, madeAt?: number): InventoryLocal {
  const important = delta.compiler || (delta.add.charge ?? 0) > 0
  return { ...l, rec: withDelta(l.rec, l.device, delta, nowS, madeAt ?? nowS), real: l.real + 1, own: l.own + (important ? 1 : 0) }
}

const sameCounts = (a: Record<string, number>, b: Record<string, number>): boolean => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, n]) => b[k] === n)

/** The inventory carrying this device's entry (NEVER COUNTED TWICE above), once it has one; the same inventory when it already does. */
function withOwn(l: InventoryLocal, inv: Inventory): Inventory {
  if (!l.migrated) return inv
  const e: DeviceInventory = l.rec.devices[l.device] ?? { a: {}, s: {}, u: 0 }
  const was = inv.own
  if (was && was.d === l.device && was.u === e.u && sameCounts(was.a, e.a) && sameCounts(was.s, e.s)) return inv
  const own: OwnEntry = { d: l.device, a: { ...e.a }, s: { ...e.s }, u: e.u }
  return { ...inv, own }
}

/**
 * A change TERRAIN saved, from `prev` to `next`, for the field's `owner`:
 * recorded as this device's gains and spends, and the inventory to keep back,
 * what it touched shown as the record's totals (a debt shows 0), carrying
 * this device's entry. Before this device migrated (a field kept in memory
 * only), it records and keeps `next` as it is.
 */
export function noteInventory(owner: string, prev: Inventory, next: Inventory): Inventory {
  const D = deps
  if (!isPubkey(owner)) return next
  const delta = deltaOf(prev, next)
  if (emptyDelta(delta)) return next
  const nowS = Math.floor(D.now() / 1000)
  void change(owner, (l) => recordInto(l, delta, nowS), D)
  const important = delta.compiler || (delta.add.charge ?? 0) > 0
  if (useInventorySync.getState().enabled && owner === D.self()) schedule(important ? OWN_QUIET_MS : QUIET_MS)
  const local = localFor(owner, D)
  return withOwn(local, drives(local) ? heldAfter(next, local.rec, delta) : next)
}

/**
 * The field's saved inventory is read (`kept`), or could not be (null: no
 * storage on this device). The first time for this device and identity, what
 * it holds becomes its first gains (MIGRATION, once). A row carrying this
 * device's entry is never migrated again (NEVER COUNTED TWICE above): the
 * entry comes back instead. Returns the inventory to show, its counts the
 * record's totals; null to leave the inventory as it is (no storage, not
 * migrated).
 */
export function loadedInventory(owner: string, kept: Inventory | null): Inventory | null {
  const D = deps
  if (!isPubkey(owner)) return kept
  const l0 = localFor(owner, D)
  if (!kept) return drives(l0) ? withOwn(l0, inventoryFrom(emptyInventory(), l0.rec)) : null
  const own = kept.own && isDeviceId(kept.own.d) ? kept.own : null
  const nowS = Math.floor(D.now() / 1000)
  const crafted = D.crafted(owner)
  if (own && (!l0.migrated || own.d === l0.device)) {
    const entry: InventoryRecord = { devices: { [own.d]: { a: own.a, s: own.s, u: own.u } }, tools: kept.compiler === 'made' ? { compiler: Math.min(crafted ?? nowS, nowS) } : {} }
    void change(owner, (l) => {
      // The record already knows this device: the row's entry only brings back what a lost store missed.
      if (l.migrated) return l.device === own.d ? { ...l, rec: mergeRecords(l.rec, entry) } : l
      // The record was lost (or this load cannot see it): the entry back under its own id, and the bag as kept until the relay answers.
      return { ...l, device: own.d, rec: mergeRecords(l.rec, entry), migrated: true, restored: true }
    }, D)
  } else if (!l0.migrated) {
    // Nothing migrated while this load cannot see the stored record: it may hold this device's entry already.
    if (D.blind()) return kept
    const delta = deltaFromInventory(kept)
    void change(owner, (l) => {
      // Another tab migrated first: counted once.
      if (l.migrated) return l
      return { ...(emptyDelta(delta) ? l : recordInto(l, delta, nowS, crafted)), migrated: true }
    }, D)
    if (!emptyDelta(delta) && useInventorySync.getState().enabled && owner === D.self()) schedule()
  }
  const l = localFor(owner, D)
  if (!l.migrated) return kept
  return withOwn(l, drives(l) ? inventoryFrom(kept, l.rec) : kept)
}

/** The inventory with the record's totals, for a field already loaded; unchanged before this device migrated (or while a restore waits on the relay). */
export function syncedInventory(owner: string, inv: Inventory): Inventory {
  if (!isPubkey(owner)) return inv
  const l = localFor(owner, deps, false)
  if (!l.migrated) return inv
  return withOwn(l, drives(l) ? inventoryFrom(inv, l.rec) : inv)
}

// -- the relay's side ------------------------------------------------------------

/** Record keys opened this load, by their wrapped form, for one identity. */
let opened: { me: string; keys: Map<string, Uint8Array> } = { me: '', keys: new Map() }
/** Wrapped keys the signer refused this load: not asked again until the switch is turned on again. */
const failed = new Set<string>()
/** The record key wrapped for a first save this load: used again while that save keeps failing. */
let made: { me: string; wrapped: string; key: Uint8Array } | null = null
/** Relay copies dated past this device's clock already written under once this load. */
const aheadOf = new Set<string>()

function keysFor(me: string): Map<string, Uint8Array> {
  if (opened.me !== me) { opened = { me, keys: new Map() }; failed.clear(); aheadOf.clear(); made = null }
  return opened.keys
}

const FILTER = (me: string): Filter => ({ kinds: [INVENTORY_KIND], authors: [me], '#d': [INVENTORY_D] })

const NOT_ANSWERED = 'The relay did not answer, so your inventory was not synced this time.'
const NOT_OPENED = 'Your saved inventory did not open with your signer, so it was left as it is.'
const STALE = 'The relay answered with an older copy of your inventory, so it was left as it is for now.'
const NO_NIP44 = 'Your signer has no NIP-44 encryption, so your inventory stays on this device.'
const AHEAD = 'Your inventory on the relay is dated ahead of this device\'s clock, so this device\'s changes wait for your next change to try again.'
const STALE_PATIENCE_S = 86_400

interface RemoteRead {
  rec: InventoryRecord
  id: string | null
  createdAt: number
  key: { wrapped: string; key: Uint8Array } | null
  why: string | null
  unsupported: boolean
  trouble: boolean
}

async function readRemote(me: string, crypto: SelfNip44, D: InventoryDeps): Promise<RemoteRead> {
  const { events, trouble } = await D.fetch(FILTER(me))
  const ev = newestRecord(events.filter((e) => D.verify(e)), me)
  const out: RemoteRead = { rec: emptyRecord(), id: ev?.id ?? null, createdAt: ev?.created_at ?? 0, key: null, why: null, unsupported: false, trouble }
  if (!ev) return out
  const c = recordContent(ev.content)
  if (!c) return { ...out, why: NOT_OPENED }
  const keys = keysFor(me)
  let rk = keys.get(c.wrapped)
  if (!rk) {
    if (failed.has(c.wrapped)) return { ...out, why: NOT_OPENED }
    try {
      if (!crypto.nip44Decrypt) throw new Error('no NIP-44')
      const hex = (await crypto.nip44Decrypt(c.wrapped)).trim().toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('not a record key')
      rk = hexToBytes(hex)
      keys.set(c.wrapped, rk)
    } catch (err) {
      failed.add(c.wrapped)
      return { ...out, why: NOT_OPENED, unsupported: /no NIP-44/i.test(err instanceof Error ? err.message : String(err)) }
    }
  }
  try {
    out.rec = decodeRecord(openRecord(c.body, rk))
    out.key = { wrapped: c.wrapped, key: rk }
  } catch { return { ...out, why: NOT_OPENED } }
  return out
}

type Outcome = { wrote: boolean; raced?: boolean }

function mayWrite(D: InventoryDeps, me: string): boolean {
  return D.self() === me && D.live() && !D.tutorial(me) && !D.blind() && useInventorySync.getState().enabled
}

const sameDevice = (a: DeviceInventory | undefined, b: DeviceInventory | undefined): boolean =>
  (!a && !b) || (!!a && !!b && sameCounts(a.a, b.a) && sameCounts(a.s, b.s))

/** The relay's record folded into this device's (a function of the record as stored: TWO TABS above). */
function mergeIn(remote: InventoryRecord, now: number): Change {
  return (l) => {
    const rec = mergeRecords(l.rec, remote)
    // Folded into `retired` by another device (it was idle long enough): a new id, its entry afresh (RETIRED DEVICES, lib/inventoryRecord.ts).
    const device = isRetired(rec, l.device) ? newDeviceId() : l.device
    const out: InventoryLocal = { ...l, device, rec, syncedAt: now, restored: false, migrated: l.migrated || l.restored }
    if (sameRecord(rec, remote)) return { ...out, syncedReal: l.real, syncedOwn: l.own }
    // The relay behind on this device's own entry (another device wrote over its write, or a restore): dirty again.
    if (!sameDevice(rec.devices[device], remote.devices[device]) && l.real <= l.syncedReal) return { ...out, real: l.syncedReal + 1 }
    return out
  }
}

/** `throttled`: a write the timer or the page going asked for, held to the throttle by the record as stored (another tab may have just written). */
async function syncOnce(D: InventoryDeps, write: boolean, throttled: boolean): Promise<Outcome> {
  const me = D.self()
  const none: Outcome = { wrote: false }
  if (!me || !isPubkey(me)) return none
  const done = (status: InventorySyncStatus, note: string | null = null): Outcome => { useInventorySync.setState({ status, note }); return none }
  if (!useInventorySync.getState().enabled) return done('off')
  if (!D.live()) return done('local')
  if (D.tutorial(me)) return done('idle')
  const crypto = D.crypto()
  if (!crypto.nip44Decrypt) return done('unsupported', NO_NIP44)
  if (write) {
    await refresh(me, D)
    if (throttled && tooSoon(localFor(me, D), D.now())) write = false
  }
  useInventorySync.setState({ status: 'syncing' })
  const remote = await readRemote(me, crypto, D)
  if (D.self() !== me) return none
  if (remote.unsupported) return done('unsupported', NO_NIP44)
  if (remote.trouble) return done('error', NOT_ANSWERED)
  if (remote.why) return done('error', remote.why)
  // Every other device's numbers, folded in, into the record as stored: a change made meanwhile, here or in another tab, is in it.
  const before = localFor(me, D)
  await change(me, mergeIn(remote.rec, D.now()), D)
  let local = localFor(me, D)
  if (!sameRecord(local.rec, before.rec) || before.restored) tellMerged(me)
  if (sameRecord(local.rec, remote.rec)) return done('synced')
  if (local.real <= local.syncedReal) return done('synced')
  if (!write || !mayWrite(D, me)) return done('idle')
  const nowS = Math.floor(D.now() / 1000)
  const ahead = remote.createdAt + 1 > nowS + MAX_AHEAD_S
  if (ahead && remote.id && aheadOf.has(remote.id)) return done('error', AHEAD)
  if (remote.createdAt < local.wroteAt && D.now() / 1000 - local.wroteAt < STALE_PATIENCE_S) return done('error', STALE)
  let plan: { text: string; rec: InventoryRecord }
  try { plan = planRecord(local.rec, local.device, nowS) } catch (err) { return done('error', err instanceof Error ? err.message : String(err)) }
  // The idlest devices folded to fit (RETIRED DEVICES): kept that way here too.
  const folded = plan.rec !== local.rec ? plan.rec : null
  const real = local.real
  const own = local.own
  // The throttle counts tries, so a refusal is not asked again until the next window (and the fast one is spent).
  const triedAt = D.now()
  await change(me, (l) => ({ ...l, ...(folded ? { rec: mergeRecords(l.rec, folded) } : {}), triedAt, ownTried: Math.max(l.ownTried, own) }), D)
  local = localFor(me, D)
  let key = remote.key
  if (!key && made && made.me === me) key = { wrapped: made.wrapped, key: made.key }
  if (!key) {
    if (!crypto.nip44Encrypt) return done('unsupported', NO_NIP44)
    const freshKey = newRecordKey()
    let wrapped: string
    try { wrapped = await crypto.nip44Encrypt(bytesToHex(freshKey)) } catch (err) {
      return /no NIP-44/i.test(err instanceof Error ? err.message : String(err)) ? done('unsupported', NO_NIP44) : done('error', `Your signer did not encrypt your inventory: ${err instanceof Error ? err.message : String(err)}`)
    }
    key = { wrapped, key: freshKey }
    keysFor(me).set(wrapped, freshKey)
    made = { me, wrapped, key: freshKey }
  }
  if (!mayWrite(D, me)) return none
  const createdAt = ahead ? nowS : Math.max(nowS, remote.createdAt + 1)
  if (ahead && remote.id) aheadOf.add(remote.id)
  let ev: NostrEvent
  try { ev = await D.sign(recordTemplate(sealRecord(plan.text, key.key, key.wrapped), createdAt)) } catch (err) {
    return done('error', `Your inventory was not signed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (ev.pubkey !== me || !mayWrite(D, me)) return none
  // A signer may take minutes: another device's write meanwhile means read, merge and sign again.
  const again = await D.fetch(FILTER(me))
  if (again.trouble) return done('error', NOT_ANSWERED)
  if ((newestRecord(again.events.filter((e) => D.verify(e)), me)?.id ?? null) !== remote.id) return { wrote: false, raced: true }
  if (!mayWrite(D, me)) return none
  const res = await D.publish(ev)
  if (!res.ok) return done('error', `Your inventory was not saved to the relay (${res.reason}).`)
  const syncedAt = D.now()
  await change(me, (l) => ({ ...l, syncedReal: Math.max(l.syncedReal, real), syncedOwn: Math.max(l.syncedOwn, own), syncedAt, wroteAt: ev.created_at }), D)
  useInventorySync.setState({ status: 'synced', note: null })
  return { wrote: true }
}

// -- when -----------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | null = null
let timerAt = 0
let verifyTimer: ReturnType<typeof setTimeout> | null = null
/** When a read was last asked for (ms), whatever came of it: the read floor. */
let readAt = 0

/**
 * One sync after any already running in this tab. `write` false only reads
 * (and folds in the other devices). A write runs under a Web Lock for the
 * identity, so the device's tabs write one at a time; `throttled` (the timer,
 * the page going) holds it to the throttle by the record as stored then.
 */
export function syncInventory(write = true, throttled = false): Promise<Outcome> {
  const D = deps
  const once = (): Promise<Outcome> => syncOnce(D, write, throttled).catch((err) => {
    useInventorySync.setState({ status: 'error', note: err instanceof Error ? err.message : String(err) })
    return { wrote: false }
  })
  const tries = async (): Promise<Outcome> => {
    let out = await once()
    for (let n = 0; out.raced && n < RACE_RETRIES; n++) out = await once()
    return out
  }
  const run = (): Promise<Outcome> => (write && D.self() ? D.lock(`onosendai:inventory-write:${D.self()}`, tries) : tries())
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p.then((out) => {
    if (out.wrote) {
      if (verifyTimer) clearTimeout(verifyTimer)
      verifyTimer = setTimeout(() => { verifyTimer = null; void syncInventory(false) }, VERIFY_MS)
    }
    if (isDirty(deps.self())) schedule(out.wrote ? 0 : RETRY_MS)
    return out
  })
}

function cancelTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
  timerAt = 0
}

/**
 * The next write, when there is something to write: `wait` after now (at
 * least QUIET_MS) and no sooner than WRITE_EVERY_MS after the last try; for
 * the Compiler made or charges gained, at least OWN_QUIET_MS and no sooner
 * than OWN_FLOOR_MS after it. Not in LOCAL: going LIVE schedules it.
 */
export function schedule(wait = QUIET_MS): void {
  const D = deps
  const me = D.self()
  if (!me || !useInventorySync.getState().enabled || !D.live() || !isDirty(me, D)) return
  const now = D.now()
  const l = localFor(me, D)
  const due = ownDue(l)
    ? Math.max(now + Math.max(wait, OWN_QUIET_MS), l.triedAt + OWN_FLOOR_MS)
    : Math.max(now + Math.max(wait, QUIET_MS), l.triedAt + WRITE_EVERY_MS)
  if (timer && timerAt <= due) return
  cancelTimer()
  timerAt = due
  timer = setTimeout(() => { timer = null; timerAt = 0; void syncInventory(true, true) }, due - now)
}

/**
 * The page is going (hidden or unloading): write now when dirty, no sooner
 * than HIDE_FLOOR_MS after the last try (OWN_FLOOR_MS for the Compiler or
 * charges). A read (on load, back in view or focus, the bag opened): fold in
 * the other devices, no more than once a READ_FLOOR_MS; never a write.
 */
export function nudgeInventory(why: 'hide' | 'read'): void {
  const D = deps
  const me = D.self()
  if (!me || !isPubkey(me) || !useInventorySync.getState().enabled || !D.live()) return
  const now = D.now()
  if (why === 'hide') {
    const l = localFor(me, D, false)
    if (l.real > l.syncedReal && now - l.triedAt >= (ownDue(l) ? OWN_FLOOR_MS : HIDE_FLOOR_MS)) { cancelTimer(); void syncInventory(true, true) }
    return
  }
  if (D.tutorial(me) || now - readAt < READ_FLOOR_MS) return
  readAt = now
  void syncInventory(false)
}

/** Another identity on screen: its own timer, if it has something to write, and a read of its record. */
export function identityChanged(): void {
  cancelTimer()
  readAt = 0
  useInventorySync.setState({ status: 'idle', note: null })
  flip()
  schedule()
  nudgeInventory('read')
}

// -- deps -----------------------------------------------------------------------

const ls = (): Storage | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null } }

/** A Web Lock across the device's tabs, where the browser has them. */
function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  return locks?.request ? locks.request(name, fn) as unknown as Promise<T> : fn()
}

/** `update` over a plain storage (tests, and storage handed in without one): read, change and write at once. */
function updateOver(storage: InventoryDeps['storage']): InventoryDeps['update'] {
  return async (key, fn) => {
    let raw: string | null = null
    try { raw = storage?.getItem(key) ?? null } catch { /* unreadable */ }
    const next = fn(raw)
    try { if (next === null) storage?.removeItem(key); else storage?.setItem(key, next) } catch { /* full: kept in this tab */ }
    return next
  }
}

const offline: InventoryDeps = {
  self: () => '',
  live: () => false,
  tutorial: () => false,
  crypto: () => ({}),
  fetch: async () => ({ events: [], trouble: true }),
  sign: async () => { throw new Error('no signer') },
  publish: async () => ({ ok: false, reason: 'not started' }),
  now: () => Date.now(),
  storage: kvStorage,
  update: kvUpdate,
  lock: webLock,
  blind: () => kvMode() === 'blind',
  prefs: ls(),
  verify: (ev) => verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]),
  crafted: () => undefined,
}

let deps: InventoryDeps = offline

/** Set the outside world (startInventorySync, and tests). Returns the previous deps. Storage handed in without `update` is changed through it directly. */
export function setInventoryDeps(next: Partial<InventoryDeps> | null): InventoryDeps {
  const prev = deps
  deps = next ? { ...offline, ...(next.storage !== undefined && !next.update ? { update: updateOver(next.storage) } : {}), ...next } : offline
  useInventorySync.setState({ enabled: loadEnabled(deps.prefs) })
  return prev
}

/** Tests only: forget keys opened, timers, the queue and the parse caches (a new load of the page). */
export function resetInventorySync(): void {
  opened = { me: '', keys: new Map() }
  failed.clear()
  aheadOf.clear()
  made = null
  stored.clear()
  unstored.clear()
  pending.clear()
  view.clear()
  chains.clear()
  cancelTimer()
  if (verifyTimer) clearTimeout(verifyTimer)
  verifyTimer = null
  readAt = 0
  queue = Promise.resolve()
  useInventorySync.setState({ status: 'idle', note: null, flips: 0 })
}

/** The bag's quiet line: synced, kept here, or failed, and a few words on why. */
export function inventorySyncLine(o: { me: string; enabled: boolean; live: boolean; status: InventorySyncStatus; syncedAt: number; note: string | null }): { synced: boolean; words: string; why: string } {
  const here = 'Saved on this device only'
  if (!o.me || !isPubkey(o.me)) return { synced: false, words: here, why: 'Sign in to sync it.' }
  if (!o.enabled) return { synced: false, words: here, why: 'Sync is off in Settings.' }
  if (!o.live) return { synced: false, words: here, why: 'Switch to LIVE to sync.' }
  if (o.status === 'unsupported') return { synced: false, words: here, why: o.note ?? 'Your signer cannot encrypt it.' }
  if (o.status === 'error') return { synced: false, words: 'Sync failed', why: o.note ?? 'The relay did not take it this time.' }
  if (o.syncedAt > 0) return { synced: true, words: 'Synced across your devices', why: `New changes save within ${WRITE_EVERY_MS / 60_000} min.` }
  return { synced: false, words: here, why: 'Not synced yet.' }
}
