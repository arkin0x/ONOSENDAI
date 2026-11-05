/**
 * useRelays.test.ts - a relay list is a set of real ws URLs, and the default
 * is always in it.
 */

import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_RELAY, PINNED_RELAYS, RETIRED_HOSTS, SECOND_RELAY, isRetiredRelay, normalizeRelay } from '../useRelays'

describe('normalizeRelay', () => {
  it('accepts and completes real relay hosts', () => {
    expect(normalizeRelay('relay.example.com')).toBe('wss://relay.example.com')
    expect(normalizeRelay('wss://relay.example.com')).toBe('wss://relay.example.com')
    expect(normalizeRelay('wss://relay.example.com/')).toBe('wss://relay.example.com')
    expect(normalizeRelay('ws://localhost:7777')).toBe('ws://localhost:7777')
    expect(normalizeRelay('  wss://a.b.c  ')).toBe('wss://a.b.c')
    expect(normalizeRelay('wss://relay.example.com/inbox')).toBe('wss://relay.example.com/inbox')
  })

  it('rejects non-URLs and wrong schemes', () => {
    expect(normalizeRelay('not a url')).toBeNull()
    expect(normalizeRelay('')).toBeNull()
    expect(normalizeRelay('http://relay.example.com')).toBeNull()
    expect(normalizeRelay('wss://')).toBeNull()
    expect(normalizeRelay('justaword')).toBeNull()
    expect(normalizeRelay('wss://has space.com')).toBeNull()
  })

  it('has one canonical relay as the default: a wss:// address, already normalized', () => {
    expect(DEFAULT_RELAY).toMatch(/^wss:\/\/[a-z0-9.-]+$/)
    expect(normalizeRelay(DEFAULT_RELAY)).toBe(DEFAULT_RELAY)
  })
})

describe('a retired relay', () => {
  const RETIRED = 'wss://onosendai.feeds.relay.tools'

  /** The store as a new page gets it, with this list already saved. */
  async function loadWith(saved: unknown[]): Promise<{ store: typeof import('../useRelays')['useRelays']; storage: Map<string, string> }> {
    const storage = new Map([['onosendai:relays', JSON.stringify(saved)]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v) } })
    vi.resetModules()
    return { store: (await import('../useRelays')).useRelays, storage }
  }

  it('is wss://onosendai.feeds.relay.tools (the owner, 2026-10-31), however the URL is written', () => {
    expect(RETIRED_HOSTS).toEqual(['onosendai.feeds.relay.tools'])
    const host = 'onosendai.feeds.relay.tools'
    for (const spelled of [RETIRED, `${RETIRED}/`, host, 'WSS://Onosendai.Feeds.Relay.Tools', ` ${RETIRED} `,
      `wss://${host}//`, `https://${host}`, `http://${host}`, `ws://${host}`, `wss://${host}.`, `wss://${host}/x`, `wss://${host}:443`, `wss://${host}/?a=1`]) {
      expect(isRetiredRelay(spelled), spelled).toBe(true)
    }
    for (const other of [DEFAULT_RELAY, 'not a url', '', `wss://x.${host}`, 'wss://feeds.relay.tools', `wss://${host}.evil.example`, 'wss://relay.onosendai.tech']) {
      expect(isRetiredRelay(other), other).toBe(false)
    }
  })

  it('leaves a saved list on load, on disk too, and the other relays stay', async () => {
    const { store, storage } = await loadWith([`${RETIRED}/`, 'wss://mine.example'])
    expect(store.getState().relays).toEqual([DEFAULT_RELAY, SECOND_RELAY, 'wss://mine.example'])
    expect(JSON.parse(storage.get('onosendai:relays')!)).toEqual(['wss://mine.example'])
    vi.unstubAllGlobals()
  })

  it('cannot be added back', async () => {
    const { store } = await loadWith([])
    expect(store.getState().add(RETIRED)).toBeNull()
    expect(store.getState().relays).toEqual([DEFAULT_RELAY, SECOND_RELAY])
    vi.unstubAllGlobals()
  })
})

describe('the canonical relay switch (the owner, 2026-11-05)', () => {
  /** The store as a new page gets it, with this list already saved (or nothing, with null). */
  async function loadWith(saved: unknown[] | null): Promise<{ store: typeof import('../useRelays')['useRelays']; storage: Map<string, string> }> {
    const storage = new Map<string, string>(saved === null ? [] : [['onosendai:relays', JSON.stringify(saved)]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v) } })
    vi.resetModules()
    return { store: (await import('../useRelays')).useRelays, storage }
  }

  it('is wss://relay.onosendai.tech, with wss://cyberspace.nostr1.com pinned second', () => {
    expect(DEFAULT_RELAY).toBe('wss://relay.onosendai.tech')
    expect(SECOND_RELAY).toBe('wss://cyberspace.nostr1.com')
    expect(PINNED_RELAYS).toEqual(['wss://relay.onosendai.tech', 'wss://cyberspace.nostr1.com'])
  })

  it('gives a page with nothing saved both, the new relay first', async () => {
    const { store } = await loadWith(null)
    expect(store.getState().relays).toEqual(['wss://relay.onosendai.tech', 'wss://cyberspace.nostr1.com'])
    vi.unstubAllGlobals()
  })

  it('puts both in front of a list saved before the switch, and never saves either', async () => {
    const { store, storage } = await loadWith(['wss://mine.example', 'wss://relay.onosendai.tech/'])
    expect(store.getState().relays).toEqual(['wss://relay.onosendai.tech', 'wss://cyberspace.nostr1.com', 'wss://mine.example'])
    store.getState().add('wss://other.example')
    expect(JSON.parse(storage.get('onosendai:relays')!)).toEqual(['wss://mine.example', 'wss://other.example'])
    vi.unstubAllGlobals()
  })

  it('cannot remove either pinned relay; reset keeps both', async () => {
    const { store } = await loadWith(['wss://mine.example'])
    store.getState().remove('wss://relay.onosendai.tech')
    store.getState().remove('wss://cyberspace.nostr1.com')
    expect(store.getState().relays).toEqual(['wss://relay.onosendai.tech', 'wss://cyberspace.nostr1.com', 'wss://mine.example'])
    store.getState().reset()
    expect(store.getState().relays).toEqual(['wss://relay.onosendai.tech', 'wss://cyberspace.nostr1.com'])
    vi.unstubAllGlobals()
  })
})
