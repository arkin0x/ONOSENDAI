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
 *
 * The fluid pause (arkinox, 2026-11-22; lib/fluidWalk.ts FLUID_PAUSE_AT):
 * `on` is your choice and is the only thing saved; `paused` is the walk
 * switching fluid off for you while your chain catches up, for this visit
 * only, never saved, so a reload, another tab or another identity always
 * starts from your choice. fluidOn() is the two together.
 *
 * | Events ahead (store/walkAhead.ts) | With the sync limit on (store/walkLimits.ts) |
 * |---|---|
 * | FLUID_PAUSE_AT (21) or more, fluid on | paused: the walk goes on as the step WALK |
 * | FLUID_RESUME_AT (15) or fewer, paused | fluid back on |
 * | in between | stays as it is: no flapping |
 * | the sync limit turned off while paused | fluid back on at once |
 *
 * A switch by hand (set) always wins and ends the pause: turned off, fluid
 * stays off and nothing turns it back on; turned on, it is on now (and
 * pauses again only if the chain is still FLUID_PAUSE_AT behind).
 */

import { create } from 'zustand'
import { FLUID_PAUSE_AT, FLUID_RESUME_AT } from '../lib/fluidWalk'

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
  /** Your choice, kept on this device. */
  on: boolean
  /** Fluid switched off for you while your chain catches up (fluidPauseCheck): this visit only, never saved. */
  paused: boolean
  /** When fluid last came back on by itself (performance.now ms), for the brief notice; 0 for never or after a switch by hand. */
  resumedAt: number
  /** Switch it by hand, kept on this device: ends any pause, and nothing turns it back for you. */
  set: (on: boolean) => void
}

export const useFluidWalk = create<FluidSwitch>((set) => ({
  on: loadFluid(),
  paused: false,
  resumedAt: 0,
  set: (on) => {
    try { localStorage.setItem(FLUID_KEY, on ? 'on' : 'off') } catch { /* storage blocked: kept for this visit */ }
    set({ on, paused: false, resumedAt: 0 })
  },
}))

/** Whether WALK is fluid now: switched on, and not paused for the chain. */
export function fluidOn(): boolean {
  const s = useFluidWalk.getState()
  return s.on && !s.paused
}

/** How long the "back on" notice shows after fluid comes back on by itself, in ms. */
export const FLUID_RESUME_NOTICE_MS = 2500

/**
 * The fluid pause, for `ahead` events ahead with the sync limit `limits`
 * (see the table above). Called whenever the count can change
 * (store/walkFluid.ts). Writes the store only when the pause starts or ends,
 * so a count that changes nothing renders nothing.
 */
export function fluidPauseCheck(ahead: number, limits: boolean, now: number = performance.now()): void {
  const s = useFluidWalk.getState()
  if (s.paused) {
    if (!limits || ahead <= FLUID_RESUME_AT) useFluidWalk.setState({ paused: false, resumedAt: now })
    return
  }
  if (limits && s.on && ahead >= FLUID_PAUSE_AT) useFluidWalk.setState({ paused: true, resumedAt: 0 })
}

/** Forget a pause without the notice (an identity switch: the next walk starts from your choice). */
export function clearFluidPause(): void {
  if (useFluidWalk.getState().paused || useFluidWalk.getState().resumedAt !== 0) useFluidWalk.setState({ paused: false, resumedAt: 0 })
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
