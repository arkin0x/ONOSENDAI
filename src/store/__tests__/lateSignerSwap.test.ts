/**
 * A remote signer's late answer must not undo a switch of identity (found in
 * review of snocrash #35, 2026-10-15). A saved extension or bunker identity
 * starts as a stand-in that reconnects on its first signature; if the user
 * switches identity before that reconnect answers, the answer arriving later
 * must not become the signer behind a screen that shows the new identity.
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

// Identity A: a saved extension login whose chain this device holds, so the
// store starts with A's stand-in signer. No extension is on the page yet.
const skA = generateSecretKey()
const pkA = getPublicKey(skA)
const spawnA = finalizeEvent({ kind: 3333, created_at: 1_700_000_000, tags: [['A', 'spawn']], content: '' }, skA)
localStorage.setItem(`onosendai:chain:${pkA}`, JSON.stringify({ version: 2, events: [spawnA], published: [] }))
localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'nip07', pubkey: pkA }))
const win = globalThis as { window?: { nostr?: unknown } }
win.window = {}

const { useCyberspace } = await import('../useCyberspace')
const template = (n: number): EventTemplate => ({ kind: 1, created_at: n, tags: [], content: 'x' })

describe('a late reconnect after a switch of identity', () => {
  it('leaves the new identity signing', async () => {
    expect(useCyberspace.getState().identity.pubkey).toBe(pkA)
    // A signature as A starts the reconnect, which waits for the extension.
    const pending = useCyberspace.getState().signEvent(template(1)).catch(() => null)
    // Meanwhile the user switches to B.
    const skB = generateSecretKey()
    await useCyberspace.getState().useNsec(nip19.nsecEncode(skB))
    expect(useCyberspace.getState().identity.pubkey).toBe(getPublicKey(skB))
    // Now A's extension appears and the reconnect answers, late.
    win.window!.nostr = { getPublicKey: async () => pkA, signEvent: async (t: EventTemplate) => finalizeEvent(t, skA) }
    await pending
    await new Promise((r) => setTimeout(r, 50))
    // The next signature is B's, as the screen says.
    const signed = await useCyberspace.getState().signEvent(template(2))
    expect(signed.pubkey).toBe(getPublicKey(skB))
  }, 15_000)
})
