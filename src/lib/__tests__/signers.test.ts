import { describe, expect, it, vi } from 'vitest'

/**
 * The bunker a restored session talks to, as a fake: what it was asked is
 * recorded, and it opens no socket, so no unit test touches the network
 * (this test used to open one to 127.0.0.1:9).
 */
const bunker = vi.hoisted(() => ({ built: 0, asked: [] as string[], holds: '' }))

vi.mock('nostr-tools/nip46', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools/nip46')>()
  const fake = {
    connect: async () => { bunker.asked.push('connect') },
    getPublicKey: async () => { bunker.asked.push('getPublicKey'); return bunker.holds },
    sendRequest: async (method: string) => { bunker.asked.push(method); return method === 'get_public_key' ? bunker.holds : '' },
    signEvent: async () => { bunker.asked.push('sign_event'); throw new Error('not in this test') },
    nip44Decrypt: async () => { bunker.asked.push('nip44_decrypt'); return '' },
    nip44Encrypt: async () => { bunker.asked.push('nip44_encrypt'); return '' },
    close: async () => undefined,
  }
  return {
    ...actual,
    BunkerSigner: {
      ...actual.BunkerSigner,
      fromBunker: () => { bunker.built++; return fake },
      fromURI: actual.BunkerSigner.fromURI,
    },
  }
})

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
} from '../loginCredentials'

/**
 * signers, loaded the way the app loads it: the store first. signers imports
 * the relay layer, which imports the store, which imports signers; entered
 * from signers, that cycle reaches the store before signers has finished.
 */
async function signers(): Promise<typeof import('../signers')> {
  await import('../../store/useCyberspace')
  return import('../signers')
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
    bunker.built = 0
    bunker.asked = []
    const { signerFromPref } = await signers()
    const signer = await signerFromPref({
      kind: 'nip46',
      pubkey: saved,
      bunkerUri: `bunker://${remote}?relay=wss://relay.example`,
      clientNsec: nip19.nsecEncode(generateSecretKey()),
      nostrConnectSession: true,
    })
    expect(signer.pubkey).toBe(saved)
    expect(bunker.built).toBe(1)
    expect(bunker.asked).toEqual([])
    await signer.close?.()
  })

  it('asks which account the signer holds only when asked, and afresh each time', async () => {
    const saved = getPublicKey(generateSecretKey())
    const other = getPublicKey(generateSecretKey())
    bunker.asked = []
    bunker.holds = saved
    const { signerFromPref } = await signers()
    const signer = await signerFromPref({
      kind: 'nip46',
      pubkey: saved,
      bunkerUri: `bunker://${getPublicKey(generateSecretKey())}?relay=wss://relay.example`,
      clientNsec: nip19.nsecEncode(generateSecretKey()),
      nostrConnectSession: true,
    })
    expect(await signer.heldPubkey?.()).toBe(saved)
    // Switched in the signer app: the answer follows, never a cached one.
    bunker.holds = other
    expect(await signer.heldPubkey?.()).toBe(other)
    expect(bunker.asked).toEqual(['get_public_key', 'get_public_key'])
  })
})
