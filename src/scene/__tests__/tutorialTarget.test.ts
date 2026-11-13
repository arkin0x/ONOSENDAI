/**
 * tutorialTarget.test.ts - the tutorial's hop target as the scene draws it
 * (scene/TutorialTarget.tsx; owner, 2026-11-13, "clearly visible"):
 *
 * - drawn only while the tutorial runs with its layout in, in the layout's
 *   plane, at the target's gibson (tutorial/course.ts TARGET), at a shard's
 *   size, and stood on cyberspace +Y however the view is turned;
 * - the beam and the ping only while the course step waits;
 * - nothing in it can be tapped: every mesh's raycast is off.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { itemCentre, type ViewAxes } from '../../lib/space'
import { alignedOrigin } from '../../store/useCyberspace'
import { tutorialLayout } from '../../tutorial/layout'
import { targetAt } from '../../tutorial/course'
import { targetGuiding, targetMark } from '../TutorialTarget'

const SPAWN = { x: (1n << 40n) + 1000n, y: (1n << 40n) + 2050n, z: (1n << 40n) + 1500n }
const UPRIGHT: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }
const TURNED: ViewAxes = { right: { axis: 'y', dir: -1 }, up: { axis: 'z', dir: 1 }, out: { axis: 'x', dir: 1 } }

describe('the hop target mark', () => {
  const layout = tutorialLayout(SPAWN, 0)
  it('is drawn at the target, a gibson to a gibson at 2^0, only with the tutorial on, its layout in, in its plane', () => {
    const m = targetMark(true, layout, SPAWN, 0, 0, UPRIGHT)!
    expect(m.centre).toEqual(itemCentre(targetAt(layout.frame), alignedOrigin(SPAWN, 0), 0, UPRIGHT))
    expect(m.scale).toBe(1)
    expect(targetMark(false, layout, SPAWN, 0, 0, UPRIGHT)).toBe(null)
    expect(targetMark(true, null, SPAWN, 0, 0, UPRIGHT)).toBe(null)
    expect(targetMark(true, layout, SPAWN, 1, 0, UPRIGHT)).toBe(null)
    // Shrinks with the zoom as a shard does, and goes once it is a speck.
    expect(targetMark(true, layout, SPAWN, 0, 2, UPRIGHT)!.scale).toBe(0.25)
    expect(targetMark(true, layout, SPAWN, 0, 8, UPRIGHT)).toBe(null)
  })

  it('stands on cyberspace +Y however the view is turned', () => {
    for (const axes of [UPRIGHT, TURNED]) {
      const m = targetMark(true, layout, SPAWN, 0, 0, axes)!
      const up = new Vector3(0, 1, 0).applyQuaternion(m.turn)
      // Render axes are [right, up, out]: +Y is wherever the view puts the world's y.
      const i = [axes.right, axes.up, axes.out].findIndex((a) => a.axis === 'y')
      const want = [0, 0, 0]; want[i] = [axes.right, axes.up, axes.out][i].dir
      expect(up.toArray().map((v) => Math.round(v))).toEqual(want)
    }
  })

  it('guides (the beam and the ping) only while the course step waits', () => {
    const script = { steps: [{ id: 'inventory' }, { id: 'to-course' }, { id: 'walk' }] }
    expect(targetGuiding({ active: true, done: false, index: 1, script })).toBe(true)
    expect(targetGuiding({ active: true, done: true, index: 1, script })).toBe(false)
    expect(targetGuiding({ active: true, done: false, index: 2, script })).toBe(false)
    expect(targetGuiding({ active: false, done: false, index: 1, script })).toBe(false)
  })

  it('can never be tapped: every mesh has its raycast off', () => {
    const src = readFileSync(new URL('../TutorialTarget.tsx', import.meta.url), 'utf8')
    const meshes = src.match(/<mesh\b[^>]*>/g) ?? []
    expect(meshes.length).toBeGreaterThanOrEqual(4)
    for (const m of meshes) expect(m).toContain('raycast={noRaycast}')
  })
})
