/**
 * terrainScan.test.ts: the volume is laid out once per place, zoom, turn and
 * plane, and read again on each terrain flush (useTerrainVolume layoutVolume
 * and readVolume, 2026-10-20). Every read must fill exactly the cells, and ask
 * for exactly the runs, that a cell-by-cell scan of the same cache does:
 * checked here against that scan, kept below as it was, over many places,
 * turns and zooms, and over flushes in which asked-for blocks become known,
 * others arrive from elsewhere, and some answers are outside the universe.
 */

import { describe, expect, it, vi } from 'vitest'
import type { Plane } from 'cyberspace-core'
import type { AxisName, Position, ViewAxes } from '../../lib/space'

const fake = vi.hoisted(() => {
  // The terrain worker's module, where UNKNOWN lives, installs its message
  // handler on `self` when imported.
  ;(globalThis as { self?: unknown }).self ??= globalThis
  return {
    seed: 0,
    runs: [] as unknown[],
    /** Runs whose keys were not blockKey of their cells, in order. */
    badKeys: 0,
    /** The cache: blocks known, with their K, and blocks asked for. */
    known: new Map<string, number>(),
    pending: new Set<string>(),
    /** Blocks whose first state has been rolled. */
    seen: new Set<string>(),
  }
})

/** A block's hash under the current seed, plus a salt. */
function roll(key: string, salt = 0): number {
  let h = fake.seed ^ salt
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0
  return h >>> 0
}

/** A block's state the first time anything looks at it: known, asked for, or neither. */
function firstLook(key: string): void {
  if (fake.seen.has(key)) return
  fake.seen.add(key)
  const r = roll(key) % 997
  if (r % 3 === 0) fake.known.set(key, kFor(key))
  else if (r % 3 === 1) fake.pending.add(key)
}

/** K for a block; now and then 255, which is what a cell outside the universe comes back as. */
function kFor(key: string): number {
  const r = roll(key, 0x5bd1e995)
  return r % 23 === 0 ? 255 : r % 200
}

vi.mock('../../lib/terrainCache', async (original) => {
  const real = await original<typeof import('../../lib/terrainCache')>()
  const readKey = (key: string): number | undefined => { firstLook(key); return fake.known.get(key) }
  const isKeyPending = (key: string): boolean => { firstLook(key); return fake.pending.has(key) }
  return {
    ...real,
    readKey,
    isKeyPending,
    readK: (x: bigint, y: bigint, z: bigint, plane: Plane) => readKey(real.blockKey(x, y, z, plane)),
    isPending: (x: bigint, y: bigint, z: bigint, plane: Plane) => isKeyPending(real.blockKey(x, y, z, plane)),
    // As the real one does, a run marks its blocks asked for, so a later row
    // of the same scan sees them pending. Keys handed in must be the cells'.
    requestRun: (spec: { originX: bigint; originY: bigint; originZ: bigint; axis: AxisName; step: bigint; count: number; plane: Plane }, keys?: readonly string[]) => {
      fake.runs.push(spec)
      const at = { x: spec.originX, y: spec.originY, z: spec.originZ }
      const want: string[] = []
      for (let i = 0; i < spec.count; i++, at[spec.axis] += spec.step) want.push(real.blockKey(at.x, at.y, at.z, spec.plane))
      if (keys && JSON.stringify(keys) !== JSON.stringify(want)) fake.badKeys++
      for (const k of want) fake.pending.add(k)
    },
  }
})

const { layoutVolume, readVolume, VOLUME_RADIUS, VOLUME_SIZE } = await import('../useTerrainVolume')
const { BLOCK_BITS, BLOCK_SIZE, blockKey, isPending, readK, requestRun } = await import('../../lib/terrainCache')
const { UNKNOWN } = await import('../../workers/terrain.worker')

/** The scan as it was before 2026-10-20: every cell built and looked up on its own. */
function referenceScan(centre: Position, axes: ViewAxes, scaleExp: number, plane: Plane): Uint8Array {
  const cellAt = (origin: Position, step: bigint, col: number, row: number, depth: number): Position => {
    const p: Position = { ...origin }
    const put = (a: AxisName, n: number, dir: number): void => { p[a] = origin[a] + BigInt(Number.isFinite(n) ? Math.round(n) : 0) * step * BigInt(dir) }
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

const EDGE = 1n << 85n

/** A centre: spread out, at the origin (rows cross into negatives), negative, or at and past the 2^85 edge. */
function centreFor(i: number): Position {
  const v = (k: number): bigint => {
    switch (i % 5) {
      case 0: return sample(3 * i + k)
      case 1: return BigInt(k * 3 - 4)
      case 2: return -sample(3 * i + k)
      case 3: return EDGE - BigInt(5 + k)
      default: return EDGE + BigInt(7 * k)
    }
  }
  return { x: v(0), y: v(1), z: v(2) }
}

function resetCache(seed: number): void {
  fake.seed = seed
  fake.runs = []
  fake.badKeys = 0
  fake.known = new Map()
  fake.pending = new Set()
  fake.seen = new Set()
}

/**
 * Between flushes: about half the blocks asked for come back, now and then
 * one never asked for arrives anyway (asked for by another view), and now and
 * then one asked for is given back unanswered, as a run dropped from the queue
 * or lost to a worker that threw is (terrainCache, setRunDropHandler).
 */
function deliver(epoch: number): void {
  for (const key of [...fake.pending]) {
    const r = roll(key, epoch)
    if (r % 2 === 0) { fake.pending.delete(key); fake.known.set(key, kFor(key)) }
    else if (r % 7 === 1) fake.pending.delete(key)
  }
  for (const key of fake.seen) {
    if (!fake.known.has(key) && !fake.pending.has(key) && roll(key, epoch * 7 + 1) % 5 === 0) fake.known.set(key, kFor(key))
  }
}

/**
 * Read `layout` and check it against the cell-by-cell scan of the same cache:
 * the same cells, the same runs in the same order, and the same blocks left
 * asked for. The scan runs on a copy of the cache; the read's cache is kept.
 */
function checkRead(layout: ReturnType<typeof layoutVolume>, centre: Position, axes: ViewAxes, scaleExp: number, plane: Plane): Uint8Array {
  const known = new Map(fake.known), pending = new Set(fake.pending), seen = new Set(fake.seen)
  fake.runs = []
  const want = referenceScan(centre, axes, scaleExp, plane)
  const wantRuns = fake.runs
  const wantPending = [...fake.pending].sort()
  fake.known = known; fake.pending = pending; fake.seen = seen
  fake.runs = []
  const got = readVolume(layout)
  expect(got).toEqual(want)
  expect(fake.runs).toEqual(wantRuns)
  expect([...fake.pending].sort()).toEqual(wantPending)
  expect(fake.badKeys).toBe(0)
  return got
}

function axesFor(i: number, dir: 1 | -1): ViewAxes {
  const [r, u, o] = AXES[i % AXES.length]
  return { right: { axis: r, dir }, up: { axis: u, dir: i % 3 ? 1 : -1 }, out: { axis: o, dir: i % 5 ? -1 : 1 } }
}

describe('readVolume', () => {
  it('fills the same cells and asks for the same runs as a cell-by-cell scan', () => {
    let cases = 0
    // Every scale against every axis order and both right-axis directions:
    // below 2^3, where cells share blocks, is where the scan differs most.
    for (const scaleExp of [0, 1, 2, 3, 4, 30]) {
      for (let a = 0; a < AXES.length; a++) {
        for (const dir of [1, -1] as const) {
          const i = cases
          const [r, u, o] = AXES[a]
          const axes: ViewAxes = { right: { axis: r, dir }, up: { axis: u, dir: i % 3 ? 1 : -1 }, out: { axis: o, dir: i % 5 ? -1 : 1 } }
          const centre = centreFor(i)
          const plane = (Math.floor(i / 2) % 2) as Plane
          resetCache(i * 7919)
          checkRead(layoutVolume(centre, axes, scaleExp, plane), centre, axes, scaleExp, plane)
          cases++
        }
      }
    }
    expect(cases).toBe(72)
    // 144 full scans: generous, for a suite run on a busy machine.
  }, 120_000)

  it('stays equal to a fresh scan across flushes, moves, zooms, turns and planes', () => {
    let same = 0, renewed = 0, reads = 0
    for (let i = 0; i < 10; i++) {
      resetCache(i * 104729 + 1)
      let centre = centreFor(i)
      let scaleExp = [0, 2, 3, 11, 1][i % 5]
      let axes = axesFor(i, i % 2 ? 1 : -1)
      let plane = (i % 2) as Plane
      let epoch = i * 1000

      // Each view: laid out once, then read on a few flushes, as the hook does.
      const view = (): void => {
        const layout = layoutVolume(centre, axes, scaleExp, plane)
        let prev = checkRead(layout, centre, axes, scaleExp, plane)
        reads++
        for (let f = 0; f < 3; f++) {
          const before = prev.slice()
          deliver(++epoch)
          const got = checkRead(layout, centre, axes, scaleExp, plane)
          reads++
          // An array handed out is never written to again, and the same one
          // comes back only when nothing in it has changed.
          expect(prev).toEqual(before)
          if (got === prev) { expect(got).toEqual(before); same++ } else renewed++
          prev = got
        }
        // A flush with nothing new: the same array.
        expect(readVolume(layout)).toBe(prev)
      }

      view()
      // One cell along each axis: the new volume shares most of its blocks.
      for (const a of ['x', 'y', 'z'] as const) {
        centre = { ...centre, [a]: centre[a] + (1n << BigInt(scaleExp)) }
        view()
      }
      // Zoom out and back in, turn, and cross to the other plane.
      scaleExp += 1
      view()
      scaleExp -= 1
      view()
      axes = axesFor(i + 1, i % 2 ? -1 : 1)
      view()
      plane = (1 - plane) as Plane
      view()
    }
    expect(reads).toBe(10 * 8 * 4)
    // Both outcomes happened, so neither identity check passed vacuously.
    expect(same).toBeGreaterThan(0)
    expect(renewed).toBeGreaterThan(0)
  }, 240_000)
})

describe('blockKey', () => {
  it('is the block of each axis and the plane, whatever was keyed before it', () => {
    const hex = (n: bigint): string => (n >> BLOCK_BITS).toString(16)
    const plain = (x: bigint, y: bigint, z: bigint, plane: number): string => `${hex(x)},${hex(y)},${hex(z)},${plane}`
    for (let i = 0; i < 400; i++) {
      // Axes repeating and changing in every combination, as rows and runs do.
      const x = sample(i % 7), y = sample(100 + (i % 3)), z = i % 2 ? sample(200 + i) : sample(200)
      const plane = (i % 2) as Plane
      expect(blockKey(x, y, z, plane)).toBe(plain(x, y, z, plane))
      expect(blockKey(x + 1n, y, z, plane)).toBe(plain(x + 1n, y, z, plane))
    }
  })

  it('tells every block apart, either side of zero and on both planes', () => {
    const keys = new Set<string>()
    const near = [-2n, -1n, 0n, 1n, 2n].map((b) => b * BLOCK_SIZE)
    for (const x of near) for (const y of near) for (const z of near) for (const plane of [0, 1] as Plane[]) keys.add(blockKey(x, y, z, plane))
    expect(keys.size).toBe(5 * 5 * 5 * 2)
  })
})
