/**
 * surveyCardFlow.test.ts - the survey card in the real store (owner,
 * 2026-11-27): a survey keeps what the generator said of the chunk's ground
 * (its type and hardness) and when it was surveyed, kept across a reload;
 * the card counts what really stands there now, mines and placings included;
 * CARD is offered in the chunk you stand in once it is surveyed; and a
 * survey that completes opens its card by itself, once.
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
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { cardChunkHere, setTerrainSession, terrainSession, useTerrain } from '../useTerrain'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import { generate } from '../../lib/terrain/generate'
import { EMPTY } from '../../lib/terrain/blocks'
import { cardFor, resetSurveyCards, useSurveyCard } from '../../terrain/surveyCard'
import { surveyChunk } from '../../terrain/TerrainView'
import type { RayHit } from '../../lib/terrain/raycast'

let run = 0
let A = ''
const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))
const headKey = (): string => chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))
const hitAt = (dx: number, dy: number, dz: number): RayHit => ({ cell: [dx, dy, dz], normal: [0, 1, 0], distance: 1 })

function reload(): void {
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  useCyberspace.setState({ walking: false })
}

beforeEach(async () => {
  if (T().active) await T().exit()
  reload()
  resetSurveyCards()
  run++
  A = run.toString(16).padStart(64, 'c')
  useWalk.setState({ gravity: false })
  useCyberspace.setState({ identity: { pubkey: A, npub: '' }, position: { ...HEAD }, cursor: { ...HEAD }, anchor: { ...HEAD }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null })
})

/** Counts of each id in `blocks`, scanned directly. */
function scan(blocks: Uint8Array): Map<number, number> {
  const m = new Map<number, number>()
  for (const id of blocks) if (id) m.set(id, (m.get(id) ?? 0) + 1)
  return m
}

describe('the survey card in the store', () => {
  it('a survey keeps the ground\'s type and hardness from the generator, and the time; the card counts what stands', async () => {
    await T().enter()
    const key = headKey()
    const s = terrainSession!
    expect(cardChunkHere()).toBeNull()
    const t0 = Date.now()
    await T().survey(key)
    const slot = s.world.slotByKey(key)!
    const g = generate(slot.base)
    expect(slot.ground).toEqual({ family: g.family, maxK: g.maxK, meanK: g.meanK, top: g.top })
    expect(s.surveyedAt?.get(key)).toBeGreaterThanOrEqual(t0)
    // CARD: you stand in it, and it is surveyed.
    expect(cardChunkHere()).toBe(key)
    const got = cardFor(key)!
    expect(got.at).toBe(s.surveyedAt!.get(key))
    expect(got.card.ground?.family).toBe(g.family)
    const direct = scan(slot.blocks!)
    for (const r of [...got.card.finds, ...got.card.common]) expect(r.count).toBe(direct.get(r.id))
    expect(got.card.finds.length + got.card.common.length).toBe(direct.size)
  })

  it('a block mined, and one placed, change the card\'s counts (through your layer)', async () => {
    await T().enter()
    const key = headKey()
    await T().survey(key)
    const s = terrainSession!
    const slot = s.world.slotByKey(key)!
    // A solid cell low in the chunk (clear of the walker) standing on another: mined, then placed back on the one below.
    let cell: [number, number, number] | null = null
    for (let o = 1024; o < 11 * 1024 && !cell; o++) if (slot.blocks![o] !== EMPTY && slot.blocks![o - 1024] !== EMPTY) cell = [o & 31, o >> 10, (o >> 5) & 31]
    expect(cell).not.toBeNull()
    const id = s.world.blockCs(...cell!)
    const before = cardFor(key)!.card
    const count = (c: typeof before, k: number): number => [...c.finds, ...c.common].find((r) => r.id === k)?.count ?? 0
    expect(T().mine(hitAt(...cell!))).toBe(true)
    const mined = cardFor(key)!.card
    expect(count(mined, id)).toBe(count(before, id) - 1)
    expect(mined.total).toBe(before.total - 1)
    // Placed back where it was, on the top face of the block below: the count is whole again.
    T().assignSlot(id)
    expect(T().place({ cell: [cell![0], cell![1] - 1, cell![2]], normal: [0, 1, 0], distance: 1 })).toBe(true)
    expect(count(cardFor(key)!.card, id)).toBe(count(before, id))
    expect(cardFor(key)!.card.total).toBe(before.total)
  })

  it('the survey time is kept across a reload, for the card\'s date', async () => {
    await T().enter()
    const key = headKey()
    await T().survey(key)
    const at = terrainSession!.surveyedAt!.get(key)!
    await T().exit()
    await settle()
    reload()
    await T().enter()
    await terrainSession!.ready
    expect(terrainSession!.surveyedAt?.get(key)).toBe(at)
  })

  it('a survey that completes opens its card by itself, once', async () => {
    await T().enter()
    const key = headKey()
    expect(surveyChunk(key)).toBe(true)
    await settle(60)
    expect(useSurveyCard.getState()).toMatchObject({ open: key, auto: true })
    useSurveyCard.setState({ open: null, auto: false })
    // Asked again (already yours): nothing surveyed, nothing opens.
    expect(surveyChunk(key)).toBe(false)
    await settle(60)
    expect(useSurveyCard.getState().open).toBeNull()
  })

  it('a survey that fails opens no card', async () => {
    await T().enter()
    const key = headKey()
    const real = T().survey
    useTerrain.setState({
      survey: async (k: string) => {
        useTerrain.setState({ surveying: [...T().surveying, k] })
        await settle(5)
        useTerrain.setState({ surveying: T().surveying.filter((x) => x !== k) })
      },
    })
    try {
      expect(surveyChunk(key)).toBe(true)
      await settle(40)
      expect(useSurveyCard.getState().open).toBeNull()
    } finally {
      useTerrain.setState({ survey: real })
    }
  })
})
