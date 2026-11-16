/**
 * fluidSwitch.ts: the Fluid WALK switch (lib/fluidWalk.ts), and a tap's
 * nudge. Kept apart from store/walkFluid.ts so the hold loop
 * (store/walkHold.ts) can ask it without importing the walk's frame.
 *
 * | Where | What |
 * |---|---|
 * | `?fluidwalk=1` or `?fluidwalk=0` in the address | on or off for this visit, whatever is saved |
 * | Settings, "Fluid WALK" | on or off, kept on this device |
 * | neither | FLUID_WALK_DEFAULT |
 *
 * FLUID_WALK_DEFAULT is ON for the preview of this change, so the owner can
 * try it at once; flip it before merging if the step WALK should stay the
 * default. Off, WALK is the step WALK exactly as it was: every press a step.
 */

import { create } from 'zustand'

/** Fluid WALK when nothing says otherwise. ON for the preview: flip it here before merging to keep the step WALK the default. */
export const FLUID_WALK_DEFAULT = true

export const FLUID_KEY = 'onosendai:fluidWalk'

/** The address's say for this visit: true, false, or null when it says nothing. */
export function fluidFromUrl(search: string): boolean | null {
  const v = new URLSearchParams(search).get('fluidwalk')
  if (v === null) return null
  if (v === '1' || v === 'on' || v === 'true' || v === '') return true
  if (v === '0' || v === 'off' || v === 'false') return false
  return null
}

/**
 * The default, unless the test setup asked for the step WALK
 * (src/test/fluidWalkOff.ts): every existing walk test runs with fluid off,
 * as WALK was.
 */
function fallback(): boolean {
  const seam = (globalThis as { __ONOSENDAI_FLUID_DEFAULT__?: boolean }).__ONOSENDAI_FLUID_DEFAULT__
  return typeof seam === 'boolean' ? seam : FLUID_WALK_DEFAULT
}

/** The switch as this visit starts: the address, else what this device saved, else the default. */
export function loadFluid(): boolean {
  try {
    if (typeof location !== 'undefined') {
      const url = fluidFromUrl(location.search)
      if (url !== null) return url
    }
  } catch { /* no address: a worker or a test */ }
  try {
    const saved = localStorage.getItem(FLUID_KEY)
    if (saved === 'on') return true
    if (saved === 'off') return false
  } catch { /* storage blocked */ }
  return fallback()
}

interface FluidSwitch {
  on: boolean
  /** Switch it, kept on this device. */
  set: (on: boolean) => void
}

export const useFluidWalk = create<FluidSwitch>((set) => ({
  on: loadFluid(),
  set: (on) => {
    try { localStorage.setItem(FLUID_KEY, on ? 'on' : 'off') } catch { /* storage blocked: kept for this visit */ }
    set({ on })
  },
}))

/** Whether WALK is fluid now. */
export function fluidOn(): boolean {
  return useFluidWalk.getState().on
}

/** A tap's push (FLUID_NUDGE_MS): the direction it pushes, until `until` (ms). */
export const fluidNudge = { fwd: 0, strafe: 0, vert: 0, until: 0 }

/** A direction went down: it pushes at least until `until`, however short the press. */
export function noteNudge(dir: { fwd: number; strafe: number; vert: number }, until: number): void {
  fluidNudge.fwd = dir.fwd
  fluidNudge.strafe = dir.strafe
  fluidNudge.vert = dir.vert
  fluidNudge.until = until
}
