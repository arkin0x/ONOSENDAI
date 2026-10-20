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
import { stepFor, type AxisName, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import {
  BLOCK_BITS, BLOCK_SIZE, blockKey, cacheSize, inflightRuns, isKeyPending,
  onTerrainData, readKey, requestRun,
} from '../lib/terrainCache'
import { clearRunQueue } from '../lib/workers'
import { UNKNOWN } from '../workers/terrain.worker'
import { CURSOR_SETTLE_MS } from './useViewWindow'
import type { Position } from '../lib/space'
import type { ViewWindow } from './useViewWindow'
import type { Plane } from 'cyberspace-core'

/**
 * Half-width of the rendered volume, in cells.
 *
 * Deliberately smaller than GRID_RADIUS. A full 49³ is 117,649 cells, and while
 * the block cache makes the *sampling* cheap (343 distinct values at scaleExp 0),
 * the cost that actually hurts is the CPU re-scanning every cell on each flush
 * and rebuilding the buffer. 9 gives 19³ = 6,859, roughly 17x less scan than a full
 * 49³ while still surrounding the camera.
 */
export const VOLUME_RADIUS = 9

/** Cells across the volume, per axis. */
export const VOLUME_SIZE = VOLUME_RADIUS * 2 + 1

/** Rebuilds are throttled to this, so a burst of arrivals cannot rescan per frame. */
const FLUSH_MS = 120

export interface TerrainVolume {
  /** VOLUME_SIZE^3 values, indexed ((d+R)*N + (r+R))*N + (c+R). */
  values: Uint8Array
  radius: number
  /** The cell at the volume's centre, in cyberspace, and the frame its offsets run along. */
  centre: Position
  axes: ViewAxes
  scaleExp: number
}

/** World coordinate at a screen-space offset from the origin cell. */
function cellAt(
  origin: Position, axes: ViewAxes, step: bigint,
  col: number, row: number, depth: number,
): Position {
  const p: Position = { ...origin }
  // Offsets are whole cells; one that is not (a float past 2^53 from far
  // upstream) is rounded rather than allowed to throw and take the scene down.
  const put = (a: AxisName, n: number, dir: number): void => {
    p[a] = origin[a] + BigInt(Number.isFinite(n) ? Math.round(n) : 0) * step * BigInt(dir)
  }
  put(axes.right.axis, col, axes.right.dir)
  put(axes.up.axis, row, axes.up.dir)
  put(axes.out.axis, depth, axes.out.dir)
  return p
}

/** The volume's blocks and their cache keys around one centre, and what has been read of them so far. */
export interface VolumeLayout {
  plane: Plane
  /** The axis rows run along. */
  right: AxisName
  /** The gap between two neighbouring blocks' samples on that axis. */
  stride: bigint
  /** True when a row's segments come in ascending order on the right axis. */
  ascending: boolean
  /** Row r's segments are rowFirst[r] up to rowFirst[r + 1], in scan order. */
  rowFirst: Int32Array
  /** A point on each row's line, for the other two axes of the runs it asks for; its right-axis value is not used. */
  rowCell: Position[]
  /** Per segment: its block's cache key, the block on the right axis, and its cells in `values`. */
  keys: string[]
  blocks: bigint[]
  at: Int32Array
  cells: Uint8Array
  /** Segments already read as known, and the values read so far. Carried from one read to the next. */
  known: Uint8Array
  values: Uint8Array
}

/**
 * Where every block of the volume sits, and its cache key: worked out once per
 * place, zoom, turn and plane, then read again on every terrain flush.
 *
 * Along a row only the right axis moves, so a row's first cell is worked out
 * once and stepped from, and the cells of one block (consecutive along the
 * row, since the row is monotonic) are one segment that shares its answer.
 * Building a coordinate and two cache keys for every one of the 6,859 cells
 * made a rescan a long task: 254 ms at worst at one boot on a loaded dev
 * machine (2026-10-20, spectating on the smoke seed; numbers in #404).
 *
 * Even by block, every flush wrote out and hashed the same keys as the last,
 * every known block was looked up again, and each answer from the workers
 * wrote its keys out twice more. So the keys are written out here, once, a
 * flush only looks up the blocks it does not have yet, and the runs it asks
 * for carry their keys to the cache. Replaying sixteen /tv cuts in headless
 * Chromium with the real workers, this halved the terrain's main-thread time
 * again after hex keys (570 ms to 311 ms; flushes 70 ms to 17 ms), and the
 * volumes came out byte for byte the same (2026-10-20, numbers in the PR).
 */
export function layoutVolume(centre: Position, axes: ViewAxes, scaleExp: number, plane: Plane): VolumeLayout {
  const R = VOLUME_RADIUS
  const N = VOLUME_SIZE
  const step = stepFor(scaleExp)
  const right = axes.right.axis
  const rightStep = step * BigInt(axes.right.dir)

  // Below the block size consecutive cells share a block, so step by the
  // block and let one sample serve them all.
  const stride = step >= BLOCK_SIZE ? step : BLOCK_SIZE

  // Nearest slice first, then nearest row, so the middle of the volume
  // resolves before its shell.
  const order = Array.from({ length: N }, (_, i) => i - R).sort((a, b) => Math.abs(a) - Math.abs(b))

  // Sized for the worst case, a segment per cell, so nothing grows; this is
  // laid out on every step of a walk and should cost no more than a scan did.
  const rowFirst = new Int32Array(N * N + 1)
  const rowCell: Position[] = []
  const keys: string[] = []
  const blocks: bigint[] = []
  const at = new Int32Array(N * N * N)
  const cells = new Uint8Array(N * N * N)
  let segments = 0

  for (const depth of order) {
    for (const row of order) {
      rowFirst[rowCell.length] = segments
      const p = cellAt(centre, axes, step, -R, row, depth)
      const first = ((depth + R) * N + (row + R)) * N
      let lastBlock: bigint | null = null

      for (let col = 0; col < N; col++, p[right] += rightStep) {
        const block = p[right] >> BLOCK_BITS
        if (block === lastBlock) {
          cells[segments - 1]++
          continue
        }
        lastBlock = block
        keys.push(blockKey(p.x, p.y, p.z, plane))
        blocks.push(block)
        at[segments] = first + col
        cells[segments++] = 1
      }
      rowCell.push({ ...p })
    }
  }
  rowFirst[rowCell.length] = segments

  return {
    plane, right, stride, ascending: axes.right.dir > 0, rowFirst, rowCell,
    keys, blocks, at, cells,
    known: new Uint8Array(segments),
    values: new Uint8Array(N * N * N).fill(UNKNOWN),
  }
}

/**
 * The K values of the volume's cells, from the cache, asking the workers for
 * every block not yet known or asked for. The array is a new one when
 * something has become known since the last read and the same one when
 * nothing has, so an empty flush can rebuild nothing downstream. An array
 * once returned is never written to again.
 *
 * A segment once known is not looked up again. K is a pure function of the
 * coordinate, so the value read then is the value any later read would give;
 * the one difference is a block evicted from the cache while on screen, which
 * stays drawn here rather than going dark and being asked for again.
 */
export function readVolume(layout: VolumeLayout): Uint8Array {
  const { keys, blocks, at, cells, known, rowFirst, stride, right, plane } = layout
  let values: Uint8Array | null = null

  for (let r = 0; r + 1 < rowFirst.length; r++) {
    const wanted: number[] = []
    for (let s = rowFirst[r]; s < rowFirst[r + 1]; s++) {
      if (known[s]) continue
      const k = readKey(keys[s])
      if (k !== undefined) {
        known[s] = 1
        if (!values) {
          // Copied before the first write, so an array already handed out
          // never changes, and kept on the layout at once, so the segment
          // marked known above is never without its value.
          values = layout.values.slice()
          layout.values = values
        }
        values.fill(k, at[s], at[s] + cells[s])
      } else if (!isKeyPending(keys[s])) {
        // Neither known nor already asked for: into this row's runs below.
        wanted.push(s)
      }
    }

    if (wanted.length === 0) continue
    // Runs ascend along the axis, whichever way the row is read.
    if (!layout.ascending) wanted.reverse()

    let start = 0
    for (let i = 1; i <= wanted.length; i++) {
      if (i === wanted.length || (blocks[wanted[i]] - blocks[wanted[i - 1]]) << BLOCK_BITS !== stride) {
        // The row's other two axes, with the run's first sample on this one.
        const q: Position = { ...layout.rowCell[r] }
        q[right] = blocks[wanted[start]] << BLOCK_BITS
        requestRun({
          originX: q.x, originY: q.y, originZ: q.z,
          axis: right,
          step: stride,
          count: i - start,
          plane,
        }, wanted.slice(start, i).map((w) => keys[w]))
        start = i
      }
    }
  }

  return layout.values
}

export function useTerrainVolume(win: ViewWindow, axes: ViewAxes, suspend = false): TerrainVolume {
  // The anchor: the terrain is around whoever the scene is anchored on.
  const position = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane: Plane = useCyberspace((s) => s.anchorPlane)

  const [dataVersion, setDataVersion] = useState(0)
  const flushHandle = useRef<number | null>(null)

  useEffect(() => {
    // Throttled rather than per-frame. A volume resolves as hundreds of small
    // runs, and rescanning every cell on each arrival is what made filling it
    // take seconds: the sampling is milliseconds, the scanning is not.
    //
    // The flush also waits out cursor movement. Results requested before a run
    // of keypresses keep arriving during it, and bumping dataVersion then puts
    // a full rescan and geometry rebuild inside the movement itself, which is
    // exactly the stutter the settle delay exists to remove. The data loses
    // nothing by waiting: it lands in the cache the moment it arrives, and the
    // rescan on settle picks it all up at once.
    let lastMove = 0
    const unsubMove = useCyberspace.subscribe((s, prev) => {
      if (s.cursor !== prev.cursor) lastMove = performance.now()
    })
    const fire = (): void => {
      const since = performance.now() - lastMove
      if (since < CURSOR_SETTLE_MS) {
        flushHandle.current = window.setTimeout(fire, CURSOR_SETTLE_MS - since)
        return
      }
      flushHandle.current = null
      setDataVersion((v) => v + 1)
    }
    const unsubscribe = onTerrainData(() => {
      if (flushHandle.current !== null) return
      flushHandle.current = window.setTimeout(fire, FLUSH_MS)
    })
    return () => {
      unsubMove()
      unsubscribe()
      if (flushHandle.current !== null) clearTimeout(flushHandle.current)
    }
  }, [])

  // The window's centre in cyberspace. The volume is a function of where it
  // is in the world, not of the render frame it is drawn in, so a landing
  // that re-anchors the frame (and carries the window with it, useViewWindow)
  // keeps this key and rescans nothing.
  const centre = cellAt(alignedOrigin(position, scaleExp), axes, stepFor(scaleExp), win.right, win.up, win.out)
  // In hex, which Chromium writes out far faster than decimal (terrainCache, blockKey).
  const centreKey = `${centre.x.toString(16)},${centre.y.toString(16)},${centre.z.toString(16)}`

  // Suspended (an Earth or hyperspace view): drop any queued terrain work so
  // the pool goes quiet, and hand back an empty volume. The memo below keys
  // on `suspend`, so leaving the view rebuilds and rescans automatically.
  // Dropping a run gives its blocks back as not yet asked for (terrainCache,
  // setRunDropHandler), so that rescan asks for them again.
  useEffect(() => {
    if (suspend) clearRunQueue()
  }, [suspend])

  // How long the layout took, so the DEV timing below covers a whole rescan
  // after a move as it did before the layout was split out.
  const layoutMs = useRef(0)
  // The keys of every block around the centre, written out once per place,
  // zoom, turn and plane; each flush below only reads them.
  const layout = useMemo(
    () => {
      if (suspend) return null
      const t0 = performance.now()
      const built = layoutVolume(centre, axes, scaleExp, plane)
      layoutMs.current = performance.now() - t0
      return built
    },
    // centreKey stands in for centre, whose identity changes on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [centreKey, scaleExp, plane, axes, suspend],
  )
  const last = useRef<TerrainVolume | null>(null)

  return useMemo(() => {
    if (!layout) {
      return { values: new Uint8Array(VOLUME_SIZE ** 3).fill(UNKNOWN), radius: VOLUME_RADIUS, centre, axes, scaleExp }
    }
    const t0 = performance.now()
    const R = VOLUME_RADIUS
    const N = VOLUME_SIZE
    const values = readVolume(layout)

    if (import.meta.env.DEV) {
      let known = 0
      for (let i = 0; i < values.length; i++) if (values[i] !== UNKNOWN) known++
      const w = window as unknown as { __terrain?: { scans?: number[] } & Record<string, unknown> }
      const scans = w.__terrain?.scans ?? []
      scans.push(Math.round((performance.now() - t0 + layoutMs.current) * 100) / 100)
      layoutMs.current = 0
      w.__terrain = {
        known, total: N * N * N, cache: cacheSize(), inflight: inflightRuns(), scaleExp,
        scans: scans.slice(-40),
      }
    }

    // Nothing new since the last read of this layout: the same volume, so the
    // point field is not rebuilt for a flush that changed none of it.
    if (last.current?.values === values) return last.current
    last.current = { values, radius: R, centre, axes, scaleExp }
    return last.current
    // The layout carries the place, zoom, turn and plane; centre, axes and
    // scaleExp only go along with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, dataVersion])
}
