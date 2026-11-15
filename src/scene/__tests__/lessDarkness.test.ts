/**
 * lessDarkness.test.ts - the scene's darkening cut to about a tenth (arkinox,
 * 2026-11-15, of a Landscape Kit plains tile at 2^0: "we need to reduce the
 * darkness by a lot. maybe 10% of this.").
 *
 * Three things darkened a world face: the headlamp's facing (FACE_FLOOR), its
 * distance (DISTANCE_FLOOR), and the black fog's start (FOG_START_SHARE). The
 * lights, tone mapping and bloom never touch a world face (unlit, not tone
 * mapped, read as dark by the bloom). A shard's vertex dots never fogged at
 * all, so far off they were all that showed; they take the fog now.
 *
 * Nearer than the fog's edge the darkening is about a tenth of the old (an
 * eighth to a seventh for ground seen near edge on, which keeps a little
 * shade for its shapes). The edge itself stays, to hide the cull line, so
 * over everything up to the fog's end it is about a fifth.
 */

import { describe, expect, it } from 'vitest'
import { DISTANCE_FLOOR, FACE_FLOOR, HEADLAMP_DISTANCE_GLSL, distanceShare, facingShare, patchHeadlamp } from '../headlamp'
import { CULL_REACH, FOG_FAR, FOG_NEAR, FOG_START_SHARE, fogFar } from '../fog'
import { ShaderLib } from 'three'
import { SHARD_DOTS, createDiscMaterial } from '../pointDisc'

/** three's linear fog factor: 0 before `near`, 1 at `far`. */
const fogFactor = (d: number, near: number, far: number): number => Math.min(1, Math.max(0, (d - near) / (far - near)))

/** What share of its colour a world face keeps, as the shaders take it. */
function kept(d: number, nz: number, reach: number, far: number, share: number, face = facingShare(nz), dist = distanceShare(d, reach)): number {
  return face * dist * (1 - fogFactor(d, far * share, far))
}

/** The old shading, as it stood before 2026-11-15, for the comparison. */
function keptBefore(d: number, nz: number, reach: number, far: number): number {
  const face = 0.4 + 0.6 * Math.min(1, Math.abs(nz))
  const past = Math.max(0, d - reach * 0.75) / (reach * 1.6)
  const dist = 0.3 + 0.7 * Math.exp(-past)
  return kept(d, nz, reach, far, 0.225, face, dist)
}

/** The mean share of colour lost from `from` to `to` cells. */
function meanLoss(f: (d: number) => number, from: number, to: number): number {
  let sum = 0
  let n = 0
  for (let d = from; d <= to; d += 0.5) { sum += 1 - f(d); n++ }
  return sum / n
}

describe('the darkening, cut to about a tenth', () => {
  it('has the new values: faces keep 0.9 edge on, far things 0.93, the fog starts at 0.85 of its end', () => {
    expect(FACE_FLOOR).toBe(0.9)
    expect(DISTANCE_FLOOR).toBe(0.93)
    expect(FOG_START_SHARE).toBe(0.85)
    expect(FOG_NEAR).toBeCloseTo(81.6, 9)
    expect(FOG_FAR).toBe(96)
    expect(facingShare(0)).toBe(0.9)
    expect(distanceShare(1e6, 26)).toBeCloseTo(0.93, 6)
  })

  it('bakes the new floors into the shaders the world compiles', () => {
    expect(HEADLAMP_DISTANCE_GLSL).toContain('return 0.9300 + 0.0700 * exp(-past);')
    const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} }
    expect(patchHeadlamp(shader, true)).toBe(true)
    expect(shader.fragmentShader).toContain('return 0.9000 + 0.1000 * min(nz, 1.0);')
  })

  it('loses about a tenth of what it lost nearer than the fog\'s edge, a fifth up to its end', () => {
    // The usual orbit: 26 cells out, the fog black at 166, its edge from 141.1.
    const reach = 26
    const far = fogFar(false, 26)
    expect(far).toBe(166)
    const edge = far * FOG_START_SHARE
    const ratio = (nz: number, to: number): number =>
      meanLoss((d) => kept(d, nz, reach, far, FOG_START_SHARE), 5, to) / meanLoss((d) => keptBefore(d, nz, reach, far), 5, to)
    // Facing the camera, a tenth or less; ground near edge on (nz 0.3) keeps a little more, for its shapes.
    expect(ratio(1, edge)).toBeLessThan(0.1)
    expect(ratio(0.6, edge)).toBeLessThan(0.14)
    expect(ratio(0.3, edge)).toBeLessThan(0.17)
    // The edge that hides the cull line is all that is left past it.
    for (const nz of [0.3, 0.6, 1]) {
      expect(ratio(nz, far), `nz ${nz}`).toBeLessThan(0.26)
      expect(ratio(nz, far), `nz ${nz}`).toBeGreaterThan(0.15)
    }
  })

  it('keeps a tile 100 cells off coloured: most of its colour, where it kept a fifth or less', () => {
    const far = fogFar(false, 26)
    expect(keptBefore(100, 0.3, 26, far)).toBeLessThan(0.15)
    expect(keptBefore(100, 1, 26, far)).toBeLessThan(0.25)
    expect(kept(100, 0.3, 26, far, FOG_START_SHARE)).toBeGreaterThan(0.85)
    expect(kept(100, 1, 26, far, FOG_START_SHARE)).toBeGreaterThan(0.9)
  })

  it('still fades to black at the fog\'s end, so nothing pops where the layers stop drawing', () => {
    for (const fromOrigin of [0, 26, 60, 96]) {
      const far = fogFar(false, fromOrigin)
      expect(far + fromOrigin).toBeLessThanOrEqual(CULL_REACH + 1e-9)
      expect(kept(far, 1, 26, far, FOG_START_SHARE)).toBe(0)
      // A soft edge, not a wall: the fade spans 15% of the distance.
      expect(kept(far * 0.925, 1, 26, far, FOG_START_SHARE)).toBeGreaterThan(0.4)
      expect(kept(far * 0.925, 1, 26, far, FOG_START_SHARE)).toBeLessThan(0.6)
    }
    // TV's and WALK's own end.
    expect(kept(96, 1, 8, fogFar(true, 0), FOG_START_SHARE)).toBe(0)
  })

  it('fogs a shard\'s vertex dots with its faces, so far off they no longer show alone or pop at the cull line', () => {
    for (const headlamp of [true, false]) {
      const m = createDiscMaterial(SHARD_DOTS, 1, headlamp)
      expect(m.fog).toBe(true)
      for (const u of ['fogColor', 'fogNear', 'fogFar']) expect(m.uniforms[u], u).toBeDefined()
      expect(m.vertexShader).toContain('#include <fog_pars_vertex>')
      expect(m.vertexShader).toContain('#include <fog_vertex>')
      // fog_vertex reads mvPosition: radialFog's straight-line distance.
      expect(m.vertexShader.indexOf('vec4 mvPosition = mv;')).toBeLessThan(m.vertexShader.indexOf('#include <fog_vertex>'))
      expect(m.fragmentShader).toContain('#include <fog_pars_fragment>')
      // After the colour is final, as three's own materials do it.
      expect(m.fragmentShader.indexOf('#include <fog_fragment>')).toBeGreaterThan(m.fragmentShader.indexOf('gl_FragColor = vec4(color, alpha);'))
      m.dispose()
    }
    // Each material its own fog uniforms (three writes them in place).
    const a = createDiscMaterial(SHARD_DOTS, 1, true)
    const b = createDiscMaterial(SHARD_DOTS, 1, true)
    expect(a.uniforms.fogNear).not.toBe(b.uniforms.fogNear)
    a.dispose()
    b.dispose()
  })

  it('still shades two faces of one colour at different angles apart, a little', () => {
    expect(facingShare(1) - facingShare(0)).toBeCloseTo(0.1, 9)
    expect(facingShare(0.5)).toBeLessThan(facingShare(1))
  })
})
