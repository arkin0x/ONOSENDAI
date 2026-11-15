/**
 * hidesSync.ts: your own hidden things on every device signed in as you
 * (owner ruling, 2026-11-15, option A). The record itself, its format and its
 * merge are lib/hidesRecord.ts; this is when it is read and written.
 *
 * READING. On every identity, again when the tab or the network comes back,
 * and before every write: the newest shard of each `d` is fetched from the
 * relays, the record key is unwrapped (one signer decrypt per record key per
 * load: a key already opened this load is not asked for again), the shards are
 * opened and laid together, and the record is merged with this device's own
 * (mergeRecords). Every bag in it that this device does not list yet is
 * adopted: its newest envelope is fetched by its address (your pubkey and its
 * lookup id), opened with the key the record carries, and filed as a scan
 * files a find of your own (useShards addDiscovered, claimOwn), so it joins
 * HIDDEN IN CYBERSPACE with everything it takes to open, move or delete it
 * from here. Nothing is ever taken off this device's list by the record.
 *
 * WRITING. A hide, a move or an edit changes `mine`; a write follows a few
 * seconds after the last change (DEBOUNCE_MS). Every write reads the relays
 * first and folds their copy in, so two devices never write over each other's
 * entries; a write after another device's lands is caught by reading again
 * (VERIFY_MS) and writing the union. Only shards whose content changed are
 * signed. Nothing is written:
 *   - in LOCAL, as nothing else is;
 *   - while a tutorial run is active (signEvent's no-broadcast rule);
 *   - when the canonical relay did not answer, or a shard on it did not open:
 *     a record rebuilt from less than the whole would replace the whole;
 *   - when the signer has no NIP-44 (Settings' EXPLAIN says so), or the
 *     setting is off.
 * Only published bags go in the record: a bag kept LOCAL is on this device
 * alone, and no other device could open it.
 *
 * TOMBSTONES. A bag that leaves this device's list in this session (DELETE,
 * FORGET, a move to another region, a door's room emptied) is tombstoned with
 * the time, kept on this device until a write carries it. A bag that comes
 * back to the list after this device tombstoned it is newer than its
 * tombstone (seenAt); a bag adopted from the record keeps its own time. A change
 * that takes most of the list away at once is not read as deletions (a list
 * that failed to load is not a list emptied).
 */

import { create } from 'zustand'
import { verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from '../lib/events'
import {
  HIDES_D_TAGS,
  HIDES_KIND,
  MAX_NAME,
  emptyRecord,
  mergeRecords,
  newRecordKey,
  newestShards,
  openShard,
  planShards,
  decodeShard,
  sameRecord,
  sealShard,
  shardContent,
  shardPart,
  shardTemplate,
  pruneGone,
  type HideEntry,
  type HidesRecord,
} from '../lib/hidesRecord'
import { hiddenLabel } from '../lib/hidden'
import type { MyDeployment } from './useShards'
import type { PublishResult } from '../lib/relay'

/** A write waits this long after the last change, so a run of hides is one write. */
export const DEBOUNCE_MS = 4000
/** How long after a write it is checked that another device's write did not land over it. */
export const VERIFY_MS = 9000
/** How many times in a row a write is checked and written again. */
const MAX_VERIFY = 3
const SETTING_KEY = 'onosendai:hides-sync'
const goneKey = (me: string): string => `onosendai:hides-gone:${me}`
const seenKey = (me: string): string => `onosendai:hides-seen:${me}`
/** The bags this device tombstoned, and when: only one of those coming back needs to be newer than a tombstone. */
const tombedKey = (me: string): string => `onosendai:hides-tombed:${me}`

/** Signer's self-to-self NIP-44, as useCyberspace selfCrypto gives it. */
export interface SelfNip44 {
  nip44Encrypt?: (plaintext: string) => Promise<string>
  nip44Decrypt?: (payload: string) => Promise<string>
}

/** What the sync needs from the outside world; replaced in tests (setHidesDeps). */
export interface HidesDeps {
  self: () => string
  /** LIVE, as against LOCAL. */
  live: () => boolean
  /** A tutorial run is active for this identity. */
  tutorial: (me: string) => boolean
  crypto: () => SelfNip44
  /** Read the relays; `trouble` when the canonical relay refused or was not heard from. */
  fetch: (filter: Filter) => Promise<{ events: NostrEvent[]; trouble: boolean }>
  sign: (template: EventTemplate) => Promise<NostrEvent>
  publish: (event: NostrEvent) => Promise<PublishResult>
  /** This identity's list (useShards `mine`), or null while another identity's is up. */
  rows: (me: string) => readonly MyDeployment[] | null
  /** Open these bags of yours and file them in your list. */
  adopt: (entries: HideEntry[], me: string) => Promise<void>
  now: () => number
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  verify: (ev: NostrEvent) => boolean
}

export type HidesStatus = 'idle' | 'syncing' | 'synced' | 'off' | 'local' | 'unsupported' | 'error'

interface HidesState {
  /** The setting: on unless turned off on this device. */
  enabled: boolean
  status: HidesStatus
  /** Why, when status is error or unsupported. */
  note: string | null
  setEnabled: (on: boolean) => void
}

function loadEnabled(storage: HidesDeps['storage']): boolean {
  try { return storage?.getItem(SETTING_KEY) !== '0' } catch { return true }
}

export const useHidesSync = create<HidesState>((set) => ({
  enabled: true,
  status: 'idle',
  note: null,
  setEnabled: (on) => {
    try { deps.storage?.setItem(SETTING_KEY, on ? '1' : '0') } catch { /* private mode */ }
    set({ enabled: on, status: on ? 'idle' : 'off', note: null })
    if (on) requestSync(0)
  },
}))

// -- this device's side of the record ----------------------------------------

function readJson<T>(key: string, fallback: T, D: HidesDeps = deps): T {
  try {
    const raw = D.storage?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

function writeJson(key: string, value: unknown, D: HidesDeps = deps): void {
  try { D.storage?.setItem(key, JSON.stringify(value)) } catch { /* quota or private mode */ }
}

/** Tombstones made here and not yet carried by a write. */
function pendingGone(me: string, D: HidesDeps = deps): Record<string, number> {
  const v = readJson<Record<string, unknown>>(goneKey(me), {}, D)
  const out: Record<string, number> = {}
  for (const [l, t] of Object.entries(v)) if (/^[0-9a-f]{64}$/.test(l) && typeof t === 'number') out[l] = t
  return out
}

/** When a bag came back to this list after leaving it: newer than its tombstone. */
function seenAt(me: string, D: HidesDeps = deps): Record<string, number> {
  return readJson<Record<string, number>>(seenKey(me), {}, D)
}

/** A row that goes in the record: published, still in its bag, whole. */
function recorded(d: MyDeployment): boolean {
  return d.published && !d.goneFrom && /^[0-9a-f]{64}$/.test(d.lookupId ?? '') && /^[0-9a-f]{64}$/i.test(d.keyHex ?? '')
}

function nameOf(d: MyDeployment): string {
  const name = d.type === 'shard' ? d.shard?.name ?? 'object' : hiddenLabel(d, MAX_NAME)
  return name.slice(0, MAX_NAME)
}

/** One entry per bag this list holds a published item of. */
export function entriesOf(rows: readonly MyDeployment[], seen: Readonly<Record<string, number>> = {}): Record<string, HideEntry> {
  const by = new Map<string, MyDeployment[]>()
  for (const d of rows) {
    if (!recorded(d)) continue
    const list = by.get(d.lookupId)
    if (list) list.push(d)
    else by.set(d.lookupId, [d])
  }
  const out: Record<string, HideEntry> = {}
  for (const [l, items] of by) {
    // The newest item names it.
    const newest = [...items].sort((a, b) => (b.bagAt ?? b.createdAt) - (a.bagAt ?? a.createdAt) || b.createdAt - a.createdAt)[0]
    const t = Math.max(seen[l] ?? 0, ...items.map((d) => Math.max(d.bagAt ?? 0, d.createdAt)))
    out[l] = {
      l,
      k: newest.keyHex.toLowerCase(),
      h: newest.height,
      p: newest.plane === 1 ? 1 : 0,
      x: newest.at.x, y: newest.at.y, z: newest.at.z,
      n: nameOf(newest),
      c: items.length,
      t,
      ...(newest.room?.doorId ? { r: newest.room.doorId } : {}),
    }
  }
  return out
}

/** This device's record: its list's entries and its own tombstones. */
export function localRecord(me: string, rows: readonly MyDeployment[], D: HidesDeps = deps): HidesRecord {
  return mergeRecords({ e: entriesOf(rows, seenAt(me, D)), x: {} }, { e: {}, x: pendingGone(me, D) })
}

/**
 * The bags that left this identity's list between two of its lists, tombstoned
 * now; the bags that came back, seen now. A change that takes more than half of
 * a list of more than three bags is not deletions.
 */
export function noteListChange(me: string, prev: readonly MyDeployment[], next: readonly MyDeployment[]): void {
  const before = new Set(prev.filter(recorded).map((d) => d.lookupId))
  const after = new Set(next.filter(recorded).map((d) => d.lookupId))
  const left = [...before].filter((l) => !after.has(l))
  const came = [...after].filter((l) => !before.has(l))
  if (left.length === 0 && came.length === 0) return
  const now = deps.now()
  const gone = pendingGone(me)
  const seen = seenAt(me)
  const tombed = readJson<Record<string, number>>(tombedKey(me), {})
  const massDrop = before.size > 3 && left.length * 2 > before.size
  if (!massDrop) for (const l of left) { gone[l] = now; tombed[l] = now; delete seen[l] }
  for (const l of came) {
    if (gone[l] !== undefined) delete gone[l]
    // Back on the list after this device tombstoned it: newer than that
    // tombstone, which may be on the relay already. A bag merely adopted
    // (another device's, from the record) keeps its own time, so adopting
    // never rewrites the record.
    if (tombed[l] !== undefined) { seen[l] = now; delete tombed[l] }
  }
  writeJson(goneKey(me), pruneGone(gone, now))
  writeJson(tombedKey(me), pruneGone(tombed, now))
  // Only bags still on the list need a seen time.
  for (const l of Object.keys(seen)) if (!after.has(l)) delete seen[l]
  writeJson(seenKey(me), seen)
}

// -- the relays' side --------------------------------------------------------

/** Record keys opened this load, by their wrapped form, for the identity they belong to. */
let opened: { me: string; keys: Map<string, Uint8Array> } = { me: '', keys: new Map() }

function keysFor(me: string): Map<string, Uint8Array> {
  if (opened.me !== me) opened = { me, keys: new Map() }
  return opened.keys
}

interface RemoteRead {
  record: HidesRecord
  /** Each shard's part as read, by index. */
  parts: Map<number, HidesRecord>
  /** The most shards a writer used. */
  k: number
  /** The newest created_at among the shards: a write must be newer. */
  newestAt: number
  /** A record key that opened, to write with, preferring shard 0's. */
  key: { wrapped: string; key: Uint8Array } | null
  /** Some shard did not open or did not parse: never written over. */
  broken: boolean
  trouble: boolean
}

async function readRemote(me: string, crypto: SelfNip44, D: HidesDeps): Promise<RemoteRead> {
  const { events, trouble } = await D.fetch({ kinds: [HIDES_KIND], authors: [me], '#d': [...HIDES_D_TAGS] })
  const newest = newestShards(events.filter((ev) => D.verify(ev)), me)
  const keys = keysFor(me)
  const parts = new Map<number, HidesRecord>()
  let record = emptyRecord()
  let k = 1
  let newestAt = 0
  let broken = false
  let key: RemoteRead['key'] = null
  for (const i of [...newest.keys()].sort((a, b) => a - b)) {
    const ev = newest.get(i)!
    newestAt = Math.max(newestAt, ev.created_at)
    const c = shardContent(ev.content)
    if (!c) { broken = true; continue }
    let rk = keys.get(c.wrapped)
    if (!rk) {
      try {
        if (!crypto.nip44Decrypt) throw new Error('no NIP-44')
        const hex = (await crypto.nip44Decrypt(c.wrapped)).trim().toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('not a record key')
        rk = hexToBytes(hex)
        keys.set(c.wrapped, rk)
      } catch { broken = true; continue }
    }
    try {
      const shard = decodeShard(openShard(c.body, rk))
      parts.set(i, shard.rec)
      record = mergeRecords(record, shard.rec)
      k = Math.max(k, shard.k)
      if (!key || i === 0) key = { wrapped: c.wrapped, key: rk }
    } catch { broken = true }
  }
  return { record, parts, k, newestAt, key, broken, trouble }
}

// -- one sync ----------------------------------------------------------------

/** Why nothing was written, in words, or null when all is well. */
type Outcome = { wrote: number; note: string | null }

const NOT_ANSWERED = 'The relay did not answer, so your list of hidden things was not saved to it this time.'
const NOT_OPENED = 'Part of your saved list of hidden things did not open with your signer, so it was left as it is.'
const NO_NIP44 = 'Your signer has no NIP-44 encryption, so your list of hidden things stays on this device.'

async function syncOnce(D: HidesDeps): Promise<Outcome> {
  const me = D.self()
  const st = useHidesSync.getState()
  if (!me) return { wrote: 0, note: null }
  if (!st.enabled) { useHidesSync.setState({ status: 'off', note: null }); return { wrote: 0, note: null } }
  const crypto = D.crypto()
  if (!crypto.nip44Decrypt) { useHidesSync.setState({ status: 'unsupported', note: NO_NIP44 }); return { wrote: 0, note: NO_NIP44 } }
  useHidesSync.setState({ status: 'syncing' })
  const remote = await readRemote(me, crypto, D)
  if (D.self() !== me) return { wrote: 0, note: null }

  // Adopt what this list lacks: never a bag a tombstone here stands over.
  const rows = D.rows(me)
  if (!rows) return { wrote: 0, note: null }
  const local = localRecord(me, rows, D)
  const merged = mergeRecords(remote.record, local, D.now())
  const listed = new Set(rows.map((d) => d.lookupId))
  const missing = Object.values(merged.e).filter((e) => !listed.has(e.l))
  if (missing.length > 0) {
    try { await D.adopt(missing, me) } catch { /* the next sync asks again */ }
    if (D.self() !== me) return { wrote: 0, note: null }
  }

  // Write, where writing is allowed.
  const done = (status: HidesStatus, note: string | null): Outcome => { useHidesSync.setState({ status, note }); return { wrote: 0, note } }
  if (!D.live()) return done('local', null)
  if (D.tutorial(me)) return done('idle', null)
  if (remote.trouble) return done('error', NOT_ANSWERED)
  if (remote.broken) return done('error', NOT_OPENED)
  if (!crypto.nip44Encrypt) return done('unsupported', NO_NIP44)
  // What this list holds now, after adopting: the adopted rows are the record's already.
  const now = mergeRecords(merged, localRecord(me, D.rows(me) ?? rows, D), D.now())
  if (sameRecord(now, remote.record)) {
    clearCarried(me, now, D)
    return done('synced', null)
  }
  let plan: { k: number; texts: string[] }
  try { plan = planShards(now, remote.k) } catch (err) { return done('error', err instanceof Error ? err.message : String(err)) }
  const changed = plan.texts.map((_, i) => i).filter((i) => {
    const was = remote.parts.get(i) ?? emptyRecord()
    const part = shardPart(now, i, plan.k)
    // A shard the relay does not hold and that would be empty is not written.
    if (!remote.parts.has(i) && Object.keys(part.e).length === 0 && Object.keys(part.x).length === 0) return false
    // Written again when its content or its count of shards changed.
    return !sameRecord(was, part) || (remote.parts.has(i) && remote.k !== plan.k)
  })
  if (changed.length === 0) { clearCarried(me, now, D); return done('synced', null) }
  let key = remote.key
  if (!key) {
    const fresh = newRecordKey()
    let wrapped: string
    try { wrapped = await crypto.nip44Encrypt(bytesToHex(fresh)) } catch (err) { return done('error', `Your signer did not encrypt your list of hidden things: ${err instanceof Error ? err.message : String(err)}`) }
    key = { wrapped, key: fresh }
    keysFor(me).set(wrapped, fresh)
  }
  const createdAt = Math.max(D.now(), remote.newestAt + 1)
  let wrote = 0
  for (const i of changed) {
    if (D.self() !== me) return { wrote, note: null }
    let signed: NostrEvent
    try { signed = await D.sign(shardTemplate(i, sealShard(plan.texts[i], key.key, key.wrapped), createdAt)) } catch (err) { return { ...done('error', `Your list of hidden things was not signed: ${err instanceof Error ? err.message : String(err)}`), wrote } }
    if (signed.pubkey !== me || D.self() !== me) return { wrote, note: null }
    const res = await D.publish(signed)
    if (!res.ok) return { ...done('error', `No relay took your list of hidden things (${res.reason}).`), wrote }
    wrote++
  }
  clearCarried(me, now, D)
  useHidesSync.setState({ status: 'synced', note: null })
  return { wrote, note: null }
}

/** Tombstones a write carried are the relay's to keep now. */
function clearCarried(me: string, carried: HidesRecord, D: HidesDeps): void {
  const gone = pendingGone(me, D)
  let any = false
  for (const l of Object.keys(gone)) if (carried.x[l] !== undefined && carried.x[l] >= gone[l]) { delete gone[l]; any = true }
  if (any) writeJson(goneKey(me), gone, D)
}

// -- when ---------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | null = null
let verifyTimer: ReturnType<typeof setTimeout> | null = null
let verifies = 0

/** One sync, after any already running: two never interleave on one device. */
export function syncHides(): Promise<Outcome> {
  // The world as it is when this sync starts: one sync never reads half of one and half of another.
  const run = (): Promise<Outcome> => syncOnce(deps).catch((err) => {
    const note = err instanceof Error ? err.message : String(err)
    useHidesSync.setState({ status: 'error', note })
    return { wrote: 0, note }
  })
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p.then((out) => {
    // A write is read back a little later: another device's write may have landed over it.
    if (out.wrote > 0 && verifies < MAX_VERIFY) {
      verifies++
      if (verifyTimer) clearTimeout(verifyTimer)
      verifyTimer = setTimeout(() => { verifyTimer = null; void syncHides() }, VERIFY_MS)
    } else if (out.wrote === 0) verifies = 0
    return out
  })
}

/** A sync after `ms` of quiet. */
export function requestSync(ms = DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { timer = null; void syncHides() }, ms)
}

// -- deps ---------------------------------------------------------------------

const offline: HidesDeps = {
  self: () => '',
  live: () => false,
  tutorial: () => false,
  crypto: () => ({}),
  fetch: async () => ({ events: [], trouble: true }),
  sign: async () => { throw new Error('no signer') },
  publish: async () => ({ ok: false, reason: 'not started' }),
  rows: () => null,
  adopt: async () => undefined,
  now: () => Math.floor(Date.now() / 1000),
  storage: typeof localStorage !== 'undefined' ? localStorage : null,
  verify: (ev) => verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]),
}

let deps: HidesDeps = offline

/** Set the outside world (startHidesSync, and tests). Returns the previous deps. */
export function setHidesDeps(next: Partial<HidesDeps> | null): HidesDeps {
  const prev = deps
  deps = next ? { ...offline, ...next } : offline
  useHidesSync.setState({ enabled: loadEnabled(deps.storage) })
  return prev
}

/** Tests only: forget the record keys opened, the timers and the queue. */
export function resetHidesSync(): void {
  opened = { me: '', keys: new Map() }
  if (timer) clearTimeout(timer)
  if (verifyTimer) clearTimeout(verifyTimer)
  timer = verifyTimer = null
  verifies = 0
  queue = Promise.resolve()
}
