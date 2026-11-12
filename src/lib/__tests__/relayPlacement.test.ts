/**
 * relayPlacement.test.ts: where a speakeasy's relay places a chain (strict
 * mode). The owner's real chain (public kind 3333 events, spawn through
 * 2026-09-04, fetched 2026-11-12 from wss://relay.onosendai.tech) stops at
 * its version 1 sidestep of 2026-09-04: the relay placed him at event 22,
 * one cube from the midwest speakeasy, and refused him there.
 */
import { describe, expect, it } from 'vitest'
import { buildChain, firstBreak, type ActionEvent, type NostrEvent } from '../events'
import { loadV1HopList } from '../v1HopList'
import { needsV1HopList, relayPlacement, RELAY_MAX_HOP_HEIGHT } from '../relayPlacement'
import { hopMaxHeight } from '../cloudVerify'
import owner from './vectors/owner-chain-e8ed3798-through-2026-09-04.json'

const OWNER = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const MIDWEST = '56db6db6db6db6db6db6dbad'
const EVENT_22 = 'daf160627616b019dff4d1363e510b09bde200894b1aba8eb1bc9e5e9b2bce64'
const V1_SIDESTEP = 'd334293bb26271aead7efa4b814d1564f192485cf0698dc618fbe31923f30355'

describe("the owner's chain (real events)", () => {
  const chain = buildChain(owner as NostrEvent[], OWNER)

  it('ONOSENDAI sees no break in it, so it still lets him move', () => {
    expect(chain).toHaveLength(26)
    expect(firstBreak(chain)).toBeNull()
  })

  it('the relay stops at the version 1 sidestep of 2026-09-04 and places him at event 22, outside midwest', async () => {
    expect(needsV1HopList(chain)).toBe(true)
    const placed = relayPlacement(chain, await loadV1HopList())
    expect(placed?.stop?.index).toBe(23)
    expect(placed?.stop?.action.id).toBe(V1_SIDESTEP)
    expect(placed?.stop?.kind).toBe('broken')
    expect(placed?.stop?.lastValid?.id).toBe(EVENT_22)
    expect(new Date((placed?.stop?.lastValid?.createdAt ?? 0) * 1000).toISOString().slice(0, 10)).toBe('2026-09-04')
    expect(placed?.coordHex.startsWith('56db6db6db6db6db6db6dba9')).toBe(true)
    expect(placed?.coordHex.startsWith(MIDWEST)).toBe(false)
  })

  it('without the 5.13 list his version 1 hops would not stand: the list is what lets the walk reach the sidestep', () => {
    expect(relayPlacement(chain, new Set())?.stop?.index).toBe(1)
  })
})

/** A small chain of stand-ins: only the fields relayPlacement reads. */
function move(id: string, type: string, extra: Partial<ActionEvent> = {}): ActionEvent {
  return { id, type, coordHex: id.padEnd(64, '0'), role: 'base', ...extra } as unknown as ActionEvent
}

describe('relayPlacement', () => {
  const spawn = move('a0', 'spawn')
  const v2 = { mn: '0'.repeat(16), mp: 'ab' }

  it('accepts a whole chain of version 2 moves: you stand at your head', () => {
    const chain = [spawn, move('a1', 'hop', v2), move('a2', 'sidestep', { mn: '1'.repeat(16) })]
    expect(relayPlacement(chain, new Set())).toEqual({ coordHex: chain[2].coordHex, stop: null })
  })

  it('stops at an unlisted version 1 hop, and accepts a listed one', () => {
    const chain = [spawn, move('a1', 'hop'), move('a2', 'hop', v2)]
    expect(relayPlacement(chain, new Set())?.coordHex).toBe(spawn.coordHex)
    expect(relayPlacement(chain, new Set(['a1']))?.stop).toBeNull()
  })

  it('stops at a hop with only one of mn and mp', () => {
    const placed = relayPlacement([spawn, move('a1', 'hop', { mn: '0'.repeat(16) })], new Set())
    expect(placed?.stop?.kind).toBe('broken')
  })

  it('stops at a sidestep or a ride with no mn that is on no list', () => {
    expect(relayPlacement([spawn, move('a1', 'sidestep')], new Set())?.stop?.index).toBe(1)
    expect(relayPlacement([spawn, move('a1', 'hyperjump')], new Set())?.stop?.index).toBe(1)
  })

  it(`stops before a hop taller than h${RELAY_MAX_HOP_HEIGHT}, which the relay leaves unchecked, and says it is not broken`, () => {
    const from = { x: 0n, y: 0n, z: 0n }
    const to = { x: 1n << 30n, y: 0n, z: 0n }
    expect(hopMaxHeight({ from, to, plane: 0 })).toBeGreaterThan(RELAY_MAX_HOP_HEIGHT)
    const chain = [move('a0', 'spawn', { position: from, plane: 0 }), move('a1', 'hop', { ...v2, position: to, plane: 0 })]
    const placed = relayPlacement(chain, new Set())
    expect(placed?.stop?.kind).toBe('tall')
    expect(placed?.coordHex).toBe(chain[0].coordHex)
  })

  it('a structural break buildChain finds is a stop too, at the last valid position', () => {
    const chain = [spawn, move('a1', 'hop', v2), move('a2', 'hop', { ...v2, breaks: 'starts elsewhere' })]
    const placed = relayPlacement(chain, new Set())
    expect(placed?.stop).toMatchObject({ index: 2, kind: 'broken' })
    expect(placed?.coordHex).toBe(chain[1].coordHex)
  })

  it('a form stop before a structural break is the one that counts', () => {
    const chain = [spawn, move('a1', 'sidestep'), move('a2', 'hop', { ...v2, breaks: 'starts elsewhere' })]
    expect(relayPlacement(chain, new Set())?.stop?.index).toBe(1)
  })

  it('needs the 5.13 list only when a version 1 hop is on the chain', () => {
    expect(needsV1HopList([spawn, move('a1', 'hop', v2)])).toBe(false)
    expect(needsV1HopList([spawn, move('a1', 'hop')])).toBe(true)
  })
})
