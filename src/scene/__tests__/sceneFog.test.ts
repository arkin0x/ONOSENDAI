/**
 * sceneFog.test.ts - the default fog further off (arkinox, 2026-11-09: "can we
 * also make the default fog more distant? things turn black when they are
 * still pretty close"): twice the distances in the third-person views, the
 * old ones in Cyberspace TV and WALK, one Fog moved in place.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { distanceShare, DISTANCE_FLOOR } from '../headlamp'

const src = readFileSync('src/scene/Scene.tsx', 'utf8')
const fogBody = src.slice(src.indexOf('function SceneFog()'), src.indexOf('\n}\n', src.indexOf('function SceneFog()')))

describe('the scene fog', () => {
  it('is VIEW_FOG_SCALE = 2 times the old 21.6 to 96 cells in the third-person views', () => {
    expect(src).toMatch(/export const VIEW_FOG_SCALE = 2\n/)
    expect(src).toMatch(/const FOG_NEAR = GRID_RADIUS \* 0\.9\n/)
    expect(src).toMatch(/const FOG_FAR = GRID_RADIUS \* 4\n/)
    expect(src).toMatch(/<SceneFog \/>/)
    expect(src).not.toMatch(/<fog attach="fog" args=\{\[0x000000, GRID_RADIUS \* 0\.9, GRID_RADIUS \* 4\]\} \/>/)
  })

  it('keeps the old distances in TV and WALK, and moves one Fog in place rather than making a new one', () => {
    expect(fogBody).toMatch(/const k = tv \|\| walking \? 1 : VIEW_FOG_SCALE/)
    expect(fogBody).toMatch(/fog\.current\.near = FOG_NEAR \* k/)
    expect(fogBody).toMatch(/fog\.current\.far = FOG_FAR \* k/)
    // The args are the Fog's first and only construction.
    expect(fogBody).toMatch(/args=\{\[0x000000, FOG_NEAR \* VIEW_FOG_SCALE, FOG_FAR \* VIEW_FOG_SCALE\]\}/)
  })

  it('the headlamp only dims, never to black: the black near the camera was the fog\'s', () => {
    expect(distanceShare(1000, 26)).toBeGreaterThanOrEqual(DISTANCE_FLOOR)
    expect(DISTANCE_FLOOR).toBeGreaterThan(0)
  })
})
