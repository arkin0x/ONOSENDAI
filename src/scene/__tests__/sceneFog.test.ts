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

  it('keeps the old distances in TV and WALK, and eases one Fog in place every frame rather than making a new one', () => {
    expect(fogBody).toMatch(/const base = useTv\.getState\(\)\.on \|\| useCyberspace\.getState\(\)\.walking\n/)
    expect(fogBody).toMatch(/f\.far = fogFarStep\(f\.far, mode\.current, base, state\.camera\.position\.length\(\), dt\)\n\s*mode\.current = base\n/)
    expect(fogBody).toMatch(/const mode = useRef<boolean \| null>\(null\)/)
    expect(fogBody).toMatch(/f\.near = f\.far \* FOG_START_SHARE/)
    // The args are the Fog's first and only construction.
    expect(fogBody).toMatch(/args=\{\[0x000000, FOG_NEAR \* VIEW_FOG_SCALE, FOG_FAR \* VIEW_FOG_SCALE\]\}/)
  })

  it('S2a: a re-anchor\'s jump in the target is eased, the same at any frame rate, never a step', async () => {
    const { easeFog, FOG_TAU } = await import('../fog')
    // The reviewer's measured jump: 190.8 to 166.3 in one frame.
    const run = (fps: number, seconds: number): { far: number; worst: number } => {
      let far = 190.8
      let worst = 0
      for (let i = 0; i < Math.round(fps * seconds); i++) {
        const next = easeFog(far, 166.3, 1 / fps)
        worst = Math.max(worst, Math.abs(next - far))
        far = next
      }
      return { far, worst }
    }
    const a = run(30, 1)
    const b = run(60, 1)
    const c = run(144, 1)
    expect(a.far).toBeCloseTo(b.far, 9)
    expect(b.far).toBeCloseTo(c.far, 9)
    // One time constant takes 1 - 1/e of the way.
    expect(easeFog(190.8, 166.3, FOG_TAU)).toBeCloseTo(166.3 + 24.5 / Math.E, 9)
    // At 60 fps no frame moves the end by more than 1.1 cells (it was 24.5 in one).
    expect(b.worst).toBeLessThan(1.1)
    expect(easeFog(100, 150, 0)).toBe(100)
  })

  it('N10: the first frame jumps straight to the target, in any mode, from the Fog\'s first distances', async () => {
    const { fogFarStep, fogFar, FOG_FAR, VIEW_FOG_SCALE } = await import('../fog')
    // The 24/7 broadcast page: TV on from the first frame, the Fog built at 192.
    expect(fogFarStep(FOG_FAR * VIEW_FOG_SCALE, null, true, 40, 1 / 60)).toBe(96)
    // A third-person view 26 out: 166 at once, not eased down from 192.
    expect(fogFarStep(FOG_FAR * VIEW_FOG_SCALE, null, false, 26, 1 / 60)).toBe(fogFar(false, 26))
    // Even with no time passed.
    expect(fogFarStep(FOG_FAR * VIEW_FOG_SCALE, null, true, 0, 0)).toBe(96)
  })

  it('N10: TV or WALK on or off jumps to the new mode\'s fog; within a mode a re-anchor still eases', async () => {
    const { fogFarStep, easeFog, fogFar } = await import('../fog')
    // Entering TV or WALK from the usual orbit: 166 to 96 in one frame.
    expect(fogFarStep(166, false, true, 26, 1 / 60)).toBe(96)
    // Leaving: 96 to the third-person 166 in one frame.
    expect(fogFarStep(96, true, false, 26, 1 / 60)).toBe(166)
    // A re-anchor within a third-person view: eased, exactly as before.
    expect(fogFarStep(190.8, false, false, 192 - 166.3, 1 / 60)).toBe(easeFog(190.8, 166.3, 1 / 60))
    expect(fogFarStep(190.8, false, false, 192 - 166.3, 1 / 60)).toBeGreaterThan(189)
    // And a frame run as SceneFog runs it: orbit, TV on, a TV cut far off, TV off.
    let far = 192
    let mode: boolean | null = null
    const frame = (base: boolean, d: number): number => { far = fogFarStep(far, mode, base, d, 1 / 60); mode = base; return far }
    expect(frame(false, 26)).toBe(166)
    expect(frame(false, 26)).toBe(166)
    expect(frame(true, 26)).toBe(96)
    // In TV the end is 96 wherever the camera is: nothing to ease.
    expect(frame(true, 300)).toBe(96)
    expect(frame(false, 26)).toBe(166)
    // A re-anchor after: eased from 166 toward the new target, not jumped.
    const next = frame(false, 60)
    expect(next).toBeLessThan(166)
    expect(next).toBeGreaterThan(fogFar(false, 60))
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

  it('S2: the fog is black before the cull line: at most CULL_REACH less the camera\'s distance from the origin, never nearer than the old 96, 192 at most', async () => {
    // Radial fog (S2b): a thing on the cull sphere is at least CULL_REACH - d from a camera d from
    // the origin, straight-line, in every direction; fogged by that same distance, it is black.
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
