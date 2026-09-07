/**
 * facing.ts - which way an avatar points.
 *
 * After a hop or a sidestep the avatar turns to face the way it went, so a
 * shape with a front reads as going somewhere. A shard's front is +X, the
 * way a stamp faces on the bench at FACING 0, and it turns about its own
 * centre with its top kept up wherever the move allows.
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

/** The rotation that turns the nose, +X, along `dir`, with the top kept up where the move is not vertical. */
export function facingQuaternion(dir: Vector3): Quaternion {
  const x = dir.clone().normalize()
  const hint = Math.abs(x.y) > 0.99 ? OUT : UP
  const z = new Vector3().crossVectors(x, hint).normalize()
  const y = new Vector3().crossVectors(z, x).normalize()
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
}
