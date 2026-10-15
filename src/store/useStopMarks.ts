/**
 * useStopMarks.ts: which stop the field has called out as NEAREST, so the
 * fleet of cubes (StopCubes) leaves it to the NEAREST cube instead of drawing
 * a second cube on the same spot (arkinox, 2026-10-15: the nearest is a cube
 * the same size as the fleet's, in its own colour).
 */
import { create } from 'zustand'

interface StopMarks {
  /** The height StopField marks NEAREST, or null when it marks none. */
  nearest: number | null
  setNearest: (height: number | null) => void
}

export const useStopMarks = create<StopMarks>((set, get) => ({
  nearest: null,
  setNearest: (height) => { if (get().nearest !== height) set({ nearest: height }) },
}))
