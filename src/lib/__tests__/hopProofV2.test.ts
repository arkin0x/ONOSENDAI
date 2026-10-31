/**
 * hopProofV2.test.ts - what this client signs and reads for a hop after the
 * hop proof version 2 cutover (spec 5.9 to 5.13, 8.4).
 *
 * Every hop template carries `proof` (the seal), `mn` and `mp`, once each, in
 * the spec's order, and refuses to make a hop without them; the sidestep and
 * the boarding keep their own rows. The parser keeps a hop's mn and mp, reads
 * a hop with neither as the version 1 hop it is (its fate is the exemption
 * list's, never the parser's), and the chain rules break a hop that carries a
 * read tag twice. A hop built by the proof worker's own computation verifies
 * with cyberspace-core at Level 1 under its signed id, and audits at Level 2.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { auditHopLevel2, computeHopProofV2, coordToXyz, hexToCoord, verifyHopLevel1 } from 'cyberspace-core'
import {
  buildChain,
  enterHyperspaceTemplate,
  hopProofForm,
  hopTemplate,
  parseAction,
  positionHex,
  sidestepTemplate,
  spawnTemplate,
  type NostrEvent,
} from '../events'
import { staleFormatCut, staleHopFormat } from '../staleFormat'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const at = coordToXyz(hexToCoord(pk))
const spawn = finalizeEvent(spawnTemplate(pk, 1_700_000_000), sk) as NostrEvent
const to = { x: at.x ^ (1n << 9n), y: at.y, z: at.z }

/** A real version 2 hop from the spawn, proved by core as the worker proves it. */
const proof = computeHopProofV2(at.x, at.y, at.z, to.x, to.y, to.z, at.plane, spawn.id)
const link = { createdAt: 1_700_000_010, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: pk, to, plane: at.plane }
const hop = finalizeEvent(hopTemplate({ ...link, proofHash: proof.tags.proof, mn: proof.tags.mn, mp: proof.tags.mp }), sk) as NostrEvent

const names = (ev: { tags: string[][] }): string[] => ev.tags.map((t) => t[0])
const count = (ev: { tags: string[][] }, name: string): number => ev.tags.filter((t) => t[0] === name).length

/** The same hop's tags with one change, re-signed, as another client might publish it. */
function resigned(edit: (tags: string[][]) => string[][]): NostrEvent {
  return finalizeEvent({ kind: hop.kind, created_at: hop.created_at, content: '', tags: edit(hop.tags.map((t) => [...t])) }, sk) as NostrEvent
}

describe('the hop template (8.4)', () => {
  it('emits proof, mn and mp exactly once each, in the spec order', () => {
    expect(names(hop)).toEqual(['A', 'e', 'e', 'c', 'C', 'proof', 'mn', 'mp', 'X', 'Y', 'Z', 'S'])
    for (const t of ['proof', 'mn', 'mp']) expect(count(hop, t)).toBe(1)
    expect(hop.tags.find((t) => t[0] === 'proof')![1]).toBe(proof.tags.proof)
    expect(hop.tags.find((t) => t[0] === 'mn')![1]).toBe(proof.tags.mn)
    expect(hop.tags.find((t) => t[0] === 'mp')![1]).toBe(proof.tags.mp)
  })

  it('never makes a hop without its nonce and openings, or with them malformed', () => {
    const base = { ...link, proofHash: proof.tags.proof }
    expect(() => hopTemplate({ ...base, mn: '', mp: proof.tags.mp })).toThrow(/mn/)
    expect(() => hopTemplate({ ...base, mn: proof.tags.mn, mp: '' })).toThrow(/mp/)
    expect(() => hopTemplate({ ...base, mn: 'ABCDEF0123456789', mp: proof.tags.mp })).toThrow(/mn/)
    expect(() => hopTemplate({ ...base, mn: proof.tags.mn, mp: 'zz' })).toThrow(/mp/)
    expect(() => hopTemplate({ ...link, proofHash: 'x', mn: proof.tags.mn, mp: proof.tags.mp })).toThrow(/proof/)
  })

  it('leaves the sidestep its own row: mr, mp, mn once each, no hop tags', () => {
    const ss = sidestepTemplate({ ...link, proofHash: 'ab'.repeat(32), merkleRoots: ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)], openings: ['', '', ''], mnHex: '1'.repeat(16), lcaHeights: [9, 0, 0] })
    expect(names(ss)).toEqual(['A', 'e', 'e', 'c', 'C', 'proof', 'mr', 'mp', 'mn', 'hx', 'hy', 'hz', 'X', 'Y', 'Z', 'S'])
    for (const t of ['proof', 'mr', 'mp', 'mn']) expect(count(ss, t)).toBe(1)
  })

  it('a boarding does not inherit mn or mp', () => {
    const board = enterHyperspaceTemplate({ createdAt: 1, genesisId: spawn.id, previousId: spawn.id, coordHex: pk, proofHash: 'ab'.repeat(32) })
    expect(count(board, 'mn')).toBe(0)
    expect(count(board, 'mp')).toBe(0)
  })
})

describe('a version 2 hop made the worker way verifies with core', () => {
  it('passes Level 1 under its signed id, and Level 2', () => {
    const claim = {
      from: { x: at.x, y: at.y, z: at.z, plane: at.plane },
      to: { x: to.x, y: to.y, z: to.z, plane: at.plane },
      previousEventIdHex: spawn.id,
      proof: hop.tags.find((t) => t[0] === 'proof')![1],
      nonce: hop.tags.find((t) => t[0] === 'mn')![1],
      openings: hop.tags.find((t) => t[0] === 'mp')![1],
      eventId: hop.id,
    }
    // Nothing here leans on an exemption.
    expect(verifyHopLevel1({ ...claim, grandfathered: new Set() })).toEqual([])
    expect(auditHopLevel2(claim)).toEqual([])
  })
})

describe('reading hops (parseAction, hopProofForm)', () => {
  it('keeps a version 2 hop\'s mn and mp, and names its form', () => {
    expect(parseAction(hop)).toMatchObject({ type: 'hop', proofHash: proof.tags.proof, mn: proof.tags.mn, mp: proof.tags.mp })
    expect(hopProofForm(hop)).toBe('v2')
    expect(staleHopFormat(hop)).toBe(false)
  })

  it('reads a version 1 hop as one, for the list to decide, never dropping it', () => {
    const v1 = resigned((tags) => tags.filter((t) => t[0] !== 'mn' && t[0] !== 'mp'))
    const a = parseAction(v1)
    expect(a).toMatchObject({ type: 'hop', proofHash: proof.tags.proof })
    expect(a?.mn).toBeUndefined()
    expect(a?.mp).toBeUndefined()
    expect(hopProofForm(v1)).toBe('v1')
    expect(staleHopFormat(v1)).toBe(true)
    // On a chain it stands structurally: proofs are a verifier's (ono-3).
    const chain = buildChain([spawn, v1])
    expect(chain[1]).toMatchObject({ type: 'hop', position: to })
    expect(chain[1].breaks).toBeUndefined()
  })

  it('names a hop with only one of mn and mp as partial', () => {
    const partial = resigned((tags) => tags.filter((t) => t[0] !== 'mp'))
    expect(hopProofForm(partial)).toBe('partial')
    expect(staleHopFormat(partial)).toBe(true)
    expect(hopProofForm(spawn)).toBeNull()
  })

  it('refuses an mp with a character outside 0-9 and a-f, and the chain says so', () => {
    const bad = resigned((tags) => tags.map((t) => (t[0] === 'mp' ? ['mp', t[1].toUpperCase()] : t)))
    expect(parseAction(bad)).toBeNull()
    expect(buildChain([spawn, bad])[1].breaks).toBeTruthy()
  })

  it('breaks a hop that carries mn or mp twice (every read tag once, 2026-10-08)', () => {
    for (const name of ['mn', 'mp']) {
      const doubled = resigned((tags) => [...tags, tags.find((t) => t[0] === name)!])
      const placed = buildChain([spawn, doubled])[1]
      expect(placed.breaks).toContain(`two ${name} tags`)
    }
    expect(buildChain([spawn, hop])[1].breaks).toBeUndefined()
  })

  it('places a version 2 hop where it went', () => {
    expect(buildChain([spawn, hop])[1]).toMatchObject({ type: 'hop', coordHex: positionHex(to, at.plane) })
  })
})

describe('signed but unsent hops in the old format (staleFormatCut)', () => {
  const v1 = resigned((tags) => tags.filter((t) => t[0] !== 'mn' && t[0] !== 'mp'))
  const after = finalizeEvent(hopTemplate({ ...link, createdAt: link.createdAt + 1, previousId: v1.id, prevCoordHex: positionHex(to, at.plane), to: at, proofHash: proof.tags.proof, mn: proof.tags.mn, mp: proof.tags.mp }), sk) as NostrEvent

  it('leaves a chain alone when nothing unsent is in the old format', () => {
    expect(staleFormatCut([spawn, hop], () => false)).toBeNull()
    // Published already: the census decides it, never this client.
    expect(staleFormatCut([spawn, v1], () => true)).toBeNull()
  })

  it('cuts one unsent version 1 hop at the head, to be made again', () => {
    const cut = staleFormatCut([spawn, v1], (id) => id === spawn.id)
    expect(cut).toEqual({ at: 1, removed: [v1], reprove: v1 })
  })

  it('never removes a published event: a chain with one after the old hop is not cut', () => {
    expect(staleFormatCut([spawn, v1, after], (id) => id === spawn.id || id === after.id)).toBeNull()
  })

  it('cuts every unsent event after it too, and makes none of them again', () => {
    const cut = staleFormatCut([spawn, v1, after], (id) => id === spawn.id)
    expect(cut).toEqual({ at: 1, removed: [v1, after], reprove: null })
  })
})
