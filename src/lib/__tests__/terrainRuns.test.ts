/**
 * terrainRuns.test.ts: a run's answer is folded into the cache under the
 * block keys worked out when it was asked for (terrainCache requestRun,
 * 2026-10-20), whether the caller handed those keys in or the cache wrote
 * them out itself. Each cell's block must end up known with that cell's
 * value and no longer asked for, exactly as when the keys were rebuilt from
 * the cells on arrival.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Plane } from 'cyberspace-core'

const fake = vi.hoisted(() => ({
  listeners: [] as ((event: { data: unknown }) => void)[],
  posted: [] as { id: number; count: number }[],
}))

vi.mock('../workers', () => ({
  getTerrainWorkers: () => [{ addEventListener: (_: string, listener: (event: { data: unknown }) => void) => { fake.listeners.push(listener) } }],
  postRun: (request: { id: number; count: number }) => { fake.posted.push(request) },
  setRunDropHandler: () => {},
}))

const { BLOCK_SIZE, blockKey, inflightRuns, isKeyPending, isPending, readK, readKey, requestRun } = await import('../terrainCache')

/** Answer every posted run, giving cell i of run r the value (r * 7 + i) % 200. */
function answerAll(): void {
  for (const { id, count } of fake.posted.splice(0)) {
    const values = Uint8Array.from({ length: count }, (_, i) => (id * 7 + i) % 200)
    for (const listener of fake.listeners) listener({ data: { id, values, elapsedMs: 0 } })
  }
}

const BASE = (1n << 84n) + 123_456_789_012_345_678_901n
const plane = 0 as Plane

describe('requestRun', () => {
  it('marks a run\'s blocks asked for, then known with their values, with or without keys handed in', () => {
    // One run per block along x, and one at half the block size, where two
    // cells share each block and the later cell's answer is the one kept.
    const runs = [
      { originX: BASE, originY: BASE / 3n, originZ: BASE / 7n, axis: 'x' as const, step: BLOCK_SIZE, count: 19, plane },
      { originX: BASE / 5n, originY: BASE / 11n, originZ: BASE, axis: 'z' as const, step: -BLOCK_SIZE * 4n, count: 19, plane },
      { originX: BASE / 13n, originY: BASE, originZ: BASE / 17n, axis: 'y' as const, step: BLOCK_SIZE / 2n, count: 12, plane },
    ]
    for (const withKeys of [false, true]) {
      for (const run of runs) {
        const spec = { ...run, originX: run.originX + (withKeys ? BLOCK_SIZE * 1000n : 0n) }
        const cells: [bigint, bigint, bigint][] = []
        const at = { x: spec.originX, y: spec.originY, z: spec.originZ }
        for (let i = 0; i < spec.count; i++, at[spec.axis] += spec.step) cells.push([at.x, at.y, at.z])
        const keys = cells.map(([x, y, z]) => blockKey(x, y, z, plane))

        requestRun(spec, withKeys ? keys : undefined)
        // An identical run already in flight is not asked for twice.
        requestRun(spec, withKeys ? keys : undefined)
        expect(fake.posted.length).toBe(1)
        expect(inflightRuns()).toBe(1)
        for (const [x, y, z] of cells) {
          expect(isPending(x, y, z, plane)).toBe(true)
          expect(readK(x, y, z, plane)).toBeUndefined()
        }

        const id = fake.posted[0].id
        answerAll()
        expect(inflightRuns()).toBe(0)
        cells.forEach(([x, y, z], i) => {
          // A later cell in the same block overwrites with the same block's K.
          const last = keys.lastIndexOf(keys[i])
          expect(readK(x, y, z, plane)).toBe((id * 7 + last) % 200)
          expect(readKey(keys[i])).toBe((id * 7 + last) % 200)
          expect(isPending(x, y, z, plane)).toBe(false)
          expect(isKeyPending(keys[i])).toBe(false)
          // Any cell of the block reads the same.
          expect(readK(x + BLOCK_SIZE - 1n - (x % BLOCK_SIZE), y, z, plane)).toBe((id * 7 + last) % 200)
        })
      }
    }
  })
})
