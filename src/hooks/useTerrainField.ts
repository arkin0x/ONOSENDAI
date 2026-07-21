/**
 * useTerrainField.ts — keeps a sampled terrain K grid in sync with the view.
 *
 * Re-samples whenever the avatar's cell, the scale, the plane, or the screen
 * axis mapping changes. Responses older than the latest request are dropped, so
 * holding a movement key never paints a stale field.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { GRID_RADIUS, alignTo } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { getTerrainWorker, postTerrain, type TerrainResponse } from '../lib/workers'

export interface TerrainField {
  values: Uint8Array | null
  radius: number
  elapsedMs: number
}

const EMPTY: TerrainField = { values: null, radius: GRID_RADIUS, elapsedMs: 0 }

let terrainRequestId = 0

export function useTerrainField(): TerrainField {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.plane)
  const view = useCyberspace((s) => s.view)

  const [field, setField] = useState<TerrainField>(EMPTY)
  const latest = useRef(0)

  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  // Only the aligned cell matters, so sub-cell movement does not re-sample.
  const originKey = useMemo(() => {
    const o = alignedOrigin(position, scaleExp)
    return `${o.x}:${o.y}:${o.z}`
  }, [position, scaleExp])

  useEffect(() => {
    const worker = getTerrainWorker()
    const onMessage = (event: MessageEvent<TerrainResponse>) => {
      if (event.data.id !== latest.current) return
      setField({
        values: event.data.values,
        radius: event.data.radius,
        elapsedMs: event.data.elapsedMs,
      })
    }
    worker.addEventListener('message', onMessage)
    return () => worker.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    const id = ++terrainRequestId
    latest.current = id
    postTerrain({
      id,
      originX: alignTo(position.x, scaleExp),
      originY: alignTo(position.y, scaleExp),
      originZ: alignTo(position.z, scaleExp),
      rightAxis: axes.right.axis,
      rightDir: axes.right.dir,
      upAxis: axes.up.axis,
      upDir: axes.up.dir,
      step: 1n << BigInt(scaleExp),
      radius: GRID_RADIUS,
      plane,
    })
    // originKey stands in for position, which changes identity on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, scaleExp, plane, axes.right.axis, axes.right.dir, axes.up.axis, axes.up.dir])

  return field
}
