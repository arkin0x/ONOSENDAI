import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { avatarTurn, facingPose, moveDirection } from '../facing'
import { canonicalQuaternion, renderDirection, rotateView, viewAxes, type Position, type ViewAxes } from '../space'
import { applyPose } from '../pose'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const at = (x: bigint, y: bigint, z: bigint) => ({ x, y, z })
/** The default view, facing the black sun: render is cyberspace with Z flipped. */
const CANON = viewAxes(canonicalQuaternion())
const O: Position = at(100n, 100n, 100n)
/** A model direction (render terms) turned by the avatar's group after a move of `d` in cyberspace, in view `axes`. */
const turned = (d: [bigint, bigint, bigint], v: Vector3, axes: ViewAxes = CANON): number[] =>
  v.clone().applyQuaternion(avatarTurn(axes, [O, at(O.x + d[0], O.y + d[1], O.z + d[2])])).toArray().map((n) => +n.toFixed(3) + 0)

describe('moveDirection', () => {
  it('reads a hop as a unit vector in the scene\'s frame, and nothing as null', () => {
    expect(moveDirection(at(5n, 5n, 5n), at(9n, 5n, 5n), AXES)!.toArray()).toEqual([1, 0, 0])
    expect(moveDirection(at(5n, 5n, 5n), at(5n, 5n, 1n), AXES)!.toArray()).toEqual([0, 0, -1])
    expect(moveDirection(at(5n, 5n, 5n), at(5n, 5n, 5n), AXES)).toBeNull()
  })
  it('keeps the proportions of a diagonal move across astronomical distances', () => {
    const d = moveDirection(at(0n, 0n, 0n), at(1n << 80n, 1n << 79n, 0n), AXES)!
    expect(+d.x.toFixed(3)).toBe(0.894)
    expect(+d.y.toFixed(3)).toBe(0.447)
  })
  it('follows the view\'s axes: with x pointing left on screen the move flips', () => {
    const flipped: ViewAxes = { ...AXES, right: { axis: 'x', dir: -1 } }
    expect(moveDirection(at(0n, 0n, 0n), at(3n, 0n, 0n), flipped)!.toArray()).toEqual([-1, 0, 0])
  })
})

describe('avatarTurn', () => {
  const NOSE = new Vector3(0, 0, -1) // model +Z, as the scene draws it
  const TOP = new Vector3(0, 1, 0)
  it('in the default view leaves a move toward the black sun as it is, and turns about for the opposite with the top still up', () => {
    expect(turned([0n, 0n, 1n], NOSE)).toEqual([0, 0, -1])
    expect(turned([0n, 0n, -1n], NOSE)).toEqual([0, 0, 1])
    expect(turned([0n, 0n, -1n], TOP)).toEqual([0, 1, 0])
  })
  it('points the nose along any move, top up when it can be', () => {
    for (const d of [[1n, 0n, 0n], [-1n, 0n, 0n], [1n, 0n, -1n], [0n, 1n, 0n]] as Array<[bigint, bigint, bigint]>) {
      const dir = new Vector3(Number(d[0]), Number(d[1]), -Number(d[2])).normalize()
      const nose = turned(d, NOSE)
      expect(nose.map((n, i) => Math.abs(n - +dir.toArray()[i].toFixed(3)) < 0.002).every(Boolean)).toBe(true)
    }
    // Sideways along +X: the top stays up.
    expect(turned([1n, 0n, 0n], TOP)).toEqual([0, 1, 0])
  })
  it('keeps the top to the world\'s up, not the screen\'s: with the world upside down the avatar is too', () => {
    const upsideDown = viewAxes(rotateView(rotateView(canonicalQuaternion(), 'up'), 'up'))
    expect(renderDirection(upsideDown, 'y')).toEqual([0, -1, 0])
    for (const d of [[1n, 0n, 0n], [0n, 0n, 1n], [-1n, 0n, 1n]] as Array<[bigint, bigint, bigint]>) {
      expect(turned(d, TOP, upsideDown)).toEqual([0, -1, 0])
    }
    // And with no move at all, it still turns with the view.
    expect(new Vector3(0, 1, 0).applyQuaternion(avatarTurn(upsideDown, null)).toArray().map((n) => +n.toFixed(3) + 0)).toEqual([0, -1, 0])
  })
})

describe('facingPose', () => {
  it('is a right-handed frame in cyberspace axes: nose along the move, top to +Y, or to -Z for a vertical move', () => {
    const p = facingPose(O, at(O.x + 2n, O.y, O.z))!
    expect(applyPose(p, [0, 0, 1]).map((n) => +n.toFixed(6) + 0)).toEqual([1, 0, 0])
    expect(applyPose(p, [0, 1, 0]).map((n) => +n.toFixed(6) + 0)).toEqual([0, 1, 0])
    const up = facingPose(O, at(O.x, O.y + 5n, O.z))!
    expect(applyPose(up, [0, 0, 1]).map((n) => +n.toFixed(6) + 0)).toEqual([0, 1, 0])
    expect(applyPose(up, [0, 1, 0]).map((n) => +n.toFixed(6) + 0)).toEqual([0, 0, -1])
    expect(facingPose(O, O)).toBeNull()
  })
})
