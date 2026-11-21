import { afterEach, describe, expect, it, vi } from 'vitest'

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

import { generateSecretKey, getPublicKey, nip19, verifyEvent, type EventTemplate } from 'nostr-tools'
import { attributed } from '../client'
import { DEFAULT_SIGNER_RELAY } from '../loginCredentials'
import { NIP44_MAX_PLAINTEXT_BYTES, nip46PlaintextBytes, signerRequestTooBigMessage } from '../signerRequestSize'

/** signers, loaded the way the app loads it: the store first (see signers.test.ts). */
async function signers(): Promise<typeof import('../signers')> {
  await import('../../store/useCyberspace')
  return import('../signers')
}

/**
 * A restored Nostr Connect session on the real nostr-tools BunkerSigner, its
 * pool's sockets faked: every request it publishes is counted, and nothing
 * touches the network. Its answers never come; these tests only ask whether
 * a request went out.
 */
async function sessionSigner() {
  const { signerFromPref } = await signers()
  const { getSignerPool } = await import('../relay')
  const pool = getSignerPool()
  const published: unknown[] = []
  vi.spyOn(pool, 'subscribe').mockImplementation(((_relays: string[], _filter: unknown, params: { oneose?: () => void }) => {
    params?.oneose?.()
    return { close: () => {} }
  }) as never)
  vi.spyOn(pool, 'publish').mockImplementation(((_relays: string[], event: unknown) => {
    published.push(event)
    return [Promise.resolve('ok')]
  }) as never)
  const signer = await signerFromPref({
    kind: 'nip46',
    pubkey: getPublicKey(generateSecretKey()),
    bunkerUri: `bunker://${getPublicKey(generateSecretKey())}?relay=${encodeURIComponent(DEFAULT_SIGNER_RELAY)}`,
    clientNsec: nip19.nsecEncode(generateSecretKey()),
    nostrConnectSession: true,
  })
  return { signer, published }
}

/** Long enough for a request that does go out to be published (answersFirst waits on the subscription first). */
const settle = () => new Promise((r) => setTimeout(r, 20))

/**
 * A kind 33331 template whose sign_event request needs `target` bytes of
 * NIP-44 plaintext, give or take the request id (a few bytes, random in
 * length: nostr-tools' idPrefix). Its content is plain letters, which JSON
 * leaves as they are, so content length moves the size one for one.
 */
function sized(target: number): EventTemplate {
  const at = (n: number): EventTemplate => ({ kind: 33331, created_at: 1_700_000_000, tags: [['d', 'big-shard']], content: 'a'.repeat(n) })
  const bytes = (n: number) => nip46PlaintextBytes('sign_event', [JSON.stringify(attributed(at(n)))], 'abcdef-1')
  return at(target - bytes(0))
}

afterEach(() => { vi.restoreAllMocks() })

describe('a remote signer request too big for one NIP-44 message (arkinox, 2026-11-21)', () => {
  it('is never sent, and fails at once in words that name the sizes', async () => {
    const { signer, published } = await sessionSigner()
    try {
      // The owner's big shard, hidden by reference: about 71,800 bytes of object.
      const err = await signer.signEvent(sized(71_800)).then(() => null, (e: unknown) => e)
      await settle()
      expect(published).toHaveLength(0)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('SignerRequestTooBig')
      expect((err as Error).message).toMatch(/^This is too big for your signer app to sign \(it can take about 65 KB, this needs 7\d KB\)\. Make the shard smaller, or sign in with a key on this device\.$/)
      expect((err as Error).message).not.toContain('—')
    } finally {
      await signer.close?.()
    }
  })

  it('is said as it is where a move says a failed signature, not as "Signing failed"', async () => {
    const { signingFailed } = await import('../signWithin')
    const { signer } = await sessionSigner()
    try {
      const err = await signer.signEvent(sized(NIP44_MAX_PLAINTEXT_BYTES + 100)).then(() => null, (e: unknown) => e)
      expect(signingFailed(err)).toBe((err as Error).message)
      expect(signingFailed(err)).toMatch(/^This is too big for your signer app/)
    } finally {
      await signer.close?.()
    }
  })

  it('goes out when it is just under the limit', async () => {
    const { signer, published } = await sessionSigner()
    try {
      // The answer is unasked for here: the signature is left waiting, and only its request counted.
      void signer.signEvent(sized(NIP44_MAX_PLAINTEXT_BYTES - 40)).catch(() => undefined)
      await settle()
      expect(published).toHaveLength(1)
    } finally {
      await signer.close?.()
    }
  })

  it('covers a seal and an open too: every NIP-46 method goes through the one guard', async () => {
    const { signer, published } = await sessionSigner()
    const them = getPublicKey(generateSecretKey())
    try {
      const sealing = await signer.nip44Encrypt!(them, 'a'.repeat(60_000)).then(() => null, (e: unknown) => e)
      expect((sealing as Error).name).toBe('SignerRequestTooBig')
      expect((sealing as Error).message).toMatch(/^This is too big for your signer app to seal .*Make it smaller, or sign in with a key on this device\.$/)
      const opening = await signer.nip44Decrypt!(them, 'A'.repeat(70_000)).then(() => null, (e: unknown) => e)
      expect((opening as Error).name).toBe('SignerRequestTooBig')
      expect((opening as Error).message).toMatch(/^This is too big for your signer app to open .*Sign in with a key on this device to open it\.$/)
      await settle()
      expect(published).toHaveLength(0)
    } finally {
      await signer.close?.()
    }
  })
})

describe('the size a request needs', () => {
  it('is its own JSON when that is the longer', () => {
    const params = ['ab', 'cd']
    expect(nip46PlaintextBytes('nip44_decrypt', params, 'x-1')).toBe(JSON.stringify({ id: 'x-1', method: 'nip44_decrypt', params }).length)
  })

  it('is the answer when that is the longer: a signed event carries id, pubkey and sig on top', () => {
    const event = JSON.stringify({ kind: 1, created_at: 1, tags: [], content: 'a'.repeat(1000) })
    const request = JSON.stringify({ id: 'x-1', method: 'sign_event', params: [event] }).length
    expect(nip46PlaintextBytes('sign_event', [event], 'x-1')).toBeGreaterThan(request + 200)
  })

  it('counts bytes, not characters', () => {
    const ascii = nip46PlaintextBytes('nip44_decrypt', ['', 'a'], 'x-1')
    expect(nip46PlaintextBytes('nip44_decrypt', ['', 'é'], 'x-1')).toBe(ascii + 1)
  })

  it('names the noun only for a shard', () => {
    const note = JSON.stringify({ kind: 30078, created_at: 1, tags: [], content: '' })
    expect(signerRequestTooBigMessage('sign_event', [note], 80_000)).toContain('Make it smaller')
  })
})

describe('a key on this device', () => {
  it('signs an event far past the limit, as before', async () => {
    const { localSigner } = await signers()
    const sk = generateSecretKey()
    const signed = await localSigner(sk).signEvent({ kind: 33331, created_at: 1, tags: [], content: 'a'.repeat(200_000) })
    expect(verifyEvent(signed)).toBe(true)
    expect(signed.pubkey).toBe(getPublicKey(sk))
  })
})
