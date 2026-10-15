/**
 * The name and picture under another avatar hang under the lowest point of
 * the avatar as drawn, centered on it (arkinox, 2026-10-11).
 */
import { describe, expect, it } from 'vitest'
import { Box3, Euler, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { UNDER_GAP_PX, boxCorners, labelAnchor, labelDrop, type Project } from '../avatarLabel'

/** A plain projection: x and y as they are, scaled; nothing is ever behind. */
const flat: Project = (p) => [p[0] / 10, p[1] / 10]

describe('labelAnchor', () => {
  it('centers on the box across the screen and drops to its lowest point', () => {
    const a = labelAnchor({ min: [-1, -3, -1], max: [1, 1, 1] }, flat)!
    expect(a.x).toBeCloseTo(0)
    expect(a.y).toBeCloseTo(-0.1)
    expect(a.bottom).toBeCloseTo(-0.3)
  })

  it('follows a box built off its center, so a label is not stuck to the cell', () => {
    const a = labelAnchor({ min: [2, 0.5, 0], max: [4, 2.5, 1] }, flat)!
    expect(a.x).toBeCloseTo(0.3)
    expect(a.bottom).toBeCloseTo(0.05)
  })

  it('uses the bounds after rotation: a turned shard reaches lower than its upright box', () => {
    // A long thin bar, then the same bar turned 45 degrees about z: its
    // world box grows, and the label drops with it.
    const upright = new Box3(new Vector3(-2, -0.25, -0.25), new Vector3(2, 0.25, 0.25))
    const turned = upright.clone().applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(0, 0, Math.PI / 4)))
    const a = labelAnchor({ min: upright.min.toArray(), max: upright.max.toArray() }, flat)!
    const b = labelAnchor({ min: turned.min.toArray(), max: turned.max.toArray() }, flat)!
    expect(b.bottom).toBeLessThan(a.bottom)
    expect(b.x).toBeCloseTo(0)
  })

  it('works through a real perspective camera, the lowest corner nearest the camera', () => {
    const cam = new PerspectiveCamera(50, 1, 0.1, 1000)
    cam.position.set(0, 4, 10)
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    const v = new Vector3()
    const project: Project = (p) => {
      v.set(...p).applyMatrix4(cam.matrixWorldInverse)
      if (v.z >= 0) return null
      v.applyMatrix4(cam.projectionMatrix)
      return [v.x, v.y]
    }
    const a = labelAnchor({ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] }, project)!
    expect(a.x).toBeCloseTo(0)
    // The lowest point on screen is a bottom corner, so it is under every projected corner.
    for (const c of boxCorners({ min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] })) {
      expect(a.bottom).toBeLessThanOrEqual(project(c)![1] + 1e-9)
    }
    expect(a.bottom).toBeLessThan(a.y)
  })

  it('gives nothing for an empty box or one reaching behind the camera', () => {
    expect(labelAnchor({ min: [1, 1, 1], max: [-1, -1, -1] }, flat)).toBeNull()
    expect(labelAnchor({ min: [-1, -1, -1], max: [1, 1, 1] }, (p) => (p[2] > 0 ? null : [0, 0]))).toBeNull()
  })

  it('lists all eight corners', () => {
    const c = boxCorners({ min: [0, 0, 0], max: [1, 2, 3] })
    expect(new Set(c.map((p) => p.join())).size).toBe(8)
  })
})

describe('labelDrop', () => {
  it('puts the label top just under the lowest point, in pixels', () => {
    // Half the screen height between middle and bottom, in NDC 0.2, on 800px: 80px.
    expect(labelDrop({ y: 0.1, bottom: -0.1 }, 800)).toBeCloseTo(80 + UNDER_GAP_PX)
  })
  it('keeps a speck-sized avatar\'s label clear of its ring', () => {
    expect(labelDrop({ y: 0, bottom: -0.001 }, 800, 7.5)).toBeCloseTo(7.5 + UNDER_GAP_PX)
  })
})
