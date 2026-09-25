/**
 * freshFinds.test.ts - the reveal and the toast are for a first find only.
 *
 * On load the scan re-opened shards already on screen and replayed the decode
 * and the toast (arkinox, 2026-09-25): `discovered` starts empty every load,
 * and the scan never asked whether an item was this identity's own. freshOf is
 * the one rule both the scan and a rescan use now.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import type { Hidden } from '../lib/hidden'
import { useShards } from './useShards'

const item = (eventId: string): Hidden => ({
  eventId,
  type: 'message',
  text: 'tell your cat I said pspsps',
  at: { x: 1n, y: 2n, z: 3n },
  plane: 0,
  height: 12,
  author: 'ab'.repeat(32),
  lookupId: 'cd'.repeat(32),
  createdAt: 1,
} as unknown as Hidden)

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {} })
})

describe('freshOf', () => {
  it('a first find is fresh; after it is opened it never is again, even after a reload empties discovered', () => {
    const a = item('a'.repeat(64))
    expect(useShards.getState().freshOf([a])).toHaveLength(1)
    useShards.getState().addDiscovered([a])
    expect(useShards.getState().freshOf([a])).toHaveLength(0)
    // A reload: the in-memory record is gone, the device still knows.
    useShards.setState({ discovered: {} })
    expect(useShards.getState().freshOf([a])).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem('onosendai:seen') ?? '[]')).toContain(a.eventId)
  })

  it('this identity\'s own deployments are never fresh', () => {
    const own = item('b'.repeat(64))
    useShards.setState({ mine: [{ eventId: own.eventId } as never] })
    expect(useShards.getState().freshOf([own])).toHaveLength(0)
  })

  it('deleted items are never fresh, and an unseen neighbour still is', () => {
    const gone = item('c'.repeat(64))
    const other = item('d'.repeat(64))
    useShards.setState({ deleted: { [gone.eventId]: true } })
    expect(useShards.getState().freshOf([gone, other]).map((h) => h.eventId)).toEqual([other.eventId])
  })
})
