/**
 * chains.test.ts - the relay feed is folded client-side, so the fold is tested.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { hopTemplate, spawnTemplate, type NostrEvent } from './events'
import { latestByPubkey, mergeEvents, parsePubkey } from './chains'

const a = generateSecretKey(), b = generateSecretKey()
const pa = getPublicKey(a), pb = getPublicKey(b)
const spawnA = finalizeEvent(spawnTemplate(pa, 100), a)
const spawnB = finalizeEvent(spawnTemplate(pb, 150), b)
const hopA = finalizeEvent(hopTemplate({
  createdAt: 200, genesisId: spawnA.id, previousId: spawnA.id, prevCoordHex: pa,
  to: { x: 1n, y: 2n, z: 3n }, plane: 0, proofHash: '0'.repeat(64),
}), a)
const v1: NostrEvent = { ...spawnB, id: 'f'.repeat(64), tags: [['A', 'drift'], ['C', pb]], created_at: 999 }

describe('latestByPubkey', () => {
  it('keeps the newest action per pubkey, newest pubkey first', () => {
    const out = latestByPubkey([spawnA, spawnB, hopA])
    expect(out.map((e) => [e.pubkey, e.type])).toEqual([[pa, 'hop'], [pb, 'spawn']])
  })

  it('ignores v1 and malformed events', () => {
    const out = latestByPubkey([v1, spawnB])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(spawnB.id)
  })
})

describe('mergeEvents', () => {
  it('unions by id and keeps the first order', () => {
    const out = mergeEvents([spawnA], [hopA, spawnA, hopA])
    expect(out.map((e) => e.id)).toEqual([spawnA.id, hopA.id])
  })
})

describe('parsePubkey', () => {
  it('accepts hex, npub and nprofile, rejects the rest', () => {
    expect(parsePubkey(pa)).toBe(pa)
    expect(parsePubkey(pa.toUpperCase())).toBe(pa)
    expect(parsePubkey(`  ${nip19.npubEncode(pa)} `)).toBe(pa)
    expect(parsePubkey(nip19.nprofileEncode({ pubkey: pa, relays: ['wss://relay.example'] }))).toBe(pa)
    expect(parsePubkey(nip19.nprofileEncode({ pubkey: pa }).toUpperCase())).toBe(pa)
    expect(parsePubkey('npub1notakey')).toBeNull()
    expect(parsePubkey('nprofile1notakey')).toBeNull()
    expect(parsePubkey(nip19.noteEncode(pa))).toBeNull()
    expect(parsePubkey('xyz')).toBeNull()
  })
})
