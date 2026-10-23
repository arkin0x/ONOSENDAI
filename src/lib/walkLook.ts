/**
 * WALK's look: how far a drag turns your head, and the short coast after it.
 *
 * In WALK the camera sits in the avatar (scene/Scene.tsx Rig), so a drag is
 * turning your head, not orbiting. It used to go through OrbitControls, which
 * scales a drag by the canvas HEIGHT and was updated twice a frame (by drei
 * and by the rig) while the rig put the line of sight back after one of them:
 * most of every drag was thrown away. Measured 2026-10-23, a drag across the
 * whole screen turned about 199 degrees on a 1280x720 desktop and only 59 on
 * a 412x915 phone (arkinox: "it takes wayyyy to much dragging to look around
 * while in WALK mode. We need to turn up the sensitivity about 10x").
 *
 * Now the rig owns WALK's look outright. Every drag, from the scene or from
 * anything else that turns the view (walkLookBy), lands here in CSS pixels,
 * and the rig spends it frame by frame. The gain is set per screen WIDTH, so
 * a swipe across the screen turns the same on a phone and on a desktop, and
 * one pixel turns the same up and down as across.
 */

/** A drag across the whole screen turns your head this far. The one number to tune. */
export const WALK_LOOK_DEG_PER_WIDTH = 360

/**
 * The look's coast, in seconds: what is left of a drag halves about every
 * 45 ms, near the coast OrbitControls' damping gave WALK before. Exponential,
 * so it never passes where the drag was going and does not change with frame
 * rate; every pixel dragged is spent in the end.
 */
export const WALK_LOOK_TAU_S = 0.065

/** Radians of turn per CSS pixel of drag on a screen `widthPx` wide. */
export function lookRadPerPx(widthPx: number): number {
  return (WALK_LOOK_DEG_PER_WIDTH * Math.PI) / 180 / Math.max(1, widthPx)
}

/** Below this much drag left, in pixels, the coast ends and the rest is spent at once. */
const SPENT_PX = 0.01

let pendingX = 0
let pendingY = 0

/** Turn WALK's view by a drag of dx, dy CSS pixels, in the senses a drag on the scene has always turned it. */
export function walkLookBy(dx: number, dy: number): void {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
  pendingX += dx
  pendingY += dy
}

/**
 * The part of the drag still to come that this frame turns, `dt` seconds
 * after the last: a share that only grows with dt and never passes one.
 */
export function takeWalkLook(dt: number): [number, number] {
  if (pendingX === 0 && pendingY === 0) return [0, 0]
  const k = dt > 0 ? 1 - Math.exp(-dt / WALK_LOOK_TAU_S) : 0
  let x = pendingX * k
  let y = pendingY * k
  if (k > 0 && Math.abs(pendingX) < SPENT_PX && Math.abs(pendingY) < SPENT_PX) { x = pendingX; y = pendingY }
  pendingX -= x
  pendingY -= y
  return [x, y]
}

/** Forget a drag not yet spent: leaving WALK must not turn the view outside it. */
export function clearWalkLook(): void {
  pendingX = 0
  pendingY = 0
}
