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

/**
 * How many chunks in each direction from the focus chunk to keep loaded.
 *
 * The visible box spans ±GRID_RADIUS cells, so it straddles at most two chunks
 * per axis; radius 1 (27 chunks) already keeps a full chunk of prefetch in
 * every direction. Radius 2 is 125 chunks, which is 14.7M cells and ~59M
 * terrainK evaluations on load for terrain that can never come into view
 * before eviction. Raise only if movement outruns the loader.
 */
const CHUNK_RADIUS = 1

interface ChunkData {
  chunkX: bigint
  chunkY: bigint
  chunkZ: bigint
  values: Uint8Array
  receivedAt: number
}

export interface ChunkMap {
  [key: string]: ChunkData
}

function chunkKey(cx: bigint, cy: bigint, cz: bigint): string {
  return `${cx},${cy},${cz}`
}

/**
 * Compute chunk coordinates from a world position and scale exponent.
 *
 * These stay BigInt all the way through. Collapsing them to Number is what
 * broke the loader: at a real 85-bit coordinate the quotient lands near 4e23,
 * where consecutive doubles are ~6.7e7 apart, so every neighbouring chunk
 * index rounded to the same value. The keys collided, the needed set held one
 * entry instead of 27, and a single chunk was ever requested, which is why
 * only one terrain worker had anything to do.
 *
 * Coordinates are unsigned (0 .. 2^85-1), so BigInt truncation is also floor.
 */
function worldToChunk(
  worldX: bigint, worldY: bigint, worldZ: bigint,
  scaleExp: number,
): [bigint, bigint, bigint] {
  const chunkStep = BigInt(CHUNK_SIZE) * stepFor(scaleExp)
  return [worldX / chunkStep, worldY / chunkStep, worldZ / chunkStep]
}

/**
 * Compute the world-space origin of a chunk (the position of its center cell).
 */
function chunkToWorld(
  cx: bigint, cy: bigint, cz: bigint,
  scaleExp: number,
): [bigint, bigint, bigint] {
  const chunkStep = BigInt(CHUNK_SIZE) * stepFor(scaleExp)
  return [cx * chunkStep, cy * chunkStep, cz * chunkStep]
}

let chunkRequestId = 0
let workerIdx = 0

export function useTerrainChunks(): ChunkMap {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane: Plane = useCyberspace((s) => s.plane)
  const view = useCyberspace((s) => s.view)

  const [chunks, setChunks] = useState<ChunkMap>({})
  const chunksRef = useRef<ChunkMap>({})
  const pendingRef = useRef<Set<string>>(new Set())
  const listenersAttached = useRef(false)
  const flushHandle = useRef<number | null>(null)

  // Focus point: always the avatar position, not the cursor.
  // The terrain is anchored to where you stand, not where you're aiming.
  const focus = position

  // Chunk coordinates of the focus point.
  const [focusCX, focusCY, focusCZ] = worldToChunk(focus.x, focus.y, focus.z, scaleExp)

  // Publish accumulated chunks at most once per frame. Chunks land one message
  // at a time, and every publish rebuilds the point geometry, so setting state
  // per arrival rebuilds it once per chunk on load instead of once per frame.
  const scheduleFlush = () => {
    if (flushHandle.current !== null) return
    flushHandle.current = requestAnimationFrame(() => {
      flushHandle.current = null
      setChunks({ ...chunksRef.current })
    })
  }

  useEffect(() => () => {
    if (flushHandle.current !== null) cancelAnimationFrame(flushHandle.current)
  }, [])

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

        // Trigger re-render with new chunk data, coalesced to one per frame.
        scheduleFlush()
      })
    }
  }, [])

  // Request missing chunks and evict distant ones.
  useEffect(() => {
    const workers = getTerrainWorkers()

    const needed = new Set<string>()

    console.log(`[useTerrainChunks] Focus at chunk (${focusCX}, ${focusCY}, ${focusCZ}), scaleExp=${scaleExp}, plane=${plane}, view=${view.toArray().map(v => v.toFixed(2)).join(',')}`)
    console.log(`[useTerrainChunks] Existing chunks: ${Object.keys(chunksRef.current).length}, pending: ${pendingRef.current.size}`)

    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
      for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++) {
        for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
          const cx = focusCX + BigInt(dx)
          const cy = focusCY + BigInt(dy)
          const cz = focusCZ + BigInt(dz)
          const key = chunkKey(cx, cy, cz)
          needed.add(key)

          if (!chunksRef.current[key] && !pendingRef.current.has(key)) {
            pendingRef.current.add(key)
            const id = ++chunkRequestId
            const [originX, originY, originZ] = chunkToWorld(cx, cy, cz, scaleExp)

            // Use persistent workerIdx across renders for true round-robin
            const workerIndex = workerIdx % workers.length
            console.log(`[useTerrainChunks] Requesting chunk (${cx}, ${cy}, ${cz}), origin=(${originX}, ${originY}, ${originZ}), dispatching to worker ${workerIndex}`)

            // Round-robin dispatch across worker pool.
            workers[workerIndex].postMessage({
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
