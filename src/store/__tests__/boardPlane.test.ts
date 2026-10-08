/**
 * boardPlane.test.ts - boarding the line keeps the plane bit (regression).
 *
 * A chain on the relay broke at an enter-hyperspace whose `c` and `C` were the
 * x, y and z of the hop before it with the plane bit cleared: the hop ended at
 * a port in ideaspace (plane 1), and the boarding said dataspace (plane 0).
 * boardHyperspace built the coordinate from `position` and `plane`, and
 * `plane` is the plane lined up for the next move, which viewing EARTH sets
 * to dataspace. An enter does not move, so its `c` and `C` must be the
 * previous `C` exactly, plane bit included, and so must the coordinate its
 * entry proof is computed over (DECK-0001 §3).
 */

import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord, terrainK } from 'cyberspace-core'
import { buildChain, spawnTemplate, type NostrEvent } from '../../lib/events'
import { verifyEnterProof } from '../../lib/hyperspace/enter'
import { nip19 } from 'nostr-tools'
import { useCyberspace } from '../useCyberspace'

/** A key whose spawn is in ideaspace (plane 1), with terrain cheap enough to prove on in a test. */
function ideaspaceKey(): { sk: Uint8Array; pubkey: string } {
  for (;;) {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const { x, y, z, plane } = coordToXyz(hexToCoord(pubkey))
    if (plane === 1 && terrainK(x, y, z, plane) <= 6) return { sk, pubkey }
  }
}

const tag = (ev: NostrEvent, name: string): string | undefined => ev.tags.find((t) => t[0] === name)?.[1]

describe('boarding from ideaspace with dataspace lined up', () => {
  let pubkey = ''
  beforeEach(async () => {
    const key = ideaspaceKey()
    pubkey = key.pubkey
    // Signed by the identity whose chain it is: a chain only ever follows its
    // own author's events (review of #227).
    await useCyberspace.getState().useNsec(nip19.nsecEncode(key.sk))
    const spawn = finalizeEvent(spawnTemplate(pubkey, 1_700_000_000), key.sk) as NostrEvent
    const { x, y, z } = coordToXyz(hexToCoord(pubkey))
    useCyberspace.setState({
      identity: { ...useCyberspace.getState().identity, pubkey },
      events: [spawn], genesisId: spawn.id, prevEventId: spawn.id, published: {},
      position: { x, y, z },
      // The head stands in ideaspace; dataspace is lined up, as viewing EARTH leaves it.
      headPlane: 1, plane: 0,
      transit: null, exploreIndex: null, spectate: null, focus: null, chainConflict: null,
      proof: { ...useCyberspace.getState().proof, status: 'idle' },
    })
  })

  it('names the coordinate the chain stands at, plane bit and all, in c, C and the proof', async () => {
    await useCyberspace.getState().boardHyperspace()
    const s = useCyberspace.getState()
    const enter = s.events[s.events.length - 1]
    expect(tag(enter, 'A')).toBe('enter-hyperspace')
    expect(tag(enter, 'c')).toBe(pubkey)
    expect(tag(enter, 'C')).toBe(pubkey)
    expect(verifyEnterProof(hexToCoord(pubkey), s.events[0].id, tag(enter, 'proof')!)).toBe(true)
    expect(s.transit?.enterCoordHex).toBe(pubkey)
    expect(buildChain(s.events).map((a) => a.type)).toEqual(['spawn', 'enter-hyperspace'])
  })
})
