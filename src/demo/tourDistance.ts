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
