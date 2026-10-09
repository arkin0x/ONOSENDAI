/**
 * signersNip44.test.ts: every signer offers NIP-44 decrypt where it can, so
 * a chest sealed to a person opens on each (Keys and Chests B1 §2.2, review).
 * A local key decrypts directly; an extension through window.nostr.nip44
 * when it has one, and not otherwise; a deferred extension answers once it
 * is up, or says in words that it cannot. The bunker path is nostr-tools'
 * own nip44Decrypt and needs a relay, so it is not exercised here.
 */

import { afterEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { v2 as nip44 } from 'nostr-tools/nip44'

/** signers, loaded the way the app loads it: the store first (signers.test.ts says why). */
async function signers(): Promise<typeof import('../signers')> {
  await import('../../store/useCyberspace')
  return import('../signers')
}

/** A payload sealed to `pubkey` by a one-time sender, and the sender's public key. */
function sealed(pubkey: string, text: string): { payload: string; sender: string } {
  const sk = generateSecretKey()
  return { payload: nip44.encrypt(text, nip44.utils.getConversationKey(sk, pubkey)), sender: getPublicKey(sk) }
}

const g = globalThis as { window?: unknown }

afterEach(() => { delete g.window })

describe('NIP-44 decrypt on each signer', () => {
  it('a local key opens what is sealed to it', async () => {
    const { localSigner } = await signers()
    const me = localSigner(generateSecretKey())
    const { payload, sender } = sealed(me.pubkey, 'for you')
    expect(await me.nip44Decrypt!(sender, payload)).toBe('for you')
  })

  it('an extension opens through window.nostr.nip44, and offers nothing without it', async () => {
    const { nip07Signer } = await signers()
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const calls: string[][] = []
    g.window = {
      nostr: {
        getPublicKey: async () => pubkey,
        signEvent: async (e: unknown) => e,
        nip44: { decrypt: async (pk: string, ct: string) => { calls.push([pk, ct]); return nip44.decrypt(ct, nip44.utils.getConversationKey(sk, pk)) } },
      },
    }
    const ext = await nip07Signer()
    const { payload, sender } = sealed(pubkey, 'through the extension')
    expect(await ext.nip44Decrypt!(sender, payload)).toBe('through the extension')
    expect(calls).toEqual([[sender, payload]])

    g.window = { nostr: { getPublicKey: async () => pubkey, signEvent: async (e: unknown) => e } }
    const bare = await nip07Signer()
    expect(bare.nip44Decrypt).toBeUndefined()
  })

  it('a deferred extension answers once it is up, or says that it cannot', async () => {
    const { deferredReconnect, NIP44_UNAVAILABLE } = await signers()
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    g.window = {
      nostr: {
        getPublicKey: async () => pubkey,
        signEvent: async (e: unknown) => e,
        nip44: { decrypt: async (pk: string, ct: string) => nip44.decrypt(ct, nip44.utils.getConversationKey(sk, pk)) },
      },
    }
    let ready = 0
    const deferred = deferredReconnect({ kind: 'nip07', pubkey }, () => { ready++ })
    const { payload, sender } = sealed(pubkey, 'later')
    expect(await deferred.nip44Decrypt!(sender, payload)).toBe('later')
    expect(ready).toBe(1)

    g.window = { nostr: { getPublicKey: async () => pubkey, signEvent: async (e: unknown) => e } }
    const without = deferredReconnect({ kind: 'nip07', pubkey }, () => undefined)
    await expect(without.nip44Decrypt!(sender, payload)).rejects.toThrow(NIP44_UNAVAILABLE)
  })

  it('the Nostr Connect QR asks for nip44_decrypt', async () => {
    const { createNostrConnectSession } = await signers()
    expect(createNostrConnectSession().uri).toContain('nip44_decrypt')
  })
})
