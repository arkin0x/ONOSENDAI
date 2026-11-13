/**
 * relayStoppedStanding.test.ts - where you stand on a chain the relay's rules
 * stop (owner, 2026-11-13): where it stops, not at its head, as on a broken
 * chain. The owner's real chain (spawn through 2026-09-04) stops at its
 * version 1 sidestep (row 23), so you stand where row 22 left you, and so do
 * the view, the trail and RECALL to your head. While the 5.13 list loads the
 * head stands, and the list's arrival stands you where it stops. A chain
 * nothing stops (the same chain up to row 22) stands at its head; a hop above
 * the relay's ceiling stops nothing (lib/__tests__/chainStop.test.ts). The
 * COORDINATE the panel shows, and LINK, name where you stand.
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

import { useCyberspace } from '../useCyberspace'
import { resetChainStops, setV1HopListForTests } from '../../lib/chainStop'
import { loadV1HopList } from '../../lib/v1HopList'
import { buildChain, type NostrEvent } from '../../lib/events'
import owner from '../../lib/__tests__/vectors/owner-chain-e8ed3798-through-2026-09-04.json'

const S = () => useCyberspace.getState()
const OWNER = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const EVENT_22 = 'daf160627616b019dff4d1363e510b09bde200894b1aba8eb1bc9e5e9b2bce64'
const events = owner as NostrEvent[]
const rows = buildChain(events, OWNER)
const at22 = rows.find((a) => a.id === EVENT_22)!
const head = rows[rows.length - 1]
let list: ReadonlySet<string>

/** Signed in as the owner, nothing in hand, then the relays bring `chain` (adoptChain: the fold every load and feed goes through). */
function adopt(chain: NostrEvent[]): void {
  useCyberspace.setState({
    identity: { ...S().identity, pubkey: OWNER },
    events: [], prevEventId: '', genesisId: '', published: {}, held: false, chainConflict: null,
    exploreIndex: null, spectate: null, focus: null, transit: null, walking: false,
    proof: { ...S().proof, status: 'idle', message: null },
  })
  S().adoptChain(chain)
}

beforeEach(async () => {
  list ??= await loadV1HopList()
  resetChainStops()
})

describe("the owner's chain, stopped at 2026-09-04", () => {
  it('you, the view and the cursor stand where row 22 left you, not at the head', () => {
    setV1HopListForTests(list)
    adopt(events)
    expect(S().events).toHaveLength(events.length)
    expect(head.coordHex).not.toBe(at22.coordHex)
    expect(S().position).toEqual(at22.position)
    expect(S().plane).toBe(at22.plane)
    expect(S().headPlane).toBe(at22.plane)
    expect(S().anchor).toEqual(at22.position)
    expect(S().cursor).toEqual(at22.position)
    expect(S().coordHex()).toBe(at22.coordHex)
  })

  it('the trail stops there too: every position from the stop on is where it stops', () => {
    setV1HopListForTests(list)
    adopt(events)
    const history = S().positionHistory
    expect(history).toHaveLength(rows.length)
    expect(history.slice(0, 23)).toEqual(rows.slice(0, 23).map((a) => a.position))
    for (const p of history.slice(23)) expect(p).toEqual(at22.position)
  })

  it('RECALL to your head, and a row after the stop, stand there; a row before it stands where it went', () => {
    setV1HopListForTests(list)
    adopt(events)
    S().explore(5)
    expect(S().anchor).toEqual(rows[5].position)
    S().explore(24)
    expect(S().anchor).toEqual(at22.position)
    S().explore(null)
    expect(S().anchor).toEqual(at22.position)
  })

  it('nothing signed changes: the rows keep where each action went', () => {
    setV1HopListForTests(list)
    adopt(events)
    expect(S().actions()[S().actions().length - 1].position).toEqual(head.position)
    expect(S().prevEventId).toBe(head.id)
  })

  it('while the 5.13 list loads the head stands; its arrival stands you where the chain stops, the view with you', () => {
    adopt(events)
    expect(S().position).toEqual(head.position)
    expect(S().anchor).toEqual(head.position)
    setV1HopListForTests(list)
    expect(S().position).toEqual(at22.position)
    expect(S().anchor).toEqual(at22.position)
    expect(S().cursor).toEqual(at22.position)
  })

  it('the list arriving while you look at another row moves only you, not the view', () => {
    adopt(events)
    S().explore(5)
    setV1HopListForTests(list)
    expect(S().position).toEqual(at22.position)
    expect(S().anchor).toEqual(rows[5].position)
  })
})

describe('a chain nothing stops', () => {
  it('the same chain up to row 22 stands at its head', () => {
    setV1HopListForTests(list)
    const kept = new Set(rows.slice(0, 23).map((a) => a.id))
    adopt(events.filter((e) => kept.has(e.id)))
    expect(S().events).toHaveLength(23)
    expect(S().position).toEqual(at22.position)
    expect(S().positionHistory).toEqual(rows.slice(0, 23).map((a) => a.position))
  })
})
