/**
 * tourDistance.ts: a tour step's camera distance (DemoScene.distance), and
 * putting the distance from before back when the tour moves on
 * (arkinox, 2026-10-27: "step 2 shows all of cyberspace but it is zoomed out
 * too far").
 *
 * The rig (scene/Scene.tsx) asks this on every change of step and moves the
 * camera to `set` when it is not null. `saved` is the distance the camera had
 * before the first step with a distance of its own, kept across a run of such
 * steps and given back on the first step without one, or when the tour ends,
 * so the steps after keep the framing they always had.
 */

/** What to do with the camera on a change of step. */
export interface TourDistance {
  /** The distance to move the camera to now, in render cells; null leaves it. */
  set: number | null
  /** The distance to give back later, or null when there is none owed. */
  saved: number | null
}

/**
 * `want` is the new step's distance (undefined when it has none, or the tour
 * ended), `current` the camera's distance now, `saved` what the last call
 * returned as saved.
 */
export function tourDistance(want: number | undefined, current: number, saved: number | null): TourDistance {
  if (want !== undefined) return { set: want, saved: saved ?? current }
  if (saved !== null) return { set: saved, saved: null }
  return { set: null, saved: null }
}

/** A step's camera as the rig takes it (useDemo TourCamera). */
export interface TourPose {
  distance: number
  /** From the place out to the camera, cyberspace x, y, z, unit length; null keeps the line the camera looks down. */
  dir: [number, number, number] | null
  /** The step's own place: where its view looks (block 1's landfall), or null for your own head, no view. */
  at: { x: bigint; y: bigint; z: bigint } | null
}

/** Whether the view on screen is a step's own place: the same point, or no view when the step is at your head. */
export function atOwnPlace(at: TourPose['at'], focus: { x: bigint; y: bigint; z: bigint } | null): boolean {
  if (at === null) return focus === null
  return focus !== null && focus.x === at.x && focus.y === at.y && focus.z === at.z
}

/**
 * The rig's bookkeeping for the tour's cameras (scene/Scene.tsx), kept here
 * so it can be tested without a canvas (review of #523).
 *
 * - `step` on every change of step: the step's camera, or the distance owed
 *   back, becomes the move to make.
 * - `reframed` when the rig re-framed on its own: the step's camera comes
 *   back only when the view has just arrived at the step's own place (block 1
 *   landing late, coming home to your head). A stop tapped somewhere else,
 *   or a reframe while the view was already there, keeps the visitor's own
 *   pinch and angle.
 * - `take` each frame: the move, when the camera can make it now. In WALK,
 *   or while the eye glides out of it, the move waits rather than being
 *   dropped, so a distance owed back is never lost.
 */
export class TourCameraState {
  pose: TourPose | null = null
  saved: number | null = null
  pending: Pick<TourPose, 'distance' | 'dir'> | null = null

  step(pose: TourPose | null, current: number): void {
    if (pose === this.pose) return
    this.pose = pose
    const r = tourDistance(pose?.distance, current, this.saved)
    this.saved = r.saved
    this.pending = r.set === null ? null : { distance: r.set, dir: pose?.dir ?? null }
  }

  reframed(arrived: boolean, focus: { x: bigint; y: bigint; z: bigint } | null): void {
    const p = this.pose
    if (p && arrived && atOwnPlace(p.at, focus)) this.pending = { distance: p.distance, dir: p.dir }
  }

  take(canApply: boolean): Pick<TourPose, 'distance' | 'dir'> | null {
    if (!canApply || this.pending === null) return null
    const move = this.pending
    this.pending = null
    return move
  }
}
