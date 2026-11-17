/**
 * view.ts - what the pieces of DRONE RUN's canvas share for one run on
 * screen: the runner, the models, the effect pools, and a few numbers the
 * viewmodel keeps for the world's effects (where the muzzle is). Made once
 * per canvas (Canvas3D), handed down as a prop; no React state changes per
 * frame.
 */

import { Vector3 } from 'three'
import type { DroneRunner } from './runner'
import type { DroneRunModels } from './models'
import { GlowPool, RibbonPool } from './fx'

/** useFrame priorities: the runner steps, then the camera, then the pools open, then everything fills them, then one render. */
export const PRIORITY = { runner: -4, camera: -3, open: -2, fill: -1, render: 1 } as const

export interface DroneRunView {
  runner: DroneRunner
  models: DroneRunModels
  /** Glow and streaks in the world's scene. */
  glow: GlowPool
  ribbons: RibbonPool
  /** Far drones' specks, drawn through the fog (Drones.tsx). */
  beacons: GlowPool
  /** Glow in the viewmodel's own pass (muzzle flash, heat, charge), camera space. */
  vmGlow: GlowPool
  /** The muzzle of the gun in hand, camera space (gibsons), as last drawn. */
  muzzleCam: Vector3
  /** The camera's head bob phase and size this frame, for the gun's sway. */
  bob: { phase: number; amount: number }
  reducedMotion: boolean
  /** The effects' clock, seconds: the screen's, times the runner's timeScale (slow motion for recordings). */
  time: number
  /** The Settings switch GLOW, as this frame reads it. */
  glowOn: boolean
}

export function makeView(runner: DroneRunner, models: DroneRunModels, reducedMotion: boolean): DroneRunView {
  return {
    runner, models, reducedMotion, glowOn: true, time: 0,
    glow: new GlowPool(2048, true),
    ribbons: new RibbonPool(512),
    beacons: new GlowPool(128, false),
    vmGlow: new GlowPool(256, false),
    muzzleCam: new Vector3(0.3, -0.2, -1.6),
    bob: { phase: 0, amount: 0 },
  }
}

export function disposeView(v: DroneRunView): void {
  v.glow.dispose()
  v.ribbons.dispose()
  v.beacons.dispose()
  v.vmGlow.dispose()
}
