/**
 * useKeyring.ts: the locks of every key you carry, ready for a chest or a door
 * to be matched against (DECK-0004 §3.8, draft; conjunction seals design
 * §5.8, §5.9 item 7, slice 1).
 *
 * Your keyring is the region keys you hold (store/useSecrets keys, the cube
 * ones: a hop's box is never a bag's region), the cubes you stand in now
 * (useSecrets current), the places you stood on (the cube keys RESCAN ALL
 * keeps, the largest first, capped), and the room keys you know: rooms you
 * opened or hid something in, and your own doors' rooms. Each key's lock is
 * derived once (lib/keyringLocks LockCache) and kept for the session, in
 * slices between frames, so a keyring of thousands never holds up the page.
 * Matching a chest is then one map lookup (lookupLock), and nothing is asked
 * of any relay.
 *
 * Started the first time something asks (startKeyring): a chest or door card,
 * a scan, the composer. Every change to the sources schedules a rebuild,
 * which costs nothing for keys already derived.
 */

import { create } from 'zustand'
import { hexToBytes, bytesToHex } from '../lib/events'
import { indexKeyring, LockCache, openingKeyOf, type CarriedKey, type KeyringLock } from '../lib/keyringLocks'
import type { OpeningKey } from '../lib/chests'
import { roomKey, roomLookupId } from '../lib/doors'
import { placeKeyPages } from '../lib/secrets/vault'
import { useSecrets, type HeldKey } from './useSecrets'
import { useShards } from './useShards'
import { useCyberspace } from './useCyberspace'
import { doorSecret } from './doorSecrets'

/** New locks derived per slice: about a millisecond each. */
export const KEYRING_SLICE = 48
/** At most this many keys are indexed, in priority order. */
export const KEYRING_MAX = 20_000
/** At most this many place keys are read in from the places you stood on, the largest regions first. */
export const STOOD_MAX = 4_000
/** Places stood on are read again at most this often. */
const STOOD_EVERY_MS = 60_000

interface KeyringState {
  /** Bumped whenever the index changes, so a card asks again. */
  version: number
  /** Keys whose lock is still to be derived. */
  pending: number
  /** How many locks are indexed. */
  size: number
}

export const useKeyring = create<KeyringState>(() => ({ version: 0, pending: 0, size: 0 }))

const cache = new LockCache()
let index = new Map<string, KeyringLock>()
let started = false
let unsubs: Array<() => void> = []
let timer: ReturnType<typeof setTimeout> | null = null
let stood: CarriedKey[] = []
let stoodAt = 0
let stoodLoading = false
/** Rooms opened this session, per identity, by room lookup id. */
const noted = new Map<string, Map<string, CarriedKey>>()

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
  for (const k of Object.values(s.keys)) if (isCube(k) && k.height >= 1) out.push({ kind: 'region', lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, from: 'held', at: k.at })
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

/**
 * The lookup, as a card reads it: a new function whenever the index changes,
 * so a memo that depends on it asks again. Starts the keyring.
 */
export function useKeyringLookup(): (lockPubkey: string) => OpeningKey | undefined {
  useKeyring((s) => s.version)
  startKeyring()
  return lookup
}

/** The lookup as of the current index; replaced whenever the index is. */
let lookup: (lockPubkey: string) => OpeningKey | undefined = (lockPubkey) => lookupLock(lockPubkey)
function freshLookup(): void { lookup = (lockPubkey) => lookupLock(lockPubkey) }

/** One pass: index what is derived, derive one slice more, and come back for the rest. */
function pass(): void {
  timer = null
  const built = indexKeyring(carriedKeys(), cache, KEYRING_SLICE, KEYRING_MAX)
  const changed = built.byLock.size !== index.size || [...built.byLock.keys()].some((k) => !index.has(k))
  index = built.byLock
  if (changed) freshLookup()
  if (changed || built.pending !== useKeyring.getState().pending) useKeyring.setState((s) => ({ version: changed ? s.version + 1 : s.version, pending: built.pending, size: built.byLock.size }))
  if (built.pending > 0) timer = setTimeout(pass, 16)
}

/** A rebuild soon: changes come in bursts (a scan, a load). */
function schedule(): void {
  if (!started || timer !== null) return
  timer = setTimeout(pass, 120)
}

/**
 * The places you stood on, read in from storage a page at a time: their cube
 * keys of height 1 and up, the largest regions kept first, at most STOOD_MAX.
 */
async function loadStood(): Promise<void> {
  if (stoodLoading || Date.now() - stoodAt < STOOD_EVERY_MS) return
  stoodLoading = true
  stoodAt = Date.now()
  try {
    const kept: CarriedKey[] = []
    for await (const page of placeKeyPages(500)) {
      for (const k of page) if (k.height >= 1) kept.push({ kind: 'region', lookupId: k.lookupId, keyHex: k.keyHex, height: k.height, from: 'stood' })
      // Bounded as it goes: the smallest regions leave first.
      if (kept.length > STOOD_MAX * 2) { kept.sort((a, b) => (b.kind === 'region' ? b.height : 0) - (a.kind === 'region' ? a.height : 0)); kept.length = STOOD_MAX }
    }
    kept.sort((a, b) => (b.kind === 'region' ? b.height : 0) - (a.kind === 'region' ? a.height : 0))
    stood = kept.slice(0, STOOD_MAX)
    schedule()
  } catch { /* storage not open yet, or refused: the next change asks again */ } finally {
    stoodLoading = false
  }
}

/** Start keeping the index, once. Safe to call from render. */
export function startKeyring(): void {
  if (started) return
  started = true
  let keys = useSecrets.getState().keys
  let current = useSecrets.getState().current
  let places = useSecrets.getState().placesVersion
  let discovered = useShards.getState().discovered
  let mine = useShards.getState().mine
  let me = useCyberspace.getState().identity.pubkey
  unsubs = [
    useSecrets.subscribe((s) => {
      if (s.keys !== keys || s.current !== current) { keys = s.keys; current = s.current; schedule() }
      if (s.placesVersion !== places || (s.storage.mode !== 'loading' && stood.length === 0 && stoodAt === 0)) { places = s.placesVersion; void loadStood() }
    }),
    useShards.subscribe((s) => { if (s.discovered !== discovered || s.mine !== mine) { discovered = s.discovered; mine = s.mine; schedule() } }),
    useCyberspace.subscribe((s) => { if (s.identity.pubkey !== me) { me = s.identity.pubkey; schedule() } }),
  ]
  void loadStood()
  schedule()
}

/** Derive every pending lock now, for tests and for a caller that must know at once. */
export function rebuildKeyringNow(): void {
  const built = indexKeyring(carriedKeys(), cache, Infinity, KEYRING_MAX)
  index = built.byLock
  freshLookup()
  useKeyring.setState((s) => ({ version: s.version + 1, pending: 0, size: built.byLock.size }))
}

/** For tests: forget everything, stop listening. */
export function resetKeyring(): void {
  for (const u of unsubs) u()
  unsubs = []
  if (timer !== null) clearTimeout(timer)
  timer = null
  started = false
  cache.clear()
  index = new Map()
  stood = []
  stoodAt = 0
  noted.clear()
  freshLookup()
  useKeyring.setState({ version: 0, pending: 0, size: 0 })
}
