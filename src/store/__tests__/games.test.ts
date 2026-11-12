/**
 * games.test.ts - entering a game, playing it and leaving it (DECK-0002;
 * spec §8.11), on your own chain, with the tutorial dungeon (DEV fixture).
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

/**
 * Every world read the store starts, until it settles. Each test starts from
 * the same chain within the same second, so every entry here has the same
 * event id, and a read one test left running would land in the next test's
 * session as if it were its own (useGame readWorld matches by entry id).
 * beforeEach waits them all out, and a test waits on them, not on the clock.
 */
const reading = vi.hoisted(() => new Set<Promise<unknown>>())
vi.mock('../../lib/games/world', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/games/world')>()
  return {
    ...mod,
    loadWorld: (game: Parameters<typeof mod.loadWorld>[0]) => {
      const read = mod.loadWorld(game)
      reading.add(read)
      read.then(() => reading.delete(read), () => reading.delete(read))
      return read
    },
  }
})

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
import { GAME_CHOOSE_FIRST_MESSAGE, GAME_OTHER_BRACKET_MESSAGE, GAME_NEEDS_CHAIN_MESSAGE, GAME_NOT_OPEN_MESSAGE, IN_GAME_HERE_MESSAGE, GAME_HOLDS_MESSAGE, useCyberspace, whyNoMove } from '../useCyberspace'
import { placeSpawn } from '../fixtures/placeSpawn'
import { GAMES_OFF_MESSAGE, GAME_ALREADY_MESSAGE, enterTutorialDungeon, recordedPosition, useGame } from '../useGame'
import { TUTORIAL_ENTRY, TUTORIAL_GAME } from '../../lib/games/tutorialGame'
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

/** Wait for every world read in flight to settle, and so to have landed in its session (the fixture is a dynamic import). */
async function worldLoaded(): Promise<void> {
  while (reading.size > 0) await Promise.allSettled([...reading])
}

/** Wait for the game to stop being busy (a teleport being signed). */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (!G().busy) { resolve(); return }
    const stop = useGame.subscribe((st) => { if (!st.busy) { stop(); resolve() } })
  })
}

let fresh: Pick<ReturnType<typeof S>, 'events' | 'prevEventId' | 'genesisId' | 'published' | 'position' | 'plane' | 'headPlane' | 'positionHistory' | 'chain'> | null = null

beforeEach(async () => {
  // Nothing an earlier test began, a world read or a teleport being signed, may land in this one.
  await worldLoaded()
  await idle()
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
    const tp = await S().signGameAction(TUTORIAL_GAME, entry.id, (links) => teleportTemplate({ ...links, toHex: positionHex(TUTORIAL_ENTRY, 1) }))
    expect('event' in tp).toBe(true)
    expect(S().actions().slice(-1)[0].role).toBe('virtual')
    expect(whyNoMove(S().actions())).toBe(IN_GAME_HERE_MESSAGE)
    const out = await S().exitGame(entry.id, positionHex(TUTORIAL_ENTRY, 1))
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
    expect(await S().signGameAction(TUTORIAL_GAME, 'ab'.repeat(32), (l) => teleportTemplate({ ...l, toHex: positionHex(TUTORIAL_ENTRY, 1) }))).toEqual({ refused: GAME_NOT_OPEN_MESSAGE })
    useCyberspace.setState({ events: [], genesisId: '', prevEventId: '' })
    expect(await S().enterGame(TUTORIAL_GAME)).toEqual({ refused: GAME_NEEDS_CHAIN_MESSAGE })
  })

  it('a game ONOSENDAI never played reads as held by another client, as before', async () => {
    await S().enterGame({ ...TUTORIAL_GAME, pubkey: 'ef'.repeat(32) })
    expect(whyNoMove(S().actions())).toBe(GAME_HOLDS_MESSAGE)
  })
})

describe('in-game mode (useGame)', () => {
  it('is refused with games off', async () => {
    localStorage.removeItem('onosendai:games')
    expect(await enterTutorialDungeon()).toBe(GAMES_OFF_MESSAGE)
    expect(G().session).toBeNull()
  })

  it('ENTER signs only the entry; you appear at the entry point the world marks, by virtue of entering (DECK-0002 §2.2)', async () => {
    const count = S().events.length
    const here = S().coordHex()
    expect(await enterTutorialDungeon()).toBeNull()
    // One event: the entry. No arrival is published.
    expect(S().events.length).toBe(count + 1)
    expect(tagOf(last(), 'A')?.[1]).toBe('enter-virtual')
    expect(G().session!.at).toBeNull()
    await worldLoaded()
    expect(G().session!.at).toEqual(TUTORIAL_ENTRY)
    // Fifteen items: the entry marker, the arrival, the climb, the gate's two looks, the way out.
    expect(G().session!.world).toHaveLength(15)
    expect(S().events.length).toBe(count + 1)
    // The base position stays where you entered from.
    expect(S().coordHex()).toBe(here)
    expect(firstBreak(S().actions())).toBeNull()
  })

  it('walls hold; the hall leads to the pad, which teleports you to the climb and signs it', async () => {
    await enterTutorialDungeon()
    await worldLoaded()
    const start = TUTORIAL_ENTRY
    // The arrival hall's far end is sealed behind the entry point, its plug's face at 47.5 from the base. A player at
    // 47 is drawn at 47.5, the gibson's centre; a step to 48 would end on the face itself, which meets it (walkWalls stepLimit).
    for (let i = 0; i < 10; i++) G().step('z', 1)
    expect(G().session!.at!.z).toBe(TUTORIAL_GAME.region.base.z + 47n)
    for (let i = 0; i < 2; i++) G().step('z', -1)
    expect(G().session!.at!.z).toBe(start.z)
    // The hall's wall two and a half gibsons to the side.
    for (let i = 0; i < 4; i++) G().step('x', 1)
    expect(G().session!.at!.x).toBe(start.x + 2n)
    G().step('x', -1)
    G().step('x', -1)
    const count = S().events.length
    // Down the hall into the shrine, up the pad's riser of 1 (the stair rule), and the pad sends you on.
    let steps = 0
    for (; steps < 30 && !G().busy; steps++) G().step('z', -1)
    expect(steps).toBe(20)
    expect(G().busy).toBe('teleporting')
    await idle()
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

  it('resume after a reload: back at the entry point when nothing is on the record, signing nothing', async () => {
    await enterTutorialDungeon()
    useGame.setState({ session: null })
    const count = S().events.length
    expect(G().resume()).toBe(true)
    await worldLoaded()
    // Nothing on the record yet: back at the entry point.
    expect(G().session!.at).toEqual(TUTORIAL_ENTRY)
    expect(S().events.length).toBe(count)
    const chain = S().actions()
    const entry = chain.find((a) => a.role === 'enter')!
    expect(recordedPosition(chain, entry, TUTORIAL_GAME)).toBeNull()
  })

  it('a bracket closed elsewhere ends in-game mode', async () => {
    await enterTutorialDungeon()
    await S().exitGame()
    expect(G().session).toBeNull()
  })

  it('a second ENTER while one is open is refused in words, not reported as success', async () => {
    await enterTutorialDungeon()
    expect(await enterTutorialDungeon()).toBe(GAME_ALREADY_MESSAGE)
  })

  it('with the switch turned off on this device, a game ONOSENDAI played can still be left (never stranded)', async () => {
    await enterTutorialDungeon()
    useGame.setState({ session: null })
    localStorage.removeItem('onosendai:games')
    expect(G().resume()).toBe(false)
    expect(whyNoMove(S().actions())).toBe(IN_GAME_HERE_MESSAGE)
    expect(await G().exit()).toBeNull()
    expect(tagOf(last(), 'A')?.[1]).toBe('exit-virtual')
    expect(whyNoMove(S().actions())).toBeNull()
  })

  it('a world that could not be read moves nobody: no walls are known', async () => {
    await enterTutorialDungeon()
    await worldLoaded()
    useGame.setState({ session: { ...G().session!, worldError: 'unreadable' } })
    const at = G().session!.at
    G().step('z', -1)
    expect(G().session!.at).toEqual(at)
  })
})

describe('the tutorial dungeon: gravity, the key door and the clock (useGame)', () => {
  const B = TUTORIAL_GAME.region.base
  const at = (x: number, y: number, z: number) => ({ x: B.x + BigInt(x), y: B.y + BigInt(y), z: B.z + BigInt(z) })
  const put = (p: ReturnType<typeof at>) => useGame.setState({ session: { ...G().session!, at: p, arc: null, doubled: false } })

  it('under gravity UP and DOWN do nothing; JUMP rises, the tick carries the fall, and you land where you left', async () => {
    await enterTutorialDungeon()
    await worldLoaded()
    const start = G().session!.at!
    G().step('y', 1)
    G().step('y', -1)
    expect(G().session!.at).toEqual(start)
    G().jump(1000)
    expect(G().session!.arc).not.toBeNull()
    G().tick(1200)
    expect(G().session!.at!.y).toBeGreaterThan(start.y)
    G().tick(3000)
    expect(G().session!.arc).toBeNull()
    expect(G().session!.at).toEqual(start)
    // Nothing of it was signed.
    const count = S().events.length
    G().jump(4000); G().tick(4200); G().tick(6000)
    expect(S().events.length).toBe(count)
  })

  it('the key is taken only by TAKE within reach, and the gate opens only by OPEN with it', async () => {
    await enterTutorialDungeon()
    await worldLoaded()
    // At the gate without the key: nothing opens.
    put(at(40, 17, 33))
    G().open()
    expect(G().session!.progress.doorOpen).toBe(false)
    G().step('z', -1)
    expect(G().session!.at).toEqual(at(40, 17, 33))
    // Standing by the key does not take it; TAKE does.
    put(at(37, 27, 42))
    G().tick()
    expect(G().session!.progress.keyHeld).toBe(false)
    G().take()
    expect(G().session!.progress.keyHeld).toBe(true)
    // TAKE away from the key, or twice, changes nothing more.
    G().take()
    expect(G().session!.progress).toMatchObject({ keyHeld: true, doorOpen: false })
    // OPEN at the gate with the key: it opens, the key is used, and the way through is clear.
    put(at(40, 17, 33))
    G().open()
    expect(G().session!.progress).toMatchObject({ keyHeld: false, doorOpen: true })
    G().step('z', -1)
    expect(G().session!.at).toEqual(at(40, 17, 32))
  })

  it('the clock starts at the entry, stops at the exit zone, and is kept on this device until you leave', async () => {
    const t0 = Date.now()
    await enterTutorialDungeon()
    await worldLoaded()
    const s = G().session!
    expect(s.progress.startedAt).toBeGreaterThanOrEqual(t0)
    expect(s.progress.clearedMs).toBeNull()
    // The way out is open and the player is one press from the finish tile.
    useGame.setState({ session: { ...s, progress: { ...s.progress, doorOpen: true } } })
    put(at(40, 17, 11))
    G().step('z', -1)
    const cleared = G().session!.progress.clearedMs
    expect(cleared).not.toBeNull()
    expect(cleared!).toBeGreaterThanOrEqual(0)
    // Cleared: no more moves, and the time stands.
    const where = G().session!.at
    G().step('z', -1)
    expect(G().session!.at).toEqual(where)
    // A reload keeps it: the same progress comes back on resume.
    const entryId = s.entryId
    expect(JSON.parse(localStorage.getItem(`onosendai:game:${entryId}`)!).clearedMs).toBe(cleared)
    useGame.setState({ session: null })
    expect(G().resume()).toBe(true)
    expect(G().session!.progress.clearedMs).toBe(cleared)
    // Leaving forgets it.
    expect(await G().exit()).toBeNull()
    expect(localStorage.getItem(`onosendai:game:${entryId}`)).toBeNull()
  })

  it('resume on a device that never saw the entry starts the clock from the entry itself', async () => {
    await enterTutorialDungeon()
    const entryId = G().session!.entryId
    localStorage.removeItem(`onosendai:game:${entryId}`)
    useGame.setState({ session: null })
    expect(G().resume()).toBe(true)
    const entry = S().actions().find((a) => a.id === entryId)!
    expect(G().session!.progress.startedAt).toBe(entry.createdAt * 1000)
  })
})

describe('what the review of #660 found untested', () => {
  it('a hop is refused inside a game through the real proof path, and signs nothing', async () => {
    await S().enterGame(TUTORIAL_GAME)
    const count = S().events.length
    await land(1n)
    expect(S().events.length).toBe(count)
    expect(S().proof.message).toBe(IN_GAME_HERE_MESSAGE)
  })

  it('a choice waiting between two versions of the chain comes first', async () => {
    useCyberspace.setState({ chainConflict: { relayEvents: [] } as never })
    expect(await S().enterGame(TUTORIAL_GAME)).toEqual({ refused: GAME_CHOOSE_FIRST_MESSAGE })
    useCyberspace.setState({ chainConflict: null })
  })

  it('an exit or game action for a bracket that is no longer the open one is refused', async () => {
    await S().enterGame(TUTORIAL_GAME)
    const first = last().id
    await S().exitGame(first)
    await S().enterGame(TUTORIAL_GAME)
    const second = last().id
    const count = S().events.length
    expect(await S().exitGame(first)).toEqual({ refused: GAME_OTHER_BRACKET_MESSAGE })
    expect(await S().signGameAction(TUTORIAL_GAME, first, (l) => teleportTemplate({ ...l, toHex: positionHex(TUTORIAL_ENTRY, 1) }))).toEqual({ refused: GAME_OTHER_BRACKET_MESSAGE })
    expect(S().events.length).toBe(count)
    expect('event' in await S().exitGame(second)).toBe(true)
  })

  it('resume goes to the last game position on the record before the entry point (DECK-0002 §7)', async () => {
    await enterTutorialDungeon()
    await worldLoaded()
    for (let i = 0; i < 30 && !G().busy; i++) G().step('z', -1)
    await idle()
    expect(G().session!.at).toEqual(TUTORIAL_GAME.pads[0].to)
    useGame.setState({ session: null })
    expect(G().resume()).toBe(true)
    await worldLoaded()
    expect(G().session!.at).toEqual(TUTORIAL_GAME.pads[0].to)
  })

  it('a world that fails to load: nobody moves, LEAVING still works, and the exit is valid', async () => {
    const broken = { ...TUTORIAL_GAME, world: { kind: 'fixture' as const, load: async () => { throw new Error('relay down') } } }
    expect(await G().enter(broken)).toBeNull()
    await worldLoaded()
    expect(G().session!.worldError).toBe('relay down')
    expect(G().session!.at).toBeNull()
    G().step('z', -1)
    expect(G().session!.at).toBeNull()
    expect(await G().exit()).toBeNull()
    expect(tagOf(last(), 'A')?.[1]).toBe('exit-virtual')
    expect(firstBreak(S().actions())).toBeNull()
  })
})
