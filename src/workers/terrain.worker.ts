/**
 * terrain.worker.ts — samples the terrain K field for the visible grid.
 *
 * Each cell costs four SHA-256 evaluations, so a 49x49 grid is ~9.6k hashes.
 * That is quick but not free, and it is recomputed on every move, so it stays
 * off the main thread.
 */

import { terrainK, type Plane } from 'cyberspace-core'

export interface TerrainRequest {
  id: number
  /** Aligned world coordinate of the centre cell. */
  originX: bigint
  originY: bigint
  originZ: bigint
  /** Which world axes map to the screen's right and up directions. */
  rightAxis: 'x' | 'y' | 'z'
  rightDir: number
  upAxis: 'x' | 'y' | 'z'
  upDir: number
  step: bigint
  radius: number
  plane: Plane
}

export interface TerrainResponse {
  id: number
  radius: number
  /** Row-major K values, (2 * radius + 1)^2 entries, row 0 = bottom of screen. */
  values: Uint8Array
  elapsedMs: number
  /** Echo back request fields for cache management */
  originX: bigint
  originY: bigint
  originZ: bigint
  rightAxis: 'x' | 'y' | 'z'
  rightDir: number
  upAxis: 'x' | 'y' | 'z'
  upDir: number
  step: bigint
}

const AXIS_MAX = (1n << 85n) - 1n

self.onmessage = (event: MessageEvent<TerrainRequest>) => {
  const {
    id, originX, originY, originZ,
    rightAxis, rightDir, upAxis, upDir,
    step, radius, plane,
  } = event.data

  const started = performance.now()
  const size = radius * 2 + 1
  const values = new Uint8Array(size * size)

  for (let row = 0; row < size; row++) {
    const upOffset = BigInt(row - radius) * step * BigInt(upDir)
    for (let col = 0; col < size; col++) {
      const rightOffset = BigInt(col - radius) * step * BigInt(rightDir)

      let x = originX
      let y = originY
      let z = originZ
      if (rightAxis === 'x') x += rightOffset
      else if (rightAxis === 'y') y += rightOffset
      else z += rightOffset
      if (upAxis === 'x') x += upOffset
      else if (upAxis === 'y') y += upOffset
      else z += upOffset

      // Outside the axis bounds there is no terrain to sample.
      if (x < 0n || y < 0n || z < 0n || x > AXIS_MAX || y > AXIS_MAX || z > AXIS_MAX) {
        values[row * size + col] = 255
        continue
      }

      values[row * size + col] = terrainK(x, y, z, plane)
    }
  }

  const response: TerrainResponse = {
    id,
    radius,
    values,
    elapsedMs: performance.now() - started,
    originX,
    originY,
    originZ,
    rightAxis,
    rightDir,
    upAxis,
    upDir,
    step,
  }
  self.postMessage(response, [values.buffer])
}
