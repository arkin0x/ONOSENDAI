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
 * TOMBSTONES. A bag that leaves this device's list (DELETE, FORGET, a move to
 * another region, a room emptied) is asked of the relays at the next sync:
 * this device may have listed only part of it. Deleted, missing, or holding
 * nothing of yours, it is tombstoned, newer than any entry for it; still
 * holding items of yours, they are adopted and it stays listed. A tombstone is
 * kept on this device until a read shows it on the relay. A bag that comes
 * back after this device tombstoned it is newer than its tombstone (seenAt);
 * a bag adopted from the record keeps its own time.
 *
 * SAFETY. Saved means the canonical relay took it (hidesSyncLive). A write is
 * signed, then the relays are read again, and if any shard changed meanwhile
 * (another device, during a long signer prompt) nothing is sent and the sync
 * runs again. A read older than what this device saw or wrote, or a record of
 * several shards missing one, is not written over (for a day). A signer that
 * refuses a decrypt is asked once a load.
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
/** Bags that left this list, not yet tombstoned: each is asked of the relays first. */
const leftKey = (me: string): string => `onosendai:hides-left:${me}`
/** The newest created_at this device has seen or written for each shard: a read behind it is stale. */
const markKey = (me: string): string => `onosendai:hides-marks:${me}`
/** A read behind the marks is not written over for this long; then the relay's copy is taken as it is. */
const STALE_PATIENCE_S = 86_400

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
  /**
   * Open these bags of yours where they stand, file what they hold in your
   * list, and say of each what the relays said: it holds items of yours, it
   * is gone (the canonical relay answered: deleted, missing, or nothing of
   * yours in it), or nothing is known.
   */
  adopt: (entries: HideEntry[], me: string) => Promise<Record<string, 'holds' | 'gone' | 'unknown'>>
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
    // Turning it on again is asking again: a signer that refused is asked once more.
    if (on) { failed.clear(); requestSync(0) }
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

/** Bags that left this list and wait to be asked of the relays, with the entry each had. */
function leftEntries(me: string, D: HidesDeps = deps): Record<string, HideEntry> {
  return readJson<Record<string, HideEntry>>(leftKey(me), {}, D)
}

/**
 * The bags that left this identity's list between two of its lists, and the
 * bags that came back. One that left is not tombstoned here: this device may
 * have listed only some of what the bag holds (another device's items in it
 * are kept by every rewrite), so the next sync asks the relays first, and only
 * a bag deleted, missing, or holding nothing of yours is tombstoned; one still
 * holding items of yours has them adopted instead. One that comes back after
 * this device tombstoned it is newer than that tombstone (seenAt); one merely
 * adopted keeps its own time, so adopting never rewrites the record.
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
  const waiting = leftEntries(me)
  const had = left.length > 0 ? entriesOf(prev, seen) : {}
  for (const l of left) { if (had[l]) waiting[l] = had[l]; delete seen[l] }
  for (const l of came) {
    delete waiting[l]
    if (gone[l] !== undefined) delete gone[l]
    if (tombed[l] !== undefined) { seen[l] = now; delete tombed[l] }
  }
  writeJson(leftKey(me), waiting)
  writeJson(goneKey(me), pruneGone(gone, now))
  writeJson(tombedKey(me), pruneGone(tombed, now))
  // Only bags still on the list need a seen time.
  for (const l of Object.keys(seen)) if (!after.has(l)) delete seen[l]
  writeJson(seenKey(me), seen)
}

// -- the relays' side --------------------------------------------------------

/** Record keys opened this load, by their wrapped form, for the identity they belong to. */
let opened: { me: string; keys: Map<string, Uint8Array> } = { me: '', keys: new Map() }
/** Wrapped keys the signer refused or could not open this load: never asked again until the switch is turned on again. */
const failed = new Set<string>()
/** Bags the record names that the relays said are gone, this load: not asked again. */
let unopened: { me: string; ls: Set<string> } = { me: '', ls: new Set() }

function keysFor(me: string): Map<string, Uint8Array> {
  if (opened.me !== me) { opened = { me, keys: new Map() }; failed.clear() }
  return opened.keys
}

function unopenedFor(me: string): Set<string> {
  if (unopened.me !== me) unopened = { me, ls: new Set() }
  return unopened.ls
}

/** A signer that has no NIP-44 at all, as against one that refused this once. */
function lacksNip44(err: unknown): boolean {
  return /no NIP-44/i.test(err instanceof Error ? err.message : String(err))
}

interface Marks { at: Record<string, number>; since: number }

function readMarks(me: string, D: HidesDeps): Marks {
  const m = readJson<Partial<Marks>>(markKey(me), {}, D)
  return { at: m.at && typeof m.at === 'object' ? m.at : {}, since: typeof m.since === 'number' ? m.since : 0 }
}

interface RemoteRead {
  record: HidesRecord
  /** Each shard's part as read, by index. */
  parts: Map<number, HidesRecord>
  /** Each shard's event id as read: a write is sent only if these are still the newest. */
  ids: Map<number, string>
  /** Each shard's created_at as read. */
  ats: Map<number, number>
  /** The most shards a writer used. */
  k: number
  /** The newest created_at among the shards: a write must be newer. */
  newestAt: number
  /** A record key that opened, to write with, preferring shard 0's. */
  key: { wrapped: string; key: Uint8Array } | null
  /** Some shard did not open or did not parse, or is missing or older than one seen before: never written over. */
  broken: boolean
  /** Why, in words, when broken. */
  why: string | null
  /** The signer has no NIP-44 at all. */
  unsupported: boolean
  trouble: boolean
}

const RECORD_FILTER = (me: string): Filter => ({ kinds: [HIDES_KIND], authors: [me], '#d': [...HIDES_D_TAGS] })

async function readRemote(me: string, crypto: SelfNip44, D: HidesDeps): Promise<RemoteRead> {
  const { events, trouble } = await D.fetch(RECORD_FILTER(me))
  const newest = newestShards(events.filter((ev) => D.verify(ev)), me)
  const keys = keysFor(me)
  const parts = new Map<number, HidesRecord>()
  const ids = new Map<number, string>()
  const ats = new Map<number, number>()
  let record = emptyRecord()
  let k = 1
  let newestAt = 0
  let why: string | null = null
  let unsupported = false
  let key: RemoteRead['key'] = null
  for (const i of [...newest.keys()].sort((a, b) => a - b)) {
    const ev = newest.get(i)!
    ids.set(i, ev.id)
    ats.set(i, ev.created_at)
    newestAt = Math.max(newestAt, ev.created_at)
    const c = shardContent(ev.content)
    if (!c) { why = NOT_OPENED; continue }
    let rk = keys.get(c.wrapped)
    if (!rk) {
      if (failed.has(c.wrapped)) { why = NOT_OPENED; continue }
      try {
        if (!crypto.nip44Decrypt) throw new Error('no NIP-44')
        const hex = (await crypto.nip44Decrypt(c.wrapped)).trim().toLowerCase()
        if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('not a record key')
        rk = hexToBytes(hex)
        keys.set(c.wrapped, rk)
      } catch (err) {
        // Asked once a load: a refusal is not asked again on every sync.
        failed.add(c.wrapped)
        if (lacksNip44(err)) unsupported = true
        why = NOT_OPENED
        continue
      }
    }
    try {
      const shard = decodeShard(openShard(c.body, rk))
      parts.set(i, shard.rec)
      record = mergeRecords(record, shard.rec)
      k = Math.max(k, shard.k)
      if (!key || i === 0) key = { wrapped: c.wrapped, key: rk }
    } catch { why = NOT_OPENED }
  }
  // A shard of a record of several that is missing is lost, not empty: every
  // shard of such a record is written, empty or not.
  if (newest.size > 0) for (let i = 0; i < k; i++) if (!newest.has(i) && !why) why = STALE
  // Older than what this device saw or wrote: the relay answered with a stale
  // copy. Not written over for a day; past that the relay's copy is what there is.
  const marks = readMarks(me, D)
  const patient = D.now() - marks.since < STALE_PATIENCE_S
  if (patient) for (const [i, at] of Object.entries(marks.at)) {
    const ev = newest.get(Number(i))
    if ((!ev || ev.created_at < at) && !why) why = STALE
  }
  return { record, parts, ids, ats, k, newestAt, key, broken: why !== null, why, unsupported, trouble }
}

/** Remember the newest of each shard, as read or as written. */
function noteMarks(me: string, D: HidesDeps, shards: Iterable<[number, number]>): void {
  const m = readMarks(me, D)
  let any = false
  for (const [i, at] of shards) if ((m.at[i] ?? 0) < at) { m.at[i] = at; any = true }
  if (any) writeJson(markKey(me), { at: m.at, since: D.now() }, D)
}

// -- one sync ----------------------------------------------------------------

/** What one sync did: shards written, why not, and whether another write landed between its read and its write. */
type Outcome = { wrote: number; note: string | null; raced?: boolean }

const NOT_ANSWERED = 'The relay did not answer, so your list of hidden things was not saved to it this time.'
const NOT_OPENED = 'Part of your saved list of hidden things did not open with your signer, so it was left as it is.'
const STALE = 'The relay answered with an older copy of your list of hidden things, so it was left as it is for now.'
const NO_NIP44 = 'Your signer has no NIP-44 encryption, so your list of hidden things stays on this device.'

/** Whether writing is still allowed now: LIVE, no tutorial run, the switch on, the same identity. */
function mayWrite(D: HidesDeps, me: string): boolean {
  return D.self() === me && D.live() && !D.tutorial(me) && useHidesSync.getState().enabled
}

async function syncOnce(D: HidesDeps): Promise<Outcome> {
  const me = D.self()
  const st = useHidesSync.getState()
  if (!me) return { wrote: 0, note: null }
  if (!st.enabled) { useHidesSync.setState({ status: 'off', note: null }); return { wrote: 0, note: null } }
  const crypto = D.crypto()
  const done = (status: HidesStatus, note: string | null): Outcome => { useHidesSync.setState({ status, note }); return { wrote: 0, note } }
  if (!crypto.nip44Decrypt) return done('unsupported', NO_NIP44)
  useHidesSync.setState({ status: 'syncing' })
  const remote = await readRemote(me, crypto, D)
  if (D.self() !== me) return { wrote: 0, note: null }
  if (remote.unsupported) return done('unsupported', NO_NIP44)
  if (!remote.trouble && !remote.broken) noteMarks(me, D, remote.ats)

  const rows = D.rows(me)
  if (!rows) return { wrote: 0, note: null }
  const merged = mergeRecords(remote.record, localRecord(me, rows, D), D.now())
  const listed = new Set(rows.filter(recorded).map((d) => d.lookupId))
  // Adopt what this list lacks (never a bag a tombstone stands over), and ask
  // the relays about each bag that left this list since the last sync.
  const skip = unopenedFor(me)
  const missing = Object.values(merged.e).filter((e) => !listed.has(e.l) && !skip.has(e.l))
  const waiting = Object.values(leftEntries(me, D)).filter((e) => !listed.has(e.l))
  const ask = [...missing, ...waiting.filter((w) => !missing.some((m) => m.l === w.l))]
  if (ask.length > 0) {
    let states: Record<string, 'holds' | 'gone' | 'unknown'> = {}
    try { states = await D.adopt(ask, me) } catch { /* the next sync asks again */ }
    if (D.self() !== me) return { wrote: 0, note: null }
    for (const e of missing) if (states[e.l] === 'gone') skip.add(e.l)
    const left = leftEntries(me, D)
    const gone = pendingGone(me, D)
    const tombed = readJson<Record<string, number>>(tombedKey(me), {}, D)
    const now = D.now()
    for (const w of waiting) {
      const state = states[w.l]
      if (state === 'unknown' || state === undefined) continue
      delete left[w.l]
      if (state === 'gone') {
        // Newer than any entry for it anyone has written: the bag clock may run ahead of the wall clock.
        const t = Math.max(now, w.t + 1, (merged.e[w.l]?.t ?? 0) + 1)
        gone[w.l] = t
        tombed[w.l] = t
      }
    }
    writeJson(leftKey(me), left, D)
    writeJson(goneKey(me), pruneGone(gone, now), D)
    writeJson(tombedKey(me), pruneGone(tombed, now), D)
  }

  // Write, where writing is allowed.
  if (!D.live()) return done('local', null)
  if (D.tutorial(me)) return done('idle', null)
  if (remote.trouble) return done('error', NOT_ANSWERED)
  if (remote.broken) return done('error', remote.why ?? NOT_OPENED)
  if (!crypto.nip44Encrypt) return done('unsupported', NO_NIP44)
  // What this list holds now, after adopting and tombstoning.
  const now = mergeRecords(remote.record, localRecord(me, D.rows(me) ?? rows, D), D.now())
  clearCarried(me, remote.record, D)
  if (sameRecord(now, remote.record)) return done('synced', null)
  let plan: { k: number; texts: string[] }
  try { plan = planShards(now, remote.k) } catch (err) { return done('error', err instanceof Error ? err.message : String(err)) }
  const changed = plan.texts.map((_, i) => i).filter((i) => {
    const part = shardPart(now, i, plan.k)
    // A record of several shards writes every one, so a missing one reads as lost, never as empty.
    if (!remote.parts.has(i)) return plan.k > 1 || Object.keys(part.e).length > 0 || Object.keys(part.x).length > 0
    // Written again when its content or its count of shards changed.
    return !sameRecord(remote.parts.get(i)!, part) || remote.k !== plan.k
  })
  if (changed.length === 0) return done('synced', null)
  let key = remote.key
  if (!key) {
    const fresh = newRecordKey()
    let wrapped: string
    try { wrapped = await crypto.nip44Encrypt(bytesToHex(fresh)) } catch (err) { return lacksNip44(err) ? done('unsupported', NO_NIP44) : done('error', `Your signer did not encrypt your list of hidden things: ${err instanceof Error ? err.message : String(err)}`) }
    key = { wrapped, key: fresh }
    keysFor(me).set(wrapped, fresh)
  }
  const createdAt = Math.max(D.now(), remote.newestAt + 1)
  const signed: Array<[number, NostrEvent]> = []
  for (const i of changed) {
    if (!mayWrite(D, me)) return { wrote: 0, note: null }
    let ev: NostrEvent
    try { ev = await D.sign(shardTemplate(i, sealShard(plan.texts[i], key.key, key.wrapped), createdAt)) } catch (err) { return done('error', `Your list of hidden things was not signed: ${err instanceof Error ? err.message : String(err)}`) }
    if (ev.pubkey !== me) return { wrote: 0, note: null }
    signed.push([i, ev])
  }
  // A signer may take minutes: if another write landed meanwhile, what was signed is dropped and the sync runs again.
  const again = await D.fetch(RECORD_FILTER(me))
  if (again.trouble) return done('error', NOT_ANSWERED)
  const newestNow = newestShards(again.events.filter((ev) => D.verify(ev)), me)
  for (const i of new Set([...newestNow.keys(), ...remote.ids.keys()])) {
    if (newestNow.get(i)?.id !== remote.ids.get(i)) return { wrote: 0, note: null, raced: true }
  }
  let wrote = 0
  for (const [i, ev] of signed) {
    if (!mayWrite(D, me)) return { wrote, note: null }
    const res = await D.publish(ev)
    if (!res.ok) return { ...done('error', `Your list of hidden things was not saved to the relay (${res.reason}).`), wrote }
    noteMarks(me, D, [[i, ev.created_at]])
    wrote++
  }
  // Tombstones are let go only once a read shows them on the relay (clearCarried, next sync).
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
  const once = (): Promise<Outcome> => syncOnce(deps).catch((err) => {
    const note = err instanceof Error ? err.message : String(err)
    useHidesSync.setState({ status: 'error', note })
    return { wrote: 0, note }
  })
  // Another write landed between this sync's read and its write: read, merge and sign again, a few times.
  const run = async (): Promise<Outcome> => {
    let out = await once()
    for (let n = 0; out.raced && n < 3; n++) out = await once()
    return out
  }
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
  // A new change starts a new round of read-backs.
  verifies = 0
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
  adopt: async () => ({}),
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
  unopened = { me: '', ls: new Set() }
  failed.clear()
  if (timer) clearTimeout(timer)
  if (verifyTimer) clearTimeout(verifyTimer)
  timer = verifyTimer = null
  verifies = 0
  queue = Promise.resolve()
}
