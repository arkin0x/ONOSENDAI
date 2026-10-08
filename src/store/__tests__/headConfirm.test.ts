/**
 * headConfirm.test.ts - ONOSENDAI confirms it holds your live head before it
 * signs any chain action, and refuses when it cannot (arkinox's ruling of
 * 2026-10-08, normative in the spec: a fork ends the whole chain, so a
 * client must not sign from a stale head).
 *
 * What would go wrong silently: a move signed while the relays could not
 * answer (offline, a reconnect, a slow relay), from a head another device or
 * another tab had already moved past, forking the chain and ending it; a
 * refusal with no word said; and every quick move paying two round trips.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})

const posted: Array<{ id: number; mode: string }> = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

/** What the canonical relay answers each confirmation, in turn: events, or null for no answer. Empty when out: "nothing new". */
const relay = vi.hoisted(() => ({ answers: [] as Array<unknown[] | null>, asked: 0, onAsk: null as (() => void) | null }))
vi.mock('../../lib/chains', async (orig) => ({
  ...(await orig() as object),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => {
    relay.asked++
    relay.onAsk?.()
    return relay.answers.length ? relay.answers.shift() : []
  }),
}))
vi.mock('../../lib/workers', async (orig) => ({
  ...(await orig() as object),
  postProof: (m: { id: number; mode: string }) => { posted.push(m) },
  cancelProof: () => {},
}))
vi.mock('../../lib/hyperspace/enter', async (orig) => ({ ...(await orig() as object), computeEnterProof: () => '0'.repeat(64) }))

import { HEAD_RETRYING_MESSAGE, HEAD_UNCONFIRMED_MESSAGE, useCyberspace } from '../useCyberspace'
import { placeSpawn } from '../fixtures/placeSpawn'
import { moveDirection } from '../../lib/moves'
import { hopTemplate, positionHex, type NostrEvent } from '../../lib/events'

const S = () => useCyberspace.getState()

/** The test's clock, which only moves forward, so no case inherits another's confirmation. */
let clock = Date.now()
/** Wait out the head-confirmation window, so the next action asks again. */
const pastWindow = (): void => { clock += 60_000; vi.setSystemTime(clock) }

beforeEach(async () => {
  posted.length = 0
  relay.answers = []
  relay.asked = 0
  relay.onAsk = null
  await placeSpawn()
  S().clearFocus()
  useCyberspace.setState({ proof: { ...S().proof, status: 'idle', message: null }, transit: null, pendingTarget: null, chainConflict: null })
  vi.useFakeTimers({ toFake: ['Date'] })
  pastWindow()
})

/** A finished proof for the move just committed. */
const done = (elapsedMs: number, prevEventId: string) => ({ type: 'done' as const, id: posted[posted.length - 1].id, mode: 'hop' as const, elapsedMs, proofHash: 'ab'.repeat(32), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId })

describe('a move is signed only from a head the relays confirm', () => {
  it('refuses the move, and says so in a line, when the canonical relay cannot answer', async () => {
    relay.answers = [null, null]
    S().moveCursor(moveDirection(S().axes(), 'right'))
    await S().commit()
    expect(posted).toEqual([])
    expect(relay.asked).toBe(2)
    expect(S().proof.message).toBe(HEAD_UNCONFIRMED_MESSAGE)
    expect(S().proof.message).toBe("Can't confirm your latest move. Try again.")
  })

  it('says it is retrying while it asks again, and moves once the relay answers', async () => {
    relay.answers = [null, []]
    let shown: string | null = null
    relay.onAsk = () => { if (relay.asked === 2) shown = S().proof.message }
    S().moveCursor(moveDirection(S().axes(), 'right'))
    await S().commit()
    expect(shown).toBe(HEAD_RETRYING_MESSAGE)
    expect(shown).toBe("Can't confirm your latest move; retrying.")
    expect(posted).toHaveLength(1)
  })

  it('a quick proof is signed on the commit\'s own confirmation, without asking again', async () => {
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const head = S().prevEventId
    const events = S().events.length
    await S().commit()
    expect(posted).toHaveLength(1)
    await S().applyProofMessage(done(5, head))
    expect(relay.asked).toBe(1)
    expect(S().events).toHaveLength(events + 1)
  })

  it('a long proof asks again before signing, and signs nothing when the relay cannot answer', async () => {
    const events = S().events.length
    const head = S().prevEventId
    S().moveCursor(moveDirection(S().axes(), 'right'))
    relay.answers = [[], null, null]
    await S().commit()
    expect(posted).toHaveLength(1)
    await S().applyProofMessage(done(60_000, head))
    expect(relay.asked).toBe(3)
    expect(S().events).toHaveLength(events)
    expect(S().proof.message).toBe(HEAD_UNCONFIRMED_MESSAGE)
  })

  it('a boarding is refused when the head cannot be confirmed', async () => {
    relay.answers = [null, null]
    const events = S().events.length
    await S().boardHyperspace()
    expect(S().events).toHaveLength(events)
    expect(S().transit).toBeNull()
    expect(S().proof.message).toBe(HEAD_UNCONFIRMED_MESSAGE)
  })

  it('a ride is refused when the head cannot be confirmed', async () => {
    relay.answers = [null, null]
    const head = S().prevEventId
    useCyberspace.setState({ transit: { stage: 'boarded', enterEventId: head, enterCoordHex: S().coordHex() } })
    await expect(S().completeRide({ previousId: head, asOf: 2, toCoordHex: S().coordHex(), fromHeight: 1, toHeight: 2, rootHex: '0'.repeat(64), mp: 'ab', mnHex: '0'.repeat(16) }))
      .rejects.toThrow(HEAD_UNCONFIRMED_MESSAGE)
  })

  it('another tab of this browser moved you: its move is taken in, still queued for publishing, and nothing is signed from the old head', async () => {
    const s = S()
    const head = s.events[s.events.length - 1]
    const to = { ...s.position, x: s.position.x + 2n }
    // Signed with this identity's key, as the other tab would sign it.
    const theirs: NostrEvent = await s.signEvent(hopTemplate({ createdAt: head.created_at + 1, genesisId: s.genesisId, previousId: head.id, prevCoordHex: s.coordHex(), to, plane: s.headPlane, proofHash: '0'.repeat(64) }))
    const stored = [...s.events, theirs]
    localStorage.setItem(`onosendai:chain:${s.identity.pubkey}`, JSON.stringify({ version: 2, events: stored, published: s.events.map((e) => e.id), stats: {} }))
    S().moveCursor(moveDirection(S().axes(), 'right'))
    await S().commit()
    expect(posted).toEqual([])
    expect(S().prevEventId).toBe(theirs.id)
    expect(S().coordHex()).toBe(positionHex(to, s.headPlane))
    expect(S().published[theirs.id]).toBe('queued')
    expect(S().proof.message).toBe('Another device moved you. Re-aim from where you are now.')
  })
})
