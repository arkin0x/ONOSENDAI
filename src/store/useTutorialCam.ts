/**
 * useTutorialCam.ts: the first-arrival tutorial's two camera asks, held apart
 * from the scene so the tutorial can set them and the rig (scene/Scene.tsx)
 * can read them (tutorial feedback 2026-11-11, items 6 and 14).
 *
 * Both are off in production, since nothing sets them unless the tutorial
 * runs, so the rig's behaviour is unchanged for everyone else.
 *   - `spin`: a gentle idle orbit of the camera around the cursor on the Y
 *     axis, while the first move step is up, so a newcomer sees the box they
 *     are about to move into turn in space.
 *   - `zoom`: a close orbit distance to ease in to, in render cells, after the
 *     HOP onto the course, so the platform is not looked at from far away.
 *     Cleared by the rig once it has eased there.
 */

import { create } from 'zustand'

interface TutorialCamState {
  /** The idle Y-axis orbit spin is on. */
  spin: boolean
  /** An orbit distance (render cells) to ease in to, or null for none. */
  zoom: number | null
}

export const useTutorialCam = create<TutorialCamState>(() => ({ spin: false, zoom: null }))

/** Turn the idle orbit spin on or off (the first-move step, while it is up). */
export function setTutorialSpin(on: boolean): void {
  if (useTutorialCam.getState().spin !== on) useTutorialCam.setState({ spin: on })
}

/** Ask the rig to ease the orbit in to `distance` render cells; null leaves it. */
export function setTutorialZoom(distance: number | null): void {
  useTutorialCam.setState({ zoom: distance })
}

/** The rig calls this once it has eased to the asked distance. */
export function clearTutorialZoom(): void {
  if (useTutorialCam.getState().zoom !== null) useTutorialCam.setState({ zoom: null })
}
