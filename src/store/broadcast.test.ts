import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store keeps deployments in localStorage; the test runs where there is none.
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

import { publishMany, query } from '../lib/relay'
import { useCyberspace } from './useCyberspace'
import { useShards, type MyDeployment } from './useShards'

const LOOKUP = 'ab'.repeat(16)

async function localDeployment(): Promise<MyDeployment> {
  const inner = await useCyberspace.getState().signEvent({
    kind: 30079,
    created_at: 1_800_000_000,
    content: 'hidden',
    tags: [['d', 'inner']],
  })
  return {
    eventId: inner.id,
    inner,
    bagId: 'ff'.repeat(32),
    type: 'message',
    text: 'hidden',
    at: { x: '1', y: '2', z: '3' },
    plane: 0,
    height: 8,
    lookupId: LOOKUP,
    keyHex: '11'.repeat(32),
    relays: [],
    createdAt: 1_800_000_000,
    published: false,
  }
}

describe('broadcasting a bag left LOCAL', () => {
  beforeEach(async () => {
    useShards.setState({ mine: [await localDeployment()], broadcasting: null, broadcastError: null })
    vi.mocked(publishMany).mockClear()
    vi.mocked(query).mockClear()
    useCyberspace.setState({ live: true })
  })

  it('sends the region and marks everything in it published', async () => {
    expect(await useShards.getState().broadcast(LOOKUP)).toBe(true)
    expect(vi.mocked(publishMany)).toHaveBeenCalledTimes(1)
    const [relays, event] = vi.mocked(publishMany).mock.calls[0]
    expect(relays).toEqual(['wss://relay.test'])
    // A fresh bag, not the stale envelope the local deploy recorded.
    expect(event.id).not.toBe('ff'.repeat(32))
    const row = useShards.getState().mine[0]
    expect(row.published).toBe(true)
    expect(row.bagId).toBe(event.id)
    expect(row.relays).toEqual(['wss://relay.test'])
    expect(useShards.getState().broadcasting).toBeNull()
  })

  it('refuses while LOCAL, and says why', async () => {
    useCyberspace.setState({ live: false })
    expect(await useShards.getState().broadcast(LOOKUP)).toBe(false)
    expect(vi.mocked(publishMany)).not.toHaveBeenCalled()
    expect(useShards.getState().broadcastError).toMatch(/LOCAL/)
    expect(useShards.getState().mine[0].published).toBe(false)
  })

  it('keeps the deployment local when no relay takes the bag', async () => {
    vi.mocked(publishMany).mockResolvedValueOnce({ ok: false, reason: 'no relay accepted it' })
    expect(await useShards.getState().broadcast(LOOKUP)).toBe(false)
    expect(useShards.getState().mine[0].published).toBe(false)
    expect(useShards.getState().broadcastError).toMatch(/No relay/)
    expect(useShards.getState().broadcasting).toBeNull()
  })

  it('merges what the relay already holds for the region rather than overwriting it', async () => {
    await useShards.getState().broadcast(LOOKUP)
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(query).mock.calls[0][0]).toMatchObject({ '#d': [LOOKUP] })
  })
})
