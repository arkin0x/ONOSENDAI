/**
 * fogFollowsZoom.test.ts - the fog follows the zoom (arkinox, 2026-11-15, of a
 * HOP zoom by block 101's castle: "The fog gets closer and farther and closer
 * as you zoom. its awkward and doesnt make sense. it should just be
 * consistent with the zoom.").
 *
 * In every view, sampled finely from the closest zoom to the farthest, where
 * the fog begins and where it is black only ever go out as the camera goes
 * out, with no jump; the layers' reach is always beyond the fog's end, so its
 * steps happen in the black; and the target is always clear.
 */

import { describe, expect, it } from 'vitest'
import { fogDistanceStep, fogFar, fogNear } from '../fog'
import { nextReach, orbitMaxDistance, reachStep } from '../buildZoom'
import { ORBIT_MIN_DISTANCE } from '../camera'

/** The fog as it stood before this change (#772), for a camera `d` from its target over the origin: [start, end]. */
function before(d: number): [number, number] {
  const need = d * 2 + d
  const reach = reachStep(need)
  const far = Math.max(96, Math.min(192 * (reach / 192), reach - d))
  return [far * 0.85, far]
}

/** Every view: its least and greatest distance from its target, and whether its fog is TV's and WALK's. */
const MODES: Array<{ name: string; min: number; max: number; base: boolean }> = [
  { name: 'HOP', min: ORBIT_MIN_DISTANCE, max: orbitMaxDistance(false, 0), base: false },
  { name: 'VIEW', min: ORBIT_MIN_DISTANCE, max: orbitMaxDistance(false, 0), base: false },
  ...[0, 1, 2, 3, 4].map((e) => ({ name: `BUILD 2^${e}`, min: ORBIT_MIN_DISTANCE, max: orbitMaxDistance(true, e), base: false })),
  { name: 'WALK', min: 0, max: 0.001, base: true },
  // TV's shots stand 24 out at most; held to 64 to be sure.
  { name: 'TV', min: 0, max: 64, base: true },
]

/** How far apart the samples are, in render cells. */
const STEP = 0.05
/** The most either distance may move between two samples: its slope (4 at most) times the step, and a hair. */
const MOST = 4 * STEP + 1e-9

describe('the fog follows the zoom', () => {
  it('was a saw before: in HOP from 26 to 64 cells the fog came in, then leapt out at 65 (the recording)', () => {
    expect(before(26)).toEqual([166 * 0.85, 166])
    expect(before(64)[1]).toBe(128)
    expect(before(65)[1]).toBe(319)
    // Going out it came in 38 cells, then leapt out 191.
    expect(before(64)[1]).toBeLessThan(before(26)[1])
    expect(before(65)[1] - before(64)[1]).toBeGreaterThan(190)
  })

  for (const m of MODES) {
    it(`${m.name}: start and end only go out as the camera goes out, with no jump, from ${m.min} to ${m.max} cells`, () => {
      let last: [number, number] | null = null
      for (let d = m.min; d <= m.max + 1e-9; d += Math.min(STEP, m.max - m.min || STEP)) {
        const now: [number, number] = [fogNear(m.base, d), fogFar(m.base, d)]
        if (last) {
          for (const i of [0, 1]) {
            expect(now[i], `${m.name} ${i ? 'end' : 'start'} at ${d}`).toBeGreaterThanOrEqual(last[i])
            expect(now[i] - last[i], `${m.name} ${i ? 'end' : 'start'} at ${d}`).toBeLessThanOrEqual(MOST)
          }
        }
        // A long fade: black at least twice as far as it begins.
        expect(now[1] / now[0]).toBeGreaterThanOrEqual(2)
        last = now
      }
    })

    it(`${m.name}: the target and the ground about it are clear, and the layers draw past the fog's end, at every zoom`, () => {
      for (let d = m.min; d <= m.max + 1e-9; d += Math.min(STEP * 10, m.max - m.min || STEP)) {
        expect(fogNear(m.base, d), `${m.name} at ${d}`).toBeGreaterThanOrEqual(d * 1.5 + (m.base ? 0 : 40))
        // The camera over its target, or the target at a field's corner from the origin.
        for (const fromOrigin of [d, d + 24 * Math.sqrt(3)]) {
          for (const was of [192, 768, 6144]) {
            const reach = nextReach(was, fogFar(m.base, d) + fromOrigin)
            expect(reach, `${m.name} at ${d}`).toBeGreaterThanOrEqual(fogFar(m.base, d) + fromOrigin)
          }
        }
      }
    })
  }

  it('a slow zoom out and in, frame by frame as the scene runs it: the fog never moves against the zoom, and the reach is always past it', () => {
    for (const max of [96, 1280]) {
      let from = 26
      let mode: boolean | null = null
      let reach = 192
      let last = [fogNear(false, 26), fogFar(false, 26)]
      const frame = (d: number, out: boolean): void => {
        from = fogDistanceStep(from, mode, false, d, 1 / 60)
        mode = false
        const now = [fogNear(false, from), fogFar(false, from)]
        // A re-anchor moves the camera from the origin, never the fog.
        for (const fromOrigin of [d, d + 24 * Math.sqrt(3)]) reach = nextReach(reach, now[1] + fromOrigin)
        expect(reach).toBeGreaterThanOrEqual(now[1] + d + 24 * Math.sqrt(3))
        expect(now[0]).toBeGreaterThan(d * 1.2)
        for (const i of [0, 1]) {
          if (out) expect(now[i]).toBeGreaterThanOrEqual(last[i] - 1e-9)
          else expect(now[i]).toBeLessThanOrEqual(last[i] + 1e-9)
        }
        last = now
      }
      // Out over four seconds, a second held, in over four, two held: as a hand pinches.
      const seconds = 4
      for (let i = 1; i <= 60 * seconds; i++) frame(26 * (max / 26) ** (i / (60 * seconds)), true)
      for (let i = 0; i < 60; i++) frame(max, true)
      for (let i = 1; i <= 60 * seconds; i++) frame(max * (26 / max) ** (i / (60 * seconds)), false)
      for (let i = 0; i < 120; i++) frame(26, false)
      expect(last[1]).toBeCloseTo(fogFar(false, 26), 0)
    }
  })

  it('reaches further than the old fog at every zoom, and further than the one before it everywhere it is clear', () => {
    // Before #769 the fog began at 0.225 of an end of CULL_REACH less the camera's distance, never under 96.
    const original = (d: number): [number, number] => { const far = Math.max(96, 192 - d); return [far * 0.225, far] }
    for (let d = ORBIT_MIN_DISTANCE; d <= 96; d += 0.5) {
      expect(fogNear(false, d)).toBeGreaterThanOrEqual(original(d)[0])
      expect(fogFar(false, d)).toBeGreaterThan(original(d)[1] * 0.85)
      if (d >= 20) expect(fogFar(false, d)).toBeGreaterThan(original(d)[1])
    }
    // The numbers the PR states.
    const at = (d: number): number[] => [fogNear(false, d), fogFar(false, d)]
    expect(at(2)).toEqual([43, 167])
    expect(at(26)).toEqual([79, 251])
    expect(at(64)).toEqual([136, 384])
    expect(at(96)).toEqual([184, 496])
    expect(at(1280)).toEqual([1960, 4640])
  })
})
