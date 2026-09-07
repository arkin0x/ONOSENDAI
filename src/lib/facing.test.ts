import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { facingQuaternion, moveDirection } from './facing'
import type { ViewAxes } from './space'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const at = (x: bigint, y: bigint, z: bigint) => ({ x, y, z })
const turned = (dir: Vector3, v: Vector3): number[] => v.clone().applyQuaternion(facingQuaternion(dir)).toArray().map((n) => +n.toFixed(3))

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

describe('facingQuaternion', () => {
  const NOSE = new Vector3(0, 0, -1) // model +Z, as the scene draws it
  it('leaves a move along the nose as it is, and turns about for the opposite with the top still up', () => {
    expect(turned(new Vector3(0, 0, -1), NOSE)).toEqual([0, 0, -1])
    expect(turned(new Vector3(0, 0, 1), NOSE)).toEqual([0, 0, 1])
    expect(turned(new Vector3(0, 0, 1), new Vector3(0, 1, 0))).toEqual([0, 1, 0])
  })
  it('points the nose along any direction, top up when it can be', () => {
    for (const dir of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(1, 0, 1).normalize(), new Vector3(0, 1, 0)]) {
      const nose = turned(dir, NOSE)
      expect(nose.map((n, i) => Math.abs(n - +dir.toArray()[i].toFixed(3)) < 0.002).every(Boolean)).toBe(true)
    }
    // Sideways along +X: the top stays up.
    expect(turned(new Vector3(1, 0, 0), new Vector3(0, 1, 0))).toEqual([0, 1, 0])
  })
})
