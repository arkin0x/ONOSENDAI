/**
 * keyring.test.ts: the keyring's lock map (store/useKeyring, DECK-0004 §3.8).
 * What goes on it (held cube keys, the cubes you stand in, room keys you know),
 * what does not (a hop's box), rooms per identity, and the pump that derives
 * a large keyring a slice at a time so the page never waits on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), queryEach: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '../../lib/events'
import { lockOfHex } from '../../lib/locks'
import { useCyberspace } from '../useCyberspace'
import * as locksModule from '../../lib/locks'
import { memory } from '../../lib/secrets/vault'
import * as secretsModule from '../useSecrets'
import { useSecrets, type HeldKey } from '../useSecrets'
import { useShards } from '../useShards'
import { BUMP_EVERY_MS, SLICE_MS, STOOD_EVERY_MS, keyringEntry, lookupLock, noteRoomKey, rebuildKeyringNow, resetKeyring, roomKeysNow, setKeyringClock, startKeyring, useKeyring } from '../useKeyring'

const hexOf = (i: number): string => bytesToHex(sha256(new Uint8Array([i >> 8, i & 255, 9])))
const held = (i: number, extra: Partial<HeldKey> = {}): HeldKey => ({ lookupId: `L${i}`, keyHex: hexOf(i), height: 5, base: { x: '0', y: '0', z: '0' }, plane: 0, source: 'scan', at: 1_790_000_000 + i, ...extra })

beforeEach(() => {
  resetKeyring()
  memory.drain()
  useSecrets.setState((s) => ({ storage: { ...s.storage, mode: 'loading', places: 0 } }))
  useSecrets.setState({ keys: {}, current: {} })
  useShards.setState({ mine: [], discovered: {} })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); resetKeyring(); memory.drain() })

/** Stand on a place: its one cube key of height 5 (and a 2^0 key, never a lock), as the scan records it. */
function stand(i: number, at = i, lock?: string): void {
  memory.record({ id: `0:P${i}`, position: { x: '0', y: '0', z: '0' }, plane: 0, keys: [`H0-${i}`, `K${i}`], first: at, at }, [
    { lookupId: `H0-${i}`, keyHex: hexOf(5000 + i), height: 0, base: { x: '0', y: '0', z: '0' }, plane: 0 },
    { lookupId: `K${i}`, keyHex: hexOf(i), height: 5, base: { x: '0', y: '0', z: '0' }, plane: 0, ...(lock ? { lock } : {}) },
  ])
  useSecrets.setState((s) => ({ placesVersion: s.placesVersion + 1, storage: { ...s.storage, places: memory.totals().places } }))
}
const lockOf = (i: number): string => lockOfHex(hexOf(i))!.pubkey
const settle = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

describe('what is on the keyring', () => {
  it('held cube keys and the cubes you stand in, each matched by its lock', () => {
    useSecrets.setState({ keys: { L1: held(1) }, current: { L2: { keyHex: hexOf(2), height: 3 } } })
    rebuildKeyringNow()
    expect(lookupLock(lockOfHex(hexOf(1))!.pubkey)?.carried).toMatchObject({ kind: 'region', from: 'held', lookupId: 'L1' })
    expect(lookupLock(lockOfHex(hexOf(2))!.pubkey)?.carried).toMatchObject({ kind: 'region', from: 'here', lookupId: 'L2' })
    expect(lookupLock(lockOfHex(hexOf(3))!.pubkey)).toBeUndefined()
  })

  it('never a hop’s box, which is no bag’s region, nor height 0', () => {
    useSecrets.setState({ keys: { L1: held(1, { source: 'hop', heights: { x: 5, y: 3, z: 4 } }), L2: held(2, { height: 0 }) }, current: { L3: { keyHex: hexOf(3), height: 0 } } })
    rebuildKeyringNow()
    expect(useKeyring.getState().size).toBe(0)
  })

  it('room keys: rooms you hid in or found things in, and rooms opened, for this identity only', () => {
    const me = useCyberspace.getState().identity.pubkey
    useShards.setState({ discovered: { thing: { eventId: 'thing', keyHex: hexOf(10), lookupId: 'R10', room: { doorId: 'door10' }, bagId: 'b', author: 'a', at: { x: 0n, y: 0n, z: 0n }, plane: 0, height: 3, createdAt: 1, type: 'message' } as never } })
    noteRoomKey(me, { lookupId: 'R11', keyHex: hexOf(11), doorId: 'door11', name: 'Pump Room' })
    noteRoomKey('someone-else', { lookupId: 'R12', keyHex: hexOf(12), doorId: 'door12', name: 'Not Mine' })
    expect(roomKeysNow().map((r) => r.lookupId).sort()).toEqual(['R10', 'R11'])
    rebuildKeyringNow()
    expect(keyringEntry(lockOfHex(hexOf(11))!.pubkey)?.key).toMatchObject({ kind: 'room', name: 'Pump Room' })
    expect(lookupLock(lockOfHex(hexOf(12))!.pubkey)).toBeUndefined()
  })
})

describe('the pump', () => {
  it('derives in slices of measured time, one per frame, then stops; a new key costs only itself', async () => {
    vi.useFakeTimers()
    // A clock that moves 1 ms per reading: each lock "takes" a millisecond.
    let t = 0
    setKeyringClock(() => t++)
    const keys: Record<string, HeldKey> = {}
    const n = 40
    for (let i = 0; i < n; i++) keys[`L${i}`] = held(i)
    useSecrets.setState({ keys })
    startKeyring()
    await settle(121)
    const first = useKeyring.getState().size
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThanOrEqual(SLICE_MS)
    expect(useKeyring.getState().pending).toBe(n - first)
    await settle(16 * 20)
    expect(useKeyring.getState().size).toBe(n)
    expect(useKeyring.getState().pending).toBe(0)
    const derive = vi.spyOn(locksModule, 'lockOfHex')
    useSecrets.setState({ keys: { ...keys, NEW: held(9999) } })
    await settle(200)
    expect(derive).toHaveBeenCalledTimes(1)
    expect(lookupLock(lockOf(9999))).toBeDefined()
  })

  it('stores each derived lock beside its key, and takes a stored one without deriving it', async () => {
    vi.useFakeTimers()
    const save = vi.spyOn(secretsModule, 'saveLocks').mockResolvedValue()
    const [l1, l2, l3] = [lockOf(1), lockOf(2), lockOf(3)]
    useSecrets.setState({ keys: { L1: held(1) } })
    stand(2)
    stand(3, 3, l3)
    const derive = vi.spyOn(locksModule, 'lockOfHex')
    startKeyring()
    await settle(3_000)
    // Only the two without a stored lock were derived.
    expect(derive.mock.calls.map((c) => c[0]).sort()).toEqual([hexOf(1), hexOf(2)].sort())
    for (const l of [l1, l2, l3]) expect(lookupLock(l)).toBeDefined()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toEqual([{ lookupId: 'L1', lock: l1 }])
    expect(save.mock.calls[0][1]).toEqual([{ lookupId: 'K2', lock: l2 }])
  })
})

describe('re-review of #648', () => {
  it('a long derivation bumps the version at most every BUMP_EVERY_MS, and once at the end', async () => {
    vi.useFakeTimers()
    let t = 0
    setKeyringClock(() => t++)
    const keys: Record<string, HeldKey> = {}
    for (let i = 0; i < 300; i++) keys[`L${i}`] = held(i)
    useSecrets.setState({ keys })
    let bumps = 0
    let v = useKeyring.getState().version
    const off = useKeyring.subscribe((st) => { if (st.version !== v) { bumps++; v = st.version } })
    startKeyring()
    await settle(16 * 80)
    off()
    expect(useKeyring.getState().pending).toBe(0)
    expect(useKeyring.getState().size).toBe(300)
    // About fifty slices took about 800 ms: a handful of bumps, not one per slice.
    expect(bumps).toBeGreaterThanOrEqual(2)
    expect(bumps).toBeLessThanOrEqual(Math.ceil((16 * 80) / BUMP_EVERY_MS) + 2)
  })

  it('room keys have their own version: a region key changes the keyring’s, not the rooms’', async () => {
    vi.useFakeTimers()
    startKeyring()
    const rooms = useKeyring.getState().roomsVersion
    useSecrets.setState({ keys: { L1: held(1) } })
    await settle(300)
    expect(useKeyring.getState().roomsVersion).toBe(rooms)
    noteRoomKey(useCyberspace.getState().identity.pubkey, { lookupId: 'R1', keyHex: hexOf(77), doorId: 'd', name: 'n' })
    expect(useKeyring.getState().roomsVersion).toBe(rooms + 1)
  })

  it('a key forgotten and held again in the same session has its lock stored again', async () => {
    vi.useFakeTimers()
    const save = vi.spyOn(secretsModule, 'saveLocks').mockResolvedValue()
    useSecrets.setState({ keys: { L1: held(1) } })
    startKeyring()
    await settle(3_000)
    expect(save).toHaveBeenCalledTimes(1)
    useSecrets.setState({ keys: {} })
    await settle(300)
    useSecrets.setState({ keys: { L1: held(1) } })
    await settle(3_000)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0]).toEqual([{ lookupId: 'L1', lock: lockOf(1) }])
  })

  it('a stored lock is kept on the held row in memory, so the next write of it carries it', async () => {
    useSecrets.setState({ keys: { L1: held(1) } })
    await secretsModule.saveLocks([{ lookupId: 'L1', lock: lockOf(1) }], [])
    expect(useSecrets.getState().keys.L1.lock).toBe(lockOf(1))
  })
})

describe('places stood on (review of #648)', () => {
  it('a place forgotten stops opening chests at once, inside the minute', async () => {
    vi.useFakeTimers()
    stand(1)
    stand(2)
    startKeyring()
    await settle(500)
    expect(lookupLock(lockOf(1))?.carried).toMatchObject({ from: 'stood' })
    await useSecrets.getState().forgetPlace('0:P1')
    await settle(500)
    expect(lookupLock(lockOf(1))).toBeUndefined()
    expect(lookupLock(lockOf(2))).toBeDefined()
  })

  it('FORGET ALL PLACES drops their keys before the reread even lands', async () => {
    vi.useFakeTimers()
    stand(1)
    startKeyring()
    await settle(500)
    expect(lookupLock(lockOf(1))).toBeDefined()
    await useSecrets.getState().forgetAllPlaces()
    await settle(200)
    expect(lookupLock(lockOf(1))).toBeUndefined()
  })

  it('a place stood on inside the minute is read at the end of it, with no other change', async () => {
    vi.useFakeTimers()
    stand(1)
    startKeyring()
    await settle(500)
    stand(2)
    await settle(1_000)
    expect(lookupLock(lockOf(2))).toBeUndefined()
    await settle(STOOD_EVERY_MS)
    expect(lookupLock(lockOf(2))?.carried).toMatchObject({ from: 'stood' })
  })

  it('at startup: read again when the vault comes up, whatever the minute says', async () => {
    vi.useFakeTimers()
    startKeyring()
    await settle(500)
    // What the vault held all along, now readable (IndexedDB opened, its places in view).
    memory.record({ id: '0:P7', position: { x: '0', y: '0', z: '0' }, plane: 0, keys: ['H0-7', 'K7'], first: 7, at: 7 }, [{ lookupId: 'K7', keyHex: hexOf(7), height: 5, base: { x: '0', y: '0', z: '0' }, plane: 0 }])
    useSecrets.setState((s) => ({ storage: { ...s.storage, mode: 'indexeddb' } }))
    await settle(500)
    expect(lookupLock(lockOf(7))).toBeDefined()
  })

  it('never the 2^0 cube of a place, which is no bag’s region', async () => {
    vi.useFakeTimers()
    stand(1)
    startKeyring()
    await settle(500)
    expect(lookupLock(lockOfHex(hexOf(5001))!.pubkey)).toBeUndefined()
  })
})
