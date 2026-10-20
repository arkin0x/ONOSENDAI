/**
 * terrainScan.test.ts: the volume scan steps along its rows and lets the
 * cells of one block share an answer (useTerrainVolume scanVolume,
 * 2026-10-20). It must fill exactly the cells, and ask for exactly the runs,
 * that a cell-by-cell scan does: checked here against that scan, kept below
 * as it was, over many places, turns, zooms and states of the cache.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Plane } from 'cyberspace-core'
import type { AxisName, Position, ViewAxes } from '../../lib/space'

const fake = vi.hoisted(() => {
  // The terrain worker's module, where UNKNOWN lives, installs its message
  // handler on `self` when imported.
  ;(globalThis as { self?: unknown }).self ??= globalThis
  return { seed: 0, runs: [] as unknown[] }
})

vi.mock('../../lib/terrainCache', async (original) => {
  const real = await original<typeof import('../../lib/terrainCache')>()
  // A block's state from its key: known (with a K), asked for, or neither.
  const roll = (key: string): number => {
    let h = fake.seed
    for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0
    return (h >>> 0) % 997
  }
  return {
    ...real,
    readK: (x: bigint, y: bigint, z: bigint, plane: Plane) => { const r = roll(real.blockKey(x, y, z, plane)); return r % 3 === 0 ? r % 200 : undefined },
    isPending: (x: bigint, y: bigint, z: bigint, plane: Plane) => roll(real.blockKey(x, y, z, plane)) % 3 === 1,
    requestRun: (spec: unknown) => { fake.runs.push(spec) },
  }
})

const { scanVolume, VOLUME_RADIUS, VOLUME_SIZE } = await import('../useTerrainVolume')
const { BLOCK_BITS, BLOCK_SIZE, blockKey, isPending, readK, requestRun } = await import('../../lib/terrainCache')
const { UNKNOWN } = await import('../../workers/terrain.worker')

/** The scan as it was before 2026-10-20: every cell built and looked up on its own. */
function referenceScan(centre: Position, axes: ViewAxes, scaleExp: number, plane: Plane): Uint8Array {
  const cellAt = (origin: Position, step: bigint, col: number, row: number, depth: number): Position => {
    const p: Position = { ...origin }
    const put = (a: AxisName, n: number, dir: number): void => { p[a] = origin[a] + BigInt(Math.round(n)) * step * BigInt(dir) }
    put(axes.right.axis, col, axes.right.dir)
    put(axes.up.axis, row, axes.up.dir)
    put(axes.out.axis, depth, axes.out.dir)
    return p
  }
  const R = VOLUME_RADIUS
  const N = VOLUME_SIZE
  const step = 1n << BigInt(scaleExp)
  const values = new Uint8Array(N * N * N).fill(UNKNOWN)
  const stride = step >= BLOCK_SIZE ? step : BLOCK_SIZE
  const order = (n: number): number[] => Array.from({ length: n }, (_, i) => i - R).sort((a, b) => Math.abs(a) - Math.abs(b))
  for (const depth of order(N)) {
    for (const row of order(N)) {
      const samples: bigint[] = []
      const seen = new Set<bigint>()
      let rowCell: Position | null = null
      for (let col = -R; col <= R; col++) {
        const p = cellAt(centre, step, col, row, depth)
        const known = readK(p.x, p.y, p.z, plane)
        if (known !== undefined) { values[((depth + R) * N + (row + R)) * N + (col + R)] = known; continue }
        if (isPending(p.x, p.y, p.z, plane)) continue
        const block = p[axes.right.axis] >> BLOCK_BITS
        if (seen.has(block)) continue
        seen.add(block)
        rowCell = p
        samples.push(block << BLOCK_BITS)
      }
      if (!rowCell || samples.length === 0) continue
      samples.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      let start = 0
      for (let i = 1; i <= samples.length; i++) {
        if (i === samples.length || samples[i] - samples[i - 1] !== stride) {
          const p: Position = { ...rowCell }
          p[axes.right.axis] = samples[start]
          requestRun({ originX: p.x, originY: p.y, originZ: p.z, axis: axes.right.axis, step: stride, count: i - start, plane })
          start = i
        }
      }
    }
  }
  return values
}

const AXES: AxisName[][] = [['x', 'y', 'z'], ['x', 'z', 'y'], ['y', 'x', 'z'], ['y', 'z', 'x'], ['z', 'x', 'y'], ['z', 'y', 'x']]

/** Deterministic 85-bit spread, so a failure is reproducible. */
function sample(i: number): bigint {
  const a = BigInt(i + 1) * 0x9e3779b97f4a7c15n
  return ((a * a) >> 7n) & ((1n << 85n) - 1n)
}

describe('scanVolume', () => {
  it('fills the same cells and asks for the same runs as a cell-by-cell scan', () => {
    let cases = 0
    for (let i = 0; i < 48; i++) {
      const [r, u, o] = AXES[i % 6]
      const axes: ViewAxes = { right: { axis: r, dir: i % 2 ? 1 : -1 }, up: { axis: u, dir: i % 3 ? 1 : -1 }, out: { axis: o, dir: i % 5 ? -1 : 1 } }
      const centre: Position = { x: sample(3 * i), y: sample(3 * i + 1), z: sample(3 * i + 2) }
      const scaleExp = [0, 1, 2, 3, 4, 7, 12, 30][i % 8]
      const plane = (i % 2) as Plane
      fake.seed = i * 7919
      fake.runs = []
      const want = referenceScan(centre, axes, scaleExp, plane)
      const wantRuns = fake.runs
      fake.runs = []
      const got = scanVolume(centre, axes, scaleExp, plane)
      expect(got).toEqual(want)
      expect(fake.runs).toEqual(wantRuns)
      cases++
    }
    expect(cases).toBe(48)
    // 96 full scans: generous, for a suite run on a busy machine.
  }, 60_000)
})

describe('blockKey', () => {
  it('is the block of each axis and the plane, whatever was keyed before it', () => {
    const plain = (x: bigint, y: bigint, z: bigint, plane: number): string => `${x >> BLOCK_BITS},${y >> BLOCK_BITS},${z >> BLOCK_BITS},${plane}`
    for (let i = 0; i < 400; i++) {
      // Axes repeating and changing in every combination, as rows and runs do.
      const x = sample(i % 7), y = sample(100 + (i % 3)), z = i % 2 ? sample(200 + i) : sample(200)
      const plane = (i % 2) as Plane
      expect(blockKey(x, y, z, plane)).toBe(plain(x, y, z, plane))
      expect(blockKey(x + 1n, y, z, plane)).toBe(plain(x + 1n, y, z, plane))
    }
  })
})
