/**
 * terrainCache.ts — the K values we have already paid for.
 *
 * terrainK is a pure function of (x, y, z, plane) and costs four SHA-256, about
 * 54us per cell. The visible plane is 2,401 cells, so sampling it from scratch
 * is ~130ms. Almost none of that needs paying twice:
 *
 *   - stepping one cell reuses 2,352 of 2,401 and needs one new row
 *   - rotating fixes a different axis, so the two planes intersect in a line:
 *     49 cells come free and 2,352 are new
 *   - zooming samples a coarser lattice, but an aligned coordinate is aligned
 *     at every finer scale too, so scales share entries wherever they coincide
 *
 * None of that reuse is expressible in a cache of 2D tiles or 3D chunks, since
 * a perpendicular plane shares no tile and a one-cell step changes every row's
 * identity. The coordinate itself is the only key that captures it, which also
 * means there is no lattice, no alignment and no chunk addressing to get wrong.
 *
 * The cache lives on the main thread because that is the only place workers,
 * scales and rotations can all share it.
 */

import { getTerrainWorkers, postRun } from './workers'
import type { AxisName } from './space'
import type { Plane } from 'cyberspace-core'
import type { RunRequest, RunResponse } from '../workers/terrain.worker'

/**
 * Entries to retain. At roughly 250 bytes per entry this is about 37MB, and
 * holds some 60 full planes, which is far more scales and travel history than
 * a session revisits. Eviction is insertion order rather than true LRU: terrain
 * is deterministic and cheap to re-derive, so a wrong guess costs one resample.
 */
const MAX_ENTRIES = 150_000

const cache = new Map<string, number>()

function cellKey(x: bigint, y: bigint, z: bigint, plane: Plane): string {
  return `${x},${y},${z},${plane}`
}

export function readK(
  x: bigint, y: bigint, z: bigint, plane: Plane,
): number | undefined {
  return cache.get(cellKey(x, y, z, plane))
}

function writeK(
  x: bigint, y: bigint, z: bigint, plane: Plane, k: number,
): void {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(cellKey(x, y, z, plane), k)
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

let nextRunId = 0
const inflight = new Set<string>()
const runsById = new Map<number, RunSpec>()
const listeners = new Set<() => void>()
let attached = false

/** Notified whenever new K values land, so views can re-slice. */
export function onTerrainData(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
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

      let { originX: x, originY: y, originZ: z } = spec
      for (let i = 0; i < values.length; i++) {
        writeK(x, y, z, spec.plane, values[i])
        if (spec.axis === 'x') x += spec.step
        else if (spec.axis === 'y') y += spec.step
        else z += spec.step
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

  const id = ++nextRunId
  runsById.set(id, spec)
  postRun({ id, ...spec } as RunRequest)
}

export function inflightRuns(): number {
  return inflight.size
}
