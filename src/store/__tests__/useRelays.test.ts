/**
 * useRelays.test.ts - a relay list is a set of real ws URLs, and the default
 * is always in it.
 */

import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_RELAY, RETIRED_RELAYS, isRetiredRelay, normalizeRelay } from '../useRelays'

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
    expect(RETIRED_RELAYS).toEqual([RETIRED])
    expect(isRetiredRelay(`${RETIRED}/`)).toBe(true)
    expect(isRetiredRelay('onosendai.feeds.relay.tools')).toBe(true)
    expect(isRetiredRelay('WSS://Onosendai.Feeds.Relay.Tools')).toBe(true)
    expect(isRetiredRelay(DEFAULT_RELAY)).toBe(false)
    expect(isRetiredRelay('not a url')).toBe(false)
  })

  it('leaves a saved list on load, on disk too, and the other relays stay', async () => {
    const { store, storage } = await loadWith([`${RETIRED}/`, 'wss://mine.example'])
    expect(store.getState().relays).toEqual([DEFAULT_RELAY, 'wss://mine.example'])
    expect(JSON.parse(storage.get('onosendai:relays')!)).toEqual(['wss://mine.example'])
    vi.unstubAllGlobals()
  })

  it('cannot be added back', async () => {
    const { store } = await loadWith([])
    expect(store.getState().add(RETIRED)).toBeNull()
    expect(store.getState().relays).toEqual([DEFAULT_RELAY])
    vi.unstubAllGlobals()
  })
})
