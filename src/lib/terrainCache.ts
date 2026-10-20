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
import { getTerrainWorkers, postRun, setRunDropHandler } from './workers'
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

// Each axis's last block and its text. A volume scan walks rows, along which
// two of the three axes stay fixed, and a run walks one axis; writing an
// 85-bit bigint out is most of a key's cost, so the axis that did not change
// is not written out again (2026-10-20).
//
// The text is hex, not decimal. Chromium writes a bigint of this size out in
// decimal about 70 times slower than in hex (5.3 us against 0.07 us per block
// in headless Chromium 151; Node is fast at both, so a Node bench hides it),
// and the volume writes out thousands at every step of a walk. The key only
// has to be the same for the same block, and hex is as exact as decimal
// (2026-10-20).
let lastX: bigint | null = null, lastY: bigint | null = null, lastZ: bigint | null = null
let textX = '', textY = '', textZ = ''

/** The cache key of the block holding (x, y, z): every cell of a block has the same K. */
export function blockKey(x: bigint, y: bigint, z: bigint, plane: Plane): string {
  const bx = x >> BLOCK_BITS, by = y >> BLOCK_BITS, bz = z >> BLOCK_BITS
  if (bx !== lastX) { lastX = bx; textX = bx.toString(16) }
  if (by !== lastY) { lastY = by; textY = by.toString(16) }
  if (bz !== lastZ) { lastZ = bz; textZ = bz.toString(16) }
  return `${textX},${textY},${textZ},${plane}`
}

export function readK(
  x: bigint, y: bigint, z: bigint, plane: Plane,
): number | undefined {
  return readKey(blockKey(x, y, z, plane))
}

/**
 * The K under a key blockKey made earlier. A caller that reads the same blocks
 * again and again (the volume, on every flush) keeps their keys rather than
 * writing them out each time: a key built fresh is a new string, hashed again
 * on every lookup, and that was most of a rescan's cost (2026-10-20).
 */
export function readKey(key: string): number | undefined {
  return cache.get(key)
}

function writeKey(key: string, k: number): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(key, k)
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

/** In hex for the reason blockKey's text is. */
function runKey(r: RunSpec): string {
  return `${r.originX.toString(16)},${r.originY.toString(16)},${r.originZ.toString(16)},${r.axis},${r.step.toString(16)},${r.count},${r.plane}`
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
// Each run's own key and the block key of each of its cells, worked out once
// when it is asked for, so folding its answer in builds no keys: writing the
// three coordinates out again for the run's key alone was most of what an
// answer cost (2026-10-20).
const runsById = new Map<number, { key: string; keys: readonly string[] }>()
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
  return isKeyPending(blockKey(x, y, z, plane))
}

/** isPending, for a key blockKey made earlier. */
export function isKeyPending(key: string): boolean {
  return pendingBlocks.has(key)
}

function attachOnce(): void {
  if (attached) return
  attached = true

  // A run that will never be answered gives back its marks, so the next read
  // of a volume that still wants its blocks asks for them again. Each block is
  // in one live run at most, since a read never asks for a block already
  // asked for, so clearing its mark here cannot strand another run's block.
  // Nothing is asked for from here. Leaving the main view drops the volume,
  // and coming back lays it out and reads it afresh. After a worker throws,
  // the next read asks again: the next answer's flush, or, if that run was the
  // last one out, the next move, zoom or turn. Asking at once would retry a
  // run that throws every time in a loop (2026-10-20).
  setRunDropHandler((ids) => {
    for (const id of ids) {
      const run = runsById.get(id)
      if (!run) continue
      runsById.delete(id)
      inflight.delete(run.key)
      for (const k of run.keys) pendingBlocks.delete(k)
    }
  })

  for (const worker of getTerrainWorkers()) {
    worker.addEventListener('message', (event: MessageEvent<RunResponse>) => {
      const { id, values } = event.data
      const run = runsById.get(id)
      if (!run) return
      runsById.delete(id)
      inflight.delete(run.key)

      for (let i = 0; i < run.keys.length; i++) {
        writeKey(run.keys[i], values[i])
        pendingBlocks.delete(run.keys[i])
      }

      for (const listener of listeners) listener()
    })
  }
}

/**
 * Queue a run, unless an identical one is already in flight.
 *
 * `keys`, when given, is blockKey of each of the run's cells in order, from a
 * caller that already has them; it is kept, not copied. Without it they are
 * worked out here.
 */
export function requestRun(spec: RunSpec, keys?: readonly string[]): void {
  attachOnce()

  const key = runKey(spec)
  if (inflight.has(key)) return
  inflight.add(key)

  const cellKeys = keys ?? Array.from(runCells(spec), ([x, y, z]) => blockKey(x, y, z, spec.plane))
  for (const k of cellKeys) pendingBlocks.add(k)

  const id = ++nextRunId
  runsById.set(id, { key, keys: cellKeys })
  postRun({ id, ...spec } as RunRequest)
}

export function inflightRuns(): number {
  return inflight.size
}
