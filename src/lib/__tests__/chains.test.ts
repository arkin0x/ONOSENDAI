/**
 * chains.test.ts - the relay feed is folded client-side, so the fold is tested.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { chainGap, hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../events'
import {
  PLACING_ACTIONS,
  chainFilter,
  combineAnswers,
  latestByPubkey,
  mergeEvents,
  markPartial,
  newestSpawnId,
  parsePubkey,
  spawnsFilter,
} from '../chains'
import type { RelayAnswer } from '../relayOutcome'
import { actionEvent, enterVirtualEvent, hopEvent } from './chainFixtures'

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

  it('places someone inside a game at the entry c, never at their place in the game (§8.11.4 rule 1)', () => {
    const held = { x: 1n, y: 2n, z: 3n }
    const arena = { x: 9n << 40n, y: 9n << 40n, z: 9n << 40n }
    const enter = enterVirtualEvent({
      pubkey: pa, createdAt: 300, genesisId: spawnA.id, previousId: hopA.id,
      c: positionHex(held, 0), inGame: arena, height: 8, game: 'ab'.repeat(32),
    })
    const [a1] = latestByPubkey([spawnA, hopA, enter])
    expect(a1.id).toBe(enter.id)
    expect(a1.position).toEqual(held)
  })

  it('an unknown action newer than the last recognized one does not move anyone (§8.9 rule 5)', () => {
    const wave = actionEvent({ pubkey: pa, createdAt: 400, genesisId: spawnA.id, previousId: hopA.id, name: 'wave', c: positionHex({ x: 1n, y: 2n, z: 3n }, 0), C: { x: 50n, y: 50n, z: 50n } })
    expect(latestByPubkey([spawnA, hopA, wave])[0].id).toBe(hopA.id)
  })
})

describe('the filters (relay load: v1 kept out both ways)', () => {
  it('the position feeds ask for every recognized action, the bracket actions included', () => {
    expect(PLACING_ACTIONS).toEqual(['spawn', 'hop', 'sidestep', 'enter-hyperspace', 'hyperjump', 'enter-virtual', 'exit-virtual'])
  })

  it('a chain is asked for by its spawns, then by the genesis, never by action name', () => {
    expect(spawnsFilter(pa)).toEqual({ kinds: [3333], authors: [pa], '#A': ['spawn'] })
    expect(chainFilter(pa, spawnA.id)).toEqual({ kinds: [3333], authors: [pa], '#e': [spawnA.id] })
    expect(chainFilter(pa, spawnA.id, 123)).toEqual({ kinds: [3333], authors: [pa], '#e': [spawnA.id], until: 123 })
    expect(chainFilter(pa, spawnA.id)).not.toHaveProperty('#A')
  })

  it('the newest spawn names the chain to ask for (§8.7.3 rule 1)', () => {
    const later = finalizeEvent(spawnTemplate(pa, 500), a)
    expect(newestSpawnId([spawnA, hopA, later])).toBe(later.id)
    expect(newestSpawnId([hopA, v1])).toBeNull()
  })
})

describe('where a chain has a hole (chainGap)', () => {
  const step = (prev: NostrEvent, at: number): NostrEvent =>
    hopEvent({ pubkey: pa, createdAt: at, genesisId: spawnA.id, previousId: prev.id, c: pa, to: { x: BigInt(at), y: 0n, z: 0n } })
  const h1 = step(spawnA, 201)
  const h2 = step(h1, 202)
  const h3 = step(h2, 203)
  const h4 = step(h3, 204)

  it('none when every link is in hand', () => {
    expect(chainGap([spawnA, h1, h2, h3], spawnA.id)).toBeNull()
  })

  it('a relay that stopped at its limit: the hole is at the oldest event it returned', () => {
    expect(chainGap([spawnA, h4, h3], spawnA.id)).toEqual({ until: 203, missingId: h2.id })
  })

  it('two stretches from two relays: the hole nearest the head, not the oldest event in hand', () => {
    // One relay held the start, another the newest two: paging from the
    // oldest event across both (h1) would ask for nothing new.
    expect(chainGap([spawnA, h1, h4, h3], spawnA.id)).toEqual({ until: 203, missingId: h2.id })
  })

  it('events of another chain do not count as a hole', () => {
    const other = step(spawnB as NostrEvent, 50)
    expect(chainGap([spawnA, h1, { ...other, tags: other.tags.map((t) => (t[3] === 'genesis' ? ['e', 'f'.repeat(64), '', 'genesis'] : t)) }], spawnA.id)).toBeNull()
  })
})

describe('markPartial', () => {
  it('an answered relay that returned a chain with a hole has not said what the chain is', () => {
    const out = markPartial([
      { url: 'wss://a', outcome: 'answered', events: [spawnA] },
      { url: 'wss://b', outcome: 'refused', reason: 'restricted: no', events: [] },
    ])
    expect(out[0]).toMatchObject({ outcome: 'unreachable', reason: 'the relays returned only part of this chain', events: [spawnA] })
    expect(out[1].outcome).toBe('refused')
  })
})

describe('combineAnswers', () => {
  const ok = (url: string, events: NostrEvent[]): RelayAnswer => ({ url, outcome: 'answered', events })
  it('is answered only when both questions were, and keeps every event', () => {
    const out = combineAnswers(
      [ok('wss://a', [spawnA]), { url: 'wss://b', outcome: 'unreachable', reason: 'x', events: [] }],
      [ok('wss://a', [hopA]), ok('wss://b', [hopA])],
    )
    expect(out[0]).toEqual({ url: 'wss://a', outcome: 'answered', events: [spawnA, hopA] })
    expect(out[1].outcome).toBe('unreachable')
    expect(out[1].events).toEqual([hopA])
  })
  it('a relay that answered the spawns but not the chain has not said what the chain is', () => {
    const out = combineAnswers([ok('wss://a', [spawnA])], [{ url: 'wss://a', outcome: 'refused', reason: 'rate-limited: slow down', events: [] }])
    expect(out[0]).toMatchObject({ outcome: 'refused', reason: 'rate-limited: slow down', events: [spawnA] })
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
