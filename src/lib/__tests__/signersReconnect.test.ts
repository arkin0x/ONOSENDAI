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

import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools'

/** Loaded the way the app loads it, the store first (see signers.test.ts). */
async function deferredReconnect(...args: Parameters<typeof import('../signers')['deferredReconnect']>) {
  await import('../../store/useCyberspace')
  return (await import('../signers')).deferredReconnect(...args)
}

const sk = generateSecretKey()
const pubkey = getPublicKey(sk)
const template: EventTemplate = { kind: 22242, created_at: 1, tags: [['relay', 'wss://r.example'], ['challenge', 'c']], content: '' }
const extension = (key: Uint8Array) => ({
  getPublicKey: async () => getPublicKey(key),
  signEvent: async (t: EventTemplate) => finalizeEvent(t, key),
})
const win = globalThis as { window?: { nostr?: unknown } }

describe('deferredReconnect with an extension (arkinox, 2026-10-13)', () => {
  it('waits for an extension injected after the page started, and signs', async () => {
    win.window = {}
    setTimeout(() => { win.window!.nostr = extension(sk) }, 300)
    const signer = await deferredReconnect({ kind: 'nip07', pubkey }, () => {})
    const signed = await signer.signEvent(template)
    expect(signed.pubkey).toBe(pubkey)
  })

  it('does not keep a failed reconnect: the next signature tries again', async () => {
    win.window = { nostr: { getPublicKey: async () => { throw new Error('locked') }, signEvent: async () => { throw new Error('locked') } } }
    const signer = await deferredReconnect({ kind: 'nip07', pubkey }, () => {})
    await expect(signer.signEvent(template)).rejects.toThrow('locked')
    win.window = { nostr: extension(sk) }
    const signed = await signer.signEvent(template)
    expect(signed.pubkey).toBe(pubkey)
  })

  it('refuses an extension now on another account', async () => {
    win.window = { nostr: extension(generateSecretKey()) }
    const signer = await deferredReconnect({ kind: 'nip07', pubkey }, () => {})
    await expect(signer.signEvent(template)).rejects.toThrow('different account')
  })
})
