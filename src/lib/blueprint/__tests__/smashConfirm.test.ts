/**
 * smashConfirm.test.ts - TERRAIN's real smash path (lib/blueprint/smashRun.ts
 * holdSmash and strike) asking before it wastes recipe materials (owner's
 * lost Glowcore, 2026-11-28): the owner's T resting on the floor brings up the
 * confirm instead of the swing; CANCEL spends nothing; SMASH deletes as
 * always and says why it compiled nothing; the lifted T swings with no
 * question; "Don't ask again" is kept per identity. IndexedDB is
 * fake-indexeddb; the relay is mocked.
 */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../../../store/useCyberspace'
import { useWalk } from '../../../store/useWalk'
import { setTerrainSession, terrainSession, useTerrain } from '../../../store/useTerrain'
import { useBlueprints } from '../../../store/useBlueprints'
import { holdSmash, strike } from '../smashRun'
import { makeBlueprint } from '../make'
import { arrangementFrom } from '../arrangement'
import type { NostrEvent } from '../../events'
import { cancelSmashHold, useSmashHold } from '../../../terrain/smashHold'
import { terrainCursor } from '../../../scene/TerrainLayer'
import { BARE_HOLD_MS, RESOLVE_AFTER_MS, SWING_MS } from '../smash'
import { SMASH_ASK_OFF_PREFIX, answerSmash, forgetSmashAsk, smashAskingFor, useSmashConfirm } from '../smashConfirm'
import { FERROVEIN, GLOWCORE, GRIDSTONE, RUSTBAND } from '../recipes'
import { chunkKey, chunkOf } from '../../terrain/coords'
import { kvGet, movesToKv } from '../../kvStore'

let identityNo = 0
let A = ''
const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const O = [19, 12, 19] as const
/** The T's blocks at `o`: handle, then head along X. */
const tCells = (o: readonly [number, number, number]): Array<[number, number, number, number]> => [
  [o[0] + 1, o[1], o[2], FERROVEIN], [o[0] + 1, o[1] + 1, o[2], FERROVEIN],
  [o[0], o[1] + 2, o[2], RUSTBAND], [o[0] + 1, o[1] + 2, o[2], GLOWCORE], [o[0] + 2, o[1] + 2, o[2], RUSTBAND],
]

async function openSurveyed(): Promise<void> {
  await T().enter()
  const key = chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))
  if (!terrainSession!.world.slotByKey(key)?.surveyed) await T().survey(key)
}

/** How the T is built: on natural ground (the owner's), on a placed block, or lifted with a gap all round. */
type Floor = 'natural' | 'platform' | 'lifted'

async function build(floor: Floor): Promise<Array<[number, number, number, number]>> {
  await openSurveyed()
  return place(floor)
}

/** The highest natural ground block in a column near O, for the T's handle to rest on. */
function naturalFloor(): [number, number, number] {
  const s = terrainSession!
  for (let x = 17; x <= 24; x++) for (let z = 17; z <= 24; z++) for (let y = 24; y >= 2; y--) {
    if (s.world.naturalCs(x + 1, y, z)) return [x, y, z]
  }
  throw new Error('no natural ground near O')
}

/** The same, in TERRAIN already open. */
function place(floor: Floor): Array<[number, number, number, number]> {
  const s = terrainSession!
  let o: [number, number, number]
  const cells: Array<[number, number, number]> = []
  if (floor === 'natural') {
    // Everything above the ground cleared, the ground itself kept: the handle rests on it.
    const [x, y, z] = naturalFloor()
    o = [x, y + 1, z]
    for (let dx = -2; dx <= 4; dx++) for (let dy = 0; dy <= 4; dy++) for (let dz = -2; dz <= 2; dz++) cells.push([x + dx, o[1] + dy, z + dz])
  } else {
    o = [O[0], O[1] + 1, O[2]]
    for (let x = -2; x <= 4; x++) for (let y = -2; y <= 5; y++) for (let z = -2; z <= 2; z++) cells.push([O[0] + x, O[1] + y, O[2] + z])
  }
  expect(T().clear(cells)).toBeNull()
  const t = tCells(o)
  for (const [x, y, z, id] of t) s.world.setCs(x, y, z, id)
  if (floor === 'natural') expect(s.world.naturalCs(o[0] + 1, o[1] - 1, o[2])).toBe(true)
  if (floor === 'platform') {
    // A placed block under the handle: one the ground there never held, so it is not natural.
    const under = [o[0] + 1, o[1] - 1, o[2]] as const
    for (const id of [GRIDSTONE, 2, 3, 4, 6]) { s.world.setCs(under[0], under[1], under[2], id); if (!s.world.naturalCs(under[0], under[1], under[2])) break }
    expect(s.world.blockCs(under[0], under[1], under[2])).not.toBe(0)
    expect(s.world.naturalCs(under[0], under[1], under[2])).toBe(false)
  }
  // Aimed at the upper Ferrovein, where he struck.
  terrainCursor.hit = { cell: [t[1][0], t[1][1], t[1][2]], normal: [0, 0, 1], distance: 2 }
  return t
}

const present = (t: ReadonlyArray<readonly [number, number, number, number]>): number => t.filter(([x, y, z, id]) => terrainSession!.world.blockCs(x, y, z) === id).length

beforeEach(async () => {
  vi.useRealTimers()
  if (T().active) await T().exit()
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  useSmashHold.setState({ since: null, target: null, swingAt: null })
  forgetSmashAsk()
  identityNo++
  A = identityNo.toString(16).padStart(64, 'd')
  useWalk.setState({ gravity: false })
  useCyberspace.setState({ identity: { pubkey: A, npub: '' }, position: { ...HEAD }, cursor: { ...HEAD }, anchor: { ...HEAD }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null })
  useBlueprints.setState({ owner: A, loadedFor: A, cards: [], toys: [] })
})
afterEach(() => {
  cancelSmashHold()
  vi.clearAllTimers()
  vi.useRealTimers()
  terrainCursor.hit = null
  forgetSmashAsk()
})

describe('the confirm before a wasted smash, on the real smash path', () => {
  it("the owner's T on the floor: the hold ends in the confirm, not a swing; CANCEL spends nothing", async () => {
    const t = await build('natural')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdSmash()
    expect(useSmashHold.getState().since).not.toBeNull()
    vi.advanceTimersByTime(BARE_HOLD_MS)
    const ask = useSmashConfirm.getState().ask
    expect(ask).not.toBeNull()
    expect(ask!.words).toBe("This is the Compiler, but it is touching the ground, so it won't compile. Build it with a gap all round. Smashing breaks 5 blocks, including placed Glowcore. Smash anyway?")
    expect(useSmashHold.getState().since).toBeNull()
    expect(useSmashHold.getState().swingAt).toBeNull()
    expect(present(t)).toBe(5)
    // Another hold waits for the answer.
    holdSmash()
    expect(useSmashHold.getState().since).toBeNull()
    answerSmash(false)
    expect(useSmashConfirm.getState().ask).toBeNull()
    await vi.advanceTimersByTimeAsync(SWING_MS + RESOLVE_AFTER_MS + 500)
    expect(present(t)).toBe(5)
    expect(useSmashHold.getState().swingAt).toBeNull()
    // Asked again next time: CANCEL never turns the question off.
    expect(smashAskingFor(A)).toBe(true)
  })

  it('SMASH swings and deletes all five as always, then says what it was and how to build it', async () => {
    const t = await build('natural')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdSmash()
    vi.advanceTimersByTime(BARE_HOLD_MS)
    expect(useSmashConfirm.getState().ask).not.toBeNull()
    answerSmash(true)
    expect(useSmashHold.getState().swingAt).not.toBeNull()
    await vi.advanceTimersByTimeAsync(SWING_MS + RESOLVE_AFTER_MS + 500)
    expect(present(t)).toBe(0)
    expect(T().message).toBe('That was the Compiler, but it touched the ground. Build it with a gap all round.')
  })

  it('the lifted T (a gap all round) compiles: the hold swings with no confirm', async () => {
    await build('lifted')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdSmash()
    vi.advanceTimersByTime(BARE_HOLD_MS)
    expect(useSmashConfirm.getState().ask).toBeNull()
    expect(useSmashHold.getState().swingAt).not.toBeNull()
  })

  it('"Don\'t ask again" is kept for this identity alone, in IndexedDB; the next wasted smash swings at once', async () => {
    const t = await build('natural')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdSmash()
    vi.advanceTimersByTime(BARE_HOLD_MS)
    answerSmash(true, true)
    expect(smashAskingFor(A)).toBe(false)
    expect(kvGet(SMASH_ASK_OFF_PREFIX + A)).toBe('1')
    expect(movesToKv(SMASH_ASK_OFF_PREFIX + A)).toBe(true)
    // Another identity is still asked.
    expect(smashAskingFor('e'.repeat(64))).toBe(true)
    await vi.advanceTimersByTimeAsync(SWING_MS + RESOLVE_AFTER_MS + 500)
    expect(present(t)).toBe(0)
    // Rebuilt: no question this time.
    const again = place('natural')
    holdSmash()
    vi.advanceTimersByTime(BARE_HOLD_MS)
    expect(useSmashConfirm.getState().ask).toBeNull()
    expect(useSmashHold.getState().swingAt).not.toBeNull()
    await vi.advanceTimersByTimeAsync(SWING_MS + RESOLVE_AFTER_MS + 500)
    expect(present(again)).toBe(0)
  })

  it('on a placed block instead of the ground: the confirm says it is touching another block', async () => {
    const t = await build('platform')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdSmash()
    vi.advanceTimersByTime(BARE_HOLD_MS)
    expect(useSmashConfirm.getState().ask?.words).toMatch(/^This is the Compiler, but it is touching another block, so it won't compile\./)
    answerSmash(false)
    expect(present(t)).toBe(5)
  })

  it('choosing another hotbar slot takes the question down with nothing spent', async () => {
    const t = await build('natural')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdSmash()
    vi.advanceTimersByTime(BARE_HOLD_MS)
    expect(useSmashConfirm.getState().ask).not.toBeNull()
    T().selectSlot((T().inventory.slot + 1) % 9)
    expect(useSmashConfirm.getState().ask).toBeNull()
    await vi.advanceTimersByTimeAsync(SWING_MS + RESOLVE_AFTER_MS + 500)
    expect(present(t)).toBe(5)
  })

  it('leaving TERRAIN takes the question down with nothing spent', async () => {
    const t = await build('natural')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdSmash()
    vi.advanceTimersByTime(BARE_HOLD_MS)
    expect(useSmashConfirm.getState().ask).not.toBeNull()
    void T().exit()
    expect(T().active).toBe(false)
    expect(useSmashConfirm.getState().ask).toBeNull()
    expect(present(t)).toBe(5)
  })

  it('a change of identity takes the question down with nothing spent', async () => {
    const t = await build('natural')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdSmash()
    vi.advanceTimersByTime(BARE_HOLD_MS)
    expect(useSmashConfirm.getState().ask).not.toBeNull()
    useCyberspace.setState({ identity: { pubkey: 'f'.repeat(64), npub: '' } })
    expect(useSmashConfirm.getState().ask).toBeNull()
    expect(present(t)).toBe(5)
  })

  it('a bare hand compiles a player blueprint that fits its reach: strike() unseals it into a prize (owner, 2026-11-28)', async () => {
    await openSurveyed()
    const s = terrainSession!
    // A two-block rail, someone's blueprint, and a record of it this device has seen.
    const arrangement = arrangementFrom([{ at: [0, 0, 0], id: GRIDSTONE }, { at: [1, 0, 0], id: FERROVEIN }])!
    const made = await makeBlueprint({ arrangement, shown: () => true, title: 'Rail', prize: { type: 'sno', payload: { v: 2, name: 'Rail piece' } }, reveal: 'hidden', lock: 'standard' },
      async (tpl) => ({ ...tpl, id: 'f'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) }))
    if ('refused' in made) throw new Error(made.refused)
    useBlueprints.getState().remember([made.record as NostrEvent])
    // Built in cleared air with a gap all round.
    const cells: Array<[number, number, number]> = []
    for (let x = -2; x <= 4; x++) for (let y = -2; y <= 4; y++) for (let z = -2; z <= 2; z++) cells.push([O[0] + x, O[1] + y, O[2] + z])
    expect(T().clear(cells)).toBeNull()
    s.world.setCs(O[0], O[1], O[2], GRIDSTONE)
    s.world.setCs(O[0] + 1, O[1], O[2], FERROVEIN)
    await strike([O[0], O[1], O[2]], true)
    expect(s.world.blockCs(O[0], O[1], O[2])).toBe(0)
    expect(s.world.blockCs(O[0] + 1, O[1], O[2])).toBe(0)
    const toys = useBlueprints.getState().toys.filter((toy) => toy.owner === A)
    expect(toys.map((toy) => [toy.name, toy.maker])).toEqual([['Rail', 'b'.repeat(64)]])
  }, 60_000)
})
