/**
 * facing.ts - which way an avatar points.
 *
 * After a hop or a sidestep the avatar turns to face the way it went, so a
 * shape with a front reads as going somewhere. A shard's front is its +Z,
 * which the scene draws as render -Z (shards.ts toRender), and it turns
 * about its own centre with its top kept up wherever the move allows.
 */

import { Matrix4, Quaternion, Vector3 } from 'three'
import type { AxisDirection, Position, ViewAxes } from './space'

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

const UP = new Vector3(0, 1, 0)
const OUT = new Vector3(0, 0, 1)

/**
 * The rotation that turns the nose, model +Z and so render -Z, along `dir`,
 * with the top kept up where the move is not vertical.
 */
export function facingQuaternion(dir: Vector3): Quaternion {
  const z = dir.clone().normalize().negate()
  const hint = Math.abs(z.y) > 0.99 ? OUT : UP
  const x = new Vector3().crossVectors(hint, z).normalize()
  const y = new Vector3().crossVectors(z, x).normalize()
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
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
