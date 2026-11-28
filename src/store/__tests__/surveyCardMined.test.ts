/**
 * surveyCardMined.test.ts - the survey card's MINED through the real store
 * (owner, 2026-11-28: "can we make the card live update how many of the
 * blocks in the chunk you've mined and how many are left total?"): mining,
 * placing and a Quarry Charge's blast write your own blocks, and the card
 * (terrain/surveyCard.ts cardFor) counts what you took out of the chunk's
 * ground at the revision it shows. A block you placed and mined again is not
 * mined from the ground; every block a blast took is.
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  publish: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { groundFor, setTerrainSession, terrainSession, useTerrain } from '../useTerrain'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import { EMPTY } from '../../lib/terrain/blocks'
import { forgetAssays } from '../../lib/terrain/assay'
import { cardFor } from '../../terrain/surveyCard'
import type { Position } from '../../lib/space'

let run = 0
const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

function as(pubkey: string, at: Position = HEAD): void {
  useCyberspace.setState({ identity: { pubkey, npub: '' }, position: { ...at }, cursor: { ...at }, anchor: { ...at }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null, live: false })
}

async function openSurveyed(): Promise<string> {
  await T().enter()
  const key = chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))
  if (!terrainSession!.world.slotByKey(key)?.surveyed) await T().survey(key)
  await settle()
  return key
}

/** The highest solid cell in a column of the chunk you stand in (cs offsets). */
function groundAt(x: number, z: number): [number, number, number] {
  const s = terrainSession!
  for (let y = 30; y >= 4; y--) if (s.world.blockCs(x, y, z) !== EMPTY && s.world.blockCs(x, y + 1, z) === EMPTY) return [x, y, z]
  throw new Error('no ground here')
}

const minedOf = (card: NonNullable<Awaited<ReturnType<typeof cardFor>>>): Map<number, number> =>
  new Map([...card.card.finds, ...card.card.common].filter((r) => r.mined > 0).map((r) => [r.id, r.mined]))

beforeEach(async () => {
  if (T().active) await T().exit()
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  useCyberspace.setState({ walking: false })
  forgetAssays()
  run++
  useWalk.setState({ gravity: false })
  as(run.toString(16).padStart(64, 'd'))
})

describe('MINED through the real store', () => {
  it('mining counts the kind taken from the ground; placing and mining it again does not; a blast counts every block it took', async () => {
    const key = await openSurveyed()
    const s = terrainSession!
    const ground = (await groundFor(key)).blocks
    const start = (await cardFor(key))!
    expect(start.card.minedTotal).toBe(0)
    const left0 = start.card.total

    // Mine one block of the ground.
    const g = groundAt(6, 6)
    const kind = s.world.blockCs(...g)
    expect(T().mine({ cell: g, normal: [0, 1, 0], distance: 1 })).toBe(true)
    let card = (await cardFor(key))!
    expect(minedOf(card)).toEqual(new Map([[kind, 1]]))
    expect(card.card.total).toBe(left0 - 1)

    // Place what you carried on the ground beside it, in open air, and mine it again: not mined from the ground.
    const h = groundAt(9, 9)
    const up: [number, number, number] = [h[0], h[1] + 1, h[2]]
    expect(T().place({ cell: h, normal: [0, 1, 0], distance: 1 })).toBe(true)
    expect(s.world.blockCs(...up)).not.toBe(EMPTY)
    card = (await cardFor(key))!
    expect(card.card.minedTotal).toBe(1)
    expect(card.card.total).toBe(left0)
    expect(T().mine({ cell: up, normal: [0, 1, 0], distance: 1 })).toBe(true)
    card = (await cardFor(key))!
    expect(minedOf(card)).toEqual(new Map([[kind, 1]]))
    expect(card.card.total).toBe(left0 - 1)

    // A Quarry Charge's blast: 3 by 3 by 3 under the ground at (12, 12), every block it took counted by its ground kind.
    const b = groundAt(12, 12)
    const cells: Array<[number, number, number]> = []
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) cells.push([b[0] + dx, b[1] - 1 + dy, b[2] + dz])
    const slot = s.world.slotByKey(key)!
    const want = new Map(minedOf(card))
    for (const c of cells) {
      const at = s.world.locate(c[0], c[1], c[2])
      if (at.slot !== slot) continue
      const id = ground[at.cell]
      if (id !== EMPTY && s.world.blockCs(...c) !== EMPTY) want.set(id, (want.get(id) ?? 0) + 1)
    }
    const taken = T().blast(cells)
    expect(taken.length).toBeGreaterThan(5)
    card = (await cardFor(key))!
    expect(minedOf(card)).toEqual(want)
    expect(card.card.minedTotal).toBe(1 + taken.length)
    expect(card.card.total).toBe(left0 - 1 - taken.length)
  })
})
