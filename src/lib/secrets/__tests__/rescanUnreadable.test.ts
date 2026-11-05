/**
 * rescanUnreadable.test.ts: a newest bag that does not open with its key
 * leaves the finds from the version before it, a door and the room behind
 * it among them. Opening such a bag used to give back no items rather than
 * fail, so RESCAN ALL counted it as the current version holding nothing,
 * and every find of the older version went, the room with its door
 * (lib/bagVersions.ts staleFinds). The opening here is the real one
 * (lib/hidden.ts unbag); only the relays are faked. No network.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../events'

const mem = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

const relay = vi.hoisted(() => ({ bags: [] as unknown[] }))
vi.mock('../../relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  publish: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: relay.bags }]),
  queryChecked: vi.fn(async () => ({ events: relay.bags, trouble: false })),
  relaySet: () => ['wss://relay.test'],
}))

const { rescanBatches } = await import('../rescan')
const { useShards } = await import('../../../store/useShards')
const { HIDDEN_KIND, bagTemplate } = await import('../../hidden')
const { bytesToHex } = await import('../../events')
const { encryptForRegion, regionKeyAt } = await import('../../shardCrypto')

const sk = generateSecretKey()
const author = getPublicKey(sk)
const at = { x: 90_000n, y: 4_000n, z: 71n }
const place = regionKeyAt(at, 6, 20)
const PLACE = place.lookupId
const KEY_HEX = bytesToHex(place.key)
const ROOM = 'c'.repeat(64)

/** A version of the place's bag that opens with its key, holding nothing. */
async function openable(createdAt: number): Promise<NostrEvent> {
  return finalizeEvent(await bagTemplate([], place.key, PLACE, 6, createdAt, HIDDEN_KIND), sk) as NostrEvent
}

/** A newer version under the same address that does not open with the place's key: sealed under another. */
async function unreadable(createdAt: number): Promise<NostrEvent> {
  const elsewhere = regionKeyAt({ ...at, x: at.x + 5000n }, 6, 20)
  const ct = await encryptForRegion(elsewhere.key, '[]')
  return finalizeEvent({ kind: HIDDEN_KIND, created_at: createdAt, content: '', tags: [['d', PLACE], ['encrypted', 'aes-256-gcm', ct], ['version', '2'], ['h', '6']] }, sk) as NostrEvent
}

async function* one(): AsyncGenerator<Array<{ lookupId: string; keyHex: string; height: number }>> { yield [{ lookupId: PLACE, keyHex: KEY_HEX, height: 6 }] }

/** A door found in an older version of the place's bag, and an item behind it. */
function seed(): void {
  const door = { eventId: 'door', author, lookupId: PLACE, bagId: 'e'.repeat(64), bagAt: 1_000, at, plane: 0, height: 6, createdAt: 1_000, type: 'chest' }
  const inside = { eventId: 'inside', author, lookupId: ROOM, bagId: 'f'.repeat(64), bagAt: 1_500, at, plane: 0, height: 6, createdAt: 1_500, type: 'message', text: 'behind the door', room: { doorId: 'door' } }
  useShards.setState({ discovered: { door, inside } as never })
}

beforeEach(() => { relay.bags = [] })

describe('a newest bag that does not open with its key', () => {
  it('RESCAN ALL keeps the door and the room behind it', async () => {
    seed()
    relay.bags = [await unreadable(2_000)]
    await rescanBatches(one(), 1)
    expect(Object.keys(useShards.getState().discovered).sort()).toEqual(['door', 'inside'])
  })

  it('RESCAN ALL: a newest bag that opens and no longer holds the door still takes it, and the room with it', async () => {
    seed()
    relay.bags = [await openable(2_000)]
    await rescanBatches(one(), 1)
    expect(Object.keys(useShards.getState().discovered)).toEqual([])
  })

  it('the Secrets list\'s SCAN of one region keeps them too', async () => {
    seed()
    relay.bags = [await unreadable(2_000)]
    await useShards.getState().rescan(PLACE, KEY_HEX)
    expect(Object.keys(useShards.getState().discovered).sort()).toEqual(['door', 'inside'])
  })

  it('the SCAN of one region: another bag there that does opens as before', async () => {
    seed()
    const other = generateSecretKey()
    const theirs = finalizeEvent(await bagTemplate([], place.key, PLACE, 6, 3_000, HIDDEN_KIND), other) as NostrEvent
    relay.bags = [await unreadable(2_000), theirs]
    expect(await useShards.getState().rescan(PLACE, KEY_HEX)).toBe(0)
    expect(Object.keys(useShards.getState().discovered).sort()).toEqual(['door', 'inside'])
  })
})
