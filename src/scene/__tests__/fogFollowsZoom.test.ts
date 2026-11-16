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
import { fogFar, fogNear, type FogView } from '../fog'
import { nextReach, orbitMaxDistance } from '../buildZoom'
import { ORBIT_MIN_DISTANCE } from '../camera'

/** The fog as it stood before this change (#772), for a camera `d` from its target over the origin: [start, end]. */
function before(d: number): [number, number] {
  const need = d * 2 + d
  // Its reach doubled: 192, 384, 768 ...
  let reach = 192
  while (reach < need) reach *= 2
  const far = Math.max(96, Math.min(192 * (reach / 192), reach - d))
  return [far * 0.85, far]
}

/** Every view: its least and greatest distance from its target, and which fog it takes. */
const MODES: Array<{ name: string; min: number; max: number; view: FogView }> = [
  { name: 'HOP', min: ORBIT_MIN_DISTANCE, max: orbitMaxDistance(false, 0), view: 'orbit' },
  { name: 'VIEW', min: ORBIT_MIN_DISTANCE, max: orbitMaxDistance(false, 0), view: 'orbit' },
  ...[0, 1, 2, 3, 4].map((e) => ({ name: `BUILD 2^${e}`, min: ORBIT_MIN_DISTANCE, max: orbitMaxDistance(true, e), view: 'orbit' as const })),
  // WALK's eye sits on the avatar; held to 64 behind it to be sure, should the eye ever pull back.
  { name: 'WALK', min: 0, max: 64, view: 'walk' },
  // TV's shots stand 24 out at most; held to 64 to be sure.
  { name: 'TV', min: 0, max: 64, view: 'tv' },
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
        const now: [number, number] = [fogNear(m.view, d), fogFar(m.view, d)]
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
        expect(fogNear(m.view, d), `${m.name} at ${d}`).toBeGreaterThanOrEqual(d * 1.5 + (m.view === 'orbit' ? 40 : 0))
        // The camera over its target, or the target at a field's corner from the origin.
        for (const fromOrigin of [d, d + 24 * Math.sqrt(3)]) {
          for (const was of [192, 768, 6144]) {
            const reach = nextReach(was, fogFar(m.view, d) + fromOrigin)
            expect(reach, `${m.name} at ${d}`).toBeGreaterThanOrEqual(fogFar(m.view, d) + fromOrigin)
          }
        }
      }
    })
  }

  it('a zoom out and in, frame by frame as the scene runs it, turning back with no pause: the fog never moves against the zoom, and the reach is always past it', () => {
    for (const max of [96, 1280]) {
      for (const seconds of [0.5, 4]) {
        for (const hold of [0, 60]) {
          let reach = 192
          let lastD = 26
          let last = [fogNear('orbit', 26), fogFar('orbit', 26)]
          const frame = (d: number): void => {
            const now = [fogNear('orbit', d), fogFar('orbit', d)]
            // A re-anchor moves the camera from the origin, never the fog.
            for (const fromOrigin of [d, d + 24 * Math.sqrt(3)]) {
              reach = nextReach(reach, now[1] + fromOrigin)
              expect(reach).toBeGreaterThanOrEqual(now[1] + fromOrigin)
            }
            expect(now[0]).toBeGreaterThanOrEqual(d * 1.5 + 40)
            for (const i of [0, 1]) {
              // Each moves the way the camera does, or not at all.
              expect(Math.sign(now[i] - last[i]) * Math.sign(d - lastD)).toBeGreaterThanOrEqual(0)
              if (d === lastD) expect(now[i]).toBe(last[i])
            }
            last = now
            lastD = d
          }
          // Out, held or not, and straight back in: as a hand pinches.
          const n = Math.round(60 * seconds)
          for (let i = 1; i <= n; i++) frame(26 * (max / 26) ** (i / n))
          for (let i = 0; i < hold; i++) frame(max)
          for (let i = 1; i <= n; i++) frame(max * (26 / max) ** (i / n))
          // Where it started, at once: nothing still settling.
          expect(last).toEqual([fogNear('orbit', 26), fogFar('orbit', 26)])
        }
      }
    }
  })

  it('reaches further than the old fog at every zoom, and further than the one before it everywhere it is clear', () => {
    // Before #769 the fog began at 0.225 of an end of CULL_REACH less the camera's distance, never under 96.
    const original = (d: number): [number, number] => { const far = Math.max(96, 192 - d); return [far * 0.225, far] }
    for (let d = ORBIT_MIN_DISTANCE; d <= 96; d += 0.5) {
      expect(fogNear('orbit', d)).toBeGreaterThanOrEqual(original(d)[0])
      expect(fogFar('orbit', d)).toBeGreaterThan(original(d)[1] * 0.85)
      if (d >= 20) expect(fogFar('orbit', d)).toBeGreaterThan(original(d)[1])
    }
    // The numbers the PR states.
    const at = (d: number): number[] => [fogNear('orbit', d), fogFar('orbit', d)]
    expect(at(2)).toEqual([43, 167])
    expect(at(26)).toEqual([79, 251])
    expect(at(64)).toEqual([136, 384])
    expect(at(96)).toEqual([184, 496])
    expect(at(1280)).toEqual([1960, 4640])
  })
})

describe('WALK sees farther (arkinox, 2026-11-16: "the draw distance fog in WALK is way more restrictive than in HOP. I\'d like to be able to see further in WALK mode.")', () => {
  it('begins at 80 and is black at 300, where it was 48 and 96 (TV\'s, which keeps them)', () => {
    expect([fogNear('walk', 0), fogFar('walk', 0)]).toEqual([80, 300])
    expect([fogNear('tv', 0), fogFar('tv', 0)]).toEqual([48, 96])
  })

  it('sees at least as far as HOP at its usual orbit (26 cells): clear as far, black farther', () => {
    expect(fogNear('walk', 0)).toBeGreaterThanOrEqual(fogNear('orbit', 26))
    expect(fogFar('walk', 0)).toBeGreaterThan(fogFar('orbit', 26))
    // A long soft fade: black at least three times as far as it begins.
    expect(fogFar('walk', 0) / fogNear('walk', 0)).toBeGreaterThanOrEqual(3)
    // A row of 64-gibson landscape tiles keeps its colour a tile ahead and fades over the next few: no wall of black.
    const kept = (x: number): number => { const t = Math.min(1, Math.max(0, (x - fogNear('walk', 0)) / (fogFar('walk', 0) - fogNear('walk', 0)))); return 1 - t * t * (3 - 2 * t) }
    expect(kept(64)).toBe(1)
    expect(kept(128)).toBeGreaterThan(0.85)
    expect(kept(192)).toBeGreaterThan(0.45)
    expect(kept(256)).toBeGreaterThan(0.05)
  })

  it('the layers draw at or past its end wherever the walker stands in the render field, from any reach before, so nothing pops in', () => {
    for (let d = 0; d <= 64; d += 0.5) {
      // The eye on the avatar, the avatar anywhere out to the field's corner from the render origin.
      for (const fromOrigin of [0, 12, 24 * Math.sqrt(3), d + 24 * Math.sqrt(3)]) {
        const need = fogFar('walk', d) + fromOrigin
        for (const was of [192, 272, 384, 544, 768, 6144]) expect(nextReach(was, need), `${d} ${fromOrigin} ${was}`).toBeGreaterThanOrEqual(need)
      }
    }
    // At the eye, the reach steps up from 192 to 384 on entering WALK, and no further.
    expect(nextReach(192, fogFar('walk', 0) + 24 * Math.sqrt(3))).toBe(384)
  })

  it('keeps the walker and the ground about it clear, and never moves against the eye, with no jump', () => {
    let last: [number, number] | null = null
    for (let d = 0; d <= 64; d += STEP) {
      const now: [number, number] = [fogNear('walk', d), fogFar('walk', d)]
      expect(now[0]).toBeGreaterThanOrEqual(d * 1.5)
      expect(now[0]).toBeLessThan(now[1])
      if (last) for (const i of [0, 1]) { expect(now[i]).toBeGreaterThanOrEqual(last[i]); expect(now[i] - last[i]).toBeLessThanOrEqual(MOST) }
      last = now
    }
  })
})
