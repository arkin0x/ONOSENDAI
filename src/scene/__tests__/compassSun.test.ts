/**
 * compassSun.test.ts: the black sun on the 3D compass points the true way
 * from where you look, for the views the app has and for free orbits, and is
 * dimmed rather than hidden when it lies past the centre of the ball
 * (arkinox, 2026-11-24: "Can we add the black sun to the 3d compass? that
 * would help").
 */

import { describe, expect, it } from 'vitest'
import { Euler, Group, MeshBasicMaterial, Quaternion, Vector3 } from 'three'
import { SUN_LAYOUT, SUN_WORDS, placeSun, sunBearing, sunInView, sunNearness, sunOnScreen, sunReach, sunScale, type SunParts } from '../Compass3D'
import { canonicalQuaternion, renderDirection, topDownQuaternion, viewAxes } from '../../lib/space'

/**
 * The compass's Z arrow for a view: +Z_cs in the scene's local frame, as the
 * scene sun uses it. That frame is the view's axes permuted to screen right,
 * up and out, so a snapped view's camera is the identity in it, and an orbit
 * turns the camera away from the identity.
 */
function sunDir(view: Quaternion): Vector3 {
  return new Vector3(...renderDirection(viewAxes(view), 'z'))
}

const SNAPPED = new Quaternion()
const yaw = (deg: number): Quaternion => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180)

describe('sunInView', () => {
  it('puts the sun dead ahead in the canonical view, past the centre of the ball', () => {
    const seen = sunInView(sunDir(canonicalQuaternion()), SNAPPED, new Vector3())
    expect(seen.x).toBeCloseTo(0)
    expect(seen.y).toBeCloseTo(0)
    expect(seen.z).toBeCloseTo(-1)
    expect(sunBearing(seen)).toBe('ahead')
    expect(sunNearness(seen)).toBe(0)
  })

  it('puts the sun up the screen in the top-down map, where +Z runs up', () => {
    const seen = sunInView(sunDir(topDownQuaternion()), SNAPPED, new Vector3())
    expect(seen.y).toBeCloseTo(1)
    expect(sunBearing(seen)).toBe('up')
  })

  it('follows a free orbit: the axes stay those of the canonical frame while the camera turns', () => {
    // The view's axes snap; the camera does not. The sun's direction is the
    // snapped +Z arrow, and only the pose turns it in the compass.
    const dir = sunDir(canonicalQuaternion())
    const out = new Vector3()
    // Turned 90 degrees left (yaw +90 about up): the sun is to your right.
    expect(sunBearing(sunInView(dir, yaw(90), out))).toBe('right')
    expect(out.x).toBeCloseTo(1)
    // Turned 90 degrees right: to your left.
    expect(sunBearing(sunInView(dir, yaw(-90), out))).toBe('left')
    expect(out.x).toBeCloseTo(-1)
    // Turned about: behind you, out of the ball toward the eye, at full strength.
    expect(sunBearing(sunInView(dir, yaw(180), out))).toBe('behind')
    expect(out.z).toBeCloseTo(1)
    expect(sunNearness(out)).toBe(1)
    // Looking straight down from the canonical view: the sun is up the screen.
    expect(sunBearing(sunInView(dir, new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)), out))).toBe('up')
    // Looking straight up: down the screen.
    expect(sunBearing(sunInView(dir, new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)), out))).toBe('down')
  })

  it('keeps unit length at an odd angle, and points where the pose says', () => {
    const dir = sunDir(canonicalQuaternion())
    const pose = new Quaternion().setFromEuler(new Euler(0.3, -0.7, 0.2))
    const seen = sunInView(dir, pose, new Vector3())
    expect(seen.length()).toBeCloseTo(1)
    // Turned back by the pose, it is the arrow again.
    expect(seen.clone().applyQuaternion(pose).distanceTo(dir)).toBeCloseTo(0)
  })

  it('writes into the vector it is given and leaves the pose and direction alone', () => {
    const dir = new Vector3(0, 0, -1)
    const pose = yaw(30)
    const before = pose.clone()
    const out = new Vector3()
    expect(sunInView(dir, pose, out)).toBe(out)
    expect(pose.equals(before)).toBe(true)
    expect(dir.equals(new Vector3(0, 0, -1))).toBe(true)
  })
})

describe('sunNearness', () => {
  it('dims smoothly through edge-on rather than switching', () => {
    const at = (z: number): number => sunNearness(new Vector3(Math.sqrt(1 - z * z), 0, z))
    expect(at(-1)).toBe(0)
    expect(at(-0.25)).toBe(0)
    expect(at(0)).toBeCloseTo(0.5)
    expect(at(0.25)).toBe(1)
    expect(at(1)).toBe(1)
    let last = -1
    for (let z = -1; z <= 1.0001; z += 0.05) {
      const n = at(Math.min(1, z))
      expect(n).toBeGreaterThanOrEqual(last)
      last = n
    }
  })
})

describe('sunBearing', () => {
  it('has a plain sentence for every bearing', () => {
    for (const w of ['ahead', 'behind', 'left', 'right', 'up', 'down'] as const) {
      expect(SUN_WORDS[w]).toMatch(/^Black sun /)
      expect(SUN_WORDS[w]).not.toMatch(/\u2014/)
    }
  })
})

describe('placeSun', () => {
  const parts = (): SunParts => ({ group: new Group(), disc: new MeshBasicMaterial(), ring: new MeshBasicMaterial() })
  const dir = new Vector3(0, 0, -1)

  it('turns the sun to the compass camera', () => {
    const p = parts()
    const pose = new Quaternion().setFromEuler(new Euler(0.4, 1.1, -0.2))
    placeSun(p, dir, pose)
    expect(p.group!.quaternion.angleTo(pose)).toBeCloseTo(0)
  })

  it('facing you: full strength, depth tested like everything else', () => {
    const p = parts()
    expect(placeSun(p, dir, yaw(180))).toBe('behind')
    expect(p.ring!.opacity).toBe(1)
    expect(p.ring!.depthTest).toBe(true)
    expect(p.disc!.opacity).toBeLessThan(1)
  })

  it('past the centre: dimmed, and the corona draws through what is in front so it is never hidden', () => {
    const p = parts()
    expect(placeSun(p, dir, SNAPPED)).toBe('ahead')
    expect(p.ring!.opacity).toBeLessThan(1)
    expect(p.ring!.opacity).toBeGreaterThan(0.5)
    expect(p.ring!.depthTest).toBe(false)
    // The disc stays depth tested, so the centre of the ball reads as in front of it.
    expect(p.disc!.depthTest).toBe(true)
  })

  it('stands the sun out along the Z arrow, on its line', () => {
    const p = parts()
    const pose = new Quaternion().setFromEuler(new Euler(0.3, 1.2, 0, 'YXZ'))
    placeSun(p, dir, pose)
    const at = p.group!.position
    expect(at.length()).toBeGreaterThan(SUN_LAYOUT.label)
    expect(at.clone().normalize().distanceTo(dir)).toBeCloseTo(0)
  })

  it('copes with parts not yet mounted', () => {
    expect(placeSun({ group: null, disc: null, ring: null }, dir, yaw(90))).toBe('right')
  })
})

/**
 * The owner, 2026-11-24: "it should be beyond the Z+ arrow, not on top of the
 * arrow. make it be past the letter Z on that axis". Measured on the screen,
 * in the phone's 84px panel (42px from centre to edge), over every turn of
 * the camera in 3 degree steps.
 */
describe('the sun beyond the Z label', () => {
  const HALF_PX = 42
  const dir = new Vector3(0, 0, -1)
  const seen = new Vector3()
  const each = (fn: (lateral: number) => void): void => {
    for (let yawDeg = -180; yawDeg < 180; yawDeg += 3) {
      for (let pitchDeg = -88; pitchDeg <= 88; pitchDeg += 4) {
        const pose = new Quaternion().setFromEuler(new Euler((pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0, 'YXZ'))
        sunInView(dir, pose, seen)
        fn(Math.hypot(seen.x, seen.y))
      }
    }
  }
  /** How far a radius r of the sun reaches on screen, in the same units, at its depth and scale. */
  const across = (reach: number, r: number): number => (r * sunScale(seen, reach)) / ((SUN_LAYOUT.cameraDistance - reach * seen.z) * SUN_LAYOUT.halfFovTan)

  it('keeps the whole corona inside the panel at every orientation', () => {
    let checked = 0
    each(() => {
      const reach = sunReach(seen)
      expect(sunOnScreen(seen, reach)).toBeLessThanOrEqual(SUN_LAYOUT.edge + 1e-9)
      expect(sunOnScreen(seen, reach) + across(reach, SUN_LAYOUT.coronaOuter)).toBeLessThan(1)
      checked++
    })
    expect(checked).toBeGreaterThan(5000)
  })

  it('goes arrow, then Z, then the sun, with the sun clear of the letter wherever the axis is not end on', () => {
    each((lateral) => {
      if (lateral < 0.6) return
      const reach = sunReach(seen)
      const tip = sunOnScreen(seen, SUN_LAYOUT.arrowTip) * HALF_PX
      const label = sunOnScreen(seen, SUN_LAYOUT.label) * HALF_PX
      const sun = sunOnScreen(seen, reach) * HALF_PX
      const core = sun - across(reach, SUN_LAYOUT.coronaCore) * HALF_PX
      expect(label).toBeGreaterThan(tip)
      expect(sun).toBeGreaterThan(label)
      // Within about 37 degrees of the screen's plane (lateral 0.8 and up),
      // the ring's bright core starts past the letter's centre by more than
      // half a 10px letter's width, so the Z sits clear of the ring; leaning
      // further toward end on, it may reach into the corona's soft inner glow.
      if (lateral >= 0.8) expect(core - label).toBeGreaterThan(2.5)
    })
  })

  it('in the plane of the screen: the sun stands near the edge, past the label', () => {
    sunInView(dir, yaw(90), seen)
    const reach = sunReach(seen)
    expect(reach).toBeLessThan(SUN_LAYOUT.at)
    expect(sunOnScreen(seen, reach)).toBeCloseTo(SUN_LAYOUT.edge)
    expect(sunOnScreen(seen, SUN_LAYOUT.label)).toBeLessThan(sunOnScreen(seen, reach))
  })

  it('end on, either way, collapses to the centre: the reticle, its ring clear round the centre dot', () => {
    const DOT = 0.12
    for (const pose of [SNAPPED, yaw(180)]) {
      sunInView(dir, pose, seen)
      const reach = sunReach(seen)
      expect(sunOnScreen(seen, reach)).toBeCloseTo(0)
      expect(across(reach, SUN_LAYOUT.coronaCore)).toBeGreaterThan(1.5 * DOT / (SUN_LAYOUT.cameraDistance * SUN_LAYOUT.halfFovTan))
      expect(across(reach, SUN_LAYOUT.coronaOuter)).toBeLessThan(0.35)
    }
  })

  it('keeps the same size on screen as it swings round, like a thing at infinity', () => {
    const sizes: number[] = []
    each((lateral) => {
      if (lateral < 0.5) return
      sizes.push(across(sunReach(seen), SUN_LAYOUT.coronaOuter))
    })
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(1e-9)
  })
})
