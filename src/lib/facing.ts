/**
 * facing.ts - which way an avatar points.
 *
 * After a hop or a sidestep the avatar turns to face the way it went, so a
 * shape with a front reads as going somewhere. A shard's front is its +Z,
 * which the scene draws as render -Z (shards.ts toRender), and it turns
 * about its own center with its top kept to cyberspace up wherever the move
 * allows. Worked out in cyberspace axes and then turned to the view, so the
 * avatar turns with the world when the compass turns it.
 */

import { Quaternion, Vector3 } from 'three'
import type { AxisDirection, Position, ViewAxes } from './space'
import { composePose, renderPose, viewPose, type Pose, type V3 } from './pose'

/**
 * The render-space direction of a move, under the view's axes (the same
 * mapping the scene draws positions with); null when nothing moved.
 */
export function moveDirection(from: Position, to: Position, axes: ViewAxes): Vector3 | null {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  const abs = (n: bigint): bigint => (n < 0n ? -n : n)
  const widest = [abs(d.x), abs(d.y), abs(d.z)].reduce((a, b) => (a > b ? a : b), 0n)
  if (widest === 0n) return null
  // Proportions survive the narrowing: each axis as a thousandth of the widest.
  const part = (a: AxisDirection): number => Number((d[a.axis] * 1000n) / widest) / 1000 * a.dir
  return new Vector3(part(axes.right), part(axes.up), part(axes.out)).normalize()
}

/**
 * The two positions whose direction the avatar faces, at a point on the chain.
 *
 * Time decides the angle: the avatar faces the way the move that brought it
 * to this link went. At the head that is the last two links, as before.
 * While scrubbing the chain to link `index`, it is the link before and this
 * one, so the avatar turns as the history is walked rather than keeping the
 * heading it has now. At the spawn there is no move in yet, so it faces the
 * first move out. A chain of one link faces nothing.
 */
export function facingPair<T>(chain: T[], index: number | null): [T, T] | null {
  const n = chain.length
  if (n < 2) return null
  const i = index === null ? n - 1 : Math.max(0, Math.min(n - 1, index))
  if (i === 0) return [chain[0], chain[1]]
  return [chain[i - 1], chain[i]]
}

/** Cyberspace's own axes as a view frame, so moveDirection answers in cyberspace terms. */
const CYBERSPACE: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const IDENTITY: Pose = [1, 0, 0, 0, 1, 0, 0, 0, 1]

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v: V3): V3 => { const n = Math.hypot(...v); return [v[0] / n, v[1] / n, v[2] / n] }

/**
 * Which way an avatar faces after a move, as a pose in cyberspace axes: the
 * nose, model +Z, along the move, and the top, model +Y, toward cyberspace
 * +Y wherever the move allows. A move straight up or down has no up of its
 * own to keep, so the top goes to cyberspace -Z, the side facing away from
 * the black sun. Null when nothing moved.
 *
 * In world terms, like a shard's pose, so the view frame is composed onto it
 * after (avatarTurn). It used to be built in render space with the screen's
 * up as the hint, which made an avatar stay screen-up when the compass turned
 * the world upside down (arkinox, 2026-10-08).
 */
export function facingPose(from: Position, to: Position): Pose | null {
  const d = moveDirection(from, to, CYBERSPACE)
  if (!d) return null
  const f: V3 = [d.x, d.y, d.z]
  const hint: V3 = Math.abs(f[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0]
  const r = unit(cross(hint, f))
  const u = cross(f, r)
  return [r[0], r[1], r[2], u[0], u[1], u[2], f[0], f[1], f[2]]
}

/**
 * The turn an avatar's group carries in the view frame `axes`: its facing
 * after `move` (or none, lying on cyberspace axes as built), with the view
 * frame composed on, as a render-space rotation.
 *
 * This is exactly what a shard gets (pose.ts placedPose), only applied to the
 * group instead of the vertices, so the facing can ease between moves without
 * rebuilding geometry. A compass turn therefore turns every avatar with the
 * world: the one you are, the one you spectate, and everyone in presence.
 */
export function avatarTurn(axes: ViewAxes, move: readonly [Position, Position] | null): Quaternion {
  const facing = move ? facingPose(move[0], move[1]) : null
  return new Quaternion().setFromRotationMatrix(renderPose(composePose(viewPose(axes), facing ?? IDENTITY)))
}
