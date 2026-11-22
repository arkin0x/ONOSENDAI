/**
 * authChurn.test.ts - a relay's NIP-42 challenge is signed only where it is
 * needed, and a socket signed in on is not thrown away by a short idle spell
 * (the owner, 2026-11-22: "im looking at my signer and it receives a client
 * authentication event like every minute for onosendai. what's that about?").
 *
 * Every relay ONOSENDAI talks to challenges each socket as it opens, and the
 * client signed every challenge as it came: the notifications poll opened a
 * fresh socket to each of the owner's read relays once a minute (the last one
 * had closed as idle), and each was a request to his remote signer. Now a
 * challenge is signed up front only where the relay gates what the client
 * does there (relay.ts relayGates), or for a protected event; elsewhere only
 * when the relay answers "auth-required:". The relay is the fake one of
 * authGatedNet.ts: no socket leaves the process.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.unmock('../../lib/relay')

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

vi.mock('../workers', async (o) => ({ ...(await o<typeof import('../workers')>()), postProof: vi.fn(), cancelProof: vi.fn() }))
vi.mock('../chains', async (o) => ({ ...(await o<typeof import('../chains')>()), fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []) }))

import { nip19 } from 'nostr-tools'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { authGatedNet, CANON, type AuthGatedNet } from './authGatedNet'
import type { NostrEvent } from '../events'

afterEach(() => { vi.useRealTimers() })

/** A page load: fresh modules (a fresh pool, nothing known of any relay), on a fresh fake network. */
async function visit(setup: (net: AuthGatedNet) => void) {
  vi.resetModules()
  vi.useFakeTimers()
  const net = authGatedNet()
  setup(net)
  net.install()
  const { useCyberspace } = await import('../../store/useCyberspace')
  const relay = await import('../relay')
  const sk = generateSecretKey()
  await useCyberspace.getState().useNsec(nip19.nsecEncode(sk))
  /** Run `p` to its end while the fake clock moves. */
  const settle = async <T>(p: Promise<T>, ms = 3_000): Promise<T> => { await vi.advanceTimersByTimeAsync(ms); return p }
  const note = (tags: string[][] = []): NostrEvent => finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content: 'x' }, sk) as unknown as NostrEvent
  return { net, relay, settle, note }
}

describe('a relay that challenges every socket and serves reads anyway (relay.onosendai.tech)', () => {
  // The first test of the file loads the store's modules, which takes seconds on a busy machine.
  it('is never signed in to for reads, a live feed and a plain publish', async () => {
    const { net, relay, settle, note } = await visit((n) => { n.openReads = true; n.protectedNeedsAuth = true })
    const read = await settle(relay.queryEachAt([CANON], { kinds: [1] }, 2_000))
    expect(read[0]?.outcome).toBe('answered')
    const stop = relay.subscribe({ kinds: [3333] }, () => {})
    // Minutes of a live feed: the pool's pings every 29 s, nothing else.
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    const sent = await settle(relay.publishMany([CANON], note()))
    stop()
    expect(sent.ok).toBe(true)
    expect(net.canon.authBy).toEqual([])
    expect(relay.signInOwed(CANON)).toBe(false)
  }, 30_000)

  it('signs in once for a protected event, and the next protected event rides on that sign-in', async () => {
    const { net, relay, settle, note } = await visit((n) => { n.openReads = true; n.protectedNeedsAuth = true })
    const first = note([['-']])
    expect((await settle(relay.publishMany([CANON], first))).ok).toBe(true)
    expect(net.canon.authBy).toHaveLength(1)
    const second = note([['-']])
    expect((await settle(relay.publishMany([CANON], second))).ok).toBe(true)
    expect(net.canon.authBy).toHaveLength(1)
    expect(net.canon.taken).toEqual([first.id, second.id])
  })
})

describe('a relay that gates reads', () => {
  it('signs in when refused, and a read a minute later rides on the same socket and sign-in', async () => {
    const { net, relay, settle } = await visit(() => {})
    const first = await settle(relay.queryEachAt([CANON], { kinds: [1] }, 2_000))
    expect(first[0]?.outcome).toBe('answered')
    expect(net.canon.refusedReqs).toBe(1)
    expect(net.canon.authBy).toHaveLength(1)
    // Past the pool's 20 s idle close: a socket signed in on stays (SIGNED_IN_IDLE_MS).
    await vi.advanceTimersByTimeAsync(60_000)
    const again = await settle(relay.queryEachAt([CANON], { kinds: [1] }, 2_000))
    expect(again[0]?.outcome).toBe('answered')
    expect(net.canon.authBy).toHaveLength(1)
    expect(net.canon.sockets).toBe(1)
  })

  it('a socket signed in on still closes once idle for SIGNED_IN_IDLE_MS, however many pings it answered meanwhile', async () => {
    const { relay, settle } = await visit(() => {})
    await settle(relay.queryEachAt([CANON], { kinds: [1] }, 2_000))
    const relays = (relay.getPool() as unknown as { relays: Map<string, { connected: boolean }> }).relays
    expect(relays.get(CANON)?.connected).toBe(true)
    // Pings every 29 s all along: none of them is work that keeps it open.
    await vi.advanceTimersByTimeAsync(relay.SIGNED_IN_IDLE_MS - 60_000)
    expect(relays.get(CANON)?.connected).toBe(true)
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(relays.get(CANON)?.connected ?? false).toBe(false)
  })

  it('once known to gate, a new socket is signed in as its challenge comes, and its read is not refused first', async () => {
    const { net, relay, settle } = await visit(() => {})
    await settle(relay.queryEachAt([CANON], { kinds: [1] }, 2_000))
    expect(net.canon.refusedReqs).toBe(1)
    net.dropCanon()
    await vi.advanceTimersByTimeAsync(100)
    const read = await settle(relay.queryEachAt([CANON], { kinds: [1] }, 2_000))
    expect(read[0]?.outcome).toBe('answered')
    expect(net.canon.sockets).toBe(2)
    expect(net.canon.refusedReqs).toBe(1)
    expect(net.canon.authBy).toHaveLength(2)
  })
})
