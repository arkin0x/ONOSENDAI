/**
 * profilesNewest.test.ts - which kind 0 a pubkey shows, and when.
 *
 * A kind 0 is replaceable (NIP-01): the newer created_at wins, and on the
 * same second "the event with the lowest id (first in lexical order) should
 * be retained". An older copy never replaces a newer one, the same event
 * again is taken (a better parse of it must be able to reach a cache that
 * holds it), and a fetch that found nothing never wipes a profile in hand.
 * Each relay is asked on its own, so a slow relay does not hold back a name
 * a fast one already sent.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from '../../lib/events'

const net = vi.hoisted(() => ({
  ask: null as null | ((relays: string[], filter: Filter, onEvent: (ev: NostrEvent) => void) => Promise<unknown>),
}))

/** A profile kept on the device by an earlier session, as a reload finds it: cached, never fetched this session. */
const KEPT_PK = vi.hoisted(() => {
  const pk = 'ab'.repeat(32)
  const mem = new Map<string, string>([['onosendai:profiles', JSON.stringify({ [pk]: { pubkey: pk, name: 'kept', picture: null, about: null, nip05: null, at: 900, id: 'cd'.repeat(32) } })]])
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
  return pk
})

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  relaySet: () => ['wss://cyberspace.test'],
  askEach: vi.fn((relays: string[], filter: Filter, onEvent: (ev: NostrEvent) => void) => net.ask!(relays, filter, onEvent)),
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newerProfile, parseProfile, profilesToKeep, PROFILES_KEPT, useProfiles, type Profile } from '../useProfiles'

beforeAll(() => {
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') (globalThis as { window?: unknown }).window = globalThis
})

afterEach(() => { vi.useRealTimers() })

function kind0(sk: Uint8Array, createdAt: number, name: string): NostrEvent {
  return finalizeEvent({ kind: 0, created_at: createdAt, tags: [], content: JSON.stringify({ name }) }, sk) as NostrEvent
}

const p = (over: Partial<Profile>): Profile => ({ pubkey: 'f'.repeat(64), name: 'x', picture: null, about: null, nip05: null, at: 100, id: '5'.repeat(64), ...over })

describe('which kind 0 is kept (NIP-01)', () => {
  it('takes a newer one and never an older one', () => {
    expect(newerProfile(p({ at: 100 }), p({ at: 101 }))).toBe(true)
    expect(newerProfile(p({ at: 101 }), p({ at: 100 }))).toBe(false)
    expect(newerProfile(undefined, p({}))).toBe(true)
    expect(newerProfile(null, p({}))).toBe(true)
  })

  it('on the same second keeps the lowest id, whichever arrived first', () => {
    const low = p({ id: '1'.repeat(64), name: 'low' })
    const high = p({ id: '9'.repeat(64), name: 'high' })
    expect(newerProfile(high, low)).toBe(true)
    expect(newerProfile(low, high)).toBe(false)
  })

  it('takes the same event again, so a fresh parse reaches a cache that holds it', () => {
    expect(newerProfile(p({ name: 'old parse' }), p({ name: 'new parse' }))).toBe(true)
    // A profile cached before ids were kept cannot be compared on a tie: the fresh copy is taken.
    expect(newerProfile(p({ id: undefined }), p({ id: '9'.repeat(64) }))).toBe(true)
  })

  it('remember() follows the same rule', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const a = kind0(sk, 500, 'a')
    const b = kind0(sk, 500, 'b')
    const [low, high] = a.id < b.id ? [a, b] : [b, a]
    useProfiles.getState().remember(high)
    useProfiles.getState().remember(low)
    useProfiles.getState().remember(high)
    expect(useProfiles.getState().profiles[pk]?.id).toBe(low.id)
    useProfiles.getState().remember(kind0(sk, 400, 'older'))
    expect(useProfiles.getState().profiles[pk]?.id).toBe(low.id)
  })

  it('keeps the event id with the profile, so the rule still holds after a reload', () => {
    const sk = generateSecretKey()
    const ev = kind0(sk, 7, 'n')
    expect(parseProfile(ev)?.id).toBe(ev.id)
  })
})

describe('fetching', () => {
  it('a fetch that finds nothing leaves a cached profile in place', async () => {
    vi.useFakeTimers()
    expect(useProfiles.getState().profiles[KEPT_PK]?.name).toBe('kept')
    let asked = false
    net.ask = async (relays) => { asked = true; return relays.map((url) => ({ url, outcome: 'answered', events: [] })) }
    // Cached by an earlier session and not fetched in this one, so it is asked for again.
    useProfiles.getState().request(KEPT_PK)
    await vi.advanceTimersByTimeAsync(400)
    expect(asked).toBe(true)
    expect(useProfiles.getState().profiles[KEPT_PK]?.name).toBe('kept')
  })

  it('a fetch no relay answered does not mark a key as having no profile', async () => {
    vi.useFakeTimers()
    const pk = getPublicKey(generateSecretKey())
    net.ask = async (relays) => relays.map((url) => ({ url, outcome: 'unreachable', reason: 'down', events: [] }))
    useProfiles.getState().request(pk)
    await vi.advanceTimersByTimeAsync(400)
    expect(useProfiles.getState().profiles[pk]).toBeUndefined()
  })

  it('a name from a fast relay shows while a slow relay is still answering', async () => {
    vi.useFakeTimers()
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    let release: (v: unknown) => void = () => {}
    net.ask = (_relays, filter, onEvent) => {
      expect(filter.authors).toContain(pk)
      onEvent(kind0(sk, 1_000, 'fast'))
      return new Promise((r) => { release = r })
    }
    useProfiles.getState().request(pk)
    await vi.advanceTimersByTimeAsync(400)
    expect(useProfiles.getState().profiles[pk]?.name).toBe('fast')
    release([])
  })

  it('ignores an event for a key it did not ask about', async () => {
    vi.useFakeTimers()
    const asked = getPublicKey(generateSecretKey())
    const stranger = generateSecretKey()
    net.ask = async (relays, _f, onEvent) => {
      onEvent(kind0(stranger, 1, 'stranger'))
      return relays.map((url) => ({ url, outcome: 'answered', events: [] }))
    }
    useProfiles.getState().request(asked)
    await vi.advanceTimersByTimeAsync(400)
    expect(useProfiles.getState().profiles[getPublicKey(stranger)]).toBeUndefined()
  })
})

describe('what is kept on the device', () => {
  it('keeps at most PROFILES_KEPT real profiles, the most recently fetched first', () => {
    const cache: Record<string, Profile | null> = {}
    const stamps = new Map<string, number>()
    for (let i = 0; i < PROFILES_KEPT + 5; i++) {
      const pk = i.toString(16).padStart(64, '0')
      cache[pk] = p({ pubkey: pk })
      stamps.set(pk, i)
    }
    cache['e'.repeat(64)] = null
    const kept = profilesToKeep(cache, stamps)
    expect(Object.keys(kept)).toHaveLength(PROFILES_KEPT)
    expect(kept['0'.repeat(64)]).toBeUndefined()
    expect(kept[(PROFILES_KEPT + 4).toString(16).padStart(64, '0')]).toBeDefined()
    expect(kept['e'.repeat(64)]).toBeUndefined()
  })
})
