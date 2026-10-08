/**
 * builderCommitRace.test.ts - a move goes where it was aimed when it was
 * pressed, from your head, or not at all.
 *
 * Found in review of the Builder (2026-10-07): commit() checked that you were
 * at your head once, before waiting on the relay, and read the cursor after
 * the wait. Pressing B (or VIEW) and moving the build cursor during that wait
 * sent the proof to the build cursor. These press COMMIT, change things
 * during the wait, and check that nothing is computed and the reason is said.
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

const posted: Array<{ mode: string; to: unknown }> = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
// The look at the relay before signing takes a while, as it does on a real network.
vi.mock('../../lib/chains', async (orig) => ({
  ...(await orig() as object),
  fetchChainEvents: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve([]), 200))),
}))
vi.mock('../../lib/workers', async (orig) => ({
  ...(await orig() as object),
  postProof: (m: { mode: string; to: unknown }) => { posted.push(m) },
  cancelProof: () => {},
}))

import { AIM_CHANGED_MESSAGE, LEFT_HEAD_MESSAGE, useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { placeSpawn } from '../fixtures/placeSpawn'
import { moveDirection } from '../../lib/moves'

const S = () => useCyberspace.getState()

beforeEach(() => {
  posted.length = 0
  useBuilder.getState().exit()
  S().clearFocus()
  useCyberspace.setState({ proof: { ...S().proof, status: 'idle', message: null } })
})

describe('a commit waiting on the first-move check', () => {
  it('signs no spawn and sends nothing when BUILD starts during the wait', async () => {
    // Provisional: no chain yet, so the first move waits for the self-check.
    expect(S().events.length).toBe(0)
    useCyberspace.setState({ selfCheck: { pubkey: S().identity.pubkey, status: 'checking' } })
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const p = S().commit()
    useBuilder.getState().enter('build')
    for (let i = 0; i < 3; i++) S().moveCursor(moveDirection(S().axes(), 'up'))
    useCyberspace.setState({ selfCheck: { pubkey: S().identity.pubkey, status: 'none' } })
    await p
    expect(S().events.length).toBe(0)
    expect(posted).toEqual([])
    expect(S().proof.message).toBe(LEFT_HEAD_MESSAGE)
  })
})

describe('a commit waiting on the look at the relay', () => {
  beforeEach(async () => { await placeSpawn() })

  it('sends nothing when B and a few steps of the build cursor come during the wait', async () => {
    const events = S().events.length
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const p = S().commit()
    useBuilder.getState().enter('build')
    for (let i = 0; i < 5; i++) S().moveCursor(moveDirection(S().axes(), 'up'))
    await p
    expect(posted).toEqual([])
    expect(S().pendingTarget).toBeNull()
    expect(S().events.length).toBe(events)
    expect(S().proof.message).toBe(LEFT_HEAD_MESSAGE)
  })

  it('sends nothing when a VIEW from the Position panel comes during the wait', async () => {
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const p = S().commit()
    S().focusOn({ x: 9n, y: 9n, z: 9n }, 0, 'a typed place', undefined, true)
    S().moveCursor(moveDirection(S().axes(), 'up'))
    await p
    expect(posted).toEqual([])
    expect(S().proof.message).toBe(LEFT_HEAD_MESSAGE)
  })

  it('sends nothing, and says why, when the cursor is re-aimed at your head during the wait', async () => {
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const p = S().commit()
    S().moveCursor(moveDirection(S().axes(), 'up'))
    await p
    expect(posted).toEqual([])
    expect(S().proof.message).toBe(AIM_CHANGED_MESSAGE)
  })

  it('says another device moved you when that is what changed the cursor during the wait', async () => {
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const p = S().commit()
    // What adopting another device's newer head writes at your head.
    const there = { x: S().position.x + 7n, y: S().position.y, z: S().position.z }
    useCyberspace.setState({ prevEventId: 'another-device-event', position: there, cursor: { ...there }, anchor: { ...there } })
    await p
    expect(posted).toEqual([])
    expect(S().proof.message).toBe('Another device moved you. Re-aim from where you are now.')
  })

  it('still sends the move when nothing changes during the wait', async () => {
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const aimed = { ...S().cursor }
    await S().commit()
    expect(posted).toHaveLength(1)
    expect(posted[0].to).toEqual(aimed)
    S().cancel()
  })
})
