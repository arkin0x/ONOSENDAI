/**
 * useKeyring.ts: the locks of every key you carry, ready for a chest or a door
 * to be matched against (DECK-0004 §3.8.4; conjunction seals design §5.8,
 * §5.9 item 7, slice 1).
 *
 * Your keyring is the region keys you hold (store/useSecrets keys, the cube
 * ones: a hop's box is never a bag's region), the cubes you stand in now
 * (useSecrets current), the places you stood on (their cube keys, the most
 * recent places first, capped), and the room keys you know: rooms you opened
 * or hid something in, and your own doors' rooms. Matching a chest is one map
 * lookup (lookupLock), and nothing is asked of any relay.
 *
 * A lock costs a point multiplication, several milliseconds on a phone. So:
 * - a lock stored beside its key in the vault is taken as it is (§3.8.4,
 *   "SHOULD store it with the key"), and every lock derived here is stored
 *   back (saveLocks), so a reload derives nothing it derived before;
 * - the rest are derived in slices of about SLICE_MS of measured time, one
 *   per frame, never all at once.
 *
 * The places stood on are read from the vault newest first, at most
 * STOOD_PLACES places and STOOD_MAX keys. Why the most recent, and not the
 * largest regions: a lock most often asks for a small region (a height 4
 * grate key), a cap by size would drop exactly those; recency is what
 * "carry" means (the keys from your recent trips); it is the order the
 * vault's eviction already uses (oldest places go first); and the vault's
 * time index reads only those places, never every place key it holds.
 * They are read again at most once a minute as you stand on new places, at
 * the end of that minute if something changed inside it; at once when places
 * are forgotten or evicted (a forgotten place must stop opening chests), and
 * when the vault moves from memory into IndexedDB at startup.
 *
 * Started the first time something asks (startKeyring): a chest or door card,
 * a scan, the composer.
 */

import { useMemo } from 'react'
import { create } from 'zustand'
import { hexToBytes, bytesToHex } from '../lib/events'
import { deriveSlice, LockCache, openingKeyOf, planKeyring, type CarriedKey, type KeyringLock } from '../lib/keyringLocks'
import type { Lock } from '../lib/locks'
import type { OpeningKey } from '../lib/chests'
import { roomKey, roomLookupId } from '../lib/doors'
import { baseOf } from '../lib/secrets/base'
import { pagePlaces, placeKeysOf } from '../lib/secrets/vault'
import type { PlaceCursor } from '../lib/secrets/places'
import { saveLocks, useSecrets, type HeldKey } from './useSecrets'
import { useShards } from './useShards'
import { useCyberspace } from './useCyberspace'
import { doorSecret } from './doorSecrets'

/** Measured time per slice of derivation, in milliseconds: well inside a phone's frame. */
export const SLICE_MS = 6
/** At most this many keys are indexed, in priority order. */
export const KEYRING_MAX = 20_000
/** At most this many place keys come in from the places you stood on, newest places first. */
export const STOOD_MAX = 4_000
/** At most this many places are read for them. */
export const STOOD_PLACES = 2_000
/** Places stood on are read again at most this often as new ones come in. */
export const STOOD_EVERY_MS = 60_000
/** Derived locks wait this long to be stored, so they go in batches. */
const SAVE_AFTER_MS = 2_000

interface KeyringState {
  /** Bumped whenever the index changes, so a card asks again. */
  version: number
  /** Keys whose lock is still to be derived. */
  pending: number
  /** How many locks are indexed. */
  size: number
}

export const useKeyring = create<KeyringState>(() => ({ version: 0, pending: 0, size: 0 }))

/** The clock slices are measured by; replaceable in tests. */
let now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const cache = new LockCache()
let index = new Map<string, KeyringLock>()
let todo: CarriedKey[] = []
let cursor = 0
let started = false
let unsubs: Array<() => void> = []
let rebuildTimer: ReturnType<typeof setTimeout> | null = null
let sliceTimer: ReturnType<typeof setTimeout> | null = null
let stood: CarriedKey[] = []
let stoodAt = 0
let stoodReading = false
let stoodAgain = false
let stoodTimer: ReturnType<typeof setTimeout> | null = null
/** Rooms opened this session, per identity, by room lookup id. */
const noted = new Map<string, Map<string, CarriedKey>>()
/** Locks to store beside their keys, by lookup id, and those already stored or asked to be. */
const toSave = { held: new Map<string, string>(), places: new Map<string, string>() }
const saved = new Set<string>()
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** A held key that is a cube, which is what a bag's region is (§7.6). */
function isCube(k: HeldKey): boolean {
  return !k.heights || (k.heights.x === k.heights.y && k.heights.y === k.heights.z)
}

/** Every room key known here for this identity: rooms you hid in or found things in, rooms opened this session, your own doors' rooms. */
export function roomKeysNow(): CarriedKey[] {
  const me = useCyberspace.getState().identity.pubkey
  const s = useShards.getState()
  const out = new Map<string, CarriedKey>()
  const nameOf = (doorId: string): string => s.discovered[doorId]?.chest?.name ?? s.mine.find((d) => d.eventId === doorId)?.chest?.name ?? ''
  const add = (lookupId: string, keyHex: string, doorId: string, name = ''): void => {
    if (!out.has(lookupId) && /^[0-9a-f]{64}$/.test(keyHex)) out.set(lookupId, { kind: 'room', lookupId, keyHex, doorId, name: nameOf(doorId) || name })
  }
  for (const k of noted.get(me)?.values() ?? []) if (k.kind === 'room') add(k.lookupId, k.keyHex, k.doorId, k.name)
  for (const d of s.mine) if (d.room && d.keyHex) add(d.lookupId, d.keyHex, d.room.doorId)
  for (const h of Object.values(s.discovered)) if (h.room && h.keyHex) add(h.lookupId, h.keyHex, h.room.doorId)
  // Your own doors, standing in a bag of their own height: the room key from the kept secret.
  for (const d of s.mine) {
    const h = d.chest?.door
    if (h === undefined || d.room || d.height !== h || !d.keyHex || d.inner.pubkey !== me) continue
    const secret = doorSecret(me, d.eventId)
    if (!secret) continue
    try {
      const key = roomKey(hexToBytes(d.keyHex), hexToBytes(secret))
      add(roomLookupId(key), bytesToHex(key), d.eventId)
    } catch { /* a malformed row: no room key from it */ }
  }
  return [...out.values()]
}

/** Note a room just opened (store/rooms fillRoom), so its key is on the keyring even when the room is empty. */
export function noteRoomKey(me: string, room: { lookupId: string; keyHex: string; doorId: string; name: string }): void {
  if (!me) return
  const mine = noted.get(me) ?? new Map<string, CarriedKey>()
  if (mine.has(room.lookupId)) return
  mine.set(room.lookupId, { kind: 'room', ...room })
  noted.set(me, mine)
  schedule()
}

/** The region keys you carry now, without the places stood on. */
function regionKeysNow(): CarriedKey[] {
  const s = useSecrets.getState()
  const out: CarriedKey[] = []
  for (const k of Object.values(s.keys)) {
    if (!isCube(k) || k.height < 1) continue
    out.push({ kind: 'region', lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, from: 'held', source: k.source, at: k.at, base: baseOf(k.base, k.height) ?? undefined, ...(k.lock ? { lock: k.lock } : {}) })
  }
  for (const [lookupId, k] of Object.entries(s.current)) if (k.height >= 1) out.push({ kind: 'region', lookupId, keyHex: k.keyHex, height: k.height, from: 'here' })
  return out
}

/** Everything on the keyring, as the index takes it. */
export function carriedKeys(): CarriedKey[] {
  return [...roomKeysNow(), ...regionKeysNow(), ...stood]
}

/** Your keyring's key for a lock, or undefined. One map lookup. */
export function lookupLock(lockPubkey: string): OpeningKey | undefined {
  const e = index.get(lockPubkey)
  return e ? openingKeyOf(e) : undefined
}

/** The keyring entry for a lock, or undefined. */
export function keyringEntry(lockPubkey: string): KeyringLock | undefined {
  return index.get(lockPubkey)
}

/** The lookup, as a card reads it: a new function whenever the index changes, so a memo that depends on it asks again. Starts the keyring. */
export function useKeyringLookup(): (lockPubkey: string) => OpeningKey | undefined {
  useKeyring((s) => s.version)
  startKeyring()
  return lookup
}

/** The room keys you carry, as a panel lists them: read again as the keyring, the finds and your own rows change. */
export function useRoomKeys(): CarriedKey[] {
  const version = useKeyring((s) => s.version)
  const discovered = useShards((s) => s.discovered)
  const mine = useShards((s) => s.mine)
  startKeyring()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => roomKeysNow(), [version, discovered, mine])
}

/** The lookup as of the current index; replaced whenever the index is. */
let lookup: (lockPubkey: string) => OpeningKey | undefined = (lockPubkey) => lookupLock(lockPubkey)

/** The index changed: a new lookup, a new version, the counts. */
function changed(bump: boolean): void {
  if (bump) lookup = (lockPubkey) => lookupLock(lockPubkey)
  const pending = todo.length - cursor
  useKeyring.setState((s) => ({ version: bump ? s.version + 1 : s.version, pending, size: index.size }))
}

/** Queue locks to be stored beside their vault rows: held keys and places stood on, once each. */
function queueSave(entries: Array<{ key: CarriedKey; lock: Lock | null }>): void {
  let any = false
  for (const { key, lock } of entries) {
    if (!lock || key.kind !== 'region' || key.lock === lock.pubkey) continue
    if (key.from !== 'held' && key.from !== 'stood') continue
    const id = `${key.from}:${key.lookupId}`
    if (saved.has(id)) continue
    saved.add(id)
    ;(key.from === 'held' ? toSave.held : toSave.places).set(key.lookupId, lock.pubkey)
    any = true
  }
  if (any && saveTimer === null) {
    saveTimer = setTimeout(() => {
      saveTimer = null
      const held = [...toSave.held].map(([lookupId, lock]) => ({ lookupId, lock }))
      const places = [...toSave.places].map(([lookupId, lock]) => ({ lookupId, lock }))
      toSave.held.clear(); toSave.places.clear()
      void saveLocks(held, places).catch(() => { /* stored next session, or derived again: nothing lost */ })
    }, SAVE_AFTER_MS)
  }
}

/** Rebuild the index from the sources: everything already known at once, the rest queued for slices. */
function rebuild(): void {
  rebuildTimer = null
  if (sliceTimer !== null) { clearTimeout(sliceTimer); sliceTimer = null }
  const keys = carriedKeys()
  const plan = planKeyring(keys, cache, KEYRING_MAX)
  const differs = plan.byLock.size !== index.size || [...plan.byLock.keys()].some((k) => !index.has(k))
  index = plan.byLock
  todo = plan.todo
  cursor = 0
  // Locks known from the cache but not yet stored beside a held key or a place.
  queueSave(keys.flatMap((key) => {
    const lock = key.kind === 'region' && !key.lock ? cache.peek(key.keyHex) : undefined
    return lock ? [{ key, lock }] : []
  }))
  changed(differs)
  if (todo.length > 0) sliceTimer = setTimeout(slice, 0)
}

/** One slice: derive until SLICE_MS of measured time has gone, then yield the frame. */
function slice(): void {
  sliceTimer = null
  const end = now() + SLICE_MS
  const { next, derived } = deriveSlice(todo, cursor, cache, index, () => now() >= end)
  cursor = next
  queueSave(derived)
  changed(true)
  if (cursor < todo.length) sliceTimer = setTimeout(slice, 16)
}

/** A rebuild soon: changes come in bursts (a scan, a load). */
function schedule(): void {
  if (!started || rebuildTimer !== null) return
  rebuildTimer = setTimeout(rebuild, 120)
}

/** Read the places stood on: the newest places first, their cube keys of height 1 and up, at most STOOD_MAX. */
async function readStood(): Promise<void> {
  if (stoodReading) { stoodAgain = true; return }
  stoodReading = true
  stoodAt = Date.now()
  try {
    const ids: string[] = []
    const seen = new Set<string>()
    let after: PlaceCursor | null = null
    for (let read = 0; ids.length < STOOD_MAX && read < STOOD_PLACES;) {
      const page = await pagePlaces(after, 200)
      if (page.length === 0) break
      // A place's keys are listed lowest height first: the first is its 2^0 cube, never a bag's region.
      for (const p of page) for (const id of p.keys.slice(1)) if (!seen.has(id)) { seen.add(id); ids.push(id) }
      read += page.length
      const last = page[page.length - 1]
      after = { at: last.at, id: last.id }
      if (page.length < 200) break
    }
    const wanted = ids.slice(0, STOOD_MAX)
    const rows = new Map((wanted.length > 0 ? await placeKeysOf(wanted) : []).map((r) => [r.lookupId, r]))
    const next: CarriedKey[] = []
    for (const id of wanted) {
      const r = rows.get(id)
      if (!r || r.height < 1) continue
      next.push({ kind: 'region', lookupId: r.lookupId, keyHex: r.keyHex, height: r.height, from: 'stood', base: baseOf(r.base, r.height) ?? undefined, ...(r.lock ? { lock: r.lock } : {}) })
    }
    stood = next
    schedule()
  } catch { /* storage not open, or refused: the next change reads again */ } finally {
    stoodReading = false
    if (stoodAgain) { stoodAgain = false; void readStood() }
  }
}

/**
 * The places changed. Forgotten or evicted (`urgent`): read at once, and with
 * none left, drop their keys before the read even starts. Added: at most once
 * a minute, and at the end of the minute when a change came inside it.
 */
function placesChanged(urgent: boolean): void {
  if (urgent) {
    if (stoodTimer !== null) { clearTimeout(stoodTimer); stoodTimer = null }
    if (useSecrets.getState().storage.places === 0 && stood.length > 0) { stood = []; schedule() }
    void readStood()
    return
  }
  const wait = stoodAt + STOOD_EVERY_MS - Date.now()
  if (wait <= 0) { void readStood(); return }
  if (stoodTimer === null) stoodTimer = setTimeout(() => { stoodTimer = null; void readStood() }, wait)
}

/** Start keeping the index, once. Safe to call from render. */
export function startKeyring(): void {
  if (started) return
  started = true
  const s0 = useSecrets.getState()
  let keys = s0.keys
  let current = s0.current
  let places = s0.placesVersion
  let forgotten = s0.placesForgotten
  let mode = s0.storage.mode
  let discovered = useShards.getState().discovered
  let mine = useShards.getState().mine
  let me = useCyberspace.getState().identity.pubkey
  unsubs = [
    useSecrets.subscribe((s) => {
      if (s.keys !== keys || s.current !== current) { keys = s.keys; current = s.current; schedule() }
      if (s.placesForgotten !== forgotten) { forgotten = s.placesForgotten; places = s.placesVersion; placesChanged(true) }
      else if (s.placesVersion !== places) { places = s.placesVersion; placesChanged(false) }
      // The vault came up (memory to IndexedDB, or to its fallback): what it holds is read now.
      if (s.storage.mode !== mode) { mode = s.storage.mode; placesChanged(true) }
    }),
    useShards.subscribe((s) => { if (s.discovered !== discovered || s.mine !== mine) { discovered = s.discovered; mine = s.mine; schedule() } }),
    useCyberspace.subscribe((s) => { if (s.identity.pubkey !== me) { me = s.identity.pubkey; schedule() } }),
  ]
  void readStood()
  schedule()
}

/** Derive every pending lock now, for tests and for a caller that must know at once. */
export function rebuildKeyringNow(): void {
  if (rebuildTimer !== null) { clearTimeout(rebuildTimer); rebuildTimer = null }
  rebuild()
  if (sliceTimer !== null) { clearTimeout(sliceTimer); sliceTimer = null }
  const { next, derived } = deriveSlice(todo, cursor, cache, index, () => false)
  cursor = next
  queueSave(derived)
  changed(true)
}

/** For tests: the clock slices are measured by. */
export function setKeyringClock(clock: () => number): void { now = clock }

/** For tests: forget everything, stop listening. */
export function resetKeyring(): void {
  for (const u of unsubs) u()
  unsubs = []
  for (const t of [rebuildTimer, sliceTimer, stoodTimer, saveTimer]) if (t !== null) clearTimeout(t)
  rebuildTimer = sliceTimer = stoodTimer = saveTimer = null
  started = false
  cache.clear()
  index = new Map()
  todo = []
  cursor = 0
  stood = []
  stoodAt = 0
  stoodReading = false
  stoodAgain = false
  noted.clear()
  toSave.held.clear(); toSave.places.clear()
  saved.clear()
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  lookup = (lockPubkey) => lookupLock(lockPubkey)
  useKeyring.setState({ version: 0, pending: 0, size: 0 })
}
