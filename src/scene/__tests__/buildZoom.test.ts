/**
 * buildZoom.test.ts - BUILD pulls back far enough to see a region of
 * Landscape Kit tiles (arkinox, 2026-11-15: "when building the landscape
 * tiles i feel like i can't zoom out far enough"), the fog's end follows the
 * orbit out so what is built keeps its colour, the layers' reach doubles
 * ahead of the fog so nothing seen is undrawn, and every other view keeps
 * its 96-cell orbit and its fog.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BUILD_FOG_SHARE,
  BUILD_MAX_GIBSONS,
  cameraNear,
  LAG_SLACK,
  nextAim,
  nextReach,
  orbitMaxDistance,
  reachNeed,
  reachStep,
  stepOrbitLimit,
  useDrawReach,
} from '../buildZoom'
import { CULL_REACH, FOG_START_SHARE, fogFar, fogFarStep } from '../fog'
import { CAMERA_FAR, CAMERA_NEAR, FOV, ORBIT_MAX_DISTANCE } from '../camera'
import { distanceShare, headlampReach, NEAR_SHARE, REACH_MAX } from '../headlamp'

/** Half the width a camera sees at `distance`, for a canvas `aspect` wide to high. */
const halfWidthAt = (distance: number, aspect: number): number => distance * Math.tan((FOV * Math.PI) / 360) * aspect

/** A SceneFog frame, as Scene.tsx runs it. */
interface Fog { far: number; aim: number; reach: number; mode: boolean | null }
function frame(f: Fog, build: boolean, distance: number, fromOrigin: number, dt = 1 / 60): Fog {
  const aim = nextAim(f.aim, reachNeed(build, distance, fromOrigin))
  const far = fogFarStep(f.far, f.mode, false, fromOrigin, dt, aim)
  return { far, aim, reach: nextReach(f.reach, aim, far + fromOrigin, build), mode: false }
}

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
    expect(stepOrbitLimit(26, 1024, 1 / 60)).toBe(1024)
    expect(stepOrbitLimit(96, 96, 1 / 60)).toBe(96)
    // Leaving BUILD 1024 cells out: one frame takes a small step in.
    const one = stepOrbitLimit(1024, 96, 1 / 60)
    expect(one).toBeLessThan(1024)
    expect(one).toBeGreaterThan(980)
    const run = (fps: number): number => { let d = 1024; for (let i = 0; i < fps; i++) d = stepOrbitLimit(d, 96, 1 / fps); return d }
    expect(run(30)).toBeCloseTo(run(144), 6)
    expect(run(60)).toBeGreaterThanOrEqual(96)
    // Four seconds and it is there.
    let d = 1024
    for (let i = 0; i < 240; i++) d = stepOrbitLimit(d, 96, 1 / 60)
    expect(d).toBeLessThan(96.1)
  })
})

describe('the fog follows the orbit out in BUILD', () => {
  it('outside BUILD (the 192-cell reach) the fog is exactly what it was', () => {
    for (let d = 0; d <= 300; d += 0.5) expect(fogFar(false, d, CULL_REACH)).toBe(Math.max(96, Math.min(192, CULL_REACH - d)))
    expect(fogFar(false, 26)).toBe(166)
    expect(fogFar(true, 1000, 3072)).toBe(96)
    expect(reachNeed(false, 1024, 1050)).toBe(0)
    // HOP and VIEW never ask for more: their reach stays 192 at any orbit.
    let f: Fog = { far: 166, aim: CULL_REACH, reach: CULL_REACH, mode: false }
    for (let d = 2; d <= 96; d += 1) { f = frame(f, false, d, d + 24); expect(f.reach).toBe(CULL_REACH) }
  })

  it('keeps what the camera looks at, and a 3 by 3 of 128 tiles about it, nearer than where the fog starts, at every distance out to the limit', () => {
    for (let e = 0; e <= 6; e++) {
      const limit = orbitMaxDistance(true, e)
      for (let d = 26; d <= limit; d += 2) {
        // The cursor up to a field's half-width from the render origin.
        const fromOrigin = d + 24
        let f: Fog = { far: 166, aim: CULL_REACH, reach: CULL_REACH, mode: false }
        for (let i = 0; i < 600; i++) f = frame(f, true, d, fromOrigin)
        const start = f.far * FOG_START_SHARE
        expect(d, `2^${e} at ${d}`).toBeLessThan(start)
        // The fog's least end.
        expect(start).toBeGreaterThanOrEqual(d * BUILD_FOG_SHARE * FOG_START_SHARE - 1e-6)
        // At 2^0, from 400 cells out, a region's far corner (192 * sqrt 2 past the cursor) is clear too.
        if (e === 0 && d >= 400) expect(d + 192 * Math.SQRT2).toBeLessThan(start)
        // And it is black inside the camera's far plane.
        expect(f.far).toBeLessThan(CAMERA_FAR)
        // At rest the fog is black inside the reach the layers draw to.
        expect(f.far + fromOrigin).toBeLessThanOrEqual(f.reach + 1e-9)
      }
    }
  })

  it('the reach doubles from 192 as far as the fog needs: 6144 at the 1280-cell limit', () => {
    expect(reachStep(0)).toBe(192)
    expect(reachStep(193)).toBe(384)
    expect(reachStep(2700)).toBe(3072)
    let f: Fog = { far: 166, aim: CULL_REACH, reach: CULL_REACH, mode: false }
    for (let i = 0; i < 600; i++) f = frame(f, true, 1280, 1280 + 24 * Math.sqrt(3))
    expect(f.reach).toBe(6144)
    // As far as the reach allows: about 4822 cells, inside the far plane.
    expect(f.far).toBeCloseTo(6144 - 1280 - 24 * Math.sqrt(3), 6)
    expect(f.far).toBeLessThan(CAMERA_FAR)
    // BUILD at the usual orbit draws no further than before.
    f = { far: 166, aim: CULL_REACH, reach: CULL_REACH, mode: false }
    for (let i = 0; i < 60; i++) f = frame(f, true, 26, 26)
    expect(f.reach).toBe(CULL_REACH)
    expect(f.far).toBe(166)
  })

  it('zooming out and back in, then leaving BUILD: the fog heads inside the reach, lags it by less than LAG_SLACK, and comes back to the old fog and reach', () => {
    let f: Fog = { far: 166, aim: CULL_REACH, reach: CULL_REACH, mode: false }
    let d = 26
    let worst = 0
    let changes = 0
    const check = (): void => {
      // Where the fog is going is inside the reach (to a cell: leaving BUILD the orbit eases to 96 from above).
      expect(fogFar(false, d, f.aim) + d).toBeLessThanOrEqual(f.reach + 1)
      worst = Math.max(worst, f.far + d - f.reach)
    }
    const step = (build: boolean): void => { const was = f.reach; f = frame(f, build, d, d); if (f.reach !== was) changes++; check() }
    // A wheel held out: the orbit grows 10% a frame to the limit, faster than a hand.
    while (d < 1280) { d = Math.min(1280, d * 1.1); step(true) }
    for (let i = 0; i < 120; i++) step(true)
    expect(f.reach).toBe(6144)
    // One change of reach a doubling: 384, 768, 1536, 3072, 6144.
    expect(changes).toBe(5)
    // The fog easing in behind the pull-back is never further out than the slack.
    expect(worst).toBeLessThan(LAG_SLACK)
    // And back in, held near a step to see it does not flip.
    while (d > 200) { d = Math.max(200, d / 1.1); step(true) }
    // The reach comes in behind the fog as it settles.
    for (let i = 0; i < 300; i++) step(true)
    expect(f.reach).toBe(768)
    changes = 0
    for (let i = 0; i < 300; i++) { d = 200 + 10 * Math.sin(i / 5); step(true) }
    expect(changes).toBeLessThanOrEqual(1)
    // Leaving BUILD 200 cells out: the camera eases in to 96 and the reach steps down behind the fog.
    for (let i = 0; i < 600; i++) { d = stepOrbitLimit(d, 96, 1 / 60); step(false) }
    expect(f.reach).toBe(CULL_REACH)
    expect(f.far).toBeCloseTo(96, 3)
    d = 26
    for (let i = 0; i < 600; i++) f = frame(f, false, d, d)
    expect(f.far).toBeCloseTo(166, 6)
    expect(worst).toBeLessThan(LAG_SLACK)
  })

  it('a re-anchor in BUILD at the usual orbit never changes the reach', () => {
    let f: Fog = { far: 166, aim: CULL_REACH, reach: CULL_REACH, mode: false }
    for (let k = 0; k < 20; k++) {
      // The cursor leaves the field: the camera is up to 24 cells further from the origin in each axis, in one frame.
      const fromOrigin = k % 2 ? 26 : 26 + 24 * Math.sqrt(3)
      for (let i = 0; i < 30; i++) { f = frame(f, true, 26, fromOrigin); expect(f.reach).toBe(CULL_REACH) }
    }
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
    expect(body).toMatch(/const orbit = c\.object\.position\.distanceTo\(c\.target\)\n\s*c\.maxDistance = stepOrbitLimit\(orbit, limit, dt\)/)
    expect(scene).toMatch(/maxDistance=\{ORBIT_MAX_DISTANCE\}/)
    // The near plane follows the orbit, and is exactly CAMERA_NEAR again at the usual orbit and in TV.
    expect(body).toMatch(/const near = cameraNear\(tvOn \? 0 : orbit\)/)
    expect(body).toMatch(/rigCamera\.near !== near && \(near === CAMERA_NEAR \|\| Math\.abs\(rigCamera\.near - near\) > near \* 0\.05\)/)
    expect(body).toMatch(/rigCamera\.updateProjectionMatrix\(\)/)
    expect(scene).toMatch(/near: CAMERA_NEAR, far: CAMERA_FAR \}/)
    expect(scene).not.toMatch(/GRID_RADIUS \* 4/)
  })

  it('the fog aims and sets the layers\' reach, and the headlamp takes the orbit\'s limit', () => {
    const fog = scene.slice(scene.indexOf('function SceneFog()'), scene.indexOf('\n}\n', scene.indexOf('function SceneFog()')))
    expect(fog).toMatch(/aim\.current = nextAim\(aim\.current, reachNeed\(build, distance, fromOrigin\)\)/)
    expect(fog).toMatch(/nextReach\(was, aim\.current, f\.far \+ fromOrigin, build\)/)
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
    expect(readFileSync('src/scene/SecretRegions.tsx', 'utf8')).toMatch(/if \(far > Math\.max\(GRID_RADIUS \* 8, reach\)\) continue/)
  })
})
