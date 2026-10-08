/**
 * respawnRace.test.ts - a respawn never lands on another identity, and
 * DEREZZ reports a failed respawn on any chain (final review of #227).
 *
 * With a bunker signer the respawn's signature can wait minutes. If the
 * person switches identity meanwhile, the spawn that comes back is the old
 * identity's, and writing it into the store would put identity A's new
 * chain under identity B. After the signature, respawn checks the identity
 * is still the one it started for and throws, setting nothing, if not.
 */

import { describe, expect, it } from 'vitest'

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
import { nip19 } from 'nostr-tools'
import { useCyberspace } from '../useCyberspace'
import { derezzNow } from '../../hud/DerezzPanel'

const S = () => useCyberspace.getState()

describe('an identity switch while the respawn waits for its signature', () => {
  it('throws and writes nothing of identity A into identity B', async () => {
    const a = generateSecretKey()
    const b = generateSecretKey()
    await S().useNsec(nip19.nsecEncode(a))
    const respawning = S().respawn()
    // Switched while A's signature is out (switchTo sets the identity at once).
    void S().useNsec(nip19.nsecEncode(b))
    await expect(respawning).rejects.toThrow(/identity changed/)
    expect(S().identity.pubkey).toBe(getPublicKey(b))
    expect(S().events.every((e) => e.pubkey === getPublicKey(b))).toBe(true)
  })
})

describe('DEREZZ on a valid chain', () => {
  it('waits for the respawn and reports a failure', async () => {
    await S().useNsec(nip19.nsecEncode(generateSecretKey()))
    const real = S().respawn
    useCyberspace.setState({ respawn: async () => { throw new Error('the signer declined') } })
    try {
      expect(await derezzNow()).toBe('Respawn failed: the signer declined. Nothing was signed, and your chain is as it was. You can try again.')
    } finally {
      useCyberspace.setState({ respawn: real })
    }
  })
})
