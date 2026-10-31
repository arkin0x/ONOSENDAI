/**
 * minePerPubkeyTabs.test.ts - two tabs on one identity. A tab keeps its list in
 * memory and saves the whole of it, so without the storage event it would write
 * its older copy over a row the other tab just added.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => {
  const list: ((e: { key: string | null }) => void)[] = []
  const mem = new Map<string, string>()
  const g = globalThis as Record<string, unknown>
  if (typeof g.localStorage === 'undefined') {
    g.localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, String(v)) },
      removeItem: (k: string) => { mem.delete(k) },
      clear: () => { mem.clear() },
    }
  }
  // Only what this file's subject asks of a window: everything else stays as in node.
  const realWindow = g.window
  g.window = new Proxy({}, {
    get: (_t, name) => (name === 'addEventListener' ? (type: string, fn: (e: { key: string | null }) => void) => { if (type === 'storage') list.push(fn) } : (realWindow as Record<string | symbol, unknown> | undefined)?.[name]),
  })
  return list
})

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: [] }]),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { useShards, type MyDeployment } from '../useShards'

const row = (id: string, pubkey: string): MyDeployment => ({
  eventId: id, inner: { id, pubkey, kind: 1, created_at: 1, tags: [], content: '' }, bagId: `bag-${id}`, type: 'message', text: 'hello',
  at: { x: '1', y: '2', z: '3' }, plane: 0, height: 5, lookupId: 'l', keyHex: '00'.repeat(32), relays: [], createdAt: 1, published: true,
} as MyDeployment)
const fire = (key: string | null): void => { for (const h of handlers) h({ key }) }

beforeAll(async () => {
  await vi.waitFor(() => expect(handlers.length).toBeGreaterThan(0))
})

describe('another tab', () => {
  it('reads what the other tab wrote to this identity\'s list', () => {
    const me = useCyberspace.getState().identity.pubkey
    localStorage.setItem(`onosendai:deployments:${me}`, JSON.stringify([row('claimed', me)]))
    fire(`onosendai:deployments:${me}`)
    expect(useShards.getState().mine.map((d) => d.eventId)).toEqual(['claimed'])
  })

  it('ignores another identity\'s list and any other key', () => {
    const me = useCyberspace.getState().identity.pubkey
    useShards.setState({ mine: [row('mine', me)] })
    localStorage.setItem(`onosendai:deployments:${'b2'.repeat(32)}`, JSON.stringify([row('theirs', 'b2'.repeat(32))]))
    fire(`onosendai:deployments:${'b2'.repeat(32)}`)
    fire('onosendai:seen')
    fire(null)
    expect(useShards.getState().mine.map((d) => d.eventId)).toEqual(['mine'])
  })
})
