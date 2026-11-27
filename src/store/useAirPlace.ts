/**
 * useAirPlace.ts - the ghost block at arm's length in TERRAIN
 * (lib/terrain/airPlace.ts): how far along the look it stands, and whether it
 * is showing now (and whether a block could go there), for the HUD's stepper
 * and the wheel. The scene (scene/TerrainLayer.tsx) sets `ghost` only when it
 * changes, so nothing re-renders a frame at a time.
 *
 * The distance lasts the page's visit, AIR_DEFAULT at first.
 */

import { create } from 'zustand'
import { AIR_DEFAULT, clampAirDistance } from '../lib/terrain/airPlace'

/** off: the look meets a block, or nothing is in hand; ok: a block can go there; bad: it cannot (dim red). */
export type GhostState = 'off' | 'ok' | 'bad'

interface AirPlaceState {
  /** Blocks along the look, AIR_MIN to AIR_MAX. */
  distance: number
  ghost: GhostState
  /** Nearer (negative) or farther (positive) by whole blocks, clamped. */
  nudge: (by: number) => void
  setGhost: (ghost: GhostState) => void
}

export const useAirPlace = create<AirPlaceState>((set, get) => ({
  distance: AIR_DEFAULT,
  ghost: 'off',
  nudge: (by) => {
    const distance = clampAirDistance(get().distance + by)
    if (distance !== get().distance) set({ distance })
  },
  setGhost: (ghost) => { if (ghost !== get().ghost) set({ ghost }) },
}))
