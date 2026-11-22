/**
 * publisherStart.test.ts - a chain already in hand when the publisher starts
 * (a reload that read it from localStorage before anything listened): a LIVE
 * head that was signed while LIVE and never landed goes on by itself, after
 * the look at the relays; a head made LOCAL does not (owner, 2026-11-22).
 * Its own file, since the publisher starts once per module.
 */

import { describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from '../events'

const net = vi.hoisted(() => ({ sent: [] as string[], asked: 0, outbound: new Set<string>() }))
vi.mock('../relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../relay')>()),
  publish: (e: NostrEvent) => { net.sent.push(e.id); return Promise.resolve({ ok: true as const }) },
  countRelay: () => Promise.resolve(null),
  askRelay: (url: string) => Promise.resolve({ url, outcome: 'answered' as const, events: [] }),
  publishOnceTo: (url: string) => Promise.resolve({ ok: true as const, accepted: [url] }),
}))
vi.mock('../chainStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chainStore')>()),
  chainLanded: async () => true,
}))
vi.mock('../chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chains')>()),
  confirmChainEvents: () => { net.asked++; return Promise.resolve([]) },
}))
vi.mock('../../store/useCyberspace', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/useCyberspace')>()),
  signedOnThisPage: () => false,
  takeFreshHead: () => false,
  meantToGoOut: (_pk: string, id: string) => net.outbound.has(id),
}))

import { useCyberspace } from '../../store/useCyberspace'

const ev = (id: string): NostrEvent => ({ id: id.padEnd(64, '0'), pubkey: 'a'.repeat(64), created_at: 1, kind: 3333, tags: [], content: '', sig: 'f'.repeat(128) })

describe('the publisher, started with the chain already in hand', () => {
  it('sends a LIVE head that never landed, after the look, with no action', async () => {
    const [a, b] = [ev('a1'), ev('b2')]
    net.outbound.add(b.id)
    useCyberspace.setState({ live: true, events: [a, b], genesisId: a.id, prevEventId: b.id, published: { [a.id]: 'ok', [b.id]: 'queued' }, held: false, chainConflict: null })
    const { startPublisher } = await import('../publisher')
    startPublisher()
    await vi.waitFor(() => expect(net.sent).toEqual([b.id]), { timeout: 2000, interval: 10 })
    expect(net.asked).toBeGreaterThan(0)
  })
})
