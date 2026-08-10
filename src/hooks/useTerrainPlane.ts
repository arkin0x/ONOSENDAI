/**
 * useTerrainPlane.ts — the K values for the cells currently on screen.
 *
 * The view is one plane: the avatar's slice along the out axis, GRID_RADIUS
 * cells either side of the view window. This slices that plane out of the
 * terrain cache and asks workers for whatever is missing, nothing more.
 *
 * There is no chunk lattice. Cells are addressed by their own world
 * coordinate, so nothing has to be aligned, rounded or tiled, and a move, a
 * rotation and a zoom all reuse whatever they happen to share.
 *
 * Missing cells are requested as contiguous spans along the screen-right axis.
 * Requesting whole rows would be simpler but throws the reuse away: stepping
 * one cell sideways leaves exactly one missing cell in every row, and asking
 * for the full row would resample the entire plane to learn 49 values.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { GRID_RADIUS, stepFor, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { cacheSize, inflightRuns, onTerrainData, readK, requestRun } from '../lib/terrainCache'
import { UNKNOWN } from '../workers/terrain.worker'
import type { Position } from '../lib/space'
import type { ViewWindow } from './useViewWindow'
import type { Plane } from 'cyberspace-core'

/** Cells across the visible plane. */
export const PLANE_SIZE = GRID_RADIUS * 2 + 1

export interface TerrainPlane {
  /** PLANE_SIZE^2 values, row-major, index (r + R) * N + (c + R). */
  values: Uint8Array
  /** UNKNOWN until sampled, and for anything outside the universe. */
  radius: number
}

/** World coordinate of the cell at screen offset (col, row) from the origin. */
function cellAt(
  origin: Position, axes: ViewAxes, step: bigint, col: number, row: number,
): Position {
  const p: Position = { ...origin }
  p[axes.right.axis] = origin[axes.right.axis] + BigInt(col) * step * BigInt(axes.right.dir)
  p[axes.up.axis] = origin[axes.up.axis] + BigInt(row) * step * BigInt(axes.up.dir)
  return p
}

export function useTerrainPlane(win: ViewWindow, axes: ViewAxes): TerrainPlane {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane: Plane = useCyberspace((s) => s.plane)

  // Bumped when new K values land, to re-slice.
  const [dataVersion, setDataVersion] = useState(0)
  const flushHandle = useRef<number | null>(null)

  useEffect(() => {
    // Coalesce to one re-slice per frame: a plane resolves as many small runs
    // and each arrival would otherwise rebuild the whole field.
    const unsubscribe = onTerrainData(() => {
      if (flushHandle.current !== null) return
      flushHandle.current = requestAnimationFrame(() => {
        flushHandle.current = null
        setDataVersion((v) => v + 1)
      })
    })
    return () => {
      unsubscribe()
      if (flushHandle.current !== null) cancelAnimationFrame(flushHandle.current)
    }
  }, [])

  const originKey = `${position.x},${position.y},${position.z}`

  return useMemo(() => {
    const R = GRID_RADIUS
    const N = PLANE_SIZE
    const step = stepFor(scaleExp)
    const origin = alignedOrigin(position, scaleExp)
    const values = new Uint8Array(N * N).fill(UNKNOWN)

    // Nearest row first, so the middle of the screen resolves before the edges.
    const rows = Array.from({ length: N }, (_, i) => i - R)
      .sort((a, b) => Math.abs(a + win.up) - Math.abs(b + win.up))

    for (const row of rows) {
      const r = row + R
      // Null, not -1: columns run -R..R, so -1 is a legal index and using it
      // as the sentinel silently dropped every span that began left of centre.
      let spanStart: number | null = null

      for (let col = -R; col <= R; col++) {
        const p = cellAt(origin, axes, step, win.right + col, win.up + row)
        const known = readK(p.x, p.y, p.z, plane)

        if (known !== undefined) {
          values[r * N + (col + R)] = known
          if (spanStart !== null) {
            requestSpan(origin, axes, step, plane, win, row, spanStart, col - 1)
            spanStart = null
          }
        } else if (spanStart === null) {
          spanStart = col
        }
      }

      if (spanStart !== null) requestSpan(origin, axes, step, plane, win, row, spanStart, R)
    }

    if (import.meta.env.DEV) {
      let known = 0
      for (let i = 0; i < values.length; i++) if (values[i] !== UNKNOWN) known++
      ;(window as unknown as { __terrain?: unknown }).__terrain = {
        known, total: N * N, cache: cacheSize(), inflight: inflightRuns(), scaleExp,
      }
    }

    return { values, radius: R }
    // originKey stands in for position, whose identity changes on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, scaleExp, plane, axes, win.right, win.up, dataVersion])
}

/** Ask for cells [fromCol, toCol] of one row, as a single run. */
function requestSpan(
  origin: Position, axes: ViewAxes, step: bigint, plane: Plane,
  win: ViewWindow, row: number, fromCol: number, toCol: number,
): void {
  const start = cellAt(origin, axes, step, win.right + fromCol, win.up + row)
  requestRun({
    originX: start.x,
    originY: start.y,
    originZ: start.z,
    axis: axes.right.axis,
    step: step * BigInt(axes.right.dir),
    count: toCol - fromCol + 1,
    plane,
  })
}
