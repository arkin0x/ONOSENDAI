/**
 * sceneFog.test.ts - the scene fog: one Fog moved in place, its distances
 * following the camera's distance from what it looks at (fog.ts), further off
 * in the third-person views than in Cyberspace TV and WALK, measured straight
 * out, and black before the layers stop drawing. How it follows the zoom is
 * fogFollowsZoom.test.ts.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { distanceShare, DISTANCE_FLOOR } from '../headlamp'
import { readdirSync } from 'node:fs'

const src = readFileSync('src/scene/Scene.tsx', 'utf8')
const fogBody = src.slice(src.indexOf('function SceneFog()'), src.indexOf('\n}\n', src.indexOf('function SceneFog()')))

describe('the scene fog', () => {
  it('is TV\'s 96 cells with a long fade from 48, WALK\'s 300 from 80, and in the third-person views 40 + 1.5 d to 160 + 3.5 d', async () => {
    const fog = readFileSync('src/scene/fog.ts', 'utf8')
    expect(fog).toMatch(/export const FOG_FAR = GRID_RADIUS \* 4\n/)
    expect(fog).toMatch(/export const FOG_NEAR = FOG_FAR \/ 2\n/)
    const { fogNear, fogFar, FOG_NEAR, FOG_FAR, WALK_FOG_NEAR, WALK_FOG_FAR } = await import('../fog')
    expect([FOG_NEAR, FOG_FAR]).toEqual([48, 96])
    expect([WALK_FOG_NEAR, WALK_FOG_FAR]).toEqual([80, 300])
    expect([fogNear('walk', 0), fogFar('walk', 0)]).toEqual([80, 300])
    expect(fogNear('tv', 0)).toBe(48)
    expect(fogFar('tv', 0)).toBe(96)
    expect(fogNear('orbit', 26)).toBe(79)
    expect(fogFar('orbit', 26)).toBe(251)
    expect(src).toMatch(/<SceneFog \/>/)
    // The thin band at the draw edge is gone.
    expect(fog).not.toMatch(/FOG_START_SHARE/)
  })

  it('moves one Fog in place every frame, from the camera\'s distance to its target, rather than making a new one', () => {
    expect(fogBody).toMatch(/const view: FogView = useTv\.getState\(\)\.on \? 'tv' : useCyberspace\.getState\(\)\.walking \? 'walk' : 'orbit'\n/)
    // A stopped VIEW fly's drop in distance is owed and fades, as the headlamp takes it.
    expect(fogBody).toMatch(/const distance = controls \? state\.camera\.position\.distanceTo\(controls\.target\) \+ viewRig\.reachOwed : 0\n/)
    expect(fogBody).toMatch(/f\.near = fogNear\(view, distance\)\n\s*f\.far = fogFar\(view, distance\)\n/)
    // Fresh every frame: nothing eased, nothing remembered from the last frame but the reach.
    expect(fogBody).not.toMatch(/useRef<boolean/)
    expect(fogBody).not.toMatch(/\bdt\b/)
    // The camera's distance from the render origin never moves the fog (a re-anchor), only the reach,
    // and a pinned fog (the harness) still sets the reach.
    expect(fogBody).toMatch(/\} else \{[\s\S]*\}\n\s*\/\/ The layers draw[\s\S]*const reach = nextReach\(was, f\.far \+ state\.camera\.position\.length\(\)\)/)
    expect(fogBody).not.toMatch(/fromOrigin/)
    // The args are the Fog's first and only construction.
    expect(fogBody).toMatch(/args=\{\[0x000000, fogNear\('orbit', 0\), fogFar\('orbit', 0\)\]\}/)
  })

  it('takes the same distances in every mode for the same camera, and TV\'s and WALK\'s are constant over their shots', async () => {
    const { fogNear, fogFar } = await import('../fog')
    for (let d = 0; d <= 24; d += 0.25) expect([fogNear('tv', d), fogFar('tv', d)]).toEqual([48, 96])
    // WALK's too, for an eye up to 40 cells behind the walker.
    for (let d = 0; d <= 40; d += 0.25) expect([fogNear('walk', d), fogFar('walk', d)]).toEqual([80, 300])
    // Not a number is no distance.
    expect(fogFar('orbit', Number.NaN)).toBe(fogFar('orbit', 0))
    expect(fogNear('orbit', Number.POSITIVE_INFINITY)).toBe(fogNear('orbit', 0))
    expect(fogFar('orbit', -5)).toBe(fogFar('orbit', 0))
    // The start is always short of the end, even past any zoom a view allows.
    for (const d of [0, 1e3, 1e4, 1e6]) for (const view of ['orbit', 'walk', 'tv'] as const) expect(fogNear(view, d)).toBeLessThan(fogFar(view, d))
  })

  it('S2b: three fogs by straight-line distance, so the bound below is exact at every screen edge', async () => {
    const { ShaderChunk, ShaderLib } = await import('three')
    await import('../radialFog')
    expect(ShaderChunk.fog_vertex).toMatch(/vFogDepth = length\( mvPosition\.xyz \);/)
    expect(ShaderChunk.fog_vertex).not.toMatch(/- mvPosition\.z/)
    // The built-in shaders the world draws with (and the headlamp patches) include that chunk.
    for (const lib of [ShaderLib.basic, ShaderLib.points]) expect(lib.vertexShader).toMatch(/#include <fog_vertex>/)
    // Installed before anything compiles: main.tsx's first import, and the scene's.
    const main = readFileSync('src/main.tsx', 'utf8')
    expect(main.indexOf("import './scene/radialFog'")).toBeLessThan(main.indexOf("import App from './App'"))
    expect(main.indexOf("import './scene/radialFog'")).toBeGreaterThanOrEqual(0)
    expect(src).toMatch(/import '\.\/radialFog'/)
    // No shader of ours carries its own copy of three's fog depth.
    for (const f of readdirSync('src/scene')) {
      if (!/\.(ts|tsx)$/.test(f) || f === 'radialFog.ts') continue
      expect(readFileSync(`src/scene/${f}`, 'utf8'), f).not.toMatch(/vFogDepth\s*=/)
    }
  })

  it('S2: the fog is black before the cull line: the layers draw at least as far as its end plus the camera\'s distance from the origin', async () => {
    // Radial fog (S2b): a thing on the cull sphere is at least reach - o from a camera o from
    // the origin, straight-line, in every direction; fogged by that same distance, it is black.
    const { fogFar, CULL_REACH } = await import('../fog')
    const { nextReach } = await import('../buildZoom')
    expect(CULL_REACH).toBe(192)
    for (const view of ['orbit', 'walk', 'tv'] as const) {
      for (let d = 0; d <= 96; d += 0.5) {
        for (const o of [0, d, d + 24 * Math.sqrt(3), 300]) {
          const far = fogFar(view, d)
          for (const was of [192, 384, 768, 1536]) expect(far + o, `${view} ${d} ${o} ${was}`).toBeLessThanOrEqual(nextReach(was, far + o))
        }
      }
    }
  })

  it('S2: every culled layer in the scene reaches at least CULL_REACH, SecretRegions included', () => {
    const dir = 'src/scene'
    let seen = 0
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const text = readFileSync(`${dir}/${f}`, 'utf8')
      for (const m of text.matchAll(/(?:REACH|PIN_REACH|STAR_REACH) = GRID_RADIUS \* (\d+)/g)) { seen++; expect(Number(m[1]), f).toBeGreaterThanOrEqual(8) }
    }
    expect(seen).toBeGreaterThan(10)
    // Never less than CULL_REACH; further while BUILD is pulled back (buildZoom.ts).
    expect(readFileSync('src/scene/SecretRegions.tsx', 'utf8')).toMatch(/if \(far > Math\.max\(GRID_RADIUS \* 8, reach\)\) continue/)
  })

  it('the headlamp only dims, never to black: the black near the camera was the fog\'s', () => {
    expect(distanceShare(1000, 26)).toBeGreaterThanOrEqual(DISTANCE_FLOOR)
    expect(DISTANCE_FLOOR).toBeGreaterThan(0)
  })
})
