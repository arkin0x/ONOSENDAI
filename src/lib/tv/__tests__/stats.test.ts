/**
 * stats.test.ts: the ticker's numbers are as of the moment on tape.
 */
import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { chainLengthAt, countTo } from '../stats'
import { positionHex, spawnTemplate, type NostrEvent } from '../../events'
import { hopEvent, nextId } from '../../__tests__/chainFixtures'

describe('countTo', () => {
  it('counts the times at or before t', () => {
    expect(countTo([], 5)).toBe(0)
    expect(countTo([1, 2, 2, 5, 9], 2)).toBe(3)
    expect(countTo([1, 2, 2, 5, 9], 0)).toBe(0)
    expect(countTo([1, 2, 2, 5, 9], 100)).toBe(5)
  })
})

describe('chainLengthAt', () => {
  // A key, its spawn at 10, three hops one a second, and a respawn at 100 with one hop.
  const pk = getPublicKey(generateSecretKey())
  const home = coordToXyz(hexToCoord(pk))
  const at = (dx: number) => ({ x: home.x + BigInt(dx), y: home.y, z: home.z })
  const walk = (t: number, n: number): NostrEvent[] => {
    const spawn: NostrEvent = { ...spawnTemplate(pk, t), id: nextId(), pubkey: pk, sig: '' }
    const out = [spawn]
    for (let i = 1; i <= n; i++) out.push(hopEvent({ pubkey: pk, createdAt: t + 10 * i, genesisId: spawn.id, previousId: out[i - 1].id, c: i === 1 ? pk : positionHex(at(i - 1), home.plane), to: at(i), plane: home.plane }))
    return out
  }
  const first = walk(10, 3)
  const again = walk(100, 1)

  it('counts the chain standing at t by its links, the spawn included', () => {
    const c = { pubkey: pk, events: [...first, ...again] }
    expect(chainLengthAt(c, 5)).toBe(0)
    expect(chainLengthAt(c, 25)).toBe(2)
    expect(chainLengthAt(c, 99)).toBe(4)
    // A respawn starts a new chain.
    expect(chainLengthAt(c, 115)).toBe(2)
  })

  it('a fork counts nothing and a gap ends it, which counting by time did not see (2026-10-30)', () => {
    const fork = hopEvent({ pubkey: pk, createdAt: 45, genesisId: first[0].id, previousId: first[1].id, c: positionHex(at(1), home.plane), to: at(7), plane: home.plane })
    expect(chainLengthAt({ pubkey: pk, events: [...first, fork] }, 99)).toBe(0)
    expect(chainLengthAt({ pubkey: pk, events: [first[0], first[1], first[3]] }, 99)).toBe(2)
  })
})
