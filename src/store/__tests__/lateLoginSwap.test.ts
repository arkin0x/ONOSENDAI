/**
 * A login that finishes late never undoes a newer choice (review of #353,
 * 2026-10-15). Two paths: initSigner reconnecting a saved identity whose
 * chain this device does not hold (the screen shows a random local identity
 * meanwhile), and a login the user gave up on by choosing another.
 */
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, type EventTemplate } from 'nostr-tools'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

// A saved extension identity whose chain is NOT on this device.
const skA = generateSecretKey()
const pkA = getPublicKey(skA)
localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'nip07', pubkey: pkA }))
const win = globalThis as { window?: { nostr?: unknown } }
win.window = {}

const { useCyberspace } = await import('../useCyberspace')
const template = (n: number): EventTemplate => ({ kind: 1, created_at: n, tags: [], content: 'x' })
const extensionA = { getPublicKey: async () => pkA, signEvent: async (t: EventTemplate) => finalizeEvent(t, skA) }
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

describe('a late login never undoes a newer one', () => {
  it('initSigner: a switch made while the saved identity reconnects wins', async () => {
    expect(useCyberspace.getState().identity.pubkey).not.toBe(pkA)
    const reconnecting = useCyberspace.getState().initSigner()
    const skB = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skB))
    win.window!.nostr = extensionA
    await reconnecting
    await settle()
    expect(useCyberspace.getState().identity.pubkey).toBe(getPublicKey(skB))
    expect((await useCyberspace.getState().signEvent(template(1))).pubkey).toBe(getPublicKey(skB))
    expect(JSON.parse(localStorage.getItem('onosendai:signer') ?? '{}').pubkey).toBe(getPublicKey(skB))
  }, 15_000)

  it('a login given up for another does not switch when it finally answers', async () => {
    // An extension whose account prompt the user leaves open.
    let answer: (pk: string) => void = () => {}
    win.window = { nostr: { ...extensionA, getPublicKey: () => new Promise<string>((r) => { answer = r }) } }
    const extension = useCyberspace.getState().useExtension()
    const skC = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skC))
    answer(pkA)
    await extension
    await settle()
    expect(useCyberspace.getState().identity.pubkey).toBe(getPublicKey(skC))
    expect(useCyberspace.getState().loginError).toBeNull()
  }, 15_000)
})
