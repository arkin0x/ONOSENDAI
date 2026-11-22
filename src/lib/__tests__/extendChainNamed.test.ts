/**
 * extendChainNamed.test.ts: adding a landed action to the parsed chain asks
 * one lookup whether the chain already names it, not a pass over every tag
 * of every event (owner's phone walk of 2026-11-21: a 2,600-action chain).
 *
 * What would go wrong silently: a new event extended onto a chain in which
 * another event already names it (the walk would go on from there), or any
 * answer that differs from reading every tag.
 */
import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { buildChain, extendChain, namedIds, positionHex, spawnTemplate, type ActionEvent, type NostrEvent } from '../events'
import type { Position } from '../space'
import { hopEvent } from './chainFixtures'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawn = finalizeEvent(spawnTemplate(pk, 1_000), sk) as NostrEvent
const home = coordToXyz(hexToCoord(pk))
const plane = home.plane
const at = (dx: bigint): Position => ({ x: home.x + dx, y: home.y, z: home.z })

function hops(n: number, from: NostrEvent[] = [spawn]): NostrEvent[] {
  const out = from.slice()
  for (let i = 0; i < n; i++) {
    const k = out.length
    out.push(hopEvent({ pubkey: pk, createdAt: 1_010 + k, genesisId: spawn.id, previousId: out[k - 1].id, c: k === 1 ? pk : positionHex(at(BigInt(k - 1)), plane), to: at(BigInt(k)), plane }))
  }
  return out
}

/** Each event fed in turn, both ways: reading every tag, and with the ids named so far, grown as the store grows them. */
function feedBoth(events: NostrEvent[]): Array<[string, string]> {
  const out: Array<[string, string]> = []
  let chain: ActionEvent[] = buildChain(events.slice(0, 1))
  const named = namedIds(events.slice(0, 1))
  for (let k = 1; k < events.length; k++) {
    const plain = extendChain(chain, events.slice(0, k), events[k])
    const fast = extendChain(chain, events.slice(0, k), events[k], named)
    expect(fast).toEqual(plain)
    out.push([plain === null ? 'null' : 'ext', fast === null ? 'null' : 'ext'])
    namedIds([events[k]], named)
    // Each extension built on the one before, as the store's memo does; a refusal starts over from a full build.
    chain = fast ?? buildChain(events.slice(0, k + 1))
    expect(chain).toEqual(buildChain(events.slice(0, k + 1)))
  }
  return out
}

describe('extendChain with the ids the chain names', () => {
  it('grows a plain chain exactly as reading every tag does', () => {
    expect(feedBoth(hops(40)).every(([a, b]) => a === 'ext' && b === 'ext')).toBe(true)
  })

  it('refuses an event the chain already names, both ways', () => {
    const events = hops(10)
    const next = hopEvent({ pubkey: pk, createdAt: 1_100, genesisId: spawn.id, previousId: events[10].id, c: positionHex(at(10n), plane), to: at(11n), plane })
    // A child of `next` that arrived before it.
    const child = hopEvent({ pubkey: pk, createdAt: 1_101, genesisId: spawn.id, previousId: next.id, c: positionHex(at(11n), plane), to: at(12n), plane })
    const held = [...events, child]
    const chain = buildChain(events)
    expect(extendChain(chain, held, next)).toBeNull()
    expect(extendChain(chain, held, next, namedIds(held))).toBeNull()
    // Without the child, it extends.
    expect(extendChain(chain, events, next, namedIds(events))?.length).toBe(12)
  })

  it('namedIds grows in place with the events added', () => {
    const events = hops(5)
    const named = namedIds(events.slice(0, 3))
    expect(named.has(events[3].id)).toBe(false)
    expect(namedIds([events[4]], named)).toBe(named)
    expect(named.has(events[3].id)).toBe(true)
  })
})

describe('the ids gathered only when they are needed', () => {
  it('an event refused before any tag is read never gathers them', () => {
    const events = hops(5)
    let asked = 0
    const named = () => { asked++; return namedIds(events) }
    // A spawn, which extendChain refuses on its kind of action alone.
    expect(extendChain(buildChain(events), events, spawn, named)).toBeNull()
    expect(asked).toBe(0)
    const next = hopEvent({ pubkey: pk, createdAt: 1_100, genesisId: spawn.id, previousId: events[5].id, c: positionHex(at(5n), plane), to: at(6n), plane })
    expect(extendChain(buildChain(events), events, next, named)?.length).toBe(7)
    expect(asked).toBe(1)
  })
})
