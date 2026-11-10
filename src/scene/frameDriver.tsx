/**
 * frameDriver.tsx: draws the main view, every frame the display offers, or no more
 * than 60 a second when nothing is moving (lib/frameGate.ts).
 *
 * The canvas is on frameloop "never" and this calls R3F's advance itself, from its
 * own requestAnimationFrame. So a frame is decided on the frame it would be drawn,
 * and an input heard before it draws on it, with no first frame lost. A demand
 * frameloop would ask for the next frame, one display frame late. Changing the
 * frameloop would zero the clock.
 *
 * The clock is kept here, so to everything in the scene a pause under the workshop
 * never happened (as ClockKeeper did), and a skipped frame is just a longer delta.
 */

import { advance, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { FrameGate, WAKE_EVENTS, sceneStamp } from '../lib/frameGate'
import { isBroadcast } from '../lib/tv/broadcast'
import { useBuilder } from '../store/useBuilder'
import { useCeremony } from '../store/useCeremony'
import { useCyberspace } from '../store/useCyberspace'
import { useDemo } from '../store/useDemo'
import { useHyperspace } from '../store/useHyperspace'
import { useOpenCeremony } from '../store/useOpenCeremony'
import { useShards } from '../store/useShards'
import { useTv } from '../store/useTv'
import { useGame } from '../store/useGame'
import { useWorkshop } from '../store/useWorkshop'
import { flyDir, useViewFly } from '../lib/viewFly'

/**
 * Whether something is going on that should have every frame, whatever the scene's
 * stamp says. When unsure, this says yes: each is a mode that animates, or that a
 * person is in the middle of.
 */
export function viewBusy(): boolean {
  if (isBroadcast()) return true
  const cs = useCyberspace.getState()
  if (cs.walking || cs.transit !== null) return true
  // VIEW flying (a button held, or two or three fingers at rest): the cursor and the camera move every frame.
  if (flyDir() !== 0) return true
  if (useTv.getState().on || useDemo.getState().active || useBuilder.getState().active) return true
  if (useShards.getState().pending !== null) return true
  const hy = useHyperspace.getState()
  if (hy.viewOwned || hy.scrubHeight !== null || hy.viewedStop !== null || hy.destination !== null) return true
  // A shard decoding needs no line here: its births stay listed for good, but each
  // frame of the decode writes its vertices, which the stamp sees, and the store's
  // change wakes it first. No allocation here: this runs every display frame.
  for (const _ in useOpenCeremony.getState().playing) return true
  return false
}

/** Stores whose every change means the view may be about to change: wake on it. */
const STORES = [useCyberspace, useHyperspace, useShards, useTv, useDemo, useBuilder, useCeremony, useOpenCeremony, useViewFly] as const

export function FrameDriver(): null {
  const get = useThree((s) => s.get)
  // The workshop is an opaque, full-screen bench with its own canvas. Drawing
  // the world under it is pure cost, and on a phone it was most of the frame:
  // the bench measured 3 fps with the world running behind it.
  // A game on screen (game/GameView.tsx) covers it the same way, with a canvas of its own.
  const benchOpen = useWorkshop((s) => s.open)
  const playing = useGame((s) => s.session !== null)
  const covered = benchOpen || playing
  // Across a pause: the time the scene has seen.
  const elapsed = useRef(0)
  useEffect(() => {
    if (covered) return
    const clock = get().clock
    // R3F's frame reads the clock first; left running it adds the time since, and the delta comes out as nothing.
    clock.autoStart = false
    clock.stop()
    const gate = new FrameGate()
    const wake = (): void => gate.wake(performance.now())
    for (const name of WAKE_EVENTS) window.addEventListener(name, wake, { capture: true, passive: true })
    document.addEventListener('visibilitychange', wake)
    const stops = STORES.map((s) => (s as { subscribe: (f: () => void) => () => void }).subscribe(wake))
    let last = performance.now()
    let stamp = NaN
    let raf = 0
    const tick = (t: number): void => {
      raf = requestAnimationFrame(tick)
      elapsed.current += Math.max(0, t - last) / 1000
      last = t
      if (!gate.shouldDraw(t, viewBusy())) return
      const state = get()
      advance(elapsed.current, false, state)
      const now = sceneStamp(state.scene as never, state.camera as never)
      if (now !== stamp) gate.wake(t)
      stamp = now
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      for (const name of WAKE_EVENTS) window.removeEventListener(name, wake, { capture: true })
      document.removeEventListener('visibilitychange', wake)
      for (const stop of stops) stop()
    }
  }, [covered, get])
  return null
}
