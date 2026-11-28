/**
 * starredChunks.ts: your saved (starred) TERRAIN chunks, kept here first and
 * saved to the relay so every device signed in as you lists them (owner,
 * 2026-11-28: "How can we provide a UI UX to save and star this chunk so that
 * I can find it later. I don't want to lose track of myself while I'm
 * navigating around and forget what chunk had the glowcore"). The record, its
 * format and its merge are lib/starredChunksRecord.ts; this is the list as the
 * app uses it, the guide to one of them, and when the record is read and
 * written.
 *
 * LOCAL FIRST. The list is kept per identity in IndexedDB (lib/kvStore.ts,
 * `onosendai:starred-chunks:<pubkey>`; owner, 2026-11-19: all local data per
 * npub, and switching never deletes). Starring, renaming and removing work in
 * LOCAL, in the tutorial and with sync off; they wait on this device until a
 * write is allowed.
 *
 * THE GUIDE. One saved chunk at a time can be the target: its WAYPOINT (the
 * gold beacon in the world, scene/StarredChunkMarks.tsx) and its HUD TARGET
 * (the marker on screen, hooks/useTargets.ts) each on or off by itself;
 * picking another chunk moves both to it. It ends when you arrive
 * (store/starredChunksLive.ts) or both are switched off. Never published: the
 * beacon and the marker are this device's alone.
 *
 * THE SIGNER'S COST, as MINING's (#951): a remote signer asks for every
 * signature, so nothing is written per action.
 *   - Starring, renaming and removing mark the record dirty. A fresh snapshot
 *     of a saved chunk's card (you mined there) never does: it rides along
 *     with the next real change.
 *   - A dirty record is written at most once every WRITE_EVERY_MS (a race
 *     with another device's write can sign again, at most twice, as MINING's): QUIET_MS
 *     after the change (so a star and its rename are one write), or as soon as
 *     the last try is WRITE_EVERY_MS old. Hiding the page writes a dirty
 *     record too, held to the same floor since the last try.
 * So an hour of play costs at most about six signatures, and a player who
 * never stars a chunk is never asked. One write is one sign, plus one encrypt
 * only the first time (to wrap a new record key); a load costs one decrypt.
 *
 * WRITING. Every write reads the relays first and merges (tombstones keep a
 * removal removed). Nothing is written:
 *   - in LOCAL (nothing is read then either);
 *   - while a tutorial run is going;
 *   - when the canonical relay did not answer, or the record on it did not
 *     open with your signer;
 *   - with Settings' "Sync starred chunks" off, or a signer without NIP-44.
 * After signing, the relays are read again, and if another device wrote
 * meanwhile, nothing is sent and the sync runs again.
 */

import { create } from 'zustand'
import { verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from '../lib/events'
import { kvStorage, kvUpdate } from '../lib/kvStore'
import {
  MAX_STARRED_CHUNKS, STARRED_D, STARRED_KIND, cleanNote, decodeRecord, emptyRecord, entriesOf, fitRecord, mergeRecords, newRecordKey, newestRecord, openRecord,
  recordContent, recordTemplate, sameRecord, sealRecord, validEntry,
  type ChunkSnapshot, type StarEntry, type StarredRecord,
} from '../lib/starredChunksRecord'
import { sameSnapshot } from '../lib/terrain/starredChunk'
import type { PublishResult } from '../lib/relay'

/** At most one write in this long, however much changes. */
export const WRITE_EVERY_MS = 10 * 60_000
/** A write waits this long after a change, so a star and the name you give it are one write. */
export const QUIET_MS = 20_000
/** After a sync that did not write (the relay did not answer, a refusal), the next waits at least this long. */
export const RETRY_MS = 2 * 60_000
/** A write because the page was hidden waits at least this long after the last try. */
export const HIDE_FLOOR_MS = WRITE_EVERY_MS
/** The list on screen reads (never writes) at most this often. */
export const READ_FLOOR_MS = 60_000
/** How long REMOVE's UNDO stays. */
export const UNDO_MS = 10_000
/** How long after a write it is read back, in case another device wrote over it. */
const VERIFY_MS = 9000

const SETTING_KEY = 'onosendai:starred-sync'
export const STARRED_PREFIX = 'onosendai:starred-chunks:'
const recordKey = (me: string): string => `${STARRED_PREFIX}${me}`

/** Signer's self-to-self NIP-44, as useCyberspace selfCrypto gives it. */
export interface SelfNip44 {
  nip44Encrypt?: (plaintext: string) => Promise<string>
  nip44Decrypt?: (payload: string) => Promise<string>
}

/** What the list needs from the outside world; replaced in tests (setStarredDeps). */
export interface StarredDeps {
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
  /** A stored record changed in one step no other tab interleaves with, from the record as stored (kvStore kvUpdate). */
  update: (key: string, fn: (stored: string | null) => string | null) => Promise<string | null>
  /** A lock across the device's tabs (a Web Lock), so one tab syncs at a time and the throttle is shared. */
  lock: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  /** The device's own switch (localStorage, like the hidden list's). */
  prefs: Pick<Storage, 'getItem' | 'setItem'> | null
  verify: (ev: NostrEvent) => boolean
}

/** This identity's list, as kept on this device. */
export interface StarredLocal {
  v: 1
  rec: StarredRecord
  /** Bumped on every change here, a fresh snapshot included. */
  rev: number
  /** Bumped on every star, rename and removal: what makes a write worth a signature. */
  real: number
  /** The `real` the relay holds: dirty while it is behind `real`. */
  syncedReal: number
  /** When a write was last tried (ms): the throttle. */
  triedAt: number
  /** When the relay last answered a read or took a write (ms), or 0. */
  syncedAt: number
  /** created_at of this device's last write: a read older than it is a stale copy. */
  wroteAt: number
}

export type StarredStatus = 'idle' | 'syncing' | 'synced' | 'off' | 'local' | 'unsupported' | 'error'

/** The guide to one saved chunk: its beacon and its marker, each on or off. */
export interface ChunkGuide {
  key: string
  waypoint: boolean
  hud: boolean
}

interface StarredState {
  enabled: boolean
  status: StarredStatus
  note: string | null
  /** The identity on screen's saved chunks, newest starred first. */
  entries: StarEntry[]
  /** Their keys, for a quick "is this one starred". */
  keys: ReadonlySet<string>
  /** The saved chunk being guided to, or null. */
  guide: ChunkGuide | null
  /** The chunk just removed, for UNDO, until `until` (ms). */
  removed: { entry: StarEntry; until: number } | null
  setEnabled: (on: boolean) => void
}

function loadEnabled(prefs: StarredDeps['prefs']): boolean {
  try { return prefs?.getItem(SETTING_KEY) !== '0' } catch { return true }
}

export const useStarredChunks = create<StarredState>((set) => ({
  enabled: true,
  status: 'idle',
  note: null,
  entries: [],
  keys: new Set(),
  guide: null,
  removed: null,
  setEnabled: (on) => {
    try { deps.prefs?.setItem(SETTING_KEY, on ? '1' : '0') } catch { /* private mode */ }
    set({ enabled: on, status: on ? 'idle' : 'off', note: null })
    if (on) { failed.clear(); if (isDirty(deps.self())) schedule() }
    else cancelTimer()
  },
}))

/** The list on screen again, from what is kept for the identity on screen. */
function publishList(): void {
  const me = deps.self()
  const entries = me ? entriesOf(localFor(me, deps).rec) : []
  const keys = new Set(entries.map((e) => e.c))
  // A guide whose chunk left the list (removed here or on another device) ends: nothing would be left to switch it off.
  const guide = useStarredChunks.getState().guide
  useStarredChunks.setState({ entries, keys, ...(guide && !keys.has(guide.key) ? { guide: null } : {}) })
}

// -- this device's side ------------------------------------------------------

/** Parsed once per text. */
const cache = new Map<string, { raw: string | null; local: StarredLocal }>()

function fresh(): StarredLocal {
  return { v: 1, rec: emptyRecord(), rev: 0, real: 0, syncedReal: 0, triedAt: 0, syncedAt: 0, wroteAt: 0 }
}

/** Every entry and tombstone of `o` that reads; anything malformed dropped alone. */
function readRecord(o: unknown): StarredRecord {
  const out = emptyRecord()
  if (!o || typeof o !== 'object') return out
  const v = o as { e?: unknown; x?: unknown }
  for (const raw of Object.values(v.e && typeof v.e === 'object' ? (v.e as Record<string, unknown>) : {})) {
    const e = validEntry(raw)
    if (e) out.e[e.c] = e
  }
  for (const [c, t] of Object.entries(v.x && typeof v.x === 'object' ? (v.x as Record<string, unknown>) : {})) {
    if (typeof t === 'number' && Number.isInteger(t) && t >= 0) out.x[c] = t
  }
  return mergeRecords(out, emptyRecord())
}

/** A stored list as text, read; an empty one when there is none. A record that does not read is kept aside, never written over. */
function parseLocal(raw: string | null, me: string, D: StarredDeps): StarredLocal {
  if (!raw) return fresh()
  try {
    const v = JSON.parse(raw) as Partial<StarredLocal>
    const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0)
    return { v: 1, rec: readRecord(v.rec), rev: num(v.rev), real: num(v.real), syncedReal: num(v.syncedReal), triedAt: num(v.triedAt), syncedAt: num(v.syncedAt), wroteAt: num(v.wroteAt) }
  } catch {
    try { D.storage?.setItem(`${recordKey(me)}:unread:${D.now()}`, raw) } catch { /* full */ }
    return fresh()
  }
}

/** This identity's list as this tab knows it: the stored copy (refreshed when another tab writes it), with this tab's changes on their way. */
export function localFor(me: string, D: StarredDeps = deps): StarredLocal {
  let raw: string | null = null
  try { raw = D.storage?.getItem(recordKey(me)) ?? null } catch { /* unreadable: as new */ }
  const was = cache.get(me)
  if (was && was.raw === raw) return was.local
  const local = parseLocal(raw, me, D)
  cache.set(me, { raw: D.storage ? raw : null, local })
  return local
}

/**
 * Another tab wrote the stored list (kvStore re-reads it and raises a
 * `storage` event, store/starredChunksLive.ts): the list on screen again,
 * and this tab's timer moved to the device's shared window.
 */
export function heardElsewhere(key: string | null): void {
  const me = deps.self()
  if (!me || (key !== null && key !== recordKey(me))) return
  publishList()
  if (isDirty(me)) schedule()
}

/** This tab's writes to the stored list, in order. */
let writes: Promise<unknown> = Promise.resolve()

/** For tests: every write this tab has queued, landed. */
export function starredWrites(): Promise<unknown> {
  return writes
}

/**
 * Change this identity's list (review of #968: two tabs lost each other's
 * stars). `fn` is applied to this tab's copy at once, for the screen, and
 * again to the copy as stored, in one step no other tab interleaves with
 * (kvStore kvUpdate: a Web Lock and one IndexedDB transaction), so a change
 * another tab made is never written over by this tab's older copy. Returns
 * what this tab now shows, or null when `fn` changed nothing.
 */
function commit(me: string, D: StarredDeps, fn: (l: StarredLocal) => StarredLocal | null): StarredLocal | null {
  const cur = localFor(me, D)
  const next = fn(cur)
  if (!next) return null
  cache.set(me, { raw: cache.get(me)?.raw ?? null, local: next })
  // No storage at all: this tab's memory is the only copy.
  if (!D.storage) return next
  const key = recordKey(me)
  const p = writes.then(() => D.update(key, (stored) => {
    const l = fn(parseLocal(stored, me, D))
    return l ? JSON.stringify(l) : stored
  })).then((raw) => {
    // What is stored now is this tab's copy from here on.
    cache.set(me, { raw, local: parseLocal(raw, me, D) })
    if (me === D.self()) publishList()
  }, () => { /* storage refused: this tab keeps its copy, and the next change tries again */ })
  writes = p
  return next
}

/** The list as stored now (another tab's last write included), once this tab's own writes have landed. */
async function readStored(me: string, D: StarredDeps): Promise<StarredLocal> {
  await writes
  if (!D.storage) return localFor(me, D)
  const raw = await D.update(recordKey(me), (stored) => stored).catch(() => undefined)
  if (raw === undefined) return localFor(me, D)
  const local = parseLocal(raw, me, D)
  cache.set(me, { raw: D.storage ? raw : null, local })
  return local
}

/** Whether this identity has stars, renames or removals the relay does not hold yet. */
export function isDirty(me: string, D: StarredDeps = deps): boolean {
  if (!me) return false
  const l = localFor(me, D)
  return l.real > l.syncedReal
}

/** The saved chunk `key` of the identity on screen, or null. */
export function starredEntry(key: string): StarEntry | null {
  const me = deps.self()
  return me ? localFor(me).rec.e[key] ?? null : null
}

/** One change to the identity on screen's record, through `edit`; `real` when it is worth a signature. */
function edit(real: boolean, fn: (rec: StarredRecord, nowS: number) => StarredRecord | null): boolean {
  const D = deps
  const me = D.self()
  if (!me) return false
  const nowS = Math.floor(D.now() / 1000)
  const next = commit(me, D, (l) => {
    const rec = fn(l.rec, nowS)
    return rec ? { ...l, rec, rev: l.rev + 1, real: l.real + (real ? 1 : 0) } : null
  })
  if (!next) return false
  publishList()
  if (real && useStarredChunks.getState().enabled) schedule()
  return true
}

/** Why a star did or did not take: taken, no room left in the record, or nobody signed in. */
export type StarResult = 'ok' | 'full' | 'no-identity'

/**
 * Star the chunk `key`, with its card as it is now, and say why when it does
 * not take. Starring one already starred keeps its date and note and takes
 * the fresh snapshot. Refused when the list would no longer fit one event
 * whole (lib/starredChunksRecord.ts fitRecord: old tombstones may be left out,
 * never a saved chunk or its card) or reaches MAX_STARRED_CHUNKS.
 */
export function starChunkWhy(key: string, snapshot: ChunkSnapshot | undefined): StarResult {
  if (!deps.self()) return 'no-identity'
  const ok = edit(true, (rec, now) => {
    const was = rec.e[key]
    if (!was && Object.keys(rec.e).length >= MAX_STARRED_CHUNKS) return null
    // Newer than anything it replaces, even against a clock that ran ahead elsewhere.
    const t = Math.max(now, was?.t ?? 0, (rec.x[key] ?? -1) + 1)
    const entry: StarEntry = was ? { ...was, t } : { c: key, a: now, t }
    if (snapshot) { entry.s = snapshot; entry.st = now }
    const x = { ...rec.x }
    delete x[key]
    const next = { e: { ...rec.e, [key]: entry }, x }
    // Never past what one event carries whole: refused here, at the star, never later at every write.
    const fit = fitRecord(next, now)
    return fit.folded || fit.dropped ? null : next
  })
  if (!ok) return 'full'
  clearUndoFor(key)
  return 'ok'
}

/** starChunkWhy, as yes or no. */
export function starChunk(key: string, snapshot: ChunkSnapshot | undefined): boolean {
  return starChunkWhy(key, snapshot) === 'ok'
}

/** A chunk starred again: the UNDO for its removal is moot. Always true. */
function clearUndoFor(key: string): true {
  if (useStarredChunks.getState().removed?.entry.c === key) useStarredChunks.setState({ removed: null })
  return true
}

/** Take the chunk `key` off the list, a tombstone left; UNDO stays for UNDO_MS. Returns the entry taken, or null. */
export function unstarChunk(key: string): StarEntry | null {
  const was = starredEntry(key)
  if (!was) return null
  edit(true, (rec, now) => {
    const e = { ...rec.e }
    delete e[key]
    // Past the entry as stored (another tab may have renamed it since), so the tombstone stands.
    return { e, x: { ...rec.x, [key]: Math.max(now, (rec.e[key]?.t ?? was.t) + 1, rec.x[key] ?? 0) } }
  })
  useStarredChunks.setState({ removed: { entry: was, until: deps.now() + UNDO_MS } })
  if (useStarredChunks.getState().guide?.key === key) useStarredChunks.setState({ guide: null })
  return was
}

/** UNDO: the chunk just removed, back as it was (its date, note and snapshot), newer than its tombstone. */
export function undoRemove(): boolean {
  const r = useStarredChunks.getState().removed
  if (!r) return false
  useStarredChunks.setState({ removed: null })
  return edit(true, (rec, now) => {
    const x = { ...rec.x }
    delete x[r.entry.c]
    const back: StarEntry = { ...r.entry, t: Math.max(now, (rec.x[r.entry.c] ?? 0) + 1) }
    return { e: { ...rec.e, [r.entry.c]: back }, x }
  })
}

/** Forget the UNDO once its time is up (the list calls this; nothing is lost, the removal stands). */
export function expireUndo(now = deps.now()): void {
  const r = useStarredChunks.getState().removed
  if (r && now >= r.until) useStarredChunks.setState({ removed: null })
}

/** Your note for the chunk `key`; an empty note clears it, and the chunk goes back to its finds for a name. */
export function renameChunk(key: string, typed: string): boolean {
  const note = cleanNote(typed)
  return edit(true, (rec, now) => {
    const was = rec.e[key]
    if (!was || (was.n ?? '') === note) return null
    const t = Math.max(now, was.t, was.nt ?? 0)
    const entry: StarEntry = { ...was, nt: Math.max(now, was.nt ?? 0), t }
    if (note) entry.n = note
    else delete entry.n
    return { ...rec, e: { ...rec.e, [key]: entry } }
  })
}

/**
 * A saved chunk's card as it is now (you are in it, or its card is open):
 * kept when it says something new, and written only with the next real
 * change. False when the chunk is not saved or nothing changed.
 */
export function refreshSnapshot(key: string, snapshot: ChunkSnapshot): boolean {
  return edit(false, (rec, now) => {
    const was = rec.e[key]
    if (!was || sameSnapshot(was.s, snapshot)) return null
    // Its own time only: the entry's (which a tombstone is weighed against) stays as it was.
    return { ...rec, e: { ...rec.e, [key]: { ...was, s: snapshot, st: Math.max(now, was.st ?? 0) } } }
  })
}

// -- the guide ---------------------------------------------------------------

function setGuide(key: string, part: 'waypoint' | 'hud', on: boolean): void {
  const g = useStarredChunks.getState().guide
  const base: ChunkGuide = g && g.key === key ? g : { key, waypoint: false, hud: false }
  const next = { ...base, [part]: on }
  useStarredChunks.setState({ guide: next.waypoint || next.hud ? next : null })
}

/** SET WAYPOINT: the gold beacon over the chunk `key`, on or off. Picking another chunk moves the guide to it. */
export function setWaypoint(key: string, on: boolean): void { setGuide(key, 'waypoint', on) }
/** HUD TARGET: the marker on screen for the chunk `key`, on or off. Picking another chunk moves the guide to it. */
export function setHudTarget(key: string, on: boolean): void { setGuide(key, 'hud', on) }
/** Both on: NAVIGATE's way to point at it. */
export function guideTo(key: string): void { useStarredChunks.setState({ guide: { key, waypoint: true, hud: true } }) }
export function endGuide(): void { if (useStarredChunks.getState().guide) useStarredChunks.setState({ guide: null }) }

// -- the relay's side ----------------------------------------------------------

/** Record keys opened this load, by their wrapped form, for one identity. */
let opened: { me: string; keys: Map<string, Uint8Array> } = { me: '', keys: new Map() }
/** Wrapped keys the signer refused this load: not asked again until the switch is turned on again. */
const failed = new Set<string>()
/** The record key wrapped for a first save this load: used again while that save keeps failing. */
let made: { me: string; wrapped: string; key: Uint8Array } | null = null

function keysFor(me: string): Map<string, Uint8Array> {
  if (opened.me !== me) { opened = { me, keys: new Map() }; failed.clear(); made = null }
  return opened.keys
}

const FILTER = (me: string): Filter => ({ kinds: [STARRED_KIND], authors: [me], '#d': [STARRED_D] })

const NOT_ANSWERED = 'The relay did not answer, so your saved chunks were not saved to it this time.'
const NOT_OPENED = 'Your saved chunks on the relay did not open with your signer, so they were left as they are.'
const STALE = 'The relay answered with an older copy of your saved chunks, so they were left as they are for now.'
const NO_NIP44 = 'Your signer has no NIP-44 encryption, so your saved chunks stay on this device.'
/** A read older than this device's own last write is not written over for this long. */
const STALE_PATIENCE_S = 86_400
/** The furthest past this device's clock an event is dated. */
const MAX_AHEAD_S = 60

interface RemoteRead {
  rec: StarredRecord
  id: string | null
  createdAt: number
  key: { wrapped: string; key: Uint8Array } | null
  why: string | null
  unsupported: boolean
  trouble: boolean
}

async function readRemote(me: string, crypto: SelfNip44, D: StarredDeps): Promise<RemoteRead> {
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

function mayWrite(D: StarredDeps, me: string): boolean {
  return D.self() === me && D.live() && !D.tutorial(me) && useStarredChunks.getState().enabled
}

/**
 * One sync, under a lock across the device's tabs, so one tab syncs at a time
 * and the 10-minute floor is the device's, not each tab's: `floor` (every
 * write but a race's retry) writes only when the stored list's last try is
 * WRITE_EVERY_MS old, else only reads.
 */
function syncOnce(D: StarredDeps, write: boolean, floor = true): Promise<Outcome> {
  const me = D.self()
  if (!me) return Promise.resolve({ wrote: false })
  return D.lock(`onosendai:starred-sync:${me}`, () => syncLocked(D, me, write, floor))
}

async function syncLocked(D: StarredDeps, me: string, write: boolean, floor: boolean): Promise<Outcome> {
  const none: Outcome = { wrote: false }
  if (D.self() !== me) return none
  const done = (status: StarredStatus, note: string | null = null): Outcome => { useStarredChunks.setState({ status, note }); return none }
  if (!useStarredChunks.getState().enabled) return done('off')
  if (!D.live()) return done('local')
  if (D.tutorial(me)) return done('idle')
  const crypto = D.crypto()
  if (!crypto.nip44Decrypt) return done('unsupported', NO_NIP44)
  useStarredChunks.setState({ status: 'syncing' })
  // Stopped part way (another identity, LOCAL, the tutorial, the switch): never left saying "syncing".
  const quit = (): Outcome => { if (D.self() === me) useStarredChunks.setState({ status: 'idle' }); return none }
  const remote = await readRemote(me, crypto, D)
  if (D.self() !== me) return none
  if (remote.unsupported) return done('unsupported', NO_NIP44)
  if (remote.trouble) return done('error', NOT_ANSWERED)
  if (remote.why) return done('error', remote.why)
  const nowS = Math.floor(D.now() / 1000)
  // The list as stored, with every tab's changes: never this tab's copy alone.
  const stored = await readStored(me, D)
  if (D.self() !== me) return none
  const merged = mergeRecords(stored.rec, remote.rec, nowS)
  const behind = !sameRecord(merged, remote.rec)
  const readReal = stored.real
  const syncedAt = D.now()
  // The relay's list folded in (a merge, so applying it to the stored copy again loses nothing another tab added).
  const local = commit(me, D, (l) => ({ ...l, rec: mergeRecords(l.rec, remote.rec, nowS), syncedAt, ...(behind ? {} : { syncedReal: Math.max(l.syncedReal, readReal) }) })) ?? stored
  publishList()
  if (!behind) return done('synced')
  // Behind by fresh snapshots alone: they wait for a real change. Only reading: what is new waits for the write.
  if (local.real <= local.syncedReal) return done('synced')
  if (!write || !mayWrite(D, me)) return done('idle')
  // Another tab tried within the window: its write stands for both, and this one waits.
  if (floor && stored.triedAt > 0 && D.now() - stored.triedAt < WRITE_EVERY_MS) return done('idle')
  if (remote.createdAt < local.wroteAt && nowS - local.wroteAt < STALE_PATIENCE_S) return done('error', STALE)
  // Always one event: whatever does not fit is left out of this write and kept on the device (fitRecord).
  const fit = fitRecord(merged, nowS)
  const text = fit.text
  const real = readReal
  // The throttle counts tries, so a refusal is not asked again until the next window; stored, so every tab sees it.
  const triedAt = D.now()
  commit(me, D, (l) => ({ ...l, triedAt: Math.max(l.triedAt, triedAt) }))
  await writes
  let key = remote.key
  if (!key && made && made.me === me) key = { wrapped: made.wrapped, key: made.key }
  if (!key) {
    if (!crypto.nip44Encrypt) return done('unsupported', NO_NIP44)
    const k = newRecordKey()
    let wrapped: string
    try { wrapped = await crypto.nip44Encrypt(bytesToHex(k)) } catch (err) {
      return /no NIP-44/i.test(err instanceof Error ? err.message : String(err)) ? done('unsupported', NO_NIP44) : done('error', `Your signer did not encrypt your saved chunks: ${err instanceof Error ? err.message : String(err)}`)
    }
    key = { wrapped, key: k }
    keysFor(me).set(wrapped, k)
    made = { me, wrapped, key: k }
  }
  if (!mayWrite(D, me)) return quit()
  const ahead = remote.createdAt + 1 > nowS + MAX_AHEAD_S
  const createdAt = ahead ? nowS : Math.max(nowS, remote.createdAt + 1)
  let ev: NostrEvent
  try { ev = await D.sign(recordTemplate(sealRecord(text, key.key, key.wrapped), createdAt)) } catch (err) {
    return done('error', `Your saved chunks were not signed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (ev.pubkey !== me || !mayWrite(D, me)) return quit()
  // A signer may take minutes: another device's write meanwhile means read, merge and sign again.
  const again = await D.fetch(FILTER(me))
  if (again.trouble) return done('error', NOT_ANSWERED)
  if ((newestRecord(again.events.filter((e) => D.verify(e)), me)?.id ?? null) !== remote.id) return { wrote: false, raced: true }
  if (!mayWrite(D, me)) return quit()
  const res = await D.publish(ev)
  if (!res.ok) return done('error', `Your saved chunks were not saved to the relay (${res.reason}).`)
  const at = D.now()
  commit(me, D, (l) => ({ ...l, syncedReal: Math.max(l.syncedReal, real), syncedAt: at, wroteAt: Math.max(l.wroteAt, ev.created_at) }))
  await writes
  useStarredChunks.setState({ status: 'synced', note: fit.dropped ? `${fit.dropped} saved ${fit.dropped === 1 ? 'chunk is' : 'chunks are'} too many for the relay and stay on this device.` : null })
  return { wrote: true }
}

// -- when ---------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | null = null
let timerAt = 0
let verifyTimer: ReturnType<typeof setTimeout> | null = null

/** One sync after any already running. `write` false only reads (and folds in the other devices). */
export function syncStarred(write = true): Promise<Outcome> {
  const once = (floor = true): Promise<Outcome> => syncOnce(deps, write, floor).catch((err) => {
    useStarredChunks.setState({ status: 'error', note: err instanceof Error ? err.message : String(err) })
    return { wrote: false }
  })
  const run = async (): Promise<Outcome> => {
    let out = await once()
    // A race's retry is the same try: it does not wait for the window again.
    for (let n = 0; out.raced && n < 2; n++) out = await once(false)
    return out
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p.then((out) => {
    if (out.wrote) {
      if (verifyTimer) clearTimeout(verifyTimer)
      verifyTimer = setTimeout(() => { verifyTimer = null; void syncStarred(false) }, VERIFY_MS)
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
 * The next write, when there is something to write: QUIET_MS after now (or
 * `wait`), and no sooner than WRITE_EVERY_MS after the last try. Not in
 * LOCAL: going LIVE schedules it (store/starredChunksLive.ts).
 */
export function schedule(wait = QUIET_MS): void {
  const D = deps
  const me = D.self()
  if (!me || !useStarredChunks.getState().enabled || !D.live() || !isDirty(me, D)) return
  const now = D.now()
  const due = Math.max(now + Math.max(wait, QUIET_MS), localFor(me, D).triedAt + WRITE_EVERY_MS)
  if (timer && timerAt <= due) return
  cancelTimer()
  timerAt = due
  timer = setTimeout(() => { timer = null; timerAt = 0; void syncStarred(true) }, due - now)
}

/**
 * The page is going (hidden or unloading): write now when dirty, no sooner
 * than HIDE_FLOOR_MS after the last try. The list on screen: read only, no
 * more than once a READ_FLOOR_MS; never a write.
 */
export function nudgeStarred(why: 'hide' | 'panel'): void {
  const D = deps
  const me = D.self()
  if (!me || !useStarredChunks.getState().enabled) return
  const local = localFor(me, D)
  const now = D.now()
  if (why === 'hide') {
    if (local.real > local.syncedReal && now - local.triedAt >= HIDE_FLOOR_MS) { cancelTimer(); void syncStarred(true) }
    return
  }
  if (now - local.syncedAt >= READ_FLOOR_MS) void syncStarred(false)
}

/** Another identity on screen: its own list, its own timer, and no guide carried over. */
export function identityChanged(): void {
  cancelTimer()
  useStarredChunks.setState({ status: 'idle', note: null, guide: null, removed: null })
  publishList()
  schedule()
}

// -- deps ---------------------------------------------------------------------

const ls = (): Storage | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null } }

/** A Web Lock across the device's tabs, where the browser has them. */
function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  return locks?.request ? locks.request(name, fn) as unknown as Promise<T> : fn()
}

/** `update` over a plain storage (tests, and storage handed in without one): read, change and write at once. */
function updateOver(storage: StarredDeps['storage']): StarredDeps['update'] {
  return async (key, fn) => {
    let raw: string | null = null
    try { raw = storage?.getItem(key) ?? null } catch { /* unreadable */ }
    const next = fn(raw)
    try { if (next === null) storage?.removeItem(key); else storage?.setItem(key, next) } catch { /* full: kept in this tab */ }
    return next
  }
}

const offline: StarredDeps = {
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
  prefs: ls(),
  verify: (ev) => verifyEvent({ ...ev } as Parameters<typeof verifyEvent>[0]),
}

let deps: StarredDeps = offline

/** Set the outside world (startStarredChunks, and tests). Returns the previous deps. */
export function setStarredDeps(next: Partial<StarredDeps> | null): StarredDeps {
  const prev = deps
  // Storage handed in without its own update (tests): one over it, never kvStore's over the real database.
  deps = next ? { ...offline, ...next, ...(next.storage !== undefined && !next.update ? { update: updateOver(next.storage) } : {}) } : offline
  useStarredChunks.setState({ enabled: loadEnabled(deps.prefs) })
  publishList()
  return prev
}

/** Tests only: forget keys opened, timers, the queue, the guide and the parse cache. */
export function resetStarredChunks(): void {
  opened = { me: '', keys: new Map() }
  failed.clear()
  made = null
  cache.clear()
  cancelTimer()
  if (verifyTimer) clearTimeout(verifyTimer)
  verifyTimer = null
  queue = Promise.resolve()
  writes = Promise.resolve()
  useStarredChunks.setState({ status: 'idle', note: null, entries: [], keys: new Set(), guide: null, removed: null })
}
