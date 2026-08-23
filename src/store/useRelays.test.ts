/**
 * useRelays.test.ts - a relay list is a set of real ws URLs, and the default
 * is always in it.
 */

import { describe, it, expect } from 'vitest'
import { DEFAULT_RELAY, normalizeRelay } from './useRelays'

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

  it('has cyberspace.nostr1.com as the default', () => {
    expect(DEFAULT_RELAY).toBe('wss://cyberspace.nostr1.com')
    expect(normalizeRelay(DEFAULT_RELAY)).toBe(DEFAULT_RELAY)
  })
})
