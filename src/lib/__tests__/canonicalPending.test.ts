/**
 * canonicalPending.test.ts - published actions the canonical relay has not
 * taken survive a reload, the startup check finds the ones it lacks, and the
 * status strip says so at the minute (verification of #236, findings 3 and
 * 7).
 *
 * What would go wrong silently: a reload forgetting that the canonical
 * relay never took some actions, so devices that read only that relay never
 * see them; the self-check reading the canonical relay's shorter chain and
 * leaving it short; and "N NOT ON THE MAIN RELAY YET" vanishing on reload, or
 * showing at 75 s instead of 60.
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
  return { toCanonical: [] as string[], canonicalOk: false, canonicalHolds: [] as unknown[] }
})
vi.mock('../relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay')>()
  return {
    ...actual,
    // Every publish lands on a relay of the player's, never on the canonical one.
    publish: async () => ({ ok: true as const, accepted: ['wss://mine.example/'] }),
    publishMany: async (_relays: string[], e: { id: string }) => {
      net.toCanonical.push(e.id)
      return net.canonicalOk ? { ok: true as const, accepted: [actual.CYBERSPACE_RELAY] } : { ok: false as const, reason: 'timeout' }
    },
  }
})
// The fixtures carry no real signatures; the background check takes them as authentic.
vi.mock('../sigCheck', () => ({ checkSignatures: async () => new Set<string>() }))
vi.mock('../chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../chains')>()
  return {
    ...actual,
    confirmChainEvents: async () => [],
    // The startup check: the canonical relay answers with what it holds.
    askChainEvents: async () => [{ url: (await import('../relay')).CYBERSPACE_RELAY, outcome: 'answered' as const, events: net.canonicalHolds }],
  }
})

import type { NostrEvent } from '../events'
import { spawnTemplate } from '../events'
import { hopEvent, nextId } from './chainFixtures'

type Store = typeof import('../../store/useCyberspace')
type Pub = typeof import('../publisher')

/** A fresh page: the store and the publisher loaded again, storage as it was. */
async function page(): Promise<{ store: Store; pub: Pub }> {
  vi.resetModules()
  return { store: await import('../../store/useCyberspace'), pub: await import('../publisher') }
}

/** This identity's chain, every action published (on some relay). */
function chainOf(store: Store, hops: number): NostrEvent[] {
  const pk = store.useCyberspace.getState().identity.pubkey
  const spawn: NostrEvent = { ...spawnTemplate(pk, 1_000), id: nextId(), pubkey: pk, sig: '0'.repeat(128) }
  const out = [spawn]
  for (let i = 1; i <= hops; i++) out.push(hopEvent({ pubkey: pk, createdAt: 1_000 + i, genesisId: spawn.id, previousId: out[i - 1].id, c: pk, to: { x: BigInt(i), y: 0n, z: 0n } }))
  return out
}
function hold(store: Store, events: NostrEvent[]): void {
  store.useCyberspace.setState({ events, genesisId: events[0].id, prevEventId: events[events.length - 1].id, published: Object.fromEntries(events.map((e) => [e.id, 'ok' as const])) })
}

describe('actions the canonical relay has not taken', () => {
  it('survive a reload: asked for again, and the strip says so at once when they have waited past a minute', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      localStorage.clear(); net.toCanonical = []; net.canonicalOk = false
      let { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 2)
      hold(store, chain.slice(0, 2))
      pub.startPublisher()
      store.useCyberspace.setState({ live: true })
      await vi.advanceTimersByTimeAsync(10)
      // A new action, taken while Live: published, by the player's relay only.
      store.useCyberspace.setState({ events: chain, prevEventId: chain[2].id, published: { ...store.useCyberspace.getState().published, [chain[2].id]: 'queued' } })
      await vi.advanceTimersByTimeAsync(10)
      expect(JSON.parse(localStorage.getItem(`onosendai:canonical-pending:${pk}`) ?? '{}')).toHaveProperty(chain[2].id)
      await vi.advanceTimersByTimeAsync(61_000)
      // Reload.
      ;({ store, pub } = await page())
      hold(store, chain)
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      net.toCanonical = []
      pub.startPublisher()
      expect(store.useCyberspace.getState().canonicalLate).toBe(1)
      net.canonicalOk = true
      await vi.advanceTimersByTimeAsync(5_000)
      expect(net.toCanonical).toEqual([chain[2].id])
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      expect(localStorage.getItem(`onosendai:canonical-pending:${pk}`)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the strip says so at the minute itself, not at the next retry after it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      localStorage.clear(); net.toCanonical = []; net.canonicalOk = false
      const { store, pub } = await page()
      const chain = chainOf(store, 2)
      hold(store, chain.slice(0, 2))
      pub.startPublisher()
      store.useCyberspace.setState({ live: true })
      await vi.advanceTimersByTimeAsync(10)
      store.useCyberspace.setState({ events: chain, prevEventId: chain[2].id, published: { ...store.useCyberspace.getState().published, [chain[2].id]: 'queued' } })
      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(59_000)
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      await vi.advanceTimersByTimeAsync(1_100)
      expect(store.useCyberspace.getState().canonicalLate).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the startup check finds published actions the canonical relay lacks, sends them to it, and never shortens this device\'s chain', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      localStorage.clear(); net.toCanonical = []; net.canonicalOk = true
      const { store, pub } = await page()
      const chain = chainOf(store, 3)
      hold(store, chain)
      pub.startPublisher()
      // The canonical relay holds only the spawn and the first hop.
      net.canonicalHolds = chain.slice(0, 2)
      const { recheckNow } = await import('../selfSync')
      recheckNow()
      await vi.advanceTimersByTimeAsync(10)
      expect(store.useCyberspace.getState().events.map((e) => e.id)).toEqual(chain.map((e) => e.id))
      await vi.advanceTimersByTimeAsync(5_000)
      expect(net.toCanonical.sort()).toEqual([chain[2].id, chain[3].id].sort())
    } finally {
      vi.useRealTimers()
      net.canonicalHolds = []
    }
  })
})
