/**
 * terrain.worker.ts — computes terrain K values for 3D chunks.
 *
 * Each chunk is a 3D grid of cells (default 49³). The worker maintains a
 * per-coordinate cache to avoid recomputing K for cells we've already seen.
 * This is critical because chunks overlap at their boundaries, and the avatar
 * moves through space incrementally, so most cells are revisited.
 *
 * The cache is a Map keyed by "x:y:z:plane" strings. Memory is negligible
 * (1 byte per cell), and the cache never goes stale because terrain is
 * deterministic.
 */

import { terrainK, type Plane } from 'cyberspace-core'

export interface ChunkRequest {
  id: number
  chunkX: number
  chunkY: number
  chunkZ: number
  originX: bigint
  originY: bigint
  originZ: bigint
  step: bigint
  plane: Plane
  size: number
}

export interface ChunkResponse {
  id: number
  chunkX: number
  chunkY: number
  chunkZ: number
  values: Uint8Array
  elapsedMs: number
}

const AXIS_MAX = (1n << 85n) - 1n
const terrainCache = new Map<string, number>()

self.onmessage = (event: MessageEvent<ChunkRequest>) => {
  const {
    id, chunkX, chunkY, chunkZ,
    originX, originY, originZ,
    step, plane, size,
  } = event.data

  console.log(`Worker computing chunk (${chunkX}, ${chunkY}, ${chunkZ}), size=${size}, step=${step}`)

  const started = performance.now()
  const values = new Uint8Array(size * size * size)
  const halfSize = Math.floor(size / 2)

  let cacheHits = 0
  let cacheMisses = 0

  for (let dz = 0; dz < size; dz++) {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        // Compute offset from chunk center (originX/Y/Z is the world position of chunk center)
        const offsetX = BigInt(dx - halfSize) * step
        const offsetY = BigInt(dy - halfSize) * step
        const offsetZ = BigInt(dz - halfSize) * step

        const x = originX + offsetX
        const y = originY + offsetY
        const z = originZ + offsetZ

        const idx = dz * size * size + dy * size + dx

        if (x < 0n || y < 0n || z < 0n || x > AXIS_MAX || y > AXIS_MAX || z > AXIS_MAX) {
          values[idx] = 255
          continue
        }

        const cacheKey = `${x}:${y}:${z}:${plane}`
        let k = terrainCache.get(cacheKey)
        if (k === undefined) {
          k = terrainK(x, y, z, plane)
          terrainCache.set(cacheKey, k)
          cacheMisses++
        } else {
          cacheHits++
        }
        values[idx] = k
      }
    }
  }

  const elapsedMs = performance.now() - started
  console.log(`Chunk (${chunkX}, ${chunkY}, ${chunkZ}) done in ${elapsedMs.toFixed(1)}ms, cache hits=${cacheHits}, misses=${cacheMisses}`)

  const response: ChunkResponse = {
    id,
    chunkX,
    chunkY,
    chunkZ,
    values,
    elapsedMs,
  }
  self.postMessage(response, [values.buffer])
}
