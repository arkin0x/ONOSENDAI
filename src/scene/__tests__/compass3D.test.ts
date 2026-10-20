/**
 * compass3D.test.ts: the compass draws a frame only when something it shows
 * has changed, and always when anything has, and places its labels where
 * they were placed when it drew every frame (arkinox, 2026-10-20: /tv and the
 * main view chug on his Windows laptop).
 */

import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { compassStep, nothingDrawn, type Drawn } from '../Compass3D'

const dirsA = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) }
const dirsB = { x: new Vector3(0, 0, 1), y: new Vector3(0, 1, 0), z: new Vector3(-1, 0, 0) }
const turned = (rad: number): Quaternion => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rad)

/** A frame drawn and its labels placed again: the compass at rest after a change. */
function settle(d: Drawn, pose: Quaternion, dirs = dirsA, w = 100, h = 100, bw = 200, bh = 200): void {
  expect(compassStep(d, pose, dirs, w, h, bw, bh)).toBe('draw')
  expect(compassStep(d, pose, dirs, w, h, bw, bh)).toBe('labels')
  expect(compassStep(d, pose, dirs, w, h, bw, bh)).toBeNull()
}

describe('compassStep', () => {
  it('draws the first frame, places the labels once more, then does nothing', () => {
    const d = nothingDrawn()
    const pose = turned(0.3)
    settle(d, pose)
    expect(compassStep(d, pose, dirsA, 100, 100, 200, 200)).toBeNull()
    expect(compassStep(d, pose.clone(), dirsA, 100, 100, 200, 200)).toBeNull()
  })

  it('draws the first frame even from the identity pose at size zero', () => {
    expect(compassStep(nothingDrawn(), new Quaternion(), dirsA, 0, 0, 0, 0)).toBe('draw')
  })

  it('draws when the pose moves, however little, in any component', () => {
    const d = nothingDrawn()
    const pose = turned(0.3)
    settle(d, pose)
    for (const k of ['x', 'y', 'z', 'w'] as const) {
      pose[k] += 1e-12
      settle(d, pose)
    }
  })

  it('sees a pose changed in place: the shared quaternion is mutated, never replaced', () => {
    const d = nothingDrawn()
    const pose = turned(0.3)
    settle(d, pose)
    pose.copy(turned(0.31))
    expect(compassStep(d, pose, dirsA, 100, 100, 200, 200)).toBe('draw')
  })

  it('draws every pass while the pose keeps moving, and places the labels once more when it stops', () => {
    const d = nothingDrawn()
    const pose = turned(0)
    for (let i = 1; i <= 5; i++) {
      pose.copy(turned(i * 0.1))
      expect(compassStep(d, pose, dirsA, 100, 100, 200, 200)).toBe('draw')
    }
    expect(compassStep(d, pose, dirsA, 100, 100, 200, 200)).toBe('labels')
    expect(compassStep(d, pose, dirsA, 100, 100, 200, 200)).toBeNull()
  })

  it('draws when the axes change', () => {
    const d = nothingDrawn()
    const pose = turned(0.3)
    settle(d, pose)
    settle(d, pose, dirsB)
  })

  it('draws when the size changes, in CSS pixels or in the drawing buffer', () => {
    const d = nothingDrawn()
    const pose = turned(0.3)
    settle(d, pose)
    const sizes: Array<[number, number, number, number]> = [[120, 100, 200, 200], [120, 90, 200, 200], [120, 90, 240, 200], [120, 90, 240, 180]]
    for (const [w, h, bw, bh] of sizes) settle(d, pose, dirsA, w, h, bw, bh)
  })
})
