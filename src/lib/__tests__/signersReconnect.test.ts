import { describe, expect, it, vi } from 'vitest'

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
/** Enough for the wait for window.nostr, which finds one at once here. */
const NIP07_POLL_GRACE = 1000

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

  it('does not keep a handshake that never answers: the next signature tries again (arkinox, 2026-11-01)', async () => {
    const { HANDSHAKE_PATIENCE_MS } = await import('../signWithin')
    win.window = { nostr: { getPublicKey: () => new Promise(() => {}), signEvent: async () => { throw new Error('never asked') } } }
    const signer = await deferredReconnect({ kind: 'nip07', pubkey }, () => {})
    vi.useFakeTimers()
    try {
      const first = signer.signEvent(template)
      const refused = expect(first).rejects.toThrow('did not answer')
      await vi.advanceTimersByTimeAsync(NIP07_POLL_GRACE + HANDSHAKE_PATIENCE_MS)
      await refused
      win.window = { nostr: extension(sk) }
      const signed = await signer.signEvent(template)
      expect(signed.pubkey).toBe(pubkey)
    } finally {
      vi.useRealTimers()
    }
  })

  it('takes a handshake that answers after the limit, and a wake does not ask again (review of #581)', async () => {
    const { HANDSHAKE_PATIENCE_MS } = await import('../signWithin')
    let asked = 0
    let approve: (pk: string) => void = () => {}
    win.window = { nostr: { ...extension(sk), getPublicKey: () => { asked++; return new Promise<string>((r) => { approve = r }) } } }
    const ready: unknown[] = []
    const signer = await deferredReconnect({ kind: 'nip07', pubkey }, (s) => ready.push(s))
    vi.useFakeTimers()
    try {
      const first = expect(signer.signEvent(template)).rejects.toThrow('did not answer')
      await vi.advanceTimersByTimeAsync(NIP07_POLL_GRACE + HANDSHAKE_PATIENCE_MS)
      await first
      // Back to the tab, well past the limit, more than once.
      for (let i = 0; i < 3; i++) {
        const wake = signer.reconnect!().catch(() => null)
        await vi.advanceTimersByTimeAsync(HANDSHAKE_PATIENCE_MS + 1)
        await wake
      }
      expect(asked).toBe(1)
      approve(pubkey)
      await vi.advanceTimersByTimeAsync(0)
    } finally {
      vi.useRealTimers()
    }
    expect(ready).toHaveLength(1)
    win.window = { nostr: extension(sk) }
    expect((await signer.signEvent(template)).pubkey).toBe(pubkey)
    expect(asked).toBe(1)
  })

  it('two attempts: the first to answer stays the signer, the other is handed on, and an old waiter hears it (review of #581)', async () => {
    const { HANDSHAKE_PATIENCE_MS } = await import('../signWithin')
    const approvals: Array<(pk: string) => void> = []
    win.window = { nostr: { ...extension(sk), getPublicKey: () => new Promise<string>((r) => { approvals.push(r) }) } }
    const ready: unknown[] = []
    const signer = await deferredReconnect({ kind: 'nip07', pubkey }, (s) => ready.push(s))
    vi.useFakeTimers()
    try {
      const first = expect(signer.signEvent(template)).rejects.toThrow('did not answer')
      await vi.advanceTimersByTimeAsync(NIP07_POLL_GRACE + HANDSHAKE_PATIENCE_MS)
      await first
      const wake = signer.reconnect!()
      const second = signer.signEvent(template)
      await vi.advanceTimersByTimeAsync(0)
      expect(approvals).toHaveLength(2)
      approvals[1](pubkey)
      await vi.advanceTimersByTimeAsync(0)
      expect(await wake).toBe(ready[0])
      expect((await second).pubkey).toBe(pubkey)
      approvals[0](pubkey)
      await vi.advanceTimersByTimeAsync(0)
      expect(ready).toHaveLength(2)
      expect(await signer.reconnect!()).toBe(ready[0])
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses an extension now on another account', async () => {
    win.window = { nostr: extension(generateSecretKey()) }
    const signer = await deferredReconnect({ kind: 'nip07', pubkey }, () => {})
    await expect(signer.signEvent(template)).rejects.toThrow('different account')
  })
})
