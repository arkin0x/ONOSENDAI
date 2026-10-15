/**
 * listingFixture.ts - an object for sale on Fanfares (NIP-FF-1, NIP-FF-2;
 * DECK-0003 §3.4), for tests: a kind 33331 sealed with an https key service,
 * a price, a turntable GIF and a still. Signed with a throwaway key made for
 * it and thrown away; it has never been sent to a relay, and must not be.
 */

import type { NostrEvent } from '../events'

export const LISTING: NostrEvent = {
  kind: 33331,
  created_at: 1792000000,
  content: 'A brass orrery, three rings on a walnut base. Buy it to place it anywhere in cyberspace.',
  tags: [
    ['d', '6f1c2a8e-4b7d-4e0a-9c3f-2d5e8b1a7c40'],
    ['encrypted', 'aes-256-gcm', 'dGVzdC1maXh0dXJlLWNpcGhlcnRleHQtbm90LXJlYWwtZGF0YQ==', 'https://keys.example.com/request-key'],
    ['price', '2100', 'SATS'],
    ['title', 'Brass Orrery'],
    ['name', 'orrery'],
    ['subject', '3D object'],
    ['a', '31990:d7d8109ee43657ce6056ada4653006bbb641f31e50e85243681c2724507811ec:Fanfares'],
    ['zap', '0000000000000000000000000000000000000000000000000000000000000001', 'wss://relay.example.com', '1'],
    ['imeta', 'url https://cdn.example.com/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.gif', 'm image/gif', 'x a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', 'dim 320x320', 'alt A brass orrery turning on its base'],
    ['imeta', 'url https://cdn.example.com/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2.png', 'm image/png', 'x b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', 'dim 320x320', 'alt A brass orrery'],
    ['alt', 'A 3D object for sale: Brass Orrery, 2100 sats'],
  ],
  pubkey: '64fbb11b3cf181df337405421b947e20a47b26bfdc41bee9eb85fe41d8f93de8',
  id: 'ea2fe2ef7b08471b63d5d309d25b057bacf17b51e340fcd3cee5df2182398c7a',
  sig: '43c40779fc636cee239dde9533c97002c22a89a21abea33c6b411f30ab8d4a306b5106d7b8482ea51919da246938518a7f3281298a5a96af48103c911350e32c',
}

/** The fixture with its tags changed by `edit`. */
export function listingWith(edit: (tags: string[][]) => string[][]): NostrEvent {
  return { ...LISTING, tags: edit(LISTING.tags.map((t) => [...t])) }
}
