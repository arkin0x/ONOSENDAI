/**
 * miningHooksTerrain.test.ts: MINING counts at TERRAIN's real code paths
 * (store/useTerrain.ts survey, mine and place; lib/blueprint/smashRun.ts
 * strike and takeToy): a survey, a block mined by its kind, a block placed
 * on a face and in open air, a bare-handed smash of the Compiler recipe
 * that compiles, the prize taken and the Compiler crafted. Nothing counts
 * during a tutorial run. IndexedDB is fake-indexeddb; the relay is mocked.
 */

import 'fake-indexeddb/auto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { setTerrainSession, terrainSession, useTerrain } from '../useTerrain'
import { useBlueprints } from '../useBlueprints'
import { miningRecordFor, resetMiningStats, setMiningDeps } from '../miningStats'
import { strike, takeToy } from '../../lib/blueprint/smashRun'
import { COMPILER_RECIPE } from '../../lib/blueprint/recipes'
import { cellIndex } from '../../lib/blueprint/format'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import { EMPTY, kindId } from '../../lib/terrain/blocks'
import { totalsOf } from '../../lib/miningRecord'
import type { RayHit } from '../../lib/terrain/raycast'

let run = 0
let A = ''
let tutorial = false
const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const totals = () => totalsOf(miningRecordFor(A)).c
const hitAt = (dx: number, dy: number, dz: number): RayHit => ({ cell: [dx, dy, dz], normal: [0, 1, 0], distance: 1 })

function solidCells(n: number): Array<[number, number, number]> {
  const s = terrainSession!
  const out: Array<[number, number, number]> = []
  for (let y = 1; y < 32 && out.length < n; y++) for (let z = 0; z < 32 && out.length < n; z++) for (let x = 0; x < 32 && out.length < n; x++) {
    if (x === 16 && z === 16) continue
    if (s.world.blockCs(x, y, z) !== EMPTY && s.world.blockCs(x, y - 1, z) !== EMPTY) out.push([x, y, z])
  }
  return out
}

async function openSurveyed(): Promise<string> {
  await T().enter()
  const key = chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))
  if (!terrainSession!.world.slotByKey(key)?.surveyed) await T().survey(key)
  return key
}

const store = new Map<string, string>()
beforeAll(() => {
  setMiningDeps({
    self: () => useCyberspace.getState().identity.pubkey,
    tutorial: () => tutorial,
    live: () => false,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) }, removeItem: (k) => { store.delete(k) } },
    prefs: null,
  })
})
afterAll(() => { setMiningDeps(null) })

beforeEach(async () => {
  if (T().active) await T().exit()
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  useCyberspace.setState({ walking: false })
  resetMiningStats()
  tutorial = false
  run++
  A = run.toString(16).padStart(64, 'c')
  useWalk.setState({ gravity: false })
  useCyberspace.setState({ identity: { pubkey: A, npub: '' }, position: { ...HEAD }, cursor: { ...HEAD }, anchor: { ...HEAD }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null })
})

describe('TERRAIN counts for MINING', () => {
  it('a survey, a mined block by its kind, placed on a face and in open air', async () => {
    await openSurveyed()
    expect(totals().surveys).toBe(1)
    expect(totals().chunks).toBe(1)
    const s = terrainSession!
    const [c1, c2] = solidCells(2)
    const id = kindId(s.world.blockCs(...c1))
    expect(T().mine(hitAt(...c1))).toBe(true)
    expect(T().mine(hitAt(...c2))).toBe(true)
    expect(totals().mined).toBe(2)
    expect(totalsOf(miningRecordFor(A)).k[id]).toBeGreaterThanOrEqual(1)
    // Placed back on the block under the first.
    T().selectSlot(T().inventory.hotbar.findIndex((h) => h > 0))
    expect(T().place({ cell: [c1[0], c1[1] - 1, c1[2]], normal: [0, 1, 0], distance: 1 })).toBe(true)
    expect(totals().placed).toBe(1)
    expect(totals().placedAir).toBe(0)
    // In open air: the ghost's cell.
    const open = (x: number, y: number, z: number): boolean => s.world.blockCs(x, y, z) === EMPTY
    let air: [number, number, number] | null = null
    for (let y = 30; y > 1 && !air; y--) for (let z = 2; z < 30 && !air; z++) for (let x = 2; x < 30 && !air; x++) {
      if (x === 16 && z === 16) continue
      if (open(x, y, z) && open(x - 1, y, z) && open(x + 1, y, z) && open(x, y - 1, z) && open(x, y + 1, z) && open(x, y, z - 1) && open(x, y, z + 1)) air = [x, y, z]
    }
    expect(air).not.toBeNull()
    const inv = T().inventory
    const left = inv.hotbar.findIndex((h) => h > 0 && (inv.counts[h] ?? 0) > 0)
    expect(left).toBeGreaterThanOrEqual(0)
    T().selectSlot(left)
    expect(T().place(null, { cell: air!, eye: [16, 17, 16] })).toBe(true)
    expect(totals().placedAir).toBe(1)
    expect(totals().placed).toBe(2)
    // A refused place counts nothing.
    const before = totals().placed
    T().place(hitAt(-5, 5, 5))
    expect(totals().placed).toBe(before)
  })

  it('a bare-handed smash of the Compiler recipe: a smash, its blocks, a compile; taking the prize crafts the Compiler', async () => {
    await openSurveyed()
    const s = terrainSession!
    useBlueprints.setState({ owner: A, loadedFor: A, cards: [], toys: [] })
    // The recipe, standing alone in open air near you.
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
    await strike(at!, true)
    expect(totals().smashes).toBe(1)
    expect(totals().smashBare).toBe(1)
    expect(totals().smashCompiler).toBe(0)
    expect(totals().smashed).toBeGreaterThanOrEqual(5)
    expect(totals().compiles).toBe(1)
    const toy = useBlueprints.getState().toys[0]
    expect(toy?.prize.type).toBe('tool')
    expect(miningRecordFor(A).first.compiler).toBeUndefined()
    expect(takeToy(toy.rowKey)).toBe(true)
    expect(totals().prizes).toBe(1)
    expect(miningRecordFor(A).first.compiler).toBeGreaterThan(0)
  }, 15_000)

  it('nothing counts during a tutorial run', async () => {
    tutorial = true
    await openSurveyed()
    const [c] = solidCells(1)
    expect(T().mine(hitAt(...c))).toBe(true)
    expect(totals().surveys).toBe(0)
    expect(totals().mined).toBe(0)
  })
})
