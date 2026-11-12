/**
 * hopFraming.test.ts: the tutorial's camera shots, in render space (owner,
 * 2026-11-12): the first hop framed from the side with both ends on screen,
 * and the look over the avatar's shoulder toward the chest.
 */
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { FRAME_MAX_DISTANCE, FRAME_MIN_DISTANCE, easeOrbit, frameHop, liftSide, smooth01 } from '../hopFraming'

const FOV = 55
const PHONE = 412 / 915

/** Whether render point `p` is on screen for a camera at `eye` looking at `target` (up is +y). */
function onScreen(p: number[], eye: Vector3, target: Vector3, fovDeg: number, aspect: number): boolean {
  const fwd = target.clone().sub(eye).normalize()
  const right = fwd.clone().cross(new Vector3(0, 1, 0)).normalize()
  const up = right.clone().cross(fwd)
  const d = new Vector3(p[0], p[1], p[2]).sub(eye)
  const z = d.dot(fwd)
  if (z <= 0) return false
  const t = Math.tan((fovDeg * Math.PI) / 360)
  return Math.abs(d.dot(up) / z) <= t && Math.abs(d.dot(right) / z) <= t * aspect
}

describe('frameHop', () => {
  it('puts both ends of the first hop on a phone screen, seen from the side and a little above', () => {
    // The tutorial's first hop: 2 up, 10 out, with the camera looking straight down it.
    const a = [0, 0, 0], b = [0, 2, -10]
    const { dir, distance } = frameHop(a, b, new Vector3(0, 0, 26), FOV, PHONE)
    const mid = new Vector3(0, 1, -5)
    const eye = mid.clone().addScaledVector(dir, distance)
    expect(onScreen(a, eye, mid, FOV, PHONE)).toBe(true)
    expect(onScreen(b, eye, mid, FOV, PHONE)).toBe(true)
    // From the side: nearly square to the path, not down it.
    const along = new Vector3(0, 2, -10).normalize()
    expect(Math.abs(dir.dot(along))).toBeLessThan(0.35)
    expect(dir.y).toBeGreaterThan(0)
    expect(dir.length()).toBeCloseTo(1, 9)
  })

  it('turns to the side nearest where the camera already is', () => {
    const left = frameHop([0, 0, 0], [0, 0, -10], new Vector3(-20, 0, 5), FOV, 1)
    const right = frameHop([0, 0, 0], [0, 0, -10], new Vector3(20, 0, 5), FOV, 1)
    expect(left.dir.x).toBeLessThan(0)
    expect(right.dir.x).toBeGreaterThan(0)
  })

  it('stays within its nearest and farthest, and comes no nearer for a wide screen than for a tall one', () => {
    expect(frameHop([0, 0, 0], [1, 0, 0], new Vector3(0, 0, 10), FOV, 1).distance).toBe(FRAME_MIN_DISTANCE)
    expect(frameHop([0, 0, 0], [1000, 0, 0], new Vector3(0, 0, 10), FOV, 1).distance).toBe(FRAME_MAX_DISTANCE)
    const tall = frameHop([0, 0, 0], [12, 0, 0], new Vector3(0, 0, 10), FOV, PHONE).distance
    const wide = frameHop([0, 0, 0], [12, 0, 0], new Vector3(0, 0, 10), FOV, 16 / 9).distance
    expect(tall).toBeGreaterThan(wide)
  })

  it('has a side for a vertical hop and for a camera at its target', () => {
    const v = frameHop([0, 0, 0], [0, 8, 0], new Vector3(0, 5, 0), FOV, 1)
    expect(Number.isFinite(v.dir.x + v.dir.y + v.dir.z)).toBe(true)
    expect(v.dir.length()).toBeCloseTo(1, 9)
    const z = frameHop([0, 0, 0], [3, 0, 0], new Vector3(), FOV, 1)
    expect(z.dir.length()).toBeCloseTo(1, 9)
  })
})

describe('liftSide', () => {
  it('looks from behind the avatar, away from the chest, and from above', () => {
    // The chest is at -z from the avatar, so behind is +z.
    const d = liftSide(new Vector3(0, 0, 2))
    expect(d.z).toBeGreaterThan(0.7)
    expect(d.y).toBeGreaterThan(0.3)
    expect(d.length()).toBeCloseTo(1, 9)
  })
})

describe('easeOrbit', () => {
  it('starts where the camera is, ends at the shot, and turns along the arc, never through the target', () => {
    const from = { dir: new Vector3(0, 0, 1), distance: 26 }
    const to = { dir: new Vector3(0, 0, -1), distance: 8 }
    const out = new Vector3()
    expect(easeOrbit(from, to, 0, out).toArray().map((v) => +v.toFixed(9))).toEqual([0, 0, 26])
    const end = easeOrbit(from, to, 1, out)
    expect(end.z).toBeCloseTo(-8, 6)
    for (let w = 0.1; w < 1; w += 0.1) expect(easeOrbit(from, to, w, out).length()).toBeGreaterThan(7.9)
  })

  it('smooth01 eases in and out over its length', () => {
    expect(smooth01(-1)).toBe(0)
    expect(smooth01(0.5)).toBeCloseTo(0.5, 9)
    expect(smooth01(2)).toBe(1)
    expect(smooth01(0.1)).toBeLessThan(0.1)
  })
})
