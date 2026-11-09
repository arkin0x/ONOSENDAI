/**
 * canonicalPending.test.ts - published actions the canonical relay has not
 * taken survive a reload, the startup check finds the ones it lacks, and the
 * status strip says so at the minute (verification of #236, findings 3 and
 * 7); and the strip never says so of actions the relay holds (the owner,
 * 2026-11-09: "1520 actions not on wss://relay.onosendai.tech yet", every
 * one of them on it).
 *
 * What would go wrong silently: a reload forgetting that the canonical
 * relay never took some actions, so devices that read only that relay never
 * see them; the self-check reading the canonical relay's shorter chain and
 * leaving it short; "N NOT ON THE MAIN RELAY YET" vanishing on reload, or
 * showing at 75 s instead of 60; and, the other way, a list the relay has
 * long caught up on (a stale one in storage, or the self-check taking the
 * relay's newest page of 500 for all it holds) shown as missing and sent
 * again one event at a time, forever.
 *
 * The canonical relay is a fake here, at the level of relay.ts: askRelay
 * answers a check by id from `stored` (at most 500 to a filter, as grain
 * does), publishOnceTo is a re-send. canonicalReconcile.test.ts drives the
 * same pass over a fake socket.
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
  return {
    /** Each re-send to the canonical relay, by id, and when (Date.now). */
    toCanonical: [] as string[],
    sentAt: [] as number[],
    canonicalOk: false,
    /** What the startup self-check's chain read gets back from the canonical relay. */
    canonicalHolds: [] as unknown[],
    /** What the canonical relay holds, as a check by id finds it. */
    stored: [] as Array<{ id: string }>,
    /** How many ids each check REQ asked about. */
    checks: [] as number[],
    /** The check gets no answer in time. */
    checkFails: false,
  }
})
vi.mock('../relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay')>()
  return {
    ...actual,
    // Every publish lands on a relay of the player's, never on the canonical one.
    publish: async () => ({ ok: true as const, accepted: ['wss://mine.example/'] }),
    publishOnceTo: async (_url: string, e: { id: string }) => {
      net.toCanonical.push(e.id)
      net.sentAt.push(Date.now())
      return net.canonicalOk ? { ok: true as const, accepted: [actual.CYBERSPACE_RELAY] } : { ok: false as const, reason: 'timeout' }
    },
    askRelay: async (url: string, filter: { ids?: string[]; limit?: number }) => {
      net.checks.push(filter.ids?.length ?? 0)
      if (net.checkFails) return { url, outcome: 'unreachable' as const, reason: 'no answer in time', events: [] }
      const want = new Set(filter.ids ?? [])
      return { url, outcome: 'answered' as const, events: net.stored.filter((e) => want.has(e.id)).slice(0, Math.min(500, filter.limit ?? 500)) }
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

import { getEventHash } from 'nostr-tools/pure'
import type { NostrEvent } from '../events'
import { spawnTemplate } from '../events'
import { hopEvent } from './chainFixtures'

type Store = typeof import('../../store/useCyberspace')
type Pub = typeof import('../publisher')

/** A fresh page: the store and the publisher loaded again, storage as it was. */
async function page(): Promise<{ store: Store; pub: Pub }> {
  vi.resetModules()
  return { store: await import('../../store/useCyberspace'), pub: await import('../publisher') }
}

/** Its id made the hash of what it says, as a relay's events are: the check by id holds a relay to that. */
function hashed(e: NostrEvent): NostrEvent {
  return { ...e, id: getEventHash(e) }
}

/** This identity's chain, every action published (on some relay). */
function chainOf(store: Store, hops: number): NostrEvent[] {
  const pk = store.useCyberspace.getState().identity.pubkey
  const spawn = hashed({ ...spawnTemplate(pk, 1_000), id: '', pubkey: pk, sig: '0'.repeat(128) })
  const out = [spawn]
  for (let i = 1; i <= hops; i++) out.push(hashed(hopEvent({ pubkey: pk, createdAt: 1_000 + i, genesisId: spawn.id, previousId: out[i - 1].id, c: pk, to: { x: BigInt(i), y: 0n, z: 0n } })))
  return out
}
function hold(store: Store, events: NostrEvent[]): void {
  store.useCyberspace.setState({ events, genesisId: events[0].id, prevEventId: events[events.length - 1].id, published: Object.fromEntries(events.map((e) => [e.id, 'ok' as const])) })
}
function reset(): void {
  localStorage.clear()
  net.toCanonical = []; net.sentAt = []; net.canonicalOk = false; net.canonicalHolds = []; net.stored = []; net.checks = []; net.checkFails = false
}
const keyOf = (pk: string): string => `onosendai:canonical-pending:${pk}`
/** What a reload of a page that last saw these as not on the canonical relay finds in storage, `ago` ms old. */
function leftInStorage(pk: string, events: NostrEvent[], ago: number): void {
  localStorage.setItem(keyOf(pk), JSON.stringify(Object.fromEntries(events.map((e) => [e.id, Date.now() - ago]))))
}
/** The most the strip ever showed while `run` ran. */
async function highest(store: Store, run: () => Promise<void>): Promise<number> {
  let top = store.useCyberspace.getState().canonicalLate
  const off = store.useCyberspace.subscribe((s) => { top = Math.max(top, s.canonicalLate) })
  try { await run() } finally { off() }
  return top
}

describe('actions the canonical relay has not taken', () => {
  it('survive a reload: asked for again, and the strip says so at once when the first check finds them still missing after a minute', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset()
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
      expect(JSON.parse(localStorage.getItem(keyOf(pk)) ?? '{}')).toHaveProperty(chain[2].id)
      await vi.advanceTimersByTimeAsync(61_000)
      expect(store.useCyberspace.getState().canonicalLate).toBe(1)
      // Reload: the old page's timers go with it (and clearing them winds the fake clock back, so it is set again).
      const reloadedAt = Date.now()
      vi.clearAllTimers()
      vi.setSystemTime(reloadedAt)
      ;({ store, pub } = await page())
      hold(store, chain)
      net.toCanonical = []
      pub.startPublisher()
      // What storage says is not yet a finding: nothing shown until the relay is asked.
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      await vi.advanceTimersByTimeAsync(5_000)
      // Asked: it truly lacks it, and it has waited past a minute already.
      expect(net.toCanonical).toEqual([chain[2].id])
      expect(store.useCyberspace.getState().canonicalLate).toBe(1)
      net.canonicalOk = true
      await vi.advanceTimersByTimeAsync(10_000)
      expect(net.toCanonical).toEqual([chain[2].id, chain[2].id])
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('the strip says so at the minute itself, not at the next retry after it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset()
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
  }, 20_000)

  it('the startup check finds published actions the canonical relay lacks, sends them to it, and never shortens this device\'s chain', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.canonicalOk = true
      const { store, pub } = await page()
      const chain = chainOf(store, 3)
      hold(store, chain)
      pub.startPublisher()
      // The canonical relay holds only the spawn and the first hop.
      net.canonicalHolds = chain.slice(0, 2)
      net.stored = chain.slice(0, 2)
      const { recheckNow } = await import('../selfSync')
      recheckNow()
      await vi.advanceTimersByTimeAsync(10)
      expect(store.useCyberspace.getState().events.map((e) => e.id)).toEqual(chain.map((e) => e.id))
      await vi.advanceTimersByTimeAsync(5_500)
      // In chain order, so every prefix the relay holds is a chain.
      expect(net.toCanonical).toEqual([chain[2].id, chain[3].id])
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('a stale list of 1520 a reload brought back, all of them on the canonical relay: one batched check clears it, nothing is sent, and the strip never shows it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset()
      const { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 1520)
      hold(store, chain)
      net.stored = chain
      leftInStorage(pk, chain.slice(1), 6 * 3_600_000)
      const top = await highest(store, async () => {
        pub.startPublisher()
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(top).toBe(0)
      // 1520 ids, 500 to a REQ.
      expect(net.checks).toEqual([500, 500, 500, 20])
      expect(net.toCanonical).toEqual([])
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
      // And nothing is asked again.
      await vi.advanceTimersByTimeAsync(120_000)
      expect(net.checks).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('of a stale list, only the 3 the relay truly lacks are sent again, in chain order, paced, and the rest clear', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.canonicalOk = true
      const { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 1520)
      hold(store, chain)
      const lacking = [chain[700], chain[701], chain[1400]]
      net.stored = chain.filter((e) => !lacking.includes(e))
      leftInStorage(pk, chain.slice(1), 6 * 3_600_000)
      pub.startPublisher()
      await vi.advanceTimersByTimeAsync(6_000)
      expect(net.toCanonical).toEqual(lacking.map((e) => e.id))
      expect(net.sentAt[1] - net.sentAt[0]).toBeGreaterThanOrEqual(pub.CANONICAL_SEND_GAP_MS)
      expect(net.sentAt[2] - net.sentAt[1]).toBeGreaterThanOrEqual(pub.CANONICAL_SEND_GAP_MS)
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('a check the canonical relay does not answer keeps the list and counts none of it; the next one that is answered decides', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.checkFails = true; net.canonicalOk = true
      const { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 12)
      hold(store, chain)
      net.stored = chain.slice(0, 10)
      leftInStorage(pk, chain.slice(1), 6 * 3_600_000)
      const top = await highest(store, async () => {
        pub.startPublisher()
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(top).toBe(0)
      expect(net.checks).toEqual([12])
      // A timeout is not "missing": nothing sent, nothing dropped.
      expect(net.toCanonical).toEqual([])
      expect(Object.keys(JSON.parse(localStorage.getItem(keyOf(pk)) ?? '{}'))).toHaveLength(12)
      net.checkFails = false
      await vi.advanceTimersByTimeAsync(11_000)
      expect(net.toCanonical).toEqual([chain[10].id, chain[11].id, chain[12].id])
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('the startup check on a chain longer than the relay\'s 500 to a filter finds none missing when the relay holds them all', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.canonicalOk = true
      const { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 1199)
      hold(store, chain)
      pub.startPublisher()
      // The chain read gets the relay's newest page, as relay.onosendai.tech answers one.
      net.canonicalHolds = chain.slice(-500)
      net.stored = chain
      const top = await highest(store, async () => {
        const { recheckNow } = await import('../selfSync')
        recheckNow()
        await vi.advanceTimersByTimeAsync(70_000)
      })
      // The 700 below the page were asked about by id, and all are there.
      expect(net.checks).toEqual([500, 200])
      expect(net.toCanonical).toEqual([])
      expect(top).toBe(0)
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)
})
