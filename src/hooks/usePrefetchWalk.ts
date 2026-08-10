/**
 * usePrefetchWalk.ts — sample ahead of where you are likely to go.
 *
 * Once the visible plane is resolved the pool goes idle, and idle workers are
 * wasted work. This walks outward from the avatar a window at a time and
 * samples each window it lands on, so travel tends to arrive somewhere already
 * cached.
 *
 * The walk is random rather than a concentric ring. A ring spends its whole
 * budget completing a shell at the current radius before reaching anything
 * further out, which is the wrong shape for movement: people travel in a
 * direction, not in an annulus. A walk biases toward contiguous reachable
 * space and gets further from the origin for the same number of samples.
 *
 * It only runs while nothing is queued or in flight, so it can never delay the
 * cells actually on screen, and it stops once the cache is close to full so it
 * cannot evict the visible plane it is meant to support.
 */

import { useEffect, useRef } from 'react'
import { stepFor, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { cacheSize, inflightRuns } from '../lib/terrainCache'
import { queuedRuns } from '../lib/workers'
import { PLANE_SIZE, scanWindow } from './useTerrainPlane'
import type { Plane } from 'cyberspace-core'

/** Windows to sample before the walk gives up and waits for you to move. */
const MAX_STEPS = 32

/** Stop well short of eviction, so prefetch never displaces the live view. */
const CACHE_CEILING = 120_000

const TICK_MS = 250

const DIRECTIONS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
]

export function usePrefetchWalk(axes: ViewAxes): void {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane: Plane = useCyberspace((s) => s.plane)

  const walk = useRef({ right: 0, up: 0, steps: 0 })

  const originKey = `${position.x},${position.y},${position.z}`

  useEffect(() => {
    // Anything that changes what is on screen restarts the walk from the
    // avatar: the old trail is about somewhere you are no longer standing.
    walk.current = { right: 0, up: 0, steps: 0 }

    const id = setInterval(() => {
      if (walk.current.steps >= MAX_STEPS) return
      if (queuedRuns() > 0 || inflightRuns() > 0) return
      if (cacheSize() >= CACHE_CEILING) return

      const [dr, du] = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)]
      walk.current = {
        right: walk.current.right + dr * PLANE_SIZE,
        up: walk.current.up + du * PLANE_SIZE,
        steps: walk.current.steps + 1,
      }

      const step = stepFor(scaleExp)
      const origin = alignedOrigin(position, scaleExp)
      scanWindow(origin, axes, step, plane, walk.current.right, walk.current.up, null)
    }, TICK_MS)

    return () => clearInterval(id)
    // originKey stands in for position, whose identity changes on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, scaleExp, plane, axes])
}
