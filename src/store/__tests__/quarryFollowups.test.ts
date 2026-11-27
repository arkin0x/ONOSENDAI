/**
 * quarryFollowups.test.ts - the review of #952: a switch of identity during
 * a fuse fizzles it at once and stops its beeps; a drop collected is carried
 * and gone in one IndexedDB transaction; a read of the stored drops under
 * way while one was collected never brings it back; a prize goes only to
 * the identity that struck, on screen and with its own blocks loaded (the
 * Compiler too); and a smash that switched identity while it compiled gives
 * no prize to anyone.
 */

import 'fake-indexeddb/auto'
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

const h = vi.hoisted(() => ({
  stops: [] as Array<ReturnType<typeof import('vitest').vi.fn>>,
  /** When set, readDrops waits for it (a read under way). */
  gate: null as null | { promise: Promise<unknown>; resolve: (v: unknown) => void },
}))

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/blueprint/smashSound', async (orig) => {
  const real = await orig<typeof import('../../lib/blueprint/smashSound')>()
  const { vi: v } = await import('vitest')
  return { ...real, fuseBeeps: () => { const stop = v.fn(); h.stops.push(stop); return stop } }
})
vi.mock('../../lib/terrain/terrainDb', async (orig) => {
  const real = await orig<typeof import('../../lib/terrain/terrainDb')>()
  const { vi: v } = await import('vitest')
  return {
    ...real,
    writeInventoryAndDrops: v.fn(real.writeInventoryAndDrops),
    writeInventory: v.fn(real.writeInventory),
    writeDrops: v.fn(real.writeDrops),
    readDrops: v.fn(async (db: IDBDatabase, owner: string) => (h.gate ? h.gate.promise : real.readDrops(db, owner))),
  }
})

import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { quarryHooks, setTerrainSession, terrainSession, useTerrain } from '../useTerrain'
import { FIZZLED, useQuarry } from '../useQuarry'
import { useBlueprints } from '../useBlueprints'
import * as db from '../../lib/terrain/terrainDb'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import { EMPTY } from '../../lib/terrain/blocks'
import { FUSE_MS, cellKey, tidyDrops, type Drop } from '../../lib/terrain/quarry'
import { NOT_YOURS_LINE, SWITCHED_LINE, strike, takeToy } from '../../lib/blueprint/smashRun'
import { COMPILER_RECIPE } from '../../lib/blueprint/recipes'
import { cellIndex } from '../../lib/blueprint/format'
import type { Position } from '../../lib/space'

let run = 0
let A = ''
let B = ''
const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const Q = () => useQuarry.getState()
const settle = (ms = 40): Promise<void> => new Promise((r) => setTimeout(r, ms))

function as(pubkey: string, at: Position = HEAD): void {
  useCyberspace.setState({ identity: { pubkey, npub: '' }, position: { ...at }, cursor: { ...at }, anchor: { ...at }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null, live: false })
}

async function openSurveyed(): Promise<void> {
  await T().enter()
  const key = chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))
  if (!terrainSession!.world.slotByKey(key)?.surveyed) await T().survey(key)
  await settle()
}

function groundAt(x: number, z: number): [number, number, number] {
  const s = terrainSession!
  for (let y = 30; y >= 4; y--) if (s.world.blockCs(x, y, z) !== EMPTY && s.world.blockCs(x, y + 1, z) === EMPTY) return [x, y, z]
  throw new Error('no ground here')
}

/** A blast in the ground at (6, 6), away from where you stand. */
async function blastNear(): Promise<[number, number, number]> {
  await openSurveyed()
  const g = groundAt(6, 6)
  const c: [number, number, number] = [g[0], g[1] - 1, g[2]]
  Q().arm(c)
  Q().detonate(Q().charges[0].id)
  await settle(60)
  return c
}

/** Step into a cell of the field (cs offsets), as walking there would. */
function stepTo(c: readonly number[]): void {
  const o = terrainSession!.world.origin
  const at = { x: o.x + BigInt(c[0]), y: o.y + BigInt(c[1]), z: o.z + BigInt(c[2]) }
  useCyberspace.setState({ position: at, cursor: at })
}

beforeEach(async () => {
  vi.useRealTimers()
  h.gate = null
  if (T().active) await T().exit()
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  useCyberspace.setState({ walking: false })
  run++
  A = run.toString(16).padStart(64, 'e')
  B = run.toString(16).padStart(64, 'f')
  useWalk.setState({ gravity: false })
  useQuarry.setState({ charges: [], drops: [], owner: '', version: 0, tally: { placed: 0, quarried: 0 } })
  h.stops.length = 0
  vi.mocked(db.writeInventoryAndDrops).mockClear()
  vi.mocked(db.writeInventory).mockClear()
  vi.mocked(db.writeDrops).mockClear()
  as(A)
})

describe('the fuse and a switch of identity', () => {
  it('fizzles at once: the charge is gone, its beeps stop, and when its time comes nothing is cleared', async () => {
    await openSurveyed()
    const g = groundAt(6, 6)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect(Q().arm([g[0], g[1] + 1, g[2]])).toBe(true)
    expect(h.stops).toHaveLength(1)
    const s = terrainSession!
    useCyberspace.setState({ identity: { pubkey: B, npub: '' } })
    expect(Q().charges).toHaveLength(0)
    expect(h.stops[0]).toHaveBeenCalled()
    expect(T().message).toBe(FIZZLED)
    vi.advanceTimersByTime(FUSE_MS + 10)
    expect(s.world.blockCs(...g)).not.toBe(EMPTY)
  })

  it('a charge whose identity is not the one on screen at the fuse\'s end fizzles, even with its field still here', async () => {
    await openSurveyed()
    const g = groundAt(6, 6)
    Q().arm([g[0], g[1] + 1, g[2]])
    const id = Q().charges[0].id
    // The identity on screen changed without the store hearing it (as a second store would see it mid-switch).
    const real = useCyberspace.getState
    const spy = vi.spyOn(useCyberspace, 'getState').mockImplementation(() => ({ ...real(), identity: { pubkey: B, npub: '' } }))
    Q().detonate(id)
    spy.mockRestore()
    expect(T().message).toBe(FIZZLED)
    expect(terrainSession!.world.blockCs(...g)).not.toBe(EMPTY)
    expect(h.stops[0]).toHaveBeenCalled()
  })
})

describe('collecting a drop', () => {
  it('carries it and writes it gone in one transaction, the inventory and the drops row together', async () => {
    const c = await blastNear()
    vi.mocked(db.writeInventoryAndDrops).mockClear()
    vi.mocked(db.writeInventory).mockClear()
    vi.mocked(db.writeDrops).mockClear()
    const n = Q().drops.length
    stepTo(c)
    const left = Q().drops.length
    expect(left).toBeLessThan(n)
    expect(db.writeInventoryAndDrops).toHaveBeenCalledTimes(1)
    const [, owner, inv, drops] = vi.mocked(db.writeInventoryAndDrops).mock.calls[0]
    expect(owner).toBe(A)
    expect(inv).toEqual(T().inventory)
    expect(drops).toHaveLength(left)
    // Nothing written apart from it.
    expect(db.writeInventory).not.toHaveBeenCalled()
    expect(db.writeDrops).not.toHaveBeenCalled()
    await settle(60)
    const d = await db.openTerrainDb()
    expect(tidyDrops(await (await vi.importActual<typeof import('../../lib/terrain/terrainDb')>('../../lib/terrain/terrainDb')).readDrops(d, A), Date.now())).toHaveLength(left)
    d.close()
  })

  it('a read of the stored drops under way while one is collected never brings it back', async () => {
    const c = await blastNear()
    const o = terrainSession!.world.origin
    // What was stored before the drop is collected: the read returns this, late.
    const stale = Q().drops.map((d) => ({ ...d }))
    let release: (v: unknown) => void = () => {}
    h.gate = { promise: new Promise((r) => { release = r }), resolve: (v) => release(v) }
    // The field reads its drops again (as a reload, or the field made again, does)...
    for (const f of quarryHooks.fieldReady) f(terrainSession!)
    // ...and meanwhile the walk collects one.
    const key = cellKey(o.x + BigInt(c[0]), o.y + BigInt(c[1]), o.z + BigInt(c[2]), 0)
    const ident = (d: Drop) => `${d.key}|${d.id}|${d.expires}`
    const target = stale.find((d) => d.key === key)!
    expect(target).toBeTruthy()
    stepTo(c)
    expect(Q().drops.some((d) => ident(d) === ident(target))).toBe(false)
    h.gate.resolve(stale)
    h.gate = null
    await settle(60)
    expect(Q().drops.some((d) => ident(d) === ident(target))).toBe(false)
    expect(Q().drops.length).toBeLessThan(stale.length)
    // And what is stored follows.
    const d = await db.openTerrainDb()
    const kept = tidyDrops(await (await vi.importActual<typeof import('../../lib/terrain/terrainDb')>('../../lib/terrain/terrainDb')).readDrops(d, A), Date.now())
    d.close()
    expect(kept.some((x) => ident(x) === ident(target))).toBe(false)
  })
})

describe('a prize goes to the identity that struck', () => {
  const toy = (owner: string, tool: 'compiler' | 'quarry-charge') => ({
    rowKey: `${owner}/t/${tool}`, owner, prize: tool === 'compiler' ? { type: 'tool' as const, tool } : { type: 'tool' as const, tool, count: 7 },
    name: 'x', maker: 'game', lookup: 'l', at: { x: '0', y: '0', z: '0', plane: 0 }, made: 0,
  })

  it.each(['quarry-charge', 'compiler'] as const)('a %s prize found by another identity is not credited to the one on screen', async (tool) => {
    await openSurveyed()
    const before = T().inventory
    useBlueprints.setState({ toys: [toy(B, tool)] })
    expect(takeToy(`${B}/t/${tool}`)).toBe(false)
    expect(T().message).toBe(NOT_YOURS_LINE)
    expect(useBlueprints.getState().toys).toHaveLength(1)
    expect(T().inventory).toEqual(before)
  })

  it('and not while TERRAIN still holds another identity\'s blocks', async () => {
    await openSurveyed()
    useBlueprints.setState({ toys: [toy(B, 'quarry-charge')] })
    // The identity on screen is B, but the field (and its inventory) is still A's.
    useCyberspace.setState({ identity: { pubkey: B, npub: '' } })
    setTerrainSession({ ...terrainSession!, owner: A })
    expect(takeToy(`${B}/t/quarry-charge`)).toBe(false)
    expect(T().inventory.charges ?? 0).toBe(0)
  })

  it('a smash whose identity changed while it compiled gives no prize to anyone', async () => {
    await openSurveyed()
    const s = terrainSession!
    useBlueprints.setState({ owner: A, loadedFor: A, cards: [], toys: [] })
    const o = [19, 12, 19]
    const cells: Array<[number, number, number]> = []
    for (let x = -1; x <= 3; x++) for (let y = -1; y <= 3; y++) for (let z = -1; z <= 1; z++) cells.push([o[0] + x, o[1] + y, o[2] + z])
    expect(T().clear(cells)).toBeNull()
    const [sx, sy, sz] = COMPILER_RECIPE.size
    let at: [number, number, number] | null = null
    for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
      const id = COMPILER_RECIPE.cells[cellIndex(COMPILER_RECIPE.size, x, y, z)]
      if (id) { s.world.setCs(o[0] + x, o[1] + y, o[2] + z, id); at ??= [o[0] + x, o[1] + y, o[2] + z] }
    }
    const done = strike(at!, true)
    await settle(100)
    useCyberspace.setState({ identity: { pubkey: B, npub: '' } })
    await done
    expect(useBlueprints.getState().toys).toEqual([])
    expect(T().message).toBe(SWITCHED_LINE)
  }, 15_000)
})
