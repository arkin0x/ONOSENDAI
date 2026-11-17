/**
 * useRestDrop.ts - where an avatar's origin is drawn when it is not your own
 * fluid WALK (arkinox, 2026-11-17: "an avatar shard's ORIGIN is the point
 * that touches the ground geometry"): on the surface under its gibson's
 * centre, within a gibson of it, else on its gibson's floor
 * (store/walkWalls.ts restDrop). Zoomed out past a gibson to a cell, on the
 * cell's floor: half a cell under its centre, as fluid WALK has it.
 *
 * The drop is asked as the avatar renders at a new place (so the first frame
 * there already has it), and again whenever the shards in the world change.
 * easeRest moves a drawn drop toward it, so a wall arriving never pops an
 * avatar. Display only: nobody's coordinate, chain or step changes.
 */

import { useEffect, useRef, type MutableRefObject } from 'react'
import type { Position } from '../lib/space'
import { useShards } from '../store/useShards'
import { REST_FLOOR, restDrop } from '../store/walkWalls'

/** How long a drawn avatar takes to settle onto a new surface, in seconds (the time constant). */
export const REST_TAU_S = 0.12

/**
 * The drop for an avatar at `at` in `plane` at zoom 2^`scaleExp`, in render
 * cells under its cell's centre: at 2^0 (a cell is a gibson) the surface's,
 * coarser the cell's floor. REST_FLOOR when `at` is null.
 */
export function useRestDrop(at: Position | null, plane: number | null, scaleExp: number): MutableRefObject<number> {
  const drop = useRef(REST_FLOOR)
  const asked = useRef<string | null>(null)
  const key = at && plane !== null ? `${plane}|${scaleExp}|${at.x},${at.y},${at.z}` : ''
  const ask = (): void => { drop.current = at && plane !== null && scaleExp === 0 ? restDrop(at, plane).drop : REST_FLOOR }
  if (asked.current !== key) { asked.current = key; ask() }
  useEffect(() => {
    if (!key) return
    // The shards in the world changed (found, placed, deleted, a new list to show): asked again.
    return useShards.subscribe((st, prev) => {
      if (st.discovered !== prev.discovered || st.mine !== prev.mine || st.curated !== prev.curated || st.deleted !== prev.deleted || st.deletedBags !== prev.deletedBags || st.worldItems !== prev.worldItems) ask()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return drop
}

/** `now` eased toward `to` over `dt` seconds (REST_TAU_S). */
export function easeRest(now: number, to: number, dt: number): number {
  const next = now + (to - now) * (1 - Math.exp(-Math.max(0, dt) / REST_TAU_S))
  return Math.abs(next - to) < 1e-4 ? to : next
}
