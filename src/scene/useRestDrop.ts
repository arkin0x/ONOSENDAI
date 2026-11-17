/**
 * useRestDrop.ts - where an avatar's origin is drawn when it is not your own
 * fluid WALK (arkinox, 2026-11-17: "an avatar shard's ORIGIN is the point
 * that touches the ground geometry"): on the surface under its gibson's
 * centre, within a gibson of it, else on its gibson's floor
 * (store/walkWalls.ts restDrop). The default icosahedron's lowest point is
 * its origin (scene/avatarMarker.ts), so it obeys the same rule.
 *
 * The hook keeps the drop, in gibsons, asked again when the avatar moves,
 * when the shards in the world change, and once a shard still being built
 * is built. easeRest moves a drawn drop toward it, so a hop or a wall
 * arriving never pops an avatar. Display only: nobody's coordinate, chain
 * or step changes.
 */

import { useEffect, useRef, type MutableRefObject } from 'react'
import type { Position } from '../lib/space'
import { useShards } from '../store/useShards'
import { REST_FLOOR, restDrop, wallsBuilt } from '../store/walkWalls'

/** How long a drawn avatar takes to settle onto a new surface, in seconds (the time constant). */
export const REST_TAU_S = 0.12

/** The drop for an avatar at `at` in `plane`, in gibsons under its gibson's centre; REST_FLOOR until asked, and when `at` is null. */
export function useRestDrop(at: Position | null, plane: number | null): MutableRefObject<number> {
  const drop = useRef(REST_FLOOR)
  const key = at && plane !== null ? `${plane}|${at.x},${at.y},${at.z}` : ''
  useEffect(() => {
    if (!at || plane === null) { drop.current = REST_FLOOR; return }
    let live = true
    const ask = (): void => {
      if (!live) return
      const r = restDrop(at, plane)
      drop.current = r.drop
      if (r.pending) void wallsBuilt().then(ask)
    }
    ask()
    // Shards arriving or leaving: asked again.
    const off = useShards.subscribe((st, prev) => { if (st.worldItems !== prev.worldItems || st.drawnItems !== prev.drawnItems) ask() })
    return () => { live = false; off() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return drop
}

/** `now` eased toward `to` over `dt` seconds (REST_TAU_S). */
export function easeRest(now: number, to: number, dt: number): number {
  const next = now + (to - now) * (1 - Math.exp(-Math.max(0, dt) / REST_TAU_S))
  return Math.abs(next - to) < 1e-4 ? to : next
}
