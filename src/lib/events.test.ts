/**
 * events.test.ts — the wire format is consensus.
 *
 * A tag in the wrong place, a sector with a leading zero, a spawn whose
 * coordinate is not its pubkey: all of these would sign and publish without
 * complaint, and every other client would then refuse the chain. So the
 * builders are checked tag by tag against spec §8 and §10, the parser is
 * checked to refuse exactly what the spec refuses, and chain reassembly is
 * checked against the one rule that matters: the newest spawn wins.
 */

import { describe, it, expect } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import {
  ACTION_KIND,
  buildChain,
  chainHead,
  hopTemplate,
  parseAction,
  positionHex,
  sectorTags,
  sidestepTemplate,
  spawnTemplate,
  type NostrEvent,
} from './events'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawnAt = coordToXyz(hexToCoord(pk))
const ZERO = '0'.repeat(64)

function sign(t: ReturnType<typeof spawnTemplate>, key = sk): NostrEvent {
  return finalizeEvent(t, key)
}

function tagsNamed(ev: { tags: string[][] }, name: string): string[][] {
  return ev.tags.filter((t) => t[0] === name)
}

describe('sector tags (§10)', () => {
  it('shifts each axis by 30 and formats base-10 with no padding', () => {
    const tags = sectorTags({ x: 1n << 30n, y: 0n, z: (3n << 30n) + 12345n })
    expect(tags).toEqual([['X', '1'], ['Y', '0'], ['Z', '3'], ['S', '1-0-3']])
  })

  it('never prints a leading plus or zero', () => {
    for (const t of sectorTags({ x: 7n, y: 7n, z: 7n })) {
      expect(t[1]).toMatch(/^(0|[1-9][0-9]*)(-(0|[1-9][0-9]*)){0,2}$/)
    }
  })
})

describe('spawn (§8.3)', () => {
  const ev = sign(spawnTemplate(pk, 1_700_000_000))

  it('is kind 3333 with A=spawn and C equal to the pubkey', () => {
    expect(ev.kind).toBe(ACTION_KIND)
    expect(tagsNamed(ev, 'A')).toEqual([['A', 'spawn']])
    expect(tagsNamed(ev, 'C')).toEqual([['C', pk]])
  })

  it('carries the sector of the pubkey coordinate', () => {
    expect(ev.tags.slice(2)).toEqual(sectorTags(spawnAt))
  })

  it('carries no chain links and no proof', () => {
    expect(tagsNamed(ev, 'e')).toEqual([])
    expect(tagsNamed(ev, 'c')).toEqual([])
    expect(tagsNamed(ev, 'proof')).toEqual([])
  })

  it('signs to a verifiable event with a canonical id', () => {
    expect(verifyEvent(ev)).toBe(true)
    expect(ev.id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('parses back to its own coordinate and plane', () => {
    const a = parseAction(ev)
    expect(a?.type).toBe('spawn')
    expect(a?.position).toEqual({ x: spawnAt.x, y: spawnAt.y, z: spawnAt.z })
    expect(a?.plane).toBe(spawnAt.plane)
    expect(a?.genesisId).toBeNull()
  })
})

describe('hop (§8.4)', () => {
  const spawn = sign(spawnTemplate(pk, 1_700_000_000))
  const to = { x: spawnAt.x + 5n, y: spawnAt.y, z: spawnAt.z - 1n }
  const hop = sign(hopTemplate({
    createdAt: 1_700_000_010,
    genesisId: spawn.id,
    previousId: spawn.id,
    prevCoordHex: pk,
    to,
    plane: spawnAt.plane,
    proofHash: 'ab'.repeat(32),
  }))

  it('lays the tags out in spec order', () => {
    expect(hop.tags.map((t) => t[0])).toEqual(['A', 'e', 'e', 'c', 'C', 'proof', 'X', 'Y', 'Z', 'S'])
  })

  it('marks genesis and previous on the e tags, with an empty relay hint', () => {
    expect(tagsNamed(hop, 'e')).toEqual([
      ['e', spawn.id, '', 'genesis'],
      ['e', spawn.id, '', 'previous'],
    ])
  })

  it('names where it came from and where it went', () => {
    expect(tagsNamed(hop, 'c')).toEqual([['c', pk]])
    expect(tagsNamed(hop, 'C')).toEqual([['C', positionHex(to, spawnAt.plane)]])
    expect(tagsNamed(hop, 'proof')).toEqual([['proof', 'ab'.repeat(32)]])
  })

  it('encodes the destination plane in C', () => {
    const other = spawnAt.plane === 0 ? 1 : 0
    const flipped = hopTemplate({
      createdAt: 1, genesisId: ZERO, previousId: ZERO, prevCoordHex: ZERO,
      to, plane: other, proofHash: ZERO,
    })
    const C = tagsNamed(flipped, 'C')[0][1]
    expect(coordToXyz(hexToCoord(C)).plane).toBe(other)
  })

  it('parses with every link intact', () => {
    const a = parseAction(hop)
    expect(a).toMatchObject({
      type: 'hop',
      genesisId: spawn.id,
      previousId: spawn.id,
      prevCoordHex: pk,
      proofHash: 'ab'.repeat(32),
      position: to,
    })
  })
})

describe('sidestep (§8.5)', () => {
  const ss = sidestepTemplate({
    createdAt: 1, genesisId: ZERO, previousId: ZERO, prevCoordHex: ZERO,
    to: { x: 8n, y: 0n, z: 0n }, plane: 0, proofHash: ZERO,
    merkleRoots: ['11'.repeat(32), '22'.repeat(32), '33'.repeat(32)],
    inclusionProofs: ['aa'.repeat(32) + 'bb'.repeat(32), '', ''],
    lcaHeights: [2, 0, 0],
  })

  it('carries the merkle tags after the proof and before the sector', () => {
    expect(ss.tags.map((t) => t[0])).toEqual([
      'A', 'e', 'e', 'c', 'C', 'proof', 'mr', 'mp', 'hx', 'hy', 'hz', 'X', 'Y', 'Z', 'S',
    ])
    expect(tagsNamed(ss, 'A')).toEqual([['A', 'sidestep']])
  })

  it('joins per-axis roots and proofs with colons, empty for still axes', () => {
    expect(tagsNamed(ss, 'mr')[0][1].split(':').map((s) => s.length)).toEqual([64, 64, 64])
    const mp = tagsNamed(ss, 'mp')[0][1].split(':')
    expect(mp[0].length).toBe(64 * 2)
    expect(mp[1]).toBe('')
    expect(mp[2]).toBe('')
  })

  it('writes the heights as decimal strings', () => {
    expect(tagsNamed(ss, 'hx')).toEqual([['hx', '2']])
    expect(tagsNamed(ss, 'hy')).toEqual([['hy', '0']])
    expect(tagsNamed(ss, 'hz')).toEqual([['hz', '0']])
  })
})

describe('parseAction refuses what the spec refuses', () => {
  const good = sign(spawnTemplate(pk, 1))

  it('the wrong kind', () => {
    expect(parseAction({ ...good, kind: 1 })).toBeNull()
  })

  it('an unknown action', () => {
    expect(parseAction({ ...good, tags: [['A', 'teleport'], ...good.tags.slice(1)] })).toBeNull()
  })

  it('a spawn that is not at its pubkey', () => {
    const other = getPublicKey(generateSecretKey())
    expect(parseAction({ ...good, tags: [['A', 'spawn'], ['C', other], ...good.tags.slice(2)] })).toBeNull()
  })

  it('a hop missing a link', () => {
    const hop = sign(hopTemplate({
      createdAt: 2, genesisId: good.id, previousId: good.id, prevCoordHex: pk,
      to: spawnAt, plane: 0, proofHash: ZERO,
    }))
    const noPrev = { ...hop, tags: hop.tags.filter((t) => t[3] !== 'previous') }
    expect(parseAction(noPrev)).toBeNull()
  })

  it('a sidestep missing its merkle tags', () => {
    const hop = sign(hopTemplate({
      createdAt: 2, genesisId: good.id, previousId: good.id, prevCoordHex: pk,
      to: spawnAt, plane: 0, proofHash: ZERO,
    }))
    expect(parseAction({ ...hop, tags: [['A', 'sidestep'], ...hop.tags.slice(1)] })).toBeNull()
  })
})

describe('buildChain (§3.2: the newest spawn wins)', () => {
  function link(prev: NostrEvent, genesis: NostrEvent, at: number, dx: bigint): NostrEvent {
    const from = parseAction(prev)!
    return sign(hopTemplate({
      createdAt: at,
      genesisId: genesis.id,
      previousId: prev.id,
      prevCoordHex: from.coordHex,
      to: { ...from.position, x: from.position.x + dx },
      plane: from.plane,
      proofHash: ZERO,
    }))
  }

  const spawnA = sign(spawnTemplate(pk, 100))
  const a1 = link(spawnA, spawnA, 110, 1n)
  const a2 = link(a1, spawnA, 120, 1n)
  const spawnB = sign(spawnTemplate(pk, 200))
  const b1 = link(spawnB, spawnB, 210, 1n)

  it('follows the previous links from the latest spawn, in order', () => {
    const chain = buildChain([b1, a2, spawnA, spawnB, a1])
    expect(chain.map((e) => e.id)).toEqual([spawnB.id, b1.id])
    expect(chainHead(chain)?.position.x).toBe(spawnAt.x + 1n)
  })

  it('leaves the abandoned chain behind even though its links are valid', () => {
    const chain = buildChain([spawnA, a1, a2, spawnB])
    expect(chain.map((e) => e.id)).toEqual([spawnB.id])
  })

  it('reassembles a full chain when there is only one spawn', () => {
    expect(buildChain([a2, a1, spawnA]).map((e) => e.id)).toEqual([spawnA.id, a1.id, a2.id])
  })

  it('ignores a hop whose genesis is a different spawn', () => {
    // Claims B's chain but descends from A's spawn: a link into the wrong tree.
    const stray = sign(hopTemplate({
      createdAt: 220, genesisId: spawnA.id, previousId: b1.id, prevCoordHex: pk,
      to: spawnAt, plane: spawnAt.plane, proofHash: ZERO,
    }))
    expect(buildChain([spawnB, b1, stray]).map((e) => e.id)).toEqual([spawnB.id, b1.id])
  })

  it('takes the older branch at a fork', () => {
    const early = link(b1, spawnB, 220, 1n)
    const late = link(b1, spawnB, 230, 2n)
    expect(buildChain([spawnB, b1, late, early]).map((e) => e.id)).toEqual([spawnB.id, b1.id, early.id])
  })

  it('is empty without a spawn', () => {
    expect(buildChain([a1, a2])).toEqual([])
  })

  it('drops malformed events without losing the rest', () => {
    expect(buildChain([spawnB, { ...b1, kind: 1 }]).map((e) => e.id)).toEqual([spawnB.id])
  })
})
