/**
 * keyringLocks.test.ts: the keyring's locks, by lock (DECK-0004 §3.8). Each
 * key derived once, a budget per pass with the rest pending, the priority
 * order, one entry per key, and the line under OPEN.
 */
import { describe, expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '../events'
import * as locks from '../locks'
import { carriedLabel, indexKeyring, keyringOrder, LockCache, openingKeyOf, type CarriedKey } from '../keyringLocks'

const hexOf = (i: number): string => bytesToHex(sha256(new Uint8Array([i, 7])))
const region = (i: number, from: 'held' | 'here' | 'stood' = 'held', at = i): CarriedKey => ({ kind: 'region', lookupId: `L${i}`, keyHex: hexOf(i), height: 4, from, at })
const room = (i: number): CarriedKey => ({ kind: 'room', lookupId: `R${i}`, keyHex: hexOf(100 + i), name: `Room ${i}`, doorId: `D${i}` })

describe('LockCache', () => {
  it('derives each key once', () => {
    const spy = vi.spyOn(locks, 'lockOfHex')
    const cache = new LockCache()
    const a = cache.derive(hexOf(1))
    const b = cache.derive(hexOf(1).toUpperCase())
    expect(a).toEqual(b)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
    spy.mockRestore()
  })
})

describe('indexKeyring', () => {
  it('maps each lock to its key', () => {
    const cache = new LockCache()
    const keys = [region(1), region(2), room(1)]
    const { byLock, pending } = indexKeyring(keys, cache, Infinity)
    expect(pending).toBe(0)
    for (const k of keys) {
      const lock = locks.lockOfHex(k.keyHex)!
      expect(byLock.get(lock.pubkey)?.key).toEqual(k)
      expect(byLock.get(lock.pubkey)?.lock).toEqual(lock)
    }
  })

  it('derives at most the budget per pass; the rest wait, and later passes finish them', () => {
    const cache = new LockCache()
    const keys = Array.from({ length: 10 }, (_, i) => region(i))
    const first = indexKeyring(keys, cache, 4)
    expect(first.byLock.size).toBe(4)
    expect(first.pending).toBe(6)
    const second = indexKeyring(keys, cache, 4)
    expect(second.byLock.size).toBe(8)
    expect(second.pending).toBe(2)
    const third = indexKeyring(keys, cache, 4)
    expect(third.byLock.size).toBe(10)
    expect(third.pending).toBe(0)
    // Nothing new to derive: free.
    const spy = vi.spyOn(locks, 'lockOfHex')
    expect(indexKeyring(keys, cache, 0).byLock.size).toBe(10)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('rooms first, then held keys newest first, then here, then stood; one entry per key', () => {
    const order = keyringOrder([region(1, 'stood'), region(2, 'here'), region(3, 'held', 10), region(4, 'held', 20), room(1), { ...region(3, 'stood') }])
    expect(order.map((k) => k.lookupId)).toEqual(['R1', 'L4', 'L3', 'L2', 'L1'])
  })

  it('caps the keys indexed, in priority order', () => {
    const cache = new LockCache()
    const { byLock } = indexKeyring([region(1, 'stood'), room(1), region(2, 'held')], cache, Infinity, 2)
    expect([...byLock.values()].map((e) => e.key.lookupId).sort()).toEqual(['L2', 'R1'])
  })
})

describe('as an opening key, and the line under OPEN', () => {
  it('is a lock, never an ITEMS row', () => {
    const k = region(1)
    const lock = locks.lockOfHex(k.keyHex)!
    expect(openingKeyOf({ lock, key: k })).toEqual({ id: 'lock:region:L1', itemPubkey: lock.pubkey, secretHex: lock.secretHex, carried: k })
  })

  it('says which key fits, in a few words', () => {
    expect(carriedLabel(room(1))).toBe('a room you opened, Room 1')
    expect(carriedLabel({ ...region(1, 'here') })).toBe('the region you stand in, height 4')
    expect(carriedLabel({ ...region(1, 'stood') })).toBe('a region you stood in, height 4')
    expect(carriedLabel({ kind: 'region', lookupId: 'x', keyHex: hexOf(1), height: 8, from: 'held', at: Date.UTC(2026, 9, 12) / 1000 })).toBe('a region, height 8, kept 12 October')
  })
})
