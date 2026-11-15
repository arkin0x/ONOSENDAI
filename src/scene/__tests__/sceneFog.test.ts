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
  it('is TV\'s and WALK\'s 96 cells with a long fade from 48, and in the third-person views 40 + 1.5 d to 160 + 3.5 d', async () => {
    const fog = readFileSync('src/scene/fog.ts', 'utf8')
    expect(fog).toMatch(/export const FOG_FAR = GRID_RADIUS \* 4\n/)
    expect(fog).toMatch(/export const FOG_NEAR = FOG_FAR \/ 2\n/)
    const { fogNear, fogFar, FOG_NEAR, FOG_FAR } = await import('../fog')
    expect([FOG_NEAR, FOG_FAR]).toEqual([48, 96])
    expect(fogNear(true, 0)).toBe(48)
    expect(fogFar(true, 0)).toBe(96)
    expect(fogNear(false, 26)).toBe(79)
    expect(fogFar(false, 26)).toBe(251)
    expect(src).toMatch(/<SceneFog \/>/)
    // The thin band at the draw edge is gone.
    expect(fog).not.toMatch(/FOG_START_SHARE/)
  })

  it('moves one Fog in place every frame, from the camera\'s distance to its target, rather than making a new one', () => {
    expect(fogBody).toMatch(/const base = useTv\.getState\(\)\.on \|\| useCyberspace\.getState\(\)\.walking\n/)
    expect(fogBody).toMatch(/const distance = controls \? state\.camera\.position\.distanceTo\(controls\.target\) : 0\n/)
    expect(fogBody).toMatch(/from\.current = fogDistanceStep\(from\.current, mode\.current, base, distance, dt\)\n\s*mode\.current = base\n/)
    expect(fogBody).toMatch(/const mode = useRef<boolean \| null>\(null\)/)
    expect(fogBody).toMatch(/f\.near = fogNear\(base, from\.current\)\n\s*f\.far = fogFar\(base, from\.current\)\n/)
    // The camera's distance from the render origin never moves the fog (a re-anchor), only the reach.
    expect(fogBody).toMatch(/nextReach\(was, f\.far \+ state\.camera\.position\.length\(\)\)/)
    expect(fogBody).not.toMatch(/fromOrigin/)
    // The args are the Fog's first and only construction.
    expect(fogBody).toMatch(/args=\{\[0x000000, fogNear\(false, 0\), fogFar\(false, 0\)\]\}/)
  })

  it('a jump in the camera\'s distance within a view glides, the same at any frame rate, never a step', async () => {
    const { easeFog, fogDistanceStep, fogFar, FOG_TAU } = await import('../fog')
    // A VIEW fly stopping: the view's centre comes in from 50 cells to 2 in one frame.
    const run = (fps: number, seconds: number): { d: number; worst: number } => {
      let d = 50
      let worst = 0
      for (let i = 0; i < Math.round(fps * seconds); i++) {
        const next = fogDistanceStep(d, false, false, 2, 1 / fps)
        worst = Math.max(worst, Math.abs(fogFar(false, next) - fogFar(false, d)))
        d = next
      }
      return { d, worst }
    }
    const a = run(30, 1)
    const b = run(60, 1)
    const c = run(144, 1)
    expect(a.d).toBeCloseTo(b.d, 9)
    expect(b.d).toBeCloseTo(c.d, 9)
    // One time constant takes 1 - 1/e of the way.
    expect(easeFog(50, 2, FOG_TAU)).toBeCloseTo(2 + 48 / Math.E, 9)
    // At 60 fps no frame moves the end by more than 11 cells, where it fell 168 in one.
    expect(b.worst).toBeLessThan(11)
    expect(fogFar(false, 50) - fogFar(false, 2)).toBe(168)
    expect(easeFog(100, 150, 0)).toBe(100)
  })

  it('N10: the first frame, and TV or WALK on or off, take the camera\'s distance at once', async () => {
    const { fogDistanceStep, fogFar } = await import('../fog')
    // The 24/7 broadcast page: TV on from the first frame.
    expect(fogFar(true, fogDistanceStep(0, null, true, 12, 1 / 60))).toBe(96)
    // A third-person view 26 out: 251 at once, not eased from the Fog's first distances.
    expect(fogDistanceStep(0, null, false, 26, 1 / 60)).toBe(26)
    expect(fogDistanceStep(0, null, true, 26, 0)).toBe(26)
    // Entering TV from the orbit, leaving WALK for it: at once.
    expect(fogDistanceStep(26, false, true, 8, 1 / 60)).toBe(8)
    expect(fogDistanceStep(0.001, true, false, 30, 1 / 60)).toBe(30)
    // Within a mode it glides.
    expect(fogDistanceStep(26, false, false, 40, 1 / 60)).toBeGreaterThan(26)
    expect(fogDistanceStep(26, false, false, 40, 1 / 60)).toBeLessThan(40)
    // Not a number is no distance.
    expect(fogDistanceStep(Number.NaN, false, false, 26, 1 / 60)).toBe(26)
    expect(fogDistanceStep(26, false, false, Number.NaN, 10)).toBeCloseTo(0, 6)
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
    for (const base of [true, false]) {
      for (let d = 0; d <= 96; d += 0.5) {
        for (const o of [0, d, d + 24 * Math.sqrt(3), 300]) {
          const far = fogFar(base, d)
          for (const was of [192, 384, 768, 1536]) expect(far + o, `${base} ${d} ${o} ${was}`).toBeLessThanOrEqual(nextReach(was, far + o))
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
