/**
 * games.test.ts - entering a game, playing it and leaving it (DECK-0002;
 * spec §8.11), on your own chain, with the tutorial dungeon's placeholder.
 *
 * What would go wrong silently: an entry whose `c` is not where the chain
 * stood, or whose `C` moves you (the chain is invalid from it); a game action
 * named like a base action (invalid, rule 3); an exit that names the wrong
 * entry or does not restore the entry's `c`; a hop after the exit that does
 * not start from the restored position; a view that does not come back as it
 * was; a pad that does not teleport, or walls that do not hold. lib/relay is
 * the offline relay: nothing here is sent anywhere.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { provedHop } from '../fixtures/provedHop'

vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: async () => [],
  confirmChainEvents: async () => [],
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

import { firstBreak, type NostrEvent } from '../../lib/events'
import { GAME_NEEDS_CHAIN_MESSAGE, GAME_NOT_OPEN_MESSAGE, IN_GAME_HERE_MESSAGE, GAME_HOLDS_MESSAGE, useCyberspace, whyNoMove } from '../useCyberspace'
import { placeSpawn } from '../fixtures/placeSpawn'
import { GAMES_OFF_MESSAGE, enterTutorialDungeon, recordedPosition, useGame } from '../useGame'
import { TUTORIAL_GAME } from '../../lib/games/tutorialGame'
import { teleportTemplate } from '../../lib/games/bracket'
import { positionHex } from '../../lib/events'

const S = () => useCyberspace.getState()
const G = () => useGame.getState()
const tagOf = (ev: NostrEvent, name: string, marker?: string): string[] | undefined =>
  ev.tags.find((t) => t[0] === name && (marker === undefined || t[3] === marker))
const last = (): NostrEvent => S().events[S().events.length - 1]

async function land(dx: bigint): Promise<void> {
  const s = S()
  useCyberspace.setState({ pendingTarget: { ...s.position, x: s.position.x + dx } })
  await s.applyProofMessage({
    type: 'done', id: 0, mode: 'hop', elapsedMs: 1, ...provedHop(S()),
    terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1,
  })
}

/** Wait for the world to load (the fixture is a dynamic import). */
async function worldLoaded(): Promise<void> {
  for (let i = 0; i < 200 && G().session && G().session!.world === null; i++) await new Promise((r) => setTimeout(r, 10))
}

let fresh: Pick<ReturnType<typeof S>, 'events' | 'prevEventId' | 'genesisId' | 'published' | 'position' | 'plane' | 'headPlane' | 'positionHistory' | 'chain'> | null = null

beforeEach(async () => {
  localStorage.setItem('onosendai:games', '1')
  if (!fresh) {
    await placeSpawn()
    await land(1n)
    fresh = {
      events: [...S().events], prevEventId: S().prevEventId, genesisId: S().genesisId,
      published: { ...S().published }, position: S().position, plane: S().plane, headPlane: S().headPlane,
      positionHistory: [...S().positionHistory], chain: S().chain,
    }
  }
  localStorage.removeItem(`onosendai:chain:${S().identity.pubkey}`)
  useGame.setState({ session: null, busy: null, message: null })
  useCyberspace.setState({
    ...fresh, events: [...fresh.events], published: { ...fresh.published }, positionHistory: [...fresh.positionHistory],
    cursor: fresh.position, pendingTarget: null, forkNotice: null, chainConflict: null, plan: null,
    exploreIndex: null, spectate: null, focus: null, transit: null, walking: false,
    proof: { ...S().proof, status: 'idle', message: null },
  })
})

describe('entering, playing and leaving (store, DECK-0002 §2, §4, §7)', () => {
  it('enter-virtual holds you where you stand and names the game and its region', async () => {
    const here = S().coordHex()
    const position = S().position
    const r = await S().enterGame(TUTORIAL_GAME)
    expect('event' in r).toBe(true)
    const ev = last()
    expect(tagOf(ev, 'A')?.[1]).toBe('enter-virtual')
    expect(tagOf(ev, 'c')?.[1]).toBe(here)
    expect(tagOf(ev, 'C')?.[1]).toBe(here)
    expect(tagOf(ev, 'p', 'game')).toEqual(['p', TUTORIAL_GAME.pubkey, '', 'game'])
    expect(tagOf(ev, 'region')).toEqual(['region', positionHex(TUTORIAL_GAME.region.base, 1), '6'])
    expect(tagOf(ev, 'e', 'previous')?.[1]).toBe(S().events[S().events.length - 2].id)
    const chain = S().actions()
    expect(chain[chain.length - 1].role).toBe('enter')
    expect(firstBreak(chain)).toBeNull()
    expect(S().position).toEqual(position)
    expect(S().published[ev.id]).toBe('queued')
  })

  it('a game action, then the exit: every event valid, the exit back at the entry c, and a hop after it from there', async () => {
    const here = S().coordHex()
    await S().enterGame(TUTORIAL_GAME)
    const entry = last()
    const tp = await S().signGameAction(TUTORIAL_GAME, (links) => teleportTemplate({ ...links, toHex: positionHex(TUTORIAL_GAME.start, 1) }))
    expect('event' in tp).toBe(true)
    expect(S().actions().slice(-1)[0].role).toBe('virtual')
    expect(whyNoMove(S().actions())).toBe(IN_GAME_HERE_MESSAGE)
    const out = await S().exitGame(positionHex(TUTORIAL_GAME.start, 1))
    expect('event' in out).toBe(true)
    const exit = last()
    expect(tagOf(exit, 'A')?.[1]).toBe('exit-virtual')
    expect(tagOf(exit, 'e', 'entry')?.[1]).toBe(entry.id)
    expect(tagOf(exit, 'C')?.[1]).toBe(here)
    expect(S().actions().slice(-3).map((a) => a.role)).toEqual(['enter', 'virtual', 'exit'])
    expect(firstBreak(S().actions())).toBeNull()
    expect(whyNoMove(S().actions())).toBeNull()
    await land(1n)
    const hop = last()
    expect(tagOf(hop, 'A')?.[1]).toBe('hop')
    expect(tagOf(hop, 'c')?.[1]).toBe(here)
    expect(tagOf(hop, 'e', 'previous')?.[1]).toBe(exit.id)
    expect(firstBreak(S().actions())).toBeNull()
  })

  it('refuses a second entry (brackets never nest), an exit with no game open, and an entry before the first move', async () => {
    await S().enterGame(TUTORIAL_GAME)
    const count = S().events.length
    const again = await S().enterGame(TUTORIAL_GAME)
    expect(again).toEqual({ refused: IN_GAME_HERE_MESSAGE })
    expect(S().events.length).toBe(count)
    await S().exitGame()
    expect(await S().exitGame()).toEqual({ refused: GAME_NOT_OPEN_MESSAGE })
    expect(await S().signGameAction(TUTORIAL_GAME, (l) => teleportTemplate({ ...l, toHex: positionHex(TUTORIAL_GAME.start, 1) }))).toEqual({ refused: GAME_NOT_OPEN_MESSAGE })
    useCyberspace.setState({ events: [], genesisId: '', prevEventId: '' })
    expect(await S().enterGame(TUTORIAL_GAME)).toEqual({ refused: GAME_NEEDS_CHAIN_MESSAGE })
  })

  it('with games off, the game is not this client\'s: a chain inside it reads as held by another client', async () => {
    await S().enterGame(TUTORIAL_GAME)
    localStorage.removeItem('onosendai:games')
    expect(whyNoMove(S().actions())).toBe(GAME_HOLDS_MESSAGE)
  })
})

describe('in-game mode (useGame)', () => {
  it('is refused with games off', async () => {
    localStorage.removeItem('onosendai:games')
    expect(await enterTutorialDungeon()).toBe(GAMES_OFF_MESSAGE)
    expect(G().session).toBeNull()
  })

  it('ENTER signs the entry and the arrival, at the start, and loads the world from the fixture', async () => {
    expect(await enterTutorialDungeon()).toBeNull()
    const s = G().session!
    expect(s.at).toEqual(TUTORIAL_GAME.start)
    const arrival = last()
    expect(tagOf(arrival, 'A')?.[1]).toBe('teleport')
    expect(tagOf(arrival, 'C')?.[1]).toBe(positionHex(TUTORIAL_GAME.start, 1))
    expect(tagOf(arrival, 'c')).toBeUndefined()
    await worldLoaded()
    // Two chambers of three tiles and two pads.
    expect(G().session!.world).toHaveLength(5)
    expect(firstBreak(S().actions())).toBeNull()
  })

  it('walls hold; the hall leads to the pad, which teleports you to the other chamber and signs it', async () => {
    await enterTutorialDungeon()
    await worldLoaded()
    const start = TUTORIAL_GAME.start
    // The hall's far end is sealed behind the start, its plug at 32.5 from the base: the last gibson short of it is 31.
    for (let i = 0; i < 10; i++) G().step('z', 1)
    expect(G().session!.at.z).toBe(TUTORIAL_GAME.region.base.z + 31n)
    for (let i = 0; i < 5; i++) G().step('z', -1)
    expect(G().session!.at.z).toBe(start.z)
    // The hall's wall two and a half gibsons to the side.
    for (let i = 0; i < 4; i++) G().step('x', 1)
    expect(G().session!.at.x).toBe(start.x + 2n)
    G().step('x', -1)
    G().step('x', -1)
    const count = S().events.length
    // Down the hall into the dead end, onto the pad by its shrine.
    let steps = 0
    for (; steps < 30 && !G().busy; steps++) G().step('z', -1)
    expect(steps).toBe(17)
    expect(G().busy).toBe('teleporting')
    for (let i = 0; i < 200 && G().busy; i++) await new Promise((r) => setTimeout(r, 5))
    expect(G().session!.at).toEqual(TUTORIAL_GAME.pads[0].to)
    expect(S().events.length).toBe(count + 1)
    const tp = last()
    expect(tagOf(tp, 'A')?.[1]).toBe('teleport')
    expect(tagOf(tp, 'C')?.[1]).toBe(positionHex(TUTORIAL_GAME.pads[0].to, 1))
    expect(tagOf(tp, 'c')).toBeDefined()
    expect(firstBreak(S().actions())).toBeNull()
  })

  it('EXIT signs the exit and puts the view back exactly as it was', async () => {
    const view = S().view
    useCyberspace.setState({ scaleExp: 3 })
    const before = { view, scaleExp: 3, cursor: S().cursor, anchor: S().anchor, walking: S().walking }
    await enterTutorialDungeon()
    // Anything that touches the view meanwhile is undone.
    useCyberspace.setState({ scaleExp: 9, anchor: { x: 1n, y: 2n, z: 3n } })
    expect(await G().exit()).toBeNull()
    expect(G().session).toBeNull()
    expect(tagOf(last(), 'A')?.[1]).toBe('exit-virtual')
    expect({ view: S().view, scaleExp: S().scaleExp, cursor: S().cursor, anchor: S().anchor, walking: S().walking }).toEqual(before)
    expect(whyNoMove(S().actions())).toBeNull()
  })

  it('resume after a reload: back at the last game position on the record, signing nothing', async () => {
    await enterTutorialDungeon()
    useGame.setState({ session: null })
    const count = S().events.length
    expect(G().resume()).toBe(true)
    expect(G().session!.at).toEqual(TUTORIAL_GAME.start)
    expect(S().events.length).toBe(count)
    const chain = S().actions()
    const entry = chain.find((a) => a.role === 'enter')!
    expect(recordedPosition(chain, entry, TUTORIAL_GAME)).toEqual(TUTORIAL_GAME.start)
  })

  it('a bracket closed elsewhere ends in-game mode', async () => {
    await enterTutorialDungeon()
    await S().exitGame()
    expect(G().session).toBeNull()
  })
})
