/**
 * Voices.tsx - the drones heard where they fly (droneVoices.ts), run from
 * the canvas's frames. Draws nothing.
 *
 * Each frame, after the camera is placed (PRIORITY.fill): the camera
 * becomes the ears through the app's own listener (store/useHiddenAudio
 * audioListener and moveListener, the helper hidden audio moves to the
 * main view's camera; the main view stops drawing while a game is on
 * screen, scene/frameDriver, so the ears are the game's alone meanwhile,
 * and the main view takes them back on its first frame after), and every
 * drone, drawn between the last two steps as the canvas draws it, is
 * handed to the voices.
 *
 * The rules:
 * - Nothing is made before the browser lets sound out: no node until the
 *   shared context runs, which the first tap or key does (audio.ts
 *   warmSound, lib/audioContext wantSound).
 * - The game's sound switch (M, the speaker on the HUD) and MUTE ALL
 *   (store/useSoundMutes) silence the voices: they fade out and every node
 *   is stopped and parted.
 * - The page hidden or the screen gone: every voice fades out, is stopped
 *   on schedule and parted. The run paused (a card up): each voice fades
 *   and keeps its drone.
 * - Voices that throw (sound data the checks missed) are stopped for the
 *   rest of the run; the game plays on.
 *
 * A recording can listen in (setVoiceTap, only where the DEV handle is
 * allowed): it is handed each frame's facts and the camera, so it can
 * render the same voices offline.
 */

import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Camera } from 'three'
import { segmentClear, type Vec3 } from '../../lib/games/droneRun/sim'
import { audioContext, audioRunning } from '../../lib/audioContext'
import { audioListener, moveListener } from '../../store/useHiddenAudio'
import { droneRunSilent, gameBus } from './audio'
import { DroneVoices, soundsOf, type VoiceDrone, type VoiceInput } from './droneVoices'
import { PRIORITY, type DroneRunView } from './view'
import { devHandleAllowed } from './devHandle'

/** Whether this is a phone: a coarse pointer (fewer voices, equal-power panning). */
function phoneLike(): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches } catch { return false }
}

export type VoiceTap = (input: VoiceInput, camera: Camera) => void
let tap: VoiceTap | null = null
/** A recording's ear on every frame's facts; null to stop. Only where the DEV handle is allowed (devHandle.ts: development, or ?droneRunDebug=1 off the production hosts). */
export function setVoiceTap(fn: VoiceTap | null): void {
  tap = fn && devHandleAllowed() ? fn : null
}

/** The shared context's time while it runs, so a teardown fades and stops on schedule; else undefined (silent anyway: at once). */
function nowIfRunning(): number | undefined {
  return audioRunning() ? audioContext()?.currentTime : undefined
}

/** The voices' facts for this frame, from the runner, into reused objects. */
function fill(view: DroneRunView, input: VoiceInput, pool: VoiceDrone[]): void {
  const { runner } = view
  const st = runner.state
  runner.eye(input.eye)
  const ev = st.body.vel
  input.eyeVel[0] = ev[0]; input.eyeVel[1] = ev[1]; input.eyeVel[2] = ev[2]
  input.paused = runner.paused
  const defs = st.world.variant.spec.enemies
  const list = input.drones as VoiceDrone[]
  list.length = 0
  for (let i = 0; i < st.drones.length; i++) {
    const d = st.drones[i]
    if (d.hp <= 0) continue
    let v = pool[i]
    if (!v) { v = { id: 0, def: defs[d.def], pos: [0, 0, 0], vel: [0, 0, 0], mode: '', windup: -1, burstLeft: 0 }; pool[i] = v }
    v.id = d.id
    v.def = defs[d.def]
    runner.between('drones', d.id, d.pos, v.pos)
    v.vel[0] = d.vel[0]; v.vel[1] = d.vel[1]; v.vel[2] = d.vel[2]
    v.mode = d.mode
    v.windup = d.windup
    v.burstLeft = d.burstLeft
    list.push(v)
  }
}

export function Voices({ view }: { view: DroneRunView }): null {
  const voices = useMemo(() => new DroneVoices(soundsOf(view.runner.state.world.variant.client), phoneLike()), [view])
  const input = useMemo<VoiceInput>(() => ({
    eye: [0, 0, 0], eyeVel: [0, 0, 0], drones: [], paused: false,
    clear: (a: Vec3, b: Vec3) => segmentClear(view.runner.state.world.solids, a, b),
  }), [view])
  const pool = useMemo<VoiceDrone[]>(() => [], [view])

  // The screen gone or the page hidden: every voice fades out, stops, and is parted.
  useEffect(() => {
    const hide = (): void => { if (document.visibilityState === 'hidden') voices.dispose(nowIfRunning()) }
    document.addEventListener('visibilitychange', hide)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      voices.dispose(nowIfRunning())
    }
  }, [voices])
  // Voices that threw (bad sound data the checks missed) stay off for this run rather than stop the game.
  const failed = useMemo(() => ({ on: false }), [voices])

  useFrame(({ camera }) => {
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    const live = !hidden && !failed.on && !droneRunSilent() && audioRunning()
    if (!live) {
      if (voices.slots.length) voices.dispose(nowIfRunning())
      if (!tap) return
    }
    fill(view, input, pool)
    if (tap) tap(input, camera)
    if (!live) return
    const ac = audioContext()
    if (!ac || audioListener() === null) return
    moveListener(camera)
    try {
      voices.frame(ac, gameBus(ac), input, ac.currentTime)
    } catch (e) {
      failed.on = true
      voices.dispose(nowIfRunning())
      console.warn('DRONE RUN: drone voices stopped', e)
    }
  }, PRIORITY.fill)
  return null
}
