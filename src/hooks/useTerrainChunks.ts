/**
 * useTerrainChunks.ts — manages 3D terrain chunks around the focus point.
 *
 * Chunks are CHUNK_SIZE³ cell volumes. The hook:
 * 1. Identifies which chunks surround the current focus (cursor or position)
 * 2. Dispatches missing chunks to the worker pool via round-robin
 * 3. Evicts chunks that are too far from focus
 * 4. Uses BigInt math for chunk addressing (no precision loss on 85-bit coords)
 *
 * Chunks are keyed by (cx, cy, cz) chunk coordinates. Two viewpoints that
 * overlap in space share the same cached chunks.
 */

import { useEffect, useRef, useState } from 'react'
import { useCyberspace } from '../store/useCyberspace'
import { getTerrainWorkers, type ChunkResponse } from '../lib/workers'
import { GRID_RADIUS, stepFor } from '../lib/space'
import type { Plane } from 'cyberspace-core'

/** Cells per chunk axis. Matches the visible grid size. */
export const CHUNK_SIZE = GRID_RADIUS * 2 + 1

/** How many chunks in each direction from the focus chunk to keep loaded. */
const CHUNK_RADIUS = 2

interface ChunkData {
  chunkX: number
  chunkY: number
  chunkZ: number
  values: Uint8Array
  receivedAt: number
}

export interface ChunkMap {
  [key: string]: ChunkData
}

function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`
}

/**
 * Compute chunk coordinates from a world position and scale exponent.
 * Uses BigInt division to avoid precision loss on 85-bit coordinates.
 */
function worldToChunk(
  worldX: bigint, worldY: bigint, worldZ: bigint,
  scaleExp: number,
): [number, number, number] {
  const chunkStep = BigInt(CHUNK_SIZE) * stepFor(scaleExp)
  return [
    Math.floor(Number(worldX / chunkStep)),
    Math.floor(Number(worldY / chunkStep)),
    Math.floor(Number(worldZ / chunkStep)),
  ]
}

/**
 * Compute the world-space origin of a chunk (the position of its center cell).
 */
function chunkToWorld(
  cx: number, cy: number, cz: number,
  scaleExp: number,
): [bigint, bigint, bigint] {
  const chunkStep = BigInt(CHUNK_SIZE) * stepFor(scaleExp)
  return [
    BigInt(cx) * chunkStep,
    BigInt(cy) * chunkStep,
    BigInt(cz) * chunkStep,
  ]
}

let chunkRequestId = 0

export function useTerrainChunks(): ChunkMap {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane: Plane = useCyberspace((s) => s.plane)
  const view = useCyberspace((s) => s.view)

  const [chunks, setChunks] = useState<ChunkMap>({})
  const chunksRef = useRef<ChunkMap>({})
  const pendingRef = useRef<Set<string>>(new Set())
  const listenersAttached = useRef(false)

  // Focus point: cursor if active, otherwise position.
  const focus = cursor.x !== position.x || cursor.y !== position.y || cursor.z !== position.z
    ? cursor
    : position

  // Chunk coordinates of the focus point.
  const [focusCX, focusCY, focusCZ] = worldToChunk(focus.x, focus.y, focus.z, scaleExp)

  // Attach message listeners to all terrain workers once.
  useEffect(() => {
    if (listenersAttached.current) return
    listenersAttached.current = true

    const workers = getTerrainWorkers()
    console.log(`[useTerrainChunks] Attaching listeners to ${workers.length} workers`)
    
    for (const worker of workers) {
      worker.addEventListener('message', (event: MessageEvent<ChunkResponse>) => {
        const { chunkX, chunkY, chunkZ, values } = event.data
        const key = chunkKey(chunkX, chunkY, chunkZ)

        const data: ChunkData = {
          chunkX, chunkY, chunkZ, values,
          receivedAt: Date.now(),
        }

        chunksRef.current[key] = data
        pendingRef.current.delete(key)

        console.log(`[useTerrainChunks] Received chunk (${chunkX}, ${chunkY}, ${chunkZ}), total chunks: ${Object.keys(chunksRef.current).length}`)

        // Trigger re-render with new chunk data.
        setChunks({ ...chunksRef.current })
      })
    }
  }, [])

  // Request missing chunks and evict distant ones.
  useEffect(() => {
    const workers = getTerrainWorkers()
    let workerIdx = 0

    const needed = new Set<string>()

    console.log(`[useTerrainChunks] Focus at chunk (${focusCX}, ${focusCY}, ${focusCZ}), scaleExp=${scaleExp}, plane=${plane}, view=${view.toArray().map(v => v.toFixed(2)).join(',')}`)
    console.log(`[useTerrainChunks] Existing chunks: ${Object.keys(chunksRef.current).length}, pending: ${pendingRef.current.size}`)

    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
      for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++) {
        for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
          const cx = focusCX + dx
          const cy = focusCY + dy
          const cz = focusCZ + dz
          const key = chunkKey(cx, cy, cz)
          needed.add(key)

          if (!chunksRef.current[key] && !pendingRef.current.has(key)) {
            pendingRef.current.add(key)
            const id = ++chunkRequestId
            const [originX, originY, originZ] = chunkToWorld(cx, cy, cz, scaleExp)

            console.log(`[useTerrainChunks] Requesting chunk (${cx}, ${cy}, ${cz}), origin=(${originX}, ${originY}, ${originZ}), dispatching to worker ${workerIdx % workers.length}`)

            // Round-robin dispatch across worker pool.
            workers[workerIdx % workers.length].postMessage({
              id,
              chunkX: cx,
              chunkY: cy,
              chunkZ: cz,
              originX,
              originY,
              originZ,
              step: stepFor(scaleExp),
              plane,
              size: CHUNK_SIZE,
            })
            workerIdx++
          }
        }
      }
    }

    // Evict chunks outside the needed set.
    for (const key of Object.keys(chunksRef.current)) {
      if (!needed.has(key)) {
        delete chunksRef.current[key]
      }
    }
  }, [focusCX, focusCY, focusCZ, scaleExp, plane, view])

  return chunks
}
