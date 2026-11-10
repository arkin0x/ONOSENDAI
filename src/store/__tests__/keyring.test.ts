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
import { useSecrets, type HeldKey } from '../useSecrets'
import { useShards } from '../useShards'
import { KEYRING_SLICE, keyringEntry, lookupLock, noteRoomKey, rebuildKeyringNow, resetKeyring, roomKeysNow, startKeyring, useKeyring } from '../useKeyring'

const hexOf = (i: number): string => bytesToHex(sha256(new Uint8Array([i >> 8, i & 255, 9])))
const held = (i: number, extra: Partial<HeldKey> = {}): HeldKey => ({ lookupId: `L${i}`, keyHex: hexOf(i), height: 5, base: { x: '0', y: '0', z: '0' }, plane: 0, source: 'scan', at: 1_790_000_000 + i, ...extra })

beforeEach(() => {
  resetKeyring()
  useSecrets.setState({ keys: {}, current: {} })
  useShards.setState({ mine: [], discovered: {} })
})
afterEach(() => { vi.useRealTimers(); resetKeyring() })

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
  it('derives a large keyring a slice at a time, then stops', async () => {
    vi.useFakeTimers()
    const keys: Record<string, HeldKey> = {}
    const n = KEYRING_SLICE * 3 + 5
    for (let i = 0; i < n; i++) keys[`L${i}`] = held(i)
    useSecrets.setState({ keys })
    startKeyring()
    await vi.advanceTimersByTimeAsync(130)
    expect(useKeyring.getState().size).toBe(KEYRING_SLICE)
    expect(useKeyring.getState().pending).toBe(n - KEYRING_SLICE)
    await vi.advanceTimersByTimeAsync(100)
    expect(useKeyring.getState().size).toBe(n)
    expect(useKeyring.getState().pending).toBe(0)
    // A new key: only it is derived, and found.
    const v = useKeyring.getState().version
    useSecrets.setState({ keys: { ...keys, NEW: held(9999) } })
    await vi.advanceTimersByTimeAsync(130)
    expect(useKeyring.getState().version).toBe(v + 1)
    expect(lookupLock(lockOfHex(hexOf(9999))!.pubkey)).toBeDefined()
  })
})
