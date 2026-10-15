/**
 * holderWait.test.ts - confirming a head waits for every relay that holds
 * this identity's chain, up to the deadline, and for no other (arkinox's
 * ruling of 2026-10-08 on the slow-relay grace).
 *
 * The real confirmChainEvents and queryEachSettled over a stand-in for
 * nostr-tools' pool, each relay answering after its own round trip.
 *
 * What would go wrong silently: a relay of the player's that holds a newer
 * move from another device, but answers in a second, cut off 400 ms after
 * the canonical relay answered, so the move is signed from a stale head and
 * forks the chain; a slow relay that never held the chain slowing every
 * move; and a chain-holding relay gone dead holding a move for longer than
 * the 2.5 s per question, or refusing it.
 */

import { describe, expect, it, vi } from 'vitest'

/** Each relay's behavior, by normalized URL: when it answers, what it holds, or that it never answers or cannot be reached. */
const net = vi.hoisted(() => ({
  relays: [] as string[],
  behavior: new Map<string, { eoseMs?: number; events?: unknown[]; hung?: boolean; down?: boolean; connectMs?: number }>(),
}))
vi.mock('../../store/useRelays', () => ({
  DEFAULT_RELAY: 'ws://canonical.test',
  currentRelays: () => net.relays,
}))
vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: { getState: () => ({ signEvent: async (t: unknown) => t }) },
}))
vi.mock('nostr-tools/abstract-pool', async () => {
  const { matchFilter } = await import('nostr-tools/filter')
  type Ev = Parameters<typeof matchFilter>[1]
  class FakeRelay {
    url: string
    // A challenge, so authenticating is one quick signature rather than a wait for a challenge that never comes.
    challenge = 'c'
    authPromise: Promise<string> | undefined
    constructor(url: string) { this.url = url }
    auth(): Promise<string> {
      this.authPromise ??= Promise.resolve('ok')
      return this.authPromise
    }
    subscribe(filters: Array<Parameters<typeof matchFilter>[0]>, h: { onevent: (e: Ev) => void; oneose: () => void }): { close: () => void } {
      const b = net.behavior.get(this.url) ?? {}
      const t = setTimeout(() => {
        for (const e of (b.events ?? []) as Ev[]) if (filters.some((f) => matchFilter(f, e))) h.onevent(e)
        if (!b.hung) h.oneose()
      }, b.eoseMs ?? 10)
      return { close: () => clearTimeout(t) }
    }
  }
  class AbstractSimplePool {
    relays = new Map<string, FakeRelay>()
    async ensureRelay(url: string): Promise<FakeRelay> {
      if (net.behavior.get(url)?.down) throw new Error('connection refused')
      const connectMs = net.behavior.get(url)?.connectMs
      if (connectMs && !this.relays.has(url)) await new Promise((r) => setTimeout(r, connectMs))
      if (!this.relays.has(url)) this.relays.set(url, new FakeRelay(url))
      return this.relays.get(url) as FakeRelay
    }
    close(urls: string[]): void { for (const u of urls) this.relays.delete(u) }
    publish(): Promise<string>[] { return [] }
  }
  return { AbstractSimplePool }
})

import { normalizeURL } from 'nostr-tools/utils'
import { confirmChainEvents } from '../chains'
import { noteChainHolders } from '../chainHolders'
import { hopTemplate, spawnTemplate, type NostrEvent } from '../events'

const C = normalizeURL('ws://canonical.test')

/** One identity's chain: a spawn, its first hop (published, the anchor), and another device's newer move. */
function chainFor(seed: string): { pk: string; spawn: NostrEvent; hop1: NostrEvent; hop2: NostrEvent } {
  const pk = seed.repeat(32)
  const spawn: NostrEvent = { ...spawnTemplate(pk, 1_000), id: `${seed}01`.padEnd(64, '0'), pubkey: pk, sig: '0'.repeat(128) }
  const hop = (n: number, previous: NostrEvent): NostrEvent => ({
    ...hopTemplate({ createdAt: 1_000 + n * 10, genesisId: spawn.id, previousId: previous.id, prevCoordHex: pk, to: { x: BigInt(n), y: 1n, z: 1n }, plane: 0, proofHash: '0'.repeat(64) }),
    id: `${seed}0${n + 1}`.padEnd(64, '0'),
    pubkey: pk,
    sig: '0'.repeat(128),
  })
  const hop1 = hop(1, spawn)
  return { pk, spawn, hop1, hop2: hop(2, hop1) }
}

/** Confirm the head `hop1`, as a move does, timed. */
async function confirm(c: ReturnType<typeof chainFor>, maxWait?: number): Promise<{ got: NostrEvent[] | null; ms: number }> {
  const t = Date.now()
  const got = await confirmChainEvents(c.pk, c.spawn.id, [c.spawn, c.hop1], { since: c.hop1.created_at, anchorId: c.hop1.id, maxWait })
  return { got, ms: Date.now() - t }
}

describe('waiting for the relays that hold the chain (ruling of 2026-10-08 on the slow-relay grace)', () => {
  it('the canonical relay answers fast, a chain-holding relay at a 1 s round trip holds the newer move: it is found, for the caller to adopt and refuse on', async () => {
    const c = chainFor('a1')
    const U = normalizeURL('ws://mine-1s.test')
    net.relays = [C, U]
    noteChainHolders(c.pk, [U])
    net.behavior.set(C, { eoseMs: 20, events: [c.spawn, c.hop1] })
    net.behavior.set(U, { eoseMs: 1_000, events: [c.spawn, c.hop1, c.hop2] })
    const { got, ms } = await confirm(c)
    expect(got?.map((e) => e.id)).toContain(c.hop2.id)
    expect(ms).toBeGreaterThanOrEqual(950)
  })

  it('a slow relay that never held the chain does not delay a pass', async () => {
    const c = chainFor('b2')
    const S = normalizeURL('ws://slow-stranger.test')
    net.relays = [C, S]
    net.behavior.set(C, { eoseMs: 20, events: [c.spawn, c.hop1] })
    net.behavior.set(S, { eoseMs: 2_000, events: [] })
    const { got, ms } = await confirm(c)
    expect(got).not.toBeNull()
    expect(got?.map((e) => e.id)).not.toContain(c.hop2.id)
    // At the canonical relay's answer, not 400 ms after it, and not at the stranger's 2 s.
    expect(ms).toBeLessThan(300)
  })

  it('a chain-holding relay gone dead (connected, never answering) delays a pass by the per-question wait at most, from when the requests went out', async () => {
    const c = chainFor('c3')
    const H = normalizeURL('ws://mine-hung.test')
    net.relays = [C, H]
    noteChainHolders(c.pk, [H])
    net.behavior.set(C, { eoseMs: 20, events: [c.spawn, c.hop1] })
    net.behavior.set(H, { hung: true })
    // maxWait 600 stands in for the 2.5 s: waited for until 600 ms after the
    // REQs went out, not 400 ms after the canonical relay answered (the old
    // grace), and not the overall 2 x 600 + 100 ms.
    const { got, ms } = await confirm(c, 600)
    expect(got).not.toBeNull()
    expect(ms).toBeGreaterThanOrEqual(570)
    expect(ms).toBeLessThan(800)
  })

  it('a chain-holding relay slow to connect, then silent, is still waited for only until the per-question wait after the first REQ', async () => {
    const c = chainFor('c7')
    const H = normalizeURL('ws://mine-cold.test')
    net.relays = [C, H]
    noteChainHolders(c.pk, [H])
    net.behavior.set(C, { eoseMs: 20, events: [c.spawn, c.hop1] })
    // Its own REQ goes out 400 ms late; its own timer would run to about 1,000 ms.
    net.behavior.set(H, { hung: true, connectMs: 400 })
    const { got, ms } = await confirm(c, 600)
    expect(got).not.toBeNull()
    expect(ms).toBeLessThan(800)
  })

  it('a chain-holding relay that refuses the connection costs nothing', async () => {
    const c = chainFor('d4')
    const D = normalizeURL('ws://mine-down.test')
    net.relays = [C, D]
    noteChainHolders(c.pk, [D])
    net.behavior.set(C, { eoseMs: 20, events: [c.spawn, c.hop1] })
    net.behavior.set(D, { down: true })
    const { got, ms } = await confirm(c, 300)
    expect(got).not.toBeNull()
    expect(ms).toBeLessThan(300)
  })

  it('a relay not yet seen holding the chain is not waited for, but its late answer is noted: the next confirmation waits for it and finds the newer move', async () => {
    const c = chainFor('f6')
    const N = normalizeURL('ws://mine-new.test')
    net.relays = [C, N]
    net.behavior.set(C, { eoseMs: 20, events: [c.spawn, c.hop1] })
    net.behavior.set(N, { eoseMs: 300, events: [c.spawn, c.hop1, c.hop2] })
    const first = await confirm(c)
    expect(first.got?.map((e) => e.id)).not.toContain(c.hop2.id)
    expect(first.ms).toBeLessThan(250)
    await new Promise((r) => setTimeout(r, 400))
    const second = await confirm(c)
    expect(second.got?.map((e) => e.id)).toContain(c.hop2.id)
  })

  it('with the canonical relay silent, a chain-holding relay is not waited for past its own timer: refused at the question\'s deadline, as before', async () => {
    const c = chainFor('e5')
    const H = normalizeURL('ws://mine-hung2.test')
    net.relays = [C, H]
    noteChainHolders(c.pk, [H])
    net.behavior.set(C, { hung: true })
    net.behavior.set(H, { hung: true })
    const { got, ms } = await confirm(c, 300)
    expect(got).toBeNull()
    expect(ms).toBeLessThan(600)
  })
})
