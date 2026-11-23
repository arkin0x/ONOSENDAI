/**
 * useTutorialCam.ts: the first-arrival tutorial's camera asks, held apart
 * from the scene so the tutorial can set them and the rig (scene/Scene.tsx)
 * can read them (tutorial feedback 2026-11-11, items 6 and 14; owner,
 * 2026-11-12, the first hop).
 *
 * Nothing sets them unless the tutorial runs, so the rig's behaviour is unchanged for everyone else.
 *   - `spin`: a gentle idle orbit of the camera around the cursor on the Y
 *     axis, while the first move step is up, so a newcomer sees the box they
 *     are about to move into turn in space.
 *   - `zoom`: a close orbit distance to ease in to, in render cells, after the
 *     HOP onto the course, so the platform is not looked at from far away.
 *     With `from`, the camera also eases round to that side of the avatar:
 *     after the first hop, over its shoulder toward the chest. Cleared by the
 *     rig once it has eased there.
 *   - `frame`: a hop to frame on COMMIT, start and end both in view, seen
 *     from the side, so a newcomer sees themselves move (owner, 2026-11-12:
 *     "the user can tell oh I just moved and this red ball is me"). The rig
 *     eases there over HOP_FRAME_MS; the director clears it once the avatar
 *     has arrived.
 *   - `shot`: things to frame together, a chest, its floating loot and the
 *     avatar beside it (owner, 2026-11-23: "this is a good angle that the
 *     camera should automatically take when we arrive at the chest"). The
 *     orbit's centre moves to the middle of them for as long as the shot is
 *     asked, and the camera eases round to below and to the right of the
 *     chest, at the distance that fits them in what the tour card and the
 *     pad leave uncovered (the BUILD framing's lens shift, lib/coverBand.ts).
 *     A press on the scene ends the ease but not the centre: the player then
 *     orbits about the chest, and nothing pulls the camera back.
 * A finger or the mouse on the scene, or WALK, ends any of them: the player
 * has taken the camera.
 */

import { create } from 'zustand'
import type { Position } from '../lib/space'

/** A direction in cyberspace axes (x, y, z), any length. */
export interface CamDir { x: number; y: number; z: number }

/** Things to frame together (the `shot`): their gibsons, the chest first, and the room left round them. */
export interface TutorialShot {
  /** The same key is the same shot: a step that asks for it again keeps it as it is, eased or not (the director keys it by the chest and where the avatar stands). */
  key: string
  /** The chest's gibson. */
  chest: Position
  /** Every gibson to keep in view: the chest, the top of its floating loot, the avatar. */
  points: Position[]
  /** Room past the farthest point, in gibsons (the loot row's half width). */
  margin: number
  /** The camera still eases to the shot; false once it is there or the player took the camera. */
  ease: boolean
}

/** A hop to keep in view: where it starts and where it lands. */
export interface HopFrame { from: Position; to: Position }

/**
 * How long the camera takes to frame a hop, in ms: the avatar is held where
 * it was this long after COMMIT (lib/hopStage.ts holdGlide), so the glide
 * starts with the camera already in place.
 */
export const HOP_FRAME_MS = 500

interface TutorialCamState {
  /** The idle Y-axis orbit spin is on. */
  spin: boolean
  /** An orbit distance (render cells) to ease in to, or null for none. */
  zoom: number | null
  /** With the zoom, the side to ease round to: from the avatar out toward the camera, in cyberspace axes. Null keeps the camera's own side. */
  from: CamDir | null
  /** A hop to frame, or null. */
  frame: HopFrame | null
  /** Things to frame together, or null. */
  shot: TutorialShot | null
}

export const useTutorialCam = create<TutorialCamState>(() => ({ spin: false, zoom: null, from: null, frame: null, shot: null }))

/** Ask for a shot, or none (null). The same key already asked keeps the shot as it is. */
export function setTutorialShot(shot: TutorialShot | null): void {
  const cur = useTutorialCam.getState().shot
  if (shot !== null && cur !== null && cur.key === shot.key) return
  if (cur !== shot) useTutorialCam.setState({ shot })
}

/** The rig calls this once the camera is at the shot, or the player took the camera: the centre stays, the ease ends. */
export function endShotEase(): void {
  const cur = useTutorialCam.getState().shot
  if (cur && cur.ease) useTutorialCam.setState({ shot: { ...cur, ease: false } })
}

/** Turn the idle orbit spin on or off (the first-move step, while it is up). */
export function setTutorialSpin(on: boolean): void {
  if (useTutorialCam.getState().spin !== on) useTutorialCam.setState({ spin: on })
}

/** Ask the rig to ease the orbit in to `distance` render cells, round to the side `from` when given; null leaves it. */
export function setTutorialZoom(distance: number | null, from: CamDir | null = null): void {
  useTutorialCam.setState({ zoom: distance, from: distance === null ? null : from })
}

/** The rig calls this once it has eased to the asked distance (and side). */
export function clearTutorialZoom(): void {
  if (useTutorialCam.getState().zoom !== null || useTutorialCam.getState().from !== null) useTutorialCam.setState({ zoom: null, from: null })
}

/** Ask the rig to frame a hop, or stop framing one (null). */
export function setTutorialFrame(frame: HopFrame | null): void {
  if (useTutorialCam.getState().frame !== frame) useTutorialCam.setState({ frame })
}
