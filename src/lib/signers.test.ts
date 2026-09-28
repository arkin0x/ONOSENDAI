import { describe, expect, it } from 'vitest'

// signers imports the relay layer, which imports the store, which reads
// localStorage as it loads; the test runs where there is none.
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import {
  BACKUP_SIGNER_RELAY,
  DEFAULT_SIGNER_RELAY,
  loginCredentialKind,
  normalizeSignerRelay,
  signerRelays,
} from './loginCredentials'

/**
 * signers, loaded the way the app loads it: the store first. signers imports
 * the relay layer, which imports the store, which imports signers; entered
 * from signers, that cycle reaches the store before signers has finished.
 */
async function signers(): Promise<typeof import('./signers')> {
  await import('../store/useCyberspace')
  return import('./signers')
}

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

describe('Nostr Connect relays', () => {
  it('allows unencrypted ws:// only on this machine', () => {
    expect(normalizeSignerRelay('ws://127.0.0.1:7777')).toBe('ws://127.0.0.1:7777')
    expect(() => normalizeSignerRelay('ws://relay.example.com')).toThrow(/localhost/)
  })

  it('puts a backup relay in the default QR, and only the chosen one otherwise', async () => {
    expect(signerRelays(DEFAULT_SIGNER_RELAY)).toEqual([DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY])
    expect(signerRelays('wss://my.relay')).toEqual(['wss://my.relay'])
    const { createNostrConnectSession } = await signers()
    const relays = new URL(createNostrConnectSession().uri).searchParams.getAll('relay')
    expect(relays).toEqual([DEFAULT_SIGNER_RELAY, BACKUP_SIGNER_RELAY])
  })
})

describe('restoring a Nostr Connect session', () => {
  it('uses the pubkey saved at login and asks the signer nothing', async () => {
    const saved = getPublicKey(generateSecretKey())
    const remote = getPublicKey(generateSecretKey())
    const { signerFromPref } = await signers()
    const signer = await signerFromPref({
      kind: 'nip46',
      pubkey: saved,
      bunkerUri: `bunker://${remote}?relay=wss://127.0.0.1:9`,
      clientNsec: nip19.nsecEncode(generateSecretKey()),
      nostrConnectSession: true,
    })
    expect(signer.pubkey).toBe(saved)
    await signer.close?.()
  })
})
