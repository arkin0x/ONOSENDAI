/**
 * carriedHeight.test.ts: a new deploy never starts past SCAN_MAX_HEIGHT on a
 * height carried from the last one (owner, 2026-11-14: a player's shards
 * hidden at 13 were "missing" on his laptop). Messages, keys, audio and a copy
 * placed from ITEMS start at the height the bar stood at; one above 12 (a + by
 * hand, an EDIT of an item hidden there) came along unchosen, and no scan
 * finds a bag there, not even on the hider's other devices. A height of 12 or
 * less still carries as it always did.
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { SCAN_MAX_HEIGHT, useShards, type MyDeployment } from '../useShards'
import { useCyberspace } from '../useCyberspace'

const S = () => useShards.getState()

beforeEach(() => {
  useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
})

describe('a deploy that does not fit its height', () => {
  it('a message after a height above 12 starts at 12', () => {
    useShards.setState({ deployHeight: SCAN_MAX_HEIGHT + 2 })
    S().startDeployMessage('hello')
    expect(S().deployHeight).toBe(SCAN_MAX_HEIGHT)
    expect(S().deployHeightAuto).toBe(false)
  })

  it('a key after one starts at 12 too', () => {
    useShards.setState({ deployHeight: SCAN_MAX_HEIGHT + 1 })
    S().startDeployKey({ name: 'k', lockPubkey: 'a'.repeat(64), secret: 'b'.repeat(64) } as never)
    expect(S().deployHeight).toBe(SCAN_MAX_HEIGHT)
  })

  it('a height of 12 or less carries as before', () => {
    useShards.setState({ deployHeight: 9 })
    S().startDeployMessage('hello')
    expect(S().deployHeight).toBe(9)
    S().cancelDeploy()
    useShards.setState({ deployHeight: SCAN_MAX_HEIGHT })
    S().startDeployMessage('again')
    expect(S().deployHeight).toBe(SCAN_MAX_HEIGHT)
  })

  it('a MOVE of a message hidden at 13 keeps its own height: it stays in its bag', () => {
    const me = useCyberspace.getState().identity.pubkey
    const row = { eventId: 'f'.repeat(64), type: 'message', text: 'up high', lookupId: 'd'.repeat(64), keyHex: 'e'.repeat(64), height: SCAN_MAX_HEIGHT + 1, plane: 0, at: { x: '1', y: '1', z: '1' }, createdAt: 1, published: true, inner: { id: 'f'.repeat(64), pubkey: me, kind: 1, tags: [], content: 'up high', created_at: 1 } } as unknown as MyDeployment
    useShards.setState({ mine: [row], deployHeight: 3 })
    S().startMoveItem(row.eventId)
    expect(S().pending?.type).toBe('message')
    expect(S().deployHeight).toBe(SCAN_MAX_HEIGHT + 1)
  })
})
