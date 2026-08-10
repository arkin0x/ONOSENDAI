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
import { getTerrainWorkers, postChunk, type ChunkResponse } from '../lib/workers'
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

/**
 * Chunk identity includes the lattice it was sampled on.
 *
 * Keying on the indices alone made chunks from different scales collide.
 * Indices shrink as scaleExp grows and converge toward zero, so past about
 * scaleExp 80 every scale yields the same handful of keys. Once those existed,
 * the "already have it" and "already pending" tests suppressed every further
 * request, and the retained chunks carried indices from the old lattice that
 * filter entirely outside the window, leaving the field permanently empty.
 */
function chunkKey(
  cx: bigint, cy: bigint, cz: bigint,
  scaleExp: number, plane: Plane,
): string {
  return `${cx},${cy},${cz}@${scaleExp}:${plane}`
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

/**
 * Chunk offsets around the focus, nearest first.
 *
 * Plain nested loops start at the (-R,-R,-R) corner, so on a cold load the
 * grid fills in from a corner and the cells you are actually looking at arrive
 * last. Sorting by distance means the centre chunk is queued first and the
 * view is usable almost immediately, with the surrounding ring filling in.
 */
const CHUNK_OFFSETS: Array<[number, number, number]> = (() => {
  const list: Array<[number, number, number]> = []
  for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
    for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++) {
      for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
        list.push([dx, dy, dz])
      }
    }
  }
  return list.sort(
    (a, b) =>
      (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) -
      (b[0] * b[0] + b[1] * b[1] + b[2] * b[2]),
  )
})()

export function useTerrainChunks(): ChunkMap {
  const cursor = useCyberspace((s) => s.cursor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane: Plane = useCyberspace((s) => s.plane)
  const view = useCyberspace((s) => s.view)

  const [chunks, setChunks] = useState<ChunkMap>({})
  const chunksRef = useRef<ChunkMap>({})
  const pendingRef = useRef<Set<string>>(new Set())
  const listenersAttached = useRef(false)
  const flushHandle = useRef<number | null>(null)

  // Residency follows the cursor, which is where the camera is looking.
  //
  // This is not the same thing as the anchor. The geometry origin stays the
  // avatar's aligned cell, so the gibsons never move; this only decides which
  // chunks are resident. Keeping residency on the avatar meant aiming away
  // walked the visible window off the loaded region and into empty space.
  // Reduces to the avatar whenever the cursor is not active.
  const focus = cursor

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
        const { key, chunkX, chunkY, chunkZ, values } = event.data

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
    const needed = new Set<string>()
    let requested = 0

    // Nearest first, so the centre of the view resolves before the outer ring.
    for (const [dx, dy, dz] of CHUNK_OFFSETS) {
      const cx = focusCX + BigInt(dx)
      const cy = focusCY + BigInt(dy)
      const cz = focusCZ + BigInt(dz)
      const key = chunkKey(cx, cy, cz, scaleExp, plane)
      needed.add(key)

      if (!chunksRef.current[key] && !pendingRef.current.has(key)) {
        pendingRef.current.add(key)
        const [originX, originY, originZ] = chunkToWorld(cx, cy, cz, scaleExp)
        requested++

        postChunk({
          id: ++chunkRequestId,
          key,
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
      }
    }

    // Evict chunks outside the needed set.
    let evicted = 0
    for (const key of Object.keys(chunksRef.current)) {
      if (!needed.has(key)) {
        delete chunksRef.current[key]
        evicted++
      }
    }

    console.log(
      `[useTerrainChunks] scaleExp=${scaleExp} plane=${plane} ` +
      `focus=(${focusCX},${focusCY},${focusCZ}) ` +
      `requested=${requested} evicted=${evicted} ` +
      `resident=${Object.keys(chunksRef.current).length} pending=${pendingRef.current.size}`,
    )

    // Eviction alone changes what should be drawn, and nothing else publishes
    // it: without this the last snapshot keeps rendering until a new chunk
    // lands, which after a scale change is a set of stale chunks whose indices
    // now fall entirely outside the window, so the field reads as empty.
    if (evicted > 0) scheduleFlush()
  }, [focusCX, focusCY, focusCZ, scaleExp, plane, view])

  return chunks
}
