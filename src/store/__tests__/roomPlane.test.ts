/**
 * roomPlane.test.ts: a room holds only its door's plane (DECK-0004 §3.7.2,
 * One plane). A region and its twin in the other plane share a location key,
 * so a room bag can be opened from either, but an entry whose C is in the
 * other plane lies outside the room, and openRoom drops it.
 */
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

let held: unknown[] = []
vi.mock('../../lib/relay', () => ({
  query: vi.fn(async () => held),
  queryAny: vi.fn(async () => []),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: held }]),
  publishMany: vi.fn(async () => ({ ok: true })),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { roomKey, roomLookupId } from '../../lib/doors'
import { CHEST_KIND, HIDDEN_KIND, bagTemplate, messageInnerTemplate, rumorOf, type Hidden } from '../../lib/hidden'
import { positionHex } from '../../lib/events'
import { openRoom } from '../rooms'

const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

describe('a room holds only its door\'s plane', () => {
  it('drops an entry whose C is in the other plane, and keeps the door\'s', async () => {
    const sk = generateSecretKey()
    const signer = getPublicKey(sk)
    const at = { x: (1n << 40n) + 16n, y: 32n, z: 48n }
    const locationKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
    const secret = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff)
    const door = {
      eventId: 'd'.repeat(64), bagId: 'b'.repeat(64), lookupId: 'c'.repeat(64), author: signer, at, plane: 0, height: 4, createdAt: 1, type: 'chest',
      keyHex: bytesToHex(locationKey),
      inner: { kind: CHEST_KIND, pubkey: signer, created_at: 1, content: '', tags: [['C', positionHex(at, 0)], ['door', '4']], id: 'd'.repeat(64), sig: '' },
    } as unknown as Hidden
    const key = roomKey(locationKey, secret)
    const here = rumorOf(messageInnerTemplate('in the door\'s plane', { ...at, x: at.x + 1n }, 0, 2), signer)
    const twin = rumorOf(messageInnerTemplate('in the twin plane', { ...at, x: at.x + 1n }, 1, 3), signer)
    held = [finalizeEvent(await bagTemplate([here, twin], key, roomLookupId(key), 4, 10, HIDDEN_KIND), sk)]
    const opened = await openRoom(door, bytesToHex(secret))
    expect(opened.found).toBe(true)
    expect(opened.items.map((h) => h.text)).toEqual(['in the door\'s plane'])
  })
})
