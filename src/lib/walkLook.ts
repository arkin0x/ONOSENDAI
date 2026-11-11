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

/**
 * LOOK, the ball in WALK's corner (hud/WalkLookSphere.tsx): a drag across
 * the ball turns your head this far, on every screen (arkinox, 2026-11-02:
 * "more sensitive than normal dragging on the screen, or it is only an
 * affordance"). Set per ball width, not per screen width as the scene's
 * drag is, because the ball is the same size on every screen: a gain per
 * screen pixel turned a drag across it 336 degrees on a 360px phone and 111
 * on a phone on its side (review of #588). 300 is about what a 412px phone
 * had. The drag can carry on past the ball for more.
 */
export const WALK_LOOK_SPHERE_DEG_PER_BALL = 300

/** Radians of turn per CSS pixel of drag on a LOOK ball `ballPx` wide. */
export function sphereRadPerPx(ballPx: number): number {
  return (WALK_LOOK_SPHERE_DEG_PER_BALL * Math.PI) / 180 / Math.max(1, ballPx)
}

/** Below this much left to turn, the coast ends and the rest is spent at once: pixels for the scene's drag, radians for LOOK's. */
const SPENT_PX = 0.01
const SPENT_RAD = 1e-5

/** A drag still to be spent, coasting out (WALK_LOOK_TAU_S). */
interface Pending { x: number; y: number; spent: number }
/** The scene's drags, in CSS pixels the rig turns at the screen's width. */
const scenePending: Pending = { x: 0, y: 0, spent: SPENT_PX }
/** LOOK's drags, already in radians. */
const spherePending: Pending = { x: 0, y: 0, spent: SPENT_RAD }

function add(p: Pending, dx: number, dy: number): void {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
  p.x += dx
  p.y += dy
}

/**
 * The part of a drag still to come that this frame turns, `dt` seconds
 * after the last: a share that only grows with dt and never passes one.
 */
function take(p: Pending, dt: number): [number, number] {
  if (p.x === 0 && p.y === 0) return [0, 0]
  const k = dt > 0 ? 1 - Math.exp(-dt / WALK_LOOK_TAU_S) : 0
  let x = p.x * k
  let y = p.y * k
  if (k > 0 && Math.abs(p.x) < p.spent && Math.abs(p.y) < p.spent) { x = p.x; y = p.y }
  p.x -= x
  p.y -= y
  return [x, y]
}

/** Turn WALK's view by a drag of dx, dy CSS pixels, in the senses a drag on the scene has always turned it. */
export function walkLookBy(dx: number, dy: number): void {
  add(scenePending, dx, dy)
}

/** This frame's share of the scene's drags, in CSS pixels (lookRadPerPx turns them). */
export function takeWalkLook(dt: number): [number, number] {
  return take(scenePending, dt)
}

/**
 * Turn WALK's view by a drag of dx, dy CSS pixels on a LOOK ball `ballPx`
 * wide, in the scene's senses: across the whole ball is
 * WALK_LOOK_SPHERE_DEG_PER_BALL, whatever the screen.
 */
export function walkLookSphereBy(dx: number, dy: number, ballPx: number): void {
  const k = sphereRadPerPx(ballPx)
  add(spherePending, dx * k, dy * k)
}

/** This frame's share of LOOK's drags, in radians. */
export function takeWalkLookRad(dt: number): [number, number] {
  return take(spherePending, dt)
}

/** Forget a drag not yet spent: leaving WALK must not turn the view outside it. */
export function clearWalkLook(): void {
  scenePending.x = 0
  scenePending.y = 0
  spherePending.x = 0
  spherePending.y = 0
}
