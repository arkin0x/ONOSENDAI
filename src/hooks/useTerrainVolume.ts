/**
 * useTerrainVolume.ts — the K values for the cells currently around you.
 *
 * A cube of gibsons centred on the view window: GRID_RADIUS cells either side
 * on all three axes, so the field exists in every direction rather than as a
 * single slice. The camera orbits inside it.
 *
 * This is affordable because of the block cache. K is constant across an aligned
 * 2^3 cube, so at scaleExp 0 a 49³ volume needs about (49/8)³ ≈ 343 distinct
 * samples rather than 117,649. At scaleExp 3 and above every cell is its own
 * block and the full cost returns, which is the ceiling to watch.
 *
 * Cells are addressed by their own world coordinate, so nothing is aligned,
 * rounded or tiled, and a move, a rotation and a zoom reuse whatever they share.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { GRID_RADIUS, stepFor, type AxisName, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import {
  BLOCK_BITS, BLOCK_SIZE, cacheSize, inflightRuns, isPending,
  onTerrainData, readK, requestRun,
} from '../lib/terrainCache'
import { UNKNOWN } from '../workers/terrain.worker'
import type { Position } from '../lib/space'
import type { ViewWindow } from './useViewWindow'
import type { Plane } from 'cyberspace-core'

/** Cells across the volume, per axis. */
export const VOLUME_SIZE = GRID_RADIUS * 2 + 1

export interface TerrainVolume {
  /** VOLUME_SIZE^3 values, indexed ((d+R)*N + (r+R))*N + (c+R). */
  values: Uint8Array
  radius: number
}

/** World coordinate at a screen-space offset from the origin cell. */
function cellAt(
  origin: Position, axes: ViewAxes, step: bigint,
  col: number, row: number, depth: number,
): Position {
  const p: Position = { ...origin }
  const put = (a: AxisName, n: number, dir: number): void => {
    p[a] = origin[a] + BigInt(n) * step * BigInt(dir)
  }
  put(axes.right.axis, col, axes.right.dir)
  put(axes.up.axis, row, axes.up.dir)
  put(axes.out.axis, depth, axes.out.dir)
  return p
}

export function useTerrainVolume(win: ViewWindow, axes: ViewAxes): TerrainVolume {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane: Plane = useCyberspace((s) => s.plane)

  const [dataVersion, setDataVersion] = useState(0)
  const flushHandle = useRef<number | null>(null)

  useEffect(() => {
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
    const N = VOLUME_SIZE
    const step = stepFor(scaleExp)
    const origin = alignedOrigin(position, scaleExp)
    const values = new Uint8Array(N * N * N).fill(UNKNOWN)

    // Below the block size consecutive cells share a block, so step by the
    // block and let one sample serve them all.
    const stride = step >= BLOCK_SIZE ? step : BLOCK_SIZE

    // Nearest slice first, then nearest row, so the middle of the volume
    // resolves before its shell.
    const order = (n: number): number[] =>
      Array.from({ length: n }, (_, i) => i - R).sort((a, b) => Math.abs(a) - Math.abs(b))

    for (const depth of order(N)) {
      for (const row of order(N)) {
        const samples: bigint[] = []
        const seen = new Set<bigint>()
        let rowCell: Position | null = null

        for (let col = -R; col <= R; col++) {
          const p = cellAt(origin, axes, step, win.right + col, win.up + row, win.out + depth)

          const known = readK(p.x, p.y, p.z, plane)
          if (known !== undefined) {
            values[((depth + R) * N + (row + R)) * N + (col + R)] = known
            continue
          }
          if (isPending(p.x, p.y, p.z, plane)) continue

          // One sample per block per pass, or a block is asked for once per
          // cell it contains while the first answer is still in flight.
          const block = p[axes.right.axis] >> BLOCK_BITS
          if (seen.has(block)) continue
          seen.add(block)

          rowCell = p
          samples.push(block << BLOCK_BITS)
        }

        if (!rowCell || samples.length === 0) continue
        samples.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

        let start = 0
        for (let i = 1; i <= samples.length; i++) {
          if (i === samples.length || samples[i] - samples[i - 1] !== stride) {
            const p: Position = { ...rowCell }
            p[axes.right.axis] = samples[start]
            requestRun({
              originX: p.x, originY: p.y, originZ: p.z,
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

    if (import.meta.env.DEV) {
      let known = 0
      for (let i = 0; i < values.length; i++) if (values[i] !== UNKNOWN) known++
      ;(window as unknown as { __terrain?: unknown }).__terrain = {
        known, total: N * N * N, cache: cacheSize(), inflight: inflightRuns(), scaleExp,
      }
    }

    return { values, radius: R }
    // originKey stands in for position, whose identity changes on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, scaleExp, plane, axes, win.right, win.up, win.out, dataVersion])
}
