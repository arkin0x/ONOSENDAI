/**
 * A login the user is making is not dropped because the signer object
 * changed in the background for the SAME identity (review of #353,
 * 2026-10-15): a QR login as B while the saved identity A is reconnecting;
 * A's stand-in goes live first (same identity), then B answers. B wins.
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

const skA = generateSecretKey()
const pkA = getPublicKey(skA)
const spawnA = finalizeEvent({ kind: 3333, created_at: 1_700_000_000, tags: [['A', 'spawn']], content: '' }, skA)
localStorage.setItem(`onosendai:chain:${pkA}`, JSON.stringify({ version: 2, events: [spawnA], published: [] }))
localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'nip07', pubkey: pkA }))
const win = globalThis as { window?: { nostr?: unknown } }
win.window = {}

const { useCyberspace } = await import('../useCyberspace')
const { signerFromNsec } = await import('../../lib/signers')
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50))

describe('a login made while the saved identity reconnects', () => {
  it('switches to the new identity even though the old one went live first', async () => {
    expect(useCyberspace.getState().identity.pubkey).toBe(pkA)
    const reconnecting = useCyberspace.getState().initSigner()
    // The user starts a QR login as B; the session answers when we say.
    const skB = generateSecretKey()
    let answer: () => void = () => {}
    const session = { connect: () => new Promise((r) => { answer = () => r(signerFromNsec(nip19.nsecEncode(skB))) }) }
    const qr = useCyberspace.getState().useNostrConnect(session as never, new AbortController().signal, () => {})
    // A's extension appears: the stand-in goes live, same identity A.
    win.window!.nostr = { getPublicKey: async () => pkA, signEvent: async (t: EventTemplate) => finalizeEvent(t, skA) }
    await reconnecting
    await settle()
    expect(useCyberspace.getState().identity.pubkey).toBe(pkA)
    // Then B answers.
    answer()
    await qr
    await settle()
    expect(useCyberspace.getState().identity.pubkey).toBe(getPublicKey(skB))
    expect(useCyberspace.getState().loginError).toBeNull()
  }, 15_000)
})
