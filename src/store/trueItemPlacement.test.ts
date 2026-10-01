/**
 * trueItemPlacement.test.ts - where a deploy hides an item, and where the
 * camera looks when you go to one (arkinox, 2026-10-01).
 *
 * A deploy hides the item at deployPoint: the centre of the cursor's cell at
 * the zoom you build in, or of the region for a bag smaller than a cell, and
 * the cursor itself at 2^0. The ghost is drawn at itemCentre of that same
 * point, so these run the real deploy and check the stored coordinate is it.
 * Going to an item (focusItem) frames it where it is drawn, at every zoom.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The stores keep shards and deployments in localStorage; the test runs where
// there is none.
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { alignTo, deployPoint, itemCentre, MAX_SCALE_EXP, type Position } from '../lib/space'
import { alignedOrigin, useCyberspace } from './useCyberspace'
import { positionOf, useShards } from './useShards'
import { useWorkshop } from './useWorkshop'

const S = () => useCyberspace.getState()

/** A cursor with bits set all the way down, so no zoom's cell centre is it by accident. */
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4n, z: (1n << 72n) + 0x7e5n }

function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Pebble'),
    unit: 0,
    vertices: [
      { p: [0, 0, 0], c: [1, 0, 0] },
      { p: [1, 0, 0], c: [0, 1, 0] },
      { p: [0, 1, 0], c: [0, 0, 1] },
    ],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

const flat = (v: number[]): number[] => v.map((n) => n + 0)

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  S().clearFocus()
  useCyberspace.setState({ live: false, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
})

describe('a deploy hides its item at the centre of the cursor cell', () => {
  // Heights are kept small: the test computes the region key for real.
  const CASES: Array<[scaleExp: number, height: number]> = [[0, 0], [0, 6], [1, 6], [3, 6], [6, 6], [5, 2], [9, 0], [9, 4]]

  for (const [scaleExp, height] of CASES) {
    it(`at 2^${scaleExp}, height ${height}`, async () => {
      const shard = benchShard()
      useCyberspace.setState({ scaleExp })
      useShards.getState().startDeployShard(shard.id)
      useShards.getState().setDeployHeight(height)
      expect(useShards.getState().deployHeight).toBe(height)
      await useShards.getState().deploy()
      expect(useShards.getState().deployStatus).toBe('done')

      const at = positionOf(useShards.getState().mine[0])
      expect(at).toEqual(deployPoint(CURSOR, scaleExp, height))
      if (scaleExp === 0) expect(at).toEqual(CURSOR)
      for (const a of ['x', 'y', 'z'] as const) {
        // In the cursor's cell, and in the region the cursor's cage shows.
        expect(alignTo(at[a], scaleExp)).toBe(alignTo(CURSOR[a], scaleExp))
        expect(alignTo(at[a], height)).toBe(alignTo(CURSOR[a], height))
      }
      // Where it is drawn is where the ghost was: itemCentre of that point.
      const origin = alignedOrigin(CURSOR, scaleExp)
      const axes = S().axes()
      expect(itemCentre(at, origin, scaleExp, axes)).toEqual(itemCentre(deployPoint(CURSOR, scaleExp, height), origin, scaleExp, axes))
    })
  }
})

describe('going to an item frames it where it is drawn', () => {
  it('at every zoom from 2^0 to 2^84', () => {
    for (let scaleExp = 0; scaleExp <= MAX_SCALE_EXP; scaleExp++) {
      S().focusItem(CURSOR, 0, 'A SHARD', scaleExp)
      expect(S().focus?.item).toBe(true)
      expect(S().scaleExp).toBe(scaleExp)
      const drawn = itemCentre(CURSOR, alignedOrigin(S().anchor, scaleExp), scaleExp, S().axes())
      expect(flat(S().cursorOffset()), `scaleExp ${scaleExp}`).toEqual(flat(drawn))
    }
  })

  it('leaves a plain focus, a stop, on the markers\' policy', () => {
    S().focusOn(CURSOR, 0, 'A STOP', 20)
    expect(S().focus?.item).toBeUndefined()
    expect(flat(S().cursorOffset())).toEqual([0, 0, 0])
  })
})
