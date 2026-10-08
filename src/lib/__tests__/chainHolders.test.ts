/**
 * chainHolders.test.ts - which relays hold this identity's chain, the set a
 * move's confirmation waits for (arkinox's ruling of 2026-10-08 on the
 * slow-relay grace): a relay that took one of its chain events, or sent one
 * back, now or in an earlier session; the canonical relay always.
 *
 * What would go wrong silently: a relay another device publishes to never
 * counted as holding the chain, so its newer move is not waited for; a
 * relay that answered with nothing counted, so a slow stranger slows every
 * move; and a reload forgetting the set.
 */

import { describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
  }
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    ;(globalThis as { window?: unknown }).window = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) }
  }
  return { accepted: ['wss://mine.example/'] as string[] }
})
vi.mock('../relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay')>()
  return {
    ...actual,
    publish: async () => ({ ok: true as const, accepted: net.accepted }),
    publishMany: async () => ({ ok: true as const, accepted: [actual.CYBERSPACE_RELAY] }),
  }
})
// The fixtures carry no real signatures; the background check takes them as authentic.
vi.mock('../sigCheck', () => ({ checkSignatures: async () => new Set<string>() }))
vi.mock('../chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chains')>()
  return { ...actual, confirmChainEvents: async () => [], askChainEvents: async () => [] }
})

import { normalizeURL } from 'nostr-tools/utils'
import type { NostrEvent } from '../events'
import { spawnTemplate } from '../events'
import { hopEvent, nextId } from './chainFixtures'

type Holders = typeof import('../chainHolders')
const CANONICAL = normalizeURL('wss://cyberspace.nostr1.com')

/** A fresh page: every module loaded again, storage as it was. */
async function page(): Promise<{ holders: Holders; store: typeof import('../../store/useCyberspace'); pub: typeof import('../publisher') }> {
  vi.resetModules()
  return { holders: await import('../chainHolders'), store: await import('../../store/useCyberspace'), pub: await import('../publisher') }
}

const event = (pubkey: string): NostrEvent => ({ ...spawnTemplate(pubkey, 1_000), id: nextId(), pubkey, sig: '0'.repeat(128) })

describe('the relays that hold a chain', () => {
  it('the canonical relay always; another only once it sent back one of the identity\'s events; saved per identity, and a reload still knows it', async () => {
    localStorage.clear()
    let { holders } = await page()
    const pk = 'a7'.repeat(32)
    const other = 'b8'.repeat(32)
    expect([...holders.chainHolders(pk)]).toEqual([CANONICAL])
    holders.noteHoldersFrom(pk, [
      { url: 'wss://holds.example', outcome: 'answered', events: [event(pk)] },
      { url: 'wss://empty.example', outcome: 'answered', events: [] },
      { url: 'wss://someone-else.example', outcome: 'answered', events: [event(other)] },
      { url: 'wss://late.example', outcome: 'unreachable', reason: 'no answer in time', events: [event(pk)] },
    ])
    const want = [CANONICAL, normalizeURL('wss://holds.example'), normalizeURL('wss://late.example')].sort()
    expect([...holders.chainHolders(pk)].sort()).toEqual(want)
    expect([...holders.chainHolders(other)]).toEqual([CANONICAL])
    // Reload.
    ;({ holders } = await page())
    expect([...holders.chainHolders(pk)].sort()).toEqual(want)
    expect([...holders.chainHolders(other)]).toEqual([CANONICAL])
  })

  it('a relay that took one of the chain\'s actions holds it, saved beside the chain', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      localStorage.clear()
      const { holders, store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const spawn = event(pk)
      const hop = hopEvent({ pubkey: pk, createdAt: 1_001, genesisId: spawn.id, previousId: spawn.id, c: pk, to: { x: 1n, y: 0n, z: 0n } })
      store.useCyberspace.setState({ events: [spawn], genesisId: spawn.id, prevEventId: spawn.id, published: { [spawn.id]: 'ok' } })
      pub.startPublisher()
      store.useCyberspace.setState({ live: true })
      await vi.advanceTimersByTimeAsync(10)
      expect(holders.chainHolders(pk).has(normalizeURL('wss://mine.example'))).toBe(false)
      store.useCyberspace.setState({ events: [spawn, hop], prevEventId: hop.id, published: { [spawn.id]: 'ok', [hop.id]: 'queued' } })
      await vi.advanceTimersByTimeAsync(10)
      expect(store.useCyberspace.getState().published[hop.id]).toBe('ok')
      expect(holders.chainHolders(pk).has(normalizeURL('wss://mine.example'))).toBe(true)
      expect(JSON.parse(localStorage.getItem(`onosendai:chain-holders:${pk}`) ?? '[]')).toContain(normalizeURL('wss://mine.example'))
    } finally {
      vi.useRealTimers()
    }
  })
})
