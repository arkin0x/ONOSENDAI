/**
 * relayAutoAuthSwitch.test.ts - a socket signed in by nostr-tools on its own
 * is replaced on a switch of identity, like any other (identity-switch audit,
 * 2026-11-19).
 *
 * A switch replaces every socket signed in as the old key (relay.ts
 * reauthAs). It knew of a socket only once relay.ts's own sign-in had
 * settled on it (settleAuth). nostr-tools answers a gating relay's challenge
 * by itself the moment it comes (automaticallyAuth), and a socket opened by a
 * read that does not sign in first (a count, a feed read, a light publish)
 * was signed in that way only: a switch left it signed in as the old key,
 * and the new identity's reads and writes went over the old one's sign-in,
 * tying the two keys together at the relay. The relay here is the fake one
 * of authGatedNet.ts, the old relay (it gates reads, so its challenge is
 * signed as it comes): no socket leaves the process.
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
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { authGatedNet, BACKUP } from './authGatedNet'

afterEach(() => { vi.useRealTimers() })

describe('a switch of identity with a socket nostr-tools signed in by itself', () => {
  it('replaces that socket at the switch, so nothing of the new identity goes over the old sign-in', async () => {
    vi.useFakeTimers()
    const net = authGatedNet()
    net.openReads = true
    net.gatedBackup = true
    net.install()
    const { useCyberspace } = await import('../../store/useCyberspace')
    const { countRelay, getPool, signedIn } = await import('../relay')
    const a = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(a))
    // A count signs nothing in itself: the socket it opens is signed in by
    // nostr-tools alone, answering the relay's challenge as it comes.
    const counting = countRelay(BACKUP, { kinds: [1] }, 200)
    await vi.advanceTimersByTimeAsync(500)
    await counting
    const relays = (getPool() as unknown as { relays: Map<string, { connected: boolean }> }).relays
    const old = relays.get(BACKUP)
    expect(old?.connected).toBe(true)
    expect(net.canon.authBy).toEqual([getPublicKey(a)])
    expect(net.canon.authOk).toBe(1)
    // relay.ts's own sign-in never settled on it: only nostr-tools signed it in.
    expect(signedIn(BACKUP)).toBe(false)
    // At the switch itself (relay.ts's watch runs before this one), before
    // any read of the new identity could look at the socket.
    let keptAtSwitch: boolean | null = null
    const stop = useCyberspace.subscribe((now, before) => {
      if (now.identity.pubkey !== before.identity.pubkey && keptAtSwitch === null) keptAtSwitch = relays.get(BACKUP) === old && old?.connected === true
    })
    try {
      await useCyberspace.getState().useNsec(nip19.nsecEncode(generateSecretKey()))
    } finally {
      stop()
    }
    expect(keptAtSwitch).toBe(false)
  })
})
