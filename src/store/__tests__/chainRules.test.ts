/**
 * chainRules.test.ts - your own chain under the 2026-09-28-virtual-brackets
 * rules (cyberspace spec §8.9, §8.11): what the next move names and where it
 * says it came from, and what happens when another client of yours has
 * taken this identity into a game.
 *
 * What would go wrong silently: a move after an action this client does not
 * recognize naming an earlier event as its previous (a fork, which ends the
 * whole chain), or taking that action's own C as its `c` (an invalid
 * chain); and a move signed while a game holds the avatar, which makes the
 * chain invalid from that point for every verifier.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** What the relays hold for the fresh look before signing (finishProof); nothing by default. */
let relayHolds: NostrEvent[] = []
/** Run while the fresh look is out, as the live feed would deliver meanwhile. */
let duringLook: (() => void) | null = null
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: async () => { duringLook?.(); return relayHolds },
  confirmChainEvents: async () => { duringLook?.(); return relayHolds },
}))

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure'
import { positionHex, type NostrEvent } from '../../lib/events'
import { BROKEN_CHAIN_MESSAGE, GAME_HOLDS_MESSAGE, REFUSE_MOVES_ON_BROKEN_CHAIN, useCyberspace, whyNoMove, type MovePlan } from '../useCyberspace'
import type { ProofResponse } from '../../workers/proof.worker'
import { usePresence } from '../usePresence'
import { placeSpawn } from '../fixtures/placeSpawn'
import { actionEvent, enterVirtualEvent, exitVirtualEvent, virtualEvent } from '../../lib/__tests__/chainFixtures'
import type { Position } from '../../lib/space'

const S = () => useCyberspace.getState()
const tagOf = (ev: NostrEvent, name: string, marker?: string): string | undefined =>
  ev.tags.find((t) => t[0] === name && (marker === undefined || t[3] === marker))?.[1]

async function land(dx: bigint): Promise<void> {
  const s = S()
  useCyberspace.setState({ pendingTarget: { ...s.position, x: s.position.x + dx } })
  await s.applyProofMessage({
    type: 'done', id: 0, mode: 'hop', elapsedMs: 1, proofHash: 'ab'.repeat(32),
    terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1,
  })
}

const arena: Position = { x: (3n << 40n) + 77n, y: (4n << 40n) + 5n, z: (6n << 40n) + 9n }
const GAME = 'cd'.repeat(32)

/** Another client's enter-virtual from the current head, and one game move after it. */
function enterGame(): { enter: NostrEvent; move: NostrEvent } {
  const s = S()
  const enter = enterVirtualEvent({
    pubkey: s.identity.pubkey, createdAt: s.events[s.events.length - 1].created_at + 1,
    genesisId: s.genesisId, previousId: s.prevEventId, c: s.coordHex(), inGame: arena, height: 8, game: GAME, plane: s.plane,
  })
  const move = virtualEvent({
    pubkey: s.identity.pubkey, createdAt: enter.created_at + 1, genesisId: s.genesisId, previousId: enter.id,
    name: 'move', c: positionHex(arena, s.plane), inGame: { ...arena, x: arena.x + 3n }, plane: s.plane,
  })
  return { enter, move }
}

let fresh: Pick<ReturnType<typeof S>, 'events' | 'prevEventId' | 'genesisId' | 'published' | 'position' | 'plane' | 'headPlane' | 'positionHistory' | 'chain'>

beforeEach(async () => {
  if (!fresh) {
    await placeSpawn()
    await land(1n)
    fresh = {
      events: [...S().events], prevEventId: S().prevEventId, genesisId: S().genesisId,
      published: { ...S().published }, position: S().position, plane: S().plane, headPlane: S().headPlane,
      positionHistory: [...S().positionHistory], chain: S().chain,
    }
  }
  relayHolds = []
  duringLook = null
  // The chain an earlier case saved would read as another tab that moved on
  // (confirmHead folds other tabs' saves), so each case starts with none.
  localStorage.removeItem(`onosendai:chain:${S().identity.pubkey}`)
  useCyberspace.setState({
    ...fresh, events: [...fresh.events], published: { ...fresh.published }, positionHistory: [...fresh.positionHistory],
    cursor: fresh.position, pendingTarget: null, forkNotice: null, chainConflict: null, plan: null,
    exploreIndex: null, spectate: null, focus: null, transit: null,
    proof: { ...S().proof, status: 'idle', message: null },
  })
})

describe('your next move after an action this client does not recognize (§8.9)', () => {
  it('names that action as its previous, and carries c from the last recognized C', async () => {
    const before = S().coordHex()
    const beforePosition = S().position
    const wave = actionEvent({
      pubkey: S().identity.pubkey, createdAt: S().events[S().events.length - 1].created_at + 1,
      genesisId: S().genesisId, previousId: S().prevEventId, name: 'wave',
      c: before, C: { ...arena }, plane: S().plane,
    })
    S().adoptChain([wave])
    // Adopted, and it moved nobody: the position and coordHex stay put.
    expect(S().prevEventId).toBe(wave.id)
    expect(S().position).toEqual(beforePosition)
    expect(S().coordHex()).toBe(before)

    await land(1n)
    const hop = S().events[S().events.length - 1]
    expect(tagOf(hop, 'A')).toBe('hop')
    expect(tagOf(hop, 'e', 'previous')).toBe(wave.id)
    expect(tagOf(hop, 'c')).toBe(before)
    expect(S().actions().map((a) => a.role).slice(-2)).toEqual(['skipped', 'base'])
  })
})

describe('a game holds the avatar (§8.11)', () => {
  it('another client entering a game moves nobody: your position is where you entered', () => {
    const position = S().position
    const { enter, move } = enterGame()
    S().adoptChain([enter, move])
    expect(S().prevEventId).toBe(move.id)
    expect(S().position).toEqual(position)
    expect(S().positionHistory[S().positionHistory.length - 1]).toEqual(position)
  })

  it('refuses to move, says why, and signs nothing', async () => {
    const { enter, move } = enterGame()
    S().adoptChain([enter, move])
    const count = S().events.length
    useCyberspace.setState({ cursor: { ...S().position, x: S().position.x + 2n } })
    await S().commit()
    expect(S().proof.status).toBe('infeasible')
    expect(S().proof.message).toBe(GAME_HOLDS_MESSAGE)
    expect(S().events).toHaveLength(count)
  })

  it('refuses a ride, and a boarding is not signed', async () => {
    const { enter } = enterGame()
    S().adoptChain([enter])
    const count = S().events.length
    await expect(S().completeRide({
      previousId: S().prevEventId, toCoordHex: positionHex(arena, 0), fromHeight: 1, toHeight: 2,
      rootHex: '0'.repeat(64), mp: 'ab', mnHex: '0'.repeat(16),
    })).rejects.toThrow(GAME_HOLDS_MESSAGE)
    await S().boardHyperspace()
    expect(S().events).toHaveLength(count)
  })

  it('moves again once the game client publishes an exit, from where you entered', async () => {
    const entered = S().coordHex()
    const { enter, move } = enterGame()
    const exit = exitVirtualEvent({
      pubkey: S().identity.pubkey, createdAt: move.created_at + 1, genesisId: S().genesisId, previousId: move.id,
      entryId: enter.id, c: positionHex({ ...arena, x: arena.x + 3n }, S().plane), restore: S().position, plane: S().plane,
    })
    S().adoptChain([enter, move, exit])
    await land(1n)
    const hop = S().events[S().events.length - 1]
    expect(tagOf(hop, 'A')).toBe('hop')
    expect(tagOf(hop, 'e', 'previous')).toBe(exit.id)
    expect(tagOf(hop, 'c')).toBe(entered)
  })
})

describe('presence places someone inside a game at the entry c', () => {
  it('their avatar is where they entered from, not inside the game', () => {
    usePresence.setState({ people: {}, sector: null, loading: false })
    const sk = generateSecretKey()
    // Someone standing right next to you, who then enters a game far away
    // whose region happens to be in this neighborhood's sector filter: here,
    // the far place stands in the game's tags and the near place is held.
    const near = { ...S().position, x: S().position.x + 3n }
    const nearHex = positionHex(near, S().plane)
    const template = enterVirtualEvent({
      pubkey: '00'.repeat(32), createdAt: 5_000, genesisId: 'aa'.repeat(32), previousId: 'bb'.repeat(32),
      c: nearHex, inGame: { ...S().position, x: S().position.x + 10n }, height: 4, game: GAME, plane: S().plane,
      C: { ...S().position, x: S().position.x + 10n },
    })
    const signed = finalizeEvent({ kind: template.kind, created_at: template.created_at, content: '', tags: template.tags }, sk) as NostrEvent
    usePresence.getState().ingest(signed)
    const person = Object.values(usePresence.getState().people)[0]
    expect(person.position).toEqual(near)
    expect(person.type).toBe('enter-virtual')
  })

  it('a game played here by someone whose position is far away does not put them here', () => {
    usePresence.setState({ people: {}, sector: null, loading: false })
    const sk = generateSecretKey()
    const far = { x: S().position.x ^ (1n << 80n), y: S().position.y, z: S().position.z }
    const template = enterVirtualEvent({
      pubkey: '00'.repeat(32), createdAt: 5_000, genesisId: 'aa'.repeat(32), previousId: 'bb'.repeat(32),
      c: positionHex(far, S().plane), inGame: { ...S().position, x: S().position.x + 10n }, height: 4, game: GAME, plane: S().plane,
      // An entry from before the 2026-10-07 refinement, whose C named its
      // place in the game, here, and whose sector tags therefore say here.
      C: { ...S().position, x: S().position.x + 10n },
    })
    const signed = finalizeEvent({ kind: template.kind, created_at: template.created_at, content: '', tags: template.tags }, sk) as NostrEvent
    usePresence.getState().ingest(signed)
    expect(Object.keys(usePresence.getState().people)).toHaveLength(0)
  })
})

/** A finished hop proof from the current head to one gibson over, as the worker reports it. */
function doneFromHead(over: Partial<Extract<ProofResponse, { type: 'done' }>> = {}): Extract<ProofResponse, { type: 'done' }> {
  return {
    type: 'done', id: 0, mode: 'hop', elapsedMs: 1, proofHash: 'ab'.repeat(32), terrainK: 8,
    lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: S().prevEventId, ...over,
  }
}

/** Another device's hop from the current head. */
function theirHop(): NostrEvent {
  const s = S()
  return actionEvent({
    pubkey: s.identity.pubkey, createdAt: s.events[s.events.length - 1].created_at + 1, genesisId: s.genesisId,
    previousId: s.prevEventId, name: 'hop', c: s.coordHex(), C: { ...s.position, y: s.position.y + 1n }, plane: s.plane,
    tags: [['proof', '0'.repeat(64)]],
  })
}

const computing = (): void => {
  useCyberspace.setState({ pendingTarget: { ...S().position, x: S().position.x + 1n }, proof: { ...S().proof, status: 'computing' } })
}

describe('a finished proof is signed only onto the chain it was computed for (review of #224, B1 and S1)', () => {
  it('B1: RESUME after a declined signature, with a game entered meanwhile, signs nothing', async () => {
    const msg = doneFromHead()
    const plan = {
      target: { ...S().position, x: S().position.x + 5n }, ceilings: {}, summary: {}, done: 0,
      step: { kind: 'hop', from: S().position, to: { ...S().position, x: S().position.x + 1n }, source: 'local' },
      status: 'paused', message: 'Signature declined: no', awaiting: msg, startedAt: 0,
    } as unknown as MovePlan
    useCyberspace.setState({ plan })
    const { enter } = enterGame()
    S().adoptChain([enter])
    const count = S().events.length
    S().resumePlan()
    await vi.waitFor(() => expect(S().plan?.status).toBe('failed'))
    expect(S().plan?.message).toBe(GAME_HOLDS_MESSAGE)
    expect(S().events).toHaveLength(count)
    expect(S().prevEventId).toBe(enter.id)
  })

  it('S1: a game entry delivered while the proof computes stops it at once, is folded, and the hop is refused (arkinox, 2026-10-08)', async () => {
    computing()
    const before = S().prevEventId
    const { enter } = enterGame()
    S().adoptChain([enter])
    // The live feed is the early warning: the proof stops now, not at its end.
    expect(S().prevEventId).toBe(enter.id)
    expect(S().proof).toMatchObject({ status: 'infeasible', message: GAME_HOLDS_MESSAGE })
    // A finish already on its way signs nothing.
    await S().applyProofMessage(doneFromHead({ prevEventId: before }))
    expect(S().events[S().events.length - 1].id).toBe(enter.id)
  })

  it('S1: a long proof looks at the relays before signing, and finds an entry the live feed never delivered', async () => {
    computing()
    const { enter } = enterGame()
    relayHolds = [enter]
    await S().applyProofMessage(doneFromHead({ elapsedMs: 60_000 }))
    expect(S().proof).toMatchObject({ status: 'infeasible', message: GAME_HOLDS_MESSAGE })
    expect(S().events[S().events.length - 1].id).toBe(enter.id)
  })

  it('a head that moved under the proof is not signed onto: the proof was seeded by the old head', async () => {
    computing()
    const before = S().prevEventId
    const theirs = theirHop()
    S().adoptChain([theirs])
    await S().applyProofMessage(doneFromHead({ prevEventId: before }))
    expect(S().prevEventId).toBe(theirs.id)
    expect(S().proof.status).toBe('infeasible')
    expect(S().proof.message).toMatch(/^Your chain moved while this proof waited to be signed/)
    expect(S().events[S().events.length - 1].id).toBe(theirs.id)
  })

  it('another device\'s move delivered while computing is folded at once and stops the proof; an echo of what this device holds is only held', () => {
    computing()
    const echo = S().events[S().events.length - 1]
    S().adoptChain([echo])
    expect(S().proof.status).toBe('computing')
    const theirs = theirHop()
    S().adoptChain([theirs])
    expect(S().prevEventId).toBe(theirs.id)
    expect(S().proof.status).toBe('infeasible')
    expect(S().proof.message).toMatch(/^Your chain moved while this proof waited to be signed/)
  })

  it('an event delivered while a remote signer thinks is folded before the signed event joins: it is discarded, not published', async () => {
    computing()
    const before = S().prevEventId
    const theirs = theirHop()
    const realSign = S().signEvent
    useCyberspace.setState({ signEvent: async (t) => { S().adoptChain([theirs]); return realSign(t) } })
    try {
      await S().applyProofMessage(doneFromHead({ prevEventId: before }))
    } finally {
      useCyberspace.setState({ signEvent: realSign })
    }
    expect(S().events[S().events.length - 1].id).toBe(theirs.id)
    expect(S().proof.message).toMatch(/^Your chain moved while this proof waited to be signed/)
  })

  it('every signing looks at the relays, even a short local proof after a stale one was resumed and dropped (arkinox, 2026-10-08)', async () => {
    const stale = doneFromHead({ id: 999 })
    const plan = {
      target: S().position, ceilings: {}, summary: {}, done: 0,
      step: { kind: 'hop', from: S().position, to: S().position, source: 'local' },
      status: 'paused', message: null, awaiting: stale, startedAt: 0,
    } as unknown as MovePlan
    useCyberspace.setState({ plan })
    S().resumePlan()
    await new Promise((r) => setTimeout(r, 0))
    useCyberspace.setState({ plan: null })
    // No confirmation is reused: a game entry the relays hold but the live
    // feed never delivered is found before signing, and nothing is signed.
    const { enter } = enterGame()
    relayHolds = [enter]
    computing()
    await S().applyProofMessage(doneFromHead())
    const last = S().events[S().events.length - 1]
    expect(last.id).toBe(enter.id)
    expect(S().proof).toMatchObject({ status: 'infeasible', message: GAME_HOLDS_MESSAGE })
  })

  it('an event the live feed delivers while the fresh look is out is folded before signing', async () => {
    computing()
    const before = S().prevEventId
    const { enter } = enterGame()
    duringLook = () => S().adoptChain([enter])
    // Folded before signing, so the signer is never asked for a hop that
    // would only be thrown away (a pointless prompt on a remote signer).
    const realSign = S().signEvent
    let asked = 0
    useCyberspace.setState({ signEvent: async (t) => { asked++; return realSign(t) } })
    try {
      await S().applyProofMessage(doneFromHead({ prevEventId: before, elapsedMs: 60_000 }))
    } finally {
      useCyberspace.setState({ signEvent: realSign })
    }
    expect(asked).toBe(0)
    expect(S().proof).toMatchObject({ status: 'infeasible', message: GAME_HOLDS_MESSAGE })
    expect(S().events[S().events.length - 1].id).toBe(enter.id)
  })

  it('an unchanged head still signs as before', async () => {
    computing()
    const before = S().prevEventId
    await S().applyProofMessage(doneFromHead())
    const hop = S().events[S().events.length - 1]
    expect(tagOf(hop, 'e', 'previous')).toBe(before)
  })
})

describe('whyNoMove: the one question every move asks', () => {
  it('a game holds the avatar: refused; a broken chain: refused, since the 2026-10-07 ruling', () => {
    const { enter } = enterGame()
    expect(whyNoMove(S().actions())).toBeNull()
    const stray = actionEvent({
      pubkey: S().identity.pubkey, createdAt: S().events[S().events.length - 1].created_at + 1, genesisId: S().genesisId,
      previousId: S().prevEventId, name: 'hop', c: positionHex(arena, S().plane), C: arena, plane: S().plane, tags: [['proof', '0'.repeat(64)]],
    })
    S().adoptChain([stray])
    expect(S().actions()[S().actions().length - 1].breaks).toBeDefined()
    expect(REFUSE_MOVES_ON_BROKEN_CHAIN).toBe(true)
    expect(whyNoMove(S().actions())).toBe(BROKEN_CHAIN_MESSAGE)
    useCyberspace.setState({ ...fresh, events: [...fresh.events] })
    S().adoptChain([enter])
    expect(whyNoMove(S().actions())).toBe(GAME_HOLDS_MESSAGE)
  })
})
