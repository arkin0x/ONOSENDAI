/**
 * neighborRelayStop.test.ts - someone else's chain stopped by the relay's
 * rules (owner, 2026-11-13): frozen, and standing where it stops, as a
 * broken chain is. The owner's real chain stops at its version 1 sidestep
 * (row 23), so read at its head it is frozen where event 22 left it; read at
 * event 22 itself it is not frozen. Never on a guess: the 5.13 list is
 * loaded for a chain with a version 1 hop before anything is said.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildChain, type NostrEvent } from '../events'
import owner from './vectors/owner-chain-e8ed3798-through-2026-09-04.json'

const events = owner as NostrEvent[]
let served: NostrEvent[] = events

vi.mock('../chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../chains')>()),
  fetchChainEvents: async () => served,
}))

import { forgetNeighborChains, readChain } from '../neighborChains'
import { resetChainStops, v1HopListNow } from '../chainStop'

const OWNER = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const EVENT_22 = 'daf160627616b019dff4d1363e510b09bde200894b1aba8eb1bc9e5e9b2bce64'
const rows = buildChain(events, OWNER)
const at22 = rows.find((a) => a.id === EVENT_22)!
const head = rows[rows.length - 1]

beforeEach(() => {
  forgetNeighborChains()
  resetChainStops()
  served = events
})

describe("another person's chain the relay stops", () => {
  it('read at its head: frozen, standing where event 22 left it (the list loaded first, not guessed)', async () => {
    expect(v1HopListNow()).toBeNull()
    const v = await readChain(OWNER, head.id)
    expect(v1HopListNow()).not.toBeNull()
    expect(v?.frozen).toBe(true)
    expect(v?.stand.coordHex).toBe(at22.coordHex)
    expect(v?.stand.coordHex).not.toBe(head.coordHex)
  })

  it('read at event 22, the last action that counts: not frozen, where it went', async () => {
    const v = await readChain(OWNER, EVENT_22)
    expect(v?.frozen).toBe(false)
    expect(v?.stand.coordHex).toBe(at22.coordHex)
  })

  it('the same chain up to event 22 is valid: not frozen at its head', async () => {
    const kept = new Set(rows.slice(0, 23).map((a) => a.id))
    served = events.filter((e) => kept.has(e.id))
    const v = await readChain(OWNER, EVENT_22)
    expect(v?.frozen).toBe(false)
  })
})
