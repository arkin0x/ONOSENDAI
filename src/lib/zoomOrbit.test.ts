/**
 * What these prove: zooming keeps the orbit. The camera's target is the
 * store's own cursorOffset at each zoom, walked 2^78 up to 2^84 and back, with
 * the cursor on your avatar and two cells away from it; carryOrbit keeps the
 * camera's distance from the target and its direction to it exactly, and the
 * rule it replaced (the camera stays put and turns) did not (arkinox,
 * 2026-10-01).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useCyberspace } from '../store/useCyberspace'
import type { Position } from './space'
import { carryOrbit, type V3 } from './zoomOrbit'

const S = () => useCyberspace.getState()

const HERE: Position = {
  x: (1n << 84n) + 0x1d3c5a7f9e1b2c3d4e5fn,
  y: 0x0fedcba9876543210abcn,
  z: (3n << 82n) + 0x123456789abcdef0123n,
}

/** 78 up to 84 and back down, the walk arkinox made. */
const WALK = [78, 79, 80, 81, 82, 83, 84, 83, 82, 81, 80, 79, 78]

/** The camera target at each zoom of the walk, read from the store. */
function targets(): V3[] {
  return WALK.map((scaleExp) => {
    useCyberspace.setState({ scaleExp })
    return S().cursorOffset()
  })
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const len = (v: V3): number => Math.hypot(v[0], v[1], v[2])

/** An orbit seen from up, left and in front, as after a drag. */
const ORBIT: V3 = [-14.5, -9.0, 19.6]

describe('zooming keeps the orbit', () => {
  beforeEach(() => {
    S().clearFocus()
    useCyberspace.setState({ position: HERE, anchor: HERE, cursor: HERE, spectate: null, exploreIndex: null, transit: null, scaleExp: 78 })
  })

  for (const away of [0, 2]) {
    it(`keeps distance and angle from 2^78 to 2^84 and back, cursor ${away} cells out`, () => {
      for (let i = 0; i < away; i++) S().moveCursor(S().axes().right)
      const ts = targets()
      let camera: V3 = [ts[0][0] + ORBIT[0], ts[0][1] + ORBIT[1], ts[0][2] + ORBIT[2]]
      let moved = 0
      for (let i = 1; i < ts.length; i++) {
        if (len(sub(ts[i], ts[i - 1])) > 1e-6) moved++
        camera = carryOrbit(camera, ts[i - 1], ts[i])
        const offset = sub(camera, ts[i])
        for (let k = 0; k < 3; k++) expect(offset[k]).toBeCloseTo(ORBIT[k], 9)
      }
      // The target really did move on the way, so the constancy above is the
      // carry at work rather than nothing to carry.
      expect(moved).toBeGreaterThan(4)
    })
  }

  it('drifted under the old rule, where an orbited camera stayed put', () => {
    S().moveCursor(S().axes().right)
    S().moveCursor(S().axes().right)
    const ts = targets()
    const camera: V3 = [ts[0][0] + ORBIT[0], ts[0][1] + ORBIT[1], ts[0][2] + ORBIT[2]]
    const distances = ts.map((t) => len(sub(camera, t)))
    expect(Math.max(...distances) - Math.min(...distances)).toBeGreaterThan(0.5)
  })
})
