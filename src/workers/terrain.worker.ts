/**
 * terrain.worker.ts — samples runs of terrain K values.
 *
 * The unit of work is a run: a contiguous line of cells stepping along one
 * world axis. That is the shape the visible plane decomposes into, and it is
 * also the shape of whatever a move, a rotate or a zoom leaves uncovered, so
 * the caller can ask for exactly the cells it is missing and nothing more.
 *
 * Workers hold no state. The main thread owns the K cache, because that is the
 * only place it can be shared across workers, across scales, and across view
 * rotations. A per-worker cache sees almost no hits and grows without bound,
 * which is exactly what the previous one did.
 */

import { terrainK, type Plane } from 'cyberspace-core'
import type { AxisName } from '../lib/space'

export interface RunRequest {
  id: number
  /** World coordinate of the run's first cell, aligned to the scale's step. */
  originX: bigint
  originY: bigint
  originZ: bigint
  /** Axis the run advances along. */
  axis: AxisName
  /** Signed gap between consecutive cells, so a run can descend. */
  step: bigint
  count: number
  plane: Plane
}

export interface RunResponse {
  id: number
  values: Uint8Array
  elapsedMs: number
}

const AXIS_MAX = (1n << 85n) - 1n

/** Outside the universe. A renderer cannot tell this from "not yet known". */
export const UNKNOWN = 255

self.onmessage = (event: MessageEvent<RunRequest>) => {
  const { id, originX, originY, originZ, axis, step, count, plane } = event.data

  const started = performance.now()
  const values = new Uint8Array(count)

  let x = originX
  let y = originY
  let z = originZ

  for (let i = 0; i < count; i++) {
    values[i] =
      x < 0n || y < 0n || z < 0n || x > AXIS_MAX || y > AXIS_MAX || z > AXIS_MAX
        ? UNKNOWN
        : terrainK(x, y, z, plane)

    if (axis === 'x') x += step
    else if (axis === 'y') y += step
    else z += step
  }

  const response: RunResponse = {
    id,
    values,
    elapsedMs: performance.now() - started,
  }
  self.postMessage(response, [values.buffer])
}
