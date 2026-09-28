import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIGNER_RELAY,
  loginCredentialKind,
  normalizeSignerRelay,
} from './loginCredentials'

describe('login credential classification', () => {
  it('accepts every credential supported by the shared login field', () => {
    expect(loginCredentialKind('  nsec1secret ')).toBe('nsec')
    expect(loginCredentialKind('ncryptsec1encrypted')).toBe('ncryptsec')
    expect(loginCredentialKind('bunker://abc')).toBe('bunker')
  })

  it('does not guess for unsupported input', () => {
    expect(loginCredentialKind('npub1public')).toBeNull()
    expect(loginCredentialKind('')).toBeNull()
  })
})

describe('Nostr Connect session setup', () => {
  it('normalizes WebSocket relay URLs and rejects web URLs', () => {
    expect(normalizeSignerRelay(' wss://bucket.coracle.social/ ')).toBe(DEFAULT_SIGNER_RELAY)
    expect(normalizeSignerRelay('ws://localhost:7777/path/')).toBe('ws://localhost:7777/path')
    expect(() => normalizeSignerRelay('https://bucket.coracle.social')).toThrow(/wss:\/\//)
  })
})
