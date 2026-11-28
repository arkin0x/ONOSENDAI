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
 *     held becomes its first gains (MIGRATION), once: the mark is kept with the
 *     device id, so loading again never counts it twice.
 *   - A merge that brings in another device's numbers puts the new totals in
 *     the bag (onInventoryMerged), the hotbar left as it is. Every change made
 *     here is in the record before any merge sees it, and the merge loses
 *     nothing, so a read landing mid-play never overwrites a change.
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
 * One write is one sign, plus one encrypt only the first time ever (to wrap a
 * new record key). A load costs one decrypt, at its first read of a record.
 *
 * WRITING. Every write reads the relays first and merges. Nothing is written:
 *   - in LOCAL (nothing is read then either);
 *   - while a tutorial run is going (nor read: the run's bag stays as it is);
 *   - when the canonical relay did not answer, or the record on it did not
 *     open with your signer;
 *   - with Settings' "Sync inventory" off, or a signer without NIP-44.
 * After signing, the relays are read again, and if another device wrote
 * meanwhile, nothing is sent and the sync runs again.
 */

import { create } from 'zustand'
import { verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from '../lib/events'
import { kvStorage } from '../lib/kvStore'
import {
  INVENTORY_D, INVENTORY_KIND, collectedKinds, decodeRecord, deltaFromInventory, deltaOf, emptyDelta, emptyRecord, heldAfter, inventoryFrom, isDeviceId, mergeRecords,
  newDeviceId, newRecordKey, newestRecord, openRecord, planRecord, recordContent, recordTemplate, sameRecord, sealRecord, validRecord, withDelta,
  type InventoryDelta, type InventoryRecord,
} from '../lib/inventoryRecord'
import { emptyInventory, type Inventory } from '../lib/terrain/terrainDb'
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
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
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
  /** When a write was last tried (ms): the throttle. */
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

/** Parsed once per text. */
const cache = new Map<string, { raw: string | null; local: InventoryLocal }>()

function fresh(): InventoryLocal {
  return { v: 1, device: newDeviceId(), rec: emptyRecord(), migrated: false, real: 0, syncedReal: 0, own: 0, syncedOwn: 0, ownTried: 0, triedAt: 0, syncedAt: 0, wroteAt: 0 }
}

/** This identity's side, made (with a new device id) the first time it is asked for; with `create` false, an unsaved empty one. */
export function localFor(me: string, D: InventoryDeps = deps, create = true): InventoryLocal {
  let raw: string | null = null
  try { raw = D.storage?.getItem(recordKey(me)) ?? null } catch { /* unreadable: as new */ }
  const was = cache.get(me)
  if (was && was.raw === raw) return was.local
  let local: InventoryLocal | null = null
  if (raw) {
    try {
      const v = JSON.parse(raw) as Partial<InventoryLocal>
      if (isDeviceId(v.device)) {
        const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0)
        local = {
          v: 1, device: v.device, rec: validRecord(v.rec), migrated: v.migrated === true, real: num(v.real), syncedReal: num(v.syncedReal), own: num(v.own), syncedOwn: num(v.syncedOwn),
          ownTried: num(v.ownTried), triedAt: num(v.triedAt), syncedAt: num(v.syncedAt), wroteAt: num(v.wroteAt),
        }
      }
    } catch { /* not a record: as new */ }
  }
  if (!local && !create) return fresh()
  if (!local) {
    // A record that does not read is kept aside, never written over.
    if (raw) try { D.storage?.setItem(`${recordKey(me)}:unread:${D.now()}`, raw) } catch { /* full */ }
    local = fresh()
    saveLocal(me, local, D)
    return local
  }
  cache.set(me, { raw, local })
  return local
}

function saveLocal(me: string, local: InventoryLocal, D: InventoryDeps = deps): void {
  if (!D.storage) { cache.set(me, { raw: null, local }); return }
  const raw = JSON.stringify(local)
  try { D.storage?.setItem(recordKey(me), raw) } catch { /* quota: kept in memory below */ }
  let back: string | null = raw
  try { back = D.storage?.getItem(recordKey(me)) ?? raw } catch { back = raw }
  cache.set(me, { raw: back, local })
}

/** Whether this identity has changes the relay does not hold yet. */
export function isDirty(me: string, D: InventoryDeps = deps): boolean {
  if (!me || !isPubkey(me)) return false
  const l = localFor(me, D, false)
  return l.real > l.syncedReal
}

/** Whether the Compiler made or charges gained wait for a write, and have not had their fast try yet. */
function ownDue(l: InventoryLocal): boolean { return l.own > l.syncedOwn && l.own > l.ownTried }

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

function record(me: string, local: InventoryLocal, delta: InventoryDelta, D: InventoryDeps, madeAt?: number): InventoryLocal {
  const nowS = Math.floor(D.now() / 1000)
  const important = delta.compiler || (delta.add.charge ?? 0) > 0
  const next: InventoryLocal = { ...local, rec: withDelta(local.rec, local.device, delta, nowS, madeAt ?? nowS), real: local.real + 1, own: local.own + (important ? 1 : 0) }
  saveLocal(me, next, D)
  flip()
  if (useInventorySync.getState().enabled && me === D.self()) schedule(important ? OWN_QUIET_MS : QUIET_MS)
  return next
}

/**
 * A change TERRAIN saved, from `prev` to `next`, for the field's `owner`:
 * recorded as this device's gains and spends, and the inventory to keep back,
 * what it touched shown as the record's totals (a debt shows 0). Before this device
 * migrated (a field kept in memory only), it records and keeps `next` as it is.
 */
export function noteInventory(owner: string, prev: Inventory, next: Inventory): Inventory {
  const D = deps
  if (!isPubkey(owner)) return next
  const delta = deltaOf(prev, next)
  if (emptyDelta(delta)) return next
  const local = record(owner, localFor(owner, D), delta, D)
  return local.migrated ? heldAfter(next, local.rec, delta) : next
}

/**
 * The field's saved inventory is read (`kept`), or could not be (null: no
 * storage on this device). The first time for this device and identity, what
 * it holds becomes its first gains (MIGRATION, once: the mark is kept beside
 * the device id). Returns the inventory to show, its counts the record's
 * totals; null to leave the inventory as it is (no storage, not migrated).
 */
export function loadedInventory(owner: string, kept: Inventory | null): Inventory | null {
  const D = deps
  if (!isPubkey(owner)) return kept
  let local = localFor(owner, D)
  if (!kept) return local.migrated ? inventoryFrom(emptyInventory(), local.rec) : null
  if (!local.migrated) {
    const delta = deltaFromInventory(kept)
    // A Compiler made before sync keeps the date MINING has for it, when it has one.
    local = emptyDelta(delta) ? local : record(owner, local, delta, D, D.crafted(owner))
    local = { ...local, migrated: true }
    saveLocal(owner, local, D)
  }
  return inventoryFrom(kept, local.rec)
}

/** The inventory with the record's totals, for a field already loaded; unchanged before this device migrated. */
export function syncedInventory(owner: string, inv: Inventory): Inventory {
  if (!isPubkey(owner)) return inv
  const local = localFor(owner, deps, false)
  return local.migrated ? inventoryFrom(inv, local.rec) : inv
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
  return D.self() === me && D.live() && !D.tutorial(me) && useInventorySync.getState().enabled
}

async function syncOnce(D: InventoryDeps, write: boolean): Promise<Outcome> {
  const me = D.self()
  const none: Outcome = { wrote: false }
  if (!me || !isPubkey(me)) return none
  const done = (status: InventorySyncStatus, note: string | null = null): Outcome => { useInventorySync.setState({ status, note }); return none }
  if (!useInventorySync.getState().enabled) return done('off')
  if (!D.live()) return done('local')
  if (D.tutorial(me)) return done('idle')
  const crypto = D.crypto()
  if (!crypto.nip44Decrypt) return done('unsupported', NO_NIP44)
  useInventorySync.setState({ status: 'syncing' })
  const remote = await readRemote(me, crypto, D)
  if (D.self() !== me) return none
  if (remote.unsupported) return done('unsupported', NO_NIP44)
  if (remote.trouble) return done('error', NOT_ANSWERED)
  if (remote.why) return done('error', remote.why)
  // Every other device's numbers, folded in. Read again after the wait: a change made meanwhile is in it.
  let local = localFor(me, D)
  const mergedRec = mergeRecords(local.rec, remote.rec)
  const gained = !sameRecord(mergedRec, local.rec)
  const behind = !sameRecord(mergedRec, remote.rec)
  local = { ...local, rec: mergedRec, syncedAt: D.now(), ...(behind ? {} : { syncedReal: local.real, syncedOwn: local.own }) }
  saveLocal(me, local, D)
  flip()
  if (gained) for (const f of merged) { try { f(me) } catch { /* one listener failing never stops the sync */ } }
  if (!behind) return done('synced')
  if (local.real <= local.syncedReal) return done('synced')
  if (!write || !mayWrite(D, me)) return done('idle')
  const nowS = Math.floor(D.now() / 1000)
  const ahead = remote.createdAt + 1 > nowS + MAX_AHEAD_S
  if (ahead && remote.id && aheadOf.has(remote.id)) return done('error', AHEAD)
  if (remote.createdAt < local.wroteAt && D.now() / 1000 - local.wroteAt < STALE_PATIENCE_S) return done('error', STALE)
  let text: string
  try { text = planRecord(mergedRec) } catch (err) { return done('error', err instanceof Error ? err.message : String(err)) }
  const real = local.real
  const own = local.own
  // The throttle counts tries, so a refusal is not asked again until the next window (and the fast one is spent).
  saveLocal(me, { ...local, triedAt: D.now(), ownTried: Math.max(local.ownTried, own) }, D)
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
  try { ev = await D.sign(recordTemplate(sealRecord(text, key.key, key.wrapped), createdAt)) } catch (err) {
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
  const now = localFor(me, D)
  saveLocal(me, { ...now, syncedReal: Math.max(now.syncedReal, real), syncedOwn: Math.max(now.syncedOwn, own), syncedAt: D.now(), wroteAt: ev.created_at }, D)
  flip()
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

/** One sync after any already running. `write` false only reads (and folds in the other devices). */
export function syncInventory(write = true): Promise<Outcome> {
  const once = (): Promise<Outcome> => syncOnce(deps, write).catch((err) => {
    useInventorySync.setState({ status: 'error', note: err instanceof Error ? err.message : String(err) })
    return { wrote: false }
  })
  const run = async (): Promise<Outcome> => {
    let out = await once()
    for (let n = 0; out.raced && n < 2; n++) out = await once()
    return out
  }
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
  timer = setTimeout(() => { timer = null; timerAt = 0; void syncInventory(true) }, due - now)
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
    if (l.real > l.syncedReal && now - l.triedAt >= (ownDue(l) ? OWN_FLOOR_MS : HIDE_FLOOR_MS)) { cancelTimer(); void syncInventory(true) }
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
  prefs: ls(),
  verify: (ev) => verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]),
  crafted: () => undefined,
}

let deps: InventoryDeps = offline

/** Set the outside world (startInventorySync, and tests). Returns the previous deps. */
export function setInventoryDeps(next: Partial<InventoryDeps> | null): InventoryDeps {
  const prev = deps
  deps = next ? { ...offline, ...next } : offline
  useInventorySync.setState({ enabled: loadEnabled(deps.prefs) })
  return prev
}

/** Tests only: forget keys opened, timers, the queue and the parse cache. */
export function resetInventorySync(): void {
  opened = { me: '', keys: new Map() }
  failed.clear()
  aheadOf.clear()
  made = null
  cache.clear()
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
  if (!o.me || !isPubkey(o.me)) return { synced: false, words: here, why: 'Sign in to sync it' }
  if (!o.enabled) return { synced: false, words: here, why: 'Sync is off in Settings' }
  if (!o.live) return { synced: false, words: here, why: 'Switch to LIVE to sync' }
  if (o.status === 'unsupported') return { synced: false, words: here, why: o.note ?? 'Your signer cannot encrypt it' }
  if (o.status === 'error') return { synced: false, words: 'Sync failed', why: o.note ?? '' }
  if (o.syncedAt > 0) return { synced: true, words: 'Synced across your devices', why: `New changes save within ${WRITE_EVERY_MS / 60_000} min` }
  return { synced: false, words: here, why: 'Not synced yet' }
}
