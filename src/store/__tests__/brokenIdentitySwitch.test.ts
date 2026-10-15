/**
 * brokenIdentitySwitch.test.ts - a respawn confirmed for one identity never
 * respawns another (review of #227).
 *
 * The broken-chain modal can be left open on its RESPAWN NOW step. Switching
 * identity under it closes it, and a respawn confirmed for the old identity
 * is refused rather than carried out on the new one's chain. What would go
 * wrong silently: a tap meant for one key's dead chain starting a new chain
 * for a different key.
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

import { generateSecretKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { useCyberspace } from '../useCyberspace'
import { useChainUi } from '../useChainUi'

describe('switching identity under an open respawn confirm', () => {
  it('closes the modal, and a respawn confirmed for the old identity does nothing', async () => {
    await useCyberspace.getState().useNsec(nip19.nsecEncode(generateSecretKey()))
    const before = useCyberspace.getState().identity.pubkey
    useChainUi.getState().setBrokenView('confirm')
    await useCyberspace.getState().useNsec(nip19.nsecEncode(generateSecretKey()))
    expect(useChainUi.getState().brokenView).toBeNull()
    const events = useCyberspace.getState().events.length
    await expect(useCyberspace.getState().respawnFromBrokenChain(before)).rejects.toThrow(/identity changed/)
    expect(useCyberspace.getState().events).toHaveLength(events)
  })
})
