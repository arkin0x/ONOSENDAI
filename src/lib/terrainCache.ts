/**
 * terrainCache.ts — the K values we have already paid for.
 *
 * terrainK is a pure function of (x, y, z, plane) and costs four SHA-256, about
 * 54us per cell. Spec 5.2 is explicit that K is derived from the hop
 * destination alone; previous_event_id enters downstream in 5.3, seeding the
 * temporal axis value whose *height* K sets. So K survives committed movement
 * and is safe to cache, while the hop proof built on top of it is not.
 *
 * Two things make the cache cheap:
 *
 * 1. The key is the coordinate, so every kind of view change reuses whatever it
 *    happens to share. Stepping one cell reuses 2,352 of 2,401. Rotating fixes
 *    a different axis, so the old and new planes intersect in a line and 49
 *    cells come free. Zooming samples a coarser lattice, but an aligned
 *    coordinate is aligned at every finer scale too. None of that is
 *    expressible in tiles or chunks: a perpendicular plane shares no tile, and
 *    a one-cell step changes every row's identity.
 *
 * 2. The key is the *block*, not the cell. Every entry in TERRAIN_CELL_BITS
 *    aligns the coordinate, and the finest entry determines the rest, since
 *    coarser alignments use a subset of the bits it preserves. So K is constant
 *    across each 2^min(cellBits) block, and below that scale one sample serves
 *    a whole block. Verified across 135,168 checks, and asserted by
 *    terrainCache.test.ts so a constants change fails loudly.
 *
 * The shift is derived from DEFAULT_CELL_BITS rather than written as 3: with
 * cellBits [2,7,9,11] there are coordinates sharing x>>3 whose K differs, so a
 * hardcoded 3 would silently serve wrong values if the constants ever moved.
 *
 * The cache is in memory, which is also the only place workers, scales and
 * rotations can all share it. If it is ever persisted it must be keyed on or
 * invalidated by TERRAIN_DOMAIN_V2, which the spec requires bumping whenever
 * the terrain function changes.
 */

import { DEFAULT_CELL_BITS } from 'cyberspace-core'
import { getTerrainWorkers, postRun } from './workers'
import type { AxisName } from './space'
import type { Plane } from 'cyberspace-core'
import type { RunRequest, RunResponse } from '../workers/terrain.worker'

/** K is constant across a block of this many units per axis. */
export const BLOCK_BITS = BigInt(Math.min(...DEFAULT_CELL_BITS))
export const BLOCK_SIZE = 1n << BLOCK_BITS

/**
 * Entries to retain. One entry now covers a whole block, so this reaches much
 * further than the count suggests. Eviction is insertion order rather than true
 * LRU: terrain is deterministic and cheap to re-derive, so a wrong guess costs
 * one resample.
 */
const MAX_ENTRIES = 150_000

const cache = new Map<string, number>()

function blockKey(x: bigint, y: bigint, z: bigint, plane: Plane): string {
  return `${x >> BLOCK_BITS},${y >> BLOCK_BITS},${z >> BLOCK_BITS},${plane}`
}

export function readK(
  x: bigint, y: bigint, z: bigint, plane: Plane,
): number | undefined {
  return cache.get(blockKey(x, y, z, plane))
}

function writeK(
  x: bigint, y: bigint, z: bigint, plane: Plane, k: number,
): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(blockKey(x, y, z, plane), k)
}

export function cacheSize(): number {
  return cache.size
}

// ---------- Fetching ----------

export interface RunSpec {
  originX: bigint
  originY: bigint
  originZ: bigint
  axis: AxisName
  step: bigint
  count: number
  plane: Plane
}

function runKey(r: RunSpec): string {
  return `${r.originX},${r.originY},${r.originZ},${r.axis},${r.step},${r.count},${r.plane}`
}

/** Walk a run's cells, so we can mark and later resolve the blocks it covers. */
function* runCells(spec: RunSpec): Generator<[bigint, bigint, bigint]> {
  let { originX: x, originY: y, originZ: z } = spec
  for (let i = 0; i < spec.count; i++) {
    yield [x, y, z]
    if (spec.axis === 'x') x += spec.step
    else if (spec.axis === 'y') y += spec.step
    else z += spec.step
  }
}

let nextRunId = 0
const inflight = new Set<string>()
const pendingBlocks = new Set<string>()
const runsById = new Map<number, RunSpec>()
const listeners = new Set<() => void>()
let attached = false

/** Notified whenever new K values land, so views can re-slice. */
export function onTerrainData(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Already asked for. Callers skip these so a block is sampled exactly once. */
export function isPending(
  x: bigint, y: bigint, z: bigint, plane: Plane,
): boolean {
  return pendingBlocks.has(blockKey(x, y, z, plane))
}

function attachOnce(): void {
  if (attached) return
  attached = true

  for (const worker of getTerrainWorkers()) {
    worker.addEventListener('message', (event: MessageEvent<RunResponse>) => {
      const { id, values } = event.data
      const spec = runsById.get(id)
      if (!spec) return
      runsById.delete(id)
      inflight.delete(runKey(spec))

      let i = 0
      for (const [x, y, z] of runCells(spec)) {
        writeK(x, y, z, spec.plane, values[i++])
        pendingBlocks.delete(blockKey(x, y, z, spec.plane))
      }

      for (const listener of listeners) listener()
    })
  }
}

/** Queue a run, unless an identical one is already in flight. */
export function requestRun(spec: RunSpec): void {
  attachOnce()

  const key = runKey(spec)
  if (inflight.has(key)) return
  inflight.add(key)

  for (const [x, y, z] of runCells(spec)) {
    pendingBlocks.add(blockKey(x, y, z, spec.plane))
  }

  const id = ++nextRunId
  runsById.set(id, spec)
  postRun({ id, ...spec } as RunRequest)
}

export function inflightRuns(): number {
  return inflight.size
}
