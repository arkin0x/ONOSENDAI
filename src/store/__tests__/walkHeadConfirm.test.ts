/**
 * walkHeadConfirm.test.ts - a WALK step asks the relays for your head once,
 * immediately before it is signed, not also before its proof (arkinox,
 * 2026-10-31: "do the walk speedup, skip first"). Every other move asks
 * twice, as the ruling of 2026-10-08 has it.
 *
 * What would go wrong silently: a WALK step that still waits on the relays
 * twice (the 2 to 6 s per step this is for); a step signed from a head
 * another device or tab moved past while its proof ran (a fork, which ends
 * the chain); a step that, refused for that, retries forever or never
 * moves again; a COMMIT that lost its first look along with WALK.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

type Req = { id: number; mode: string; from: { x: bigint; y: bigint; z: bigint }; to: { x: bigint; y: bigint; z: bigint }; prevEventId: string }
const posted = vi.hoisted(() => [] as Req[])
vi.mock('../../lib/workers', async (orig) => ({
  ...(await orig() as object),
  postProof: vi.fn((m: Req) => { posted.push(m) }),
  cancelProof: vi.fn(),
}))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
/** Every head confirmation asked of the relays, and what each answers in turn (empty when out: nothing new). */
const relay = vi.hoisted(() => ({ asked: 0, answers: [] as unknown[][], onAsk: null as (() => void) | null }))
vi.mock('../../lib/chains', async (orig) => ({
  ...(await orig() as object),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => {
    relay.asked++
    relay.onAsk?.()
    return relay.answers.shift() ?? []
  }),
}))
vi.mock('../../lib/calibration', async (orig) => ({ ...(await orig<typeof import('../../lib/calibration')>()), recommendedHopHeight: () => 20 }))

import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { placeSpawn } from '../fixtures/placeSpawn'
import { moveDirection } from '../../lib/moves'
import { hopTemplate, positionHex, type NostrEvent } from '../../lib/events'

const S = () => useCyberspace.getState()

/** The worker's answer to a proof request: done, bound to the head it was asked from. */
const done = (req: Req) => ({ type: 'done' as const, id: req.id, mode: req.mode as 'hop', elapsedMs: 5, proofHash: 'ab'.repeat(32), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: req.prevEventId })

/** The id of the event an action names as the one before it. */
const previousOf = (e: NostrEvent): string | undefined => e.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1] ?? e.tags.find((t) => t[0] === 'e')?.[1]

/** A move of this identity from the current head, signed with its key as another device or tab would sign it. */
async function theirMove(dz: bigint): Promise<NostrEvent> {
  const s = S()
  const head = s.events[s.events.length - 1]
  return s.signEvent(hopTemplate({ createdAt: head.created_at + 1, genesisId: s.genesisId, previousId: head.id, prevCoordHex: s.coordHex(), to: { ...s.position, z: s.position.z + dz }, plane: s.headPlane, proofHash: '0'.repeat(64) }))
}

/** One WALK step pressed and closed: its proof is asked of the worker. */
async function walkStep(): Promise<Req> {
  const before = posted.length
  useWalk.getState().press('right')
  useWalk.getState().settle()
  await vi.waitFor(() => expect(posted.length).toBe(before + 1))
  return posted[posted.length - 1]
}

/** No action of the chain names the same event as another: no fork. */
function noFork(): void {
  const prevs = S().events.slice(1).map(previousOf)
  expect(new Set(prevs).size).toBe(prevs.length)
}

beforeEach(async () => {
  posted.length = 0
  relay.asked = 0
  relay.answers = []
  relay.onAsk = null
  useWalk.getState().exit()
  useCyberspace.setState({ cloudPrefs: { ...S().cloudPrefs, mode: 'off' } })
  await placeSpawn()
  S().cancel()
  S().clearFocus()
  useCyberspace.setState({ proof: { ...S().proof, status: 'idle', message: null }, transit: null, pendingTarget: null, chainConflict: null })
})

describe('WALK asks the relays once per step, before signing (arkinox, 2026-10-31)', () => {
  it('a WALK step makes exactly one relay head confirmation, after its proof, and signs from the head it confirmed', async () => {
    useWalk.getState().enter()
    const head = S().prevEventId
    const events = S().events.length
    const req = await walkStep()
    // Proof asked with no look at the relays first, from the head this device holds.
    expect(relay.asked).toBe(0)
    expect(req.prevEventId).toBe(head)
    await S().applyProofMessage(done(req))
    expect(relay.asked).toBe(1)
    expect(S().events).toHaveLength(events + 1)
    expect(previousOf(S().events[events])).toBe(head)
    expect(S().position).toEqual(req.to)
    useWalk.getState().exit()
  })

  it('a COMMIT still asks the relays twice: before its proof and before it is signed', async () => {
    const head = S().prevEventId
    const events = S().events.length
    S().moveCursor(moveDirection(S().axes(), 'right'))
    await S().commit()
    expect(posted).toHaveLength(1)
    expect(relay.asked).toBe(1)
    await S().applyProofMessage(done(posted[0]))
    expect(relay.asked).toBe(2)
    expect(S().events).toHaveLength(events + 1)
    expect(previousOf(S().events[events])).toBe(head)
  })

  it('a head another device moved while the proof ran is refused at signing; the walk stops there and the next press walks on from it: no fork, no loop', async () => {
    useWalk.getState().enter()
    const head = S().prevEventId
    const events = S().events.length
    const req = await walkStep()
    // The relays answer the look before signing with another device's move.
    const theirs = await theirMove(4n)
    relay.answers = [[theirs]]
    await S().applyProofMessage(done(req))
    // Nothing signed from the old head: their move is taken in, the proof is
    // thrown away, and the walk stops with the words the look before the
    // proof used to give, back at the head the chain now has.
    expect(relay.asked).toBe(1)
    expect(S().prevEventId).toBe(theirs.id)
    expect(S().events).toHaveLength(events + 1)
    expect(S().events.filter((e) => previousOf(e) === head).map((e) => e.id)).toEqual([theirs.id])
    expect(posted).toHaveLength(1)
    expect(S().proof.message).toBe('Another device moved you. Re-aim from where you are now.')
    expect(useWalk.getState().running).toBeNull()
    expect(useWalk.getState().queue).toEqual([])
    expect(S().cursor).toEqual(S().position)
    // The next press is proved from their move, once, and signed onto it.
    const next = await walkStep()
    expect(next.prevEventId).toBe(theirs.id)
    expect(next.from).toEqual(S().position)
    await S().applyProofMessage(done(next))
    expect(relay.asked).toBe(2)
    expect(posted).toHaveLength(2)
    expect(S().events).toHaveLength(events + 2)
    expect(previousOf(S().events[events + 1])).toBe(theirs.id)
    expect(S().position).toEqual(next.to)
    noFork()
    useWalk.getState().exit()
  })

  it('another tab that moved before the press: its move is taken in before the proof, with no look at the relays', async () => {
    useWalk.getState().enter()
    const s = S()
    const theirs = await theirMove(2n)
    localStorage.setItem(`onosendai:chain:${s.identity.pubkey}`, JSON.stringify({ version: 2, events: [...s.events, theirs], published: s.events.map((e) => e.id), stats: {} }))
    localStorage.setItem(`onosendai:chain-mark:${s.identity.pubkey}`, 'the other tab, before')
    useWalk.getState().press('right')
    useWalk.getState().settle()
    await vi.waitFor(() => expect(S().prevEventId).toBe(theirs.id))
    await vi.waitFor(() => expect(useWalk.getState().running).toBeNull())
    expect(posted).toHaveLength(0)
    expect(relay.asked).toBe(0)
    expect(S().proof.message).toBe('Another device moved you. Re-aim from where you are now.')
    useWalk.getState().exit()
  })

  it('another tab that moved while the proof ran is still caught before signing (the cross-tab mark), and nothing is signed from the old head', async () => {
    useWalk.getState().enter()
    const head = S().prevEventId
    const events = S().events.length
    const req = await walkStep()
    const s = S()
    const theirs = await theirMove(2n)
    // The other tab's save lands while this tab's proof computes.
    localStorage.setItem(`onosendai:chain:${s.identity.pubkey}`, JSON.stringify({ version: 2, events: [...s.events, theirs], published: s.events.map((e) => e.id), stats: {} }))
    localStorage.setItem(`onosendai:chain-mark:${s.identity.pubkey}`, 'the other tab, during')
    await S().applyProofMessage(done(req))
    expect(S().prevEventId).toBe(theirs.id)
    expect(S().coordHex()).toBe(positionHex({ ...req.from, z: req.from.z + 2n }, s.headPlane))
    expect(S().events.filter((e) => previousOf(e) === head).map((e) => e.id)).toEqual([theirs.id])
    // Taken in from storage, still queued for publishing: the relays (asked
    // once, before signing, and answering nothing new) never had it.
    expect(S().published[theirs.id]).toBe('queued')
    expect(relay.asked).toBe(1)
    expect(posted).toHaveLength(1)
    expect(S().proof.message).toBe('Another device moved you. Re-aim from where you are now.')
    // The next press is proved from their move and signed onto it.
    const next = await walkStep()
    expect(next.prevEventId).toBe(theirs.id)
    await S().applyProofMessage(done(next))
    expect(S().events).toHaveLength(events + 2)
    expect(previousOf(S().events[events + 1])).toBe(theirs.id)
    noFork()
    useWalk.getState().exit()
  })
})
