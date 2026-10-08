/**
 * builderBrokenChain.test.ts - a broken chain stops moves, not hiding things.
 *
 * #227 freezes a broken chain: every way to move is refused until you
 * respawn. Hiding something in a bag is not a move (it signs an item and a
 * bag, never an action on the chain), so BUILD mode and its deploys go on.
 * Checked on merging v2 into the Builder (2026-10-08).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
// Every chain reads as broken at its first action.
vi.mock('../../lib/events', async (orig) => {
  const real = await orig() as typeof import('../../lib/events')
  return { ...real, firstBreak: (chain: Parameters<typeof real.firstBreak>[0]) => (chain.length > 0 ? { index: 0, action: chain[0], lastValid: null } : null) }
})

import { BROKEN_CHAIN_MESSAGE, useCyberspace, whyNoMove } from '../useCyberspace'
import { useShards } from '../useShards'
import { useBuilder } from '../useBuilder'
import { placeSpawn } from '../fixtures/placeSpawn'
import { moveDirection } from '../../lib/moves'

const S = () => useCyberspace.getState()

beforeEach(async () => {
  useShards.setState({ mine: [], pending: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useCyberspace.setState({ live: false })
  await placeSpawn()
})

describe('on a broken chain', () => {
  it('moves are refused, and a message still hides at the build cursor', async () => {
    expect(whyNoMove(S().actions())).toBe(BROKEN_CHAIN_MESSAGE)
    const events = S().events.length
    useBuilder.getState().enter('build')
    S().moveCursor(moveDirection(S().axes(), 'up'))
    useShards.getState().startDeployMessage('left on a frozen chain')
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    expect(useShards.getState().mine.filter((d) => d.text === 'left on a frozen chain')).toHaveLength(1)
    // Nothing went onto the chain.
    expect(S().events.length).toBe(events)
  })
})
