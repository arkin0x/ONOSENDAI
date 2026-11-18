/**
 * restWallsBound.test.ts - the walls avatars stand on (walkWalls restDrop)
 * are kept within a bound, least recently asked let go first (2026-11-18).
 *
 * A shard moved or hidden again in BUILD is a new world item with a new key,
 * so every move left the walls of where the shard had been, and its whole
 * model, in restDrop's cache until 512 had gathered. Each build here is a new
 * key for the same place, as a session of moves is; a world holding many
 * shards at once checks the bounds by count and by bytes.
 *
 * The fixture is authored here: no kit piece is ever a fixture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})
vi.mock('../../lib/relay', async (orig) => {
  const mod = await orig<typeof import('../../lib/relay')>()
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...mod, ...offlineRelay, publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []) }
})

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useShards, type WorldItem } from '../useShards'
import { REST_BYTES_MAX, REST_ENTRIES_MAX, clearWalls, restDrop, restWallsKept } from '../walkWalls'
import { withConstrain } from '../../lib/walkConstrain'
import type { Position } from '../../lib/space'

const worldItemsOriginal = useShards.getState().worldItems

/** A slab under the gibson, `cells` by `cells` quads of floor: its size in triangles is ours to choose. */
function slab(name: string, cells: number): ShardModel {
  const vertices: ShardModel['vertices'] = []
  const faces: Array<[number, number, number]> = []
  const half = Math.floor(cells / 2)
  for (let i = 0; i <= cells; i++) for (let k = 0; k <= cells; k++) vertices.push({ p: [i - half, -1, k - half], c: [1, 1, 1] })
  const at = (i: number, k: number): number => i * (cells + 1) + k
  for (let i = 0; i < cells; i++) for (let k = 0; k < cells; k++) faces.push([at(i, k), at(i, k + 1), at(i + 1, k + 1)], [at(i, k), at(i + 1, k + 1), at(i + 1, k)])
  return withConstrain({ ...newShard(name), mode: 'solid', vertices, faces }, 'all')
}

const start: Position = { x: 1_000_000n, y: 1_000_000n, z: 1_000_000n }

/** The world holds these shards under `start`, each under its own key: a placement made again is a new key. */
function placed(list: Array<[ShardModel, string]>): void {
  const plane = useCyberspace.getState().plane as WorldItem['plane']
  const items: WorldItem[] = list.map(([shard, key]) => ({ key, type: 'shard', at: start, plane, height: 84, mine: true, shard }))
  useShards.setState({ worldItems: () => items })
}

beforeEach(() => clearWalls())
afterEach(() => {
  useShards.setState({ worldItems: worldItemsOriginal })
  clearWalls()
})

describe('restDrop keeps the walls it built within a bound', () => {
  it('stands the avatar on the slab whatever the key', () => {
    const plane = useCyberspace.getState().plane
    const floor = slab('Small slab', 4)
    for (let n = 0; n < 3; n++) {
      placed([[floor, `move-${n}`]])
      expect(restDrop(start, plane).drop).toBeCloseTo(1, 9)
    }
  })

  it('a shard moved again and again keeps only the walls of where it is now', () => {
    const plane = useCyberspace.getState().plane
    const floor = slab('Small slab', 2)
    const once = (() => { placed([[floor, 'first']]); restDrop(start, plane); return restWallsKept().bytes })()
    for (let n = 0; n < 300; n++) {
      placed([[floor, `move-${n}`]])
      restDrop(start, plane)
    }
    expect(restWallsKept()).toEqual({ count: 1, bytes: once })
  })

  it('a shard still in the world keeps its walls while another is moved beside it', () => {
    const plane = useCyberspace.getState().plane
    const floor = slab('Small slab', 2)
    for (let n = 0; n < 20; n++) {
      placed([[floor, 'stays'], [floor, `moved-${n}`]])
      restDrop(start, plane)
    }
    expect(restWallsKept().count).toBe(2)
  })

  it('many shards in the world at once keep no more than REST_ENTRIES_MAX builds', () => {
    const plane = useCyberspace.getState().plane
    const floor = slab('Small slab', 2)
    placed(Array.from({ length: REST_ENTRIES_MAX * 2 }, (_, n): [ShardModel, string] => [floor, `here-${n}`]))
    expect(restDrop(start, plane).drop).toBeCloseTo(1, 9)
    expect(restWallsKept().count).toBe(REST_ENTRIES_MAX)
  })

  it('and no more than REST_BYTES_MAX of triangles, however few the builds', () => {
    const plane = useCyberspace.getState().plane
    // About 2.4 MB of triangles a build (72 bytes a triangle): the bytes bind long before the count.
    const big = slab('Big slab', 128)
    placed(Array.from({ length: 40 }, (_, n): [ShardModel, string] => [big, `big-${n}`]))
    expect(restDrop(start, plane).drop).toBeCloseTo(1, 9)
    const kept = restWallsKept()
    expect(kept.bytes).toBeLessThanOrEqual(REST_BYTES_MAX)
    expect(kept.count).toBeLessThan(40)
    expect(kept.count).toBeGreaterThan(1)
  })

  it('clearWalls forgets them, bytes and all', () => {
    const plane = useCyberspace.getState().plane
    placed([[slab('Small slab', 2), 'one']])
    restDrop(start, plane)
    expect(restWallsKept().count).toBe(1)
    clearWalls()
    expect(restWallsKept()).toEqual({ count: 0, bytes: 0 })
  })
})
