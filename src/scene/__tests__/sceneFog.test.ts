/**
 * sceneFog.test.ts - the default fog further off (arkinox, 2026-11-09: "can we
 * also make the default fog more distant? things turn black when they are
 * still pretty close"): twice the distances in the third-person views, the
 * old ones in Cyberspace TV and WALK, one Fog moved in place.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { distanceShare, DISTANCE_FLOOR } from '../headlamp'
import { readdirSync } from 'node:fs'

const src = readFileSync('src/scene/Scene.tsx', 'utf8')
const fogBody = src.slice(src.indexOf('function SceneFog()'), src.indexOf('\n}\n', src.indexOf('function SceneFog()')))

describe('the scene fog', () => {
  it('is VIEW_FOG_SCALE = 2 times the old 21.6 to 96 cells in the third-person views', () => {
    const fog = readFileSync('src/scene/fog.ts', 'utf8')
    expect(fog).toMatch(/export const VIEW_FOG_SCALE = 2\n/)
    expect(fog).toMatch(/export const FOG_NEAR = GRID_RADIUS \* 0\.9\n/)
    expect(fog).toMatch(/export const FOG_FAR = GRID_RADIUS \* 4\n/)
    expect(src).toMatch(/<SceneFog \/>/)
    expect(src).not.toMatch(/<fog attach="fog" args=\{\[0x000000, GRID_RADIUS \* 0\.9, GRID_RADIUS \* 4\]\} \/>/)
  })

  it('keeps the old distances in TV and WALK, and moves one Fog in place every frame rather than making a new one', () => {
    expect(fogBody).toMatch(/fogFar\(useTv\.getState\(\)\.on \|\| useCyberspace\.getState\(\)\.walking, state\.camera\.position\.length\(\)\)/)
    expect(fogBody).toMatch(/f\.near = far \* FOG_START_SHARE/)
    expect(fogBody).toMatch(/f\.far = far/)
    // The args are the Fog's first and only construction.
    expect(fogBody).toMatch(/args=\{\[0x000000, FOG_NEAR \* VIEW_FOG_SCALE, FOG_FAR \* VIEW_FOG_SCALE\]\}/)
  })

  it('S2: the fog is black before the cull line: at most CULL_REACH less the camera\'s distance from the origin, never nearer than the old 96, 192 at most', async () => {
    const { fogFar, CULL_REACH, VIEW_FOG_SCALE } = await import('../fog')
    expect(CULL_REACH).toBe(192)
    expect(fogFar(true, 0)).toBe(96)
    expect(fogFar(true, 500)).toBe(96)
    expect(fogFar(false, 0)).toBe(96 * VIEW_FOG_SCALE)
    // The usual orbit, 26 out over the cursor at the origin: black at 166, no further.
    expect(fogFar(false, 26)).toBe(166)
    for (let d = 0; d <= 96; d += 0.5) {
      const far = fogFar(false, d)
      expect(far + d).toBeLessThanOrEqual(CULL_REACH + 1e-9)
      expect(far).toBeGreaterThanOrEqual(96)
    }
    // Past the orbit's own 96-cell limit it keeps the old end, as before.
    expect(fogFar(false, 150)).toBe(96)
  })

  it('S2: every culled layer in the scene reaches at least CULL_REACH, SecretRegions included', () => {
    const dir = 'src/scene'
    let seen = 0
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const text = readFileSync(`${dir}/${f}`, 'utf8')
      for (const m of text.matchAll(/(?:REACH|PIN_REACH|STAR_REACH) = GRID_RADIUS \* (\d+)/g)) { seen++; expect(Number(m[1]), f).toBeGreaterThanOrEqual(8) }
    }
    expect(seen).toBeGreaterThan(10)
    expect(readFileSync('src/scene/SecretRegions.tsx', 'utf8')).toMatch(/if \(far > GRID_RADIUS \* 8\) continue/)
  })

  it('the headlamp only dims, never to black: the black near the camera was the fog\'s', () => {
    expect(distanceShare(1000, 26)).toBeGreaterThanOrEqual(DISTANCE_FLOOR)
    expect(DISTANCE_FLOOR).toBeGreaterThan(0)
  })
})
