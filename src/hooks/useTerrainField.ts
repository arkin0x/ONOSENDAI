/**
 * useTerrainField.ts — keeps a sampled terrain K grid in sync with the view.
 *
 * Uses a buffer zone optimization: requests a larger grid (3x visible size)
 * and caches it. When the avatar moves within the buffer, we extract the
 * visible portion without recomputing. Only requests new data when the
 * avatar moves beyond the buffer threshold.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { GRID_RADIUS, alignTo, stepFor } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getTerrainWorker, postTerrain, type TerrainResponse } from '../lib/workers'

export interface TerrainField {
  values: Uint8Array | null
  radius: number
  elapsedMs: number
}

const EMPTY: TerrainField = { values: null, radius: GRID_RADIUS, elapsedMs: 0 }

// Buffer grid is 3x the visible grid size
const BUFFER_MULTIPLIER = 3
const BUFFER_RADIUS = GRID_RADIUS * BUFFER_MULTIPLIER

// Re-request when avatar moves more than this many cells from buffer center
const BUFFER_THRESHOLD = GRID_RADIUS

let terrainRequestId = 0

interface BufferCache {
  centerX: bigint
  centerY: bigint
  centerZ: bigint
  rightAxis: 'x' | 'y' | 'z'
  rightDir: number
  upAxis: 'x' | 'y' | 'z'
  upDir: number
  step: bigint
  values: Uint8Array
}

// Helper to get coordinate for a given axis
const getAxisValue = (origin: { x: bigint; y: bigint; z: bigint }, axis: 'x' | 'y' | 'z'): bigint => {
  if (axis === 'x') return origin.x
  if (axis === 'y') return origin.y
  return origin.z
}

export function useTerrainField(): TerrainField {
  const viewCenter = useCyberspace((s) => s.viewCenter())
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.plane)
  const view = useCyberspace((s) => s.displayView)

  const [field, setField] = useState<TerrainField>(EMPTY)
  const latest = useRef(0)
  const bufferCache = useRef<BufferCache | null>(null)

  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  // Only the aligned cell matters, so sub-cell movement does not re-sample.
  const originKey = useMemo(() => {
    const o = alignedOrigin(viewCenter, scaleExp)
    return `${o.x}:${o.y}:${o.z}`
  }, [viewCenter, scaleExp])

  useEffect(() => {
    const worker = getTerrainWorker()
    const onMessage = (event: MessageEvent<TerrainResponse>) => {
      if (event.data.id !== latest.current) return
      
      const data = event.data
      console.log('[Terrain] Buffer received:', {
        radius: data.radius,
        totalCells: data.values.length,
        sampleValues: Array.from(data.values.slice(0, 10)),
        uniqueValues: new Set(data.values).size,
      })
      
      // Cache the buffer grid
      bufferCache.current = {
        centerX: data.originX,
        centerY: data.originY,
        centerZ: data.originZ,
        rightAxis: data.rightAxis,
        rightDir: data.rightDir,
        upAxis: data.upAxis,
        upDir: data.upDir,
        step: data.step,
        values: data.values,
      }
      
      // Extract the visible portion
      extractVisibleField()
    }
    worker.addEventListener('message', onMessage)
    return () => worker.removeEventListener('message', onMessage)
  }, [viewCenter, scaleExp])

  // Extract visible GRID_RADIUS portion from buffer grid
  function extractVisibleField() {
    const cache = bufferCache.current
    if (!cache) return

    const currentOrigin = alignedOrigin(viewCenter, scaleExp)
    const step = cache.step
    
    // Calculate offset from buffer center to current view center in cells, using actual mapped axes
    const cacheCoords = { x: cache.centerX, y: cache.centerY, z: cache.centerZ }
    const currentRight = getAxisValue(currentOrigin, cache.rightAxis)
    const cacheRight = getAxisValue(cacheCoords, cache.rightAxis)
    const currentUp = getAxisValue(currentOrigin, cache.upAxis)
    const cacheUp = getAxisValue(cacheCoords, cache.upAxis)
    
    const offsetRight = Number(currentRight - cacheRight) / Number(step)
    const offsetUp = Number(currentUp - cacheUp) / Number(step)
    
    console.log('[Terrain] Extract visible:', {
      cacheAxes: { right: cache.rightAxis, rightDir: cache.rightDir, up: cache.upAxis, upDir: cache.upDir },
      currentOrigin: { x: currentOrigin.x.toString(), y: currentOrigin.y.toString(), z: currentOrigin.z.toString() },
      cacheCenter: { x: cache.centerX.toString(), y: cache.centerY.toString(), z: cache.centerZ.toString() },
      offsets: { right: offsetRight, up: offsetUp },
      worldCoords: { currentRight: currentRight.toString(), cacheRight: cacheRight.toString(), currentUp: currentUp.toString(), cacheUp: cacheUp.toString() },
    })
    
    // Extract visible portion from buffer
    const visibleValues = new Uint8Array((GRID_RADIUS * 2 + 1) ** 2)
    const bufferSize = BUFFER_RADIUS * 2 + 1
    
    for (let vy = -GRID_RADIUS; vy <= GRID_RADIUS; vy++) {
      for (let vx = -GRID_RADIUS; vx <= GRID_RADIUS; vx++) {
        const bufferX = offsetRight + vx
        const bufferY = offsetUp + vy
        const bufferIdx = (bufferY + BUFFER_RADIUS) * bufferSize + (bufferX + BUFFER_RADIUS)
        const visibleIdx = (vy + GRID_RADIUS) * (GRID_RADIUS * 2 + 1) + (vx + GRID_RADIUS)
        
        if (bufferX >= -BUFFER_RADIUS && bufferX <= BUFFER_RADIUS &&
            bufferY >= -BUFFER_RADIUS && bufferY <= BUFFER_RADIUS) {
          visibleValues[visibleIdx] = cache.values[bufferIdx]
        } else {
          visibleValues[visibleIdx] = 255 // out of bounds
        }
      }
    }
    
    console.log('[Terrain] Extracted visible field:', {
      offsetRight,
      offsetUp,
      visibleRadius: GRID_RADIUS,
      totalCells: visibleValues.length,
      sampleValues: Array.from(visibleValues.slice(0, 10)),
      uniqueValues: new Set(visibleValues).size,
    })
    
    setField({
      values: visibleValues,
      radius: GRID_RADIUS,
      elapsedMs: 0,
    })
  }

  // Check if we need to request a new buffer grid
  useEffect(() => {
    const cache = bufferCache.current
    const currentOrigin = alignedOrigin(viewCenter, scaleExp)
    const step = stepFor(scaleExp)
    
    let needsNewBuffer = false
    
    if (!cache) {
      needsNewBuffer = true
    } else if (
      cache.rightAxis !== axes.right.axis ||
      cache.rightDir !== axes.right.dir ||
      cache.upAxis !== axes.up.axis ||
      cache.upDir !== axes.up.dir ||
      cache.step !== step
    ) {
      // View orientation or scale changed
      needsNewBuffer = true
    } else {
      // Check if we've moved too far from buffer center, using actual mapped axes
      const cacheCoords = { x: cache.centerX, y: cache.centerY, z: cache.centerZ }
      const currentRight = getAxisValue(currentOrigin, cache.rightAxis)
      const cacheRight = getAxisValue(cacheCoords, cache.rightAxis)
      const currentUp = getAxisValue(currentOrigin, cache.upAxis)
      const cacheUp = getAxisValue(cacheCoords, cache.upAxis)
      
      const offsetRight = Number(currentRight - cacheRight) / Number(step)
      const offsetUp = Number(currentUp - cacheUp) / Number(step)
      
      if (Math.abs(offsetRight) > BUFFER_THRESHOLD || Math.abs(offsetUp) > BUFFER_THRESHOLD) {
        needsNewBuffer = true
      } else {
        // Still within buffer, just extract visible portion
        extractVisibleField()
      }
    }
    
    if (needsNewBuffer) {
      const id = ++terrainRequestId
      latest.current = id
      postTerrain({
        id,
        originX: alignTo(viewCenter.x, scaleExp),
        originY: alignTo(viewCenter.y, scaleExp),
        originZ: alignTo(viewCenter.z, scaleExp),
        rightAxis: axes.right.axis,
        rightDir: axes.right.dir,
        upAxis: axes.up.axis,
        upDir: axes.up.dir,
        step: 1n << BigInt(scaleExp),
        radius: BUFFER_RADIUS,
        plane,
      })
    }
    // originKey stands in for position, which changes identity on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, scaleExp, plane, axes.right.axis, axes.right.dir, axes.up.axis, axes.up.dir])

  return field
}
