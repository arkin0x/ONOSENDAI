/**
 * buildZoom.test.ts - BUILD pulls back far enough to see a region of
 * Landscape Kit tiles (arkinox, 2026-11-15: "when building the landscape
 * tiles i feel like i can't zoom out far enough"); in every view the fog
 * never darkens what the camera looks at ("the darkness is obscuring my
 * avatar at near the maximum zoom-out", in HOP); and the layers' reach
 * doubles ahead of the fog so nothing seen is undrawn. How the fog follows
 * the zoom is fogFollowsZoom.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BUILD_MAX_GIBSONS,
  cameraNear,
  nextReach,
  orbitMaxDistance,
  reachStep,
  stepOrbitLimit,
  useDrawReach,
} from '../buildZoom'
import { CULL_REACH, fogFar, fogNear } from '../fog'
import { CAMERA_FAR, CAMERA_NEAR, FOV, ORBIT_MAX_DISTANCE } from '../camera'
import { distanceShare, headlampReach, NEAR_SHARE, REACH_MAX } from '../headlamp'

/** Half the width a camera sees at `distance`, for a canvas `aspect` wide to high. */
const halfWidthAt = (distance: number, aspect: number): number => distance * Math.tan((FOV * Math.PI) / 360) * aspect

/** A SceneFog frame, as Scene.tsx runs it. */
interface Fog { near: number; far: number; reach: number }
function frame(f: Fog, distance: number, fromOrigin: number, base = false): Fog {
  const far = fogFar(base, distance)
  return { near: fogNear(base, distance), far, reach: nextReach(f.reach, far + fromOrigin) }
}
const fresh = (): Fog => ({ near: fogNear(false, 26), far: fogFar(false, 26), reach: CULL_REACH })
/** The fog after the camera has held `distance` from its target and `fromOrigin` from the origin for a while. */
const settled = (distance: number, fromOrigin: number, base = false): Fog => { let f = fresh(); for (let i = 0; i < 10; i++) f = frame(f, distance, fromOrigin, base); return f }

describe('how far the orbit pulls back', () => {
  it('is 96 cells outside BUILD at every zoom', () => {
    expect(ORBIT_MAX_DISTANCE).toBe(96)
    for (let e = 0; e <= 84; e++) expect(orbitMaxDistance(false, e)).toBe(96)
  })

  it('in BUILD is 1280 gibsons at fine zooms, never under 96 cells', () => {
    expect(BUILD_MAX_GIBSONS).toBe(1280)
    expect(orbitMaxDistance(true, 0)).toBe(1280)
    expect(orbitMaxDistance(true, 1)).toBe(640)
    expect(orbitMaxDistance(true, 2)).toBe(320)
    expect(orbitMaxDistance(true, 3)).toBe(160)
    for (let e = 4; e <= 84; e++) expect(orbitMaxDistance(true, e)).toBe(96)
  })

  it('fits a 3 by 3 of 128 tiles (384 gibsons) across a phone held upright at 2^0, with room to spare', () => {
    const phone = 375 / 812
    const across = 2 * halfWidthAt(orbitMaxDistance(true, 0), phone)
    expect(across).toBeGreaterThan(384 * 1.5)
    // Turned 45 degrees its diagonal fits too.
    expect(across).toBeGreaterThan(384 * Math.SQRT2 * 1.1)
    // It did not before: 96 cells showed 46 across.
    expect(2 * halfWidthAt(96, phone)).toBeLessThan(64)
    // A laptop sees it many times over.
    expect(2 * halfWidthAt(orbitMaxDistance(true, 0), 1440 / 900)).toBeGreaterThan(384 * 4)
  })

  it('eases a camera left outside a lowered limit back in, the same at any frame rate, never under the limit', () => {
    expect(stepOrbitLimit(26, 1024, 1 / 60, 96)).toBe(1024)
    expect(stepOrbitLimit(96, 96, 1 / 60, 96)).toBe(96)
    // A camera merely outside its own limit (an unlocked orbit as the cursor pulls away) is clamped at once, as before.
    expect(stepOrbitLimit(100, 96, 1 / 60, 96)).toBe(96)
    expect(stepOrbitLimit(1300, 1280, 1 / 60, 1280)).toBe(1280)
    // Leaving BUILD 1024 cells out: one frame takes a small step in.
    const one = stepOrbitLimit(1024, 96, 1 / 60, 1024)
    expect(one).toBeLessThan(1024)
    expect(one).toBeGreaterThan(980)
    const run = (fps: number): number => { let d = 1024; for (let i = 0; i < fps; i++) d = stepOrbitLimit(d, 96, 1 / fps, d); return d }
    expect(run(30)).toBeCloseTo(run(144), 6)
    expect(run(60)).toBeGreaterThanOrEqual(96)
    // Four seconds and it is there.
    let d = 1024
    for (let i = 0; i < 240; i++) d = stepOrbitLimit(d, 96, 1 / 60, d)
    expect(d).toBeLessThan(96.1)
  })
})

describe('the fog never darkens what the camera looks at', () => {
  it('HOP and VIEW at their 96-cell limit: the target and the ground about it fully coloured (it sat at the fog\'s black end)', () => {
    const f = settled(96, 96 + 24)
    expect(f.near).toBeCloseTo(184, 6)
    expect(f.far).toBeCloseTo(496, 6)
    expect(f.reach).toBe(768)
    // The avatar, and 80 cells of ground past it, nearer than where the fog starts.
    expect(96 + 80).toBeLessThan(f.near)
  })

  it('in every mode at every zoom out to its limit, the target is well inside the unfogged range, and the fog black inside the reach', () => {
    const modes: Array<{ name: string; limit: (e: number) => number; base: boolean }> = [
      { name: 'HOP/VIEW', limit: (e) => orbitMaxDistance(false, e), base: false },
      { name: 'BUILD', limit: (e) => orbitMaxDistance(true, e), base: false },
      // TV's shots stand 24 out at most, WALK's eye on the avatar; held to 64 to be sure.
      { name: 'TV/WALK', limit: () => 64, base: true },
    ]
    for (const m of modes) {
      for (let e = 0; e <= 6; e++) {
        for (let d = 0; d <= m.limit(e); d += 2) {
          for (const fromOrigin of [d, d + 24 * Math.sqrt(3)]) {
            const f = settled(d, fromOrigin, m.base)
            // At least 1.5 times as far as the target, and in the third-person views 40 cells more.
            expect(f.near, `${m.name} 2^${e} at ${d}`).toBeGreaterThanOrEqual(d * 1.5 + (m.base ? 0 : 40) - 1e-6)
            expect(f.far).toBeLessThan(CAMERA_FAR)
            expect(f.far + fromOrigin).toBeLessThanOrEqual(f.reach + 1e-9)
            // At 2^0 in BUILD a 3 by 3 of 128 tiles' far corner (192 * sqrt 2 past the cursor, at most) is clear from
            // 480 cells out, and from 400 the fog has taken no more than 5% of it.
            const corner = d + 192 * Math.SQRT2
            if (m.name === 'BUILD' && e === 0 && d >= 480) expect(corner).toBeLessThan(f.near)
            if (m.name === 'BUILD' && e === 0 && d >= 400) expect((corner - f.near) / (f.far - f.near)).toBeLessThan(0.05)
          }
        }
      }
    }
  })

  it('the reach doubles from 192 as far as the fog needs: 6144 at BUILD\'s 1280-cell limit', () => {
    expect(reachStep(0)).toBe(192)
    expect(reachStep(193)).toBe(272)
    expect(reachStep(273)).toBe(384)
    expect(reachStep(2700)).toBe(3072)
    expect(reachStep(5000)).toBe(6144)
    expect(reachStep(1e9)).toBe(192 * 1024)
    // Never more than the square root of 2 past what was asked (a cell rounded up), from the least step up.
    for (let need = 192; need < 100000; need *= 1.01) expect(reachStep(need) / need).toBeLessThanOrEqual(Math.SQRT2 * 1.001)
    const f = settled(1280, 1280 + 24 * Math.sqrt(3))
    expect(f.reach).toBe(6144)
    expect(f.far).toBeCloseTo(160 + 3.5 * 1280, 6)
    expect(f.far).toBeLessThan(CAMERA_FAR)
  })

  it('zooming out and back in, then leaving BUILD: the fog black inside the reach every frame, one change of reach a step, no flipping near a step', () => {
    let f = fresh()
    let d = 26
    let changes = 0
    const step = (): void => {
      const was = f.reach
      f = frame(f, d, d)
      if (f.reach !== was) changes++
      expect(f.far + d).toBeLessThanOrEqual(f.reach + 1e-9)
      expect(f.near).toBeGreaterThan(d * 1.5)
    }
    // A wheel held out: the orbit grows 10% a frame to the limit, faster than a hand.
    while (d < 1280) { d = Math.min(1280, d * 1.1); step() }
    for (let i = 0; i < 120; i++) step()
    expect(f.reach).toBe(6144)
    // One change of reach a step: 384, 544, 768, 1087, 1536, 2173, 3072, 4345, 6144.
    expect(changes).toBe(9)
    // And back in, held near a step to see it does not flip.
    while (d > 200) { d = Math.max(200, d / 1.1); step() }
    for (let i = 0; i < 300; i++) step()
    expect(f.reach).toBe(1536)
    changes = 0
    for (let i = 0; i < 300; i++) { d = 200 + 10 * Math.sin(i / 5); step() }
    expect(changes).toBe(0)
    // Leaving BUILD 200 cells out: the camera eases in to HOP's 96 and the reach steps down behind the fog.
    for (let i = 0; i < 600; i++) { d = stepOrbitLimit(d, 96, 1 / 60, d); step() }
    expect(f.reach).toBe(768)
    // Then back to the usual orbit, the cursor at the origin.
    for (let i = 0; i < 600; i++) { d = Math.max(26, d - 1); step() }
    expect(f.reach).toBe(384)
    expect(f.far).toBeCloseTo(251, 6)
  })

  it('a re-anchor never moves the fog, and at the usual orbit never changes the reach', () => {
    let f = settled(26, 26)
    const { near, far } = f
    for (let k = 0; k < 20; k++) {
      // The cursor leaves the field: the camera is up to 24 cells further from the origin in each axis, in one frame.
      const fromOrigin = k % 2 ? 26 : 26 + 24 * Math.sqrt(3)
      for (let i = 0; i < 30; i++) {
        f = frame(f, 26, fromOrigin)
        expect(f.reach).toBe(384)
        expect([f.near, f.far]).toEqual([near, far])
      }
    }
  })

  it('the reach grows at once and shrinks only once the fog\'s end is well inside the smaller one', () => {
    expect(nextReach(CULL_REACH, 300)).toBe(384)
    expect(nextReach(384, 300)).toBe(384)
    // 230 is more than 0.8 of 272: held.
    expect(nextReach(384, 230)).toBe(384)
    expect(nextReach(384, 210)).toBe(272)
    expect(nextReach(384, 150)).toBe(CULL_REACH)
    expect(nextReach(6144, 100)).toBe(CULL_REACH)
  })

  it('the reach store starts at CULL_REACH', () => {
    expect(useDrawReach.getState().reach).toBe(CULL_REACH)
  })
})

describe('the near plane at BUILD\'s far orbit', () => {
  it('is CAMERA_NEAR out to 96 cells, then steps back in proportion', () => {
    for (let d = 0; d <= 96; d += 0.5) expect(cameraNear(d)).toBe(CAMERA_NEAR)
    expect(cameraNear(192)).toBeCloseTo(0.1, 12)
    expect(cameraNear(1280)).toBeCloseTo(0.05 * 1280 / 96, 12)
    expect(cameraNear(Number.NaN)).toBe(CAMERA_NEAR)
    // The depth buffer's grain (24 bits) at the cursor, 1280 out: under a fifth of a cell, from two cells.
    const grain = (z: number, near: number): number => (z * z) / (near * 2 ** 24)
    expect(grain(1280, CAMERA_NEAR)).toBeGreaterThan(1.9)
    expect(grain(1280, cameraNear(1280))).toBeLessThan(0.2)
  })
})

describe('the headlamp at BUILD\'s far orbit', () => {
  it('reaches as far as the orbit\'s limit, so what the camera looks at keeps full colour', () => {
    expect(headlampReach(26)).toBe(26)
    expect(headlampReach(1e9)).toBe(REACH_MAX)
    expect(headlampReach(1000, 1024)).toBe(1000)
    expect(headlampReach(1e9, 1024)).toBe(1024)
    // Never under the usual limit, whatever is passed.
    expect(headlampReach(90, 10)).toBe(90)
    // What the camera looks at, 1000 out, is lit as it is at the usual orbit; with the reach held at 96 it was on the floor.
    expect(distanceShare(1000, headlampReach(1000, 1024))).toBeCloseTo(distanceShare(26, headlampReach(26)), 12)
    expect(distanceShare(1000, headlampReach(1000))).toBeLessThan(0.931)
    expect(1000).toBeGreaterThan(REACH_MAX * NEAR_SHARE)
  })
})

describe('the scene is wired to it', () => {
  const scene = readFileSync('src/scene/Scene.tsx', 'utf8')
  it('sets the orbit limit every frame, eased, before the controls update', () => {
    const body = scene.slice(scene.indexOf('const limit = orbitMaxDistance('), scene.indexOf('c.update()', scene.indexOf('const limit = orbitMaxDistance(')))
    expect(body).toMatch(/orbitMaxDistance\(!tvOn && useBuilder\.getState\(\)\.active && !s\.walking, s\.scaleExp\)/)
    expect(body).toMatch(/const orbit = c\.object\.position\.distanceTo\(c\.target\)\n\s*c\.maxDistance = stepOrbitLimit\(orbit, limit, dt, c\.maxDistance\)/)
    // WALK's way back out is held to the orbit's limit now.
    expect(scene).toMatch(/to: s\.walking \? WALK_EYE : Math\.min\(outTo\.current, outLimit\)/)
    expect(scene).toMatch(/maxDistance=\{ORBIT_MAX_DISTANCE\}/)
    // The near plane follows the orbit, and is exactly CAMERA_NEAR again at the usual orbit and in TV.
    expect(body).toMatch(/const near = cameraNear\(tvOn \? 0 : orbit\)/)
    expect(body).toMatch(/rigCamera\.near !== near && \(near === CAMERA_NEAR \|\| Math\.abs\(rigCamera\.near - near\) > near \* 0\.05\)/)
    expect(body).toMatch(/rigCamera\.updateProjectionMatrix\(\)/)
    expect(scene).toMatch(/near: CAMERA_NEAR, far: CAMERA_FAR \}/)
    expect(scene).not.toMatch(/GRID_RADIUS \* 4/)
  })

  it('the fog sets the layers\' reach beyond its end, and the headlamp takes the orbit\'s limit', () => {
    const fog = scene.slice(scene.indexOf('function SceneFog()'), scene.indexOf('\n}\n', scene.indexOf('function SceneFog()')))
    expect(fog).toMatch(/const reach = nextReach\(was, f\.far \+ state\.camera\.position\.length\(\)\)/)
    expect(fog).toMatch(/useDrawReach\.setState\(\{ reach \}\)/)
    expect(scene).toMatch(/headlampReach\(state\.camera\.position\.distanceTo\(controls\.target\) \+ viewRig\.reachOwed, controls\.maxDistance\)/)
  })

  it('every culled layer in the world draws to the shared reach, never less than its own', () => {
    for (const f of ['WorldShards', 'WorldMessages', 'WorldSeeds', 'ChestLooks', 'AudioSpheres', 'PresenceAvatars', 'TargetAvatars', 'Avatar', 'SpawnMarker', 'StopCubes', 'TutorialTarget']) {
      const text = readFileSync(`src/scene/${f}.tsx`, 'utf8')
      expect(text, f).toMatch(/useDrawReach\(\(s\) => Math\.max\(REACH, s\.reach\)\)/)
      expect(text, f).toMatch(/const REACH = GRID_RADIUS \* 8\n/)
    }
    expect(readFileSync('src/scene/StarredMarks.tsx', 'utf8')).toMatch(/useDrawReach\(\(s\) => Math\.max\(STAR_REACH, s\.reach\)\)/)
    expect(readFileSync('src/scene/EarthPin.tsx', 'utf8')).toMatch(/useDrawReach\(\(s\) => Math\.max\(PIN_REACH, s\.reach\)\)/)
    expect(readFileSync('src/scene/DoorRooms.tsx', 'utf8')).toMatch(/useDrawReach\(\(s\) => Math\.max\(REACH, s\.reach\)\)/)
    expect(readFileSync('src/scene/SecretRegions.tsx', 'utf8')).toMatch(/if \(far > Math\.max\(GRID_RADIUS \* 8, reach\)\) continue/)
  })
})
