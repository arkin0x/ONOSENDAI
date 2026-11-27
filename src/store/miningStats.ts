/**
 * miningStats.ts: your MINING stats, counted here and saved to the relay so
 * every device signed in as you shows the same totals (owner, 2026-11-27).
 * The record, its format and its merge are lib/miningRecord.ts; this is the
 * counting, and when the record is read and written.
 *
 * COUNTING. The TERRAIN code paths call noteMining (a survey completed, a
 * block mined or placed, a smash, a compile, a prize taken, the Compiler
 * crafted, a blueprint made, left or found), and the live wiring adds the
 * time in TERRAIN (store/miningStatsLive.ts). Nothing is counted while a
 * tutorial run is going. Counts are kept per identity in IndexedDB
 * (lib/kvStore.ts, `onosendai:mining:<pubkey>`; owner, 2026-11-19: all local
 * data per npub, and switching never deletes), with this device's random id
 * for that identity. Unique chunks are deduped against a set of salted hashes
 * kept on this device alone (`onosendai:mining:chunks:<pubkey>`); only the
 * count goes in the record.
 *
 * THE SIGNER'S COST. A remote signer (Amber on a tablet) asks for every
 * signature, so nothing is written per action. A change marks the record
 * dirty; it is written at most once every WRITE_EVERY_MS, and also when the
 * page is hidden or unloads (best effort) and when the MINING panel opens,
 * those two no more than once every NUDGE_FLOOR_MS. One write is one sign,
 * plus one encrypt only the first time (to wrap a new record key). A load
 * costs one decrypt, at the first sync, which waits for the panel or the
 * first write: a player who never mines is never asked.
 *
 * WRITING. Every write reads the relays first and merges (a G-counter per
 * device, so nothing is ever lost). Nothing is written:
 *   - in LOCAL (nothing is read then either);
 *   - while a tutorial run is going;
 *   - when the canonical relay did not answer, or the record on it did not
 *     open with your signer;
 *   - with Settings' "Sync mining stats" off, or a signer without NIP-44.
 * After signing, the relays are read again, and if another device wrote
 * meanwhile, nothing is sent and the sync runs again.
 */

import { create } from 'zustand'
import { verifyEvent } from 'nostr-tools/pure'
import type { Filter } from 'nostr-tools/filter'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, type EventTemplate, type NostrEvent } from '../lib/events'
import { kvStorage } from '../lib/kvStore'
import {
  COUNTERS, MINING_D, MINING_KIND, dayNumber, decodeRecord, emptyDevice, emptyRecord, isDeviceId, longestStreak, mergeRecords,
  newDeviceId, newRecordKey, newestRecord, openRecord, planRecord, recordContent, recordTemplate, sameRecord, sealRecord, validRecord, withDay,
  type Counter, type MiningRecord,
} from '../lib/miningRecord'
import type { PublishResult } from '../lib/relay'

/** At most one write in this long, however much changes. */
export const WRITE_EVERY_MS = 10 * 60_000
/** A write waits this long after a change, so a burst of mining is one write. */
export const QUIET_MS = 20_000
/** After a sync that did not write (the relay did not answer, a refusal), the next waits at least this long. */
export const RETRY_MS = 2 * 60_000
/** A write because the page was hidden or the panel opened waits at least this long after the last. */
export const NUDGE_FLOOR_MS = 60_000
/** How long after a write it is read back, in case another device wrote over it. */
const VERIFY_MS = 9000

const SETTING_KEY = 'onosendai:mining-sync'
export const MINING_PREFIX = 'onosendai:mining:'
const recordKey = (me: string): string => `${MINING_PREFIX}${me}`
const chunksKey = (me: string): string => `${MINING_PREFIX}chunks:${me}`
/** The most chunk hashes kept for dedupe: past it the oldest go (a chunk surveyed again then counts once more). */
const MAX_CHUNK_HASHES = 20_000

/** Signer's self-to-self NIP-44, as useCyberspace selfCrypto gives it. */
export interface SelfNip44 {
  nip44Encrypt?: (plaintext: string) => Promise<string>
  nip44Decrypt?: (payload: string) => Promise<string>
}

/** What the stats need from the outside world; replaced in tests (setMiningDeps). */
export interface MiningDeps {
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
  /** The device's own switch (localStorage, like the hidden list's). */
  prefs: Pick<Storage, 'getItem' | 'setItem'> | null
  verify: (ev: NostrEvent) => boolean
}

/** This identity's side, as kept on this device. */
export interface MiningLocal {
  v: 1
  /** This device's id for this identity. */
  device: string
  /** The salt of the chunk hashes, never published. */
  salt: string
  /** Everything known: this device's entry (only it raises it) and every other device's as last read. */
  rec: MiningRecord
  /** Bumped on every change here. */
  rev: number
  /** The rev the relay holds: dirty while it is behind rev. */
  synced: number
  /** When a write was last tried (ms): the throttle. */
  triedAt: number
  /** When the relay last answered a read or took a write (ms), or 0. */
  syncedAt: number
  /** created_at of this device's last write: a read older than it is a stale copy. */
  wroteAt: number
}

export type MiningStatus = 'idle' | 'syncing' | 'synced' | 'off' | 'local' | 'unsupported' | 'error'

interface MiningState {
  enabled: boolean
  status: MiningStatus
  note: string | null
  /** Ticks on every change, so the panel draws again. */
  flips: number
  setEnabled: (on: boolean) => void
}

function loadEnabled(prefs: MiningDeps['prefs']): boolean {
  try { return prefs?.getItem(SETTING_KEY) !== '0' } catch { return true }
}

export const useMiningStats = create<MiningState>((set) => ({
  enabled: true,
  status: 'idle',
  note: null,
  flips: 0,
  setEnabled: (on) => {
    try { deps.prefs?.setItem(SETTING_KEY, on ? '1' : '0') } catch { /* private mode */ }
    set({ enabled: on, status: on ? 'idle' : 'off', note: null })
    if (on) { failed.clear(); if (isDirty(deps.self())) schedule() }
    else cancelTimer()
  },
}))

function flip(): void { useMiningStats.setState((s) => ({ flips: s.flips + 1 })) }

// -- this device's side ------------------------------------------------------

/** Parsed once per text: the panel reads this on every draw. */
const cache = new Map<string, { raw: string | null; local: MiningLocal }>()

function fresh(): MiningLocal {
  return { v: 1, device: newDeviceId(), salt: bytesToHex(newRecordKey()), rec: emptyRecord(), rev: 0, synced: 0, triedAt: 0, syncedAt: 0, wroteAt: 0 }
}

/** This identity's side, made (with a new device id) the first time it is asked for; with `create` false, an unsaved empty one. */
export function localFor(me: string, D: MiningDeps = deps, create = true): MiningLocal {
  let raw: string | null = null
  try { raw = D.storage?.getItem(recordKey(me)) ?? null } catch { /* unreadable: as new */ }
  const was = cache.get(me)
  if (was && was.raw === raw) return was.local
  let local: MiningLocal | null = null
  if (raw) {
    try {
      const v = JSON.parse(raw) as Partial<MiningLocal>
      if (isDeviceId(v.device) && typeof v.salt === 'string' && /^[0-9a-f]{64}$/.test(v.salt)) {
        const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0)
        local = { v: 1, device: v.device, salt: v.salt, rec: validRecord(v.rec), rev: num(v.rev), synced: num(v.synced), triedAt: num(v.triedAt), syncedAt: num(v.syncedAt), wroteAt: num(v.wroteAt) }
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

function saveLocal(me: string, local: MiningLocal, D: MiningDeps = deps): void {
  if (!D.storage) { cache.set(me, { raw: null, local }); return }
  const raw = JSON.stringify(local)
  try { D.storage?.setItem(recordKey(me), raw) } catch { /* quota: kept in memory below */ }
  // What storage gives back is the record from now on (a refused write is this page's memory alone).
  let back: string | null = raw
  try { back = D.storage?.getItem(recordKey(me)) ?? raw } catch { back = raw }
  cache.set(me, { raw: back, local })
}

/** Whether this identity has changes the relay does not hold yet. */
export function isDirty(me: string, D: MiningDeps = deps): boolean {
  if (!me) return false
  const l = localFor(me, D, false)
  return l.rev > l.synced
}

/** Everything known for this identity: every device's numbers. */
export function miningRecordFor(me: string): MiningRecord {
  return me ? localFor(me, deps, false).rec : emptyRecord()
}

/** One thing done, as the code paths report it. */
export type MiningEvent =
  | { type: 'survey'; chunk: string }
  | { type: 'mine'; kind: number }
  | { type: 'place'; air: boolean }
  | { type: 'smash'; bare: boolean; blocks: number }
  | { type: 'compile' }
  | { type: 'prize' }
  | { type: 'compiler' }
  | { type: 'blueprint'; what: 'made' | 'placed' | 'found' }

/** Whether a chunk is new to this device's dedupe set (and adds it). Salted, never published. */
function newChunk(me: string, salt: string, chunk: string, D: MiningDeps): boolean {
  const h = bytesToHex(sha256(new TextEncoder().encode(`${salt}:${chunk}`))).slice(0, 16)
  let list: string[] = []
  try { const raw = D.storage?.getItem(chunksKey(me)); if (raw) list = JSON.parse(raw) as string[] } catch { list = [] }
  if (!Array.isArray(list)) list = []
  if (list.includes(h)) return false
  list.push(h)
  if (list.length > MAX_CHUNK_HASHES) list = list.slice(list.length - MAX_CHUNK_HASHES)
  try { D.storage?.setItem(chunksKey(me), JSON.stringify(list)) } catch { /* full: counted anyway */ }
  return true
}

/** Count something done, for `who` (the identity on screen when not given). Never during a tutorial run. */
export function noteMining(ev: MiningEvent, who?: string): void {
  const D = deps
  const me = who ?? D.self()
  if (!me || D.tutorial(me)) return
  const local = localFor(me, D)
  const dev = { ...(local.rec.devices[local.device] ?? emptyDevice()) }
  const c = { ...dev.c }
  const k = { ...dev.k }
  const add = (name: Counter, n = 1): void => { if (n > 0) c[name] = (c[name] ?? 0) + n }
  const nowS = Math.floor(D.now() / 1000)
  const first = { ...local.rec.first }
  switch (ev.type) {
    case 'survey':
      add('surveys')
      if (newChunk(me, local.salt, ev.chunk, D)) add('chunks')
      first.survey = Math.min(first.survey ?? nowS, nowS)
      break
    case 'mine':
      add('mined')
      if (ev.kind > 0 && ev.kind < 256) k[String(ev.kind)] = (k[String(ev.kind)] ?? 0) + 1
      break
    case 'place': add('placed'); if (ev.air) add('placedAir'); break
    case 'smash': add('smashes'); add(ev.bare ? 'smashBare' : 'smashCompiler'); add('smashed', ev.blocks); break
    case 'compile': add('compiles'); break
    case 'prize': add('prizes'); break
    case 'compiler': first.compiler = Math.min(first.compiler ?? nowS, nowS); break
    case 'blueprint': add(ev.what === 'made' ? 'bpMade' : ev.what === 'placed' ? 'bpPlaced' : 'bpFound'); break
  }
  // A day with any mining: making and finding blueprints is not mining.
  const active = ev.type !== 'blueprint'
  const days = active ? withDay(local.rec.days, dayNumber(D.now())) : local.rec.days
  const rec: MiningRecord = { ...local.rec, devices: { ...local.rec.devices, [local.device]: { c, k, u: nowS } }, first, days }
  rec.best = { ...rec.best, streak: Math.max(rec.best.streak ?? 0, longestStreak(rec)) || undefined }
  if (!rec.best.streak) delete rec.best.streak
  changed(me, { ...local, rec, rev: local.rev + 1 }, D)
}

/** Time in TERRAIN on screen, for `who`. Whole seconds are counted; the rest waits for the next call. */
const carry = new Map<string, number>()
export function addTerrainTime(seconds: number, who?: string): void {
  const D = deps
  const me = who ?? D.self()
  if (!me || !(seconds > 0) || D.tutorial(me)) return
  const total = (carry.get(me) ?? 0) + seconds
  const whole = Math.floor(total)
  carry.set(me, total - whole)
  if (whole < 1) return
  const local = localFor(me, D)
  const dev = local.rec.devices[local.device] ?? emptyDevice()
  const c = { ...dev.c, terrainSec: (dev.c.terrainSec ?? 0) + whole }
  const rec: MiningRecord = { ...local.rec, devices: { ...local.rec.devices, [local.device]: { ...dev, c, u: Math.floor(D.now() / 1000) } } }
  changed(me, { ...local, rec, rev: local.rev + 1 }, D)
}

function changed(me: string, local: MiningLocal, D: MiningDeps): void {
  saveLocal(me, local, D)
  flip()
  if (useMiningStats.getState().enabled && me === D.self()) schedule()
}

// -- the relay's side ----------------------------------------------------------

/** Record keys opened this load, by their wrapped form, for one identity. */
let opened: { me: string; keys: Map<string, Uint8Array> } = { me: '', keys: new Map() }
/** Wrapped keys the signer refused this load: not asked again until the switch is turned on again. */
const failed = new Set<string>()

function keysFor(me: string): Map<string, Uint8Array> {
  if (opened.me !== me) { opened = { me, keys: new Map() }; failed.clear() }
  return opened.keys
}

const FILTER = (me: string): Filter => ({ kinds: [MINING_KIND], authors: [me], '#d': [MINING_D] })

const NOT_ANSWERED = 'The relay did not answer, so your mining stats were not saved to it this time.'
const NOT_OPENED = 'Your saved mining stats did not open with your signer, so they were left as they are.'
const STALE = 'The relay answered with an older copy of your mining stats, so they were left as they are for now.'
const NO_NIP44 = 'Your signer has no NIP-44 encryption, so your mining stats stay on this device.'
/** A read older than this device's own last write is not written over for this long. */
const STALE_PATIENCE_S = 86_400

interface RemoteRead {
  rec: MiningRecord
  id: string | null
  createdAt: number
  key: { wrapped: string; key: Uint8Array } | null
  why: string | null
  unsupported: boolean
  trouble: boolean
}

async function readRemote(me: string, crypto: SelfNip44, D: MiningDeps): Promise<RemoteRead> {
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

function mayWrite(D: MiningDeps, me: string): boolean {
  return D.self() === me && D.live() && !D.tutorial(me) && useMiningStats.getState().enabled
}

async function syncOnce(D: MiningDeps, write: boolean): Promise<Outcome> {
  const me = D.self()
  const none: Outcome = { wrote: false }
  if (!me) return none
  const done = (status: MiningStatus, note: string | null = null): Outcome => { useMiningStats.setState({ status, note }); return none }
  if (!useMiningStats.getState().enabled) return done('off')
  if (!D.live()) return done('local')
  if (D.tutorial(me)) return done('idle')
  const crypto = D.crypto()
  if (!crypto.nip44Decrypt) return done('unsupported', NO_NIP44)
  useMiningStats.setState({ status: 'syncing' })
  const remote = await readRemote(me, crypto, D)
  if (D.self() !== me) return none
  if (remote.unsupported) return done('unsupported', NO_NIP44)
  if (remote.trouble) return done('error', NOT_ANSWERED)
  if (remote.why) return done('error', remote.why)
  // Every other device's numbers, folded in: a G-counter loses nothing either way.
  let local = localFor(me, D)
  const merged = mergeRecords(local.rec, remote.rec)
  const behind = !sameRecord(merged, remote.rec)
  // In step with the relay: nothing of this device's is missing from it.
  local = { ...local, rec: merged, syncedAt: D.now(), ...(behind ? {} : { synced: local.rev }) }
  saveLocal(me, local, D)
  flip()
  if (!behind) return done('synced')
  if (!write || !mayWrite(D, me)) return done('idle')
  // A copy older than this device's own last write: the relay answered with a stale copy. Left for a day.
  if (remote.createdAt < local.wroteAt && D.now() / 1000 - local.wroteAt < STALE_PATIENCE_S) return done('error', STALE)
  let text: string
  try { text = planRecord(merged) } catch (err) { return done('error', err instanceof Error ? err.message : String(err)) }
  const rev = local.rev
  // The throttle counts tries, so a refusal is not asked again until the next window.
  saveLocal(me, { ...local, triedAt: D.now() }, D)
  let key = remote.key
  if (!key) {
    if (!crypto.nip44Encrypt) return done('unsupported', NO_NIP44)
    const fresh = newRecordKey()
    let wrapped: string
    try { wrapped = await crypto.nip44Encrypt(bytesToHex(fresh)) } catch (err) {
      return /no NIP-44/i.test(err instanceof Error ? err.message : String(err)) ? done('unsupported', NO_NIP44) : done('error', `Your signer did not encrypt your mining stats: ${err instanceof Error ? err.message : String(err)}`)
    }
    key = { wrapped, key: fresh }
    keysFor(me).set(wrapped, fresh)
  }
  if (!mayWrite(D, me)) return none
  const createdAt = Math.max(Math.floor(D.now() / 1000), remote.createdAt + 1)
  let ev: NostrEvent
  try { ev = await D.sign(recordTemplate(sealRecord(text, key.key, key.wrapped), createdAt)) } catch (err) {
    return done('error', `Your mining stats were not signed: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (ev.pubkey !== me || !mayWrite(D, me)) return none
  // A signer may take minutes: another device's write meanwhile means read, merge and sign again.
  const again = await D.fetch(FILTER(me))
  if (again.trouble) return done('error', NOT_ANSWERED)
  if ((newestRecord(again.events.filter((e) => D.verify(e)), me)?.id ?? null) !== remote.id) return { wrote: false, raced: true }
  if (!mayWrite(D, me)) return none
  const res = await D.publish(ev)
  if (!res.ok) return done('error', `Your mining stats were not saved to the relay (${res.reason}).`)
  const now = localFor(me, D)
  saveLocal(me, { ...now, synced: Math.max(now.synced, rev), syncedAt: D.now(), wroteAt: ev.created_at }, D)
  flip()
  useMiningStats.setState({ status: 'synced', note: null })
  return { wrote: true }
}

// -- when ---------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | null = null
let timerAt = 0
let verifyTimer: ReturnType<typeof setTimeout> | null = null

/** One sync after any already running. `write` false only reads (and folds in the other devices). */
export function syncMining(write = true): Promise<Outcome> {
  const once = (): Promise<Outcome> => syncOnce(deps, write).catch((err) => {
    useMiningStats.setState({ status: 'error', note: err instanceof Error ? err.message : String(err) })
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
    // Read back once a little later: another device's write may have landed over it.
    if (out.wrote) {
      if (verifyTimer) clearTimeout(verifyTimer)
      verifyTimer = setTimeout(() => { verifyTimer = null; void syncMining(false) }, VERIFY_MS)
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
 * `wait`), and no sooner than WRITE_EVERY_MS after the last try. Not in LOCAL:
 * going LIVE schedules it (store/miningStatsLive.ts).
 */
export function schedule(wait = QUIET_MS): void {
  const D = deps
  const me = D.self()
  if (!me || !useMiningStats.getState().enabled || !D.live() || !isDirty(me, D)) return
  const now = D.now()
  const due = Math.max(now + Math.max(wait, QUIET_MS), localFor(me, D).triedAt + WRITE_EVERY_MS)
  if (timer && timerAt <= due) return
  cancelTimer()
  timerAt = due
  timer = setTimeout(() => { timer = null; timerAt = 0; void syncMining(true) }, due - now)
}

/**
 * The page is going (hidden or unloading) or the MINING panel opened: write
 * now when dirty, no sooner than NUDGE_FLOOR_MS after the last try. The panel
 * also reads, when it has not for a minute, to show the other devices.
 */
export function nudgeMining(why: 'hide' | 'panel'): void {
  const D = deps
  const me = D.self()
  if (!me || !useMiningStats.getState().enabled) return
  const local = localFor(me, D, false)
  const dirty = local.rev > local.synced
  const now = D.now()
  if (dirty && now - local.triedAt >= NUDGE_FLOOR_MS) { cancelTimer(); void syncMining(true); return }
  if (why === 'panel' && now - local.syncedAt >= NUDGE_FLOOR_MS) void syncMining(false)
}

/** Another identity on screen: its own timer, if it has something to write. */
export function identityChanged(): void {
  cancelTimer()
  useMiningStats.setState({ status: 'idle', note: null })
  flip()
  schedule()
}

// -- deps ---------------------------------------------------------------------

const ls = (): Storage | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null } catch { return null } }

const offline: MiningDeps = {
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
}

let deps: MiningDeps = offline

/** Set the outside world (startMiningStats, and tests). Returns the previous deps. */
export function setMiningDeps(next: Partial<MiningDeps> | null): MiningDeps {
  const prev = deps
  deps = next ? { ...offline, ...next } : offline
  useMiningStats.setState({ enabled: loadEnabled(deps.prefs) })
  return prev
}

/** Tests only: forget keys opened, timers, the queue and the parse cache. */
export function resetMiningStats(): void {
  opened = { me: '', keys: new Map() }
  failed.clear()
  cache.clear()
  carry.clear()
  cancelTimer()
  if (verifyTimer) clearTimeout(verifyTimer)
  verifyTimer = null
  queue = Promise.resolve()
  useMiningStats.setState({ status: 'idle', note: null, flips: 0 })
}

/** For the panel: the counters' names, in the record's order. */
export { COUNTERS }
