/**
 * coverBand.test.ts: BUILD frames the orbit's focus in the middle of what the
 * HUD leaves uncovered (arkinox, 2026-10-25: on a phone the build cursor sat
 * on the deploy bar's top edge and the shard being placed was hidden under
 * it). The band from the covers, and the lens shift that puts the focus in
 * its middle without moving the camera.
 */

import { describe, expect, it } from 'vitest'
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, SphereGeometry, Vector2, Vector3 } from 'three'
import { MIN_BAND, applyLensShift, lensShift, uncoveredBand, viewAxisNdc, type Box, type Cover } from '../coverBand'
import { CAMERA_NEAR, FOV } from '../../scene/camera'

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })

describe('uncoveredBand', () => {
  it('is the whole screen when nothing covers it', () => {
    expect(uncoveredBand(412, 915, [])).toEqual(box(0, 0, 412, 915))
  })

  it('ends above the deploy bar on a phone (412 x 915, as measured in DEPLOY)', () => {
    const covers: Cover[] = [
      { edge: 'bottom', box: box(12, 517, 266, 837) },
      { edge: 'bottom', box: box(276, 659, 398, 823) },
    ]
    expect(uncoveredBand(412, 915, covers)).toEqual(box(0, 0, 412, 517))
  })

  it('runs from under the BUILD bar to above the pad (360 x 800, BUILD)', () => {
    const covers: Cover[] = [
      { edge: 'top', box: box(8, 12, 256, 189) },
      { edge: 'bottom', box: box(224, 544, 346, 708) },
    ]
    expect(uncoveredBand(360, 800, covers)).toEqual(box(0, 189, 360, 544))
  })

  it('leaves out a cover that does not reach the middle column', () => {
    // A pad in the corner of a wide desktop does not stand over the focus.
    const covers: Cover[] = [{ edge: 'bottom', box: box(1770, 640, 1892, 900) }]
    expect(uncoveredBand(1920, 1080, covers)).toEqual(box(0, 0, 1920, 1080))
  })

  it('narrows to the space between the menu columns on a desktop', () => {
    const covers: Cover[] = [
      { edge: 'left', box: box(16, 16, 336, 884) },
      { edge: 'right', box: box(1124, 16, 1424, 700) },
    ]
    expect(uncoveredBand(1440, 900, covers)).toEqual(box(336, 0, 1124, 900))
  })

  it('takes its middle column from what the side columns leave', () => {
    // 336..1124 leaves a column of 572..888: a bar at 300..560 is beside it.
    const covers: Cover[] = [
      { edge: 'left', box: box(16, 16, 336, 884) },
      { edge: 'right', box: box(1124, 16, 1424, 884) },
      { edge: 'bottom', box: box(300, 500, 560, 880) },
    ]
    expect(uncoveredBand(1440, 900, covers).bottom).toBe(900)
  })

  it('gives up, centred, when too little is left to frame in', () => {
    const covers: Cover[] = [{ edge: 'bottom', box: box(0, 915 * MIN_BAND - 1, 412, 915) }]
    expect(uncoveredBand(412, 915, covers)).toEqual(box(0, 0, 412, 915))
  })
})

describe('lensShift', () => {
  it('is zero for the whole screen', () => {
    expect(lensShift(412, 915, box(0, 0, 412, 915))).toEqual({ x: 0, y: 0 })
  })

  it('moves the picture up by the distance from the middle to the band middle', () => {
    expect(lensShift(412, 915, box(0, 0, 412, 517))).toEqual({ x: 0, y: 915 / 2 - 517 / 2 })
    expect(lensShift(1440, 900, box(336, 0, 1124, 900))).toEqual({ x: 720 - 730, y: 0 })
  })
})

/** A camera orbiting `focus` from `from`, looking at it, as the Rig leaves it. */
function orbitCamera(width: number, height: number, focus: Vector3, from: Vector3): PerspectiveCamera {
  const cam = new PerspectiveCamera(FOV, width / height, CAMERA_NEAR, 6000)
  cam.position.copy(focus).add(from)
  cam.lookAt(focus)
  cam.updateMatrixWorld()
  return cam
}

/** A point's pixel on a `width` x `height` canvas. */
function pixelOf(p: Vector3, cam: PerspectiveCamera, width: number, height: number): [number, number] {
  const v = p.clone().project(cam)
  return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height]
}

describe('applyLensShift', () => {
  const W = 412, H = 915
  const band = box(0, 0, 412, 517)
  const centre: [number, number] = [(band.left + band.right) / 2, (band.top + band.bottom) / 2]
  const focus = new Vector3(3, -2, 5)
  const orbits = [new Vector3(0, 0, 26), new Vector3(14, 9, -18), new Vector3(-5, 24, 3), new Vector3(0, -6, 2.5)]

  it('puts the focus at the band middle from every orbit angle and distance', () => {
    for (const from of orbits) {
      const cam = orbitCamera(W, H, focus, from)
      applyLensShift(cam, W, H, lensShift(W, H, band))
      const [x, y] = pixelOf(focus, cam, W, H)
      expect(x).toBeCloseTo(centre[0], 6)
      expect(y).toBeCloseTo(centre[1], 6)
    }
  })

  it('sends a tap at the band middle through the focus', () => {
    const target = new Mesh(new SphereGeometry(0.05), new MeshBasicMaterial())
    target.position.copy(focus)
    target.updateMatrixWorld()
    for (const from of orbits) {
      const cam = orbitCamera(W, H, focus, from)
      applyLensShift(cam, W, H, lensShift(W, H, band))
      const ray = new Raycaster()
      ray.setFromCamera(new Vector2((centre[0] / W) * 2 - 1, 1 - (centre[1] / H) * 2), cam)
      expect(ray.ray.distanceToPoint(focus)).toBeLessThan(1e-6)
      expect(ray.intersectObject(target).length).toBeGreaterThan(0)
    }
  })

  it('moves neither the camera nor the projection scale', () => {
    const cam = orbitCamera(W, H, focus, orbits[1])
    const before = cam.projectionMatrix.clone()
    const pose = cam.matrixWorld.clone()
    applyLensShift(cam, W, H, lensShift(W, H, band))
    expect(cam.matrixWorld.equals(pose)).toBe(true)
    expect(cam.aspect).toBeCloseTo(W / H, 12)
    // The scale terms: what a cell's pixels and every label's size come from.
    expect(cam.projectionMatrix.elements[0]).toBeCloseTo(before.elements[0], 12)
    expect(cam.projectionMatrix.elements[5]).toBeCloseTo(before.elements[5], 12)
  })

  it('slides the whole picture by one fixed amount, in front of the camera and behind it', () => {
    const cam = orbitCamera(W, H, focus, orbits[0])
    const centred = (p: Vector3): Vector3 => p.clone().project(cam)
    const points = [new Vector3(10, 4, -30), new Vector3(-3, 8, 2), new Vector3(1, 1, 60)]
    const plain = points.map(centred)
    applyLensShift(cam, W, H, lensShift(W, H, band))
    const axis = viewAxisNdc(cam.projectionMatrix)
    points.forEach((p, i) => {
      const v = p.clone().project(cam)
      expect(v.x - plain[i].x).toBeCloseTo(axis.x, 9)
      expect(v.y - plain[i].y).toBeCloseTo(axis.y, 9)
    })
  })

  it('reads its own line of sight back as the band middle', () => {
    const cam = orbitCamera(W, H, focus, orbits[2])
    expect(viewAxisNdc(cam.projectionMatrix)).toEqual({ x: 0, y: 0 })
    applyLensShift(cam, W, H, lensShift(W, H, band))
    const axis = viewAxisNdc(cam.projectionMatrix)
    expect(((axis.x + 1) / 2) * W).toBeCloseTo(centre[0], 9)
    expect(((1 - axis.y) / 2) * H).toBeCloseTo(centre[1], 9)
  })

  it('clears back to a centred projection, and does nothing it does not need to', () => {
    const cam = orbitCamera(W, H, focus, orbits[0])
    const centred = cam.projectionMatrix.clone()
    expect(applyLensShift(cam, W, H, { x: 0, y: 0 })).toBe(false)
    expect(applyLensShift(cam, W, H, { x: 0, y: 199 })).toBe(true)
    expect(applyLensShift(cam, W, H, { x: 0, y: 199 })).toBe(false)
    expect(applyLensShift(cam, W, H, { x: 0.2, y: -0.3 })).toBe(true)
    expect(cam.view?.enabled).toBe(false)
    centred.elements.forEach((e, i) => expect(cam.projectionMatrix.elements[i]).toBeCloseTo(e, 12))
  })
})
