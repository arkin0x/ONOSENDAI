/**
 * pose.test.ts — a shard stands on the Earth the same way for everyone.
 */

import { describe, expect, it } from 'vitest'
import { applyPose, bearingOf, composePose, csDirection, drawPoseAt, frameAt, frameDeterminant, frameOf, poseAt, poseMatrix, snapOffered, viewPose, wrapSpin, SNAP_MIN_HEIGHT, type V3 } from './pose'
import { gpsToDataspaceXyz } from './hyperspace/landfall'
import type { ViewAxes } from './space'

/** The view frame the render mapping itself is: screen right on +X, up on +Y, out of the screen on -Z. */
const FLAT: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
/** A turned frame: cyberspace +Z on screen right, +X out of the screen. */
const TURNED: ViewAxes = { right: { axis: 'z', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'x', dir: 1 } }

const close = (a: V3, b: V3, eps = 1e-9): void => {
  for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps)
}

describe('the local frame', () => {
  it('at latitude 0 longitude 0 puts up on cyberspace +X, east on +Z, north on +Y', () => {
    const f = frameAt(0, 0)
    close(f.up, [1, 0, 0])
    close(f.east, [0, 0, 1])
    close(f.north, [0, 1, 0])
  })

  it('is right handed in cyberspace axes everywhere: determinant +1', () => {
    for (const [lat, lon] of [[0, 0], [37.78, -122.42], [-33.86, 151.22], [89.9, 10]]) {
      expect(frameDeterminant(frameAt(lat, lon))).toBeCloseTo(1, 9)
    }
  })

  it('is orthonormal', () => {
    const f = frameAt(37.78, -122.42)
    const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    expect(dot(f.east, f.up)).toBeCloseTo(0, 12)
    expect(dot(f.east, f.north)).toBeCloseTo(0, 12)
    expect(dot(f.up, f.north)).toBeCloseTo(0, 12)
    expect(Math.hypot(...f.east)).toBeCloseTo(1, 12)
    expect(Math.hypot(...f.up)).toBeCloseTo(1, 12)
    expect(Math.hypot(...f.north)).toBeCloseTo(1, 12)
  })

  it('comes from a dataspace position through the canonical mapping, altitude ignored', () => {
    const p = gpsToDataspaceXyz(37.7847, -122.4011)
    const f = frameOf(p)
    const g = frameAt(37.7847, -122.4011)
    close(f.up, g.up, 1e-6)
    close(f.north, g.north, 1e-6)
  })
})

describe('spin is a compass bearing', () => {
  const f = frameAt(37.78, -122.42)
  const facing = (spin: number): V3 => applyPose(poseMatrix(f, spin), [0, 0, 1])

  it('sends +Z north at 0, east at 90, south at 180, west at 270', () => {
    close(facing(0), f.north)
    close(facing(90), f.east)
    close(facing(180), [-f.north[0], -f.north[1], -f.north[2]])
    close(facing(270), [-f.east[0], -f.east[1], -f.east[2]])
  })

  it('always sends +Y to up', () => {
    for (const spin of [0, 45, 90, 135, 200, 359]) close(applyPose(poseMatrix(f, spin), [0, 1, 0]), f.up)
  })

  it('keeps the frame right handed at every spin', () => {
    for (const spin of [0, 30, 90, 200, 359]) {
      const m = poseMatrix(f, spin)
      const fr = { east: [m[0], m[1], m[2]] as V3, up: [m[3], m[4], m[5]] as V3, north: [m[6], m[7], m[8]] as V3 }
      expect(frameDeterminant(fr)).toBeCloseTo(1, 9)
    }
  })

  it('reads back from the facing: bearingOf(facing(spin)) is spin', () => {
    for (const spin of [0, 1, 45, 90, 179, 180, 181, 270, 359]) expect(bearingOf(f, facing(spin))).toBe(spin)
  })

  it('has no bearing straight up or down', () => {
    expect(bearingOf(f, f.up)).toBeNull()
    expect(bearingOf(f, [-f.up[0], -f.up[1], -f.up[2]])).toBeNull()
  })

  it('wraps to a whole number 0..359', () => {
    expect(wrapSpin(360)).toBe(0)
    expect(wrapSpin(-1)).toBe(359)
    expect(wrapSpin(725)).toBe(5)
    expect(wrapSpin(44.6)).toBe(45)
  })

  it('poses a vertex at a position: x to the right of the facing, y up, z along it', () => {
    const p = gpsToDataspaceXyz(0, 0)
    const m = poseAt(p, 90)
    // Facing east at the origin of the map: right is south (-north), up is +X cs.
    close(applyPose(m, [1, 0, 0]), [0, -1, 0], 1e-6)
    close(applyPose(m, [0, 1, 0]), [1, 0, 0], 1e-6)
    close(applyPose(m, [0, 0, 1]), [0, 0, 1], 1e-6)
  })
})

describe('the snap is offered', () => {
  it('in dataspace at height 27 and up, never in cyberspace', () => {
    expect(SNAP_MIN_HEIGHT).toBe(27)
    expect(snapOffered(0, 27)).toBe(true)
    expect(snapOffered(0, 40)).toBe(true)
    expect(snapOffered(0, 26)).toBe(false)
    expect(snapOffered(1, 40)).toBe(false)
  })
})

describe('the pose reaches the screen through the view frame', () => {
  it('is the identity in the frame the render mapping already is', () => {
    expect(viewPose(FLAT)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
    // So a drawn pose is the cyberspace one, untouched, in the default view.
    const p = gpsToDataspaceXyz(37.7847, -122.4011)
    expect(drawPoseAt(p, 135, FLAT)).toEqual(poseAt(p, 135))
  })

  it('carries a cyberspace direction to where the world puts it, in any frame', () => {
    // toRender is (x, y, -z), so a vector drawn through viewPose then flipped
    // lands where cellCentre would put that same direction.
    const flip = (v: V3): V3 => [v[0], v[1], -v[2]]
    const world = (axes: ViewAxes, v: V3): V3 =>
      [axes.right, axes.up, axes.out].map((a) => v['xyz'.indexOf(a.axis)] * a.dir) as V3
    for (const axes of [FLAT, TURNED]) {
      for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.5, 0.8]] as V3[]) {
        close(flip(applyPose(viewPose(axes), v)), world(axes, v), 1e-12)
      }
    }
  })

  it('composes: b first, then a', () => {
    const f = frameAt(37.78, -122.42)
    const a = poseMatrix(f, 30)
    const b = poseMatrix(f, 0)
    const v: V3 = [0.2, 0.7, -0.4]
    close(applyPose(composePose(a, b), v), applyPose(a, applyPose(b, v)), 1e-12)
  })

  it('reads a render direction back into cyberspace axes, in any frame', () => {
    const world = (axes: ViewAxes, v: V3): V3 =>
      [axes.right, axes.up, axes.out].map((a) => v['xyz'.indexOf(a.axis)] * a.dir) as V3
    for (const axes of [FLAT, TURNED]) {
      for (const cs of [[1, 0, 0], [0, 0, 1], [0.3, -0.5, 0.8]] as V3[]) {
        close(csDirection(axes, world(axes, cs)), cs, 1e-12)
      }
    }
  })

  it('aims the standing shard at the camera: the bearing of the way you look', () => {
    // Looking due north along the ground at the equator on the prime meridian:
    // north is cyberspace +Y there, so a look along +Y reads as bearing 0.
    const f = frameAt(0, 0)
    expect(bearingOf(f, [0, 1, 0])).toBe(0)
    expect(bearingOf(f, [0, 0, 1])).toBe(90)
    expect(bearingOf(f, [0, -1, 0])).toBe(180)
    expect(bearingOf(f, [0, 0, -1])).toBe(270)
  })
})
