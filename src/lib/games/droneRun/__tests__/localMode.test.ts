/**
 * localMode.test.ts - DRONE RUN on your own chain, in LOCAL (store/useGame,
 * store/useCyberspace): what it signs, what it never sends, and what it keeps.
 *
 * - LIVE: refused before anything is signed ("This test game plays in LOCAL
 *   only."), so no entry naming the DEV key is ever published; the GAMES
 *   panel greys ENTER out with the same words.
 * - LOCAL, a fresh identity with no chain: ENTER signs the spawn, then the
 *   enter-virtual, and nothing else; the world loads from the fixture and the
 *   session holds its shards and its entry point, inside the start zone.
 * - None of the dungeon's logic runs inside the bracket: steps, jumps, the
 *   fall, TAKE and OPEN change nothing, and no progress is kept on the device.
 * - EXIT signs exit-virtual with no free `c`, and the publisher (started, as
 *   the app starts it) sends nothing to any relay.
 * - After a reload, resume goes back in, signing nothing, at the entry point.
 * - With a level imported on this device and chosen, ENTER signs the same
 *   entry (same game key, same region), but the session's shards, entry
 *   point and Level come from the imported level, read from IndexedDB, not
 *   from the fixture; a chosen level that is gone plays the built-in field.
 *
 * lib/relay is the offline relay, its publishing calls counted here; the
 * relays' chain checks answer at once with nothing.
 */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../../relay', async (orig) => {
  const offline = (await import('../../../../test/offlineRelay')).offlineRelay
  const count = <A extends unknown[], R>(f: (...a: A) => R) => (...a: A): R => { sent.count++; return f(...a) }
  return {
    ...(await orig<typeof import('../../../relay')>()),
    ...offline,
    publish: count(offline.publish),
    publishMany: count(offline.publishMany),
    publishOnceTo: count(offline.publishOnceTo),
    publishLight: count(offline.publishLight),
  }
})
/** Whether the relays answer the chain checks: false is no relay in reach at all. */
const relays = vi.hoisted(() => ({ answer: true }))
vi.mock('../../../chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../chains')>()),
  fetchChainEvents: async () => [],
  confirmChainEvents: async () => (relays.answer ? [] : null),
}))

const reading = vi.hoisted(() => new Set<Promise<unknown>>())
vi.mock('../../world', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../world')>()
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
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  }
}

import type { NostrEvent } from '../../../events'
import { GAME_NEEDS_CHAIN_MESSAGE, useCyberspace } from '../../../../store/useCyberspace'
import { LOCAL_ONLY_MESSAGE, enterBlockedFor, useGame } from '../../../../store/useGame'
import { whyNoEnterFor, panelGames } from '../../../../hud/GamesPanel'
import { startPublisher } from '../../../publisher'
import { TUTORIAL_GAME } from '../../tutorialGame'
import { implementedGames } from '../../registry'
import { DRONE_RUN_GAME, DRONE_RUN_DEV_PUBKEY } from '../game'
import { insideBox, type Level, type Local } from '../level/level'
import { placeholderField } from '../level/placeholderField'
import { chooseLevel, chosenLevel } from '../levelChoice'
import { deleteLevel, openLevelsDb, putLevel } from '../levelDb'

const S = () => useCyberspace.getState()
const G = () => useGame.getState()
const level = placeholderField().level
const tag = (e: NostrEvent, name: string): string[] | undefined => e.tags.find((t) => t[0] === name)
const last = (): NostrEvent => S().events[S().events.length - 1]
const local = (p: { x: bigint; y: bigint; z: bigint }): Local => {
  const b = DRONE_RUN_GAME.region.base
  return [Number(p.x - b.x), Number(p.y - b.y), Number(p.z - b.z)]
}
async function worldLoaded(): Promise<void> {
  // DRONE RUN reads its world through a module loaded on first use (levelSource): wait for the session to hold it.
  await vi.waitFor(() => { const s = G().session; if (s && s.world === null) throw new Error('loading') })
  while (reading.size > 0) await Promise.allSettled([...reading])
}
/** Every key the store wrote for the game's progress (useGame saveProgress). */
const progressKeys = (): string[] => {
  const out: string[] = []
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('onosendai:game:')) out.push(k) }
  return out
}

beforeEach(async () => {
  if (G().session) await worldLoaded()
  localStorage.setItem('onosendai:games', '1')
  chooseLevel(null)
  useGame.setState({ session: null, busy: null, message: null })
  // A fresh identity: no chain yet, the relays have said it has none.
  useCyberspace.setState({
    events: [], prevEventId: '', genesisId: '', published: {}, chainConflict: null, plan: null,
    exploreIndex: null, spectate: null, focus: null, transit: null, walking: false,
    selfCheck: { pubkey: S().identity.pubkey, status: 'none' },
    proof: { ...S().proof, status: 'idle', message: null },
  })
  S().setLive(false)
  sent.count = 0
})

describe('DRONE RUN is a test game: LOCAL only', () => {
  it('is on here by the device switch, and listed in GAMES found or not', () => {
    expect(implementedGames()).toContain(DRONE_RUN_GAME)
    expect(panelGames([])).toEqual([DRONE_RUN_GAME])
    // The tutorial dungeon is listed as before: once found.
    expect(panelGames([TUTORIAL_GAME])).toEqual([TUTORIAL_GAME, DRONE_RUN_GAME])
  })

  it('refuses to enter while LIVE, signing nothing, and the panel says the same', async () => {
    S().setLive(true)
    expect(enterBlockedFor(DRONE_RUN_GAME)).toBe(LOCAL_ONLY_MESSAGE)
    expect(whyNoEnterFor(DRONE_RUN_GAME)).toBe(LOCAL_ONLY_MESSAGE)
    expect(await G().enter(DRONE_RUN_GAME)).toBe(LOCAL_ONLY_MESSAGE)
    expect(G().message).toBe(LOCAL_ONLY_MESSAGE)
    expect(G().session).toBeNull()
    expect(S().events.length).toBe(0)
    expect(sent.count).toBe(0)
  })

  it('in LOCAL a fresh identity may press ENTER (it signs the spawn first); the dungeon still asks for a move', () => {
    expect(whyNoEnterFor(DRONE_RUN_GAME)).toBeNull()
    expect(enterBlockedFor({ ...TUTORIAL_GAME })).toBe(GAME_NEEDS_CHAIN_MESSAGE)
  })
})

describe('entering, playing and leaving in LOCAL', () => {
  it('signs the spawn and the entry, nothing else; exit-virtual with no free c; nothing reaches a relay', async () => {
    startPublisher()
    expect(await G().enter(DRONE_RUN_GAME)).toBeNull()
    // The spawn, then the entry.
    expect(S().events.map((e) => tag(e, 'A')?.[1])).toEqual(['spawn', 'enter-virtual'])
    const entry = last()
    expect(tag(entry, 'p')).toEqual(['p', DRONE_RUN_DEV_PUBKEY, '', 'game'])
    expect(tag(entry, 'region')?.[2]).toBe('8')
    // The tutorial is not running: nothing asks not to be broadcast (lib/noBroadcast.ts).
    expect(S().events.some((e) => e.tags.some((t) => t[0] === 'no-broadcast'))).toBe(false)

    await worldLoaded()
    const s = G().session!
    expect(s.game).toBe(DRONE_RUN_GAME)
    expect(s.worldError).toBeNull()
    expect(s.world!.length).toBe(level.pieces.length + 1)
    expect(local(s.entry!)).toEqual(level.entry)
    expect(insideBox(level.zones.start, local(s.at!))).toBe(true)
    expect(progressKeys()).toEqual([])

    // None of the dungeon's logic: nothing moves, nothing is taken or opened.
    const before = G().session
    G().step('z', -1); G().step('x', 1); G().jump(); G().tick(); G().take(); G().open()
    expect(G().session).toBe(before)
    expect(S().events.length).toBe(2)

    expect(await G().exit()).toBeNull()
    const exit = last()
    expect(tag(exit, 'A')?.[1]).toBe('exit-virtual')
    expect(tag(exit, 'c')).toBeUndefined()
    expect(tag(exit, 'C')?.[1]).toBe(tag(entry, 'c')?.[1])
    expect(G().session).toBeNull()
    expect(S().events.length).toBe(3)
    // Held here: queued for a LIVE that never came, never sent.
    await new Promise((r) => setTimeout(r, 50))
    expect(Object.values(S().published).every((st) => st === 'queued')).toBe(true)
    expect(sent.count).toBe(0)
    expect(progressKeys()).toEqual([])
  })

  it('with no relay in reach, ENTER and EXIT still sign in LOCAL: a placeholder game skips the look at the relays', async () => {
    relays.answer = false
    try {
      expect(await G().enter(DRONE_RUN_GAME)).toBeNull()
      expect(S().events.map((e) => tag(e, 'A')?.[1])).toEqual(['spawn', 'enter-virtual'])
      await worldLoaded()
      expect(await G().exit()).toBeNull()
      expect(tag(last(), 'A')?.[1]).toBe('exit-virtual')
      expect(sent.count).toBe(0)
    } finally {
      relays.answer = true
    }
  })

  it('resume after a reload goes back in at the entry point, signing nothing', async () => {
    expect(await G().enter(DRONE_RUN_GAME)).toBeNull()
    await worldLoaded()
    const signed = S().events.length
    // A reload: in-game mode is gone, the chain is still inside the bracket.
    useGame.setState({ session: null, busy: null, message: null })
    expect(G().resume()).toBe(true)
    await worldLoaded()
    const s = G().session!
    expect(s.game).toBe(DRONE_RUN_GAME)
    expect(s.snapshot).toBeNull()
    expect(s.resumeAt).toBeNull()
    expect(local(s.at!)).toEqual(level.entry)
    expect(S().events.length).toBe(signed)
    expect(await G().exit()).toBeNull()
    expect(sent.count).toBe(0)
  })
})

describe('a level imported on this device', () => {
  const field = placeholderField()
  // A made-up level: the built-in field's frame, its own id and name, the entry a little to the side, two pieces.
  const imported: Level = {
    ...field.level,
    id: 'test-import-1',
    name: 'Test import',
    entry: [120, 65, 194],
    pieces: [{ piece: 'field-ground-flat', at: [128, 64, 192] }, { piece: 'field-crate', at: [128, 64, 170] }],
  }
  const payloads = { 'field-ground-flat': field.payloads['field-ground-flat'], 'field-crate': field.payloads['field-crate'] }

  async function keep(): Promise<void> {
    const db = await openLevelsDb()
    await putLevel(db, { id: imported.id, name: imported.name, importedAt: 1, bytes: 1, faces: 1, level: imported, payloads })
    db.close()
  }

  it('enters the same game, but the session plays the imported level: its shards, its entry, its Level', async () => {
    await keep()
    chooseLevel(imported.id)
    expect(await G().enter(DRONE_RUN_GAME)).toBeNull()
    expect(S().events.map((e) => tag(e, 'A')?.[1])).toEqual(['spawn', 'enter-virtual'])
    expect(tag(last(), 'p')).toEqual(['p', DRONE_RUN_DEV_PUBKEY, '', 'game'])
    await worldLoaded()
    const s = G().session!
    expect(s.worldError).toBeNull()
    expect(s.level).toEqual(imported)
    expect(s.field).toEqual({ kind: 'imported', id: imported.id, name: imported.name })
    // The entry marker, then the two pieces where the level stands them.
    expect(s.world!.length).toBe(3)
    expect(s.world!.slice(1).map((w) => local(w.at))).toEqual(imported.pieces.map((p) => p.at))
    expect(local(s.entry!)).toEqual(imported.entry)
    expect(local(s.at!)).toEqual(imported.entry)
    expect(await G().exit()).toBeNull()
    expect(sent.count).toBe(0)
  })

  it('the built-in field gives the session the built-in Level', async () => {
    expect(await G().enter(DRONE_RUN_GAME)).toBeNull()
    await worldLoaded()
    expect(G().session!.level).toEqual(level)
    expect(G().session!.field).toEqual({ kind: 'built-in' })
    expect(await G().exit()).toBeNull()
  })

  it('a chosen level that is gone plays the built-in field, and the choice goes back to it', async () => {
    const db = await openLevelsDb()
    await deleteLevel(db, imported.id)
    db.close()
    chooseLevel(imported.id)
    expect(await G().enter(DRONE_RUN_GAME)).toBeNull()
    await worldLoaded()
    expect(G().session!.level).toEqual(level)
    expect(G().session!.world!.length).toBe(level.pieces.length + 1)
    expect(chosenLevel()).toBeNull()
    expect(await G().exit()).toBeNull()
  })
})
