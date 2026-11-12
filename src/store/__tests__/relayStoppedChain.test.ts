/**
 * relayStoppedChain.test.ts - moves on a chain the relay's rules stop (the
 * owner's ruling of 2026-11-12): what ONOSENDAI already does for a broken
 * chain. Every move is refused, nothing is signed, and RESPAWN (or DEREZZ)
 * leaves End of Chain where the chain stops. Not on a guess: while the 5.13
 * list loads, nothing is refused. A hop above the relay's ceiling refuses
 * nothing, since the relay leaves it unchecked and a respawn would not help.
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

import { BROKEN_CHAIN_MESSAGE, RELAY_STOPPED_MESSAGE, useCyberspace, whyNoMove } from '../useCyberspace'
import { placeSpawn } from '../fixtures/placeSpawn'
import { derezzNow } from '../../hud/DerezzPanel'
import { RECENT_VIEWS_KEY, type RecentView } from '../../lib/viewAt'
import { resetChainStops, setV1HopListForTests } from '../../lib/chainStop'
import { loadV1HopList } from '../../lib/v1HopList'
import type { ActionEvent, NostrEvent } from '../../lib/events'
import owner from '../../lib/__tests__/vectors/owner-chain-e8ed3798-through-2026-09-04.json'
import { TUTORIAL_GAME } from '../../lib/games/tutorialGame'

const S = () => useCyberspace.getState()
const EVENT_22 = 'daf160627616b019dff4d1363e510b09bde200894b1aba8eb1bc9e5e9b2bce64'
const recent = (): RecentView[] => JSON.parse(localStorage.getItem(RECENT_VIEWS_KEY) ?? '[]') as RecentView[]
let list: ReadonlySet<string>

beforeEach(async () => {
  await placeSpawn()
  list ??= await loadV1HopList()
  resetChainStops()
  localStorage.removeItem(RECENT_VIEWS_KEY)
  const events = owner as NostrEvent[]
  useCyberspace.setState({ events: [...events], published: Object.fromEntries(events.map((e) => [e.id, 'ok'])), proof: { ...S().proof, status: 'idle', message: null }, plan: null, pendingTarget: null })
})

describe("the owner's chain, stopped at 2026-09-04", () => {
  it('while the 5.13 list loads, nothing is refused on a guess', () => {
    expect(whyNoMove(S().actions())).toBeNull()
  })

  it('once known, every move is refused and nothing is signed', async () => {
    setV1HopListForTests(list)
    expect(whyNoMove(S().actions())).toBe(RELAY_STOPPED_MESSAGE)
    const count = S().events.length
    useCyberspace.setState({ cursor: { ...S().position, x: S().position.x + 2n } })
    await S().commit()
    expect(S().proof.status).toBe('infeasible')
    expect(S().proof.message).toBe(RELAY_STOPPED_MESSAGE)
    expect(S().events).toHaveLength(count)
    expect(RELAY_STOPPED_MESSAGE).toMatch(/Respawn/)
  })

  it('entering a game is refused the same way, and signs nothing (DECK-0002 §2.1)', async () => {
    setV1HopListForTests(list)
    const count = S().events.length
    expect(await S().enterGame(TUTORIAL_GAME)).toEqual({ refused: RELAY_STOPPED_MESSAGE })
    expect(S().events).toHaveLength(count)
  })

  it('RESPAWN leaves End of Chain at event 22, where the chain stops', async () => {
    setV1HopListForTests(list)
    const at22 = S().actions().find((a) => a.id === EVENT_22)!
    const realRespawn = S().respawn
    useCyberspace.setState({ respawn: async () => undefined })
    try { await S().respawnFromBrokenChain() } finally { useCyberspace.setState({ respawn: realRespawn }) }
    expect(recent()[0]).toMatchObject({ input: at22.coordHex, label: 'End of Chain daf16062', pinned: true })
  })

  it('DEREZZ does the same', async () => {
    setV1HopListForTests(list)
    const realRespawn = S().respawn
    useCyberspace.setState({ respawn: async () => undefined })
    try { expect(await derezzNow()).toBeNull() } finally { useCyberspace.setState({ respawn: realRespawn }) }
    expect(recent()[0]?.label).toBe('End of Chain daf16062')
  })
})

describe('a known break while the list loads', () => {
  it('is refused at once: the break is certain whatever the list says', () => {
    const row = (id: string, type: string, extra: Partial<ActionEvent> = {}): ActionEvent =>
      ({ id, type, coordHex: id.padEnd(64, '0'), role: 'base', createdAt: 1_790_000_000, ...extra }) as unknown as ActionEvent
    const chain = [row('b0', 'spawn'), row('b1', 'hop'), row('b2', 'hop', { mn: '0'.repeat(16), mp: 'ab', breaks: 'starts elsewhere' })]
    expect(whyNoMove(chain)).toBe(BROKEN_CHAIN_MESSAGE)
  })
})

describe('a hop above the relay ceiling', () => {
  it('refuses nothing: the relay leaves it unchecked, and ONOSENDAI does not refuse such hops', () => {
    const row = (id: string, type: string, x: bigint, extra: Partial<ActionEvent> = {}): ActionEvent =>
      ({ id, type, coordHex: id.padEnd(64, '0'), role: 'base', createdAt: 1_790_000_000, position: { x, y: 0n, z: 0n }, ...extra }) as unknown as ActionEvent
    const chain = [row('h0', 'spawn', 0n), row('h1', 'hop', 1n << 30n, { mn: '0'.repeat(16), mp: 'ab' }), row('h2', 'hop', (1n << 30n) + 1n, { mn: '0'.repeat(16), mp: 'ab' })]
    expect(whyNoMove(chain)).toBeNull()
  })
})
