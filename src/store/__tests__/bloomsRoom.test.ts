/**
 * bloomsRoom.test.ts: wantSeeds with `room` (review of #701). A list asking
 * for its rows' blooms (DISCOVERED NEARBY's SEEDS) adds only as many new
 * seeds as fit under BLOOMS_KEPT and forgets none, so a bloom the world is
 * drawing is never pushed out; without `room` the oldest wanted are forgotten
 * as before. The engine and its sources are stand-ins: no network, no worker.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const engine = vi.hoisted(() => ({ order: [] as string[], forgot: [] as string[] }))
vi.mock('../../lib/seeds/bloomEngine', () => ({
  BloomEngine: class {
    want(seeds: Array<{ id: string }>): void { for (const s of seeds) if (!engine.order.includes(s.id)) engine.order.push(s.id) }
    wanted(): string[] { return [...engine.order] }
    forget(ids: string[]): void { engine.forgot.push(...ids); engine.order = engine.order.filter((id) => !ids.includes(id)) }
    refreshAll(): void {}
    growAnyway(): void {}
  },
}))
vi.mock('../../lib/seeds/seedSources', () => ({
  dnaResolver: { onChange: () => () => undefined },
  fetchSeedHeaders: async () => undefined,
  headerBook: {},
  refreshTrustedTip: async () => null,
  trustedTip: () => null,
  TIP_REFRESH_MS: 1e9,
}))
vi.mock('../../lib/seeds/growClient', () => ({ growInWorker: async () => ({}), forgetInWorker: () => undefined }))

import { BLOOMS_KEPT, wantSeeds } from '../useBlooms'
import type { SeedItem } from '../../lib/seeds/seedItem'

const seeds = (prefix: string, n: number): SeedItem[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }) as SeedItem)

beforeEach(() => { engine.order = []; engine.forgot = [] })

describe('wantSeeds with room', () => {
  it('adds only what fits under BLOOMS_KEPT and forgets nothing the world wants', () => {
    const world = seeds('w', BLOOMS_KEPT - 2)
    wantSeeds(world)
    wantSeeds(seeds('l', 5), { room: true })
    expect(engine.order).toHaveLength(BLOOMS_KEPT)
    expect(engine.forgot).toEqual([])
    for (const s of world) expect(engine.order).toContain(s.id)
    expect(engine.order.slice(-2)).toEqual(['l0', 'l1'])
  })

  it('asks again for nothing already wanted, and adds nothing when full', () => {
    wantSeeds(seeds('w', BLOOMS_KEPT))
    wantSeeds([...seeds('w', 3), ...seeds('l', 3)], { room: true })
    expect(engine.order).toHaveLength(BLOOMS_KEPT)
    expect(engine.order.some((id) => id.startsWith('l'))).toBe(false)
    expect(engine.forgot).toEqual([])
  })

  it('without room, the oldest wanted are still forgotten to make way', () => {
    wantSeeds(seeds('w', BLOOMS_KEPT))
    wantSeeds(seeds('l', 3))
    expect(engine.forgot).toEqual(['w0', 'w1', 'w2'])
  })
})
