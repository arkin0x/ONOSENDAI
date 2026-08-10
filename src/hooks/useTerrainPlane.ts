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
 * Sampling is per block, not per cell. K is constant across a BLOCK_SIZE cube,
 * so below that scale one sample serves every cell inside it: at scaleExp 0 a
 * 2,401 cell plane needs 49 to 64 samples depending on how the window lands
 * against the block lattice, not 2,401.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { GRID_RADIUS, stepFor, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import {
  BLOCK_BITS, BLOCK_SIZE, cacheSize, inflightRuns, isPending,
  onTerrainData, readK, requestRun,
} from '../lib/terrainCache'
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

/**
 * Fill what the cache knows about one window, and ask for the rest.
 *
 * `values` is optional so the prefetcher can drive the same traversal purely
 * for its requests. Requests are grouped into runs of consecutive samples so
 * one message covers a whole row's worth of missing blocks.
 */
function scanWindow(
  origin: Position, axes: ViewAxes, step: bigint, plane: Plane,
  centreRight: number, centreUp: number,
  values: Uint8Array | null,
): void {
  const R = GRID_RADIUS
  const N = PLANE_SIZE

  // Below the block size, consecutive cells share a block, so step by the
  // block instead and let one sample serve them all.
  const stride = step >= BLOCK_SIZE ? step : BLOCK_SIZE

  // Nearest row first, so the middle of the screen resolves before the edges.
  const rows = Array.from({ length: N }, (_, i) => i - R)
    .sort((a, b) => Math.abs(a) - Math.abs(b))

  for (const row of rows) {
    const samples: bigint[] = []
    const seenBlocks = new Set<bigint>()
    let rowCell: Position | null = null

    for (let col = -R; col <= R; col++) {
      const p = cellAt(origin, axes, step, centreRight + col, centreUp + row)

      const known = readK(p.x, p.y, p.z, plane)
      if (known !== undefined) {
        if (values) values[(row + R) * N + (col + R)] = known
        continue
      }
      if (isPending(p.x, p.y, p.z, plane)) continue

      // One sample per block per pass, or a block would be asked for once per
      // cell it contains while the first answer is still in flight.
      const block = p[axes.right.axis] >> BLOCK_BITS
      if (seenBlocks.has(block)) continue
      seenBlocks.add(block)

      rowCell = p
      samples.push(block << BLOCK_BITS)
    }

    if (!rowCell || samples.length === 0) continue
    samples.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    let start = 0
    for (let i = 1; i <= samples.length; i++) {
      if (i === samples.length || samples[i] - samples[i - 1] !== stride) {
        requestRun({
          ...axisOrigin(rowCell, axes, samples[start]),
          axis: axes.right.axis,
          step: stride,
          count: i - start,
          plane,
        })
        start = i
      }
    }
  }
}

/** The row's cell with its right-axis coordinate replaced by `coord`. */
function axisOrigin(
  rowCell: Position, axes: ViewAxes, coord: bigint,
): { originX: bigint; originY: bigint; originZ: bigint } {
  const p: Position = { ...rowCell }
  p[axes.right.axis] = coord
  return { originX: p.x, originY: p.y, originZ: p.z }
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

    scanWindow(origin, axes, step, plane, win.right, win.up, values)

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

export { scanWindow }
