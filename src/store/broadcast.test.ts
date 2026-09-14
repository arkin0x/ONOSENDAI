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

describe('taking a published bag down', () => {
  beforeEach(async () => {
    const dep = await localDeployment()
    useShards.setState({ mine: [{ ...dep, published: true, relays: ['wss://relay.test'] }], deleted: {}, deletedBags: {}, discovered: {} })
    vi.mocked(publishMany).mockClear()
    localStorage.removeItem('onosendai:bags-deleted')
  })

  it('tells the relay even while LOCAL, since the bag is already out there', async () => {
    // LOCAL used to silence this, which deleted the bag on this device only
    // and left it on the relay for good with nothing on screen saying so.
    useCyberspace.setState({ live: false })
    const id = useShards.getState().mine[0].eventId
    await useShards.getState().deleteInstance(id)
    expect(vi.mocked(publishMany)).toHaveBeenCalledTimes(1)
    const [, del] = vi.mocked(publishMany).mock.calls[0]
    expect(del.kind).toBe(5)
    // kind 33330 is addressable, so the address is what a relay replaces.
    expect(del.tags.some((t) => t[0] === 'a' && t[1].startsWith('33330:'))).toBe(true)
    expect(del.tags.some((t) => t[0] === 'e')).toBe(true)
    expect(useShards.getState().mine).toHaveLength(0)
  })

  it('remembers the bag by the key the public list uses, on disk', async () => {
    const item = useShards.getState().mine[0]
    await useShards.getState().deleteInstance(item.eventId)
    const key = `${item.inner.pubkey}:${item.lookupId}`
    expect(useShards.getState().deletedBags[key]).toBe(true)
    expect(JSON.parse(localStorage.getItem('onosendai:bags-deleted') ?? '[]')).toContain(key)
  })

  it('keeps what another device hid in the same region, which this one never saw', async () => {
    // Two things in one region, hidden from two devices. This device knows
    // one of them; the bag on the relay holds both. Deleting the known one
    // used to rebuild the bag from this device's list, so the other one fell
    // out, and when it was the only thing left the whole envelope was deleted
    // as if the bag were empty.
    const known = useShards.getState().mine[0]
    const other = await useCyberspace.getState().signEvent({
      kind: 30079, created_at: 1_800_000_100, content: 'from the other device', tags: [['d', 'other']],
    })
    useShards.setState({ mine: [known, { ...known, eventId: other.id, inner: other, text: 'from the other device' }] })
    // Publish the pair, and take the envelope the relay would now hold.
    // Publishing the pair needs LIVE on this branch; taking one down does not.
    useCyberspace.setState({ live: true })
    expect(await useShards.getState().broadcast(LOOKUP)).toBe(true)
    expect(vi.mocked(publishMany).mock.calls.length).toBeGreaterThan(0)
    const bag = vi.mocked(publishMany).mock.calls[0][1]
    expect(bag.kind).toBe(33330)

    // This device forgets the other one, exactly as a second device never
    // hears of it, and the relay answers with the bag that holds both.
    useShards.setState({ mine: [{ ...useShards.getState().mine[0] }] })
    vi.mocked(publishMany).mockClear()
    vi.mocked(query).mockResolvedValue([bag] as never)

    await useShards.getState().deleteInstance(known.eventId)

    const sent = vi.mocked(publishMany).mock.calls.map(([, ev]) => ev)
    // A rewrite of the bag, not a deletion of it: something was still inside.
    expect(sent.some((ev) => ev.kind === 5)).toBe(false)
    expect(sent.some((ev) => ev.kind === 33330)).toBe(true)
    expect(useShards.getState().deletedBags).toEqual({})
  })

  it('says nothing to the relay for a bag that was never on it', async () => {
    useShards.setState({ mine: [{ ...useShards.getState().mine[0], published: false, relays: [] }] })
    useCyberspace.setState({ live: true })
    await useShards.getState().deleteInstance(useShards.getState().mine[0].eventId)
    expect(vi.mocked(publishMany)).not.toHaveBeenCalled()
  })
})

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
