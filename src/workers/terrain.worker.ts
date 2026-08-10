/**
 * terrain.worker.ts — computes terrain K values for 3D chunks.
 *
 * Each chunk is a 3D grid of cells (default 49³).
 *
 * There is deliberately no per-coordinate cache here. Chunks tile space
 * disjointly rather than overlapping, and useTerrainChunks never re-requests a
 * chunk it already holds, so such a cache hit-rates at roughly zero while
 * growing without bound: an "x:y:z:plane" key over 85-bit coordinates is an
 * ~80 character string, so it costs hundreds of bytes and a BigInt-to-string
 * conversion per cell to buy nothing. Chunk-level reuse is the caller's job.
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

        values[idx] = terrainK(x, y, z, plane)
      }
    }
  }

  const elapsedMs = performance.now() - started
  console.log(`Chunk (${chunkX}, ${chunkY}, ${chunkZ}) done in ${elapsedMs.toFixed(1)}ms`)

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
