/**
 * rescanOpenFails.test.ts: RESCAN ALL counts a bag as current only once it
 * opened (review of #593). The author's newest bag is what every find of an
 * older version is judged against (lib/bagVersions.ts staleFinds). When that
 * newest bag was counted before it was opened, and opening it then threw, it
 * re-filed nothing, so the door read from the older version went, and the
 * room behind it was emptied with it. No network.
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
  relaySet: () => ['wss://relay.test'],
}))
// Opening the newest bag throws; any other opens to nothing.
const opening = vi.hoisted(() => ({ throws: true }))
vi.mock('../../foundCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../foundCache')>()
  return { ...actual, unbagRemembered: vi.fn(async () => { if (opening.throws) throw new Error('could not open'); return [] }) }
})

const { rescanBatches } = await import('../rescan')
const { useShards } = await import('../../../store/useShards')

const sk = generateSecretKey()
const author = getPublicKey(sk)
const PLACE = 'a'.repeat(64)
const ROOM = 'c'.repeat(64)
const bag = (createdAt: number, note: string): NostrEvent => finalizeEvent({ kind: 33330, created_at: createdAt, content: note, tags: [['d', PLACE]] }, sk) as NostrEvent
const older = bag(1_000, 'the door')
const newer = bag(2_000, 'the door, and something new beside it')

async function* one(): AsyncGenerator<Array<{ lookupId: string; keyHex: string }>> { yield [{ lookupId: PLACE, keyHex: 'b'.repeat(64) }] }

/** A door found in the older version of the place's bag, and an item behind it. */
function seed(): void {
  const at = { x: 1n, y: 2n, z: 3n }
  const door = { eventId: 'door', author, lookupId: PLACE, bagId: older.id, bagAt: 1_000, at, plane: 0, height: 3, createdAt: 1_000, type: 'chest' }
  const inside = { eventId: 'inside', author, lookupId: ROOM, bagId: 'f'.repeat(64), bagAt: 1_500, at, plane: 0, height: 3, createdAt: 1_500, type: 'message', text: 'behind the door', room: { doorId: 'door' } }
  useShards.setState({ discovered: { door, inside } as never })
}

beforeEach(() => {
  relay.bags = [newer]
  opening.throws = true
})

describe('RESCAN ALL when the newest bag will not open', () => {
  it('keeps the door and the room behind it', async () => {
    seed()
    await rescanBatches(one(), 1)
    expect(Object.keys(useShards.getState().discovered).sort()).toEqual(['door', 'inside'])
  })

  it('a newest bag that opens is still the one the rest is judged by: what it no longer holds goes', async () => {
    seed()
    opening.throws = false
    await rescanBatches(one(), 1)
    expect(Object.keys(useShards.getState().discovered)).toEqual([])
  })
})
