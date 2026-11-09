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
 * leaving it short; "SYNCING · N" vanishing on reload, or
 * showing at 75 s instead of 60; and, the other way, a list the relay has
 * long caught up on (a stale one in storage, or the self-check taking the
 * relay's newest page of 500 for all it holds) shown as missing and sent
 * again one event at a time, forever.
 *
 * The canonical relay is a fake here, at the level of relay.ts: countRelay
 * and askRelay answer a check by id from `stored` (at most 500 to a filter,
 * as grain does), publishOnceTo is a send. canonicalReconcile.test.ts
 * drives the same pass over a fake socket, AUTH and all.
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
    /** How many ids each COUNT asked about. */
    counts: [] as number[],
    /** The REQ of the check gets no answer in time. */
    checkFails: false,
    /** ...but sends back what it had before time ran out. */
    partialOnFail: false,
    /** COUNT is not to be had (unsupported, refused, no answer). */
    countFails: false,
    /** What the canonical relay says to a send of these ids, instead of taking it. */
    refuse: new Map<string, string>(),
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
      const refused = net.refuse.get(e.id)
      if (refused) return { ok: false as const, reason: refused }
      return net.canonicalOk ? { ok: true as const, accepted: [actual.CYBERSPACE_RELAY] } : { ok: false as const, reason: 'timeout' }
    },
    countRelay: async (_url: string, filter: { ids?: string[] }) => {
      net.counts.push(filter.ids?.length ?? 0)
      if (net.countFails) return null
      const want = new Set(filter.ids ?? [])
      return net.stored.filter((e) => want.has(e.id)).length
    },
    askRelay: async (url: string, filter: { ids?: string[]; limit?: number }) => {
      net.checks.push(filter.ids?.length ?? 0)
      const want = new Set(filter.ids ?? [])
      const held = net.stored.filter((e) => want.has(e.id)).slice(0, Math.min(500, filter.limit ?? 500))
      if (net.checkFails) return { url, outcome: 'unreachable' as const, reason: 'no answer in time', events: net.partialOnFail ? held : [] }
      return { url, outcome: 'answered' as const, events: held }
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
  net.toCanonical = []; net.sentAt = []; net.canonicalOk = false; net.canonicalHolds = []; net.stored = []; net.checks = []; net.counts = []
  net.checkFails = false; net.partialOnFail = false; net.countFails = false; net.refuse = new Map()
}
const keyOf = (pk: string): string => `onosendai:canonical-pending:${pk}`
/**
 * What a reload finds in storage, `ago` ms old: as a build before this one
 * saved every entry, and this one saves an entry not known to be missing
 * (a bare time), or, with `missing`, one known to be ([time, 1]).
 */
function leftInStorage(pk: string, events: NostrEvent[], ago: number, missing = false): void {
  localStorage.setItem(keyOf(pk), JSON.stringify(Object.fromEntries(events.map((e) => [e.id, missing ? [Date.now() - ago, 1] : Date.now() - ago]))))
}
/** The most the strip ever showed while `run` ran. */
async function highest(store: Store, run: () => Promise<void>): Promise<number> {
  let top = store.useCyberspace.getState().canonicalLate
  const off = store.useCyberspace.subscribe((s) => { top = Math.max(top, s.canonicalLate) })
  try { await run() } finally { off() }
  return top
}

describe('actions the canonical relay has not taken', () => {
  it('survive a reload: still known to be missing, shown at once when they have waited past a minute, and asked for again', async () => {
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
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      net.toCanonical = []
      pub.startPublisher()
      // The canonical relay never said OK to it, and that is remembered.
      expect(store.useCyberspace.getState().canonicalLate).toBe(1)
      net.canonicalOk = true
      await vi.advanceTimersByTimeAsync(5_000)
      expect(net.toCanonical).toEqual([chain[2].id])
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

  it('a real outage of the canonical relay shows: its own send never OK\'d and its check unanswered, an action is counted at the minute and sent again every pass', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.countFails = true; net.checkFails = true
      const { store, pub } = await page()
      const chain = chainOf(store, 2)
      hold(store, chain.slice(0, 2))
      pub.startPublisher()
      store.useCyberspace.setState({ live: true })
      await vi.advanceTimersByTimeAsync(10)
      store.useCyberspace.setState({ events: chain, prevEventId: chain[2].id, published: { ...store.useCyberspace.getState().published, [chain[2].id]: 'queued' } })
      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(61_000)
      expect(store.useCyberspace.getState().canonicalLate).toBe(1)
      // Passes at 5, 15 and 35 s: sent each time, whatever the unanswered check.
      expect(net.toCanonical).toEqual([chain[2].id, chain[2].id, chain[2].id])
      // The relay comes back: it lands, and the strip clears.
      net.countFails = false; net.checkFails = false; net.canonicalOk = true
      await vi.advanceTimersByTimeAsync(40_000)
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
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

  it('a stale list of 1520 an older build saved, all of them on the canonical relay: a COUNT per batch clears it, no events are fetched or sent, and the strip never shows it', async () => {
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
      // 1520 ids, 250 to a COUNT, and every count whole: no REQ at all.
      expect(net.counts).toEqual([250, 250, 250, 250, 250, 250, 20])
      expect(net.checks).toEqual([])
      expect(net.toCanonical).toEqual([])
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
      // And nothing is asked again.
      await vi.advanceTimersByTimeAsync(120_000)
      expect(net.counts).toHaveLength(7)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('of a stale list, only the 3 the relay truly lacks are sent again, in chain order, paced; only the batches that counted short are fetched', async () => {
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
      expect(net.checks).toEqual([250, 250])
      expect(net.toCanonical).toEqual(lacking.map((e) => e.id))
      expect(net.sentAt[1] - net.sentAt[0]).toBeGreaterThanOrEqual(pub.CANONICAL_SEND_GAP_MS)
      expect(net.sentAt[2] - net.sentAt[1]).toBeGreaterThanOrEqual(pub.CANONICAL_SEND_GAP_MS)
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('a check the canonical relay does not answer counts none of a stale list; after three such passes the list is sent anyway, and what the relay had clears', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.checkFails = true; net.countFails = true; net.canonicalOk = true
      const { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 12)
      hold(store, chain)
      net.stored = chain.slice(0, 10)
      leftInStorage(pk, chain.slice(1), 6 * 3_600_000)
      const top = await highest(store, async () => {
        pub.startPublisher()
        // Passes at 5 and 15 s: unanswered, nothing sent, nothing dropped.
        await vi.advanceTimersByTimeAsync(15_000)
        expect(net.checks).toEqual([12, 12])
        expect(net.toCanonical).toEqual([])
        expect(Object.keys(JSON.parse(localStorage.getItem(keyOf(pk)) ?? '{}'))).toHaveLength(12)
        // The third, at 35 s: still unanswered, so all 12 go out, paced, in chain order.
        await vi.advanceTimersByTimeAsync(20_000 + 12 * pub.CANONICAL_SEND_GAP_MS)
      })
      expect(top).toBe(0)
      expect(net.toCanonical).toEqual(chain.slice(1).map((e) => e.id))
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('a check that ran out of time still drops what it sent back, and marks nothing missing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.checkFails = true; net.partialOnFail = true; net.countFails = true; net.canonicalOk = true
      const { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 12)
      hold(store, chain)
      net.stored = chain.slice(0, 10)
      leftInStorage(pk, chain.slice(1), 6 * 3_600_000)
      pub.startPublisher()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(Object.keys(JSON.parse(localStorage.getItem(keyOf(pk)) ?? '{}')).sort()).toEqual([chain[10].id, chain[11].id, chain[12].id].sort())
      expect(net.toCanonical).toEqual([])
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('an event the relay refuses for good is skipped and counted, and the rest go on; a rate limit, in the relay\'s own words, ends the pass', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.canonicalOk = true
      const { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 6)
      hold(store, chain)
      net.stored = [chain[0]]
      net.refuse.set(chain[1].id, 'invalid: not a hop this relay will keep')
      net.refuse.set(chain[4].id, 'Rate limit exceeded for category: regular')
      leftInStorage(pk, chain.slice(1), 6 * 3_600_000)
      pub.startPublisher()
      await vi.advanceTimersByTimeAsync(6_500)
      // 1 refused for good, 2 and 3 taken, 4 rate-limited: 5 and 6 wait for the next pass.
      expect(net.toCanonical).toEqual([chain[1], chain[2], chain[3], chain[4]].map((e) => e.id))
      expect(Object.keys(JSON.parse(localStorage.getItem(keyOf(pk)) ?? '{}')).sort()).toEqual([chain[1], chain[4], chain[5], chain[6]].map((e) => e.id).sort())
      expect(store.useCyberspace.getState().canonicalLate).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('"error:" from the relay is its storage for the moment, not the event: it ends the pass, and nothing after it is sent until the next', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.canonicalOk = true
      const { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 4)
      hold(store, chain)
      net.stored = [chain[0]]
      net.refuse.set(chain[2].id, 'error: failed to save event: database is locked')
      leftInStorage(pk, chain.slice(1), 6 * 3_600_000)
      pub.startPublisher()
      await vi.advanceTimersByTimeAsync(6_500)
      expect(net.toCanonical).toEqual([chain[1], chain[2]].map((e) => e.id))
      // The storage is back: the next pass sends the rest, from where it stopped.
      net.refuse.clear()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(net.toCanonical).toEqual([chain[1], chain[2], chain[2], chain[3], chain[4]].map((e) => e.id))
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('during a long send the strip counts down as they land, not only at the end', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      reset(); net.canonicalOk = true
      const { store, pub } = await page()
      const pk = store.useCyberspace.getState().identity.pubkey
      const chain = chainOf(store, 25)
      hold(store, chain)
      leftInStorage(pk, chain.slice(1), 6 * 3_600_000, true)
      pub.startPublisher()
      expect(store.useCyberspace.getState().canonicalLate).toBe(25)
      // The pass starts at 5 s; ten sends, 250 ms apart, are out by 7.25 s.
      await vi.advanceTimersByTimeAsync(5_000 + 10 * pub.CANONICAL_SEND_GAP_MS + 10)
      expect(store.useCyberspace.getState().canonicalLate).toBe(15)
      await vi.advanceTimersByTimeAsync(25 * pub.CANONICAL_SEND_GAP_MS)
      expect(store.useCyberspace.getState().canonicalLate).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)

  it('the startup check on a chain longer than the relay\'s 500 to a filter finds none missing when the relay holds them all, by COUNT alone', async () => {
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
      // The 700 below the page were counted by id, and all are there.
      expect(net.counts).toEqual([250, 250, 200])
      expect(net.checks).toEqual([])
      expect(net.toCanonical).toEqual([])
      expect(top).toBe(0)
      expect(localStorage.getItem(keyOf(pk))).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)
})
