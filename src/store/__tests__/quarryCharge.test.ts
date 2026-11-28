/**
 * quarryCharge.test.ts - the Quarry Charge in play (DECK-0010 §8.6; owner,
 * 2026-11-27): the stack (no cap, +7 a compile, -1 a placing, kept at 0 and
 * disabled), placing it like a block, its fuse, the blast of exactly 7 by 7
 * by 7 cells centred on it in your own layer as mining would, and the drops:
 * one per block taken, collected by walking into them, gone at ten minutes,
 * kept across a reload with the time they had left, and never published.
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

const relay = vi.hoisted(() => ({ published: [] as unknown[] }))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (events: unknown[]) => { relay.published.push(...events); return { ok: true } }),
  publish: vi.fn(async (e: unknown) => { relay.published.push(e); return { ok: true } }),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { NO_CHARGES, setTerrainSession, terrainSession, useTerrain } from '../useTerrain'
import { FIZZLED, useQuarry } from '../useQuarry'
import { QUARRY_ID, emptyInventory, isQuarry, openTerrainDb, placeable, readDrops, tidyInventory, withCharges, withCompiler, withoutCompiler } from '../../lib/terrain/terrainDb'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import { EMPTY, kindId } from '../../lib/terrain/blocks'
import { BLAST_SIDE, DROP_LIFE_MS, FUSE_MS, blastCells, cellKey, tidyDrops } from '../../lib/terrain/quarry'
import { takeToy } from '../../lib/blueprint/smashRun'
import { useBlueprints } from '../useBlueprints'
import type { Position } from '../../lib/space'
import type { RayHit } from '../../lib/terrain/raycast'

let run = 0
let A = ''
const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const Q = () => useQuarry.getState()
const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

function as(pubkey: string, at: Position = HEAD): void {
  useCyberspace.setState({ identity: { pubkey, npub: '' }, position: { ...at }, cursor: { ...at }, anchor: { ...at }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null, live: false })
}

function reload(): void {
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  useCyberspace.setState({ walking: false })
}

async function openSurveyed(): Promise<void> {
  await T().enter()
  const key = chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))
  if (!terrainSession!.world.slotByKey(key)?.surveyed) await T().survey(key)
  await settle()
}

/** The highest solid cell in a column of the chunk you stand in (cs offsets), and the open cell over it. */
function groundAt(x: number, z: number): [number, number, number] {
  const s = terrainSession!
  for (let y = 30; y >= 4; y--) if (s.world.blockCs(x, y, z) !== EMPTY && s.world.blockCs(x, y + 1, z) === EMPTY) return [x, y, z]
  throw new Error('no ground here')
}

/** Every cell's block in a box round `c` of half-side `h`. */
function snapshot(c: readonly number[], h: number): Map<string, number> {
  const s = terrainSession!
  const m = new Map<string, number>()
  for (let dy = -h; dy <= h; dy++) for (let dz = -h; dz <= h; dz++) for (let dx = -h; dx <= h; dx++) m.set(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`, s.world.blockCs(c[0] + dx, c[1] + dy, c[2] + dz))
  return m
}

const pendingOps = (): number => [...terrainSession!.pending.values()].reduce((n, l) => n + l.length, 0)

beforeEach(async () => {
  if (T().active) await T().exit()
  reload()
  run++
  A = run.toString(16).padStart(64, 'c')
  useWalk.setState({ gravity: false })
  useQuarry.setState({ charges: [], drops: [], owner: '', version: 0, tally: { placed: 0, quarried: 0 } })
  relay.published.length = 0
  as(A)
})

afterEach(() => { vi.useRealTimers() })

describe('the stack (DECK-0010 §8.6)', () => {
  it('joins the bar after the Compiler; each compile adds 7, with no cap', () => {
    let inv = withCompiler({ counts: { 5: 2 }, hotbar: [5, 0, 0, 0, 0, 0, 0, 0, 0], slot: 0 }, 'made')
    expect(inv.hotbar[0]).not.toBe(QUARRY_ID)
    inv = withCharges(inv, 7)
    expect(inv.hotbar.slice(0, 3)).toEqual([1000, QUARRY_ID, 5])
    // The chosen block stays chosen as the slots shift.
    expect(inv.hotbar[inv.slot]).toBe(5)
    for (let i = 0; i < 300; i++) inv = withCharges(inv, (inv.charges ?? 0) + 7)
    expect(inv.charges).toBe(7 * 301)
    expect(inv.hotbar.filter(isQuarry)).toHaveLength(1)
  })

  it('at 0 it stays in the bar, shown and kept, but nothing can be placed from it', () => {
    const inv = withCharges(withCompiler(emptyInventory(), 'made'), 0)
    expect(inv.charges).toBe(0)
    expect(inv.hotbar[1]).toBe(QUARRY_ID)
    expect(placeable({ ...inv, slot: 1 })).toBeNull()
    expect(placeable({ ...withCharges(inv, 1), slot: 1 })).toBe(QUARRY_ID)
  })

  it('is kept on the device as it was: through tidy, a granted Compiler switched off and back', () => {
    const inv = withCharges(withCompiler({ counts: { 5: 2, 40: 1 }, hotbar: [5, 40, 0, 0, 0, 0, 0, 0, 0], slot: 1 }, 'granted'), 14)
    expect(tidyInventory(JSON.parse(JSON.stringify(inv)))).toEqual(inv)
    const off = withoutCompiler(inv)
    expect(off.charges).toBe(14)
    expect(off.hotbar[0]).toBe(QUARRY_ID)
    expect(withCompiler(off, 'granted').hotbar.slice(0, 2)).toEqual([1000, QUARRY_ID])
    // Zero is a count too; a stored bad count is none at all.
    expect(tidyInventory({ ...inv, charges: 0 }).charges).toBe(0)
    expect(tidyInventory({ ...inv, charges: -1 }).charges).toBeUndefined()
    expect(tidyInventory({ ...inv, charges: -1 }).hotbar).not.toContain(QUARRY_ID)
  })

  it('a compile\'s toy, taken, adds seven (and again seven)', async () => {
    await openSurveyed()
    const toy = (i: number) => ({ rowKey: `${A}/q/${i}`, owner: A, prize: { type: 'tool' as const, tool: 'quarry-charge' as const, count: 7 }, name: 'Quarry Charges', maker: 'game', lookup: 'q', at: { x: '0', y: '0', z: '0', plane: 0 }, made: 0 })
    useBlueprints.setState({ toys: [toy(1), toy(2)] })
    expect(takeToy(`${A}/q/1`)).toBe(true)
    expect(T().inventory.charges).toBe(7)
    expect(takeToy(`${A}/q/2`)).toBe(true)
    expect(T().inventory.charges).toBe(14)
    expect(T().inventory.hotbar.filter(isQuarry)).toHaveLength(1)
  })
})

describe('placing, the fuse and the blast', () => {
  it('placing arms one on the face and subtracts 1; at 0 it is refused in words and nothing arms', async () => {
    await openSurveyed()
    T().gainCharges(1)
    T().selectSlot(T().inventory.hotbar.findIndex(isQuarry))
    const g = groundAt(6, 6)
    const hit: RayHit = { cell: g, normal: [0, 1, 0], distance: 2 }
    const before = pendingOps()
    expect(T().place(hit)).toBe(true)
    expect(T().inventory.charges).toBe(0)
    expect(Q().charges).toHaveLength(1)
    // A charge is not a block: placing it writes nothing until its blast.
    expect(pendingOps()).toBe(before)
    expect(terrainSession!.world.blockCs(g[0], g[1] + 1, g[2])).toBe(EMPTY)
    expect(T().place(hit)).toBe(false)
    expect(T().message).toBe(NO_CHARGES)
    expect(Q().charges).toHaveLength(1)
    expect(T().inventory.hotbar.findIndex(isQuarry)).toBeGreaterThanOrEqual(0)
    Q().detonate(Q().charges[0].id)
  })

  it('in open air at the ghost, as a block would go', async () => {
    await openSurveyed()
    T().gainCharges(2)
    T().selectSlot(T().inventory.hotbar.findIndex(isQuarry))
    const g = groundAt(8, 24)
    const cell: [number, number, number] = [g[0], g[1] + 3, g[2]]
    expect(T().place(null, { cell, eye: [16, 17, 16] })).toBe(true)
    expect(Q().charges).toHaveLength(1)
    // One charge to a cell.
    expect(T().place(null, { cell, eye: [16, 17, 16] })).toBe(false)
    expect(T().inventory.charges).toBe(1)
    Q().detonate(Q().charges[0].id)
  })

  it('burns FUSE_MS (10 seconds), then blasts', async () => {
    await openSurveyed()
    const g = groundAt(6, 6)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect(Q().arm([g[0], g[1] + 1, g[2]])).toBe(true)
    vi.advanceTimersByTime(FUSE_MS - 1)
    expect(Q().charges).toHaveLength(1)
    expect(terrainSession!.world.blockCs(...g)).not.toBe(EMPTY)
    vi.advanceTimersByTime(1)
    expect(Q().charges).toHaveLength(0)
    expect(terrainSession!.world.blockCs(...g)).toBe(EMPTY)
    expect(FUSE_MS).toBe(10_000)
  })

  it('leaving TERRAIN while it burns: it still blasts at the fuse\'s end, in your layer, with its drops (ruled 2026-11-28: unchanged)', async () => {
    await openSurveyed()
    const g = groundAt(6, 6)
    const s = terrainSession!
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect(Q().arm([g[0], g[1] + 1, g[2]])).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    const left = T().exit()
    await vi.advanceTimersByTimeAsync(500)
    await left
    expect(T().active).toBe(false)
    expect(Q().charges).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(FUSE_MS - 1500 - 1)
    expect(Q().charges).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(Q().charges).toHaveLength(0)
    // Blasted, not fizzled: the field it was placed in is cleared round it, and it left drops to collect.
    expect(T().message).not.toBe(FIZZLED)
    expect(s.world.blockCs(...g)).toBe(EMPTY)
    expect(Q().drops.length).toBeGreaterThan(0)
  })

  it('clears exactly the 7 by 7 by 7 cells centred on the charge, as mining would, in your own layer; the rest stands', async () => {
    await openSurveyed()
    const s = terrainSession!
    const g = groundAt(6, 6)
    const c: [number, number, number] = [g[0], g[1] - 1, g[2]]
    const before = snapshot(c, 4)
    const inBox = (k: string): boolean => k.split(',').map(Number).every((v, a) => Math.abs(v - c[a]) <= 3)
    const solidInBox = [...before].filter(([k, id]) => inBox(k) && id !== EMPTY).length
    expect(solidInBox).toBeGreaterThan(20)
    const ops = pendingOps()
    expect(blastCells(c)).toHaveLength(BLAST_SIDE ** 3)
    expect(new Set(blastCells(c).map((x) => x.join(','))).size).toBe(343)
    Q().arm(c)
    Q().detonate(Q().charges[0].id)
    const after = snapshot(c, 4)
    for (const [k, id] of before) {
      if (inBox(k)) expect(after.get(k), k).toBe(EMPTY)
      else expect(after.get(k), k).toBe(id)
    }
    // One change in your layer for each block taken, as mining writes them: in the log, or past FOLD_AT folded into the chunk's layer.
    const grew = pendingOps() - ops
    expect(grew === solidInBox || (grew < solidInBox && s.layers.has(s.world.slotAtCs(...c)!.key))).toBe(true)
    for (const [k, id] of before) if (inBox(k) && id !== EMPTY) {
      const [x, y, z] = k.split(',').map(Number)
      const at = s.world.locate(x, y, z)
      expect(at.slot!.own![at.cell]).toBe(EMPTY)
    }
    expect(Q().tally).toEqual({ placed: 1, quarried: solidInBox })
  })

  it('leaves cells out of reach and chunks you cannot build in as they are', async () => {
    await openSurveyed()
    const s = terrainSession!
    // The head at (16, 16, 16) of its chunk; the chunk at -x is unsurveyed by you and its cells near the edge stay.
    const west = s.world.slotAt(-1, 0, 0)!
    expect(west.own ?? null).toBeNull()
    const taken = T().blast([[-2, 10, 10], [-1, 10, 10]])
    expect(taken).toEqual([])
  })

  it('a charge whose identity is gone by its blast fizzles, and clears nothing', async () => {
    await openSurveyed()
    const g = groundAt(6, 6)
    Q().arm([g[0], g[1] + 1, g[2]])
    const charge = Q().charges[0]
    useQuarry.setState({ charges: [{ ...charge, owner: 'f'.repeat(64) }] })
    Q().detonate(charge.id)
    expect(T().message).toBe(FIZZLED)
    expect(terrainSession!.world.blockCs(...g)).not.toBe(EMPTY)
  })
})

describe('the drops', () => {
  /** A blast in the ground at (6, 6), away from where you stand; what it took. */
  async function blastNear(): Promise<{ c: [number, number, number]; taken: number }> {
    await openSurveyed()
    const g = groundAt(6, 6)
    const c: [number, number, number] = [g[0], g[1] - 1, g[2]]
    const before = snapshot(c, 3)
    Q().arm(c)
    Q().detonate(Q().charges[0].id)
    return { c, taken: [...before.values()].filter((id) => id !== EMPTY).length }
  }

  it('one per block taken, each the block mining would carry, floating in its own cell for ten minutes', async () => {
    const t0 = Date.now()
    const { taken } = await blastNear()
    const drops = Q().drops
    expect(drops).toHaveLength(taken)
    expect(new Set(drops.map((d) => d.key)).size).toBe(taken)
    for (const d of drops) {
      expect(d.id).toBe(kindId(d.id))
      expect(d.expires).toBeGreaterThanOrEqual(t0 + DROP_LIFE_MS)
      expect(d.expires).toBeLessThanOrEqual(Date.now() + DROP_LIFE_MS)
    }
    expect(Q().owner).toBe(A)
  })

  it('walking into a drop\'s cell collects it: the count goes up by one, and it is gone', async () => {
    const { c } = await blastNear()
    const s = terrainSession!
    const o = s.world.origin
    const d = Q().drops.find((x) => x.key === cellKey(o.x + BigInt(c[0]), o.y + BigInt(c[1]), o.z + BigInt(c[2]), 0))!
    expect(d).toBeTruthy()
    // What the body takes there: the cell and the one over it.
    const above = Q().drops.filter((x) => x.key === cellKey(o.x + BigInt(c[0]), o.y + BigInt(c[1] + 1), o.z + BigInt(c[2]), 0)).length
    const had = T().inventory.counts[d.id] ?? 0
    const n = Q().drops.length
    const ops = pendingOps()
    const at = { x: o.x + BigInt(c[0]), y: o.y + BigInt(c[1]), z: o.z + BigInt(c[2]) }
    useCyberspace.setState({ position: at, cursor: at })
    expect(Q().drops.find((x) => x === d)).toBeUndefined()
    expect(Q().drops).toHaveLength(n - 1 - above)
    expect((T().inventory.counts[d.id] ?? 0) - had).toBeGreaterThanOrEqual(1)
    // Collecting writes nothing to your layer and publishes nothing.
    expect(pendingOps()).toBe(ops)
    expect(relay.published).toEqual([])
  })

  it('a quick step collects what it passed through, not only where it lands', async () => {
    const { c } = await blastNear()
    const o = terrainSession!.world.origin
    const at = (dx: number) => ({ x: o.x + BigInt(c[0] + dx), y: o.y + BigInt(c[1] - 2), z: o.z + BigInt(c[2]) })
    useCyberspace.setState({ position: at(-3), cursor: at(-3) })
    const mid = cellKey(o.x + BigInt(c[0]), o.y + BigInt(c[1] - 2), o.z + BigInt(c[2]), 0)
    expect(Q().drops.some((d) => d.key === mid)).toBe(true)
    useCyberspace.setState({ position: at(3), cursor: at(3) })
    expect(Q().drops.some((d) => d.key === mid)).toBe(false)
  })

  it('evaporate at ten minutes, and not before', async () => {
    await blastNear()
    const n = Q().drops.length
    Q().prune(Date.now() + DROP_LIFE_MS - 2000)
    expect(Q().drops).toHaveLength(n)
    Q().prune(Date.now() + DROP_LIFE_MS + 1)
    expect(Q().drops).toHaveLength(0)
  })

  it('are kept per npub in IndexedDB: a reload within the ten minutes finds them, with the time they had left', async () => {
    await blastNear()
    const kept = Q().drops.map((d) => ({ key: d.key, expires: d.expires, id: d.id }))
    await settle(60)
    const db = await openTerrainDb()
    expect(tidyDrops(await readDrops(db, A), Date.now())).toHaveLength(kept.length)
    // Another identity keeps none of them.
    expect(tidyDrops(await readDrops(db, 'd'.repeat(64)), Date.now())).toEqual([])
    db.close()
    reload()
    useQuarry.setState({ drops: [], owner: '', version: 0 })
    await openSurveyed()
    await vi.waitFor(() => expect(Q().drops).toHaveLength(kept.length), { timeout: 3000 })
    expect(Q().drops.map((d) => ({ key: d.key, expires: d.expires, id: d.id }))).toEqual(kept)
    // Past their time, a reload finds none.
    expect(tidyDrops(await (async () => { const d2 = await openTerrainDb(); const v = await readDrops(d2, A); d2.close(); return v })(), Date.now() + DROP_LIFE_MS + 1)).toEqual([])
  })

  it('are never published: the blast\'s cells go out as mining\'s do, the drops never', async () => {
    useCyberspace.setState({ live: false })
    await blastNear()
    await settle(60)
    expect(relay.published).toEqual([])
    // Nothing in the store's code can publish: it imports no relay at all.
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../useQuarry.ts', import.meta.url), 'utf8'))
    expect(src).not.toMatch(/from '[^']*\/relay'/)
  })
})
